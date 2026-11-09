/**
 * Read path for the company-page pull menu. Stored pages and XBRL rows only.
 */
import { and, count, eq, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  documentPages,
  documents,
  guidance,
  resultsQuarters,
} from "@/db/schema";
import {
  clipQuote,
  composePull,
  HEADLINE_METRICS,
  type PullBlock,
  type PullGuide,
  type PullPage,
  type PullQuarter,
} from "@/lib/pull";

const NEEDLES = [
  "dear shareholder",
  "message from the chairman",
  "letter from the managing director",
  "chairman's",
  "chairman’s",
  "management discussion",
  "directors report",
  "director's report",
  "directors' report",
  "board of directors",
  "board's report",
  "board’s report",
  "key financial ratio",
  "debt-equity",
  "debt equity",
  "debt to equity",
  "operating profit margin",
  "operating margin",
  "current ratio",
  "operating activities",
  "cash generated from operations",
  "revenue from operations",
  "segment revenue",
  "debt-free",
  "negligible debt",
  "balance sheet as at",
  "profit for the year",
  "profit after tax",
  "net profit",
  "financial highlights",
];

function ebitdaOf(r: {
  pbeit: number | null;
  pbt: number | null;
  financeCosts: number | null;
  dna: number | null;
  otherIncome: number | null;
}): number | null {
  const base = r.pbeit ?? r.pbt;
  if (base == null || r.financeCosts == null || r.dna == null) return null;
  return base + r.financeCosts + r.dna - (r.otherIncome ?? 0);
}

function bankLines(json: string): { nii: number | null; ppop: number | null } {
  try {
    const v = JSON.parse(json) as { nii?: unknown; ppop?: unknown };
    return {
      nii: typeof v.nii === "number" ? v.nii : null,
      ppop: typeof v.ppop === "number" ? v.ppop : null,
    };
  } catch {
    return { nii: null, ppop: null };
  }
}

function guideRank(g: {
  metric: string;
  low: number | null;
  high: number | null;
  status: string;
}): number {
  const pri = (HEADLINE_METRICS as readonly string[]).indexOf(g.metric);
  return (
    (pri < 0 ? 40 : pri) +
    (g.low == null && g.high == null ? 12 : 0) +
    (g.status === "open" ? 0 : 3)
  );
}

const PULL_CACHE_MS = 5 * 60_000;
type PullCache = Map<string, { at: number; blocks: PullBlock[] }>;
const pullCache = globalThis as { __finnPull?: PullCache };

function cachedPull(): PullCache {
  if (!pullCache.__finnPull) pullCache.__finnPull = new Map();
  return pullCache.__finnPull;
}

