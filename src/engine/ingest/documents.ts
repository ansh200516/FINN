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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  companies,
  documentMeta,
  documentPages,
  documents,
  guidance,
  resultsQuarters,
} from "@/db/schema";
import { verifyQuote } from "@/engine/llm/verify";
import { logger } from "@/lib/logger";
import { extractPdfPages } from "../extract/pdf-text";
import {
  inferPeriodFromText,
  makePeriod,
  parsePeriodLabel,
  parseTranscript,
  periodForQuarterEnd,
  periodForTranscriptDate,
  periodSortKey,
  resolveTranscriptPeriod,
} from "../extract/transcript";
import {
  DownloadError,
  downloadPdf,
  isBseUrl,
  normaliseBseUrl,
} from "../sources/bse-docs";
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

/** screener.in is a third-party scrape: only consulted when FINN_ALLOW_SCREENER=true (or explicitly requested) */
export function screenerAllowed(): boolean {
  return (process.env.FINN_ALLOW_SCREENER ?? "").toLowerCase() === "true";
}

/** text_status values written by this module */
export type DocumentTextStatus =
  | "pending"
  | "ok"
  | "failed"
  | "duplicate"
  | "cover_only"
  | "not_transcript";

/** a transcript "PDF" that is really a covering letter: ≤ 2 pages or < 2,500 characters */
export const COVER_ONLY_MAX_PAGES = 2;
export const COVER_ONLY_MIN_CHARS = 2500;
/** near-identical text across sources: character count within 2 % */
export const DUPLICATE_CHARS_TOLERANCE = 0.02;

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

  // --- screener (secondary; opt-in via FINN_ALLOW_SCREENER=true or opts.useScreener) -----
  if (
    opts.useScreener === true ||
    (opts.useScreener !== false && screenerAllowed())
  ) {
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

export type IngestedStatus =
  | "inserted"
  | "updated"
  | "skipped"
  | "failed"
  | "duplicate"
  | "cover_only"
  | "not_transcript";

export interface IngestedDocument {
  id: string | null;
  kind: DocumentKind;
  period: string | null;
  url: string;
  source: DiscoveredDocument["source"];
  status: IngestedStatus;
  pages: number | null;
  chars: number | null;
  textQuality: string | null;
  turns: number | null;
  managementTurns: number | null;
  elapsedMs: number;
  error: string | null;
  /** period came from the publish date rather than the text (or they disagreed) */
  periodNote?: string | null;
  /** canonical document when `status` is duplicate */
  duplicateOf?: string | null;
  /** full transcript found behind a cover letter */
  recoveredDocId?: string | null;
}

export interface IngestDocumentsResult extends IngestSummary {
  discovery: DiscoveryResult | null;
  documents: IngestedDocument[];
}

export function docIdForSha(sha256: string): string {
  return `doc_${sha256.slice(0, 24)}`;
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 10);
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

function safeJson(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pure: is a transcript PDF really just the covering letter? */
export function isCoverLetterOnly(pageCount: number, chars: number): boolean {
  return pageCount <= COVER_ONLY_MAX_PAGES || chars < COVER_ONLY_MIN_CHARS;
}

/**
 * Pure: a short "transcript" with no management speech that talks about a
 * recording / webcast link is an intimation, not a transcript. Long documents
 * with no parsed turns are a parser-layout failure and stay `ok` (flagged by
 * `structure.layout === "unknown"`).
 */
export function isNotATranscript(
  parsed: { turns: Array<{ role: string }> },
  text: string,
  size: { pages: number; chars: number },
): boolean {
  const mgmt = parsed.turns.filter((t) => t.role === "management").length;
  if (mgmt > 0) return false;
  if (size.pages > 4 && size.chars >= 12_000) return false;
  return (
    parsed.turns.length < 3 ||
    /\b(audio|video)\s+recording|webcast|link (to|of) the recording|recording of the/i.test(
      text,
    )
  );
}

/** Pure: two documents of the same (isin, kind, period) are the same text when sizes agree within 2 %. */
export function isNearIdentical(
  a: { pages: number | null; chars: number | null },
  b: { pages: number | null; chars: number | null },
): boolean {
  if (a.pages !== null && b.pages !== null && a.pages !== b.pages) return false;
  if (a.chars === null || b.chars === null || a.chars === 0 || b.chars === 0)
    return a.pages !== null && b.pages !== null; // page counts agree, one side has no text
  return (
    Math.abs(a.chars - b.chars) / Math.max(a.chars, b.chars) <=
    DUPLICATE_CHARS_TOLERANCE
  );
}

/** Pure: URLs that look like a transcript PDF inside a covering letter. */
export function pdfUrlsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const u = m[0].replace(/[.,;:]+$/, "");
    if (/\.pdf(\?|$)/i.test(u) || /transcript/i.test(u)) out.push(u);
  }
  return [...new Set(out)];
}

