/**
 * Last equity session close. The book stores end-of-day bars. A name that
 * is not in the book still has a close on the latest NSE bhavcopy.
 */
import type { BhavcopyRow } from "@/engine/sources";
import { BhavcopyNotAvailable, fetchBhavcopy } from "@/engine/sources/bhavcopy";
import { dateKeyLabel } from "@/engine/sources/nse-mcp";
import { formatInr, groupIndian } from "@/lib/format";
import { logger } from "@/lib/logger";
import { lastMarketClose, previousTradingDay } from "@/lib/time";

const log = logger.child({ mod: "lib/sessionClose" });
const LOOKBACK = 4;

export interface SessionPrint {
  close: number;
  prevClose: number | null;
  date: string;
}

export function pickEquityClose(
  rows: readonly BhavcopyRow[],
  symbol: string,
): { close: number; prevClose: number | null } | null {
  const key = symbol.trim().toUpperCase();
  if (!key) return null;
  const hits = rows.filter((row) => row.TckrSymb.trim().toUpperCase() === key);
  const row = hits.find((item) => item.SctySrs === "EQ") ?? hits[0];
  if (!row || !Number.isFinite(row.ClsPric)) return null;
  return {
    close: row.ClsPric,
    prevClose: Number.isFinite(row.PrvsClsgPric) ? row.PrvsClsgPric : null,
  };
}

/** Latest published bhavcopy close for one symbol. Null when none exists. */
export async function latestEquityClose(
  symbol: string,
  now: Date = new Date(),
): Promise<SessionPrint | null> {
  let date: string;
  try {
    date = lastMarketClose(now).dateKey;
  } catch {
    return null;
  }
  for (let i = 0; i < LOOKBACK; i++) {
    try {
      const rows = await fetchBhavcopy(date);
      const hit = pickEquityClose(rows, symbol);
      if (hit) return { ...hit, date };
    } catch (error) {
      if (!(error instanceof BhavcopyNotAvailable)) {
        log.warn(
          {
            date,
            err: error instanceof Error ? error.message : String(error),
          },
          "session close lookup failed",
        );
      }
    }
    try {
      date = previousTradingDay(date);
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCloseSentence(
  symbol: string,
  close: number,
  date: string,
  changePct: number | null,
): string {
  const price = formatInr(close, { decimals: 2 });
  const when = dateKeyLabel(date) ?? date;
  if (changePct == null || !Number.isFinite(changePct)) {
    return `${symbol} closed at ${price} on ${when}.`;
  }
  const body = groupIndian(Math.abs(changePct), 2);
  const move =
    changePct > 0
      ? `up ${body}%`
      : changePct < 0
        ? `down ${body}%`
        : "unchanged";
  return `${symbol} closed at ${price} on ${when}, ${move}.`;
}

export function noSessionClose(symbol: string): string {
  return `I don\u2019t have a session close for ${symbol} yet. Open the company page, or Add it.`;
}
