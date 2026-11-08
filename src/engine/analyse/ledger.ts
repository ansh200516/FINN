/**
 * Promise ledger adjudication (owner: Builder C). Deterministic; no LLM.
 *
 * `settleGuidance(isin)` loads the company's guidance rows, quarterly results and
 * transcript metadata, runs the pure `adjudicateAll`, and writes verdicts back
 * (idempotent — every run recomputes every row from scratch).
 *
 * Rules (docs/research/02 §2.6):
 *   - chain statements by (metric family, horizon); a later transcript that moves
 *     the band marks the earlier one `raised` / `cut`; an explicit withdrawal → `withdrawn`
 *   - the latest statement is settled once its horizon has elapsed and the exchange
 *     numbers for every quarter of the horizon exist: kept / beat / missed with
 *     tolerances growth ±1pp, margin ±0.5pp, absolute ₹ ±3%, units ±5%
 *   - `not_addressed`: due, no actual derivable, and the next transcript is silent
 *   - `unverifiable`: the metric is not derivable from exchange P&L data
 *     (capex, volumes, order book, constant-currency growth, bank ratios…),
 *     or the quote is not the same quantity as the XBRL line (a non-INR
 *     currency, a segment/product/subsidiary, AUM or another non-P&L noun).
 *     A named product in the question the line answers counts, even when
 *     the stored quote omits it. Beat / Miss is written only when metric,
 *     unit, and scope match. An open row does not carry the company
 *     revenue, EBITDA, or PAT figure as "so far" when the promise is a
 *     different quantity, and a figure saved on the previous row is cleared.
 *   - EBITDA = PBEIT + finance costs + D&A − other income (ex-other-income
 *     convention); EBIT = PBEIT + finance costs − other income; "operating margin"
 *     is settled only when the EBITDA and EBIT readings agree
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  companies,
  documentMeta,
  documentPages,
  documents,
  guidance,
  resultsQuarters,
} from "@/db/schema";
import { logger } from "@/lib/logger";
import { assessGuidanceGrounding } from "../extract/guidance";
import {
  type FiscalPeriod,
  parsePeriodLabel,
  parseTranscript,
  periodForQuarterEnd,
  previousQuarter,
  previousYearPeriod,
  quarterEndsOf,
} from "../extract/transcript";
import { transcriptCoverage } from "../ingest/documents";
import { normalizeForMatch, verifyQuote } from "../llm/verify";
import type {
  GuidanceStatus,
  LedgerRow,
  ResultsQuarter,
  Verdict,
} from "../types";

const log = logger.child({ mod: "engine/analyse/ledger" });

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface LedgerInput {
  id: string;
  isin: string;
  docId: string;
  speaker: string | null;
  role: string | null;
  page: number | null;
  quote: string;
  metric: string;
  direction: string | null;
  low: number | null;
  high: number | null;
  unit: string | null;
  horizon: string | null;
  /** 'YYYY-MM-DD' end of horizon (null = open-ended) */
  horizonEnd: string | null;
  isExplicit: boolean;
  /** "about X" — tolerance is widened when comparing */
  approx?: boolean;
  /** metric/unit pair could not be reconciled — never adjudicated */
  typeIssue?: boolean;
  typeNote?: string | null;
  /** numbers were computed (not written in the quote) — never adjudicated */
  derived?: boolean;
  /** how assessGuidanceGrounding classified this row on load */
  groundingAction?:
    | "explicit"
    | "dropped"
    | "retyped"
    | "ambiguous"
    | "qualitative";
  /** where the statement came from (default transcript) */
  source?: "transcript" | "annual_report";
  revision: "new" | "maintained" | "raised" | "cut" | "withdrawn";
  comparison: "yoy" | "qoq" | "absolute" | "cc" | null;
  /**
   * Question this line answers, plus the same-answer lead-in.
   * A named product here scopes the promise when the quote itself omits it.
   */
  context?: string | null;
  /** when the promise was made, ms UTC */
  statedAt: number;
  /** period of the call the statement was made in ('Q2FY27') */
  statedPeriod: string | null;
  evidence: Record<string, unknown>;
}

export interface TranscriptMeta {
  docId: string;
  period: string | null;
  publishedAt: number | null;
}

export const TOLERANCE = {
  growthPp: 1.0,
  marginPp: 0.5,
  absolutePct: 3.0,
  unitsPct: 5.0,
} as const;

// ---------------------------------------------------------------------------
// Metric families
// ---------------------------------------------------------------------------

export type MetricFamily =
  | "revenue"
  | "revenue_growth"
  | "margin_ebitda"
  | "margin_ebit"
  | "margin_operating"
  | "margin_pbt"
  | "margin_net"
  | "ebitda"
  | "ebitda_growth"
  | "pat"
  | "pat_growth"
  | "tax_rate"
  | "other";

const FAMILY: Record<string, MetricFamily> = {
  revenue: "revenue",
  revenue_growth: "revenue_growth",
  ebitda_margin: "margin_ebitda",
  ebit_margin: "margin_ebit",
  operating_margin: "margin_operating",
  pbt_margin: "margin_pbt",
  net_margin: "margin_net",
  ebitda: "ebitda",
  ebitda_growth: "ebitda_growth",
  pat: "pat",
  pat_growth: "pat_growth",
  tax_rate: "tax_rate",
};

export function metricFamily(metric: string): MetricFamily {
  return FAMILY[metric] ?? "other";
}

const SCOPE_RE =
  /\b(piping|pipes?|division|segment|exports?|international|overseas|domestic|india business|us business|europe|cdmo|generics?|api|formulations?|retail|wholesale|subsidiar(?:y|ies)|vertical|category|brand|plant|facility|gas|wavin|parachute|saffola|foods|digital|bfsi|hi-?tech|manufacturing|energy|utilities|communications?|automotive|passenger vehicles?|commercial vehicles?)\b/i;

/**
 * Slice nouns that must not be scored against the company line.
 * Kept off `SCOPE_RE` so a later slice sentence does not break an existing
 * revision chain (that would re-open a superseded row and score it).
 */
const SLICE_RE =
  /\b(piping|pipes?|division|segment|exports?|international|overseas|domestic|india business|us business|europe|cdmo|generics?|api|formulations?|retail|wholesale|subsidiar(?:y|ies)|vertical|category|brand|plant|facility|gas|wavin|parachute|saffola|foods|digital|bfsi|hi-?tech|manufacturing|energy|utilities|communications?|automotive|passenger vehicles?|commercial vehicles?|hardware|consumer durables?|telecom|transactional(?:\s+income)?|power[- ]one|candere|sidwal|racs?|room\s+acs?)\b/i;

/**
 * Named products a neighbouring question can scope, when the quote omits them.
 * Generic slice nouns ("segment", "division", "international") stay off this
 * list: they show up beside company-wide answers and must not unsettle those.
 */
const CONTEXT_SCOPE_RE = /\b(racs?|room\s+acs?|candere|sidwal|power[- ]one)\b/i;

/** The speaker named the consolidated / company total, not a slice of it. */
const COMPANY_TOTAL_RE =
  /\b(company[- ]wide|consolidated|consol\b|at (the )?company level|for the company|topline|top[- ]line)\b/i;

const FX_UNITS = new Set([
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AED",
  "SGD",
  "CNY",
  "AUD",
  "CAD",
  "HKD",
]);

/** Absolute rupee bands this far from the company line are a different quantity. */
const SLICE_RATIO = 3;

