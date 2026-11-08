/**
 * The Brief — a finite, windowed model assembled from `events`, `announcements`
 * and `prices`. The UI renders this shape as-is (no recomputation).
 *
 *   buildBrief({ isins, fromMs, toMs, thresholds }) → BriefModel
 *
 * Window logic: [fromMs, toMs). When the window has no events and
 * `autoWiden` is on (default), it widens to 7 then 30 days and says why
 * (weekend / holiday / quiet). Anomalies are EOD bars whose session close
 * falls inside the window, scored with the user's thresholds.
 */
import { and, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements, events } from "@/db/schema";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  NSE_SPECIAL_SESSIONS,
  nonTradingReason,
  parseNseDateTime,
  sessionCloseMs,
  sessionType,
} from "@/lib/time";
import type { CardPayload } from "../ingest/announcements";
import { companyIndex } from "../ingest/companies";
import { loadBarsMany } from "../ingest/prices";
import type { Anomaly, Category, Company, Tier } from "../types";
import {
  corporateActionDatesFrom,
  DEFAULT_ANOMALY_OPTIONS,
  detectAnomalies,
} from "./anomalies";

// ---------------------------------------------------------------------------
// Types (the UI codes against these)
// ---------------------------------------------------------------------------

export interface EventCardSource {
  url: string;
  kind: string;
  label: string;
}

export interface EventCard {
  eventKey: string;
  isin: string;
  symbol: string;
  companyName: string;
  category: Category;
  tier: Tier;
  priority: number;
  /** ≤ 10 words */
  title: string;
  /** one sentence carrying a number or an entity */
  oneLiner: string;
  /** first filing of the event, ms UTC */
  filedAtMs: number;
  /** IST, "dd MMM yyyy HH:mm" */
  filedAtIst: string;
  sources: EventCardSource[];
  /** the category card_json payload (CardPayload from ingest/announcements) */
  card: unknown;
  /** additional filings folded into this event */
  followUps: number;
  voiceSummary?: string;
}

export interface BriefWindow {
  fromMs: number;
  toMs: number;
  label: string;
  /** set when the window was widened automatically, e.g. "No filings in the last 24h (Market closed — weekend); showing 7 days" */
  widened?: string;
}

export interface BriefCounts {
  filings: number;
  events: number;
  needsYou: number;
  filedAway: number;
}

export interface BriefTier3Group {
  category: Category;
  count: number;
  items: EventCard[];
}

export interface BriefUpcoming {
  isin: string;
  symbol: string;
  what: string;
  /** "dd MMM yyyy" */
  dateIst: string;
}

export interface BriefModel {
  window: BriefWindow;
  counts: BriefCounts;
  tier1: EventCard[];
  tier2: EventCard[];
  tier3: BriefTier3Group[];
  anomalies: Anomaly[];
  upcoming?: BriefUpcoming[];
  quiet?: { reason: string };
}

export interface BriefThresholds {
  volumeRatio: number;
  pricePct: number;
  lookbackDays: number;
}