interface StoredDoc {
  id: string;
  url: string;
  period: string | null;
  pages: number | null;
  textStatus: string;
  sha256: string | null;
  publishedAt: number | null;
  chars: number | null;
  createdAt: number;
}

async function storedTranscripts(
  isin: string,
  period: string | null,
): Promise<StoredDoc[]> {
  if (!period) return [];
  const rows = await db
    .select({
      id: documents.id,
      url: documents.url,
      period: documents.period,
      pages: documents.pages,
      textStatus: documents.textStatus,
      sha256: documents.sha256,
      createdAt: documents.createdAt,
      publishedAt: documentMeta.publishedAt,
      chars: documentMeta.chars,
    })
    .from(documents)
    .leftJoin(documentMeta, eq(documentMeta.docId, documents.id))
    .where(
      and(
        eq(documents.isin, isin),
        eq(documents.kind, "transcript"),
        eq(documents.period, period),
        eq(documents.textStatus, "ok"),
      ),
    );
  return rows;
}

/** Mark `dupId` as a duplicate of `canonicalId` (status + pointer); its pages are dropped. */
export async function markDuplicate(
  dupId: string,
  canonicalId: string,
): Promise<void> {
  await db
    .update(documents)
    .set({ textStatus: "duplicate" })
    .where(eq(documents.id, dupId));
  const metaRow = (
    await db
      .select({ docId: documentMeta.docId })
      .from(documentMeta)
      .where(eq(documentMeta.docId, dupId))
      .limit(1)
  )[0];
  if (metaRow)
    await db
      .update(documentMeta)
      .set({ duplicateOf: canonicalId, updatedAt: Date.now() })
      .where(eq(documentMeta.docId, dupId));
  else
    await db
      .insert(documentMeta)
      .values({
        docId: dupId,
        source: "nse",
        duplicateOf: canonicalId,
        textQuality: "ok",
        chars: 0,
        lowTextPages: 0,
        spreads: false,
        bytes: null,
        structureJson: "{}",
        updatedAt: Date.now(),
      })
      .onConflictDoNothing();
  await db.delete(documentPages).where(eq(documentPages.docId, dupId));
}

/**
 * Move guidance rows from a duplicate document onto its canonical copy. A row
 * moves only when its quote verifies verbatim against the canonical page text
 * (page re-derived); exact-quote duplicates and unverifiable quotes are deleted.
 */
export async function migrateGuidanceToCanonical(
  dupId: string,
  canonicalId: string,
): Promise<{ moved: number; deleted: number }> {
  const rows = await db
    .select()
    .from(guidance)
    .where(eq(guidance.docId, dupId));
  if (!rows.length) return { moved: 0, deleted: 0 };
  const canon = await loadDocumentText(canonicalId);
  const existing = await db
    .select({ quote: guidance.quote, metric: guidance.metric })
    .from(guidance)
    .where(eq(guidance.docId, canonicalId));
  const have = new Set(
    existing.map(
      (e) => `${e.metric}|${e.quote.toLowerCase().replace(/\s+/g, " ").trim()}`,
    ),
  );
  let moved = 0;
  let deleted = 0;
  for (const r of rows) {
    const key = `${r.metric}|${r.quote.toLowerCase().replace(/\s+/g, " ").trim()}`;
    let page: number | null = null;
    if (canon && !have.has(key)) {
      for (const p of canon.pages) {
        if (verifyQuote(r.quote, p.text) !== null) {
          page = p.page;
          break;
        }
      }
    }
    if (page !== null) {
      const ev = safeJson(r.evidenceJson);
      await db
        .update(guidance)
        .set({
          docId: canonicalId,
          page,
          evidenceJson: JSON.stringify({ ...ev, movedFrom: dupId }),
        })
        .where(eq(guidance.id, r.id));
      have.add(key);
      moved++;
    } else {
      await db.delete(guidance).where(eq(guidance.id, r.id));
      deleted++;
    }
  }
  return { moved, deleted };
}