export async function loadPullMenu(args: {
  isin: string;
  isBank: boolean;
}): Promise<PullBlock[]> {
  const key = `${args.isin}:${args.isBank ? 1 : 0}`;
  const hit = cachedPull().get(key);
  if (hit && Date.now() - hit.at < PULL_CACHE_MS) return hit.blocks;

  const needle = or(
    ...NEEDLES.map((n) => sql`lower(${documentPages.text}) like ${`%${n}%`}`),
  );
  const [pageRows, quarterRows, guideRows, callRows] = await Promise.all([
    db
      .select({
        page: documentPages.page,
        text: documentPages.text,
        docId: documents.id,
        period: documents.period,
        url: documents.url,
      })
      .from(documentPages)
      .innerJoin(documents, eq(documentPages.docId, documents.id))
      .where(
        and(
          eq(documents.isin, args.isin),
          eq(documents.kind, "annual_report"),
          eq(documents.textStatus, "ok"),
          needle,
        ),
      ),
    db
      .select()
      .from(resultsQuarters)
      .where(eq(resultsQuarters.isin, args.isin))
      .orderBy(resultsQuarters.periodEnd),
    db
      .select({
        metric: guidance.metric,
        low: guidance.low,
        high: guidance.high,
        unit: guidance.unit,
        horizon: guidance.horizon,
        status: guidance.status,
        page: guidance.page,
        quote: guidance.quote,
        docId: guidance.docId,
        url: documents.url,
        docKind: documents.kind,
        period: documents.period,
      })
      .from(guidance)
      .innerJoin(documents, eq(guidance.docId, documents.id))
      .where(
        and(
          eq(guidance.isin, args.isin),
          or(eq(guidance.status, "open"), eq(guidance.status, "settled")),
        ),
      ),
    db
      .select({ n: count() })
      .from(documents)
      .where(
        and(
          eq(documents.isin, args.isin),
          eq(documents.kind, "transcript"),
          eq(documents.textStatus, "ok"),
        ),
      ),
  ]);

  const latestPeriod = pageRows.reduce<string | null>(
    (best, row) => ((row.period ?? "") > (best ?? "") ? row.period : best),
    null,
  );
  const chosen = pageRows.filter((row) => row.period === latestPeriod);
  const doc = chosen[0];
  const pages: PullPage[] = chosen
    .slice()
    .sort((a, b) => a.page - b.page)
    .map((p) => ({ page: p.page, text: p.text }));
  const have = new Map<string, string>();
  if (doc) {
    for (const p of pages) have.set(pageKey(doc.docId, p.page), p.text);
  }

  const candidates = guideRows
    .filter(
      (g) =>
        (HEADLINE_METRICS as readonly string[]).includes(g.metric) &&
        g.page != null,
    )
    .sort((a, b) => guideRank(a) - guideRank(b));
  const wanted: typeof candidates = [];
  const seen = new Set<string>();
  for (const g of candidates) {
    const key = `${g.metric}|${g.horizon ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(g);
    if (wanted.length >= 8) break;
  }
  const extraNeed = wanted.filter(
    (g) => g.page != null && !have.has(pageKey(g.docId, g.page)),
  );
  if (extraNeed.length) {
    const extra = await db
      .select({
        docId: documentPages.docId,
        page: documentPages.page,
        text: documentPages.text,
      })
      .from(documentPages)
      .where(
        or(
          ...extraNeed.map((g) =>
            and(
              eq(documentPages.docId, g.docId),
              eq(documentPages.page, g.page ?? -1),
            ),
          ),
        ),
      );
    for (const row of extra) have.set(pageKey(row.docId, row.page), row.text);
  }

  const guides: PullGuide[] = [];
  const usedMetric = new Set<string>();
  for (const g of wanted) {
    if (guides.length >= 4 || usedMetric.has(g.metric)) continue;
    if (g.page == null) continue;
    const source = have.get(pageKey(g.docId, g.page));
    if (!source) continue;
    const quote = clipQuote(g.quote, source);
    if (!quote) continue;
    usedMetric.add(g.metric);
    guides.push({
      metric: g.metric,
      low: g.low,
      high: g.high,
      unit: g.unit,
      horizon: g.horizon,
      status: g.status,
      page: g.page,
      quote,
      url: g.url,
      docKind: g.docKind,
      period: g.period,
    });
  }

  const quarters: PullQuarter[] = quarterRows.map((r) => {
    const bank = bankLines(r.checksJson);
    return {
      periodEnd: r.periodEnd,
      basis: r.basis === "standalone" ? "standalone" : "consolidated",
      source: r.source,
      sourceUrl: r.sourceUrl,
      revenue: r.revenue,
      ebitda: ebitdaOf(r),
      pat: r.pat,
      nii: bank.nii,
      ppop: bank.ppop,
    };
  });

  const blocks = composePull({
    isBank:
      args.isBank || quarters.some((q) => q.nii != null && q.ppop != null),
    hasTranscript: (callRows[0]?.n ?? 0) > 0,
    period: doc?.period ?? null,
    reportUrl: doc?.url ?? null,
    pages,
    quarters,
    guidance: guides,
  });
  cachedPull().set(key, { at: Date.now(), blocks });
  return blocks;
}

function pageKey(docId: string, page: number): string {
  return `${docId}:${page}`;
}
