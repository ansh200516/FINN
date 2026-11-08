/**
 * Tripwires → `alerts` rows (the Inbox is the guaranteed channel).
 *
 *   evaluateAlerts({ userId, isins, now, sinceMs })
 *     price / volume rules against the latest completed session, category
 *     rules against new Tier-1 events since `sinceMs`; every hit becomes one
 *     `alerts` row deduped by (user, isin, kind, session | event_key).
 *
 *   backtestSentence(rule, isins, days)
 *     "Would have fired 4× in the last 41 sessions · last: THERMAX 6 Nov"
 *     from the engine's DB-backed `backtest`.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { parseJsonColumn, TripwireRule } from "@/db/json";
import * as t from "@/db/schema";
import { backtest, evaluateTripwire } from "@/engine/analyse/tripwires";
import { loadBarsMany } from "@/engine/ingest/prices";
import { withBusyRetry } from "@/engine/jobs/runner";
import type { Tripwire, TripwireHit } from "@/engine/types";
import { categoryLabel, groupIndian } from "@/lib/format";
import { adaptCardPayload, DEMO_USER_ID, getDemoUser } from "@/lib/queries";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  lastMarketClose,
  sessionCloseMs,
  sessionType,
  tradingDaysBetween,
} from "@/lib/time";

export interface AlertPayload {
  title: string;
  body: string;
  because: string;
  href: string;
  symbol: string;
}

export interface AlertDraft {
  id: string;
  userId: string;
  isin: string;
  kind: "tripwire" | "announcement" | "anomaly" | "digest";
  tripwireId: string | null;
  eventKey: string | null;
  payload: AlertPayload;
  firedAt: number;
}

export interface EvaluateAlertsResult {
  session: string | null;
  hits: number;
  inserted: number;
  existing: number;
  drafts: AlertDraft[];
}

/** The demo user's portfolio (users ∪ companies.in_portfolio) — the scope alerts are evaluated over. */
export async function demoPortfolioIsins(): Promise<string[]> {
  return (await getDemoUser()).portfolioIsins;
}

export function alertId(dedupeKey: string): string {
  return `al_${createHash("sha1").update(dedupeKey).digest("hex").slice(0, 20)}`;
}

/** Plain-language rule sentences (the Inbox's "because …"). */
export function ruleSentence(rule: Tripwire): string {
  switch (rule.kind) {
    case "volume_ratio":
      return `volume over ${groupIndian(rule.params.ratio, 2)}× its ${rule.params.lookbackDays}-day average`;
    case "price_move":
      return `a move beyond ±${groupIndian(rule.params.pct, 1)}% in a day`;
    case "category":
      return `a filing in a category you always surface (${rule.params.categories
        .map((c) => categoryLabel(c).toLowerCase())
        .join(", ")})`;
    case "text":
      return `filing text matching /${rule.params.pattern}/`;
  }
}

interface RuleRow {
  id: string;
  isin: string | null;
  rule: Tripwire;
}

async function loadRules(userId: string): Promise<RuleRow[]> {
  const rows = await db
    .select()
    .from(t.tripwires)
    .where(and(eq(t.tripwires.userId, userId), eq(t.tripwires.enabled, true)));
  const out: RuleRow[] = [];
  for (const r of rows) {
    const rule = parseJsonColumn(TripwireRule, r.ruleJson, null);
    if (rule) out.push({ id: r.id, isin: r.isin, rule: rule as Tripwire });
  }
  return out;
}