/** Load the canonical / duplicate / etc. status of a URL without downloading. */
async function existingByUrl(url: string) {
  return (
    await db.select().from(documents).where(eq(documents.url, url)).limit(1)
  )[0];
}

async function writeFailure(
  isin: string,
  d: DiscoveredDocument,
  existingId: string | undefined,
): Promise<void> {
  const failedRow = {
    id: existingId ?? `docfail_${shortHash(d.url)}`,
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
}

/**
 * Try to find the real transcript behind a covering letter: (a) a PDF link in
 * the letter, (b) screener's transcript link for the same quarter (opt-in).
 * BSE's attachment API is TLS-fingerprinted and not available here.
 */
async function recoverFromCoverLetter(
  isin: string,
  symbol: string | null,
  d: DiscoveredDocument,
  period: string | null,
  text: string,
  opts: { force?: boolean; depth: number },
): Promise<IngestedDocument | null> {
  if (opts.depth > 0) return null; // never recurse through a recovered document
  const tried = new Set<string>([d.url]);
  const candidates: Array<{
    url: string;
    source: DiscoveredDocument["source"];
  }> = [];
  for (const u of pdfUrlsInText(text).slice(0, 3))
    candidates.push({ url: u, source: "ir" });
  if (symbol && screenerAllowed()) {
    try {
      const parsed = parseScreenerDocuments(
        await fetchScreenerCompanyHtml(symbol),
      );
      for (const c of parsed.concalls) {
        if (!c.transcript) continue;
        if (period && periodForTranscriptDate(c.monthMs) !== period) continue;
        const url = normaliseBseUrl(c.transcript);
        candidates.push({ url, source: isBseUrl(url) ? "screener" : "ir" });
      }
    } catch (e) {
      log.info(
        { symbol, err: e instanceof Error ? e.message : String(e) },
        "screener lookup for cover-letter recovery failed",
      );
    }
  }
  for (const c of candidates) {
    if (tried.has(c.url)) continue;
    tried.add(c.url);
    const r = await ingestOneDocument(
      isin,
      {
        ...d,
        url: c.url,
        source: c.source,
        title: `${d.title ?? "transcript"} (recovered from cover letter)`,
      },
      { force: opts.force, symbol, depth: opts.depth + 1 },
    );
    if (
      (r.status === "inserted" ||
        r.status === "updated" ||
        r.status === "skipped") &&
      r.id &&
      (r.chars ?? 0) >= COVER_ONLY_MIN_CHARS
    )
      return r;
  }
  return null;
}

/** Download, extract, classify and persist one discovered document. */
export async function ingestOneDocument(
  isin: string,
  d: DiscoveredDocument,
  opts: { force?: boolean; symbol?: string | null; depth?: number } = {},
): Promise<IngestedDocument> {
  const t0 = Date.now();
  const depth = opts.depth ?? 0;
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

  const existing = await existingByUrl(d.url);
  if (
    existing &&
    existing.textStatus !== "failed" &&
    existing.textStatus !== "pending" &&
    !opts.force
  ) {
    const meta = (
      await db
        .select()
        .from(documentMeta)
        .where(eq(documentMeta.docId, existing.id))
        .limit(1)
    )[0];
    const structure = safeJson(meta?.structureJson);
    const st = existing.textStatus;
    return {
      ...base,
      id: existing.id,
      period: existing.period,
      status: st === "ok" ? "skipped" : (st as IngestedStatus),
      pages: existing.pages,
      chars: meta?.chars ?? null,
      textQuality: meta?.textQuality ?? null,
      turns: (structure.turns as number | undefined) ?? null,
      managementTurns:
        (structure.managementTurns as number | undefined) ?? null,
      duplicateOf: meta?.duplicateOf ?? null,
      recoveredDocId: (structure.recoveredDocId as string | undefined) ?? null,
      elapsedMs: Date.now() - t0,
    };
  }

  try {
    const dl = await downloadPdf(d.url);
    const id = docIdForSha(dl.sha256);

    // --- duplicate by content hash (same PDF filed on NSE and BSE) --------------------
    const sameContent = (
      await db
        .select({
          id: documents.id,
          url: documents.url,
          textStatus: documents.textStatus,
        })
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1)
    )[0];
    if (sameContent && sameContent.url !== d.url && !opts.force) {
      const dupId = `dup_${dl.sha256.slice(0, 16)}_${shortHash(d.url)}`;
      const now = Date.now();
      await db
        .insert(documents)
        .values({
          id: dupId,
          isin,
          kind: d.kind,
          period: d.period,
          url: d.url,
          sha256: dl.sha256,
          pages: null,
          textRef: `data/cache/docs/${dl.sha256}.pdf`,
          announcementId: d.announcementId,
          fetchedAt: now,
          textStatus: "duplicate",
        })
        .onConflictDoUpdate({
          target: documents.url,
          set: { textStatus: "duplicate", fetchedAt: now },
        });
      await markDuplicate(dupId, sameContent.id);
      log.info(
        { id: dupId, url: d.url, canonical: sameContent.id },
        "same PDF already stored under another URL",
      );
      return {
        ...base,
        id: dupId,
        status: "duplicate",
        duplicateOf: sameContent.id,
        elapsedMs: Date.now() - t0,
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

    // --- classify + period ----------------------------------------------------------------
    let period = d.period;
    let textStatus: DocumentTextStatus = "ok";
    let periodNote: string | null = null;
    let structure: Record<string, unknown> = {};
    let recoveredDocId: string | null = null;
    let duplicateOf: string | null = null;

    if (d.kind === "transcript") {
      const parsed = parseTranscript(docText);
      const mgmt = parsed.turns.filter((t) => t.role === "management").length;
      const resolved = resolveTranscriptPeriod(parsed.period, d.publishedAtMs);
      period = resolved.period ?? d.period;
      if (resolved.warning) {
        periodNote = resolved.warning;
        log.warn(
          { id, url: d.url, ...resolved },
          "transcript period reconciled",
        );
      }
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
        textPeriod: parsed.period,
        periodSource: resolved.source,
        periodWarning: resolved.warning,
        roster: parsed.roster.slice(0, 40),
      };
      const fullText = docText.pages.map((p) => p.text).join("\n");
      if (isCoverLetterOnly(ex.pageCount, ex.chars)) {
        textStatus = "cover_only";
        const symbol = opts.symbol ?? (await resolveSymbol(isin));
        const rec = await recoverFromCoverLetter(
          isin,
          symbol,
          d,
          period,
          fullText,
          { force: opts.force, depth },
        );
        if (rec?.id) recoveredDocId = rec.id;
        structure.recoveredDocId = recoveredDocId;
      } else if (
        isNotATranscript(parsed, fullText.slice(0, 6000), {
          pages: ex.pageCount,
          chars: ex.chars,
        })
      ) {
        textStatus = "not_transcript";
      } else if (period) {
        // --- same (isin, kind, period) already stored? ------------------------------------
        const clashes = (await storedTranscripts(isin, period)).filter(
          (c) => c.id !== id && c.url !== d.url,
        );
        for (const c of clashes) {
          if (
            c.sha256 === dl.sha256 ||
            isNearIdentical(c, { pages: ex.pageCount, chars: ex.chars })
          ) {
            // canonical = the copy with a publish date; else the one already stored
            const newIsCanonical =
              d.publishedAtMs !== null && c.publishedAt === null;
            if (newIsCanonical) {
              await markDuplicate(c.id, id);
              structure.supersedesDuplicate = c.id;
              log.info(
                { id, replaced: c.id, period },
                "earlier copy without publish date marked duplicate",
              );
            } else {
              textStatus = "duplicate";
              duplicateOf = c.id;
            }
            break;
          }
          // genuinely different documents in one quarter (results call + another event):
          // keep both; the older one is re-labelled from its publish date when that differs
          const olderIsNew =
            d.publishedAtMs !== null &&
            c.publishedAt !== null &&
            d.publishedAtMs < c.publishedAt;
          if (olderIsNew) {
            const dateLabel = periodForTranscriptDate(
              d.publishedAtMs as number,
            );
            if (dateLabel !== period) {
              periodNote = `${periodNote ? `${periodNote}; ` : ""}period collision with ${c.id}: relabelled from publish date to ${dateLabel}`;
              period = dateLabel;
            } else
              periodNote = `${periodNote ? `${periodNote}; ` : ""}shares period ${period} with ${c.id} (kept both)`;
          } else if (c.publishedAt !== null) {
            const dateLabel = periodForTranscriptDate(c.publishedAt);
            if (dateLabel !== period) {
              await db
                .update(documents)
                .set({ period: dateLabel })
                .where(eq(documents.id, c.id));
              log.warn(
                { id: c.id, from: period, to: dateLabel },
                "older transcript relabelled from publish date (period collision)",
              );
            } else
              log.warn(
                { id, other: c.id, period },
                "two transcripts share one period; keeping both",
              );
          }
          structure.periodWarning = periodNote;
        }
      }
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

    // --- persist --------------------------------------------------------------------------
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
      textStatus,
    };
    if (existing) {
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
    if (textStatus !== "duplicate") {
      const pageRows = ex.pages.map((p) => ({
        docId: id,
        page: p.page,
        text: p.text,
        chars: p.chars,
      }));
      for (let i = 0; i < pageRows.length; i += 80)
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
      duplicateOf,
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
        status: textStatus,
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
      status:
        textStatus === "ok"
          ? existing || sameContent
            ? "updated"
            : "inserted"
          : textStatus,
      pages: ex.pageCount,
      chars: ex.chars,
      textQuality: ex.textQuality,
      turns: (structure.turns as number | undefined) ?? null,
      managementTurns:
        (structure.managementTurns as number | undefined) ?? null,
      periodNote,
      duplicateOf,
      recoveredDocId,
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
    await writeFailure(isin, d, existing?.id);
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
    const r = await ingestOneDocument(isin, d, { force: opts.force, symbol });
    summary.documents.push(r);
    if (r.status === "inserted") summary.inserted++;
    else if (r.status === "updated") summary.updated++;
    else if (r.status === "skipped") summary.skipped++;
    else if (r.status === "failed")
      summary.errors.push(`${d.kind} ${d.period ?? ""} ${d.url}: ${r.error}`);
    else summary.skipped++; // duplicate / cover_only / not_transcript are recorded, not errors
    if (r.status !== "skipped") await sleep(opts.pauseMs ?? 600);
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Maintenance: relabel periods, de-duplicate stored documents
// ---------------------------------------------------------------------------

export interface RelabelChange {
  docId: string;
  isin: string;
  symbol: string | null;
  url: string;
  from: string | null;
  to: string | null;
  reason: string;
}

/**
 * Recompute every stored transcript's period from (publish date, text) with
 * `resolveTranscriptPeriod`, then resolve same-period collisions per company.
 * Returns every change made (dry-run with `write: false`).
 */
export async function relabelTranscriptPeriods(
  opts: { isins?: string[]; write?: boolean } = {},
): Promise<RelabelChange[]> {
  const changes: RelabelChange[] = [];
  const rows = await db
    .select({
      id: documents.id,
      isin: documents.isin,
      url: documents.url,
      period: documents.period,
      pages: documents.pages,
      textStatus: documents.textStatus,
      sha256: documents.sha256,
      createdAt: documents.createdAt,
      publishedAt: documentMeta.publishedAt,
      chars: documentMeta.chars,
      structureJson: documentMeta.structureJson,
    })
    .from(documents)
    .leftJoin(documentMeta, eq(documentMeta.docId, documents.id))
    .where(
      opts.isins?.length
        ? and(
            eq(documents.kind, "transcript"),
            inArray(documents.isin, opts.isins),
          )
        : eq(documents.kind, "transcript"),
    );
  const symbols = new Map(
    (
      await db
        .select({ isin: companies.isin, s: companies.nseSymbol })
        .from(companies)
    ).map((c) => [c.isin, c.s]),
  );
  const current = new Map<string, string | null>();
  for (const r of rows) {
    current.set(r.id, r.period);
    if (r.textStatus !== "ok" && r.textStatus !== "cover_only") continue;
    const doc = await loadDocumentText(r.id);
    if (!doc) continue;
    const parsed = parseTranscript(doc);
    const resolved = resolveTranscriptPeriod(parsed.period, r.publishedAt);
    const to = resolved.period ?? r.period;
    if (to && to !== r.period) {
      changes.push({
        docId: r.id,
        isin: r.isin,
        symbol: symbols.get(r.isin) ?? null,
        url: r.url,
        from: r.period,
        to,
        reason:
          resolved.warning ??
          `text period ${parsed.period ?? "—"} (publish date → ${r.publishedAt ? periodForTranscriptDate(r.publishedAt) : "—"})`,
      });
      current.set(r.id, to);
      if (opts.write !== false) {
        await db
          .update(documents)
          .set({ period: to })
          .where(eq(documents.id, r.id));
        const structure = safeJson(r.structureJson);
        await db
          .update(documentMeta)
          .set({
            structureJson: JSON.stringify({
              ...structure,
              textPeriod: parsed.period,
              periodSource: resolved.source,
              periodWarning: resolved.warning,
              callDate: parsed.callDate ?? structure.callDate,
            }),
            updatedAt: Date.now(),
          })
          .where(eq(documentMeta.docId, r.id))
          .catch(() => undefined);
      }
    }
  }
  // collisions: two `ok` transcripts of one company with the same period
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.textStatus !== "ok") continue;
    const k = `${r.isin}|${current.get(r.id) ?? ""}`;
    const g = byKey.get(k) ?? [];
    g.push(r);
    byKey.set(k, g);
  }
  for (const [k, g] of byKey) {
    if (g.length < 2) continue;
    const period = k.split("|")[1] ?? null;
    const sorted = [...g].sort(
      (a, b) =>
        (a.publishedAt ?? Number.MAX_SAFE_INTEGER) -
        (b.publishedAt ?? Number.MAX_SAFE_INTEGER),
    );
    const newest = sorted[sorted.length - 1] as (typeof rows)[number];
    for (const older of sorted.slice(0, -1)) {
      if (older.sha256 && older.sha256 === newest.sha256) continue; // handled by dedupe
      if (isNearIdentical(older, newest)) continue; // handled by dedupe
      const dateLabel =
        older.publishedAt !== null
          ? periodForTranscriptDate(older.publishedAt)
          : null;
      if (dateLabel && dateLabel !== period) {
        changes.push({
          docId: older.id,
          isin: older.isin,
          symbol: symbols.get(older.isin) ?? null,
          url: older.url,
          from: period,
          to: dateLabel,
          reason: `period collision with ${newest.id}; older copy relabelled from its publish date`,
        });
        if (opts.write !== false)
          await db
            .update(documents)
            .set({ period: dateLabel })
            .where(eq(documents.id, older.id));
      } else {
        changes.push({
          docId: older.id,
          isin: older.isin,
          symbol: symbols.get(older.isin) ?? null,
          url: older.url,
          from: period,
          to: period,
          reason: `shares period ${period} with ${newest.id} (two different documents; both kept)`,
        });
      }
    }
  }
  return changes;
}

export interface DedupeChange {
  isin: string;
  symbol: string | null;
  period: string | null;
  duplicateId: string;
  canonicalId: string;
  reason: string;
  guidanceMoved: number;
  guidanceDeleted: number;
}

/**
 * Backfill: find stored documents of one (isin, kind, period) that are the same
 * text (sha256, or page count + chars within 2 %, or a row with no stored text
 * and the same page count), mark the non-canonical ones `duplicate` and migrate
 * their guidance rows. Canonical = has a publish date > has a sha256 > oldest.
 */
export async function dedupeStoredDocuments(
  opts: { isins?: string[]; write?: boolean } = {},
): Promise<DedupeChange[]> {
  const changes: DedupeChange[] = [];
  const rows = await db
    .select({
      id: documents.id,
      isin: documents.isin,
      kind: documents.kind,
      period: documents.period,
      pages: documents.pages,
      textStatus: documents.textStatus,
      sha256: documents.sha256,
      createdAt: documents.createdAt,
      publishedAt: documentMeta.publishedAt,
      chars: documentMeta.chars,
    })
    .from(documents)
    .leftJoin(documentMeta, eq(documentMeta.docId, documents.id))
    .where(
      opts.isins?.length ? inArray(documents.isin, opts.isins) : undefined,
    );
  const symbols = new Map(
    (
      await db
        .select({ isin: companies.isin, s: companies.nseSymbol })
        .from(companies)
    ).map((c) => [c.isin, c.s]),
  );
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (
      r.textStatus !== "ok" ||
      (r.kind !== "transcript" && r.kind !== "annual_report")
    )
      continue;
    const k = `${r.isin}|${r.kind}|${r.period ?? r.sha256 ?? r.id}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const rank = (r: (typeof rows)[number]) =>
    (r.publishedAt !== null ? 2 : 0) + (r.sha256 ? 1 : 0);
  for (const [, g] of groups) {
    if (g.length < 2) continue;
    const sorted = [...g].sort(
      (a, b) => rank(b) - rank(a) || a.createdAt - b.createdAt,
    );
    const canonical = sorted[0] as (typeof rows)[number];
    for (const dup of sorted.slice(1)) {
      const sameSha = !!dup.sha256 && dup.sha256 === canonical.sha256;
      if (!sameSha && !isNearIdentical(dup, canonical)) continue;
      const reason = sameSha
        ? "same sha256"
        : dup.chars
          ? `same pages, chars within ${Math.round(DUPLICATE_CHARS_TOLERANCE * 100)}%`
          : "same page count, no stored text";
      let moved = 0;
      let deleted = 0;
      if (opts.write !== false) {
        const mg = await migrateGuidanceToCanonical(dup.id, canonical.id);
        moved = mg.moved;
        deleted = mg.deleted;
        await markDuplicate(dup.id, canonical.id);
      }
      changes.push({
        isin: dup.isin,
        symbol: symbols.get(dup.isin) ?? null,
        period: dup.period,
        duplicateId: dup.id,
        canonicalId: canonical.id,
        reason,
        guidanceMoved: moved,
        guidanceDeleted: deleted,
      });
    }
  }
  return changes;
}

export interface ReclassifyChange {
  docId: string;
  isin: string;
  symbol: string | null;
  period: string | null;
  from: string;
  to: "cover_only" | "not_transcript" | "ok";
  recoveredDocId: string | null;
  note: string;
}

/**
 * Backfill for Bug 3: stored `ok` transcripts that are really covering letters
 * (≤ 2 pages or < 2,500 chars) become `cover_only` (with a recovery attempt),
 * and recording/webcast intimations with no management speech become
 * `not_transcript`.
 */
export async function reclassifyTranscripts(
  opts: { isins?: string[]; write?: boolean } = {},
): Promise<ReclassifyChange[]> {
  const changes: ReclassifyChange[] = [];
  const rows = await db
    .select({
      id: documents.id,
      isin: documents.isin,
      url: documents.url,
      period: documents.period,
      pages: documents.pages,
      textStatus: documents.textStatus,
      announcementId: documents.announcementId,
      source: documentMeta.source,
      publishedAt: documentMeta.publishedAt,
      title: documentMeta.title,
      chars: documentMeta.chars,
      structureJson: documentMeta.structureJson,
    })
    .from(documents)
    .leftJoin(documentMeta, eq(documentMeta.docId, documents.id))
    .where(
      and(
        eq(documents.kind, "transcript"),
        inArray(documents.textStatus, ["ok", "not_transcript", "cover_only"]),
        opts.isins?.length ? inArray(documents.isin, opts.isins) : undefined,
      ),
    );
  const symbols = new Map(
    (
      await db
        .select({ isin: companies.isin, s: companies.nseSymbol })
        .from(companies)
    ).map((c) => [c.isin, c.s]),
  );
  for (const r of rows) {
    const doc = await loadDocumentText(r.id);
    if (!doc) continue;
    const chars =
      r.chars ??
      doc.pages.reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0);
    const fullText = doc.pages.map((p) => p.text).join("\n");
    let to: "cover_only" | "not_transcript" | "ok" | null = null;
    let note = "";
    if (isCoverLetterOnly(doc.pages.length, chars)) {
      to = r.textStatus === "cover_only" ? null : "cover_only";
      note = `${doc.pages.length} page(s), ${chars} chars`;
    } else {
      const parsed = parseTranscript(doc);
      if (
        isNotATranscript(parsed, fullText.slice(0, 6000), {
          pages: doc.pages.length,
          chars,
        })
      ) {
        to = r.textStatus === "not_transcript" ? null : "not_transcript";
        note = `${parsed.turns.length} turns, 0 management turns`;
      } else if (r.textStatus !== "ok") {
        // an earlier, stricter pass mis-flagged a real transcript: restore it
        to = "ok";
        note = `${parsed.turns.length} turns, ${parsed.turns.filter((t) => t.role === "management").length} management turns — restored`;
      }
    }
    if (!to) continue;
    let recoveredDocId: string | null = null;
    if (opts.write !== false) {
      if (to === "cover_only") {
        const d: DiscoveredDocument = {
          kind: "transcript",
          period: r.period,
          url: r.url,
          source: (r.source as DiscoveredDocument["source"] | null) ?? "nse",
          publishedAtMs: r.publishedAt,
          title: r.title,
          announcementId: r.announcementId,
        };
        const rec = await recoverFromCoverLetter(
          r.isin,
          symbols.get(r.isin) ?? null,
          d,
          r.period,
          fullText,
          { depth: 0 },
        );
        recoveredDocId = rec?.id ?? null;
      }
      await db
        .update(documents)
        .set({ textStatus: to })
        .where(eq(documents.id, r.id));
      const structure = safeJson(r.structureJson);
      await db
        .update(documentMeta)
        .set({
          structureJson: JSON.stringify({
            ...structure,
            recoveredDocId,
            reclassified: to,
          }),
          updatedAt: Date.now(),
        })
        .where(eq(documentMeta.docId, r.id))
        .catch(() => undefined);
    }
    changes.push({
      docId: r.id,
      isin: r.isin,
      symbol: symbols.get(r.isin) ?? null,
      period: r.period,
      from: r.textStatus,
      to,
      recoveredDocId,
      note,
    });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Readers (used by extract/analyse and by the UI for citations)
// ---------------------------------------------------------------------------

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

export interface ListDocumentsOptions {
  /** include rows marked `duplicate` (default false) */
  includeDuplicates?: boolean;
}

/**
 * Stored documents for a company (optionally by kind), newest period first, with
 * meta. Duplicates are hidden by default; `cover_only` / `not_transcript` /
 * `failed` rows are returned so the UI can explain them (`textStatus`,
 * `meta.structureJson.recoveredDocId`).
 */
export async function listDocuments(
  isin: string,
  kinds?: DocumentKind[],
  opts: ListDocumentsOptions = {},
) {
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
    .filter((r) => opts.includeDuplicates || r.textStatus !== "duplicate")
    .map((r) => ({ ...r, meta: metaById.get(r.id) ?? null }))
    .sort(
      (a, b) =>
        periodSortKey(b.period).localeCompare(periodSortKey(a.period)) ||
        (b.meta?.publishedAt ?? 0) - (a.meta?.publishedAt ?? 0),
    );
}

/**
 * Transcript coverage for the latest reported quarter. When results are filed
 * but no usable transcript exists yet, `pending` carries the SEBI expectation
 * (transcript within 5 working days of the call; calls follow results by a few
 * days → results filing + 10 calendar days). Companies that never hold calls
 * (no transcript in six quarters, expectation long past) get `holdsConcalls=false`
 * and no pending marker.
 */
export async function transcriptCoverage(
  isin: string,
  now = Date.now(),
): Promise<{
  latestResultsPeriod: string | null;
  latestResultsFiledAt: number | null;
  latestTranscriptPeriod: string | null;
  holdsConcalls: boolean;
  coverOnlyPeriods: string[];
  pending: {
    period: string;
    resultsFiledAt: number | null;
    expectedBy: number | null;
  } | null;
}> {
  const q = await db
    .select({
      periodEnd: resultsQuarters.periodEnd,
      filedAt: resultsQuarters.filedAt,
    })
    .from(resultsQuarters)
    .where(eq(resultsQuarters.isin, isin));
  const latestQ =
    q.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0] ?? null;
  const latestResultsPeriod = latestQ
    ? periodForQuarterEnd(latestQ.periodEnd)
    : null;
  const docs = await listDocuments(isin, ["transcript"]);
  const ok = docs.filter((d) => d.textStatus === "ok");
  const coverOnly = docs.filter(
    (d) =>
      d.textStatus === "cover_only" &&
      !safeJson(d.meta?.structureJson).recoveredDocId,
  );
  const latestTranscriptPeriod = ok[0]?.period ?? null;
  const holdsConcalls = ok.length > 0 || coverOnly.length > 0;
  let pending: {
    period: string;
    resultsFiledAt: number | null;
    expectedBy: number | null;
  } | null = null;
  if (
    latestResultsPeriod &&
    !ok.some((d) => d.period === latestResultsPeriod)
  ) {
    const filedAt = latestQ?.filedAt ?? null;
    const expectedBy = filedAt !== null ? filedAt + 10 * 86_400_000 : null;
    // a long-overdue expectation for a company with no calls on record is not "pending"
    const stale = expectedBy !== null && expectedBy < now - 45 * 86_400_000;
    if (holdsConcalls || !stale)
      pending = {
        period: latestResultsPeriod,
        resultsFiledAt: filedAt,
        expectedBy,
      };
  }
  return {
    latestResultsPeriod,
    latestResultsFiledAt: latestQ?.filedAt ?? null,
    latestTranscriptPeriod,
    holdsConcalls,
    coverOnlyPeriods: coverOnly.map((d) => d.period ?? "?"),
    pending,
  };
}
