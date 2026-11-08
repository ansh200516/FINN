/**
 * Prices: NSE bhavcopy rows → `prices` (one row per ISIN per IST date),
 * session_type from lib/time (Muhurat = 'special'). Upstox is the per-ISIN
 * fallback when a trading day's bhavcopy is missing and the feature flag is on.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { prices } from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  isTradingDay,
  istDateKey,
  sessionType,
  tradingDaysBetween,
} from "@/lib/time";
import { BhavcopyNotAvailable, fetchBhavcopy } from "../sources/bhavcopy";
import type { BhavcopyRow } from "../sources/index";
import { fetchUpstoxDaily, upstoxEnabled } from "../sources/upstox";
import type { PriceBar, SessionType } from "../types";
import { listCompanies } from "./companies";
import type { IngestSummary } from "./index";

const log = logger.child({ mod: "engine/ingest/prices" });

export function sessionTypeFor(dateKey: string): SessionType {
  return sessionType(dateKey) === "special" ? "special" : "normal";
}

function numOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/** Bhavcopy rows → PriceBars for the wanted ISINs (EQ preferred when an ISIN appears under several series). */
export function bhavRowsToBars(
  rows: BhavcopyRow[],
  dateKey: string,
  isins: ReadonlySet<string>,
): PriceBar[] {
  const picked = new Map<string, BhavcopyRow>();
  for (const r of rows) {
    if (!isins.has(r.ISIN)) continue;
    const prev = picked.get(r.ISIN);
    if (!prev || (prev.SctySrs !== "EQ" && r.SctySrs === "EQ"))
      picked.set(r.ISIN, r);
  }
  const st = sessionTypeFor(dateKey);
  return [...picked.values()].map((r) => ({
    isin: r.ISIN,
    date: dateKey,
    open: numOrNull(r.OpnPric),
    high: numOrNull(r.HghPric),
    low: numOrNull(r.LwPric),
    close: numOrNull(r.ClsPric),
    prevClose: numOrNull(r.PrvsClsgPric),
    volume: Number.isFinite(r.TtlTradgVol) ? Math.round(r.TtlTradgVol) : null,
    turnover: numOrNull(r.TtlTrfVal),
    trades: Number.isFinite(r.TtlNbOfTxsExctd)
      ? Math.round(r.TtlNbOfTxsExctd)
      : null,
    sessionType: st,
  }));
}