export const QUANTITY_NOTE = {
  currency: "currency mismatch",
  segment: "segment, not the company total",
  metric: "metric mismatch",
} as const;

/** a sub-business / segment word in the quote; "company" when the statement is company-wide */
export function scopeOf(quote: string): string {
  if (
    /\b(company[- ]wide|overall|consolidated|at (the )?company level|for the company|total)\b/i.test(
      quote,
    )
  )
    return "company";
  const m = SCOPE_RE.exec(quote);
  return m ? (m[1] as string).toLowerCase().replace(/s$/, "") : "company";
}

function promisedFx(unit: string | null, quote: string): boolean {
  if (unit && FX_UNITS.has(unit.toUpperCase())) return true;
  if (unit === "%" || unit === "bp" || unit === "INR") return false;
  const fx =
    /(?:\$|\bUSD\b|\bUS\$\b|\bdollars?\b|\bEUR\b|€|\beuros?\b|\bGBP\b|£)/i.test(
      quote,
    );
  const inr =
    /(?:₹|\bINR\b|\bRs\.?\b|\brupees?\b|\bcrores?\b|\blakhs?\b)/i.test(quote);
  return fx && !inr;
}

function metricMismatch(quote: string, family: MetricFamily): boolean {
  if (family === "other") return false;
  if (/\b(AUMs?|assets under management)\b/i.test(quote)) return true;
  if (
    /\b(volumes?|order[- ]books?|order inflows?|disbursements?|market shares?)\s+growth\b/i.test(
      quote,
    )
  )
    return true;
  if (
    /\bgrowth\s+(?:in|of|for)\s+(?:our\s+|the\s+)?(volumes?|order[- ]books?|disbursements?|AUMs?)\b/i.test(
      quote,
    )
  )
    return true;
  if (
    /\b(NIM|NIMs|net interest margin|GNPA|NNPA|ROE|ROA|ROCE|credit cost|cost[- ]to[- ]income)\b/i.test(
      quote,
    )
  )
    return true;
  return false;
}

/**
 * Why this promise must not be scored against the delivered XBRL line.
 * Null when metric, unit, and scope are the same quantity.
 * An absolute rupee band with no company-total word and no slice word is
 * scored only when it is the same order of magnitude as the company line;
 * otherwise the scope is not in the quote and the row is not Beat/Miss.
 * `context` is the question and the same-answer lead-in. A named product
 * there scopes the line. A quote that already names the company total is
 * left alone.
 */
export function quantityIssue(args: {
  quote: string;
  context?: string | null;
  family: MetricFamily;
  unit: string | null;
  deliveredUnit: string | null;
  deliveredValue: number | null;
  low: number | null;
  high: number | null;
}): string | null {
  if (args.family === "other") return null;
  if (promisedFx(args.unit, args.quote)) {
    const delivered = args.deliveredUnit?.toUpperCase() ?? null;
    const unit = args.unit?.toUpperCase() ?? null;
    if (!(unit && FX_UNITS.has(unit) && delivered === unit))
      return QUANTITY_NOTE.currency;
  }
  if (metricMismatch(args.quote, args.family)) return QUANTITY_NOTE.metric;
  if (SLICE_RE.test(args.quote)) return QUANTITY_NOTE.segment;
  const beside = args.context?.trim() ?? "";
  if (
    beside &&
    !COMPANY_TOTAL_RE.test(args.quote) &&
    CONTEXT_SCOPE_RE.test(`${args.quote}\n${beside}`)
  )
    return QUANTITY_NOTE.segment;
  const absolute =
    (args.family === "revenue" ||
      args.family === "ebitda" ||
      args.family === "pat") &&
    args.unit !== "%" &&
    args.unit !== "bp" &&
    (args.deliveredUnit == null || args.deliveredUnit === "INR") &&
    (args.unit == null || args.unit === "INR" || args.unit.startsWith("INR"));
  if (!absolute || COMPANY_TOTAL_RE.test(args.quote)) return null;
  const band =
    args.low !== null && args.high !== null
      ? (args.low + args.high) / 2
      : (args.low ?? args.high);
  const actual = args.deliveredValue;
  if (band === null || actual === null || band === 0 || actual === 0)
    return null;
  const ratio =
    Math.max(Math.abs(band), Math.abs(actual)) /
    Math.min(Math.abs(band), Math.abs(actual));
  if (ratio > SLICE_RATIO) return QUANTITY_NOTE.segment;
  return null;
}

/**
 * Whether a year-to-date company reading may sit beside a promise whose year
 * has not closed. The due-year test needs a finished line. Until then, a
 * full-year company promise still ahead of year-to-date is the same quantity.
 * A rupee band the company total has already outgrown by more than
 * {@link SLICE_RATIO} is a product or slice, and the company figure stays off.
 */
function interimFitsPromise(args: {
  quote: string;
  context?: string | null;
  family: MetricFamily;
  unit: string | null;
  low: number | null;
  high: number | null;
  value: number;
  valueUnit: string | null;
}): boolean {
  if (
    quantityIssue({
      quote: args.quote,
      context: args.context,
      family: args.family,
      unit: args.unit,
      deliveredUnit: args.valueUnit,
      deliveredValue: null,
      low: args.low,
      high: args.high,
    })
  )
    return false;
  const absolute =
    (args.family === "revenue" ||
      args.family === "ebitda" ||
      args.family === "pat") &&
    args.unit !== "%" &&
    args.unit !== "bp" &&
    (args.valueUnit == null || args.valueUnit === "INR") &&
    (args.unit == null || args.unit === "INR" || args.unit.startsWith("INR"));
  if (!absolute || COMPANY_TOTAL_RE.test(args.quote)) return true;
  const band =
    args.low !== null && args.high !== null
      ? (args.low + args.high) / 2
      : (args.low ?? args.high);
  if (band === null || band === 0 || args.value === 0) return true;
  return Math.abs(args.value) <= Math.abs(band) * SLICE_RATIO;
}

/** Slice, currency, or metric — known without a finished XBRL line. */
function quoteLeavesCompanyLine(
  s: Pick<
    LedgerInput,
    "quote" | "context" | "metric" | "unit" | "comparison" | "low" | "high"
  >,
  opts: AdjudicateOptions,
): boolean {
  const family = resolveFamily(s.metric, s.quote, opts);
  if (s.comparison === "cc" || family === "other") return false;
  return (
    quantityIssue({
      quote: s.quote,
      context: s.context,
      family,
      unit: s.unit,
      deliveredUnit: null,
      deliveredValue: null,
      low: s.low,
      high: s.high,
    }) != null
  );
}

function clearCompanyFigure(row: AdjudicatedRow): void {
  row.evidence.interim = null;
  row.evidence.rule = null;
  row.evidence.priorYear = null;
  row.delivered = { value: null, unit: null, source: null };
  row.settledByQuarter = null;
}

/**
 * The question immediately before `quote`, plus the same answer's lead-in.
 * Empty when the quote is not in `turns` — callers must not invent a scope.
 */
export function quoteContext(
  turns: ReadonlyArray<{ role: string; text: string }>,
  quote: string,
): string {
  const i = turns.findIndex((t) => verifyQuote(quote, t.text) !== null);
  if (i < 0) return "";
  const prev = i > 0 ? turns[i - 1] : undefined;
  const question =
    prev && (prev.role === "analyst" || prev.text.includes("?"))
      ? prev.text.slice(-1200)
      : "";
  const cur = turns[i];
  if (!cur) return question.trim();
  const off = verifyQuote(quote, cur.text);
  const lead =
    off !== null && off > 0
      ? normalizeForMatch(cur.text).slice(Math.max(0, off - 400), off)
      : "";
  return `${question}\n${lead}`.trim();
}

