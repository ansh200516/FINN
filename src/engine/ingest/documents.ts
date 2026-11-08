/**
 * Documents ingest (owner: Builder C): discover → download → per-page text → DB.
 *
 * Discovery unions NSE (primary: announcements history + annual-reports API)
 * with screener.in (secondary: Concalls / Annual reports lists), de-duplicated
 * by (kind, period). Download is UA + 60 s timeout + 40 MB cap + `%PDF` check;
 * files land in `data/cache/docs/<sha256>.pdf` (gitignored), text in
 * `document_pages`, provenance in `document_meta`. Idempotent by URL and by
 * content hash (the same PDF filed on NSE and BSE is stored once).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, documentMeta, documentPages, documents } from "@/db/schema";
import { logger } from "@/lib/logger";
import { extractPdfPages } from "../extract/pdf-text";
import {
  inferPeriodFromText,
  makePeriod,
  parsePeriodLabel,
  parseTranscript,
  periodForTranscriptDate,
  periodSortKey,
} from "../extract/transcript";
import { DownloadError, downloadPdf } from "../sources/bse-docs";
import {
  annualReportsFromNse,
  fetchNseAnnouncementHistory,
  fetchNseAnnualReports,
  type NseDocCandidate,
  transcriptsFromAnnouncements,
} from "../sources/nse-docs";
import {
  documentsFromScreener,
  fetchScreenerCompanyHtml,
  parseScreenerDocuments,
} from "../sources/screener";
import type { DiscoveredDocument, DocumentKind, DocumentText } from "../types";
import type { IngestSummary } from "./index";

const log = logger.child({ mod: "engine/ingest/documents" });

export const DOCS_CACHE_DIR = join(process.cwd(), "data", "cache", "docs");

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoveryOptions {
  /** how many completed quarters of transcripts to keep (default 6) */
  quarters?: number;
  /** how many latest annual reports (default 2) */
  annualReports?: number;
  /** consult screener.in as a secondary source (default true) */
  useScreener?: boolean;
  includePresentations?: boolean;
  /** "now" for the quarter window (tests) */
  nowMs?: number;
}

export interface DiscoveryResult {
  symbol: string;
  isin: string;
  documents: DiscoveredDocument[];
  sources: {
    nse: "ok" | "failed" | "skipped";
    screener: "ok" | "failed" | "skipped";
  };
  /** why the list is empty / thin, for the UI ("management holds no earnings calls") */
  reason: string | null;
  errors: string[];
  /** per-source counts before de-duplication */
  raw: {
    nseTranscripts: number;
    nseAnnualReports: number;
    screenerTranscripts: number;
    screenerAnnualReports: number;
  };
}

/** The last `n` completed fiscal quarters (labels), newest first. */
export function recentQuarterLabels(n: number, nowMs = Date.now()): string[] {
  const latest = parsePeriodLabel(periodForTranscriptDate(nowMs));
  if (!latest) return [];
  const out: string[] = [];
  let fy = latest.fy;
  let q = latest.n ?? 1;
  for (let i = 0; i < n; i++) {
    out.push(makePeriod("quarter", fy, q).label);
    if (q === 1) {
      q = 4;
      fy -= 1;
    } else q -= 1;
  }
  return out;
}

const SOURCE_RANK: Record<DiscoveredDocument["source"], number> = {
  nse: 3,
  bse: 2,
  screener: 1,
  ir: 0,
};