export async function upsertBars(
  bars: PriceBar[],
  source = "nse_bhav",
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    fetched: bars.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  if (bars.length === 0) return summary;
  const dates = [...new Set(bars.map((b) => b.date))];
  const isins = [...new Set(bars.map((b) => b.isin))];
  const existing = await db
    .select({ isin: prices.isin, date: prices.date })
    .from(prices)
    .where(and(inArray(prices.isin, isins), inArray(prices.date, dates)));
  const have = new Set(existing.map((e) => `${e.isin}|${e.date}`));
  for (const b of bars) {
    try {
      await db
        .insert(prices)
        .values({
          isin: b.isin,
          date: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          prevClose: b.prevClose,
          volume: b.volume,
          turnover: b.turnover,
          trades: b.trades,
          sessionType: b.sessionType,
          source,
        })
        .onConflictDoUpdate({
          target: [prices.isin, prices.date],
          set: {
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            prevClose: b.prevClose,
            volume: b.volume,
            turnover: b.turnover,
            trades: b.trades,
            sessionType: b.sessionType,
            source,
          },
        });
      if (have.has(`${b.isin}|${b.date}`)) summary.updated++;
      else summary.inserted++;
    } catch (e) {
      summary.errors.push(
        `${b.isin} ${b.date}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return summary;
}

/** Upsert EOD bars for one IST date (fetches the bhavcopy unless bars are supplied). */
export async function ingestPrices(
  dateKey: string,
  bars?: PriceBar[],
): Promise<IngestSummary> {
  if (bars) return upsertBars(bars);
  if (!isTradingDay(dateKey)) {
    log.info({ dateKey }, "not a trading day — skipped");
    return { fetched: 0, inserted: 0, updated: 0, skipped: 1, errors: [] };
  }
  const isins = new Set((await listCompanies()).map((c) => c.isin));
  try {
    const rows = await fetchBhavcopy(dateKey);
    const out = bhavRowsToBars(rows, dateKey, isins);
    const s = await upsertBars(out);
    log.info(
      {
        dateKey,
        marketRows: rows.length,
        ours: out.length,
        inserted: s.inserted,
        updated: s.updated,
      },
      "prices ingested",
    );
    return s;
  } catch (e) {
    if (e instanceof BhavcopyNotAvailable) {
      log.warn(
        { dateKey },
        "bhavcopy not available (holiday or not yet published)",
      );
      return {
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 1,
        errors: [`${dateKey}: ${e.message}`],
      };
    }
    throw e;
  }
}

export interface IngestRangeResult {
  days: string[];
  missing: string[];
  summary: IngestSummary;
  upstoxFilled: number;
  elapsedMs: number;
}

/** Every trading day in [fromKey, toKey]; missing bhavcopies optionally back-filled from Upstox per ISIN. */
export async function ingestPriceRange(
  fromKey: string,
  toKey: string,
  o: { upstox?: boolean } = {},
): Promise<IngestRangeResult> {
  const started = Date.now();
  const days = tradingDaysBetween(fromKey, toKey);
  const summary: IngestSummary = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };
  const missing: string[] = [];
  for (const d of days) {
    const s = await ingestPrices(d);
    summary.fetched += s.fetched;
    summary.inserted += s.inserted;
    summary.updated += s.updated;
    summary.skipped += s.skipped;
    if (s.skipped && s.errors.length) missing.push(d);
    summary.errors.push(...s.errors);
  }
  let upstoxFilled = 0;
  if (missing.length && (o.upstox ?? upstoxEnabled())) {
    const companies = await listCompanies();
    for (const c of companies) {
      try {
        const bars = await fetchUpstoxDaily(
          c.isin,
          fromKey,
          toKey,
          sessionTypeFor,
        );
        const fill = bars.filter((b) => missing.includes(b.date));
        if (fill.length) {
          const s = await upsertBars(fill, "upstox");
          upstoxFilled += s.inserted + s.updated;
        }
      } catch (e) {
        summary.errors.push(
          `upstox ${c.nseSymbol}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  const elapsedMs = Date.now() - started;
  log.info(
    {
      days: days.length,
      missing,
      inserted: summary.inserted,
      updated: summary.updated,
      upstoxFilled,
      ms: elapsedMs,
    },
    "price range ingested",
  );
  return { days, missing, summary, upstoxFilled, elapsedMs };
}

/** Bars for one ISIN in [fromKey, toKey], ascending by date. */
export async function loadBars(
  isin: string,
  fromKey: string,
  toKey: string,
): Promise<PriceBar[]> {
  const rows = await db
    .select()
    .from(prices)
    .where(
      and(
        eq(prices.isin, isin),
        gte(prices.date, fromKey),
        lte(prices.date, toKey),
      ),
    );
  return rows
    .map((r) => ({
      isin: r.isin,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      prevClose: r.prevClose,
      volume: r.volume,
      turnover: r.turnover,
      trades: r.trades,
      sessionType: (r.sessionType === "special"
        ? "special"
        : "normal") as SessionType,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Bars for many ISINs at once (map by ISIN, ascending by date). */
export async function loadBarsMany(
  isins: string[],
  fromKey: string,
  toKey: string,
): Promise<Map<string, PriceBar[]>> {
  const out = new Map<string, PriceBar[]>();
  if (isins.length === 0) return out;
  const rows = await db
    .select()
    .from(prices)
    .where(
      and(
        inArray(prices.isin, isins),
        gte(prices.date, fromKey),
        lte(prices.date, toKey),
      ),
    );
  for (const r of rows) {
    const arr = out.get(r.isin) ?? [];
    arr.push({
      isin: r.isin,
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      prevClose: r.prevClose,
      volume: r.volume,
      turnover: r.turnover,
      trades: r.trades,
      sessionType: (r.sessionType === "special"
        ? "special"
        : "normal") as SessionType,
    });
    out.set(r.isin, arr);
  }
  for (const arr of out.values())
    arr.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export { istDateKey };
