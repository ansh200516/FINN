/**
 * The Brief, served to the page from ONE source of truth: the engine's
 * `buildBrief` (src/engine/analyse/brief.ts). This module
 *
 *   1. resolves the `?w=` / `?from=&to=` window exactly as `src/ui/window.ts`
 *      defines it, quantised to the minute so repeated loads share a cache key;
 *   2. runs `buildBrief` inside `unstable_cache` (60 s, tag `brief`) and adapts
 *      the engine model to the UI's `BriefView` (card payload shapes, anomaly
 *      rows with symbols/closes, upcoming items with sort keys, "checked at");
 *   3. exposes `invalidateBrief()` for ingestion jobs (`revalidateTag('brief')`).
 *
 * Nothing here recomputes tiers, priorities or windows — that is the engine's.
 */
import { unstable_cache } from "next/cache";
import { barMetrics } from "@/engine/analyse/anomalies";
import {
  type BriefModel,
  type BriefUpcoming,
  buildBrief,
  type EventCard as EngineEventCard,
  parseLooseDate,
} from "@/engine/analyse/brief";
import { loadBarsMany } from "@/engine/ingest/prices";
import type { Anomaly, PriceBar } from "@/engine/types";
import {
  type AnomalyThresholds,
  adaptCardPayload,
  attachResultsCards,
  companiesByIsin,
  getCheckedAt,
} from "@/lib/queries";
import { addDaysKey, formatIst } from "@/lib/time";
import type {
  AnomalyWithSymbol,
  BriefView,
  BriefWindow,
  EventCard,
  Tier3Group,
  UpcomingItem,
} from "@/ui/model";
import { presetWindow, resolveWindow, type WindowQuery } from "@/ui/window";
import { logger } from "./logger";

const log = logger.child({ mod: "lib/brief" });

export const BRIEF_CACHE_TAG = "brief";
export const BRIEF_CACHE_SECONDS = 60;

const MINUTE = 60_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Pure adapters (engine model → UI view)
// ---------------------------------------------------------------------------

interface CompanyLite {
  nseSymbol: string;
  name: string;
}

/** Engine card → UI card: payload shape adapted, title/one-liner kept from the engine. */
export function adaptEventCard(ev: EngineEventCard): EventCard {
  const { card } = adaptCardPayload(ev.card);
  return {
    eventKey: ev.eventKey,
    isin: ev.isin,
    symbol: ev.symbol,
    companyName: ev.companyName,
    category: ev.category,
    tier: ev.tier,
    priority: ev.priority,
    title: ev.title,
    oneLiner: ev.oneLiner,
    filedAtMs: ev.filedAtMs,
    filedAtIst: ev.filedAtIst,
    sources: ev.sources.map((s) => ({
      url: s.url,
      kind: s.kind,
      label: s.label,
    })),
    card,
    followUps: ev.followUps,
    voiceSummary: ev.voiceSummary,
  };
}

/**
 * Engine anomalies (one row per rule hit) → one UI row per (isin, session)
 * carrying both the % move and the volume ratio, with the symbol attached.
 * `barsBy` must hold ≥ 20 normal sessions before each anomaly date so the
 * volume baseline matches the engine's.
 */
