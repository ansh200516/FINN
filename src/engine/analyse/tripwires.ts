/**
 * Tripwires — user rules evaluated against bars and events.
 *
 *   { kind: "volume_ratio", params: { ratio, lookbackDays } }
 *   { kind: "price_move",   params: { pct } }
 *   { kind: "category",     params: { categories } }
 *   { kind: "text",         params: { pattern, flags? } }
 *
 * Pure evaluation (`evaluateTripwire`, `backtestTripwire`) plus DB-backed
 * helpers (`backtest`, `evaluateTripwiresForWindow`) used by the Tripwires
 * screen's "would have fired N× in the last 60 days" sentence.
 */
import { and, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements } from "@/db/schema";
import { addDaysKey, formatIst, istDateKey, sessionCloseMs } from "@/lib/time";
import { loadBarsMany } from "../ingest/prices";
import type { Category, PriceBar, Tripwire, TripwireHit } from "../types";
import { barMetrics } from "./anomalies";

export interface TripwireContext {
  isin: string;
  /** ascending bars; the last bar is "today" */
  bars: PriceBar[];
  categoriesToday: string[];
  textsToday: string[];
  /** ms UTC the evaluation refers to */
  at: number;
}

function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags ?? "i");
  } catch {
    return null;
  }
}

/** Pure: evaluate a rule over recent bars / events for one company (latest bar = the day in question). */
export function evaluateTripwire(
  rule: Tripwire & { id: string },
  ctx: TripwireContext,
): TripwireHit | null {
  switch (rule.kind) {
    case "volume_ratio": {
      const bars = [...ctx.bars].sort((a, b) => a.date.localeCompare(b.date));
      const last = bars.at(-1);
      if (!last || last.sessionType !== "normal") return null;
      const m = barMetrics(bars, { lookbackDays: rule.params.lookbackDays }).at(
        -1,
      );
      if (!m || m.volumeRatio === null) return null;
      if (m.volumeRatio < rule.params.ratio) return null;
      return {
        tripwireId: rule.id,
        isin: ctx.isin,
        kind: rule.kind,
        summary: `Volume ${m.volumeRatio.toFixed(1)}× the ${m.baselineDays}-day average on ${formatIst(sessionCloseMs(last.date), "dd MMM")}`,
        at: sessionCloseMs(last.date),
        evidence: {
          date: last.date,
          volume: last.volume,
          baselineAvg: m.baselineAvg,
          ratio: Number(m.volumeRatio.toFixed(2)),
          threshold: rule.params.ratio,
        },
      };
    }
    case "price_move": {
      const bars = [...ctx.bars].sort((a, b) => a.date.localeCompare(b.date));
      const last = bars.at(-1);
      if (!last || last.sessionType !== "normal") return null;
      const m = barMetrics(bars).at(-1);
      if (!m || m.pct === null || Math.abs(m.pct) < rule.params.pct)
        return null;
      return {
        tripwireId: rule.id,
        isin: ctx.isin,
        kind: rule.kind,
        summary: `${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(1)}% on ${formatIst(sessionCloseMs(last.date), "dd MMM")} (threshold ±${rule.params.pct}%)`,
        at: sessionCloseMs(last.date),
        evidence: {
          date: last.date,
          close: last.close,
          prevClose: last.prevClose,
          pct: Number(m.pct.toFixed(2)),
          threshold: rule.params.pct,
        },
      };
    }
    case "category": {
      const hit = ctx.categoriesToday.filter((c) =>
        rule.params.categories.includes(c as Category),
      );
      if (hit.length === 0) return null;
      return {
        tripwireId: rule.id,
        isin: ctx.isin,
        kind: rule.kind,
        summary: `Filing in watched category: ${[...new Set(hit)].join(", ")}`,
        at: ctx.at,
        evidence: { categories: [...new Set(hit)] },
      };
    }
    case "text": {
      const re = safeRegex(rule.params.pattern, rule.params.flags);
      if (!re) return null;
      const matches = ctx.textsToday.filter((t) => re.test(t));
      if (matches.length === 0) return null;
      const snippet = (matches[0] ?? "").replace(/\s+/g, " ").slice(0, 140);
      return {
        tripwireId: rule.id,
        isin: ctx.isin,
        kind: rule.kind,
        summary: `Filing text matches /${rule.params.pattern}/: “${snippet}”`,
        at: ctx.at,
        evidence: { pattern: rule.params.pattern, matches: matches.length },
      };
    }
    default:
      return null;
  }
}

/** Pure: how often a price/volume rule would have fired over the given bars (normal sessions only). */
export function backtestTripwire(
  rule: Tripwire,
  bars: PriceBar[],
): { fires: number; days: number; sentence: string } {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const normal = sorted.filter((b) => b.sessionType === "normal");
  const days = normal.length;
  let fires = 0;
  if (rule.kind === "volume_ratio" || rule.kind === "price_move") {
    const metrics = barMetrics(
      sorted,
      rule.kind === "volume_ratio"
        ? { lookbackDays: rule.params.lookbackDays }
        : {},
    );
    for (const m of metrics) {
      if (m.sessionType !== "normal") continue;
      if (
        rule.kind === "volume_ratio" &&
        m.volumeRatio !== null &&
        m.volumeRatio >= rule.params.ratio
      )
        fires++;
      if (
        rule.kind === "price_move" &&
        m.pct !== null &&
        Math.abs(m.pct) >= rule.params.pct
      )
        fires++;
    }
  }
  const what =
    rule.kind === "volume_ratio"
      ? `volume > ${rule.params.ratio}× the ${rule.params.lookbackDays}-day average`
      : rule.kind === "price_move"
        ? `a move beyond ±${rule.params.pct}%`
        : rule.kind === "category"
          ? `a filing in ${rule.params.categories.join("/")}`
          : `text matching /${rule.params.pattern}/`;
  const sentence =
    rule.kind === "volume_ratio" || rule.kind === "price_move"
      ? `Would have fired ${fires}× in the last ${days} sessions (${what}).`
      : `Fires on ${what}; backtest needs filings (see backtest()).`;
  return { fires, days, sentence };
}

