/**
 * Headline guidance set next to the quarters already on screen.
 * Each pair is one complete quote, what was promised, what was delivered,
 * and a chip. Open is only for a horizon no quarter covers yet.
 */
import {
  type FiscalPeriod,
  parsePeriodLabel,
  quarterEndsOf,
} from "@/engine/extract/transcript";
import type { ResultsCard } from "@/engine/types";
import type { ChatQuarter } from "@/lib/finnieTypes";
import { formatPct, groupIndian } from "@/lib/format";

export interface PromiseSource {
  quote?: string | null;
  metric?: string | null;
  horizon?: string | null;
  low?: number | null;
  high?: number | null;
  unit?: string | null;
  verdict?: string | null;
  status?: string | null;
  delivered?: { value?: number | null; unit?: string | null } | null;
}

export interface ComparisonRow {
  period: string;
  quote: string;
  promised: string;
  /** Null when no quarter covers the horizon yet. */
  delivered: string | null;
  verdict: "kept" | "beat" | "missed" | "open" | "unverifiable";
}

const HEADLINE = new Set([
  "revenue",
  "revenue_growth",
  "total_income",
  "ebitda",
  "ebitda_growth",
  "ebitda_margin",
  "ebit_margin",
  "operating_margin",
  "gross_margin",
  "pbt_margin",
  "net_margin",
  "pat",
  "pat_growth",
  "pbt",
  "nii",
  "nii_growth",
  "ppop",
  "ppop_growth",
  "nim",
]);

/**
 * Colour, capacity, and a festive aside stay on the company page.
 * Jio growth is a headline comment. The quote does not have to say "headline".
 */
const FESTIVE = /\bfestive(?:\s+season)?\b/i;
const COLOUR = /\b(bullish|bearish)\b/i;
const CAPACITY =
  /\b(gigawatts?|giga[\s-]?watts?|bess|solar\s+cells?|capacity|facilit(?:y|ies))\b/i;
const GROWTH_WORD = /\b(revenue|ebitda|margin|growth|jio)\b/i;
const TEEN = /\b(high|mid|low|upper|double)[\s-]+teens?\b/i;
const NOT_A_BUSINESS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "our",
  "its",
  "these",
  "those",
  "q1",
  "q2",
  "q3",
  "q4",
  "revenue",
  "ebitda",
  "pat",
  "pbt",
  "nii",
  "ppop",
  "margin",
  "growth",
  "year",
  "half",
  "them",
  "us",
  "me",
]);

const COUNT = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];

interface Reading {
  value: number;
  kind: "yoy" | "margin" | "level";
}

