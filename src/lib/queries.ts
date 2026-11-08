/**
 * Read-only queries for the UI (Builder D). Every function reads the real
 * tables so the surfaces work unchanged once the engine fills the DB.
 *
 * Contracts the engine builders must satisfy (see the final report):
 * - `events.card_json` is either the bare category payload or the envelope
 *   `{ title, oneLiner, priority?, periodEnd?, sources?: SourceRef[], card }`.
 *   Without a title the UI derives one from the primary announcement.
 * - board-meeting / event-calendar intimations are announcements whose
 *   `raw_json` carries `eventDate: 'YYYY-MM-DD'` and `eventPurpose`.
 * - `alerts.payload_json` may carry `{ title, body, because, symbol }`.
 * - `guidance.evidence_json` may carry `{ delivered: {value, unit, source}, statedAt }`.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  max,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  DeliveredVia,
  parseJsonColumn,
  ResultsChecks,
  StringArray,
  TripwireRule,
  UserPrefs,
} from "@/db/json";
import * as t from "@/db/schema";
import { computeResultsCard } from "@/engine/analyse/results";
import type {
  Anomaly,
  Category,
  GuidanceDirection,
  GuidanceStatus,
  ResultsQuarter,
  ResultsVerification,
  Verdict,
} from "@/engine/types";
import { CATEGORIES } from "@/engine/types";
import {
  addDaysKey,
  formatIst,
  istDateKey,
  istTimeOn,
  sessionType,
} from "@/lib/time";
import type {
  AnomalyWithSymbol,
  BacktestGrid,
  CompanyIndexRow,
  CompanyPageModel,
  DocumentItem,
  EventCard,
  EventDetail,
  InboxItem,
  LedgerRowView,
  PriceSeries,
  QuarterRow,
  SettlementLine,
  Snapshot,
  SourceRef,
  StatusModel,
  TripwireView,
  UpcomingItem,
} from "@/ui/model";
import { quarterLabel } from "./format";

export const DEMO_USER_ID = "demo";

type CompanyRow = typeof t.companies.$inferSelect;
type EventRow = typeof t.events.$inferSelect;
type AnnRow = typeof t.announcements.$inferSelect;
type PriceRow = typeof t.prices.$inferSelect;

// ---------------------------------------------------------------------------
// Users / scope
// ---------------------------------------------------------------------------

export interface DemoUser {
  id: string;
  portfolioIsins: string[];
  prefs: ReturnType<typeof UserPrefs.parse>;
  exists: boolean;
}

/**
 * The single demo user. The portfolio is the union of the user's own list
 * and `companies.in_portfolio` (the seeded portfolio and the add/remove
 * actions keep both in step; the union covers a DB where only one was set).
 */
export async function getDemoUser(): Promise<DemoUser> {
  const rows = await db
    .select()
    .from(t.users)
    .where(eq(t.users.id, DEMO_USER_ID))
    .limit(1);
  const u = rows[0];
  const own = u ? parseJsonColumn(StringArray, u.portfolioIsinsJson, []) : [];
  const cos = await db
    .select({ isin: t.companies.isin })
    .from(t.companies)
    .where(eq(t.companies.inPortfolio, true));
  const known = new Set(cos.map((c) => c.isin));
  const all = await db.select({ isin: t.companies.isin }).from(t.companies);
  const exists = new Set(all.map((c) => c.isin));
  const portfolioIsins = [
    ...new Set([...own.filter((i) => exists.has(i)), ...known]),
  ];
  return {
    id: DEMO_USER_ID,
    portfolioIsins,
    prefs: u ? parseJsonColumn(UserPrefs, u.prefsJson, {}) : {},
    exists: Boolean(u),
  };
}

export async function companiesByIsin(
  isins: string[],
): Promise<Map<string, CompanyRow>> {
  if (!isins.length) return new Map();
  const rows = await db
    .select()
    .from(t.companies)
    .where(inArray(t.companies.isin, isins));
  return new Map(rows.map((r) => [r.isin, r]));
}

// ---------------------------------------------------------------------------
// Event cards
// ---------------------------------------------------------------------------

interface Envelope {
  title?: string;
  oneLiner?: string;
  priority?: number;
  periodEnd?: string;
  sources?: SourceRef[];
  card?: unknown;
}

/** The ingest's BioPayload (engine/ingest/announcements) → the UI's management-change card. */
function bioToCard(
  bio: Record<string, unknown>,
  title: string | undefined,
  tags: string[],
): Record<string, unknown> {
  // the title is the best witness; tags are the union of every subject the
  // filing was posted under, so they are consulted only when the title is mute
  const inferFrom = (s: string): string | null => {
    const h = s.toLowerCase();
    if (/re-?appoint/.test(h)) return "re-appointed";
    if (/appoint/.test(h)) return "appointed";
    if (/resign/.test(h)) return "resigned";
    if (/retire|superannuat/.test(h)) return "retired";
    if (/cessat|demise|ceas/.test(h)) return "ceased";
    if (/redesignat|elevat|promot/.test(h)) return "redesignated";
    return null;
  };
  const excerpt =
    typeof bio.profileExcerpt === "string" ? bio.profileExcerpt : null;
  // SEBI mandates a brief profile only on appointment, so a profile means the
  // person carrying it is the appointee even when the filing also covers exits
  const surname = (typeof bio.name === "string" ? bio.name : "")
    .replace(/^(mr|ms|mrs|dr|shri|smt)\.?\s+/i, "")
    .split(/\s+/)
    .pop()
    ?.toLowerCase();
  const titleLc = (title ?? "").toLowerCase();
  const namedExit =
    surname &&
    titleLc.includes(surname) &&
    /resign|retire|cessat|demise|superannuat/.test(titleLc);
  const action = namedExit
    ? (inferFrom(title ?? "") ?? "ceased")
    : excerpt && excerpt.length > 80
      ? "appointed"
      : (inferFrom(title ?? "") ?? inferFrom(tags.join(" ")) ?? "appointed");
  return {
    person: typeof bio.name === "string" ? bio.name : "—",
    role: typeof bio.role === "string" ? bio.role : "",
    action,
    effective_date:
      typeof bio.effectiveDate === "string" ? bio.effectiveDate : null,
    reason: null,
    brief_profile_excerpt: excerpt?.length ? excerpt : null,
    prior_roles: Array.isArray(bio.priorRoles)
      ? (bio.priorRoles as string[])
      : [],
    confidence:
      bio.confidence === "medium" || bio.confidence === "low"
        ? bio.confidence
        : "high",
    education: typeof bio.education === "string" ? bio.education : undefined,
    page: typeof bio.page === "number" ? bio.page : undefined,
    ...(Array.isArray(bio.people) && bio.people.length
      ? { people: bio.people }
      : {}),
  };
}

