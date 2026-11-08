/**
 * Results ingest (owner: Builder B): NSE filing indexes → XBRL → `results_quarters`.
 *
 *   ingestResults(isin, symbol)   list integrated filings (+ legacy index for depth) →
 *                                 download each XBRL (cached) → quarterFromXbrl →
 *                                 upsert by (isin, period_end, basis) with source
 *                                 precedence xbrl > legacy > pdf → report.
 *   parseXbrlResults(xml, ctx)    the engine/ingest contract: one XBRL → ResultsQuarter.
 *   loadResultsQuarters(isin)     DB rows → typed ResultsQuarter[] (for analyse/results).
 *   upsertResultsQuarter(q)       precedence-aware upsert (used by the PDF path too).
 *
 * Idempotent and resumable; safe to run every 15 minutes. No LLM anywhere.
 * Money is absolute rupees in the DB (repo convention) — crore only at render time.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { type ResultsQuarterRow, resultsQuarters } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  downloadXbrl,
  listIntegratedFilings,
  listLegacyResults,
  type ResultsFiling,
} from "../sources/nse-results";
import type { ResultsQuarter, ResultsSource } from "../types";
import type { IngestSummary } from "./index";
import {
  quarterFromXbrl,
  type ResultsVariant,
  XbrlParseError,
} from "./parse-xbrl";

const log = logger.child({ mod: "engine/ingest/results" });

// ---------------------------------------------------------------------------
// Contract: pure XBRL → ResultsQuarter
// ---------------------------------------------------------------------------

/** Pure: parse one XBRL XML string into the current-quarter ResultsQuarter (absolute INR). */
export function parseXbrlResults(
  xml: string,
  ctx: {
    isin: string;
    sourceUrl: string;
    source?: ResultsSource;
    filedAt?: number | null;
  },
): ResultsQuarter {
  return quarterFromXbrl(xml, {
    isin: ctx.isin,
    sourceUrl: ctx.sourceUrl,
    source:
      ctx.source ??
      (/\/INTEGRATED_FILING_/i.test(ctx.sourceUrl) ? "xbrl" : "legacy"),
    filedAt: ctx.filedAt ?? null,
    taxonomy: taxonomyHint(ctx.sourceUrl),
  }).quarter;
}

