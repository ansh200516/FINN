/**
 * Headline guidance set next to the quarters already on screen.
 * A null ledger delivery means the row was not scored. It does not mean
 * the quarter is missing. Open is only for a horizon no quarter covers yet.
 */
import {
  type FiscalPeriod,
  parsePeriodLabel,
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
  verdict: "kept" | "missed" | "open";
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

/** Colour, capacity, and a named slice. Those stay on the company page. */
const ASIDE =
  /\b(festive(?:\s+season)?|bullish|bearish|gigawatts?|giga[\s-]?watts?|bess|solar\s+cells?|capacity|facilit(?:y|ies)|jio)\b/i;

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

/** Revenue, EBITDA, margin, or a growth range. Not a festive or capacity line. */
export function isHeadlinePromise(row: PromiseSource): boolean {
  if (row.status === "superseded" || row.status === "withdrawn") return false;
  const quote = (row.quote ?? "").replace(/\s+/g, " ").trim();
  const metric = metricKey(row);
  if (!quote || !hasBand(row)) return false;
  if (metric === "capacity" || ASIDE.test(quote)) return false;
  return HEADLINE.has(metric);
}

function clipWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
}

function num(value: number): string {
  return groupIndian(value, Number.isInteger(value) ? 0 : 1);
}

function promisedText(row: PromiseSource): string {
  const unit = row.unit ?? null;
  const suffix =
    unit === "%"
      ? "%"
      : unit === "bp"
        ? " bp"
        : unit === "INR" || unit === "INR_cr"
          ? " cr"
          : "";
  const low = finite(row.low);
  const high = finite(row.high);
  if (low != null && high != null && low !== high)
    return `${num(low)}–${num(high)}${suffix}`;
  const value = low ?? high;
  return value == null ? "" : `${num(value)}${suffix}`;
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
  return `${groupIndian(reading.value, decimals)} cr`;
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

function judge(
  actual: number,
  row: PromiseSource,
  kind: Reading["kind"],
): "kept" | "missed" {
  const low = finite(row.low);
  const high = finite(row.high);
  const lo = low ?? high;
  const hi = high ?? low;
  if (lo == null || hi == null) {
    return row.verdict === "missed" || row.verdict === "cut"
      ? "missed"
      : "kept";
  }
  const tol = (edge: number) =>
    kind === "margin"
      ? 0.5
      : kind === "yoy" || row.unit === "%"
        ? 1
        : Math.abs(edge) * 0.03;
  if (actual < lo - tol(lo)) return "missed";
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
    const pool = !horizon
      ? slices
      : !parsed
        ? []
        : slices.filter((slice) => {
            const quarter = parsePeriodLabel(slice.period);
            return quarter ? covers(parsed, quarter) : false;
          });
    const quote = clipWords(row.quote ?? "", 18);
    const promised = promisedText(row);
    if (!pool.length) {
      if (!horizon) continue;
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
      const reading = readMetric(row, latest) ?? ledgerReading(row);
      if (!reading) continue;
      out.push({
        period: periodLabel(horizon, latest.period),
        quote,
        promised,
        delivered: deliveredText(reading),
        verdict: judge(reading.value, row, reading.kind),
      });
    }
    if (out.length >= 8) break;
  }
  return out;
}

function countWord(n: number, lower: boolean): string {
  const word = COUNT[n] ?? String(n);
  return lower ? word.toLowerCase() : word;
}

function clause(
  n: number,
  kind: "kept" | "missed" | "open",
  lead: boolean,
): string {
  const word = countWord(n, !lead);
  if (kind === "kept") {
    return lead
      ? `${word} headline ${n === 1 ? "promise was" : "promises were"} kept`
      : `${word} ${n === 1 ? "was" : "were"} kept`;
  }
  if (kind === "missed") {
    return lead
      ? `${word} headline ${n === 1 ? "promise was" : "promises were"} missed`
      : `${word} ${n === 1 ? "was" : "were"} missed`;
  }
  return lead
    ? `${word} headline ${n === 1 ? "promise is" : "promises are"} still open`
    : `${word} ${n === 1 ? "is" : "are"} still open`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** Two sentences. Counts, then the decision. Never "delivered is null". */
export function comparisonBubble(rows: ComparisonRow[]): string {
  const kept = rows.filter((row) => row.verdict === "kept").length;
  const missed = rows.filter((row) => row.verdict === "missed").length;
  const open = rows.filter((row) => row.verdict === "open").length;
  const parts: string[] = [];
  if (kept) parts.push(clause(kept, "kept", parts.length === 0));
  if (missed) parts.push(clause(missed, "missed", parts.length === 0));
  if (open) parts.push(clause(open, "open", parts.length === 0));
  const lead = parts.length
    ? `${joinList(parts)}.`
    : "No headline promise is in this window.";
  return `${lead} The decision is yours.`;
}