/**
 * `events.card_json` arrives in one of three shapes:
 *  1. a bare category payload (ResultsCard / fields object),
 *  2. the UI envelope `{ title, oneLiner, priority?, periodEnd?, sources?, card }`,
 *  3. the ingest's CardPayload `{ version: 1, title, oneLiner, fields, bio?, sources[], tags[] … }`.
 *
 * `adaptCardPayload` is the object form (used by the engine-backed brief in
 * `src/lib/brief.ts`, whose cards already carry the parsed payload).
 */
export function adaptCardPayload(obj: unknown): {
  envelope: Envelope;
  card: unknown;
} {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as Record<string, unknown>;
    if (typeof o.title === "string" || "card" in o) {
      const env: Envelope = {
        title: typeof o.title === "string" ? o.title : undefined,
        oneLiner: typeof o.oneLiner === "string" ? o.oneLiner : undefined,
        priority: typeof o.priority === "number" ? o.priority : undefined,
        periodEnd: typeof o.periodEnd === "string" ? o.periodEnd : undefined,
        sources: Array.isArray(o.sources)
          ? (o.sources as SourceRef[]).filter(
              (s) => s && typeof s.url === "string",
            )
          : undefined,
      };
      if ("card" in o) return { envelope: env, card: o.card ?? null };
      // ingest CardPayload
      const tags = Array.isArray(o.tags) ? (o.tags as string[]) : [];
      if (o.bio && typeof o.bio === "object")
        return {
          envelope: env,
          card: bioToCard(o.bio as Record<string, unknown>, env.title, tags),
        };
      if (o.fields && typeof o.fields === "object")
        return { envelope: env, card: o.fields };
      return { envelope: env, card: null };
    }
    return { envelope: {}, card: obj };
  }
  return { envelope: {}, card: obj ?? null };
}

function parseCardJson(raw: string): { envelope: Envelope; card: unknown } {
  try {
    return adaptCardPayload(JSON.parse(raw));
  } catch {
    return { envelope: {}, card: null };
  }
}

function looksLikeResultsCard(c: unknown): boolean {
  return Boolean(
    c && typeof c === "object" && Array.isArray((c as { rows?: unknown }).rows),
  );
}

/**
 * Results events whose payload is not a ResultsCard get one computed from
 * `results_quarters` through the engine's `computeResultsCard` (Builder B);
 * consolidated first, standalone as the fallback. Best-effort — a missing or
 * half-built engine module leaves the card as it was.
 */
export async function attachResultsCards(cards: EventCard[]): Promise<void> {
  const todo = cards.filter(
    (c) =>
      c.category === "results" && c.tier < 3 && !looksLikeResultsCard(c.card),
  );
  if (!todo.length) return;
  let analyse: typeof import("@/engine/analyse/results") | null = null;
  try {
    // results.ts is pure (no fs, no network) — safe to pull into a page render
    analyse = await import("@/engine/analyse/results");
  } catch {
    return;
  }
  for (const c of todo) {
    try {
      const rows = await db
        .select()
        .from(t.resultsQuarters)
        .where(eq(t.resultsQuarters.isin, c.isin))
        .orderBy(asc(t.resultsQuarters.periodEnd));
      if (!rows.length) continue;
      const quarters = rows.map(rowToResultsQuarter);
      const card =
        analyse.computeResultsCard(quarters, "consolidated") ??
        analyse.computeResultsCard(quarters, "standalone");
      if (card) c.card = card;
    } catch {
      // leave the payload alone
    }
  }
}

/** DB row → engine ResultsQuarter (money stays in rupees; checks parsed loosely). */
function rowToResultsQuarter(
  r: typeof t.resultsQuarters.$inferSelect,
): ResultsQuarter {
  const checks = parseJsonColumn(ResultsChecks, r.checksJson, {});
  return {
    isin: r.isin,
    periodEnd: r.periodEnd,
    basis: r.basis === "standalone" ? "standalone" : "consolidated",
    source:
      r.source === "legacy" ? "legacy" : r.source === "pdf" ? "pdf" : "xbrl",
    audited: r.audited,
    revenue: r.revenue,
    otherIncome: r.otherIncome,
    financeCosts: r.financeCosts,
    dna: r.dna,
    pbeit: r.pbeit,
    exceptional: r.exceptional,
    pbt: r.pbt,
    tax: r.tax,
    pat: r.pat,
    patCont: r.patCont,
    eps: r.eps,
    checks: { ...checks, warnings: checks.warnings ?? [] },
    sourceUrl: r.sourceUrl,
    filedAt: r.filedAt,
  };
}

function asCategory(s: string): Category {
  return (CATEGORIES as readonly string[]).includes(s)
    ? (s as Category)
    : "unclassified";
}

function clampTier(n: number): 1 | 2 | 3 {
  return n <= 1 ? 1 : n === 2 ? 2 : 3;
}

function firstSentence(s: string, maxWords = 28): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(trimmed);
  const sentence = m?.[1] ?? trimmed;
  const words = sentence.split(" ");
  return words.length > maxWords
    ? `${words.slice(0, maxWords).join(" ")}…`
    : sentence;
}

function deriveTitle(ev: EventRow, primary: AnnRow | undefined): string {
  if (primary?.subject) {
    const words = primary.subject.replace(/\s+/g, " ").trim().split(" ");
    return words.length > 10
      ? `${words.slice(0, 10).join(" ")}…`
      : words.join(" ");
  }
  if (primary?.desc) return primary.desc;
  const cat = ev.category.replace(/_/g, " ");
  return `${cat.charAt(0).toUpperCase()}${cat.slice(1)} filing`;
}

function sourceLabel(a: AnnRow): string {
  const d = a.desc.toLowerCase();
  if (a.hasXbrl && /result|financial/.test(d)) return "XBRL filing";
  if (/presentation/.test(d)) return "Investor deck";
  if (/transcript/.test(d)) return "Transcript";
  if (/newspaper/.test(d)) return "Newspaper ad";
  if (/press/.test(d)) return "Press release";
  if (/outcome of board/.test(d)) return "Board outcome";
  if (/record date/.test(d)) return "Record date";
  if (
    /appointment|resignation|change in (management|director)|retirement|cessation/.test(
      d,
    )
  )
    return "Reg 30 filing";
  return a.desc.length > 22 ? `${a.desc.slice(0, 21)}…` : a.desc || "Filing";
}