export interface BriefQuery {
  isins: string[];
  fromMs: number;
  toMs: number;
  thresholds?: Partial<BriefThresholds>;
  /** widen to 7d / 30d when the window is empty (default true) */
  autoWiden?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function windowLabel(fromMs: number, toMs: number): string {
  const hours = Math.round((toMs - fromMs) / 3_600_000);
  if (hours === 24) return "Last 24 hours";
  if (hours === 48) return "Last 48 hours";
  if (hours === 24 * 7) return "Last 7 days";
  if (hours === 24 * 30) return "Last 30 days";
  if (hours < 48) return `Last ${hours} hours`;
  if (hours % 24 === 0) return `Last ${hours / 24} days`;
  return `${formatIst(fromMs, "dd MMM HH:mm")} – ${formatIst(toMs, "dd MMM HH:mm")}`;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "12-Nov-2026" | "November 13, 2026" | "13th November, 2026" | "30.10.2026" | "2026-11-13" → 'YYYY-MM-DD' or null. */
export function parseLooseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m)
    return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  m = /^(\d{1,2})(?:st|nd|rd|th)?[-\s]+([A-Za-z]+),?[-\s]+(\d{4})$/.exec(t);
  if (m) {
    const mo =
      MONTHS[(m[2] ?? "").toLowerCase().slice(0, 4)] ??
      MONTHS[(m[2] ?? "").toLowerCase().slice(0, 3)];
    if (mo)
      return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  }
  m = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const mo =
      MONTHS[(m[1] ?? "").toLowerCase().slice(0, 4)] ??
      MONTHS[(m[1] ?? "").toLowerCase().slice(0, 3)];
    if (mo)
      return `${m[3]}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  }
  try {
    return istDateKey(parseNseDateTime(t));
  } catch {
    return null;
  }
}

const DATE_IN_TEXT =
  /(\d{1,2}-[A-Za-z]{3}-\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec),?\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[./]\d{1,2}[./]\d{4})/g;

/** First date in a subject line that is on/after `afterKey`. */
export function firstFutureDate(text: string, afterKey: string): string | null {
  for (const m of text.matchAll(DATE_IN_TEXT)) {
    const key = parseLooseDate(m[1] ?? "");
    if (key && key >= afterKey) return key;
  }
  return null;
}

function toCard(
  ev: typeof events.$inferSelect,
  payload: CardPayload | null,
  company: Company | undefined,
  idsCount: number,
  windowFrom: number,
  newestInWindow: {
    subject: string;
    desc: string;
    category: string;
    subcategory: string | null;
    priority: number;
    tier: number;
  } | null,
): EventCard {
  const symbol = company?.nseSymbol ?? ev.isin;
  const companyName = company?.name ?? ev.isin;
  let title = payload?.title ?? "Filing";
  let oneLiner = payload?.oneLiner ?? "";
  let tier = ev.tier as Tier;
  let priority = payload?.priority ?? 0;
  // an older event that only has new follow-ups inside the window reads as a follow-up line
  if (ev.firstAt < windowFrom && newestInWindow) {
    const label = followUpLabel(
      newestInWindow.subcategory,
      newestInWindow.desc,
      newestInWindow.subject,
    );
    title = label;
    oneLiner = `Follow-up to “${payload?.title ?? ev.category}” (first filed ${formatIst(ev.firstAt, "dd MMM")}): ${label.toLowerCase()} filed.`;
    tier = Math.max(2, newestInWindow.tier) as Tier;
    priority = Math.min(priority, newestInWindow.priority);
  }
  return {
    eventKey: ev.eventKey,
    isin: ev.isin,
    symbol,
    companyName,
    category: ev.category as Category,
    tier,
    priority,
    title,
    oneLiner,
    filedAtMs: ev.firstAt,
    filedAtIst: formatIst(ev.firstAt),
    sources: (payload?.sources ?? []).map((s) => ({
      url: s.url,
      kind: s.kind,
      label: s.label,
    })),
    card: payload,
    followUps: Math.max(0, idsCount - 1),
    voiceSummary: payload?.voiceSummary ?? undefined,
  };
}

function followUpLabel(
  subcategory: string | null,
  desc: string,
  subject: string,
): string {
  switch (subcategory) {
    case "transcript":
      return "Earnings call transcript";
    case "recording":
      return "Earnings call recording";
    case "presentation":
      return "Investor presentation";
    case "press_release":
      return "Press release";
    case "newspaper":
      return "Newspaper ad";
    case "record_date":
      return "Record date";
    case "auditor_report":
      return "Auditor's report";
    default:
      return desc && !/^updates?$|^general updates?$/i.test(desc)
        ? desc
        : subject.slice(0, 60) || "Update";
  }
}

function safePayload(json: string): CardPayload | null {
  try {
    const p = JSON.parse(json) as CardPayload;
    return p && typeof p === "object" && "title" in p ? p : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildBrief
// ---------------------------------------------------------------------------

export async function buildBrief(q: BriefQuery): Promise<BriefModel> {
  const thresholds: BriefThresholds = {
    volumeRatio:
      q.thresholds?.volumeRatio ?? DEFAULT_ANOMALY_OPTIONS.volumeRatio,
    pricePct: q.thresholds?.pricePct ?? DEFAULT_ANOMALY_OPTIONS.pricePct,
    lookbackDays:
      q.thresholds?.lookbackDays ?? DEFAULT_ANOMALY_OPTIONS.lookbackDays,
  };
  const isins = [...new Set(q.isins)];
  const { byIsin } = await companyIndex();
  let fromMs = q.fromMs;
  const toMs = q.toMs;
  let widened: string | undefined;

  const loadEvents = async (from: number) =>
    isins.length
      ? db
          .select()
          .from(events)
          .where(
            and(
              inArray(events.isin, isins),
              gte(events.lastAt, from),
              lt(events.lastAt, toMs),
            ),
          )
      : [];

  let evRows = await loadEvents(fromMs);
  if (evRows.length === 0 && (q.autoWiden ?? true)) {
    const originalLabel = windowLabel(fromMs, toMs).toLowerCase();
    const reason = windowQuietReason(fromMs, toMs);
    for (const days of [7, 30]) {
      const candidate = toMs - days * 86_400_000;
      if (candidate >= fromMs) continue;
      const rows = await loadEvents(candidate);
      if (rows.length) {
        evRows = rows;
        fromMs = candidate;
        widened = `No filings in the ${originalLabel} (${reason}); showing the last ${days} days.`;
        break;
      }
    }
  }

  // announcements inside the window (for counts, follow-up detection, upcoming, corporate actions)
  const annRows = isins.length
    ? await db
        .select({
          id: announcements.id,
          isin: announcements.isin,
          eventKey: announcements.eventKey,
          category: announcements.category,
          subcategory: announcements.subcategory,
          subject: announcements.subject,
          desc: announcements.desc,
          voiceSummary: announcements.voiceSummary,
          filedAt: announcements.filedAt,
          priority: announcements.priority,
          tier: announcements.tier,
        })
        .from(announcements)
        .where(
          and(
            inArray(announcements.isin, isins),
            gte(announcements.filedAt, fromMs - 35 * 86_400_000),
            lt(announcements.filedAt, toMs),
          ),
        )
    : [];
  const inWindow = annRows.filter((a) => a.filedAt >= fromMs);
  const newestByKey = new Map<string, (typeof inWindow)[number]>();
  for (const a of inWindow) {
    if (!a.eventKey) continue;
    const cur = newestByKey.get(a.eventKey);
    if (!cur || a.filedAt > cur.filedAt) newestByKey.set(a.eventKey, a);
  }

  const cards: EventCard[] = evRows.map((ev) => {
    let ids = 0;
    try {
      ids = (JSON.parse(ev.announcementIdsJson) as unknown[]).length;
    } catch {
      ids = 1;
    }
    const n = newestByKey.get(ev.eventKey) ?? null;
    return toCard(
      ev,
      safePayload(ev.cardJson),
      byIsin.get(ev.isin),
      ids,
      fromMs,
      n
        ? {
            subject: n.subject,
            desc: n.desc,
            category: n.category,
            subcategory: n.subcategory,
            priority: n.priority,
            tier: n.tier,
          }
        : null,
    );
  });
  const byPriority = (a: EventCard, b: EventCard) =>
    b.priority - a.priority || b.filedAtMs - a.filedAtMs;
  const tier1 = cards.filter((c) => c.tier === 1).sort(byPriority);
  const tier2 = cards.filter((c) => c.tier === 2).sort(byPriority);
  const t3 = cards.filter((c) => c.tier === 3);
  const groups = new Map<Category, EventCard[]>();
  for (const c of t3) {
    const arr = groups.get(c.category) ?? [];
    arr.push(c);
    groups.set(c.category, arr);
  }
  const tier3: BriefTier3Group[] = [...groups.entries()]
    .map(([category, items]) => ({
      category,
      count: items.length,
      items: items.sort(byPriority),
    }))
    .sort((a, b) => b.count - a.count);

  // anomalies — bars up to the window end, baseline from before the window
  const toKey = istDateKey(toMs - 1);
  const fromKey = istDateKey(fromMs);
  const barsBy = isins.length
    ? await loadBarsMany(
        isins,
        addDaysKey(fromKey, -(thresholds.lookbackDays + 30)),
        toKey,
      )
    : new Map();
  const caDates = corporateActionDatesFrom(
    annRows.map((a) => ({
      category: a.category,
      subject: a.subject,
      voiceSummary: a.voiceSummary,
    })),
    parseLooseDate,
  );
  const anomalies: Anomaly[] = [];
  for (const isin of isins) {
    const bars = barsBy.get(isin) ?? [];
    if (bars.length === 0) continue;
    for (const a of detectAnomalies(bars, {
      ...thresholds,
      corporateActionDates: caDates,
    })) {
      const closeMs = sessionCloseMs(a.date);
      if (closeMs >= fromMs && closeMs < toMs) anomalies.push(a);
    }
  }
  anomalies.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || Math.abs(b.value) - Math.abs(a.value),
  );

  // upcoming — board meetings for results, earnings calls, record dates with a date ≥ window end
  const afterKey = istDateKey(toMs);
  const upcoming: BriefUpcoming[] = [];
  const seenUp = new Set<string>();
  for (const a of annRows) {
    const isBm = a.category === "results" && a.subcategory === "bm_intimation";
    const isCall =
      a.category === "earnings_call" && a.subcategory === "schedule";
    const isRecord =
      (a.category === "dividend" || a.category === "bonus_split") &&
      a.subcategory === "record_date";
    if (!isBm && !isCall && !isRecord) continue;
    const key = firstFutureDate(
      `${a.subject} ${a.voiceSummary ?? ""}`,
      afterKey,
    );
    if (!key) continue;
    const what = isBm
      ? "Board meeting — results"
      : isCall
        ? "Earnings call"
        : a.category === "dividend"
          ? "Dividend record date"
          : "Bonus/split record date";
    const dedupeKey = `${a.isin}|${what}|${key}`;
    if (seenUp.has(dedupeKey)) continue;
    seenUp.add(dedupeKey);
    upcoming.push({
      isin: a.isin,
      symbol: byIsin.get(a.isin)?.nseSymbol ?? a.isin,
      what,
      dateIst: formatIst(key, "dd MMM yyyy"),
    });
  }
  upcoming.sort((a, b) => a.dateIst.localeCompare(b.dateIst));

  const counts: BriefCounts = {
    filings: inWindow.length,
    events: cards.length,
    needsYou: tier1.length,
    filedAway: t3.length,
  };
  const model: BriefModel = {
    window: { fromMs, toMs, label: windowLabel(fromMs, toMs), widened },
    counts,
    tier1,
    tier2,
    tier3,
    anomalies,
    upcoming: upcoming.length ? upcoming : undefined,
  };
  if (cards.length === 0) {
    model.quiet = {
      reason:
        isins.length === 0
          ? "No companies in the portfolio yet"
          : windowQuietReason(fromMs, toMs),
    };
  }
  return model;
}

/**
 * Why a window is empty: looks at the sessions whose close falls inside the
 * window — none → the calendar reason (weekend / holiday); only a special
 * session (Muhurat) → says so; a regular session → simply a quiet period.
 */
export function windowQuietReason(fromMs: number, toMs: number): string {
  let key = istDateKey(fromMs);
  const lastKey = istDateKey(toMs - 1);
  let sawNormal = false;
  let special: string | null = null;
  for (let i = 0; i < 400 && key <= lastKey; i++) {
    const close = sessionCloseMs(key);
    if (close >= fromMs && close < toMs) {
      const t = sessionType(key);
      if (t === "normal") sawNormal = true;
      else if (t === "special")
        special = NSE_SPECIAL_SESSIONS[key]?.name ?? "special session";
    }
    key = addDaysKey(key, 1);
  }
  if (sawNormal) return "No filings from your companies in this window";
  if (special) return `${special} only — no regular session`;
  return (
    nonTradingReason(toMs - 1) ?? nonTradingReason(fromMs) ?? "Market closed"
  );
}

/** Plain-text rendering of a brief (the digest CLI; also handy in tests). */
export function renderBriefText(b: BriefModel): string {
  const lines: string[] = [];
  lines.push(
    `FINN brief — ${b.window.label} (${formatIst(b.window.fromMs)} → ${formatIst(b.window.toMs)} IST)`,
  );
  if (b.window.widened) lines.push(`  ⚠ ${b.window.widened}`);
  lines.push(
    `  ${b.counts.filings} filings · ${b.counts.events} events · ${b.counts.needsYou} need you · ${b.counts.filedAway} filed away`,
  );
  if (b.quiet) lines.push(`  Quiet: ${b.quiet.reason}`);
  const card = (c: EventCard) => {
    lines.push(
      `  • [${c.symbol}] ${c.title}  (${c.category}, p${c.priority}, ${c.filedAtIst} IST${c.followUps ? `, +${c.followUps} follow-ups` : ""})`,
    );
    lines.push(`      ${c.oneLiner}`);
    for (const s of c.sources.slice(0, 3))
      lines.push(`      ↳ ${s.label}: ${s.url}`);
  };
  if (b.tier1.length) {
    lines.push("", "NEEDS YOU");
    for (const c of b.tier1) card(c);
  }
  if (b.tier2.length) {
    lines.push("", "WORTH KNOWING");
    for (const c of b.tier2) card(c);
  }
  if (b.tier3.length) {
    lines.push("", `FILED AWAY (${b.counts.filedAway})`);
    for (const g of b.tier3)
      lines.push(
        `  ${g.category}: ${g.count} — ${g.items
          .slice(0, 4)
          .map((i) => `${i.symbol}: ${i.title}`)
          .join(" · ")}`,
      );
  }
  if (b.anomalies.length) {
    lines.push("", "EOD ANOMALIES");
    for (const a of b.anomalies)
      lines.push(`  • ${a.isin} ${a.date} ${a.kind}: ${a.summary}`);
  }
  if (b.upcoming?.length) {
    lines.push("", "UPCOMING");
    for (const u of b.upcoming)
      lines.push(`  • ${u.dateIst} — ${u.symbol}: ${u.what}`);
  }
  lines.push("", "You're done.");
  return lines.join("\n");
}
