/**
 * Presentation formatting for FINN — Indian number grouping, crore/lakh
 * compaction, signed deltas with a true minus, IST filing labels, quarter
 * labels, edition labels. Pure; no I/O; safe in server and client components.
 *
 * Rules (docs/research/07 §6.2): money in ₹ with en-IN grouping (1,23,456),
 * compact `L`/`cr` only in chips, U+2212 for minus, percentages one decimal,
 * margins in bp, "₹ cr" written once in a table header rather than per cell.
 */
import {
  formatIst,
  istDateKey,
  NSE_HOLIDAYS_2026,
  NSE_SPECIAL_SESSIONS,
  sessionType,
} from "./time";

export const MINUS = "\u2212";
export const EM_DASH = "\u2014";
export const CRORE = 1e7;
export const LAKH = 1e5;

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Indian digit grouping: the last three digits, then pairs.
 * groupIndian(123456) → "1,23,456"; groupIndian(1234.5, 1) → "1,234.5".
 * Negative values get a true minus.
 */
export function groupIndian(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return EM_DASH;
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [intPart, frac] = fixed.split(".");
  const s = intPart ?? "0";
  let grouped: string;
  if (s.length <= 3) grouped = s;
  else {
    const last3 = s.slice(-3);
    let head = s.slice(0, -3);
    const pairs: string[] = [];
    while (head.length > 2) {
      pairs.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) pairs.unshift(head);
    grouped = `${pairs.join(",")},${last3}`;
  }
  const out = frac !== undefined ? `${grouped}.${frac}` : grouped;
  return neg ? `${MINUS}${out}` : out;
}

/** Rupees → "₹ 1,23,456" (or "—" for null). */
export function formatInr(
  rupees: number | null | undefined,
  opts: { decimals?: number; symbol?: boolean } = {},
): string {
  if (rupees == null || !Number.isFinite(rupees)) return EM_DASH;
  const body = groupIndian(rupees, opts.decimals ?? 0);
  return opts.symbol === false ? body : `₹ ${body}`;
}

export function toCrore(rupees: number | null | undefined): number | null {
  if (rupees == null || !Number.isFinite(rupees)) return null;
  return rupees / CRORE;
}

/**
 * Rupees → crore with Indian grouping, unit omitted (the table header says
 * "₹ cr" once). formatCrore(3_32_861e7) → "3,32,861"; small values keep one
 * decimal so "8.69" does not collapse to "9".
 */
export function formatCrore(
  rupees: number | null | undefined,
  opts: { decimals?: number } = {},
): string {
  const cr = toCrore(rupees);
  if (cr == null) return EM_DASH;
  const decimals = opts.decimals ?? (Math.abs(cr) < 100 ? 1 : 0);
  return groupIndian(cr, decimals);
}

/**
 * Up to two significant decimals, trailing zeros stripped — so ₹9.99 L never
 * becomes "₹10 L" (the over-rounding trap in docs/research/07 §7.11).
 */
function compactNumber(v: number): string {
  const decimals = v < 10 ? 2 : v < 100 ? 1 : 0;
  return groupIndian(v, decimals)
    .replace(/\.(\d*?)0+$/, ".$1")
    .replace(/\.$/, "");
}

/**
 * Compact rupees for chips and headers, never over-rounded:
 *   ≥ 1 lakh crore → "₹ 3.33 L cr"
 *   ≥ 1 crore      → "₹ 56,616 cr" / "₹ 8.69 cr"
 *   ≥ 1 lakh       → "₹ 12.4 L" / "₹ 9.99 L"
 *   else           → "₹ 9,500"
 */
export function formatCompactInr(rupees: number | null | undefined): string {
  if (rupees == null || !Number.isFinite(rupees)) return EM_DASH;
  const neg = rupees < 0;
  const a = Math.abs(rupees);
  let body: string;
  if (a >= LAKH * CRORE) body = `${compactNumber(a / (LAKH * CRORE))} L cr`;
  else if (a >= CRORE) body = `${compactNumber(a / CRORE)} cr`;
  else if (a >= LAKH) body = `${compactNumber(a / LAKH)} L`;
  else body = groupIndian(a, 0);
  return `${neg ? MINUS : ""}₹ ${body}`;
}

