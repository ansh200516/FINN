/**
 * Upstox unauthenticated historical-candle API — single-symbol EOD fallback
 * when a bhavcopy is missing (docs/research/04 §2.4, verified 8 Nov 2026:
 * 200 in 0.09–0.13 s, 63-call burst OK, no auth header).
 *
 *   GET https://api.upstox.com/v3/historical-candle/NSE_EQ%7C{ISIN}/days/1/{to}/{from}
 *   → { status: "success", data: { candles: [[ "2026-11-06T00:00:00+05:30", o, h, l, c, volume, oi ], ... ] } }  (newest first)
 *
 * Keyed by ISIN, so symbol renames do not matter. Behind a feature flag
 * (FINN_UPSTOX_FALLBACK=true) because the no-auth behaviour is observed, not
 * documented; the primary EOD source remains the NSE bhavcopy.
 */
import { logger } from "@/lib/logger";
import type { PriceBar, SessionType } from "../types";
import { bytesToText, httpGet } from "./nse-announcements";

const log = logger.child({ mod: "engine/sources/upstox" });

export function upstoxEnabled(): boolean {
  return (process.env.FINN_UPSTOX_FALLBACK ?? "").toLowerCase() === "true";
}

export function upstoxCandleUrl(
  isin: string,
  fromKey: string,
  toKey: string,
): string {
  return `https://api.upstox.com/v3/historical-candle/NSE_EQ%7C${encodeURIComponent(isin)}/days/1/${toKey}/${fromKey}`;
}

type Candle = [string, number, number, number, number, number, number?];

export function parseUpstoxBody(
  text: string,
  isin: string,
  sessionTypeFor: (dateKey: string) => SessionType,
): PriceBar[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`upstox body is not JSON: ${text.slice(0, 80)}`);
  }
  const j = json as { status?: string; data?: { candles?: unknown } };
  if (j.status !== "success" || !j.data || !Array.isArray(j.data.candles)) {
    throw new Error(`upstox unexpected body: ${text.slice(0, 120)}`);
  }
  const bars: PriceBar[] = [];
  for (const c of j.data.candles as Candle[]) {
    if (!Array.isArray(c) || c.length < 6) continue;
    const date = String(c[0]).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    bars.push({
      isin,
      date,
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      prevClose: null,
      volume: c[5],
      turnover: null,
      trades: null,
      sessionType: sessionTypeFor(date),
    });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  // prevClose from the preceding candle (Upstox does not supply it)
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (prev && cur) cur.prevClose = prev.close;
  }
  return bars;
}

/** Daily candles for one ISIN in [fromKey, toKey] (IST date keys), ascending. */
export async function fetchUpstoxDaily(
  isin: string,
  fromKey: string,
  toKey: string,
  sessionTypeFor: (dateKey: string) => SessionType,
): Promise<PriceBar[]> {
  if (!upstoxEnabled()) {
    throw new Error("Upstox fallback disabled (set FINN_UPSTOX_FALLBACK=true)");
  }
  const url = upstoxCandleUrl(isin, fromKey, toKey);
  const res = await httpGet(url, {
    headers: { Accept: "application/json" },
    timeoutMs: 20_000,
    retries: 1,
    minIntervalMs: 250,
  });
  const bars = parseUpstoxBody(bytesToText(res.bytes), isin, sessionTypeFor);
  log.info(
    { isin, from: fromKey, to: toKey, bars: bars.length, ms: res.latencyMs },
    "upstox candles fetched",
  );
  return bars;
}