export function enrichAnomalies(
  anomalies: Anomaly[],
  companies: Map<string, CompanyLite>,
  barsBy: Map<string, PriceBar[]>,
  thresholds: AnomalyThresholds,
): AnomalyWithSymbol[] {
  const metricsCache = new Map<
    string,
    Map<string, ReturnType<typeof barMetrics>[number]>
  >();
  const metricsFor = (isin: string, date: string) => {
    let byDate = metricsCache.get(isin);
    if (!byDate) {
      byDate = new Map();
      for (const m of barMetrics(barsBy.get(isin) ?? [], {
        lookbackDays: thresholds.lookbackDays,
      }))
        byDate.set(m.date, m);
      metricsCache.set(isin, byDate);
    }
    return byDate.get(date);
  };
  const byKey = new Map<string, AnomalyWithSymbol>();
  for (const a of anomalies) {
    const key = `${a.isin}|${a.date}`;
    const c = companies.get(a.isin);
    const symbol = c?.nseSymbol ?? a.isin;
    const m = metricsFor(a.isin, a.date);
    const bar = (barsBy.get(a.isin) ?? []).find((b) => b.date === a.date);
    let row = byKey.get(key);
    if (!row) {
      row = {
        isin: a.isin,
        date: a.date,
        kind: a.kind,
        value: a.value,
        threshold: a.threshold,
        summary: a.summary,
        symbol,
        companyName: c?.name ?? symbol,
        close: bar?.close ?? null,
        pctMove: m?.pct ?? null,
        volumeRatio: m?.volumeRatio ?? null,
      };
      byKey.set(key, row);
    }
    if (a.kind === "price_move") row.pctMove = a.value;
    else row.volumeRatio = a.value;
    // the louder rule names the row
    const pxStrength = Math.abs(row.pctMove ?? 0) / thresholds.pricePct;
    const volStrength = (row.volumeRatio ?? 0) / thresholds.volumeRatio;
    const kind: Anomaly["kind"] =
      pxStrength >= 1 && pxStrength >= volStrength
        ? "price_move"
        : "volume_ratio";
    row.kind = kind;
    row.value =
      kind === "price_move" ? (row.pctMove ?? 0) : (row.volumeRatio ?? 0);
    row.threshold =
      kind === "price_move" ? thresholds.pricePct : thresholds.volumeRatio;
    row.summary =
      kind === "price_move"
        ? `${symbol} ${(row.pctMove ?? 0) > 0 ? "up" : "down"} ${Math.abs(row.pctMove ?? 0).toFixed(1)}% on ${(row.volumeRatio ?? 0).toFixed(1)}× volume`
        : `${symbol} volume ${(row.volumeRatio ?? 0).toFixed(1)}× the ${thresholds.lookbackDays}-day average`;
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Math.abs(b.pctMove ?? 0) - Math.abs(a.pctMove ?? 0),
  );
}