/** Plain count with Indian grouping: 88,121,121 → "8,81,21,121". */
export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  return groupIndian(n, 0);
}

/** Compact count for volume chips: 8.81 cr / 22.8 L / 4,500. */
export function formatCompactCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return EM_DASH;
  const a = Math.abs(n);
  if (a >= CRORE) return `${compactNumber(a / CRORE)} cr`;
  if (a >= LAKH) return `${compactNumber(a / LAKH)} L`;
  return groupIndian(a, 0);
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

export type DeltaSign = "up" | "down" | "flat" | "none";

/** Direction of a delta; |x| below `eps` counts as flat (grey, no arrow). */
export function deltaSign(x: number | null | undefined, eps = 0.05): DeltaSign {
  if (x == null || !Number.isFinite(x)) return "none";
  if (Math.abs(x) < eps) return "flat";
  return x > 0 ? "up" : "down";
}

export function deltaArrow(x: number | null | undefined, eps = 0.05): string {
  const s = deltaSign(x, eps);
  return s === "up" ? "▲" : s === "down" ? "▼" : "";
}

/** Signed number with a true minus: formatSigned(-2.345, 1) → "−2.3". */
export function formatSigned(
  x: number | null | undefined,
  decimals = 1,
): string {
  if (x == null || !Number.isFinite(x)) return EM_DASH;
  const body = groupIndian(Math.abs(x), decimals);
  if (Math.abs(x) < 10 ** -decimals / 2) return body;
  return x > 0 ? `+${body}` : `${MINUS}${body}`;
}

/** "+9.8%" / "−2.3%" / "0.0%" / "—". */
export function formatPct(
  x: number | null | undefined,
  opts: { decimals?: number; signed?: boolean } = {},
): string {
  if (x == null || !Number.isFinite(x)) return EM_DASH;
  const d = opts.decimals ?? 1;
  if (opts.signed === false) return `${groupIndian(Math.abs(x), d)}%`;
  return `${formatSigned(x, d)}%`;
}

/** Basis points: formatBp(150) → "+150 bp". */
export function formatBp(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return EM_DASH;
  return `${formatSigned(Math.round(x), 0)} bp`;
}

/** Volume ratio: formatRatio(5.83) → "5.8×". */
export function formatRatio(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return EM_DASH;
  return `${groupIndian(x, x < 10 ? 1 : 0)}×`;
}

/** Percentage change between two values, null when the base is 0/null. */
export function pctChange(
  now: number | null | undefined,
  base: number | null | undefined,
): number | null {
  if (now == null || base == null || !base || !Number.isFinite(now))
    return null;
  if (!Number.isFinite(base)) return null;
  return ((now - base) / Math.abs(base)) * 100;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** '2026-09-30' → "Q2 FY27" (Indian fiscal year, April–March). */
export function quarterLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  if (!y || !m) return periodEnd;
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  const fyEnd = m >= 4 ? y + 1 : y;
  return `Q${q} FY${String(fyEnd).slice(-2)}`;
}

/** '2026-09-30' → "Jul–Sep 2026". */
export function quarterMonths(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  if (!y || !m) return periodEnd;
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const start = m - 2;
  return `${names[(start - 1 + 12) % 12]}–${names[m - 1]} ${y}`;
}

/** Fiscal label for a 'FY27'-style horizon or a period end. */
export function fyLabel(periodEnd: string): string {
  const [y, m] = periodEnd.split("-").map(Number);
  if (!y || !m) return periodEnd;
  return `FY${String(m >= 4 ? y + 1 : y).slice(-2)}`;
}

// ---------------------------------------------------------------------------
// IST time labels
// ---------------------------------------------------------------------------

export type MarketPhase =
  | "pre-open"
  | "during trading"
  | "after close"
  | "market holiday"
  | "weekend"
  | "special session";