/** Pure: union + de-duplicate candidates by (kind, period). */
export function dedupeDocuments(
  candidates: Array<DiscoveredDocument & { score?: number }>,
  opts: { allowedPeriods?: Set<string>; maxAnnualReports?: number } = {},
): DiscoveredDocument[] {
  const byKey = new Map<string, DiscoveredDocument & { score?: number }>();
  const seenUrl = new Set<string>();
  for (const c of candidates) {
    if (seenUrl.has(c.url)) continue;
    if (
      c.kind === "transcript" &&
      opts.allowedPeriods &&
      c.period &&
      !opts.allowedPeriods.has(c.period)
    )
      continue;
    const key = `${c.kind}|${c.period ?? c.url}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, c);
      seenUrl.add(c.url);
      continue;
    }
    const better =
      SOURCE_RANK[c.source] > SOURCE_RANK[cur.source] ||
      (SOURCE_RANK[c.source] === SOURCE_RANK[cur.source] &&
        ((c.score ?? 0) > (cur.score ?? 0) ||
          ((c.score ?? 0) === (cur.score ?? 0) &&
            (c.publishedAtMs ?? Number.MAX_SAFE_INTEGER) <
              (cur.publishedAtMs ?? Number.MAX_SAFE_INTEGER))));
    if (better) {
      seenUrl.delete(cur.url);
      byKey.set(key, c);
      seenUrl.add(c.url);
    }
  }
  const out = [...byKey.values()].map(({ score: _s, ...d }) => d);
  // newest first; annual reports capped
  const transcripts = out
    .filter((d) => d.kind === "transcript")
    .sort(
      (a, b) =>
        periodSortKey(b.period).localeCompare(periodSortKey(a.period)) ||
        (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0),
    );
  const ars = out
    .filter((d) => d.kind === "annual_report")
    .sort((a, b) =>
      periodSortKey(b.period).localeCompare(periodSortKey(a.period)),
    )
    .slice(0, opts.maxAnnualReports ?? 2);
  const rest = out.filter(
    (d) => d.kind !== "transcript" && d.kind !== "annual_report",
  );
  return [...transcripts, ...ars, ...rest];
}

/** Discover transcripts (last N quarters) and the latest annual reports for a symbol. */
export async function discoverDocuments(
  symbol: string,
  isin: string,
  opts: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const quarters = opts.quarters ?? 6;
  const maxAr = opts.annualReports ?? 2;
  const nowMs = opts.nowMs ?? Date.now();
  const allowed = new Set(recentQuarterLabels(quarters, nowMs));
  const sinceMs = nowMs - (quarters + 2) * 92 * 86_400_000;
  const errors: string[] = [];
  const candidates: Array<DiscoveredDocument & { score?: number }> = [];
  const raw = {
    nseTranscripts: 0,
    nseAnnualReports: 0,
    screenerTranscripts: 0,
    screenerAnnualReports: 0,
  };
  const sources: DiscoveryResult["sources"] = {
    nse: "skipped",
    screener: "skipped",
  };

  // --- NSE ---------------------------------------------------------------------
  try {
    const rows = await fetchNseAnnouncementHistory(symbol);
    const tr: NseDocCandidate[] = transcriptsFromAnnouncements(rows, {
      sinceMs,
      includePresentations: opts.includePresentations,
    });
    raw.nseTranscripts = tr.filter((t) => t.kind === "transcript").length;
    candidates.push(...tr);
    sources.nse = "ok";
  } catch (e) {
    sources.nse = "failed";
    errors.push(
      `nse announcements: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    const ars = annualReportsFromNse(await fetchNseAnnualReports(symbol));
    raw.nseAnnualReports = ars.length;
    candidates.push(...ars.slice(0, maxAr + 1));
    if (sources.nse === "failed" && ars.length) sources.nse = "ok"; // announcements down, AR index up
  } catch (e) {
    errors.push(
      `nse annual-reports: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // --- screener (secondary) ----------------------------------------------------------
  if (opts.useScreener !== false) {
    try {
      const html = await fetchScreenerCompanyHtml(symbol);
      const parsed = parseScreenerDocuments(html);
      const docs = documentsFromScreener(parsed, {
        sinceMs,
        maxAnnualReports: maxAr,
      });
      raw.screenerTranscripts = docs.filter(
        (d) => d.kind === "transcript",
      ).length;
      raw.screenerAnnualReports = docs.filter(
        (d) => d.kind === "annual_report",
      ).length;
      candidates.push(...docs);
      sources.screener = "ok";
    } catch (e) {
      sources.screener = "failed";
      errors.push(`screener: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const documentsOut = dedupeDocuments(candidates, {
    allowedPeriods: allowed,
    maxAnnualReports: maxAr,
  });
  const nTr = documentsOut.filter((d) => d.kind === "transcript").length;
  let reason: string | null = null;
  if (sources.nse === "failed" && sources.screener !== "ok")
    reason = "document sources unreachable";
  else if (nTr === 0 && (sources.nse === "ok" || sources.screener === "ok"))
    reason = `no earnings-call transcripts filed in the last ${quarters} quarters (management may not hold concalls)`;
  else if (nTr < 3)
    reason = `only ${nTr} transcript(s) in the last ${quarters} quarters`;

  log.info(
    {
      symbol,
      isin,
      nTr,
      ars: documentsOut.filter((d) => d.kind === "annual_report").length,
      sources,
      reason,
    },
    "discovered documents",
  );
  return {
    symbol,
    isin,
    documents: documentsOut,
    sources,
    reason,
    errors,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Ingest (download + extract + persist)
// ---------------------------------------------------------------------------

export interface IngestDocumentsOptions extends DiscoveryOptions {
  symbol?: string;
  /** re-download and re-extract even when the row is already `ok` */
  force?: boolean;
  /** pre-discovered list (skips discovery) */
  discovered?: DiscoveredDocument[];
  /** pause between downloads, ms (default 600 — be polite to nsearchives/bse) */
  pauseMs?: number;
  onProgress?: (msg: string, data?: Record<string, unknown>) => void;
}

export interface IngestedDocument {
  id: string | null;
  kind: DocumentKind;
  period: string | null;
  url: string;
  source: DiscoveredDocument["source"];
  status: "inserted" | "updated" | "skipped" | "failed";
  pages: number | null;
  chars: number | null;
  textQuality: string | null;
  turns: number | null;
  managementTurns: number | null;
  elapsedMs: number;
  error: string | null;
}

export interface IngestDocumentsResult extends IngestSummary {
  discovery: DiscoveryResult | null;
  documents: IngestedDocument[];
}

export function docIdForSha(sha256: string): string {
  return `doc_${sha256.slice(0, 24)}`;
}

async function resolveSymbol(isin: string): Promise<string | null> {
  const rows = await db
    .select({ nseSymbol: companies.nseSymbol })
    .from(companies)
    .where(eq(companies.isin, isin))
    .limit(1);
  return rows[0]?.nseSymbol ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Download, extract and persist one discovered document. */
export async function ingestOneDocument(
  isin: string,
  d: DiscoveredDocument,
  opts: { force?: boolean } = {},
): Promise<IngestedDocument> {
  const t0 = Date.now();
  const base: IngestedDocument = {
    id: null,
    kind: d.kind,
    period: d.period,
    url: d.url,
    source: d.source,
    status: "failed",
    pages: null,
    chars: null,
    textQuality: null,
    turns: null,
    managementTurns: null,
    elapsedMs: 0,
    error: null,
  };

  const existing = (
    await db.select().from(documents).where(eq(documents.url, d.url)).limit(1)
  )[0];
  if (existing && existing.textStatus === "ok" && !opts.force) {
    const meta = (
      await db
        .select()
        .from(documentMeta)
        .where(eq(documentMeta.docId, existing.id))
        .limit(1)
    )[0];
    const structure = safeJson(meta?.structureJson) as {
      turns?: number;
      managementTurns?: number;
    } | null;
    return {
      ...base,
      id: existing.id,
      period: existing.period,
      status: "skipped",
      pages: existing.pages,
      chars: meta?.chars ?? null,
      textQuality: meta?.textQuality ?? null,
      turns: structure?.turns ?? null,
      managementTurns: structure?.managementTurns ?? null,
      elapsedMs: Date.now() - t0,
    };
  }

  try {
    const dl = await downloadPdf(d.url);
    const id = docIdForSha(dl.sha256);
    const sameContent = (
      await db
        .select({ id: documents.id, url: documents.url })
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1)
    )[0];
    if (sameContent && sameContent.url !== d.url && !opts.force) {
      log.info(
        { id, url: d.url, other: sameContent.url },
        "same PDF already stored under another URL",
      );
      return {
        ...base,
        id,
        status: "skipped",
        elapsedMs: Date.now() - t0,
        error: `duplicate content of ${sameContent.url}`,
      };
    }

    mkdirSync(DOCS_CACHE_DIR, { recursive: true });
    const file = join(DOCS_CACHE_DIR, `${dl.sha256}.pdf`);
    if (!existsSync(file)) writeFileSync(file, dl.bytes);

    const ex = await extractPdfPages(dl.bytes);
    const docText: DocumentText = {
      docId: id,
      pages: ex.pages.map((p) => ({ page: p.page, text: p.text })),
    };

    // transcript structure + period refinement from the cover page
    let period = d.period;
    let structure: Record<string, unknown> = {};
    if (d.kind === "transcript") {
      const parsed = parseTranscript(docText);
      const mgmt = parsed.turns.filter((t) => t.role === "management").length;
      structure = {
        layout: parsed.layout,
        turns: parsed.turns.length,
        managementTurns: mgmt,
        analystTurns: parsed.stats.analyst,
        moderatorTurns: parsed.stats.moderator,
        openingTurns: parsed.stats.openingTurns,
        qaTurns: parsed.stats.qaTurns,
        managementWords: parsed.stats.managementWords,
        bodyStartPage: parsed.bodyStartPage,
        callDate: parsed.callDate,
        roster: parsed.roster.slice(0, 40),
      };
      if (parsed.period) period = parsed.period;
    } else if (d.kind === "annual_report" && !period) {
      const m =
        /(?:annual report|integrated (annual )?report)[^\n]{0,40}?(20\d{2})\s*[-–]\s*(\d{2,4})/i.exec(
          docText.pages
            .slice(0, 3)
            .map((p) => p.text)
            .join("\n"),
        );
      if (m) period = `FY${(m[3] as string).slice(-2)}`;
    } else if (!period) {
      period = inferPeriodFromText(
        docText.pages
          .slice(0, 2)
          .map((p) => p.text)
          .join("\n"),
      );
    }

    const now = Date.now();
    const row = {
      id,
      isin,
      kind: d.kind,
      period,
      url: d.url,
      sha256: dl.sha256,
      pages: ex.pageCount,
      textRef: `data/cache/docs/${dl.sha256}.pdf`,
      announcementId: d.announcementId,
      fetchedAt: now,
      textStatus: "ok" as const,
    };
    if (existing) {
      // URL known (previous failure or forced refresh): replace the row and its pages
      await db
        .delete(documentPages)
        .where(eq(documentPages.docId, existing.id));
      await db.delete(documentMeta).where(eq(documentMeta.docId, existing.id));
      await db.delete(documents).where(eq(documents.id, existing.id));
    }
    if (sameContent && opts.force) {
      await db.delete(documentPages).where(eq(documentPages.docId, id));
      await db.delete(documentMeta).where(eq(documentMeta.docId, id));
      await db.delete(documents).where(eq(documents.id, id));
    }
    await db
      .insert(documents)
      .values(row)
      .onConflictDoUpdate({ target: documents.id, set: { ...row } });
    const pageRows = ex.pages.map((p) => ({
      docId: id,
      page: p.page,
      text: p.text,
      chars: p.chars,
    }));
    for (let i = 0; i < pageRows.length; i += 80) {
      await db
        .insert(documentPages)
        .values(pageRows.slice(i, i + 80))
        .onConflictDoNothing();
    }
    const metaRow = {
      docId: id,
      source: d.source,
      publishedAt: d.publishedAtMs,
      title: d.title,
      textQuality: ex.textQuality,
      chars: ex.chars,
      lowTextPages: ex.lowTextPages,
      spreads: ex.spreads,
      bytes: dl.bytes.byteLength,
      structureJson: JSON.stringify({
        ...structure,
        ocrPages: ex.ocrPages,
        finalUrl: dl.finalUrl,
        downloadMs: dl.elapsedMs,
        extractMs: ex.elapsedMs,
      }),
      updatedAt: now,
    };
    await db
      .insert(documentMeta)
      .values(metaRow)
      .onConflictDoUpdate({ target: documentMeta.docId, set: metaRow });

    log.info(
      {
        id,
        kind: d.kind,
        period,
        pages: ex.pageCount,
        chars: ex.chars,
        quality: ex.textQuality,
        ms: Date.now() - t0,
      },
      "document ingested",
    );
    return {
      ...base,
      id,
      period,
      status: existing || sameContent ? "updated" : "inserted",
      pages: ex.pageCount,
      chars: ex.chars,
      textQuality: ex.textQuality,
      turns: (structure.turns as number | undefined) ?? null,
      managementTurns:
        (structure.managementTurns as number | undefined) ?? null,
      elapsedMs: Date.now() - t0,
    };
  } catch (e) {
    const msg =
      e instanceof DownloadError
        ? `download: ${e.message}`
        : e instanceof Error
          ? e.message
          : String(e);
    log.warn({ url: d.url, err: msg }, "document ingest failed");
    // remember the failure (retried on the next run)
    const failedRow = {
      id:
        existing?.id ??
        `docfail_${Buffer.from(d.url).toString("base64url").slice(0, 40)}`,
      isin,
      kind: d.kind,
      period: d.period,
      url: d.url,
      sha256: null,
      pages: null,
      textRef: null,
      announcementId: d.announcementId,
      fetchedAt: Date.now(),
      textStatus: "failed" as const,
    };
    await db
      .insert(documents)
      .values(failedRow)
      .onConflictDoUpdate({
        target: documents.url,
        set: { textStatus: "failed", fetchedAt: failedRow.fetchedAt },
      })
      .catch(() => undefined);
    return {
      ...base,
      status: "failed",
      error: msg.slice(0, 300),
      elapsedMs: Date.now() - t0,
    };
  }
}

/** Discover, download and text-extract documents for a company (contract from ingest/index.ts). */
export async function ingestDocuments(
  isin: string,
  kinds: DocumentKind[],
  opts: IngestDocumentsOptions = {},
): Promise<IngestDocumentsResult> {
  const summary: IngestDocumentsResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    discovery: null,
    documents: [],
  };
  const symbol = opts.symbol ?? (await resolveSymbol(isin));
  if (!symbol) {
    summary.errors.push(`no NSE symbol for ISIN ${isin}`);
    return summary;
  }
  let list = opts.discovered;
  if (!list) {
    const disc = await discoverDocuments(symbol, isin, opts);
    summary.discovery = disc;
    summary.errors.push(...disc.errors);
    list = disc.documents;
  }
  const wanted = list.filter((d) => kinds.includes(d.kind));
  summary.fetched = wanted.length;
  for (const d of wanted) {
    opts.onProgress?.(`fetching ${d.kind} ${d.period ?? ""}`, { url: d.url });
    const r = await ingestOneDocument(isin, d, { force: opts.force });
    summary.documents.push(r);
    if (r.status === "inserted") summary.inserted++;
    else if (r.status === "updated") summary.updated++;
    else if (r.status === "skipped") summary.skipped++;
    else
      summary.errors.push(`${d.kind} ${d.period ?? ""} ${d.url}: ${r.error}`);
    if (
      r.status === "inserted" ||
      r.status === "updated" ||
      r.status === "failed"
    )
      await sleep(opts.pauseMs ?? 600);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Readers (used by extract/analyse and by the UI for citations)
// ---------------------------------------------------------------------------

function safeJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Full page text of a stored document (1-indexed pages), or null when unknown. */
export async function loadDocumentText(
  docId: string,
): Promise<DocumentText | null> {
  const rows = await db
    .select({ page: documentPages.page, text: documentPages.text })
    .from(documentPages)
    .where(eq(documentPages.docId, docId))
    .orderBy(asc(documentPages.page));
  if (!rows.length) return null;
  return { docId, pages: rows };
}

/** One page's text for a citation chip, or null. */
export async function loadPageText(
  docId: string,
  page: number,
): Promise<string | null> {
  const rows = await db
    .select({ text: documentPages.text })
    .from(documentPages)
    .where(and(eq(documentPages.docId, docId), eq(documentPages.page, page)))
    .limit(1);
  return rows[0]?.text ?? null;
}

/** Stored documents for a company (optionally by kind), newest period first, with meta. */
export async function listDocuments(isin: string, kinds?: DocumentKind[]) {
  const rows = await db
    .select()
    .from(documents)
    .where(
      kinds?.length
        ? and(eq(documents.isin, isin), inArray(documents.kind, kinds))
        : eq(documents.isin, isin),
    );
  const ids = rows.map((r) => r.id);
  const metas = ids.length
    ? await db
        .select()
        .from(documentMeta)
        .where(inArray(documentMeta.docId, ids))
    : [];
  const metaById = new Map(metas.map((m) => [m.docId, m]));
  return rows
    .map((r) => ({ ...r, meta: metaById.get(r.id) ?? null }))
    .sort(
      (a, b) =>
        periodSortKey(b.period).localeCompare(periodSortKey(a.period)) ||
        (b.meta?.publishedAt ?? 0) - (a.meta?.publishedAt ?? 0),
    );
}