function toEventCard(
  ev: EventRow,
  company: CompanyRow | undefined,
  anns: AnnRow[],
): EventCard {
  const sorted = [...anns].sort((a, b) => a.filedAt - b.filedAt);
  const primary = sorted[0];
  const { envelope, card } = parseCardJson(ev.cardJson);
  const sources: SourceRef[] = [...(envelope.sources ?? [])];
  for (const a of sorted) {
    if (!a.attachmentUrl) continue;
    if (sources.some((s) => s.url === a.attachmentUrl)) continue;
    sources.push({
      url: a.attachmentUrl,
      kind: a.hasXbrl ? "xbrl" : "filing",
      label: sourceLabel(a),
    });
  }
  const priority =
    envelope.priority ??
    (anns.length ? Math.max(...anns.map((a) => a.priority)) : 0);
  // a results payload without its own period label borrows the envelope's
  if (
    envelope.periodEnd &&
    looksLikeResultsCard(card) &&
    !(card as { periodEnd?: string }).periodEnd
  )
    (card as { periodEnd?: string }).periodEnd = envelope.periodEnd;
  const voice = sorted.find((a) => a.voiceSummary)?.voiceSummary ?? undefined;
  const oneLiner =
    envelope.oneLiner ??
    (voice
      ? firstSentence(voice)
      : primary?.text
        ? firstSentence(primary.text)
        : "");
  return {
    eventKey: ev.eventKey,
    isin: ev.isin,
    symbol: company?.nseSymbol ?? primary?.symbol ?? ev.isin,
    companyName: company?.name ?? primary?.symbol ?? ev.isin,
    category: asCategory(ev.category),
    tier: clampTier(ev.tier),
    priority,
    title: envelope.title ?? deriveTitle(ev, primary),
    oneLiner,
    filedAtMs: primary?.filedAt ?? ev.firstAt,
    // without the source stamp we only trust the day, so the UI shows no time
    filedAtIst: primary?.filedAtIst ?? formatIst(ev.firstAt, "dd-MMM-yyyy"),
    sources: sources.slice(0, 5),
    card,
    followUps: Math.max(0, anns.length - 1),
    voiceSummary: voice,
  };
}