interface Slice {
  period: string;
  revenueYoy: number | null;
  ebitdaYoy: number | null;
  pbtYoy: number | null;
  patYoy: number | null;
  revenueCr: number | null;
  ebitdaCr: number | null;
  pbtCr: number | null;
  patCr: number | null;
  ebitdaMargin: number | null;
  pbtMargin: number | null;
  patMargin: number | null;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricKey(row: PromiseSource): string {
  return (row.metric ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function horizonText(row: PromiseSource): string {
  return (row.horizon ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function hasBand(row: PromiseSource): boolean {
  return finite(row.low) != null || finite(row.high) != null;
}

function isAside(row: PromiseSource): boolean {
  if (metricKey(row) === "capacity") return true;
  const quote = row.quote ?? "";
  return FESTIVE.test(quote) || COLOUR.test(quote) || CAPACITY.test(quote);
}

function mentionsGrowth(quote: string): boolean {
  return GROWTH_WORD.test(quote);
}

/**
 * Revenue, EBITDA, margin, Jio growth, or a guided range.
 * A numeric band is not required. The word "headline" is not required.
 */
export function isHeadlinePromise(row: PromiseSource): boolean {
  if (row.status === "superseded" || row.status === "withdrawn") return false;
  const quote = (row.quote ?? "").replace(/\s+/g, " ").trim();
  if (!quote || isAside(row)) return false;
  if (HEADLINE.has(metricKey(row))) return true;
  return hasBand(row) && mentionsGrowth(quote);
}

function isCurrentHorizon(horizon: string): boolean {
  const key = horizon
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return key === "medium term" || key === "near term" || key === "short term";
}

function qualitativePromise(quote: string): string {
  const teen = TEEN.exec(quote);
  if (teen) return teen[0].replace(/[\s-]+/g, " ").toLowerCase();
  if (/\bhigh single[\s-]+digit\b/i.test(quote)) return "high single digit";
  return "qualitative";
}

const QUOTE_MAX = 240;

function isStub(part: string): boolean {
  const words = part
    .replace(/[.!?…]+$/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 6) return false;
  if (TEEN.test(part)) return false;
  if (
    /\b(growth|guidance|revenue|margin|ebitda|pat|see|expect|visibility)\b/i.test(
      part,
    )
  ) {
    return false;
  }
  return true;
}

/** Drop a cut-off tail such as "and those…" so the quote ends on a clause. */
function danglingCut(part: string): string {
  return part
    .replace(/\s+(?:and|but|or|which|so)\s+\S{1,24}(?:…|\.{3})\s*$/i, "")
    .replace(/(?:…|\.{3})\s*$/g, "")
    .replace(/[,:;]\s*$/g, "")
    .trim();
}

function fitQuote(chosen: string): string {
  const cut = /(?:…|\.{3})\s*$/.test(chosen);
  let text = cut ? danglingCut(chosen) : chosen.replace(/\s+/g, " ").trim();
  if (!text) text = chosen.replace(/(?:…|\.{3})\s*$/g, "").trim();
  if (text.length <= QUOTE_MAX) {
    if (cut && text && !/[.!?]$/.test(text)) return `${text}.`;
    return text;
  }
  const guideAt = text.search(
    /\b(?:high|mid|low|upper|double)[\s-]+teens?\b|\bvisibility of\b/i,
  );
  if (guideAt >= 0) {
    const before = text.slice(0, guideAt);
    const startAt = Math.max(
      before.lastIndexOf(". "),
      before.lastIndexOf("; "),
    );
    const start = startAt >= 0 ? startAt + 2 : 0;
    let slice = text.slice(start).trim();
    if (slice.length > QUOTE_MAX) {
      const window = slice.slice(0, QUOTE_MAX);
      const guideInWindow = window.search(
        /\b(?:high|mid|low|upper|double)[\s-]+teens?\b|\bvisibility of\b/i,
      );
      const boundary = Math.max(
        window.lastIndexOf(", "),
        window.lastIndexOf("; "),
        window.lastIndexOf(". "),
      );
      if (guideInWindow >= 0 && boundary > guideInWindow) {
        slice = window
          .slice(0, boundary)
          .replace(/[,:;]\s*$/g, "")
          .trim();
      }
    }
    if (slice && !/[.!?]$/.test(slice)) return `${slice}.`;
    return slice;
  }
  const window = text.slice(0, QUOTE_MAX);
  const stop = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (stop >= 40) return window.slice(0, stop + 1).trim();
  return text;
}

/**
 * The sentence that states the promise. A transcript turn can hold several
 * sentences; the one with the figure or the phrase is the quote on the card.
 * A later guidance sentence wins over a short fragment. The cut stays on a
 * clause, about 240 characters, and does not stop mid-guidance.
 */
function promiseSentence(quote: string, promised: string): string {
  const clean = quote.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const parts = clean
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const digits = [...promised.matchAll(/\d+(?:\.\d+)?/g)].map(
    (match) => match[0] ?? "",
  );
  const numbered = parts.filter(
    (part) =>
      digits.length > 0 && digits.every((digit) => part.includes(digit)),
  );
  if (numbered.length) {
    const best = [...numbered].sort((a, b) => {
      const score = (part: string) =>
        (part.match(/\d/g)?.length ?? 0) + (/[.!?]$/.test(part) ? 1 : 0);
      return score(b) - score(a);
    });
    return fitQuote(best[0] ?? numbered[0] ?? clean);
  }
  const phrase = promised
    .replace(/%/g, "")
    .replace(/[–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const scoreOf = (part: string) => {
    const lower = part.toLowerCase();
    let score = 0;
    if (phrase && phrase !== "qualitative" && lower.includes(phrase))
      score += 4;
    if (digits.length && digits.every((digit) => part.includes(digit)))
      score += 3;
    if (TEEN.test(part)) score += 2;
    if (/[.!?]$/.test(part)) score += 1;
    if (/^(and|but|so|or|which)\b/i.test(part)) score -= 3;
    if (isStub(part)) score -= 5;
    return score;
  };
  const guided = parts.filter((part) => scoreOf(part) >= 2);
  const withoutStubs = parts.filter((part) => !isStub(part));
  const pool = guided.length
    ? guided
    : withoutStubs.length
      ? withoutStubs
      : parts;
  const ranked = [...pool].sort((a, b) => scoreOf(b) - scoreOf(a));
  return fitQuote(ranked[0] ?? clean);
}

/** "growth for Jio" names a business the consolidated quarter does not print. */
function namedLine(quote: string): string | null {
  if (/\bnew energy\b/i.test(quote)) return "new energy";
  if (/\bpiping\b/i.test(quote)) return "piping";
  if (/\bexports?\b/i.test(quote)) return "export";
  if (/\bjio\b/i.test(quote)) return "Jio";
  const re = /\bfor\s+([A-Za-z][A-Za-z0-9]*)\b/g;
  for (const match of quote.matchAll(re)) {
    const name = match[1] ?? "";
    const key = name.toLowerCase();
    if (!name || NOT_A_BUSINESS.has(key) || /^fy\d/.test(key)) continue;
    return name;
  }
  return null;
}

function lineName(row: PromiseSource): string {
  const metric = metricKey(row);
  if (metric.includes("ebitda") || metric.includes("ppop")) return "EBITDA";
  if (metric.includes("pat") || metric === "net_margin") return "PAT";
  if (metric.includes("pbt")) return "PBT";
  if (metric.includes("nii") || metric === "nim") return "NII";
  return "revenue";
}

const CRORE = 1e7;

/** Absolute rupees (unit INR, at least one crore) become crore. Crore stays crore. */
function asCrore(value: number, unit: string | null): number {
  if (unit === "INR" && Math.abs(value) >= CRORE) return value / CRORE;
  return value;
}

function isMoneyUnit(unit: string | null): boolean {
  return unit === "INR" || unit === "INR_cr";
}

function bandNumber(value: number, unit: string | null): string {
  const shown = isMoneyUnit(unit) ? asCrore(value, unit) : value;
  const decimals = isMoneyUnit(unit)
    ? Math.abs(shown) < 100
      ? 1
      : 0
    : Number.isInteger(shown)
      ? 0
      : 1;
  return groupIndian(shown, decimals);
}

function promisedText(row: PromiseSource): string {
  const unit = row.unit ?? null;
  if (unit === "USD") {
    const n = finite(row.low) ?? finite(row.high);
    if (n == null) return qualitativePromise(row.quote ?? "");
    if (Math.abs(n) >= 1_000_000) {
      const millions = n / 1_000_000;
      return `USD ${groupIndian(millions, Number.isInteger(millions) ? 0 : 1)} million`;
    }
    return `USD ${groupIndian(n, 0)}`;
  }
  const suffix =
    unit === "%" ? "%" : unit === "bp" ? " bp" : isMoneyUnit(unit) ? " cr" : "";
  const rupee = isMoneyUnit(unit) ? "₹ " : "";
  const low = finite(row.low);
  const high = finite(row.high);
  if (low != null && high != null && low !== high)
    return `${rupee}${bandNumber(low, unit)}–${bandNumber(high, unit)}${suffix}`;
  const value = low ?? high;
  if (value != null) return `${rupee}${bandNumber(value, unit)}${suffix}`;
  return qualitativePromise(row.quote ?? "");
}

type LevelField = "revenueCr" | "ebitdaCr" | "pbtCr" | "patCr";

/** A rupee total (not a percent, margin, or growth rate). */
function levelField(row: PromiseSource): LevelField | null {
  const unit = (row.unit ?? "").toLowerCase();
  if (unit === "%" || unit === "bp" || unit === "qualitative" || unit === "x")
    return null;
  const metric = metricKey(row);
  if (
    metric.endsWith("_growth") ||
    metric.includes("margin") ||
    metric === "nim"
  )
    return null;
  if (metric === "revenue" || metric === "total_income" || metric === "nii")
    return "revenueCr";
  if (metric === "ebitda" || metric === "ppop") return "ebitdaCr";
  if (metric === "pbt") return "pbtCr";
  if (metric === "pat") return "patCr";
  return null;
}

function spansMultiple(parsed: FiscalPeriod | null): parsed is FiscalPeriod {
  return parsed?.kind === "year" || parsed?.kind === "half";
}

function sliceCovering(pool: Slice[], end: string): Slice | undefined {
  return pool.find((slice) => {
    const parsed = parsePeriodLabel(slice.period);
    return parsed?.kind === "quarter" && parsed.end === end;
  });
}

/** Sum every quarter of a year or half. Null when any quarter is missing. */
function summedLevel(
  row: PromiseSource,
  pool: Slice[],
  period: FiscalPeriod,
): Reading | null {
  const field = levelField(row);
  if (!field) return null;
  let sum = 0;
  for (const end of quarterEndsOf(period)) {
    const value = sliceCovering(pool, end)?.[field];
    if (value == null) return null;
    sum += value;
  }
  return { value: sum, kind: "level" };
}

function ledgerVerdict(row: PromiseSource): "kept" | "beat" | "missed" | null {
  if (row.verdict === "kept" || row.verdict === "beat") return row.verdict;
  if (row.verdict === "missed" || row.verdict === "cut") return "missed";
  return null;
}

function ratio(part: number | null, base: number | null): number | null {
  if (part == null || base == null || base === 0) return null;
  return (part / base) * 100;
}

function slicesFrom(quarters: ChatQuarter[], cards?: ResultsCard[]): Slice[] {
  return quarters.slice(0, 8).map((quarter, index) => {
    const card =
      cards?.find((item) => item.fiscalLabel === quarter.period) ??
      cards?.[index];
    const fromCard = (metric: string, computed: number | null) => {
      const line = card?.headline?.find((row) => row.metric === metric);
      return line?.marginPct ?? computed;
    };
    const revenue = finite(quarter.revenue?.crore);
    const ebitda = finite(quarter.ebitda?.crore);
    const pbt = finite(quarter.pbt?.crore);
    const pat = finite(quarter.pat?.crore);
    return {
      period: quarter.period,
      revenueYoy: finite(quarter.revenue?.yoyPct),
      ebitdaYoy: finite(quarter.ebitda?.yoyPct),
      pbtYoy: finite(quarter.pbt?.yoyPct),
      patYoy: finite(quarter.pat?.yoyPct),
      revenueCr: revenue,
      ebitdaCr: ebitda,
      pbtCr: pbt,
      patCr: pat,
      ebitdaMargin: fromCard("ebitda", ratio(ebitda, revenue)),
      pbtMargin: fromCard("pbt", ratio(pbt, revenue)),
      patMargin: fromCard("pat", ratio(pat, revenue)),
    };
  });
}

function yoy(value: number | null): Reading | null {
  return value == null ? null : { value, kind: "yoy" };
}

function level(value: number | null): Reading | null {
  return value == null ? null : { value, kind: "level" };
}

function margin(value: number | null): Reading | null {
  return value == null ? null : { value, kind: "margin" };
}

function readMetric(row: PromiseSource, slice: Slice): Reading | null {
  const metric = metricKey(row);
  const unit = row.unit ?? null;
  if (
    metric === "ebitda_margin" ||
    metric === "ebit_margin" ||
    metric === "operating_margin" ||
    metric === "gross_margin"
  )
    return margin(slice.ebitdaMargin);
  if (metric === "pbt_margin") return margin(slice.pbtMargin);
  if (metric === "net_margin") return margin(slice.patMargin);
  if (metric === "revenue_growth" || metric === "nii_growth")
    return yoy(slice.revenueYoy);
  if (metric === "ebitda_growth" || metric === "ppop_growth")
    return yoy(slice.ebitdaYoy);
  if (metric === "pat_growth") return yoy(slice.patYoy);
  if (metric === "revenue" || metric === "total_income" || metric === "nii")
    return unit === "%" ? yoy(slice.revenueYoy) : level(slice.revenueCr);
  if (metric === "ebitda" || metric === "ppop")
    return unit === "%" ? yoy(slice.ebitdaYoy) : level(slice.ebitdaCr);
  if (metric === "pbt")
    return unit === "%" ? yoy(slice.pbtYoy) : level(slice.pbtCr);
  if (metric === "pat")
    return unit === "%" ? yoy(slice.patYoy) : level(slice.patCr);
  return null;
}

function ledgerReading(row: PromiseSource): Reading | null {
  const value = finite(row.delivered?.value);
  if (value == null) return null;
  const unit = row.delivered?.unit ?? row.unit ?? null;
  const metric = metricKey(row);
  if (unit === "%" || unit === "bp") {
    return {
      value,
      kind: metric.includes("margin") || metric === "nim" ? "margin" : "yoy",
    };
  }
  const crore = unit === "INR" && Math.abs(value) >= 1e7 ? value / 1e7 : value;
  return { value: crore, kind: "level" };
}

function deliveredText(reading: Reading): string {
  if (reading.kind === "yoy") return `${formatPct(reading.value)} YoY`;
  if (reading.kind === "margin")
    return formatPct(reading.value, { signed: false });
  const decimals = Math.abs(reading.value) < 100 ? 1 : 0;
  return `₹ ${groupIndian(reading.value, decimals)} cr`;
}

function covers(horizon: FiscalPeriod, quarter: FiscalPeriod): boolean {
  if (horizon.fy !== quarter.fy) return false;
  if (quarter.kind !== "quarter" || quarter.n == null) return false;
  if (horizon.kind === "year") return true;
  if (horizon.kind === "quarter") return horizon.n === quarter.n;
  if (horizon.kind === "half")
    return horizon.n === 2 ? quarter.n >= 3 : quarter.n <= 2;
  return false;
}

function withoutBand(row: PromiseSource): "kept" | "missed" | "unverifiable" {
  if (row.verdict === "missed" || row.verdict === "cut") return "missed";
  if (row.verdict === "kept" || row.verdict === "beat") return "kept";
  return "unverifiable";
}

function judge(
  actual: number,
  row: PromiseSource,
  kind: Reading["kind"],
): "kept" | "beat" | "missed" | "unverifiable" {
  const scale = (value: number) =>
    kind === "level" ? asCrore(value, row.unit ?? null) : value;
  const low = finite(row.low);
  const high = finite(row.high);
  const lo = low == null ? null : scale(low);
  const hi = high == null ? null : scale(high);
  if (lo == null && hi == null) return withoutBand(row);
  const tol = (edge: number) =>
    kind === "margin"
      ? 0.5
      : kind === "yoy" || row.unit === "%"
        ? 1
        : Math.abs(edge) * 0.03;
  if (lo != null && hi != null) {
    if (actual < lo - tol(lo)) return "missed";
    if (actual > hi + tol(hi)) return "beat";
    return "kept";
  }
  if (lo != null) {
    if (actual < lo - tol(lo)) return "missed";
    if (actual > lo + 2 * tol(lo)) return "beat";
    return "kept";
  }
  if (hi != null && actual > hi + tol(hi)) return "beat";
  return "kept";
}

function periodLabel(horizon: string, quarter: string): string {
  if (!horizon || horizon === quarter) return quarter;
  return `${horizon} · ${quarter}`;
}

/**
 * Headline rows only. Delivered comes from the quarter whose period sits
 * inside the horizon. Open when that horizon is still ahead of the quarters.
 */
export function comparisonsFor(
  quarters: ChatQuarter[],
  rows: PromiseSource[],
  cards?: ResultsCard[],
): ComparisonRow[] {
  const slices = slicesFrom(quarters, cards);
  const out: ComparisonRow[] = [];
  for (const row of rows) {
    if (!isHeadlinePromise(row)) continue;
    const horizon = horizonText(row);
    const parsed = horizon ? parsePeriodLabel(horizon) : null;
    // FY27 covers Q2 FY27. A medium-term comment is current guidance, so the
    // latest quarter on screen is the delivery to show.
    const pool =
      !horizon || isCurrentHorizon(horizon)
        ? slices
        : !parsed
          ? []
          : slices.filter((slice) => {
              const quarter = parsePeriodLabel(slice.period);
              return quarter ? covers(parsed, quarter) : false;
            });
    const full = (row.quote ?? "").replace(/\s+/g, " ").trim();
    const promised = promisedText(row);
    const quote = promiseSentence(full, promised);
    const segment = namedLine(quote) ?? namedLine(full);
    if (!pool.length) {
      if (!horizon || !hasBand(row)) continue;
      out.push({
        period: horizon,
        quote,
        promised,
        delivered: null,
        verdict: "open",
      });
    } else {
      const latest = pool[pool.length - 1];
      if (!latest) continue;
      // A full-year (or half-year) rupee band is not the latest quarter.
      // The ledger's delivered figure is that period; otherwise sum every
      // quarter of the horizon. A lone quarter must not be scored as the year.
      const multi = spansMultiple(parsed);
      const span = multi && levelField(row) != null;
      // A full-year margin is not one quarter. A growth rate can still
      // be read against the latest quarter inside that year.
      const marginYear =
        multi &&
        (metricKey(row).includes("margin") || metricKey(row) === "nim");
      const fromLedger = ledgerReading(row);
      const summed = span && parsed ? summedLevel(row, pool, parsed) : null;
      const reading = span
        ? (fromLedger ?? summed)
        : marginYear
          ? fromLedger
          : (readMetric(row, latest) ?? fromLedger);
      const period =
        span || marginYear ? horizon : periodLabel(horizon, latest.period);
      if (segment) {
        out.push({
          period,
          quote,
          promised,
          delivered: reading
            ? `${deliveredText(reading)} consolidated ${lineName(row)}, not ${segment}`
            : "not the consolidated line",
          verdict: "unverifiable",
        });
      } else if (!reading) {
        out.push({
          period,
          quote,
          promised,
          delivered:
            span || marginYear
              ? "not the full period"
              : "not the consolidated line",
          verdict: span || marginYear ? "unverifiable" : withoutBand(row),
        });
      } else {
        const settled = span || marginYear ? ledgerVerdict(row) : null;
        out.push({
          period,
          quote,
          promised,
          delivered: deliveredText(reading),
          verdict: settled ?? judge(reading.value, row, reading.kind),
        });
      }
    }
    if (out.length >= 6) break;
  }
  return out;
}

function countWord(n: number, lower: boolean): string {
  const word = COUNT[n] ?? String(n);
  return lower ? word.toLowerCase() : word;
}

function tallyWord(n: number, lead: boolean): string {
  if (n === 0) return lead ? "None" : "none";
  return countWord(n, !lead);
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * One clause for an empty comparison. Names what the filter dropped.
 * Never "no headline promise" when a growth comment is stored.
 */
function exclusionLead(sources: PromiseSource[]): string {
  if (!sources.length) return "No headline promise is in this window.";
  let capacity = false;
  let festive = false;
  let colour = false;
  let growth = false;
  for (const row of sources) {
    const quote = row.quote ?? "";
    if (FESTIVE.test(quote)) {
      festive = true;
      continue;
    }
    if (COLOUR.test(quote)) {
      colour = true;
      continue;
    }
    if (metricKey(row) === "capacity" || CAPACITY.test(quote)) {
      capacity = true;
      continue;
    }
    if (isHeadlinePromise(row) || mentionsGrowth(quote)) growth = true;
  }
  const bits: string[] = [];
  if (capacity) bits.push("capacity");
  if (festive) bits.push("festive-season");
  if (colour) bits.push("colour");
  const remarks = bits.length ? `${joinList(bits)} remarks` : "";
  if (growth && remarks) {
    return `The stored comments are ${remarks}, and a growth comment has no numeric range for these quarters.`;
  }
  if (growth) {
    return "A growth comment is in the rows, and it has no numeric range for these quarters.";
  }
  if (remarks)
    return `The stored comments are ${remarks}, not a revenue range.`;
  return "No headline promise is in this window.";
}

/** One sentence. Counts kept, missed, and unverifiable. */
export function comparisonBubble(
  rows: ComparisonRow[],
  sources: PromiseSource[] = [],
): string {
  if (!rows.length) return exclusionLead(sources);
  const kept = rows.filter(
    (row) => row.verdict === "kept" || row.verdict === "beat",
  ).length;
  const missed = rows.filter((row) => row.verdict === "missed").length;
  const unverifiable = rows.filter(
    (row) => row.verdict === "unverifiable",
  ).length;
  const open = rows.filter((row) => row.verdict === "open").length;
  const parts = [
    `${tallyWord(kept, true)} kept`,
    `${tallyWord(missed, false)} missed`,
    `${tallyWord(unverifiable, false)} unverifiable`,
  ];
  if (open) parts.push(`${tallyWord(open, false)} still open`);
  return `${parts.join(", ")}.`;
}