/** grouping key for revision chains: margins of any flavour chain together; segment-level statements chain separately */
function chainKey(
  metric: string,
  horizon: string | null,
  quote: string,
): string {
  const f = metricFamily(metric);
  const g = f.startsWith("margin_") ? "margin" : f === "other" ? metric : f;
  return `${g}|${horizon ?? ""}|${scopeOf(quote)}`;
}

/** metrics where a lower actual is the good surprise */
const COST_LIKE = new Set([
  "tax_rate",
  "capex",
  "credit_cost",
  "net_debt",
  "debt_reduction",
]);

// ---------------------------------------------------------------------------
// Results math
// ---------------------------------------------------------------------------

type Q = ResultsQuarter;

function pick(
  quarters: Q[],
  periodEnd: string,
  basis: "consolidated" | "standalone",
): Q | undefined {
  return quarters.find((q) => q.periodEnd === periodEnd && q.basis === basis);
}

/** Rows for every quarter-end, all on one basis (consolidated preferred). Null when any is missing. */
export function quartersFor(
  quarters: Q[],
  ends: string[],
): { rows: Q[]; basis: "consolidated" | "standalone" } | null {
  for (const basis of ["consolidated", "standalone"] as const) {
    const rows = ends.map((e) => pick(quarters, e, basis));
    if (rows.every((r): r is Q => !!r)) return { rows, basis };
  }
  return null;
}

function sum(rows: Q[], f: (q: Q) => number | null): number | null {
  let s = 0;
  for (const r of rows) {
    const v = f(r);
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    s += v;
  }
  return s;
}

/** operating EBITDA (ex other income) for one quarter; null when inputs are missing */
export function ebitdaOp(q: Q): number | null {
  const pbeit =
    q.pbeit ?? (q.pbt !== null ? q.pbt - (q.exceptional ?? 0) : null);
  if (pbeit === null || q.financeCosts === null || q.dna === null) return null;
  return pbeit + q.financeCosts + q.dna - (q.otherIncome ?? 0);
}

export function ebit(q: Q): number | null {
  const pbeit =
    q.pbeit ?? (q.pbt !== null ? q.pbt - (q.exceptional ?? 0) : null);
  if (pbeit === null || q.financeCosts === null) return null;
  return pbeit + q.financeCosts - (q.otherIncome ?? 0);
}

function pct(n: number | null, d: number | null): number | null {
  if (n === null || d === null || d === 0) return null;
  return (n / d) * 100;
}

function growthPct(now: number | null, base: number | null): number | null {
  if (now === null || base === null || base <= 0) return null;
  return (now / base - 1) * 100;
}

export interface Delivered {
  value: number | null;
  unit: string | null;
  source: string | null;
  /** 'Q4FY27' etc. — the quarter that closed the period */
  settledBy: string | null;
  basis: "consolidated" | "standalone" | null;
  note: string | null;
  /** secondary reading (operating margin: EBIT view) */
  alt?: { label: string; value: number | null };
}

/** Compute what the exchange numbers show for a metric over a horizon. */
export function computeDelivered(
  family: MetricFamily,
  metric: string,
  period: FiscalPeriod,
  comparison: LedgerInput["comparison"],
  quarters: Q[],
  opts: { ends?: string[]; prevEnds?: string[] } = {},
): Delivered {
  const none = (note: string): Delivered => ({
    value: null,
    unit: null,
    source: null,
    settledBy: null,
    basis: null,
    note,
  });
  if (family === "other") return none(`no comparable XBRL line (${metric})`);
  if (family === "revenue_growth" && comparison === "cc")
    return none(
      "no comparable XBRL line — constant-currency growth is not derivable from INR exchange filings",
    );

  const ends = opts.ends ?? quarterEndsOf(period);
  const cur = quartersFor(quarters, ends);
  if (!cur) {
    const have = ends.filter((e) =>
      quarters.some((q) => q.periodEnd === e),
    ).length;
    return none(
      have
        ? `actuals filed for ${have} of ${ends.length} quarters of ${period.label}`
        : `no exchange results yet for ${period.label}`,
    );
  }
  const last = cur.rows[cur.rows.length - 1] as Q;
  const settledBy = periodForQuarterEnd(last.periodEnd);
  const base = {
    source: last.sourceUrl,
    settledBy,
    basis: cur.basis,
    note: null as string | null,
  };
  const rev = sum(cur.rows, (q) => q.revenue);

  const needPrior = (
    f: (q: Q) => number | null,
  ): { now: number | null; base: number | null; note: string | null } => {
    const prevEnds =
      opts.prevEnds ??
      (comparison === "qoq" && period.kind === "quarter"
        ? [previousQuarter(period).end]
        : quarterEndsOf(previousYearPeriod(period)));
    const prev = quartersFor(quarters, prevEnds);
    if (!prev)
      return {
        now: sum(cur.rows, f),
        base: null,
        note: `comparison period (${comparison === "qoq" ? previousQuarter(period).label : previousYearPeriod(period).label}) not in exchange data`,
      };
    if (prev.basis !== cur.basis)
      return {
        now: sum(cur.rows, f),
        base: null,
        note: "basis mismatch between periods",
      };
    return { now: sum(cur.rows, f), base: sum(prev.rows, f), note: null };
  };

  switch (family) {
    case "revenue":
      return { ...base, value: rev, unit: "INR" };
    case "revenue_growth": {
      const g = needPrior((q) => q.revenue);
      const v = growthPct(g.now, g.base);
      return {
        ...base,
        value: v,
        unit: "%",
        note:
          g.note ??
          (comparison === "qoq" ? "sequential" : "year-on-year, reported INR"),
      };
    }
    case "ebitda":
      return {
        ...base,
        value: sum(cur.rows, ebitdaOp),
        unit: "INR",
        note: "EBITDA = PBEIT + finance costs + D&A − other income",
      };
    case "ebitda_growth": {
      const g = needPrior(ebitdaOp);
      return {
        ...base,
        value: growthPct(g.now, g.base),
        unit: "%",
        note: g.note ?? "operating EBITDA, year-on-year",
      };
    }
    case "pat":
      return { ...base, value: sum(cur.rows, (q) => q.pat), unit: "INR" };
    case "pat_growth": {
      const g = needPrior((q) => q.pat);
      return {
        ...base,
        value: growthPct(g.now, g.base),
        unit: "%",
        note: g.note ?? "profit for the period, year-on-year",
      };
    }
    case "margin_ebitda":
      return {
        ...base,
        value: pct(sum(cur.rows, ebitdaOp), rev),
        unit: "%",
        note: "operating EBITDA / revenue (ex other income)",
      };
    case "margin_ebit":
      return {
        ...base,
        value: pct(sum(cur.rows, ebit), rev),
        unit: "%",
        note: "EBIT / revenue (ex other income)",
      };
    case "margin_operating": {
      const e1 = pct(sum(cur.rows, ebitdaOp), rev);
      const e2 = pct(sum(cur.rows, ebit), rev);
      return {
        ...base,
        value: e1,
        unit: "%",
        note: "EBITDA margin (ex other income); EBIT margin as secondary reading",
        alt: { label: "EBIT margin", value: e2 },
      };
    }
    case "margin_pbt":
      return {
        ...base,
        value: pct(
          sum(cur.rows, (q) => q.pbeit ?? q.pbt),
          rev,
        ),
        unit: "%",
        note: "PBT (before exceptionals) / revenue",
      };
    case "margin_net":
      return {
        ...base,
        value: pct(
          sum(cur.rows, (q) => q.pat),
          rev,
        ),
        unit: "%",
        note: "PAT / revenue",
      };
    case "tax_rate":
      return {
        ...base,
        value: pct(
          sum(cur.rows, (q) => q.tax),
          sum(cur.rows, (q) => q.pbt),
        ),
        unit: "%",
        note: "tax expense / PBT",
      };
    default:
      return none(`no comparable XBRL line (${metric})`);
  }
}