export interface BacktestResult {
  hits: TripwireHit[];
  /** 'YYYY-MM' → hits */
  perMonth: Record<string, number>;
  days: number;
  sentence: string;
}

/**
 * DB-backed backtest over the last `days` calendar days for the given ISINs:
 * price/volume rules over stored bars, category/text rules over stored filings.
 */
export async function backtest(
  rule: Tripwire,
  isins: string[],
  days: number,
  now: number = Date.now(),
): Promise<BacktestResult> {
  const toKey = istDateKey(now);
  const fromKey = addDaysKey(toKey, -days);
  const id = "backtest";
  const hits: TripwireHit[] = [];
  if (rule.kind === "volume_ratio" || rule.kind === "price_move") {
    // pull extra history for the baseline
    const barsBy = await loadBarsMany(isins, addDaysKey(fromKey, -45), toKey);
    for (const isin of isins) {
      const bars = barsBy.get(isin) ?? [];
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i] as PriceBar;
        if (b.date < fromKey) continue;
        const hit = evaluateTripwire(
          { ...rule, id },
          {
            isin,
            bars: bars.slice(0, i + 1),
            categoriesToday: [],
            textsToday: [],
            at: sessionCloseMs(b.date),
          },
        );
        if (hit) hits.push(hit);
      }
    }
  } else {
    const fromMs = now - days * 86_400_000;
    const rows = isins.length
      ? await db
          .select({
            isin: announcements.isin,
            category: announcements.category,
            subject: announcements.subject,
            text: announcements.text,
            filedAt: announcements.filedAt,
            tier: announcements.tier,
          })
          .from(announcements)
          .where(
            and(
              inArray(announcements.isin, isins),
              gte(announcements.filedAt, fromMs),
              lt(announcements.filedAt, now),
            ),
          )
      : [];
    for (const r of rows) {
      const hit = evaluateTripwire(
        { ...rule, id },
        {
          isin: r.isin,
          bars: [],
          categoriesToday: [r.category],
          textsToday: [`${r.subject}\n${r.text}`],
          at: r.filedAt,
        },
      );
      if (hit) hits.push(hit);
    }
  }
  const perMonth: Record<string, number> = {};
  for (const h of hits) {
    const k = istDateKey(h.at).slice(0, 7);
    perMonth[k] = (perMonth[k] ?? 0) + 1;
  }
  const sentence = `Would have fired ${hits.length}× across ${isins.length} compan${isins.length === 1 ? "y" : "ies"} in the last ${days} days.`;
  return { hits, perMonth, days, sentence };
}

/** Evaluate many rules for a window (used by the brief / alerts job). */
export async function evaluateTripwiresForWindow(
  rules: Array<Tripwire & { id: string; isin?: string | null }>,
  q: { isins: string[]; fromMs: number; toMs: number },
): Promise<TripwireHit[]> {
  const out: TripwireHit[] = [];
  if (rules.length === 0 || q.isins.length === 0) return out;
  const toKey = istDateKey(q.toMs);
  const fromKey = istDateKey(q.fromMs);
  const needBars = rules.some(
    (r) => r.kind === "volume_ratio" || r.kind === "price_move",
  );
  const barsBy = needBars
    ? await loadBarsMany(q.isins, addDaysKey(fromKey, -45), toKey)
    : new Map<string, PriceBar[]>();
  const rows = rules.some((r) => r.kind === "category" || r.kind === "text")
    ? await db
        .select({
          isin: announcements.isin,
          category: announcements.category,
          subject: announcements.subject,
          text: announcements.text,
          filedAt: announcements.filedAt,
        })
        .from(announcements)
        .where(
          and(
            inArray(announcements.isin, q.isins),
            gte(announcements.filedAt, q.fromMs),
            lt(announcements.filedAt, q.toMs),
          ),
        )
    : [];
  for (const rule of rules) {
    const scope = rule.isin ? q.isins.filter((i) => i === rule.isin) : q.isins;
    for (const isin of scope) {
      if (rule.kind === "volume_ratio" || rule.kind === "price_move") {
        const bars = barsBy.get(isin) ?? [];
        for (let i = 0; i < bars.length; i++) {
          const b = bars[i] as PriceBar;
          const closeMs = sessionCloseMs(b.date);
          if (closeMs < q.fromMs || closeMs >= q.toMs) continue;
          const hit = evaluateTripwire(rule, {
            isin,
            bars: bars.slice(0, i + 1),
            categoriesToday: [],
            textsToday: [],
            at: closeMs,
          });
          if (hit) out.push(hit);
        }
      } else {
        for (const r of rows) {
          if (r.isin !== isin) continue;
          const hit = evaluateTripwire(rule, {
            isin,
            bars: [],
            categoriesToday: [r.category],
            textsToday: [`${r.subject}\n${r.text}`],
            at: r.filedAt,
          });
          if (hit) out.push(hit);
        }
      }
    }
  }
  return out;
}