/** Engine "upcoming" (dd MMM yyyy) → UI item with a sortable date key and the short day label. */
export function adaptUpcoming(items: BriefUpcoming[]): UpcomingItem[] {
  const out: UpcomingItem[] = [];
  for (const u of items) {
    const dateKey = parseLooseDate(u.dateIst);
    if (!dateKey) continue;
    out.push({
      isin: u.isin,
      symbol: u.symbol,
      what: u.what,
      dateIst: formatIst(dateKey, "EEE d MMM"),
      dateKey,
    });
  }
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/**
 * The window the engine actually used → the UI window. When the engine widened
 * an empty auto window (7 d / 30 d) the preset follows and the engine's reason
 * sentence is kept.
 */
export function adaptWindow(
  requested: BriefWindow,
  used: BriefModel["window"],
  now: number,
): BriefWindow {
  if (used.fromMs === requested.fromMs || !used.widened)
    return { ...requested, widened: used.widened ?? requested.widened };
  const days = Math.round((used.toMs - used.fromMs) / DAY);
  const preset = days >= 30 ? "30d" : days >= 7 ? "7d" : "48h";
  const p = presetWindow(now, preset);
  return {
    fromMs: used.fromMs,
    toMs: used.toMs,
    label: p.label,
    preset,
    widened: used.widened,
  };
}

export function groupTier3(cards: EventCard[]): Tier3Group[] {
  const groups = new Map<EventCard["category"], EventCard[]>();
  for (const c of cards) {
    const l = groups.get(c.category) ?? [];
    l.push(c);
    groups.set(c.category, l);
  }
  return [...groups.entries()]
    .map(([category, items]) => ({ category, count: items.length, items }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Build (DB) — the function that gets cached
// ---------------------------------------------------------------------------

export interface BriefBuildArgs {
  isins: string[];
  fromMs: number;
  toMs: number;
  thresholds: AnomalyThresholds;
  autoWiden: boolean;
}

/** `buildBrief` + UI adaptation. JSON-serialisable (it is what `unstable_cache` stores). */
export async function buildBriefView(
  a: BriefBuildArgs,
): Promise<{ model: BriefModel; view: Omit<BriefView, "window"> }> {
  const model = await buildBrief({
    isins: a.isins,
    fromMs: a.fromMs,
    toMs: a.toMs,
    thresholds: a.thresholds,
    autoWiden: a.autoWiden,
  });
  const cards = [...model.tier1, ...model.tier2].map(adaptEventCard);
  const tier3Cards = model.tier3.flatMap((g) => g.items.map(adaptEventCard));
  await attachResultsCards(cards);
  const tier1 = cards.filter((c) => c.tier === 1);
  const tier2 = cards.filter((c) => c.tier === 2);

  const anomalyIsins = [...new Set(model.anomalies.map((x) => x.isin))];
  let anomalies: AnomalyWithSymbol[] = [];
  if (anomalyIsins.length) {
    const dates = model.anomalies.map((x) => x.date).sort();
    const [companies, barsBy] = await Promise.all([
      companiesByIsin(anomalyIsins),
      loadBarsMany(
        anomalyIsins,
        addDaysKey(dates[0] as string, -(a.thresholds.lookbackDays + 30)),
        dates[dates.length - 1] as string,
      ),
    ]);
    anomalies = enrichAnomalies(
      model.anomalies,
      companies,
      barsBy,
      a.thresholds,
    );
  }
  const checkedAtMs = await getCheckedAt(a.isins);
  return {
    model,
    view: {
      counts: model.counts,
      tier1,
      tier2,
      tier3: groupTier3(tier3Cards),
      anomalies,
      upcoming: adaptUpcoming(model.upcoming ?? []),
      quiet: model.quiet,
      checkedAtMs,
      companiesChecked: a.isins.length,
    },
  };
}

type Built = Awaited<ReturnType<typeof buildBriefView>>;

const cachedBuild = unstable_cache(
  async (argsJson: string): Promise<Built> =>
    buildBriefView(JSON.parse(argsJson) as BriefBuildArgs),
  ["brief-view-v1"],
  { tags: [BRIEF_CACHE_TAG], revalidate: BRIEF_CACHE_SECONDS },
);

async function buildMaybeCached(args: BriefBuildArgs): Promise<Built> {
  const key = JSON.stringify({ ...args, isins: [...args.isins].sort() });
  if (!process.env.NEXT_RUNTIME) return buildBriefView(args);
  try {
    return await cachedBuild(key);
  } catch (e) {
    // outside a Next request scope (tests, CLIs) the data cache is unavailable
    if (e instanceof Error && /incrementalCache|Invariant/.test(e.message))
      return buildBriefView(args);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Page entry point
// ---------------------------------------------------------------------------

export interface BriefRequest {
  now: number;
  query: WindowQuery;
  isins: string[];
  thresholds: AnomalyThresholds;
}

export interface BriefResult {
  view: BriefView;
  /** the window the page should render (preset follows auto-widening) */
  window: BriefWindow;
  /** wall-clock ms spent building (0 ⇒ cache hit is not distinguishable; use for logs) */
  ms: number;
}

/** Quantise a request window to the minute so consecutive loads share a cache entry. */
export function quantiseWindow(win: BriefWindow): {
  fromMs: number;
  toMs: number;
} {
  const toMs = Math.floor(win.toMs / MINUTE) * MINUTE;
  const shift = win.toMs - toMs;
  const fromMs =
    win.preset === "custom" || win.preset === "close"
      ? win.fromMs
      : win.fromMs - shift;
  return { fromMs, toMs };
}

export async function getBriefView(req: BriefRequest): Promise<BriefResult> {
  const t0 = Date.now();
  const resolved = resolveWindow(req.now, req.query);
  const { auto, ...requested } = resolved;
  const q = quantiseWindow(requested);
  const requestedQ: BriefWindow = { ...requested, ...q };
  const built = await buildMaybeCached({
    isins: req.isins,
    fromMs: q.fromMs,
    toMs: q.toMs,
    thresholds: req.thresholds,
    autoWiden: auto,
  });
  const window = adaptWindow(requestedQ, built.model.window, req.now);
  const ms = Date.now() - t0;
  log.info(
    {
      preset: window.preset,
      widened: Boolean(window.widened),
      events: built.view.counts.events,
      ms,
    },
    ms < 15 ? "brief served (cache)" : "brief built",
  );
  return { view: { ...built.view, window }, window, ms };
}

/** Mark every cached brief stale (call after ingestion). Safe outside a request scope. */
export async function invalidateBrief(): Promise<boolean> {
  try {
    const mod = await import("next/cache");
    mod.revalidateTag(BRIEF_CACHE_TAG, { expire: 0 });
    return true;
  } catch {
    return false;
  }
}