// ---------------------------------------------------------------------------
// Verdict rules
// ---------------------------------------------------------------------------

export function toleranceFor(
  family: MetricFamily,
  unit: string | null,
): number {
  if (family.startsWith("margin_")) return TOLERANCE.marginPp;
  if (family.endsWith("_growth") || family === "tax_rate")
    return TOLERANCE.growthPp;
  if (unit === "%") return TOLERANCE.growthPp;
  return 0; // absolute: tolerance applied as a percentage of the band edge
}

/** Pure: compare a delivered value against a promised band. */
export function compareBand(
  actual: number,
  band: { low: number | null; high: number | null },
  opts: {
    family: MetricFamily;
    unit: string | null;
    costLike: boolean;
    /** "about X": one extra pp (percent) / 2 % (absolute) of tolerance */
    approx?: boolean;
  },
): { verdict: Verdict; rule: string } {
  const isPct = opts.unit === "%" || opts.unit === "bp";
  const tolAbs = (edge: number) =>
    isPct
      ? toleranceFor(opts.family, opts.unit) + (opts.approx ? 1 : 0)
      : Math.abs(edge) *
        (((opts.unit === "units" ? TOLERANCE.unitsPct : TOLERANCE.absolutePct) +
          (opts.approx ? 2 : 0)) /
          100);
  const { low, high } = band;
  const above = high !== null && actual > high + tolAbs(high);
  const below = low !== null && actual < low - tolAbs(low);
  const tolText = isPct
    ? `±${toleranceFor(opts.family, opts.unit)}pp`
    : `±${opts.unit === "units" ? TOLERANCE.unitsPct : TOLERANCE.absolutePct}%`;
  if (low !== null && high !== null) {
    if (above)
      return {
        verdict: opts.costLike ? "missed" : "beat",
        rule: `above ${high}${isPct ? "%" : ""} + ${tolText}`,
      };
    if (below)
      return {
        verdict: opts.costLike ? "beat" : "missed",
        rule: `below ${low}${isPct ? "%" : ""} − ${tolText}`,
      };
    return {
      verdict: "kept",
      rule: `within ${low}–${high}${isPct ? "%" : ""} ${tolText}`,
    };
  }
  if (low !== null) {
    // floor ("at least X")
    if (below)
      return {
        verdict: opts.costLike ? "beat" : "missed",
        rule: `below floor ${low} − ${tolText}`,
      };
    if (actual > low + 2 * tolAbs(low))
      return {
        verdict: opts.costLike ? "missed" : "beat",
        rule: `well above floor ${low}`,
      };
    return { verdict: "kept", rule: `at or above floor ${low} ${tolText}` };
  }
  if (high !== null) {
    // ceiling ("up to X", "not more than X")
    if (above)
      return {
        verdict: opts.costLike ? "missed" : "beat",
        rule: `above ceiling ${high} + ${tolText}`,
      };
    return { verdict: "kept", rule: `within ceiling ${high} ${tolText}` };
  }
  return { verdict: "unverifiable", rule: "no band" };
}

/** Pure: direction-only promises ("margins will improve", "flat volumes") against a change in pp/%. */
export function compareDirection(
  change: number,
  direction: string | null,
  family: MetricFamily,
): { verdict: Verdict; rule: string } {
  const tol = family.startsWith("margin_")
    ? TOLERANCE.marginPp
    : TOLERANCE.growthPp;
  if (direction === "up")
    return change > tol
      ? { verdict: "kept", rule: `improved by ${change.toFixed(1)}` }
      : change < -tol
        ? { verdict: "missed", rule: `fell by ${(-change).toFixed(1)}` }
        : {
            verdict: "missed",
            rule: `flat (${change.toFixed(1)}) when improvement was promised`,
          };
  if (direction === "down")
    return change < -tol
      ? { verdict: "kept", rule: `fell by ${(-change).toFixed(1)}` }
      : { verdict: "missed", rule: `did not fall (${change.toFixed(1)})` };
  if (direction === "flat")
    return Math.abs(change) <= tol * 2
      ? { verdict: "kept", rule: `held within ±${tol * 2}` }
      : {
          verdict: change > 0 ? "beat" : "missed",
          rule: `moved ${change.toFixed(1)}`,
        };
  return {
    verdict: "unverifiable",
    rule: "qualitative statement without a measurable direction",
  };
}

/** Contract from analyse/index.ts: one promise vs one delivered number (no chain / silence logic). */
export function adjudicate(
  row: LedgerRow,
  delivered: {
    value: number | null;
    unit: string | null;
    source: string | null;
  },
): Verdict {
  if (delivered.value === null) return "unverifiable";
  const family = metricFamily(row.metric);
  if (
    quantityIssue({
      quote: row.quote,
      family,
      unit: row.unit,
      deliveredUnit: delivered.unit,
      deliveredValue: delivered.value,
      low: row.low,
      high: row.high,
    })
  )
    return "unverifiable";
  if (row.low !== null || row.high !== null)
    return compareBand(
      delivered.value,
      { low: row.low, high: row.high },
      { family, unit: row.unit, costLike: COST_LIKE.has(row.metric) },
    ).verdict;
  return "unverifiable";
}

// ---------------------------------------------------------------------------
// Adjudication
// ---------------------------------------------------------------------------

export interface AdjudicatedRow extends LedgerRow {
  status: GuidanceStatus;
}

function mid(s: { low: number | null; high: number | null }): number | null {
  if (s.low !== null && s.high !== null) return (s.low + s.high) / 2;
  return s.low ?? s.high;
}

function dateMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d, 23, 59, 59);
}

export interface AdjudicateOptions {
  /**
   * What "operating margin" means for this company: IT services guide EBIT
   * margins; most Indian industrials mean EBITDA margin ("OPM"). 'auto'
   * (default) settles only when the two readings agree.
   */
  operatingMarginBasis?: "ebitda" | "ebit" | "auto";
}

/**
 * The model's margin label is noisy ("operating margin" lands on ebitda_margin
 * / ebit_margin / operating_margin). When the quote literally says "operating
 * margin" the company convention decides what it means.
 */
function resolveFamily(
  metric: string,
  quote: string,
  opts: AdjudicateOptions,
): MetricFamily {
  let f = metricFamily(metric);
  if (
    f.startsWith("margin_") &&
    /\boperating\s+(profit\s+)?margins?\b|\bOPM\b/i.test(quote)
  )
    f = "margin_operating";
  if (f === "margin_operating") {
    if (opts.operatingMarginBasis === "ebitda") return "margin_ebitda";
    if (opts.operatingMarginBasis === "ebit") return "margin_ebit";
  }
  return f;
}