function istHm(ms: number): number {
  const [h, m] = formatIst(ms, "HH:mm").split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Where in the Indian trading day an instant falls. */
export function marketPhase(ms: number): MarketPhase {
  const key = istDateKey(ms);
  const kind = sessionType(key);
  const hm = istHm(ms);
  if (kind === "holiday") return "market holiday";
  if (kind === "weekend") return "weekend";
  if (kind === "special") {
    const s = NSE_SPECIAL_SESSIONS[key];
    const [sh, sm] = (s?.start ?? "14:20").split(":").map(Number);
    const [eh, em] = (s?.end ?? "15:30").split(":").map(Number);
    const start = (sh ?? 0) * 60 + (sm ?? 0);
    const end = (eh ?? 0) * 60 + (em ?? 0);
    if (hm < start) return "pre-open";
    if (hm <= end) return "special session";
    return "after close";
  }
  if (hm < 9 * 60 + 15) return "pre-open";
  if (hm <= 15 * 60 + 30) return "during trading";
  return "after close";
}

/** Holiday name for an IST date key, if any. */
export function holidayName(dateKey: string): string | null {
  return NSE_HOLIDAYS_2026[dateKey] ?? null;
}

export interface FiledLabel {
  /** "18:42 IST" */
  time: string;
  /** "after close" … */
  phase: MarketPhase;
  /** "Fri 6 Nov" */
  day: string;
  /** "2 h ago" / "yesterday" / "Fri 6 Nov" */
  relative: string;
  /** "filed 18:42 IST · after close" */
  short: string;
  /** "Fri 6 Nov · 18:42 IST · after close" */
  long: string;
}

/** Relative wording in IST calendar terms. */
export function relativeIst(ms: number, now: number): string {
  const diff = now - ms;
  const dayMs = ms;
  const todayKey = istDateKey(now);
  const key = istDateKey(dayMs);
  if (diff < 0) return formatIst(ms, "EEE d MMM");
  if (key === todayKey) {
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)} h ago`;
  }
  const yesterdayKey = istDateKey(now - 86_400_000);
  if (key === yesterdayKey) return "yesterday";
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return formatIst(ms, "EEE d MMM");
  return formatIst(ms, "d MMM");
}

/** 'filed 18:42 IST · after close' family of labels for a filing instant. */
export function filedLabel(ms: number, now: number = Date.now()): FiledLabel {
  const time = `${formatIst(ms, "HH:mm")} IST`;
  const phase = marketPhase(ms);
  const day = formatIst(ms, "EEE d MMM");
  return {
    time,
    phase,
    day,
    relative: relativeIst(ms, now),
    short: `filed ${time} · ${phase}`,
    long: `${day} · ${time} · ${phase}`,
  };
}

/** "Evening edition · Sun 8 Nov" from the IST clock. */
export function editionLabel(now: number = Date.now()): string {
  const h = Number(formatIst(now, "H"));
  const edition = h < 12 ? "Morning" : h < 16 ? "Midday" : "Evening";
  return `${edition} edition · ${formatIst(now, "EEE d MMM")}`;
}

/** "Sunday 8 November · after close" style dateline. */
export function datelineLabel(now: number = Date.now()): string {
  const phase = marketPhase(now);
  const key = istDateKey(now);
  const holiday = holidayName(key);
  const suffix =
    phase === "market holiday" && holiday
      ? `market holiday · ${holiday}`
      : phase;
  return `${formatIst(now, "EEEE d MMMM")} · ${suffix}`;
}

/** Reading-time estimate for a brief: ~60 s per card, ~12 s per one-liner. */
export function readTime(tier1: number, tier2: number): string {
  const secs = 20 + tier1 * 60 + tier2 * 12;
  const mins = Math.max(1, Math.round(secs / 60));
  return `~${mins} min`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "2026-11-02" → "Mon 2 Nov" (IST calendar day). */
export function dayLabel(dateKey: string): string {
  return formatIst(dateKey, "EEE d MMM");
}

/** Title-case helper for category keys: "management_change" → "Management change". */
export function humanise(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Short category names for chips and glyph legends. */
export const CATEGORY_LABEL: Record<string, string> = {
  results: "Results",
  m_and_a: "M&A",
  fund_raise: "Fund raise",
  management_change: "Management",
  litigation: "Litigation",
  insider_trading: "Insider trades",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meets",
  credit_rating: "Credit rating",
  dividend: "Dividend",
  bonus_split: "Bonus / split",
  capex: "Capex",
  press_release: "Press release",
  postal_ballot: "Postal ballot",
  agm_egm: "AGM / EGM",
  pledging: "Pledge",
  unclassified: "Routine",
};

export function categoryLabel(cat: string): string {
  return CATEGORY_LABEL[cat] ?? humanise(cat);
}