function fmtVol(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)} lakh`;
  return groupIndian(n, 0);
}

/** Pure: a price/volume hit → inbox payload. */
export function payloadForHit(
  hit: TripwireHit,
  rule: Tripwire,
  symbol: string,
): AlertPayload {
  const ev = hit.evidence as Record<string, number | null | undefined>;
  const date = formatIst(hit.at, "EEE d MMM");
  if (hit.kind === "volume_ratio") {
    const ratio = ev.ratio ?? 0;
    return {
      title: `${symbol} volume ${groupIndian(ratio as number, 1)}× its ${(rule as Extract<Tripwire, { kind: "volume_ratio" }>).params.lookbackDays}-day average`,
      body: `${fmtVol(ev.volume)} shares against an average of ${fmtVol(ev.baselineAvg)} · ${date}`,
      because: ruleSentence(rule),
      href: `/c/${encodeURIComponent(symbol)}`,
      symbol,
    };
  }
  const pct = (ev.pct ?? 0) as number;
  return {
    title: `${symbol} ${pct >= 0 ? "up" : "down"} ${groupIndian(Math.abs(pct), 1)}% in a day`,
    body: `Close ₹${groupIndian((ev.close ?? 0) as number, 2)} against ₹${groupIndian((ev.prevClose ?? 0) as number, 2)} · ${date}`,
    because: ruleSentence(rule),
    href: `/c/${encodeURIComponent(symbol)}`,
    symbol,
  };
}

export interface EvaluateAlertsOptions {
  userId?: string;
  isins: string[];
  now?: number;
  /** category rules look at Tier-1 events with last_at ≥ sinceMs (default: last 24 h) */
  sinceMs?: number;
  /** evaluate price/volume rules for this IST session (default: the last completed close) */
  session?: string;
  /** compute only, do not write */
  dryRun?: boolean;
}

export async function evaluateAlerts(
  o: EvaluateAlertsOptions,
): Promise<EvaluateAlertsResult> {
  const userId = o.userId ?? DEMO_USER_ID;
  const now = o.now ?? Date.now();
  const sinceMs = o.sinceMs ?? now - 24 * 3_600_000;
  const rules = await loadRules(userId);
  const drafts: AlertDraft[] = [];
  if (!rules.length || !o.isins.length)
    return { session: null, hits: 0, inserted: 0, existing: 0, drafts };

  const companies = await db
    .select({
      isin: t.companies.isin,
      symbol: t.companies.nseSymbol,
      name: t.companies.name,
    })
    .from(t.companies)
    .where(inArray(t.companies.isin, o.isins));
  const symbolOf = new Map(companies.map((c) => [c.isin, c.symbol]));

  // --- price / volume rules: the last completed session ---------------------------
  const priceRules = rules.filter(
    (r) => r.rule.kind === "volume_ratio" || r.rule.kind === "price_move",
  );
  const session = o.session ?? lastMarketClose(now).dateKey;
  if (priceRules.length && sessionType(session) === "normal") {
    const barsBy = await loadBarsMany(
      o.isins,
      addDaysKey(session, -60),
      session,
    );
    for (const isin of o.isins) {
      const bars = barsBy.get(isin) ?? [];
      if (!bars.length || bars[bars.length - 1]?.date !== session) continue;
      for (const r of priceRules) {
        if (r.isin && r.isin !== isin) continue;
        const hit = evaluateTripwire(
          { ...r.rule, id: r.id },
          {
            isin,
            bars,
            categoriesToday: [],
            textsToday: [],
            at: sessionCloseMs(session),
          },
        );
        if (!hit) continue;
        const symbol = symbolOf.get(isin) ?? isin;
        drafts.push({
          id: alertId(`${userId}|${isin}|${r.rule.kind}|${session}`),
          userId,
          isin,
          kind: "tripwire",
          tripwireId: r.id,
          eventKey: null,
          payload: payloadForHit(hit, r.rule, symbol),
          firedAt: hit.at,
        });
      }
    }
  }

  // --- category rules: new Tier-1 events since the last run -----------------------
  const catRules = rules.filter((r) => r.rule.kind === "category");
  if (catRules.length) {
    const events = await db
      .select()
      .from(t.events)
      .where(
        and(
          inArray(t.events.isin, o.isins),
          gte(t.events.lastAt, sinceMs),
          lt(t.events.lastAt, now),
          eq(t.events.tier, 1),
        ),
      );
    for (const ev of events) {
      for (const r of catRules) {
        if (r.isin && r.isin !== ev.isin) continue;
        const cats = (r.rule as Extract<Tripwire, { kind: "category" }>).params
          .categories as string[];
        if (!cats.includes(ev.category)) continue;
        const symbol = symbolOf.get(ev.isin) ?? ev.isin;
        let title = `${symbol}: ${categoryLabel(ev.category)} filing`;
        let body = "";
        try {
          const { envelope } = adaptCardPayload(JSON.parse(ev.cardJson));
          if (envelope.title) title = `${symbol}: ${envelope.title}`;
          if (envelope.oneLiner) body = envelope.oneLiner;
        } catch {
          // keep the generic title
        }
        drafts.push({
          id: alertId(`${userId}|${ev.isin}|category|${ev.eventKey}`),
          userId,
          isin: ev.isin,
          kind: "announcement",
          tripwireId: r.id,
          eventKey: ev.eventKey,
          payload: {
            title,
            body,
            because: `Category you always surface: ${categoryLabel(ev.category).toLowerCase()}`,
            href: `/e/${encodeURIComponent(ev.eventKey)}`,
            symbol,
          },
          firedAt: Math.min(now, Math.max(ev.lastAt, sinceMs)),
        });
      }
    }
  }

  // --- write (insert-if-absent) ----------------------------------------------------------
  let inserted = 0;
  let existing = 0;
  if (!o.dryRun && drafts.length) {
    const ids = drafts.map((d) => d.id);
    const have = new Set(
      (
        await db
          .select({ id: t.alerts.id })
          .from(t.alerts)
          .where(inArray(t.alerts.id, ids))
      ).map((r) => r.id),
    );
    for (const d of drafts) {
      if (have.has(d.id)) {
        existing++;
        continue;
      }
      await withBusyRetry(() =>
        db
          .insert(t.alerts)
          .values({
            id: d.id,
            userId: d.userId,
            isin: d.isin,
            kind: d.kind,
            tripwireId: d.tripwireId,
            eventKey: d.eventKey,
            payloadJson: JSON.stringify(d.payload),
            firedAt: d.firedAt,
            deliveredViaJson: JSON.stringify({ inbox: "sent" }),
            readAt: null,
          })
          .onConflictDoNothing(),
      );
      inserted++;
    }
  }
  return { session, hits: drafts.length, inserted, existing, drafts };
}

// ---------------------------------------------------------------------------
// Backtest sentence
// ---------------------------------------------------------------------------

export interface BacktestSentence {
  sentence: string;
  fires: number;
  sessions: number;
  days: number;
  last: { symbol: string; date: string; dateIst: string } | null;
}

export async function backtestSentence(
  rule: Tripwire,
  isins: string[],
  days = 60,
  now: number = Date.now(),
  symbolOf?: Map<string, string>,
): Promise<BacktestSentence> {
  const toKey = istDateKey(now);
  const fromKey = addDaysKey(toKey, -days);
  const sessions = tradingDaysBetween(fromKey, toKey).filter(
    (d) => sessionType(d) === "normal",
  ).length;
  if (!isins.length)
    return {
      sentence: "Add companies to see how often this would have fired.",
      fires: 0,
      sessions,
      days,
      last: null,
    };
  const r = await backtest(rule, isins, days, now);
  let symbols = symbolOf;
  if (!symbols) {
    const rows = await db
      .select({ isin: t.companies.isin, symbol: t.companies.nseSymbol })
      .from(t.companies)
      .where(inArray(t.companies.isin, isins));
    symbols = new Map(rows.map((c) => [c.isin, c.symbol]));
  }
  const latest = [...r.hits].sort((a, b) => b.at - a.at)[0];
  const last = latest
    ? {
        symbol: symbols.get(latest.isin) ?? latest.isin,
        date: istDateKey(latest.at),
        dateIst: formatIst(latest.at, "d MMM"),
      }
    : null;
  const n = r.hits.length;
  const unit =
    rule.kind === "category" || rule.kind === "text"
      ? `${days} days`
      : `${sessions} sessions`;
  const sentence = `Would have fired ${n}× in the last ${unit}${last ? ` · last: ${last.symbol} ${last.dateIst}` : ""}`;
  return { sentence, fires: n, sessions, days, last };
}