function taxonomyHint(url: string): string {
  const u = url.toUpperCase();
  if (u.includes("BANKING")) return "BANKING";
  if (u.includes("NBFC")) return "NBFC";
  if (u.includes("NONINDAS")) return "NONINDAS";
  if (u.includes("INDAS")) return "INDAS";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// DB mapping
// ---------------------------------------------------------------------------

const SOURCE_RANK: Record<ResultsSource, number> = {
  xbrl: 3,
  legacy: 2,
  pdf: 1,
};

export function rowToQuarter(row: ResultsQuarterRow): ResultsQuarter {
  let checks: ResultsQuarter["checks"] = { warnings: [] };
  try {
    const parsed = JSON.parse(row.checksJson || "{}") as Partial<
      ResultsQuarter["checks"]
    >;
    checks = {
      ...parsed,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch {
    checks = { warnings: ["checks_json unreadable"] };
  }
  return {
    isin: row.isin,
    periodEnd: row.periodEnd,
    basis: row.basis as ResultsQuarter["basis"],
    source: row.source as ResultsSource,
    audited: row.audited ?? null,
    revenue: row.revenue,
    otherIncome: row.otherIncome,
    financeCosts: row.financeCosts,
    dna: row.dna,
    pbeit: row.pbeit,
    exceptional: row.exceptional,
    pbt: row.pbt,
    tax: row.tax,
    pat: row.pat,
    patCont: row.patCont,
    eps: row.eps,
    checks,
    sourceUrl: row.sourceUrl,
    filedAt: row.filedAt,
  };
}

export function quarterToRow(
  q: ResultsQuarter,
): typeof resultsQuarters.$inferInsert {
  return {
    isin: q.isin,
    periodEnd: q.periodEnd,
    basis: q.basis,
    source: q.source,
    audited: q.audited,
    revenue: q.revenue,
    otherIncome: q.otherIncome,
    financeCosts: q.financeCosts,
    dna: q.dna,
    pbeit: q.pbeit,
    exceptional: q.exceptional,
    pbt: q.pbt,
    tax: q.tax,
    pat: q.pat,
    patCont: q.patCont,
    eps: q.eps,
    checksJson: JSON.stringify(q.checks),
    sourceUrl: q.sourceUrl,
    filedAt: q.filedAt,
    updatedAt: Date.now(),
  };
}

/** All stored quarters for a company (both bases), newest first. */
export async function loadResultsQuarters(
  isin: string,
): Promise<ResultsQuarter[]> {
  const rows = await db
    .select()
    .from(resultsQuarters)
    .where(eq(resultsQuarters.isin, isin));
  return rows
    .map(rowToQuarter)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export type UpsertOutcome = "inserted" | "updated" | "skipped";

/**
 * Upsert one quarter. A higher-precedence source (xbrl > legacy > pdf) always
 * wins; the same source overwrites (revisions, re-runs); a lower one is skipped
 * so a preliminary PDF row never clobbers exchange XBRL.
 */
export async function upsertResultsQuarter(
  q: ResultsQuarter,
): Promise<UpsertOutcome> {
  const existing = await db
    .select({ source: resultsQuarters.source })
    .from(resultsQuarters)
    .where(
      and(
        eq(resultsQuarters.isin, q.isin),
        eq(resultsQuarters.periodEnd, q.periodEnd),
        eq(resultsQuarters.basis, q.basis),
      ),
    )
    .limit(1);
  const row = quarterToRow(q);
  if (existing.length === 0) {
    await db.insert(resultsQuarters).values(row);
    return "inserted";
  }
  const existingRank =
    SOURCE_RANK[(existing[0]?.source as ResultsSource) ?? "pdf"] ?? 0;
  if (existingRank > SOURCE_RANK[q.source]) return "skipped";
  await db
    .update(resultsQuarters)
    .set(row)
    .where(
      and(
        eq(resultsQuarters.isin, q.isin),
        eq(resultsQuarters.periodEnd, q.periodEnd),
        eq(resultsQuarters.basis, q.basis),
      ),
    );
  return "updated";
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface IngestResultsOptions {
  /** also walk the legacy index (quarters ≤ Dec-2024) until maxQuarters is reached (default true) */
  includeLegacy?: boolean;
  /** distinct quarters wanted per basis, newest first (default 12 ≈ 3 years) */
  maxQuarters?: number;
  /** parse but do not write to the DB */
  dryRun?: boolean;
  /** XBRL cache directory (default data/cache/xbrl) */
  cacheDir?: string;
  signal?: AbortSignal;
  /** callback per parsed quarter (CLI progress) */
  onQuarter?: (q: ResultsQuarter, filing: ResultsFiling) => void;
}

export interface IngestResultsReport extends IngestSummary {
  isin: string;
  symbol: string;
  /** every quarter parsed in this run (both bases), newest first */
  quarters: ResultsQuarter[];
  taxonomies: string[];
  variant: ResultsVariant | null;
  /** fraction of identity checks that passed across all parsed quarters (1 = all) */
  identityPassRate: number;
  identityFailures: Array<{
    periodEnd: string;
    basis: string;
    failed: string[];
  }>;
  /** distinct tag names seen in the quarter context, per taxonomy (discovery aid) */
  tagsByTaxonomy: Record<string, string[]>;
  quirks: string[];
  timingMs: {
    list: number;
    download: number;
    parse: number;
    db: number;
    total: number;
  };
}

/** Fetch integrated-filing index (+ legacy) and XBRLs for a symbol; upsert results_quarters. */
export async function ingestResults(
  isin: string,
  symbol: string,
  opts: IngestResultsOptions = {},
): Promise<IngestResultsReport> {
  const t0 = Date.now();
  const timing = { list: 0, download: 0, parse: 0, db: 0, total: 0 };
  const errors: string[] = [];
  const quarters: ResultsQuarter[] = [];
  const tagsByTaxonomy: Record<string, Set<string>> = {};
  const quirks = new Set<string>();
  const identityFailures: IngestResultsReport["identityFailures"] = [];
  let variant: ResultsVariant | null = null;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let identityTotal = 0;
  let identityPassed = 0;
  const maxQuarters = opts.maxQuarters ?? 12;

  // 1. indexes
  const tl = Date.now();
  let filings: ResultsFiling[] = [];
  try {
    filings = await listIntegratedFilings(symbol, { signal: opts.signal });
  } catch (e) {
    errors.push(`integrated index: ${msg(e)}`);
  }
  const periodsSoFar = new Set(filings.map((f) => f.periodEnd));
  if (opts.includeLegacy !== false && periodsSoFar.size < maxQuarters) {
    try {
      const legacy = await listLegacyResults(symbol, { signal: opts.signal });
      const want = new Set<string>();
      for (const f of legacy) {
        if (periodsSoFar.has(f.periodEnd)) continue;
        if (
          periodsSoFar.size + want.size >= maxQuarters &&
          !want.has(f.periodEnd)
        )
          break;
        want.add(f.periodEnd);
      }
      filings = filings.concat(legacy.filter((f) => want.has(f.periodEnd)));
    } catch (e) {
      errors.push(`legacy index: ${msg(e)}`);
    }
  }
  timing.list = Date.now() - tl;

  // 2. download + parse + upsert
  for (const f of filings) {
    if (opts.signal?.aborted) break;
    let xml: string;
    const td = Date.now();
    try {
      xml = await downloadXbrl(f.xbrlUrl, {
        cacheDir: opts.cacheDir,
        signal: opts.signal,
      });
    } catch (e) {
      errors.push(`${f.periodEnd} ${f.basis}: download ${msg(e)}`);
      continue;
    }
    timing.download += Date.now() - td;

    const tp = Date.now();
    let parsed: ReturnType<typeof quarterFromXbrl>;
    try {
      parsed = quarterFromXbrl(xml, {
        isin,
        sourceUrl: f.xbrlUrl,
        source: f.index === "integrated" ? "xbrl" : "legacy",
        filedAt: f.filedAt,
        basis: f.basis,
        audited: f.audited,
        periodEnd: f.periodEnd,
        taxonomy: f.taxonomy,
      });
    } catch (e) {
      const why = e instanceof XbrlParseError ? e.message : msg(e);
      errors.push(`${f.periodEnd} ${f.basis}: parse ${why}`);
      continue;
    }
    timing.parse += Date.now() - tp;

    const q = parsed.quarter;
    if (q.periodEnd !== f.periodEnd)
      q.checks.warnings.push(
        `index quarter end ${f.periodEnd} ≠ XBRL ${q.periodEnd}`,
      );
    variant ??= parsed.variant;
    let tagSet = tagsByTaxonomy[f.taxonomy];
    if (!tagSet) {
      tagSet = new Set();
      tagsByTaxonomy[f.taxonomy] = tagSet;
    }
    for (const t of parsed.tags) tagSet.add(t);
    for (const ok of Object.values(q.checks.identities ?? {})) {
      identityTotal++;
      if (ok) identityPassed++;
    }
    const failed = Object.entries(q.checks.identities ?? {})
      .filter(([, ok]) => !ok)
      .map(([n]) => n);
    if (failed.length)
      identityFailures.push({ periodEnd: q.periodEnd, basis: q.basis, failed });
    for (const w of q.checks.warnings)
      if (/minority|associates|owners-of-parent|ISIN mismatch|currency/.test(w))
        quirks.add(w);
    quarters.push(q);
    opts.onQuarter?.(q, f);

    if (!opts.dryRun) {
      const tdb = Date.now();
      try {
        const outcome = await upsertResultsQuarter(q);
        if (outcome === "inserted") inserted++;
        else if (outcome === "updated") updated++;
        else skipped++;
      } catch (e) {
        errors.push(`${f.periodEnd} ${f.basis}: db ${msg(e)}`);
      }
      timing.db += Date.now() - tdb;
    }
  }

  timing.total = Date.now() - t0;
  quarters.sort(
    (a, b) =>
      b.periodEnd.localeCompare(a.periodEnd) || a.basis.localeCompare(b.basis),
  );
  const report: IngestResultsReport = {
    isin,
    symbol,
    fetched: filings.length,
    inserted,
    updated,
    skipped,
    errors,
    quarters,
    taxonomies: [...new Set(filings.map((f) => f.taxonomy))],
    variant,
    identityPassRate: identityTotal ? identityPassed / identityTotal : 1,
    identityFailures,
    tagsByTaxonomy: Object.fromEntries(
      Object.entries(tagsByTaxonomy).map(([k, v]) => [k, [...v].sort()]),
    ),
    quirks: [...quirks],
    timingMs: timing,
  };
  log.info(
    {
      symbol,
      filings: filings.length,
      quarters: quarters.length,
      inserted,
      updated,
      skipped,
      errors: errors.length,
      identityPassRate: report.identityPassRate,
      ms: timing.total,
    },
    "results ingested",
  );
  return report;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