async function announcementsForEvents(
  eventKeys: string[],
): Promise<Map<string, AnnRow[]>> {
  const map = new Map<string, AnnRow[]>();
  if (!eventKeys.length) return map;
  const rows = await db
    .select()
    .from(t.announcements)
    .where(inArray(t.announcements.eventKey, eventKeys))
    .orderBy(asc(t.announcements.filedAt));
  for (const r of rows) {
    if (!r.eventKey) continue;
    const list = map.get(r.eventKey) ?? [];
    list.push(r);
    map.set(r.eventKey, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Prices → anomalies
// ---------------------------------------------------------------------------

export interface AnomalyThresholds {
  volumeRatio: number;
  lookbackDays: number;
  pricePct: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  volumeRatio: 2,
  lookbackDays: 20,
  pricePct: 5,
};

interface ScoredBar {
  isin: string;
  date: string;
  close: number | null;
  pct: number | null;
  ratio: number | null;
  volume: number | null;
}

/** Score every normal-session bar against the trailing average of normal sessions. */
function scoreBars(bars: PriceRow[], lookback: number): ScoredBar[] {
  const byIsin = new Map<string, PriceRow[]>();
  for (const b of bars) {
    const l = byIsin.get(b.isin) ?? [];
    l.push(b);
    byIsin.set(b.isin, l);
  }
  const out: ScoredBar[] = [];
  for (const [isin, list] of byIsin) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const window: number[] = [];
    for (const b of list) {
      const isNormal = b.sessionType === "normal";
      const avg =
        window.length >= Math.min(5, lookback)
          ? window.reduce((s, v) => s + v, 0) / window.length
          : null;
      const ratio = isNormal && avg && b.volume != null ? b.volume / avg : null;
      const pct =
        b.close != null && b.prevClose
          ? ((b.close - b.prevClose) / b.prevClose) * 100
          : null;
      out.push({
        isin,
        date: b.date,
        close: b.close,
        pct,
        ratio,
        volume: b.volume,
      });
      if (isNormal && b.volume != null) {
        window.push(b.volume);
        if (window.length > lookback) window.shift();
      }
    }
  }
  return out;
}

async function loadBars(isins: string[], fromKey: string, toKey: string) {
  if (!isins.length) return [] as PriceRow[];
  return db
    .select()
    .from(t.prices)
    .where(
      and(
        inArray(t.prices.isin, isins),
        gte(t.prices.date, fromKey),
        lte(t.prices.date, toKey),
      ),
    )
    .orderBy(asc(t.prices.date));
}

export async function getAnomalies(
  isins: string[],
  fromMs: number,
  toMs: number,
  thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS,
): Promise<AnomalyWithSymbol[]> {
  if (!isins.length) return [];
  const fromKey = istDateKey(fromMs);
  const toKey = istDateKey(toMs);
  const bars = await loadBars(isins, addDaysKey(fromKey, -60), toKey);
  const scored = scoreBars(bars, thresholds.lookbackDays);
  const cos = await companiesByIsin(isins);
  const out: AnomalyWithSymbol[] = [];
  for (const s of scored) {
    if (s.date < fromKey || s.date > toKey) continue;
    if (sessionType(s.date) === "special") continue;
    const volHit = s.ratio != null && s.ratio >= thresholds.volumeRatio;
    const pxHit = s.pct != null && Math.abs(s.pct) >= thresholds.pricePct;
    if (!volHit && !pxHit) continue;
    const c = cos.get(s.isin);
    const symbol = c?.nseSymbol ?? s.isin;
    const kind: Anomaly["kind"] =
      pxHit &&
      (!volHit ||
        Math.abs(s.pct ?? 0) / thresholds.pricePct >
          (s.ratio ?? 0) / thresholds.volumeRatio)
        ? "price_move"
        : "volume_ratio";
    const summary =
      kind === "price_move"
        ? `${symbol} ${(s.pct ?? 0) > 0 ? "up" : "down"} ${Math.abs(s.pct ?? 0).toFixed(1)}% on ${(s.ratio ?? 0).toFixed(1)}× volume`
        : `${symbol} volume ${(s.ratio ?? 0).toFixed(1)}× the ${thresholds.lookbackDays}-day average`;
    out.push({
      isin: s.isin,
      date: s.date,
      kind,
      value: kind === "price_move" ? (s.pct ?? 0) : (s.ratio ?? 0),
      threshold:
        kind === "price_move" ? thresholds.pricePct : thresholds.volumeRatio,
      summary,
      symbol,
      companyName: c?.name ?? symbol,
      close: s.close,
      pctMove: s.pct,
      volumeRatio: s.ratio,
    });
  }
  return out.sort(
    (a, b) =>
      (b.date < a.date ? -1 : b.date > a.date ? 1 : 0) ||
      Math.abs(b.pctMove ?? 0) - Math.abs(a.pctMove ?? 0),
  );
}

// ---------------------------------------------------------------------------
// Upcoming (board-meeting / event-calendar intimations stored as announcements)
// ---------------------------------------------------------------------------

const MONTH_NUM: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function monthNum(word: string): number | undefined {
  return MONTH_NUM[word.slice(0, 3).toLowerCase()];
}

/** First date in `text` on/after `afterKey` — "10-Nov-2026", "November 12, 2026", "12 November 2026", "12.11.2026". */
export function firstFutureDateKey(
  text: string,
  afterKey: string,
): string | null {
  const found: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const m of text.matchAll(
    /\b(\d{1,2})(?:st|nd|rd|th)?[-\s.]+([A-Za-z]{3,9})[-\s.,]+(\d{4})\b/g,
  )) {
    const mo = monthNum(m[2] ?? "");
    if (mo) found.push(`${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`);
  }
  for (const m of text.matchAll(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g,
  )) {
    const mo = monthNum(m[1] ?? "");
    if (mo) found.push(`${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g))
    found.push(`${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`);
  const future = found
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= afterKey)
    .sort();
  return future[0] ?? null;
}

/**
 * "Coming up": board-meeting / earnings-call / record-date intimations.
 * Reads both conventions — `raw_json.eventDate` (explicit, fixtures and the
 * event-calendar ingest) and the classifier's
 * `subcategory ∈ {bm_intimation, schedule, record_date}` with the date parsed
 * from the subject text.
 */
export async function getUpcoming(
  isins: string[],
  now: number,
  limit = 8,
): Promise<UpcomingItem[]> {
  if (!isins.length) return [];
  const todayKey = istDateKey(now);
  const eventDate = sql<
    string | null
  >`json_extract(${t.announcements.rawJson}, '$.eventDate')`;
  const purpose = sql<
    string | null
  >`json_extract(${t.announcements.rawJson}, '$.eventPurpose')`;
  const rows = await db
    .select({
      isin: t.announcements.isin,
      symbol: t.announcements.symbol,
      category: t.announcements.category,
      subcategory: t.announcements.subcategory,
      subject: t.announcements.subject,
      voiceSummary: t.announcements.voiceSummary,
      eventDate,
      purpose,
    })
    .from(t.announcements)
    .where(
      and(
        inArray(t.announcements.isin, isins),
        gte(t.announcements.filedAt, now - 45 * 86_400_000),
        sql`(${eventDate} >= ${todayKey} OR ${t.announcements.subcategory} IN ('bm_intimation','board_meeting','schedule','record_date'))`,
      ),
    )
    .orderBy(desc(t.announcements.filedAt))
    .limit(200);
  const seen = new Set<string>();
  const out: UpcomingItem[] = [];
  for (const r of rows) {
    let key = r.eventDate && r.eventDate >= todayKey ? r.eventDate : null;
    if (!key)
      key = firstFutureDateKey(
        `${r.subject} ${r.voiceSummary ?? ""}`,
        todayKey,
      );
    if (!key) continue;
    const what =
      r.purpose ??
      (r.subcategory === "bm_intimation" || r.subcategory === "board_meeting"
        ? "Board meeting · results"
        : r.subcategory === "schedule"
          ? "Earnings call"
          : r.subcategory === "record_date"
            ? r.category === "dividend"
              ? "Dividend record date"
              : "Record date"
            : r.subject);
    const k = `${r.isin}|${key}|${what}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      isin: r.isin,
      symbol: r.symbol,
      what,
      dateIst: formatIst(key, "EEE d MMM"),
      dateKey: key,
    });
  }
  return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Brief — rendered from the engine's `buildBrief` through `src/lib/brief.ts`
// (single source of truth; the UI adapters below are reused there).
// ---------------------------------------------------------------------------

/**
 * When the data was last checked: the newest finished ingestion job, else the
 * newest stored announcement for the companies in scope.
 */
export async function getCheckedAt(isins: string[]): Promise<number | null> {
  const job = await db
    .select({ m: max(t.jobs.updatedAt) })
    .from(t.jobs)
    .where(
      and(
        inArray(t.jobs.kind, ["announcements", "eod", "digest"]),
        eq(t.jobs.state, "done"),
      ),
    );
  if (job[0]?.m) return job[0].m;
  if (!isins.length) return null;
  const r = await db
    .select({ m: max(t.announcements.createdAt) })
    .from(t.announcements)
    .where(inArray(t.announcements.isin, isins));
  return r[0]?.m ?? null;
}

// ---------------------------------------------------------------------------
// Event detail
// ---------------------------------------------------------------------------

async function settlementFor(
  isin: string,
  periodEnd: string | null,
): Promise<SettlementLine | null> {
  const rows = await db
    .select({
      metric: t.guidance.metric,
      status: t.guidance.status,
      verdict: t.guidance.verdict,
      settledByQuarter: t.guidance.settledByQuarter,
    })
    .from(t.guidance)
    .where(eq(t.guidance.isin, isin));
  if (!rows.length) return null;
  const q = periodEnd ? quarterLabel(periodEnd) : null;
  const settled = rows.filter(
    (r) => r.status === "settled" && (!q || r.settledByQuarter === q),
  );
  const open = rows.filter((r) => r.status === "open").length;
  const verdicts = settled
    .filter((r) => r.verdict)
    .map((r) => ({ metric: r.metric, verdict: r.verdict as string }));
  const total = settled.length + open;
  let text: string;
  if (settled.length) {
    const parts = verdicts
      .slice(0, 3)
      .map(
        (v) => `${v.metric.replace(/_/g, " ")} ${v.verdict.replace(/_/g, " ")}`,
      );
    text = `${settled.length} of ${total} promises settled: ${parts.join(", ")}`;
  } else if (open) {
    text = `${open} ${open === 1 ? "promise" : "promises"} open · settles with the next results`;
  } else {
    text = "No open promises on record";
  }
  return { text, settled: settled.length, open, verdicts };
}

export async function getEventDetail(
  eventKey: string,
): Promise<EventDetail | null> {
  const evs = await db
    .select()
    .from(t.events)
    .where(eq(t.events.eventKey, eventKey))
    .limit(1);
  const ev = evs[0];
  if (!ev) return null;
  const [cos, annMap] = await Promise.all([
    companiesByIsin([ev.isin]),
    announcementsForEvents([eventKey]),
  ]);
  const anns = annMap.get(eventKey) ?? [];
  const card = toEventCard(ev, cos.get(ev.isin), anns);
  await attachResultsCards([card]);
  let settlement: SettlementLine | null = null;
  if (card.category === "results") {
    const { envelope } = parseCardJson(ev.cardJson);
    let periodEnd = envelope.periodEnd ?? null;
    if (!periodEnd) {
      const q = await db
        .select({ p: max(t.resultsQuarters.periodEnd) })
        .from(t.resultsQuarters)
        .where(eq(t.resultsQuarters.isin, ev.isin));
      periodEnd = q[0]?.p ?? null;
    }
    settlement = await settlementFor(ev.isin, periodEnd);
  }
  return {
    card,
    filings: anns.map((a) => ({
      id: a.id,
      desc: a.desc,
      subject: a.subject,
      filedAtMs: a.filedAt,
      filedAtIst: a.filedAtIst,
      attachmentUrl: a.attachmentUrl,
      attachmentSize: a.attachmentSize,
      hasXbrl: a.hasXbrl,
    })),
    settlement,
  };
}

/** Latest results period for an isin (for the detail header), consolidated preferred. */
export async function getLatestPeriod(isin: string): Promise<string | null> {
  const q = await db
    .select({ p: max(t.resultsQuarters.periodEnd) })
    .from(t.resultsQuarters)
    .where(eq(t.resultsQuarters.isin, isin));
  return q[0]?.p ?? null;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export async function getCompanyBySymbol(
  symbol: string,
): Promise<CompanyRow | null> {
  const s = symbol.trim().toUpperCase();
  const direct = await db
    .select()
    .from(t.companies)
    .where(eq(t.companies.nseSymbol, s))
    .limit(1);
  if (direct[0]) return direct[0];
  // alias lookup (TATAMOTORS → TMPV)
  const viaAlias = await db
    .select()
    .from(t.companies)
    .where(
      sql`exists (select 1 from json_each(${t.companies.aliasesJson}) where upper(json_each.value) = ${s})`,
    )
    .limit(1);
  return viaAlias[0] ?? null;
}

function ebitdaOf(r: typeof t.resultsQuarters.$inferSelect): number | null {
  const base = r.pbeit ?? r.pbt;
  if (base == null || r.financeCosts == null || r.dna == null) return null;
  return base + r.financeCosts + r.dna - (r.otherIncome ?? 0);
}

/** Loose parse of checks_json: only the two bank numbers the UI displays. */
const ChecksLoose = z
  .object({ nii: z.number().optional(), ppop: z.number().optional() })
  .passthrough();

function toQuarterRow(r: typeof t.resultsQuarters.$inferSelect): QuarterRow {
  const checks = parseJsonColumn(ChecksLoose, r.checksJson, {});
  return {
    periodEnd: r.periodEnd,
    basis: r.basis === "standalone" ? "standalone" : "consolidated",
    source:
      r.source === "legacy" ? "legacy" : r.source === "pdf" ? "pdf" : "xbrl",
    audited: r.audited,
    revenue: r.revenue,
    ebitda: ebitdaOf(r),
    pbt: r.pbt,
    pat: r.pat,
    eps: r.eps,
    exceptional: r.exceptional,
    otherIncome: r.otherIncome,
    financeCosts: r.financeCosts,
    dna: r.dna,
    nii: typeof checks.nii === "number" ? checks.nii : null,
    ppop: typeof checks.ppop === "number" ? checks.ppop : null,
    sourceUrl: r.sourceUrl,
  };
}

function yoyBase(
  rows: QuarterRow[],
  latest: QuarterRow,
): QuarterRow | undefined {
  const [y, md] = [latest.periodEnd.slice(0, 4), latest.periodEnd.slice(4)];
  const key = `${Number(y) - 1}${md}`;
  return rows.find((r) => r.periodEnd === key && r.basis === latest.basis);
}

function pct(
  now: number | null,
  base: number | null | undefined,
): number | null {
  if (now == null || base == null || base === 0) return null;
  return ((now - base) / Math.abs(base)) * 100;
}

async function loadCompanyQuarters(isin: string): Promise<{
  quarters: QuarterRow[];
  engine: ResultsQuarter[];
}> {
  const rows = await db
    .select()
    .from(t.resultsQuarters)
    .where(eq(t.resultsQuarters.isin, isin))
    .orderBy(asc(t.resultsQuarters.periodEnd));
  return {
    quarters: rows.map(toQuarterRow),
    engine: rows.map(rowToResultsQuarter),
  };
}

export async function getQuarters(isin: string): Promise<QuarterRow[]> {
  return (await loadCompanyQuarters(isin)).quarters;
}

/**
 * Verification already computed for the results card of this snapshot quarter.
 * Null when that basis has no card, or the card is for a different period.
 */
export function verificationForSnapshot(
  quarters: ResultsQuarter[],
  latest: { periodEnd: string; basis: "consolidated" | "standalone" } | null,
): ResultsVerification | null {
  if (!latest) return null;
  const card = computeResultsCard(quarters, latest.basis);
  if (!card?.verification || card.periodEnd !== latest.periodEnd) return null;
  return card.verification;
}

export async function getPriceSeries(
  isin: string,
  sessions = 62,
): Promise<PriceSeries> {
  const rows = await db
    .select()
    .from(t.prices)
    .where(eq(t.prices.isin, isin))
    .orderBy(desc(t.prices.date))
    .limit(sessions);
  rows.reverse();
  const last = rows.at(-1);
  const lastPct =
    last?.close != null && last.prevClose
      ? ((last.close - last.prevClose) / last.prevClose) * 100
      : null;
  return {
    dates: rows.map((r) => r.date),
    closes: rows.map((r) => r.close),
    volumes: rows.map((r) => r.volume),
    sessionTypes: rows.map((r) => r.sessionType),
    lastClose: last?.close ?? null,
    lastPct,
    lastDate: last?.date ?? null,
  };
}

export async function getLedger(isin: string): Promise<LedgerRowView[]> {
  const rows = await db
    .select({ g: t.guidance, d: t.documents })
    .from(t.guidance)
    .leftJoin(t.documents, eq(t.guidance.docId, t.documents.id))
    .where(eq(t.guidance.isin, isin))
    .orderBy(desc(t.guidance.createdAt));
  return rows.map(({ g, d }) => {
    const evidence = parseJsonColumn(
      z.record(z.string(), z.unknown()),
      g.evidenceJson,
      {} as Record<string, unknown>,
    );
    const delivered = (evidence.delivered ??
      null) as LedgerRowView["delivered"];
    const knownStatedAt =
      typeof evidence.statedAt === "number" ? evidence.statedAt : null;
    const statedAt = knownStatedAt ?? d?.fetchedAt ?? g.createdAt;
    return {
      id: g.id,
      isin: g.isin,
      docId: g.docId,
      quote: g.quote,
      speaker: g.speaker,
      role: g.role,
      page: g.page,
      metric: g.metric,
      direction: (g.direction ?? "qualitative") as GuidanceDirection,
      low: g.low,
      high: g.high,
      unit: g.unit,
      horizon: g.horizon,
      status: (g.status as GuidanceStatus) ?? "open",
      statedAt,
      settledByQuarter: g.settledByQuarter,
      verdict: (g.verdict as Verdict | null) ?? null,
      delivered:
        delivered && typeof delivered === "object"
          ? {
              value:
                typeof delivered.value === "number" ? delivered.value : null,
              unit: typeof delivered.unit === "string" ? delivered.unit : null,
              source:
                typeof delivered.source === "string" ? delivered.source : null,
            }
          : null,
      evidence,
      docKind: d?.kind ?? null,
      docPeriod: d?.period ?? null,
      docUrl: d?.url ?? null,
      statedOnIst:
        knownStatedAt != null ? formatIst(knownStatedAt, "d MMM yyyy") : null,
    };
  });
}

export async function getCompanyEvents(
  isin: string,
  limit = 12,
): Promise<EventCard[]> {
  const evs = await db
    .select()
    .from(t.events)
    .where(eq(t.events.isin, isin))
    .orderBy(desc(t.events.lastAt))
    .limit(limit);
  const [cos, anns] = await Promise.all([
    companiesByIsin([isin]),
    announcementsForEvents(evs.map((e) => e.eventKey)),
  ]);
  const cards = evs.map((e) =>
    toEventCard(e, cos.get(isin), anns.get(e.eventKey) ?? []),
  );
  await attachResultsCards(cards);
  return cards;
}

export async function getDocuments(isin: string): Promise<DocumentItem[]> {
  const rows = await db
    .select()
    .from(t.documents)
    .where(eq(t.documents.isin, isin))
    .orderBy(desc(t.documents.createdAt));
  return rows.map((d) => ({
    id: d.id,
    kind: d.kind,
    period: d.period,
    url: d.url,
    pages: d.pages,
    fetchedAt: d.fetchedAt,
    textStatus: d.textStatus,
  }));
}

export async function getCompanyPage(
  symbol: string,
): Promise<CompanyPageModel | null> {
  const c = await getCompanyBySymbol(symbol);
  if (!c) return null;
  const [loaded, prices, ledger, events, documents] = await Promise.all([
    loadCompanyQuarters(c.isin),
    getPriceSeries(c.isin),
    getLedger(c.isin),
    getCompanyEvents(c.isin),
    getDocuments(c.isin),
  ]);
  const { quarters } = loaded;
  const consolidated = quarters.filter((q) => q.basis === "consolidated");
  const pool = consolidated.length ? consolidated : quarters;
  const latest = pool.at(-1);
  const base = latest ? yoyBase(quarters, latest) : undefined;
  const isBank =
    (latest?.nii != null && latest.ppop != null) ||
    /bank/i.test(c.industry ?? "") ||
    /bank/i.test(c.sector ?? "");
  const snapshot: Snapshot = {
    periodEnd: latest?.periodEnd ?? null,
    basis: latest?.basis ?? null,
    revenue: latest?.revenue ?? null,
    ebitda: latest?.ebitda ?? null,
    pat: latest?.pat ?? null,
    revenueYoy: pct(latest?.revenue ?? null, base?.revenue),
    ebitdaYoy: pct(latest?.ebitda ?? null, base?.ebitda),
    patYoy: pct(latest?.pat ?? null, base?.pat),
    nii: latest?.nii ?? null,
    ppop: latest?.ppop ?? null,
    isBank,
    checksum: latest
      ? latest.source === "xbrl"
        ? "exchange_xbrl"
        : "preliminary"
      : null,
    verification: verificationForSnapshot(loaded.engine, latest ?? null),
  };
  return {
    company: {
      isin: c.isin,
      symbol: c.nseSymbol,
      name: c.name,
      sector: c.sector,
      industry: c.industry,
      inPortfolio: c.inPortfolio,
      isAdhoc: c.isAdhoc,
      aliases: parseJsonColumn(StringArray, c.aliasesJson, []),
    },
    snapshot,
    prices,
    ledger,
    quarters,
    events,
    documents,
  };
}

// ---------------------------------------------------------------------------
// Companies index
// ---------------------------------------------------------------------------

export async function getCompaniesIndex(
  isins: string[],
): Promise<CompanyIndexRow[]> {
  if (!isins.length) return [];
  const [cos, bars, lastFilings, openPromises] = await Promise.all([
    companiesByIsin(isins),
    loadBars(
      isins,
      addDaysKey(istDateKey(Date.now()), -45),
      istDateKey(Date.now()),
    ),
    db
      .select({ isin: t.announcements.isin, m: max(t.announcements.filedAt) })
      .from(t.announcements)
      .where(inArray(t.announcements.isin, isins))
      .groupBy(t.announcements.isin),
    db
      .select({ isin: t.guidance.isin, n: count() })
      .from(t.guidance)
      .where(
        and(inArray(t.guidance.isin, isins), eq(t.guidance.status, "open")),
      )
      .groupBy(t.guidance.isin),
  ]);
  const barsBy = new Map<string, PriceRow[]>();
  for (const b of bars) {
    const l = barsBy.get(b.isin) ?? [];
    l.push(b);
    barsBy.set(b.isin, l);
  }
  const lf = new Map(lastFilings.map((r) => [r.isin, r.m]));
  const op = new Map(openPromises.map((r) => [r.isin, r.n]));
  const out: CompanyIndexRow[] = [];
  for (const isin of isins) {
    const c = cos.get(isin);
    if (!c) continue;
    const list = (barsBy.get(isin) ?? []).filter(
      (b) => b.sessionType === "normal",
    );
    const last = list.at(-1);
    out.push({
      isin,
      symbol: c.nseSymbol,
      name: c.name,
      industry: c.industry,
      inPortfolio: c.inPortfolio,
      isAdhoc: c.isAdhoc,
      lastClose: last?.close ?? null,
      lastPct:
        last?.close != null && last.prevClose
          ? ((last.close - last.prevClose) / last.prevClose) * 100
          : null,
      spark: list.slice(-30).map((b) => b.close),
      lastFilingMs: lf.get(isin) ?? null,
      openPromises: op.get(isin) ?? 0,
    });
  }
  return out.sort((a, b) => {
    if (a.inPortfolio !== b.inPortfolio) return a.inPortfolio ? -1 : 1;
    return a.symbol.localeCompare(b.symbol);
  });
}

// ---------------------------------------------------------------------------
// Tripwires / backtest
// ---------------------------------------------------------------------------

export async function getTripwires(
  userId = DEMO_USER_ID,
): Promise<TripwireView[]> {
  const rows = await db
    .select()
    .from(t.tripwires)
    .where(eq(t.tripwires.userId, userId))
    .orderBy(asc(t.tripwires.createdAt));
  const out: TripwireView[] = [];
  for (const r of rows) {
    const rule = parseJsonColumn(TripwireRule, r.ruleJson, null);
    if (!rule) continue;
    out.push({
      id: r.id,
      kind: rule.kind,
      params: rule.params as Record<string, unknown>,
      enabled: r.enabled,
      isin: r.isin,
    });
  }
  return out;
}

export const VOLUME_STEPS = Array.from(
  { length: 15 },
  (_, i) => 1.5 + i * 0.25,
);
export const PRICE_STEPS = Array.from({ length: 17 }, (_, i) => 2 + i * 0.5);

export async function getBacktestGrid(
  isins: string[],
  days = 60,
  defaults: AnomalyThresholds = DEFAULT_THRESHOLDS,
): Promise<BacktestGrid | null> {
  if (!isins.length) return null;
  const todayKey = istDateKey(Date.now());
  const fromKey = addDaysKey(todayKey, -days);
  const bars = await loadBars(isins, addDaysKey(fromKey, -45), todayKey);
  if (!bars.length) return null;
  const cos = await companiesByIsin(isins);
  const scored = scoreBars(bars, defaults.lookbackDays).filter(
    (s) => s.date >= fromKey && sessionType(s.date) === "normal",
  );
  if (!scored.length) return null;
  const volume: Record<string, number> = {};
  for (const v of VOLUME_STEPS)
    volume[v.toFixed(2)] = scored.filter(
      (s) => s.ratio != null && s.ratio >= v,
    ).length;
  const price: Record<string, number> = {};
  for (const p of PRICE_STEPS)
    price[p.toFixed(1)] = scored.filter(
      (s) => s.pct != null && Math.abs(s.pct) >= p,
    ).length;
  const either: Record<string, number> = {};
  for (const v of VOLUME_STEPS)
    for (const p of PRICE_STEPS)
      either[`${v.toFixed(2)}|${p.toFixed(1)}`] = scored.filter(
        (s) =>
          (s.ratio != null && s.ratio >= v) ||
          (s.pct != null && Math.abs(s.pct) >= p),
      ).length;
  const hit = (s: ScoredBar) =>
    (s.ratio != null && s.ratio >= defaults.volumeRatio) ||
    (s.pct != null && Math.abs(s.pct) >= defaults.pricePct);
  const perSymbol = new Map<string, number>();
  const perDate = new Map<string, number>();
  const sessions = new Set<string>();
  for (const s of scored) {
    sessions.add(s.date);
    if (!hit(s)) continue;
    const sym = cos.get(s.isin)?.nseSymbol ?? s.isin;
    perSymbol.set(sym, (perSymbol.get(sym) ?? 0) + 1);
    perDate.set(s.date, (perDate.get(s.date) ?? 0) + 1);
  }
  const dates = [...sessions].sort();
  return {
    sessions: dates.length,
    days,
    volume,
    price,
    either,
    topOffenders: [...perSymbol.entries()]
      .map(([symbol, fires]) => ({ symbol, fires }))
      .sort((a, b) => b.fires - a.fires)
      .slice(0, 4),
    strip: dates
      .slice(-30)
      .map((date) => ({ date, fires: perDate.get(date) ?? 0 })),
  };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

const AlertPayload = z
  .object({
    title: z.string().optional(),
    body: z.string().optional(),
    summary: z.string().optional(),
    because: z.string().optional(),
    rule: z.string().optional(),
    symbol: z.string().optional(),
  })
  .passthrough();

export async function getInbox(
  userId = DEMO_USER_ID,
  limit = 60,
): Promise<InboxItem[]> {
  const rows = await db
    .select({ a: t.alerts, c: t.companies })
    .from(t.alerts)
    .leftJoin(t.companies, eq(t.alerts.isin, t.companies.isin))
    .where(eq(t.alerts.userId, userId))
    .orderBy(desc(t.alerts.firedAt))
    .limit(limit);
  return rows.map(({ a, c }) => {
    const p = parseJsonColumn(AlertPayload, a.payloadJson, {});
    const symbol = c?.nseSymbol ?? p.symbol ?? null;
    return {
      id: a.id,
      kind: a.kind,
      symbol,
      companyName: c?.name ?? null,
      title: p.title ?? p.summary ?? a.kind.replace(/_/g, " "),
      body: p.body ?? null,
      firedAtMs: a.firedAt,
      deliveredVia: parseJsonColumn(DeliveredVia, a.deliveredViaJson, {}),
      readAt: a.readAt,
      href: a.eventKey
        ? `/e/${encodeURIComponent(a.eventKey)}`
        : symbol
          ? `/c/${symbol}`
          : null,
      because: p.because ?? p.rule ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Paid-equivalent list prices, USD per 1M tokens (docs/research/14 §1). Gemma is free. */
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.1-flash-lite": { in: 0.3, out: 2.5 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75 },
  "gemini-3.5-flash": { in: 0.75, out: 3.75 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
};

function priceFor(model: string): { in: number; out: number } {
  if (PRICE_PER_M[model])
    return PRICE_PER_M[model] as { in: number; out: number };
  if (model.startsWith("gemma")) return { in: 0, out: 0 };
  return model.includes("lite")
    ? { in: 0.3, out: 2.5 }
    : { in: 0.75, out: 3.75 };
}

export async function getStatus(): Promise<StatusModel> {
  const nowMs = Date.now();
  const gateway = await import("@/engine/llm/gateway");
  const datePt = gateway.todayPt(new Date(nowMs));
  let dbOk = true;
  try {
    await db.select({ n: count() }).from(t.companies);
  } catch {
    dbOk = false;
  }
  const ledgerRows = dbOk
    ? await db.select().from(t.llmLedger).where(eq(t.llmLedger.datePt, datePt))
    : [];
  const budgets = dbOk ? await gateway.remainingBudget(new Date(nowMs)) : [];
  const tierOf = new Map(budgets.map((b) => [b.model, b.tier]));
  const capOf = new Map(budgets.map((b) => [b.model, b.cap]));
  const seen = new Set<string>();
  const models: StatusModel["models"] = [];
  for (const r of ledgerRows) {
    seen.add(r.model);
    const p = priceFor(r.model);
    const costUsd =
      (r.tokensIn * p.in + (r.tokensOut + r.tokensThought) * p.out) / 1_000_000;
    const cap = capOf.get(r.model) ?? gateway.dailyCap(r.model);
    models.push({
      model: r.model,
      tier:
        tierOf.get(r.model) ??
        (r.model.includes("lite") || r.model.startsWith("gemma")
          ? "bulk"
          : "reason"),
      requests: r.requests,
      cap,
      remaining: Math.max(0, cap - r.requests),
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      tokensThought: r.tokensThought,
      errors: r.errors,
      costUsd,
    });
  }
  for (const b of budgets) {
    if (seen.has(b.model)) continue;
    models.push({
      model: b.model,
      tier: b.tier,
      requests: 0,
      cap: b.cap,
      remaining: b.cap,
      tokensIn: 0,
      tokensOut: 0,
      tokensThought: 0,
      errors: 0,
      costUsd: 0,
    });
  }
  models.sort((a, b) =>
    a.tier === b.tier ? b.requests - a.requests : a.tier === "bulk" ? -1 : 1,
  );
  const totals = models.reduce(
    (s, m) => ({
      requests: s.requests + m.requests,
      tokensIn: s.tokensIn + m.tokensIn,
      tokensOut: s.tokensOut + m.tokensOut,
      costUsd: s.costUsd + m.costUsd,
    }),
    { requests: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  );

  const cacheByTask = dbOk
    ? await db
        .select({ task: t.llmCache.task, n: count() })
        .from(t.llmCache)
        .groupBy(t.llmCache.task)
    : [];

  const freshness: StatusModel["freshness"] = [];
  if (dbOk) {
    const add = async (
      table: string,
      stamp: string,
      q: Promise<Array<{ n: number; m: number | string | null }>>,
      toMs?: (m: string) => number,
    ) => {
      const r = (await q)[0];
      const m = r?.m ?? null;
      freshness.push({
        table,
        rows: r?.n ?? 0,
        newestMs:
          m == null ? null : typeof m === "number" ? m : toMs ? toMs(m) : null,
        stamp,
      });
    };
    await add(
      "companies",
      "added",
      db.select({ n: count(), m: max(t.companies.addedAt) }).from(t.companies),
    );
    await add(
      "prices",
      "trade date",
      db.select({ n: count(), m: max(t.prices.date) }).from(t.prices),
      (d) => istTimeOn(d, "15:30"),
    );
    await add(
      "announcements",
      "filed",
      db
        .select({ n: count(), m: max(t.announcements.filedAt) })
        .from(t.announcements),
    );
    await add(
      "events",
      "updated",
      db.select({ n: count(), m: max(t.events.updatedAt) }).from(t.events),
    );
    await add(
      "results_quarters",
      "updated",
      db
        .select({ n: count(), m: max(t.resultsQuarters.updatedAt) })
        .from(t.resultsQuarters),
    );
    await add(
      "documents",
      "fetched",
      db
        .select({ n: count(), m: max(t.documents.fetchedAt) })
        .from(t.documents),
    );
    await add(
      "guidance",
      "extracted",
      db.select({ n: count(), m: max(t.guidance.createdAt) }).from(t.guidance),
    );
    await add(
      "facts",
      "stored",
      db.select({ n: count(), m: max(t.facts.createdAt) }).from(t.facts),
    );
    await add(
      "research_sections",
      "generated",
      db
        .select({ n: count(), m: max(t.researchSections.generatedAt) })
        .from(t.researchSections),
    );
    await add(
      "alerts",
      "fired",
      db.select({ n: count(), m: max(t.alerts.firedAt) }).from(t.alerts),
    );
    await add(
      "llm_cache",
      "cached",
      db.select({ n: count(), m: max(t.llmCache.createdAt) }).from(t.llmCache),
    );
    await add(
      "jobs",
      "updated",
      db.select({ n: count(), m: max(t.jobs.updatedAt) }).from(t.jobs),
    );
  }

  const jobs = dbOk
    ? (
        await db.select().from(t.jobs).orderBy(desc(t.jobs.updatedAt)).limit(8)
      ).map((j) => ({
        id: j.id,
        kind: j.kind,
        isin: j.isin,
        step: j.step,
        state: j.state,
        updatedAt: j.updatedAt,
      }))
    : [];

  const fixture = dbOk
    ? await db
        .select({ n: count() })
        .from(t.prices)
        .where(eq(t.prices.source, "fixture"))
    : [];

  return {
    dbOk,
    nowMs,
    datePt,
    models,
    totals,
    cache: {
      entries: cacheByTask.reduce((s, r) => s + r.n, 0),
      byTask: cacheByTask
        .map((r) => ({ task: r.task, n: r.n }))
        .sort((a, b) => b.n - a.n),
    },
    freshness,
    jobs,
    fixtureRows: fixture[0]?.n ?? 0,
  };
}

/** Today's remaining reason-tier budget for the Ask sheet (first model of the reason ladder). */
export async function getAskBudget(): Promise<{
  model: string;
  remaining: number;
  cap: number;
} | null> {
  try {
    const gateway = await import("@/engine/llm/gateway");
    const budgets = await gateway.remainingBudget();
    const reason = budgets.filter((b) => b.tier === "reason");
    const pick = reason.find((b) => b.remaining > 0) ?? reason[0];
    if (!pick) return null;
    return { model: pick.model, remaining: pick.remaining, cap: pick.cap };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Jobs (working receipt for /add)
// ---------------------------------------------------------------------------

export async function getLatestJobForIsin(isin: string) {
  const rows = await db
    .select()
    .from(t.jobs)
    .where(eq(t.jobs.isin, isin))
    .orderBy(desc(t.jobs.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}