/** Pure: adjudicate every statement of one company. */
export function adjudicateAll(
  inputs: LedgerInput[],
  quarters: ResultsQuarter[],
  transcripts: TranscriptMeta[],
  now: number = Date.now(),
  opts: AdjudicateOptions = {},
): AdjudicatedRow[] {
  const rows = new Map<string, AdjudicatedRow>();
  const base = (s: LedgerInput): AdjudicatedRow => ({
    id: s.id,
    isin: s.isin,
    docId: s.docId,
    quote: s.quote,
    speaker: s.speaker,
    role: s.role,
    page: s.page,
    metric: s.metric,
    direction: (s.direction ?? "qualitative") as LedgerRow["direction"],
    low: s.low,
    high: s.high,
    unit: s.unit,
    horizon: s.horizon,
    horizonEnd: s.horizonEnd,
    isExplicit: s.isExplicit,
    revision: s.revision,
    comparison: s.comparison ?? undefined,
    status: "open",
    statedAt: s.statedAt,
    settledByQuarter: null,
    verdict: null,
    delivered: null,
    evidence: {
      quoteDocId: s.docId,
      page: s.page,
      source: s.source ?? "transcript",
      resultsSourceUrl: null,
      statedPeriod: s.statedPeriod,
      horizonEnd: s.horizonEnd,
      promised: {
        low: s.low,
        high: s.high,
        unit: s.unit,
        isExplicit: s.isExplicit,
        direction: s.direction,
      },
    },
  });
  for (const s of inputs) rows.set(s.id, base(s));

  // --- chains per (family, horizon) ------------------------------------------------
  const groups = new Map<string, LedgerInput[]>();
  for (const s of inputs) {
    const k = chainKey(s.metric, s.horizon, s.quote);
    const g = groups.get(k) ?? [];
    g.push(s);
    groups.set(k, g);
  }
  const transcriptsSorted = [...transcripts]
    .filter((t) => t.publishedAt !== null)
    .sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0));

  for (const [, g] of groups) {
    g.sort((a, b) => a.statedAt - b.statedAt || a.id.localeCompare(b.id));
    const chain = g.map((s) => ({
      id: s.id,
      docId: s.docId,
      statedAt: s.statedAt,
      statedPeriod: s.statedPeriod,
      low: s.low,
      high: s.high,
      unit: s.unit,
      revision: s.revision,
      metric: s.metric,
    }));
    for (const s of g)
      (rows.get(s.id) as AdjudicatedRow).evidence.chain = chain;

    // revisions: compare each statement with the next one from a later document
    for (let i = 0; i < g.length - 1; i++) {
      const prev = g[i] as LedgerInput;
      const next = g
        .slice(i + 1)
        .find((n) => n.docId !== prev.docId && !n.derived);
      if (!next || prev.derived) continue;
      const pr = rows.get(prev.id) as AdjudicatedRow;
      if (pr.verdict) continue;
      if (next.revision === "withdrawn") {
        pr.status = "withdrawn";
        pr.verdict = "withdrawn";
        pr.evidence.withdrawnBy = next.id;
        pr.evidence.note = `withdrawn in ${next.statedPeriod ?? "a later"} call`;
        continue;
      }
      const pm = mid(prev);
      const nm = mid(next);
      let verdict: Verdict | null = null;
      if (
        pm !== null &&
        nm !== null &&
        prev.unit === next.unit &&
        prev.isExplicit &&
        next.isExplicit
      ) {
        // bands an order of magnitude apart are different things (a segment vs the company) — not a revision
        if (pm !== 0 && nm !== 0 && (nm / pm > 3 || pm / nm > 3)) {
          pr.evidence.note =
            "a later statement on the same metric differs by >3× — treated as a different scope";
          continue;
        }
        const tol =
          prev.unit === "%"
            ? toleranceFor(metricFamily(prev.metric), prev.unit)
            : Math.abs(pm) * (TOLERANCE.absolutePct / 100);
        if (nm > pm + tol) verdict = "raised";
        else if (nm < pm - tol) verdict = "cut";
      } else if (next.revision === "raised" || next.revision === "cut") {
        // the speaker's own word ("we are raising…") — unless the bands, where both
        // exist, move the other way (then the later sentence was about something else)
        const contradicts =
          pm !== null &&
          nm !== null &&
          prev.unit === next.unit &&
          ((next.revision === "raised" && nm < pm) ||
            (next.revision === "cut" && nm > pm));
        if (contradicts) {
          pr.status = "superseded";
          pr.evidence.supersededBy = next.id;
          pr.evidence.note = `restated in the ${next.statedPeriod ?? "next"} call with a band that does not match the stated '${next.revision}' — no revision verdict`;
          continue;
        }
        verdict = next.revision;
      }
      pr.status = "superseded";
      pr.evidence.supersededBy = next.id;
      if (verdict) {
        pr.verdict = verdict;
        pr.evidence.note = `${verdict} to ${next.low ?? "?"}${next.high !== null && next.high !== next.low ? `–${next.high}` : ""}${next.unit === "%" ? "%" : ""} in the ${next.statedPeriod ?? "next"} call`;
      } else
        pr.evidence.note = `reiterated in the ${next.statedPeriod ?? "next"} call`;
    }

    // settle the latest statement of the chain (and any earlier one still open)
    for (const s of g) {
      const row = rows.get(s.id) as AdjudicatedRow;
      if (row.status !== "open") continue;
      if (s.revision === "withdrawn") {
        row.status = "withdrawn";
        row.verdict = "withdrawn";
        row.evidence.note = "management withdrew this guidance";
        continue;
      }
      if (s.derived) {
        row.status = "settled";
        row.verdict = "unverifiable";
        row.evidence.note = "derived figure";
        // A saved company interim must not survive on a slice the quote names.
        if (quoteLeavesCompanyLine(s, opts)) clearCompanyFigure(row);
        continue;
      }
      const family = resolveFamily(s.metric, s.quote, opts);
      const period = s.horizon ? parsePeriodLabel(s.horizon) : null;
      // (c) only explicit, cleanly typed statements are adjudicated
      if (s.typeIssue) {
        row.status = "settled";
        row.verdict = "unverifiable";
        row.evidence.note = `metric ambiguous — ${s.typeNote ?? "unit does not fit the metric"}; shown as a quote only`;
        continue;
      }
      if (!s.horizonEnd || !period) {
        const openEnded = /^(medium_term|long_term|near_term)$/.test(
          s.horizon ?? "",
        );
        if (openEnded) {
          row.evidence.note = `open-ended horizon (${s.horizon}); nothing to settle yet`;
        } else {
          row.status = "settled";
          row.verdict = "unverifiable";
          row.evidence.note = s.horizon
            ? `horizon unclear ('${s.horizon}'); shown as a quote only`
            : "horizon unclear (none stated); shown as a quote only";
        }
        continue;
      }
      const due = dateMs(s.horizonEnd) <= now;
      const scope = scopeOf(s.quote);
      const delivered =
        scope !== "company" && family !== "other"
          ? ({
              value: null,
              unit: null,
              source: null,
              settledBy: null,
              basis: null,
              note: QUANTITY_NOTE.segment,
            } as Delivered)
          : computeDelivered(family, s.metric, period, s.comparison, quarters);
      row.evidence.scope = scope;
      row.evidence.resultsSourceUrl = delivered.source;
      row.evidence.basis = delivered.basis;
      if (delivered.alt) row.evidence.alt = delivered.alt;

      const issue =
        s.comparison === "cc" || family === "other"
          ? null
          : quantityIssue({
              quote: s.quote,
              context: s.context,
              family,
              unit: s.unit,
              deliveredUnit: delivered.unit,
              deliveredValue: delivered.value,
              low: s.low,
              high: s.high,
            });
      if (issue) {
        // Due or not: never Beat/Miss a different quantity, and never print
        // the company line as "so far". `interim: null` is how the save drops
        // a figure already stored on this row. Open rows stay open; a due
        // row is unverifiable with the reason on the evidence note.
        clearCompanyFigure(row);
        if (!due) {
          row.evidence.note = `due after ${s.horizonEnd}`;
          continue;
        }
        row.status = "settled";
        row.verdict = "unverifiable";
        row.evidence.note = issue;
        if (issue === QUANTITY_NOTE.segment && scope === "company") {
          const named = CONTEXT_SCOPE_RE.exec(`${s.quote}\n${s.context ?? ""}`);
          if (named?.[1]) row.evidence.scope = named[1].toLowerCase();
        }
        continue;
      }

      if (!due) {
        // interim: show progress to date when the metric is computable
        // and it is the same quantity as the promise. `interim: null`
        // drops a company total already saved on this row.
        row.evidence.note = `due after ${s.horizonEnd}`;
        const candidate =
          delivered.value !== null
            ? {
                value: delivered.value,
                unit: delivered.unit,
                note: delivered.note,
              }
            : partialProgress(
                family,
                s.metric,
                period,
                s.comparison,
                quarters,
                now,
              );
        if (
          candidate &&
          interimFitsPromise({
            quote: s.quote,
            context: s.context,
            family,
            unit: s.unit,
            low: s.low,
            high: s.high,
            value: candidate.value,
            valueUnit: candidate.unit,
          })
        )
          row.evidence.interim = candidate;
        else if (candidate) row.evidence.interim = null;
        continue;
      }

      if (delivered.value === null) {
        // due but no actual: silent next transcript → not_addressed; else unverifiable/awaiting
        const silenceAfter = Math.max(
          dateMs(s.horizonEnd as string) + 45 * 86_400_000,
          s.statedAt + 86_400_000,
        );
        const later = transcriptsSorted.find(
          (t) => (t.publishedAt ?? 0) > silenceAfter,
        );
        const spokenLater = g.some(
          (o) => o.id !== s.id && o.statedAt > s.statedAt,
        );
        if (
          family === "other" ||
          s.comparison === "cc" ||
          scope !== "company"
        ) {
          row.status = "settled";
          row.verdict = "unverifiable";
          row.evidence.note =
            scope !== "company" && family !== "other" && s.comparison !== "cc"
              ? QUANTITY_NOTE.segment
              : delivered.note;
        } else if (later && !spokenLater) {
          row.status = "settled";
          row.verdict = "not_addressed";
          row.evidence.note = `${delivered.note}; the ${later.period ?? "next"} call did not revisit it`;
        } else {
          row.evidence.note = `${delivered.note} — awaiting exchange filings`;
        }
        row.delivered = { value: null, unit: null, source: null };
        continue;
      }

      row.delivered = {
        value: delivered.value,
        unit: delivered.unit,
        source: delivered.source,
      };
      row.settledByQuarter = delivered.settledBy;
      if (!s.isExplicit) {
        // adjectival band / direction-only: show the quote and the delivered figure, do not judge
        const band =
          s.low !== null || s.high !== null
            ? `adjectival band ${s.low ?? "…"}–${s.high ?? "…"}${s.unit === "%" ? "%" : ""}`
            : `direction-only ('${s.direction}')`;
        const prior =
          s.low === null && s.high === null
            ? computeDelivered(
                family,
                s.metric,
                previousYearPeriod(period),
                s.comparison,
                quarters,
              )
            : null;
        if (prior)
          row.evidence.priorYear = { value: prior.value, unit: prior.unit };
        row.status = "settled";
        row.verdict = "unverifiable";
        row.evidence.note = `${band} — not adjudicated (no explicit number); delivered ${delivered.value.toFixed(1)}${delivered.unit === "%" ? "%" : ""}`;
        row.evidence.deliveredNote = delivered.note;
        continue;
      }
      let result: { verdict: Verdict; rule: string };
      if (s.low !== null || s.high !== null) {
        result = compareBand(
          delivered.value,
          { low: s.low, high: s.high },
          {
            family,
            unit: s.unit,
            costLike: COST_LIKE.has(s.metric),
            approx: s.approx,
          },
        );
        if (delivered.alt && delivered.alt.value !== null) {
          const alt = compareBand(
            delivered.alt.value,
            { low: s.low, high: s.high },
            { family, unit: s.unit, costLike: false },
          );
          if (alt.verdict !== result.verdict) {
            result = {
              verdict: "unverifiable",
              rule: `ambiguous definition: EBITDA margin ${delivered.value.toFixed(1)}% → ${result.verdict}, EBIT margin ${delivered.alt.value.toFixed(1)}% → ${alt.verdict}`,
            };
          }
        }
      } else {
        // direction-only promise: compare with the prior-year reading of the same metric
        const prior = computeDelivered(
          family,
          s.metric,
          previousYearPeriod(period),
          s.comparison,
          quarters,
        );
        if (prior.value === null)
          result = {
            verdict: "unverifiable",
            rule: `no prior-year reading to judge '${s.direction}'`,
          };
        else
          result = compareDirection(
            delivered.value - prior.value,
            s.direction,
            family,
          );
        row.evidence.priorYear = { value: prior.value, unit: prior.unit };
      }
      row.status = "settled";
      row.verdict = result.verdict;
      row.evidence.rule = result.rule;
      row.evidence.note = `${delivered.note ?? ""}`.trim() || null;
      row.evidence.deliveredNote = delivered.note;
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.statedAt - a.statedAt || a.metric.localeCompare(b.metric),
  );
}

