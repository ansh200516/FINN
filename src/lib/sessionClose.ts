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

export type EquityLookup =
  | { status: "hit"; print: SessionPrint }
  | { status: "none" }
  | { status: "unread" };

/** True when this bar is already the last completed session. */
export function storedCoversSession(
  date: string,
  now: Date = new Date(),
): boolean {
  try {
    return date >= lastMarketClose(now).dateKey;
  } catch {
    return false;
  }
}

/**
 * The later session wins. A stored bar is kept when it is the same day or
 * newer. Nothing here invents a price.
 */
export function chooseSessionClose(
  stored: SessionPrint | null,
  printed: SessionPrint | null,
): { print: SessionPrint; source: "stored" | "bhavcopy" } | null {
  if (stored && printed) {
    if (printed.date > stored.date)
      return { print: printed, source: "bhavcopy" };
    return { print: stored, source: "stored" };
  }
  if (stored) return { print: stored, source: "stored" };
  if (printed) return { print: printed, source: "bhavcopy" };
  return null;
}

/**
 * Latest published bhavcopy close. `none` means a file was read and the
 * symbol was not in the recent sessions. `unread` means the check did not
 * finish, so an older stored bar is not confirmed as the last close.
 */
export async function lookupEquityClose(
  symbol: string,
  now: Date = new Date(),
): Promise<EquityLookup> {
  let date: string;
  try {
    date = lastMarketClose(now).dateKey;
  } catch {
    return { status: "unread" };
  }
  let read = false;
  let failed = false;
  for (let i = 0; i < LOOKBACK; i++) {
    try {
      const rows = await fetchBhavcopy(date);
      read = true;
      const hit = pickEquityClose(rows, symbol);
      if (hit) return { status: "hit", print: { ...hit, date } };
    } catch (error) {
      if (!(error instanceof BhavcopyNotAvailable)) {
        failed = true;
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
      break;
    }
  }
  if (failed || !read) return { status: "unread" };
  return { status: "none" };
}

/** Latest published bhavcopy close for one symbol. Null when none exists. */
export async function latestEquityClose(
  symbol: string,
  now: Date = new Date(),
): Promise<SessionPrint | null> {
  const found = await lookupEquityClose(symbol, now);
  return found.status === "hit" ? found.print : null;
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
