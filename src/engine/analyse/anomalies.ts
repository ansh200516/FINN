/**
 * EOD anomalies — pure functions over PriceBar[] (one ISIN, ascending dates).
 *
 * - volume_ratio: volume ÷ mean volume of the previous `lookbackDays` NORMAL
 *   sessions (special sessions such as the 8 Nov 2026 Muhurat hour are excluded
 *   from the baseline AND never scored — docs/research/04 §1, 09 F28).
 * - price_move: close vs the bar's own prevClose (bhavcopy PrvsClsgPric; falls
 *   back to the previous bar's close). Corporate-action days (ex-dividend /
 *   bonus / split record dates passed in) are suppressed for price moves.
 */
import type { Anomaly, PriceBar } from "../types";

export interface AnomalyOptions {
  /** fire when volume ≥ ratio × baseline (default 2.0) */
  volumeRatio: number;
  /** fire when |move| ≥ pct (default 5) */
  pricePct: number;
  /** baseline sessions (default 20) */
  lookbackDays: number;
  /** minimum normal sessions in the baseline before scoring volume (default 10) */
  minBaselineDays?: number;
  /** IST date keys to skip for price moves (ex-dates, splits, bonuses) */
  corporateActionDates?: ReadonlySet<string>;
}

export const DEFAULT_ANOMALY_OPTIONS: AnomalyOptions = {
  volumeRatio: 2.0,
  pricePct: 5,
  lookbackDays: 20,
  minBaselineDays: 10,
};

export interface BarMetrics {
  date: string;
  pct: number | null;
  volumeRatio: number | null;
  baselineAvg: number | null;
  baselineDays: number;
  sessionType: PriceBar["sessionType"];
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

function fmtVol(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} lakh`;
  return fmtInt(n);
}

/** Volume baseline for bar `i`: mean of up to `lookback` previous normal-session volumes. */
export function volumeBaseline(
  bars: PriceBar[],
  i: number,
  lookback: number,
): { avg: number | null; n: number } {
  let sum = 0;
  let n = 0;
  for (let j = i - 1; j >= 0 && n < lookback; j--) {
    const b = bars[j];
    if (!b || b.sessionType !== "normal") continue;
    if (
      b.volume === null ||
      b.volume === undefined ||
      !Number.isFinite(b.volume)
    )
      continue;
    sum += b.volume;
    n++;
  }
  return { avg: n ? sum / n : null, n };
}

/** Per-bar metrics (pct move, volume ratio) with the special-session rules applied. */
export function barMetrics(
  bars: PriceBar[],
  opts: Partial<AnomalyOptions> = {},
): BarMetrics[] {
  const o = { ...DEFAULT_ANOMALY_OPTIONS, ...opts };
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const out: BarMetrics[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i] as PriceBar;
    let pct: number | null = null;
    let prev = b.prevClose;
    if ((prev === null || prev === undefined || prev <= 0) && i > 0)
      prev = sorted[i - 1]?.close ?? null;
    if (b.close !== null && prev !== null && prev !== undefined && prev > 0)
      pct = ((b.close as number) / prev - 1) * 100;
    const base = volumeBaseline(sorted, i, o.lookbackDays);
    let ratio: number | null = null;
    if (
      b.sessionType === "normal" &&
      b.volume !== null &&
      base.avg !== null &&
      base.avg > 0 &&
      base.n >= (o.minBaselineDays ?? 10)
    ) {
      ratio = (b.volume as number) / base.avg;
    }
    out.push({
      date: b.date,
      pct,
      volumeRatio: ratio,
      baselineAvg: base.avg,
      baselineDays: base.n,
      sessionType: b.sessionType,
    });
  }
  return out;
}

/** Pure: scan bars for volume/price anomalies (special sessions excluded from averages and never fired). */
export function detectAnomalies(
  bars: PriceBar[],
  opts: Partial<AnomalyOptions> = {},
): Anomaly[] {
  const o = { ...DEFAULT_ANOMALY_OPTIONS, ...opts };
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const metrics = barMetrics(sorted, o);
  const out: Anomaly[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i] as PriceBar;
    const m = metrics[i] as BarMetrics;
    if (b.sessionType !== "normal") continue;
    if (m.volumeRatio !== null && m.volumeRatio >= o.volumeRatio) {
      out.push({
        isin: b.isin,
        date: b.date,
        kind: "volume_ratio",
        value: Number(m.volumeRatio.toFixed(2)),
        threshold: o.volumeRatio,
        summary: `Volume ${m.volumeRatio.toFixed(1)}× the ${m.baselineDays}-day average (${fmtVol(b.volume ?? 0)} vs ${fmtVol(m.baselineAvg ?? 0)})`,
      });
    }
    if (m.pct !== null && Math.abs(m.pct) >= o.pricePct) {
      if (o.corporateActionDates?.has(b.date)) continue;
      const prev = b.prevClose ?? sorted[i - 1]?.close ?? 0;
      out.push({
        isin: b.isin,
        date: b.date,
        kind: "price_move",
        value: Number(m.pct.toFixed(2)),
        threshold: o.pricePct,
        summary: `${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}% vs previous close (₹${prev.toLocaleString("en-IN")} → ₹${(b.close ?? 0).toLocaleString("en-IN")})`,
      });
    }
  }
  return out;
}

/**
 * Record / ex-dates that should suppress "price move" alerts, parsed from
 * announcement subjects such as "Record date for the purpose of Dividend is
 * 12-Nov-2026" (dividend, bonus, split). Returns IST date keys.
 */
export function corporateActionDatesFrom(
  items: Array<{
    category: string;
    subject: string;
    voiceSummary?: string | null;
  }>,
  parseDate: (s: string) => string | null,
): Set<string> {
  const out = new Set<string>();
  const re =
    /(record date|ex-?date|book closure)[^.]{0,80}?(\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})/i;
  for (const it of items) {
    if (!/dividend|bonus_split/.test(it.category)) continue;
    const m = re.exec(`${it.subject} ${it.voiceSummary ?? ""}`);
    if (!m?.[2]) continue;
    const key = parseDate(m[2]);
    if (key) out.add(key);
  }
  return out;
}