/** Year-to-date progress for an annual promise whose year has not ended. */
function partialProgress(
  family: MetricFamily,
  metric: string,
  period: FiscalPeriod,
  comparison: LedgerInput["comparison"],
  quarters: ResultsQuarter[],
  now: number,
): { value: number; unit: string | null; note: string } | null {
  if (period.kind !== "year" || family === "other") return null;
  const all = quarterEndsOf(period);
  const ends = all.filter(
    (e) => dateMs(e) <= now && quarters.some((q) => q.periodEnd === e),
  );
  if (!ends.length) return null;
  const prevAll = quarterEndsOf(previousYearPeriod(period));
  const prevEnds = ends.map((e) => prevAll[all.indexOf(e)] as string);
  const d = computeDelivered(family, metric, period, comparison, quarters, {
    ends,
    prevEnds,
  });
  if (d.value === null) return null;
  return {
    value: d.value,
    unit: d.unit,
    note: `${ends.length} of 4 quarters of ${period.label} (YTD): ${d.note ?? ""}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const FAMILY_WORD: Record<string, string> = {
  revenue: "revenue",
  revenue_growth: "growth",
  margin_ebitda: "margin",
  margin_ebit: "margin",
  margin_operating: "margin",
  margin_pbt: "PBT margin",
  margin_net: "net margin",
  ebitda: "EBITDA",
  ebitda_growth: "EBITDA growth",
  pat: "PAT",
  pat_growth: "PAT growth",
  tax_rate: "tax rate",
};

/** "2 of 3 promises settled: growth kept, margin missed · 1 cut · 2 unverifiable (capex, volume)" */
export function summarise(rows: AdjudicatedRow[]): string {
  const latest = rows.filter((r) => r.status !== "superseded");
  const due = latest.filter((r) => r.verdict !== null);
  const settled = due.filter(
    (r) =>
      r.verdict === "kept" || r.verdict === "beat" || r.verdict === "missed",
  );
  if (!rows.length) return "no management commitments extracted yet";
  const parts: string[] = [];
  const head = `${settled.length} of ${due.length || latest.length} promises settled`;
  const words = settled.map(
    (r) =>
      `${FAMILY_WORD[metricFamily(r.metric)] ?? r.metric.replace(/_/g, " ")} ${r.verdict}`,
  );
  parts.push(words.length ? `${head}: ${dedupeWords(words).join(", ")}` : head);
  const cuts = rows.filter((r) => r.verdict === "cut").length;
  const raised = rows.filter((r) => r.verdict === "raised").length;
  if (cuts) parts.push(`${cuts} cut`);
  if (raised) parts.push(`${raised} raised`);
  const withdrawn = latest.filter((r) => r.verdict === "withdrawn").length;
  if (withdrawn) parts.push(`${withdrawn} withdrawn`);
  const na = latest.filter((r) => r.verdict === "not_addressed").length;
  if (na) parts.push(`${na} not addressed`);
  const unv = latest.filter((r) => r.verdict === "unverifiable");
  if (unv.length)
    parts.push(
      `${unv.length} unverifiable (${dedupeWords(
        unv.map((r) => r.metric.replace(/_/g, " ")),
      )
        .slice(0, 4)
        .join(", ")})`,
    );
  const open = latest.filter((r) => r.status === "open").length;
  if (open) parts.push(`${open} open`);
  return parts.join(" · ");
}

function dedupeWords(xs: string[]): string[] {
  return [...new Set(xs)];
}

// ---------------------------------------------------------------------------
// DB orchestration
// ---------------------------------------------------------------------------

export interface SettleResult {
  rows: AdjudicatedRow[];
  summary: string;
  stats: Record<Verdict | "open" | "superseded", number>;
  /** transcript availability for the latest reported quarter (SEBI 5-working-day rule) */
  coverage: Awaited<ReturnType<typeof transcriptCoverage>> | null;
  /** set when the ledger is built from the annual report because no earnings-call transcript exists */
  sourceNote: string | null;
  /** grounding pass over the rows that were loaded (derived / retyped / still explicit) */
  grounding: {
    checked: number;
    dropped: number;
    retyped: number;
    explicit: number;
    ambiguous: number;
    qualitative: number;
  };
}

function evidenceOf(raw: string | null): Record<string, unknown> {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function statedAtOf(ev: Record<string, unknown>, fallback: number): number {
  const cd = ev.callDate;
  if (typeof cd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cd))
    return dateMs(cd) - 12 * 3_600_000;
  const pa = ev.publishedAt;
  if (typeof pa === "number") return pa;
  return fallback;
}

/** Load inputs for a company from the DB. */
/** Speaker turns for transcript docs, so a quote can see the question it answers. */
async function quoteTurnsFor(
  docIds: string[],
  kindById: Map<string, string>,
): Promise<Map<string, Array<{ role: string; text: string }>>> {
  const ids = [...new Set(docIds)].filter(
    (id) => kindById.get(id) === "transcript",
  );
  const out = new Map<string, Array<{ role: string; text: string }>>();
  if (!ids.length) return out;
  const pages = await db
    .select({
      docId: documentPages.docId,
      page: documentPages.page,
      text: documentPages.text,
    })
    .from(documentPages)
    .where(inArray(documentPages.docId, ids));
  const byDoc = new Map<string, { page: number; text: string }[]>();
  for (const p of pages) {
    const list = byDoc.get(p.docId) ?? [];
    list.push({ page: p.page, text: p.text });
    byDoc.set(p.docId, list);
  }
  for (const id of ids) {
    const ps = byDoc.get(id);
    if (!ps?.length) continue;
    ps.sort((a, b) => a.page - b.page);
    out.set(id, parseTranscript({ docId: id, pages: ps }).turns);
  }
  return out;
}

export async function loadLedgerInputs(isin: string): Promise<{
  inputs: LedgerInput[];
  quarters: ResultsQuarter[];
  transcripts: TranscriptMeta[];
  grounding: SettleResult["grounding"];
}> {
  const grows = await db.select().from(guidance).where(eq(guidance.isin, isin));
  const qrows = await db
    .select()
    .from(resultsQuarters)
    .where(eq(resultsQuarters.isin, isin));
  const drows = await db
    .select()
    .from(documents)
    .where(eq(documents.isin, isin));
  const ids = drows.map((d) => d.id);
  const metas = ids.length ? await db.select().from(documentMeta) : [];
  const metaById = new Map(
    metas.filter((m) => ids.includes(m.docId)).map((m) => [m.docId, m]),
  );
  const transcripts: TranscriptMeta[] = drows
    .filter((d) => d.kind === "transcript" && d.textStatus === "ok")
    .map((d) => ({
      docId: d.id,
      period: d.period,
      publishedAt: metaById.get(d.id)?.publishedAt ?? null,
    }));
  const quarters: ResultsQuarter[] = qrows.map((q) => ({
    isin: q.isin,
    periodEnd: q.periodEnd,
    basis: q.basis as ResultsQuarter["basis"],
    source: q.source as ResultsQuarter["source"],
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
    checks: { warnings: [] },
    sourceUrl: q.sourceUrl,
    filedAt: q.filedAt,
  }));
  // a statement must be traceable to stored page text (citations resolve); rows pointing at
  // documents without pages (UI fixtures, failed extractions) are ignored
  const pageCounts = await db
    .select({ docId: documentPages.docId, n: sql<number>`count(*)` })
    .from(documentPages)
    .where(
      inArray(
        documentPages.docId,
        [...new Set(grows.map((g) => g.docId))].concat("-"),
      ),
    )
    .groupBy(documentPages.docId);
  const withPages = new Set(
    pageCounts.filter((p) => Number(p.n) > 0).map((p) => p.docId),
  );
  const traceable = grows.filter((g) => withPages.has(g.docId));
  if (traceable.length !== grows.length)
    log.info(
      { isin, dropped: grows.length - traceable.length },
      "guidance rows without stored page text ignored",
    );
  // the same PDF ingested twice (NSE + BSE copies) yields identical quotes: keep the earliest row
  const seenQuote = new Set<string>();
  const uniqueRows = [...traceable]
    .sort((a, b) => a.createdAt - b.createdAt)
    .filter((g) => {
      const k = `${g.metric}|${g.horizon ?? ""}|${g.quote.toLowerCase().replace(/\s+/g, " ").trim()}`;
      if (seenQuote.has(k)) return false;
      seenQuote.add(k);
      return true;
    });
  const turnsByDoc = await quoteTurnsFor(
    uniqueRows.map((g) => g.docId),
    new Map(drows.map((d) => [d.id, d.kind])),
  );
  const grounding: SettleResult["grounding"] = {
    checked: 0,
    dropped: 0,
    retyped: 0,
    explicit: 0,
    ambiguous: 0,
    qualitative: 0,
  };
  const inputs: LedgerInput[] = uniqueRows.map((g) => {
    const ev = evidenceOf(g.evidenceJson);
    const asked = typeof ev.question === "string" ? ev.question : "";
    const beside = [asked, quoteContext(turnsByDoc.get(g.docId) ?? [], g.quote)]
      .filter((s) => s.trim())
      .join("\n");
    const rev = ev.revision;
    const cmp = ev.comparison;
    const assessed = assessGuidanceGrounding({
      quote: g.quote,
      metric: g.metric,
      low: g.low,
      high: g.high,
      unit: g.unit,
      isExplicit: ev.isExplicit === true,
      typeIssue: ev.typeIssue === true,
      typeNote: typeof ev.typeNote === "string" ? ev.typeNote : null,
    });
    const derived = assessed.derived || ev.derived === true;
    grounding.checked++;
    const action = assessed.action;
    if (action === "dropped") grounding.dropped++;
    else if (action === "retyped") grounding.retyped++;
    else if (action === "ambiguous") grounding.ambiguous++;
    else if (action === "explicit") grounding.explicit++;
    else grounding.qualitative++;
    return {
      id: g.id,
      isin: g.isin,
      docId: g.docId,
      speaker: g.speaker,
      role: g.role,
      page: g.page,
      quote: g.quote,
      metric: assessed.metric,
      direction: g.direction,
      low: derived ? null : assessed.low,
      high: derived ? null : assessed.high,
      unit: g.unit,
      horizon: g.horizon,
      horizonEnd:
        typeof ev.horizonEnd === "string"
          ? ev.horizonEnd
          : g.horizon
            ? (parsePeriodLabel(g.horizon)?.end ?? null)
            : null,
      isExplicit: derived ? false : assessed.isExplicit,
      approx: ev.approx === true,
      typeIssue: derived ? false : assessed.typeIssue,
      typeNote: derived ? "derived figure" : assessed.typeNote,
      derived,
      groundingAction: action,
      source: ev.source === "annual_report" ? "annual_report" : "transcript",
      revision:
        rev === "maintained" ||
        rev === "raised" ||
        rev === "cut" ||
        rev === "withdrawn"
          ? rev
          : "new",
      comparison:
        cmp === "yoy" || cmp === "qoq" || cmp === "absolute" || cmp === "cc"
          ? cmp
          : null,
      context: beside || null,
      statedAt: statedAtOf(ev, g.createdAt),
      statedPeriod:
        typeof ev.statedPeriod === "string" ? ev.statedPeriod : null,
      evidence: ev,
    };
  });
  return { inputs, quarters, transcripts, grounding };
}

/** IT services guide EBIT ("operating") margins; everyone else means EBITDA margin (OPM). */
export async function operatingMarginBasisFor(
  isin: string,
): Promise<AdjudicateOptions["operatingMarginBasis"]> {
  const c = (
    await db
      .select({ industry: companies.industry, sector: companies.sector })
      .from(companies)
      .where(eq(companies.isin, isin))
      .limit(1)
  )[0];
  const text = `${c?.industry ?? ""} ${c?.sector ?? ""}`;
  if (/software|information technology|computers|it services|it - /i.test(text))
    return "ebit";
  if (/bank|financ|nbfc|insurance|capital markets/i.test(text)) return "auto";
  return c ? "ebitda" : "auto";
}

/**
 * Evidence written back onto a guidance row. Extraction fields on `original`
 * stay; ledger fields come from this pass. A null `interim` means the promise
 * is not the company line, so a figure saved by an earlier settle is removed.
 */
export function mergeLedgerEvidence(
  original: Record<string, unknown>,
  row: Pick<AdjudicatedRow, "evidence" | "delivered">,
  repaired: {
    isExplicit: boolean;
    derived: boolean;
    typeIssue: boolean;
    typeNote: string | null;
  },
  settledAt: number = Date.now(),
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...original,
    ...row.evidence,
    isExplicit: repaired.isExplicit,
    derived: repaired.derived,
    typeIssue: repaired.typeIssue,
    typeNote: repaired.typeNote,
    delivered: row.delivered,
    settledAt,
  };
  if ("interim" in row.evidence && row.evidence.interim == null)
    delete merged.interim;
  return merged;
}

/** Adjudicate every statement of a company and write verdicts back (idempotent). */
export async function settleGuidance(
  isin: string,
  opts: { now?: number; write?: boolean } = {},
): Promise<SettleResult> {
  const { inputs, quarters, transcripts, grounding } =
    await loadLedgerInputs(isin);
  const basis = await operatingMarginBasisFor(isin);
  const rows = adjudicateAll(
    inputs,
    quarters,
    transcripts,
    opts.now ?? Date.now(),
    { operatingMarginBasis: basis },
  );
  const inputById = new Map(inputs.map((i) => [i.id, i]));
  if (opts.write !== false) {
    for (const r of rows) {
      const original = inputById.get(r.id)?.evidence ?? {};
      // keep extraction provenance, replace ledger fields
      const repaired = inputById.get(r.id);
      const merged = mergeLedgerEvidence(original, r, {
        isExplicit: repaired?.isExplicit === true,
        derived: repaired?.derived === true,
        typeIssue: repaired?.typeIssue === true,
        typeNote: repaired?.typeNote ?? null,
      });
      await db
        .update(guidance)
        .set({
          status: r.status,
          settledByQuarter: r.settledByQuarter,
          verdict: r.verdict,
          metric: repaired?.metric,
          low: repaired?.low ?? null,
          high: repaired?.high ?? null,
          evidenceJson: JSON.stringify(merged),
        })
        .where(eq(guidance.id, r.id));
    }
  }
  const stats = {
    kept: 0,
    beat: 0,
    missed: 0,
    cut: 0,
    raised: 0,
    withdrawn: 0,
    not_addressed: 0,
    unverifiable: 0,
    open: 0,
    superseded: 0,
  } as SettleResult["stats"];
  for (const r of rows) {
    if (r.verdict) stats[r.verdict]++;
    else if (r.status === "superseded") stats.superseded++;
    else stats.open++;
  }
  const summary = summarise(rows);
  let coverage: SettleResult["coverage"] = null;
  try {
    coverage = await transcriptCoverage(isin);
  } catch (e) {
    log.warn(
      { isin, err: e instanceof Error ? e.message : String(e) },
      "transcript coverage unavailable",
    );
  }
  const arRows = rows.filter((r) => r.evidence.source === "annual_report");
  const coverPending =
    coverage?.pending &&
    coverage.coverOnlyPeriods.includes(coverage.pending.period);
  const sourceNote =
    rows.length && arRows.length === rows.length
      ? `commitments taken from the ${inputs.find((i) => i.source === "annual_report")?.statedPeriod ?? "latest"} annual report — no earnings-call transcript is available for this company`
      : coverPending
        ? `the ${coverage?.pending?.period} transcript on file is a cover letter only — the earnings-call PDF was not recovered`
        : coverage?.coverOnlyPeriods.length && !coverage.latestTranscriptPeriod
          ? "transcripts were filed as cover letters only — showing annual-report commitments where available"
          : null;
  log.info({ isin, rows: rows.length, ...stats, grounding }, "ledger settled");
  return { rows, summary, stats, coverage, sourceNote, grounding };
}

/** Read-only ledger for the UI (no writes). */
export async function getLedger(isin: string): Promise<SettleResult> {
  return settleGuidance(isin, { write: false });
}
