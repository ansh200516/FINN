/**
 * Price-series presentation helpers. Pure; no I/O.
 *
 * A special session (Muhurat) is a real print but not a comparable one: the
 * headline price is the last NORMAL close and the special session is a
 * footnote with its own move and a volume ratio against normal sessions.
 */
import { NSE_SPECIAL_SESSIONS } from "@/lib/time";
import type { PriceSeries } from "./model";

export interface SpecialNote {
  name: string;
  /** "Muhurat" | "special" — short word for captions */
  short: string;
  dateKey: string;
  close: number | null;
  pct: number | null;
  /** volume ÷ mean volume of the trailing normal sessions (≤ 20); null when unknown */
  volumeRatio: number | null;
}

export interface PriceHeadline {
  /** index into the series of the headline (last normal) bar; −1 when none */
  index: number;
  close: number | null;
  pct: number | null;
  dateKey: string | null;
  /** set when the newest bar is a special session */
  special: SpecialNote | null;
  /** count of special sessions in the series */
  specialCount: number;
}

function pctOf(now: number | null, base: number | null): number | null {
  if (now == null || base == null || !base) return null;
  return ((now - base) / Math.abs(base)) * 100;
}

export function priceHeadline(p: PriceSeries): PriceHeadline {
  const n = p.closes.length;
  const types = p.sessionTypes ?? [];
  const isSpecial = (i: number) => types[i] === "special";
  let idx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (!isSpecial(i) && p.closes[i] != null) {
      idx = i;
      break;
    }
  }
  const specialCount = types.filter((t) => t === "special").length;
  // the headline close is the last normal bar; its base is the previous normal bar
  let baseIdx = -1;
  for (let i = idx - 1; i >= 0; i--) {
    if (!isSpecial(i) && p.closes[i] != null) {
      baseIdx = i;
      break;
    }
  }
  const close = idx >= 0 ? (p.closes[idx] ?? null) : null;
  const pct =
    idx >= 0
      ? baseIdx >= 0
        ? pctOf(close, p.closes[baseIdx] ?? null)
        : idx === n - 1
          ? p.lastPct
          : null
      : null;

  let special: SpecialNote | null = null;
  const lastI = n - 1;
  if (lastI >= 0 && isSpecial(lastI)) {
    const dateKey = p.dates[lastI] ?? "";
    const name = NSE_SPECIAL_SESSIONS[dateKey]?.name ?? "Special session";
    const normalVols: number[] = [];
    for (let i = lastI - 1; i >= 0 && normalVols.length < 20; i--) {
      const v = p.volumes[i];
      if (!isSpecial(i) && typeof v === "number" && v > 0) normalVols.push(v);
    }
    const avg = normalVols.length
      ? normalVols.reduce((s, v) => s + v, 0) / normalVols.length
      : null;
    const vol = p.volumes[lastI];
    special = {
      name,
      short: /muhurat/i.test(name) ? "Muhurat" : "special",
      dateKey,
      close: p.closes[lastI] ?? null,
      pct: pctOf(p.closes[lastI] ?? null, close),
      volumeRatio: avg && typeof vol === "number" ? vol / avg : null,
    };
  }
  return {
    index: idx,
    close,
    pct,
    dateKey: idx >= 0 ? (p.dates[idx] ?? null) : null,
    special,
    specialCount,
  };
}

/** "thin volume (0.1× avg)" / "heavy volume (2.3× avg)" / "volume n/a". */
export function volumeWord(ratio: number | null): string {
  if (ratio == null) return "volume n/a";
  const r = ratio < 10 ? ratio.toFixed(1) : Math.round(ratio).toString();
  if (ratio < 0.5) return `thin volume (${r}× avg)`;
  if (ratio > 1.5) return `heavy volume (${r}× avg)`;
  return `volume ${r}× avg`;
}
