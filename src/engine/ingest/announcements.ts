/**
 * Announcements pipeline: AnnouncementRaw[] → `announcements` rows →
 * classify (rules → attachment text → LLM residue) → L0 dedupe → L1 events →
 * enrichment (one-liners, bios) → `events` rows with card_json.
 *
 * Idempotent: announcements upsert by `nse:<seq_id>`, events by event_key
 * (ids are unioned). Safe to re-run; cache hits make re-runs free of LLM quota.
 */
import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements, events } from "@/db/schema";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { addDaysKey, formatIst, istDateKey } from "@/lib/time";
import { computePriority, tierFor } from "../analyse/priority";
import {
  extractAttachmentText,
  hasCachedAttachmentText,
  shouldFetchAttachment,
} from "../extract/attachment-text";
import {
  backfillBioFromHistory,
  detectProfilePointer,
  educationFrom,
  findBriefProfile,
  pageAt,
  profileScore,
} from "../extract/bio";
import type { ExtractedBio } from "../extract/index";
import {
  extractOneLinersBatch,
  fallbackOneLiner,
  fallbackTitle,
  firstSentence,
  LLM_CATEGORIES,
  type OneLinerInput,
  type OneLinerResult,
} from "../extract/oneliner";
import { verifyQuote } from "../llm/verify";
import {
  fetchAnnouncements,
  parseFileSize,
} from "../sources/nse-announcements";
import type {
  AnnouncementRaw,
  CardType,
  Category,
  Classification,
  Company,
  Tier,
} from "../types";
import {
  type ClassifiedItem,
  classifyBatch,
  classifyRules,
  llmResidueClassifier,
  RESIDUE_THRESHOLD,
  toClassification,
} from "./classify";
import { companyIndex, companyMcapInr, listCompanies } from "./companies";
import {
  EVENT_WINDOW_MS,
  type ExistingEvent,
  filedAtMs,
  findExactReposts,
  type GroupedEvent,
  groupIntoEvents,
  isResultsFollowUp,
} from "./dedupe";
import type { IngestSummary } from "./index";

const log = logger.child({ mod: "engine/ingest/announcements" });

// ---------------------------------------------------------------------------
// Card payload (events.card_json) — the UI reads this through analyse/brief
// ---------------------------------------------------------------------------

export type SourceKind =
  | "filing"
  | "deck"
  | "press_release"
  | "transcript"
  | "recording"
  | "newspaper"
  | "xbrl"
  | "voice"
  | "other";

export interface CardSource {
  url: string;
  kind: SourceKind;
  label: string;
  announcementId: string;
  filedAtMs: number;
}

export interface BioPayload extends ExtractedBio {
  sourceAnnouncementId: string;
  sourceUrl: string | null;
  /** high = verbatim profile ≥ 150 chars from the filing; medium = shorter/backfilled; low = none */
  confidence: "high" | "medium" | "low";
  backfilledFrom?: {
    announcementId: string;
    filedAtIst: string;
    url: string;
  } | null;
}

export interface CardPayload {
  version: 1;
  title: string;
  oneLiner: string;
  category: Category;
  subcategory?: string;
  tier: Tier;
  priority: number;
  /** category-shaped, list-valued fields after the gates (see extract/oneliner.ts) */
  fields: Record<string, unknown> | null;
  bio?: BioPayload | null;
  extraction: {
    by: "llm" | "rules" | "none";
    model?: string;
    grounded: boolean;
    dropped: string[];
  };
  primaryAnnouncementId: string;
  sources: CardSource[];
  /** union of NSE `desc` values folded into this event */
  tags: string[];
  voiceSummary?: string | null;
  /** classifier cue of the primary announcement */
  cue: string;
}

export function cardTypeFor(category: Category, tier: Tier): CardType {
  if (category === "results") return "results";
  if (category === "management_change" && tier < 3) return "management_change";
  if (tier === 3) return "routine";
  return "oneliner";
}

export function sourceKindFor(
  cls: Pick<Classification, "category" | "subcategory">,
  url: string,
): SourceKind {
  if (/\.zip$/i.test(url)) return "xbrl";
  if (cls.category === "earnings_call")
    return cls.subcategory === "transcript"
      ? "transcript"
      : cls.subcategory === "recording"
        ? "recording"
        : "filing";
  if (cls.subcategory === "presentation") return "deck";
  if (cls.subcategory === "press_release") return "press_release";
  if (cls.subcategory === "newspaper") return "newspaper";
  return "filing";
}

export function sourceLabelFor(
  cls: Pick<Classification, "category" | "subcategory">,
  desc: string,
): string {
  switch (cls.subcategory) {
    case "presentation":
      return "Investor presentation";
    case "press_release":
      return "Press release";
    case "newspaper":
      return "Newspaper ad";
    case "transcript":
      return "Transcript";
    case "recording":
      return "Call recording";
    case "schedule":
      return "Call schedule";
    case "record_date":
      return "Record date";
    case "auditor_report":
      return "Auditor's report";
    default:
      return desc || "Filing";
  }
}

// ---------------------------------------------------------------------------
// Options / result
// ---------------------------------------------------------------------------

export interface IngestAnnouncementsOptions {
  /** use Gemini for residue classification + one-liners (default: when GEMINI_API_KEY is set) */
  llm?: boolean;
  /** shared call budget for this run (default 30) */
  llmBudget?: { remaining: number };
  /** download attachments for Tier 1/2 items (default true) */
  attachments?: boolean;
  attachmentConcurrency?: number;
  /** max attachments to download in this run (default 80) */
  maxAttachments?: number;
  /** skip bio backfill from symbol history (1 history call + a few PDFs per pointer) */
  bioBackfill?: boolean;
}

export interface AnnouncementsIngestResult extends IngestSummary {
  events: number;
  eventsByTier: Record<Tier, number>;
  eventsByCategory: Partial<Record<Category, number>>;
  reposts: number;
  attachmentsFetched: number;
  llmCalls: number;
  cardsWithFields: number;
  biosFound: number;
  elapsedMs: number;
}

interface Work {
  raw: AnnouncementRaw;
  id: string;
  isin: string;
  filedAt: number;
  sizeBytes: number | null;
  cls: Classification;
  cue: string;
  confidence: number;
  text: string | null;
  isRepost: boolean;
  eventKey: string;
  llmReason?: string;
}

function toWorkId(seq: string): string {
  return `nse:${seq}`;
}

async function mapPool<T, R>(
  items: T[],
  n: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** Upsert raw announcements, classify, dedupe into events, enrich cards. */
export async function ingestAnnouncements(
  rawIn: AnnouncementRaw[],
  o: IngestAnnouncementsOptions = {},
): Promise<AnnouncementsIngestResult> {
  const started = Date.now();
  const useLlm = o.llm ?? Boolean(env().GEMINI_API_KEY);
  const budget = o.llmBudget ?? { remaining: 30 };
  const budgetStart = budget.remaining;
  const result: AnnouncementsIngestResult = {
    fetched: rawIn.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    events: 0,
    eventsByTier: { 1: 0, 2: 0, 3: 0 },
    eventsByCategory: {},
    reposts: 0,
    attachmentsFetched: 0,
    llmCalls: 0,
    cardsWithFields: 0,
    biosFound: 0,
    elapsedMs: 0,
  };

  // 0. sanitise + de-duplicate by seq_id. The API's `sm_isin` is STALE for
  // companies that changed ISIN after a split (observed 8 Nov 2026: SUPREMEIND,
  // BAJFINANCE, HDFCBANK, LAURUSLABS, NUVAMA, PIIND, SUNPHARMA), so the ISIN is
  // resolved through the companies table by symbol/alias whenever possible.
  const { byIsin: companiesByIsin, bySymbol: companiesBySymbol } =
    await companyIndex();
  const bySeq = new Map<string, AnnouncementRaw>();
  let isinCorrections = 0;
  for (const r of rawIn) {
    if (!r.seq_id) {
      result.skipped++;
      continue;
    }
    const resolved = companiesBySymbol.get(r.symbol.toUpperCase())?.isin;
    const isin = resolved ?? r.sm_isin;
    if (!isin) {
      result.skipped++;
      continue;
    }
    if (resolved && resolved !== r.sm_isin) isinCorrections++;
    bySeq.set(r.seq_id, isin === r.sm_isin ? r : { ...r, sm_isin: isin });
  }
  if (isinCorrections)
    log.info(
      { isinCorrections },
      "stale sm_isin values replaced from the companies master",
    );
  const raws = [...bySeq.values()];
  if (raws.length === 0) {
    result.elapsedMs = Date.now() - started;
    return result;
  }
  const isins = [...new Set(raws.map((r) => r.sm_isin))];
  const times = raws.map(filedAtMs);
  const minAt = Math.min(...times);
  const maxAt = Math.max(...times);

  // 1. history from the DB for novelty / repetition / L0 / event attachment
  const histRowsAll = await db
    .select({
      id: announcements.id,
      isin: announcements.isin,
      category: announcements.category,
      subcategory: announcements.subcategory,
      filedAt: announcements.filedAt,
      eventKey: announcements.eventKey,
      attachmentUrl: announcements.attachmentUrl,
      attachmentSize: announcements.attachmentSize,
      subject: announcements.subject,
      desc: announcements.desc,
      rawJson: announcements.rawJson,
    })
    .from(announcements)
    .where(
      and(
        inArray(announcements.isin, isins),
        gte(announcements.filedAt, minAt - 180 * 86_400_000),
        lte(announcements.filedAt, maxAt + 86_400_000),
      ),
    );
  // only real exchange rows count as history (UI fixture rows are prefixed "fx:")
  const histRows = histRowsAll.filter((h) => /^(nse|bse):/.test(h.id));
  const existingIds = new Set(histRows.map((h) => h.id));
  const existingEvents = await db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.isin, isins),
        gte(events.lastAt, minAt - 12 * 86_400_000),
      ),
    );

  // 2. L0 exact re-posts (within the batch + against stored rows in the window)
  const histRaws: AnnouncementRaw[] = [];
  for (const h of histRows) {
    if (bySeq.has(h.id.replace(/^nse:/, ""))) continue;
    try {
      const r = JSON.parse(h.rawJson) as AnnouncementRaw;
      if (r?.seq_id) histRaws.push(r);
    } catch {
      // ignore malformed history
    }
  }
  const reposts = findExactReposts([...histRaws, ...raws]);

  // 3. first-pass classification (rules) with novelty context
  const sortedRaws = [...raws].sort((a, b) => filedAtMs(a) - filedAtMs(b));
  const items: Work[] = [];
  const classifyCtx = (
    raw: AnnouncementRaw,
    cat: Category,
    at: number,
    extraText?: string,
  ) => {
    // filings inside the same 48 h event window are follow-ups, not repeats — look further back only
    const cutoff = at - EVENT_WINDOW_MS;
    const before180 = histRows.filter(
      (h) =>
        h.isin === raw.sm_isin &&
        h.category === cat &&
        h.filedAt < cutoff &&
        h.filedAt >= at - 180 * 86_400_000 &&
        h.id !== toWorkId(raw.seq_id),
    );
    const batchBefore = items.filter(
      (w) =>
        w.isin === raw.sm_isin &&
        w.cls.category === cat &&
        w.filedAt < cutoff &&
        !w.isRepost,
    );
    const recent7 =
      before180.filter((h) => h.filedAt >= at - 7 * 86_400_000).length +
      batchBefore.filter((w) => w.filedAt >= at - 7 * 86_400_000).length;
    return {
      seenBefore: before180.length + batchBefore.length > 0,
      recentSameCategory: recent7,
      extraText,
      mcapInr: companyMcapInr(raw.sm_isin) ?? undefined,
    };
  };
  for (const raw of sortedRaws) {
    const at = filedAtMs(raw);
    const rule = classifyRules(raw);
    const ctx = classifyCtx(raw, rule.category, at);
    const cls = toClassification(raw, rule, "rule", ctx);
    items.push({
      raw,
      id: toWorkId(raw.seq_id),
      isin: raw.sm_isin,
      filedAt: at,
      sizeBytes: parseFileSize(raw.attFileSize ?? raw.fileSize),
      cls,
      cue: rule.cue,
      confidence: rule.confidence,
      text: null,
      isRepost: reposts.has(raw.seq_id),
      eventKey: cls.eventKey,
    });
  }
  result.reposts = items.filter((w) => w.isRepost).length;

  // 4. attachments for Tier 1/2 (lazy, capped, cached)
  if (o.attachments !== false) {
    // Tier 1/2 material categories, plus small PDFs behind content-free subjects (the LLM residue needs text)
    const want = items.filter(
      (w) =>
        !w.isRepost &&
        (shouldFetchAttachment(w.cls, w.raw.attchmntFile, w.sizeBytes) ||
          (w.confidence < RESIDUE_THRESHOLD &&
            Boolean(w.raw.attchmntFile) &&
            (w.sizeBytes ?? 0) > 0 &&
            (w.sizeBytes ?? 0) <= 1.5 * 1024 * 1024)),
    );
    // the cap applies to NEW downloads only; cached texts are always loaded
    const maxNew = o.maxAttachments ?? 80;
    const seenUrls = new Set<string>();
    let newDownloads = 0;
    const picked = want.filter((w) => {
      const url = w.raw.attchmntFile;
      if (seenUrls.has(url)) return false;
      seenUrls.add(url);
      if (hasCachedAttachmentText(url)) return true;
      if (newDownloads >= maxNew) return false;
      newDownloads++;
      return true;
    });
    const texts = await mapPool(
      picked,
      o.attachmentConcurrency ?? 3,
      async (w) => {
        const t = await extractAttachmentText(w.raw.attchmntFile);
        return t;
      },
    );
    picked.forEach((w, i) => {
      const t = texts[i];
      if (t) {
        w.text = t.text;
        if (!t.cached) result.attachmentsFetched++;
      }
    });
    // share text between re-posts of the same PDF
    const byUrl = new Map(
      items.filter((w) => w.text).map((w) => [w.raw.attchmntFile, w.text]),
    );
    for (const w of items)
      if (!w.text && byUrl.has(w.raw.attchmntFile))
        w.text = byUrl.get(w.raw.attchmntFile) ?? null;
  }

  // 5. second pass: rules with attachment text, then LLM residue (batched)
  const reclassify = items.filter(
    (w) => !w.isRepost && (w.text || w.confidence < RESIDUE_THRESHOLD),
  );
  if (reclassify.length) {
    const classified: ClassifiedItem[] = await classifyBatch(
      reclassify.map((w) => w.raw),
      {
        llm: useLlm && budget.remaining > 0 ? llmResidueClassifier : null,
        maxCalls: Math.min(2, Math.max(0, budget.remaining)),
        ctxFor: (raw) => {
          const w = items.find((x) => x.raw.seq_id === raw.seq_id);
          return classifyCtx(
            raw,
            w?.cls.category ?? "unclassified",
            w?.filedAt ?? filedAtMs(raw),
            w?.text ?? undefined,
          );
        },
      },
    );
    let llmUsed = 0;
    for (const c of classified) {
      const w = items.find((x) => x.raw.seq_id === c.raw.seq_id);
      if (!w) continue;
      w.cls = c.classification;
      w.cue = c.rule.cue;
      w.confidence = c.rule.confidence;
      w.eventKey = c.classification.eventKey;
      if (c.llmReason) {
        w.llmReason = c.llmReason;
        llmUsed = 1;
      }
    }
    // recompute novelty-dependent priority now that categories are final
    for (const w of items) {
      if (w.isRepost) continue;
      const ctx = classifyCtx(
        w.raw,
        w.cls.category,
        w.filedAt,
        w.text ?? undefined,
      );
      const { priority, tier } = computePriority(
        w.raw,
        {
          category: w.cls.category,
          subcategory: w.cls.subcategory,
          classifiedBy: w.cls.classifiedBy,
          eventKey: w.eventKey,
        },
        ctx,
      );
      w.cls = { ...w.cls, priority, tier };
    }
    if (llmUsed) budget.remaining -= 1; // classifyBatch makes ≤ maxCalls calls; count conservatively
  }

  // 6. events (L1) — reposts attach to the original's event
  const groupInputs = items
    .filter((w) => !w.isRepost)
    .map((w) => ({
      id: w.id,
      isin: w.isin,
      category: w.cls.category,
      subcategory: w.cls.subcategory,
      filedAt: w.filedAt,
    }));
  const existing: ExistingEvent[] = existingEvents.map((e) => ({
    eventKey: e.eventKey,
    isin: e.isin,
    category: e.category as Category,
    firstAt: e.firstAt,
    lastAt: e.lastAt,
  }));
  const groups = groupIntoEvents(groupInputs, existing);
  const keyById = new Map<string, string>();
  for (const g of groups) for (const id of g.ids) keyById.set(id, g.eventKey);
  for (const w of items) {
    if (w.isRepost) continue;
    w.eventKey = keyById.get(w.id) ?? w.eventKey;
  }
  for (const w of items) {
    if (!w.isRepost) continue;
    const orig = items.find(
      (x) =>
        !x.isRepost &&
        x.isin === w.isin &&
        (x.raw.attchmntFile === w.raw.attchmntFile ||
          x.raw.attchmntText === w.raw.attchmntText),
    );
    if (orig) {
      w.eventKey = orig.eventKey;
      w.cls = {
        ...orig.cls,
        subcategory: "repost",
        tier: 3,
        priority: Math.min(orig.cls.priority, 5),
      };
    } else {
      w.cls = { ...w.cls, subcategory: "repost", tier: 3, priority: 5 };
    }
  }

  // 7. enrichment — one LLM batch per category over the primary announcement of each Tier 1/2 event
  const byKey = new Map<string, Work[]>();
  for (const w of items) {
    const arr = byKey.get(w.eventKey) ?? [];
    arr.push(w);
    byKey.set(w.eventKey, arr);
  }
  const primaryOf = (ws: Work[]): Work => {
    const real = ws.filter((w) => !w.isRepost);
    const pool = real.length ? real : ws;
    const outcome = pool.find(
      (w) => w.cls.category === "results" && w.cls.subcategory === "outcome",
    );
    if (outcome) return outcome;
    // loudest filing first (it names the event), then the richest text, then the earliest
    return [...pool].sort(
      (a, b) =>
        b.cls.priority - a.cls.priority ||
        (b.text?.length ?? 0) - (a.text?.length ?? 0) ||
        a.filedAt - b.filedAt,
    )[0] as Work;
  };
  const enrichInputs: OneLinerInput[] = [];
  const primaries = new Map<string, Work>();
  for (const [key, ws] of byKey) {
    const p = primaryOf(ws);
    primaries.set(key, p);
    const evTier = Math.min(
      ...ws.filter((w) => !w.isRepost).map((w) => w.cls.tier),
    ) as Tier;
    if (evTier === 3 || !LLM_CATEGORIES.has(p.cls.category)) continue;
    const company = companiesByIsin.get(p.isin);
    enrichInputs.push({
      id: p.id,
      category: p.cls.category,
      symbol: company?.nseSymbol ?? p.raw.symbol,
      companyName: company?.name ?? p.raw.sm_name,
      desc: p.raw.desc,
      subject: p.raw.attchmntText,
      voiceSummary: p.raw.voiceSummary ?? null,
      text: p.text,
      filedAtIst: p.raw.an_dt,
    });
  }
  let oneLiners = new Map<string, OneLinerResult>();
  if (useLlm && enrichInputs.length && budget.remaining > 0) {
    oneLiners = await extractOneLinersBatch(enrichInputs, { budget });
  }

  // 8. bios for management_change events (verbatim profile from the filing; backfill pointers)
  const bios = new Map<string, BioPayload>();
  for (const inp of enrichInputs) {
    if (inp.category !== "management_change") continue;
    const w = items.find((x) => x.id === inp.id);
    if (!w) continue;
    const bio = await buildBio(
      w,
      oneLiners.get(inp.id),
      o.bioBackfill !== false,
    );
    if (bio) {
      bios.set(inp.id, bio);
      if (bio.confidence !== "low") result.biosFound++;
    }
  }

  // 9. re-score with extracted fields, then write rows
  const now = Date.now();
  for (const [key, ws] of byKey) {
    const p = primaries.get(key) as Work;
    const ol = oneLiners.get(p.id);
    if (ol?.fields) {
      const ctx = classifyCtx(
        p.raw,
        p.cls.category,
        p.filedAt,
        p.text ?? undefined,
      );
      const { priority, tier } = computePriority(
        p.raw,
        {
          category: p.cls.category,
          subcategory: p.cls.subcategory,
          classifiedBy: p.cls.classifiedBy,
          eventKey: p.eventKey,
        },
        {
          ...ctx,
          extracted: primaryExtracted(p.cls.category, ol.fields),
          amountInr: headlineAmount(p.cls.category, ol.fields) ?? undefined,
        },
      );
      p.cls = { ...p.cls, priority, tier };
    }
    const real = ws.filter((w) => !w.isRepost);
    const evPriority = Math.max(...real.map((w) => w.cls.priority));
    const evTier = tierFor(evPriority);
    const firstAt = Math.min(...ws.map((w) => w.filedAt));
    const lastAt = Math.max(...ws.map((w) => w.filedAt));
    const company = companiesByIsin.get(p.isin);
    const payload = buildCardPayload(
      p,
      ws,
      ol,
      bios.get(p.id) ?? null,
      evTier,
      evPriority,
      company,
    );
    if (
      payload.fields &&
      Object.keys(payload.fields).some((k) => k !== "_totals")
    )
      result.cardsWithFields++;

    // announcements rows
    for (const w of ws) {
      const text = w.text ?? w.raw.attchmntText;
      const row = {
        id: w.id,
        isin: w.isin,
        symbol: company?.nseSymbol ?? w.raw.symbol,
        exchange: "NSE",
        desc: w.raw.desc,
        subject: w.raw.attchmntText,
        text,
        attachmentUrl: w.raw.attchmntFile || null,
        attachmentSize: w.sizeBytes,
        hasXbrl: w.raw.hasXbrl === "Yes" || w.raw.hasXbrl === "true",
        filedAt: w.filedAt,
        filedAtIst: w.raw.an_dt,
        category: w.cls.category,
        subcategory: w.cls.subcategory ?? null,
        classifiedBy: w.cls.classifiedBy,
        priority: w.cls.priority,
        tier: w.cls.tier,
        eventKey: w.eventKey,
        voiceSummary: w.raw.voiceSummary ?? null,
        voiceUrl: w.raw.voiceUrl ?? null,
        rawJson: JSON.stringify(w.raw),
      };
      try {
        await db
          .insert(announcements)
          .values(row)
          .onConflictDoUpdate({
            target: announcements.id,
            set: {
              symbol: row.symbol,
              desc: row.desc,
              subject: row.subject,
              text: row.text,
              attachmentUrl: row.attachmentUrl,
              attachmentSize: row.attachmentSize,
              hasXbrl: row.hasXbrl,
              filedAt: row.filedAt,
              filedAtIst: row.filedAtIst,
              category: row.category,
              subcategory: row.subcategory,
              classifiedBy: row.classifiedBy,
              priority: row.priority,
              tier: row.tier,
              eventKey: row.eventKey,
              voiceSummary: row.voiceSummary,
              voiceUrl: row.voiceUrl,
              rawJson: row.rawJson,
            },
          });
        if (existingIds.has(w.id)) result.updated++;
        else result.inserted++;
      } catch (e) {
        result.errors.push(
          `${w.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // event row (union ids with any stored ones)
    const stored = existingEvents.find((e) => e.eventKey === key);
    let storedIds: string[] = [];
    if (stored) {
      try {
        storedIds = (
          JSON.parse(stored.announcementIdsJson) as unknown[]
        ).filter((x): x is string => typeof x === "string");
      } catch {
        storedIds = [];
      }
    }
    const ids = [...new Set([...storedIds, ...ws.map((w) => w.id)])];
    try {
      await db
        .insert(events)
        .values({
          eventKey: key,
          isin: p.isin,
          category: p.cls.category,
          firstAt: Math.min(firstAt, stored?.firstAt ?? firstAt),
          lastAt: Math.max(lastAt, stored?.lastAt ?? lastAt),
          tier: evTier,
          cardType: cardTypeFor(p.cls.category, evTier),
          cardJson: JSON.stringify(payload),
          announcementIdsJson: JSON.stringify(ids),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: events.eventKey,
          set: {
            category: p.cls.category,
            firstAt: Math.min(firstAt, stored?.firstAt ?? firstAt),
            lastAt: Math.max(lastAt, stored?.lastAt ?? lastAt),
            tier: evTier,
            cardType: cardTypeFor(p.cls.category, evTier),
            cardJson: JSON.stringify(payload),
            announcementIdsJson: JSON.stringify(ids),
            updatedAt: now,
          },
        });
      result.events++;
      result.eventsByTier[evTier]++;
      result.eventsByCategory[p.cls.category] =
        (result.eventsByCategory[p.cls.category] ?? 0) + 1;
    } catch (e) {
      result.errors.push(
        `event ${key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // 10. orphan sweep — a re-run can move an announcement to another event key (reclassification);
  //     events in the processed range that no announcement references any more are removed
  try {
    const liveKeys = new Set(
      (
        await db
          .select({ eventKey: announcements.eventKey })
          .from(announcements)
          .where(
            and(
              inArray(announcements.isin, isins),
              gte(announcements.filedAt, minAt - 12 * 86_400_000),
            ),
          )
      )
        .map((r) => r.eventKey)
        .filter((k): k is string => Boolean(k)),
    );
    const candidates = await db
      .select({ eventKey: events.eventKey })
      .from(events)
      .where(
        and(
          inArray(events.isin, isins),
          gte(events.lastAt, minAt - 12 * 86_400_000),
        ),
      );
    const orphans = candidates
      .map((c) => c.eventKey)
      .filter((k) => /^IN[A-Z0-9]{10}\|/.test(k) && !liveKeys.has(k));
    if (orphans.length) {
      await db.delete(events).where(inArray(events.eventKey, orphans));
      log.info({ orphans: orphans.length }, "orphaned events removed");
    }
  } catch (e) {
    result.errors.push(
      `orphan sweep: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  result.llmCalls = Math.max(0, budgetStart - budget.remaining);
  result.elapsedMs = Date.now() - started;
  log.info(
    {
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
      events: result.events,
      byTier: result.eventsByTier,
      reposts: result.reposts,
      attachments: result.attachmentsFetched,
      llmCalls: result.llmCalls,
      bios: result.biosFound,
      ms: result.elapsedMs,
    },
    "announcements ingested",
  );
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function primaryExtracted(
  category: Category,
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  const first = (k: string): Record<string, unknown> | null => {
    const arr = fields[k];
    return Array.isArray(arr) && arr.length && typeof arr[0] === "object"
      ? (arr[0] as Record<string, unknown>)
      : null;
  };
  switch (category) {
    case "credit_rating": {
      const rs =
        (fields.ratings as Array<Record<string, unknown>> | undefined) ?? [];
      const strongest =
        rs.find((r) => /downgrade/.test(String(r.action))) ??
        rs.find((r) =>
          /upgrade|outlook|watch|withdraw/.test(String(r.action)),
        ) ??
        rs[0];
      return strongest ?? null;
    }
    case "pledging":
      return first("pledges");
    case "management_change":
      return first("changes");
    default:
      return null;
  }
}

function toInr(
  value: unknown,
  currency: unknown,
  unit: unknown,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cur = String(currency ?? "").toLowerCase();
  const u = String(unit ?? "").toLowerCase();
  let mult = 1;
  if (/crore|^cr/.test(u)) mult = 1e7;
  else if (/lakh|lac/.test(u)) mult = 1e5;
  else if (/million|^mn/.test(u)) mult = 1e6;
  else if (/billion|^bn/.test(u)) mult = 1e9;
  let fx = 1;
  if (/usd|us\$|\$|dollar/.test(cur)) fx = 84;
  else if (/eur|€/.test(cur)) fx = 90;
  else if (/gbp|£/.test(cur)) fx = 105;
  return value * mult * fx;
}

/** The largest stated amount in the extracted fields, in rupees (for materiality). */
export function headlineAmount(
  category: Category,
  fields: Record<string, unknown>,
): number | null {
  const lists: Record<string, string> = {
    m_and_a: "deals",
    fund_raise: "instruments",
    capex: "projects",
    litigation: "matters",
    press_release: "amounts",
  };
  const key = lists[category];
  if (!key) return null;
  const arr = fields[key];
  if (!Array.isArray(arr)) return null;
  let best: number | null = null;
  for (const it of arr as Array<Record<string, unknown>>) {
    const v = toInr(
      it.consideration ?? it.amount ?? it.value,
      it.currency,
      it.unit,
    );
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

/** Annexure rows that are NOT the brief profile (relationships, debarment affirmations, reasons). */
const NOT_A_PROFILE =
  /not (related|debarred)|disclosure of relationship|is not debarred|reason for (change|resignation)|not applicable/i;

async function buildBio(
  w: Work,
  ol: OneLinerResult | undefined,
  allowBackfill: boolean,
): Promise<BioPayload | null> {
  const text = w.text ?? "";
  const changes =
    (ol?.fields?.changes as Array<Record<string, unknown>> | undefined) ?? [];
  // bios are for people: auditor-firm appointments and CS/term-end notices get no bio card
  if (
    w.cls.subcategory &&
    ["auditor", "auditor_appointment", "cs_junior", "term_end"].includes(
      w.cls.subcategory,
    )
  )
    return null;
  const isFirm = (s: unknown) =>
    /\b(llp|limited|ltd|private|pvt|& ?co\b|associates|chartered accountants)\b/i.test(
      String(s ?? ""),
    );
  const rulesCandidates = text ? findBriefProfile(text) : [];
  const surnameOf = (person: unknown): string =>
    String(person ?? "")
      .replace(/\b(mr|ms|mrs|dr|prof|shri|smt)\.?\s+/gi, "")
      .trim()
      .split(/\s+/)
      .at(-1)
      ?.replace(/[^A-Za-z]/g, "") ?? "";
  const candidateFor = (person: unknown) => {
    const sn = surnameOf(person);
    return sn.length > 2
      ? rulesCandidates.find((c) =>
          c.excerpt.toLowerCase().includes(sn.toLowerCase()),
        )
      : undefined;
  };
  const verifiedLlmExcerpt = (c: Record<string, unknown>): string | null => {
    const e = c.brief_profile_excerpt;
    if (typeof e !== "string" || NOT_A_PROFILE.test(e)) return null;
    return verifyQuote(e, text) !== null ? e : null;
  };
  // In a multi-person filing, pick the appointee the filing actually profiles (rules row or a
  // verified model excerpt); otherwise the first non-firm appointee.
  const appointees = changes.filter(
    (c) =>
      /appointed|reappointed|redesignated/.test(String(c.action ?? "")) &&
      !isFirm(c.person),
  );
  const appointed =
    appointees.find((c) => candidateFor(c.person)) ??
    appointees.find((c) => verifiedLlmExcerpt(c)) ??
    appointees[0] ??
    null;
  const name = String(appointed?.person ?? "").trim();
  // the filing's own "Brief Profile" row (located by rules) is the most trustworthy excerpt when it
  // reads like a profile; the model's verbatim copy is used when the rules row is weak/garbled
  const ruleHit = appointed ? candidateFor(appointed.person) : undefined;
  const llmExcerpt = appointed ? verifiedLlmExcerpt(appointed) : null;
  let excerpt: string | null = null;
  if (ruleHit && (profileScore(ruleHit.excerpt) >= 30 || !llmExcerpt))
    excerpt = ruleHit.excerpt;
  else if (llmExcerpt) excerpt = llmExcerpt;
  else if (ruleHit) excerpt = ruleHit.excerpt;
  else if (!appointed && rulesCandidates.length)
    excerpt = rulesCandidates[0]?.excerpt ?? null;
  let backfilledFrom: BioPayload["backfilledFrom"] = null;
  let sourceText = text;
  if (
    !excerpt &&
    allowBackfill &&
    appointed &&
    name &&
    text &&
    detectProfilePointer(text)
  ) {
    const back = await backfillBioFromHistory(
      w.raw.symbol,
      name,
      w.filedAt,
    ).catch(() => null);
    if (back) {
      excerpt = back.candidates[0]?.excerpt ?? null;
      sourceText = back.text;
      backfilledFrom = {
        announcementId: toWorkId(back.raw.seq_id),
        filedAtIst: back.raw.an_dt,
        url: back.raw.attchmntFile,
      };
    }
  }
  if (!appointed && !excerpt) return null;
  const priorRoles = Array.isArray(appointed?.prior_roles)
    ? (appointed.prior_roles as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : [];
  const confidence: BioPayload["confidence"] =
    excerpt && excerpt.length >= 150 && !backfilledFrom
      ? "high"
      : excerpt
        ? "medium"
        : "low";
  return {
    name: name || "(name not extracted)",
    role: String(appointed?.role ?? "").trim() || "(role not extracted)",
    effectiveDate:
      typeof appointed?.effective_date === "string"
        ? appointed.effective_date
        : null,
    profileExcerpt: excerpt ?? "",
    priorRoles,
    education: excerpt ? educationFrom(excerpt) : null,
    page: excerpt
      ? pageAt(sourceText, sourceText.indexOf(excerpt.slice(0, 30)))
      : null,
    sourceAnnouncementId: backfilledFrom?.announcementId ?? w.id,
    sourceUrl: backfilledFrom?.url ?? (w.raw.attchmntFile || null),
    confidence,
    backfilledFrom,
  };
}

function resultsTitle(ws: Work[]): string {
  const subj = ws
    .map((w) => `${w.raw.attchmntText} ${w.raw.voiceSummary ?? ""}`)
    .join(" ");
  const q = /\bq([1-4])\b/i.exec(subj);
  const fy = /fy\s?'?(\d{2,4})(?:-(\d{2}))?/i.exec(subj);
  const period =
    /(?:quarter|half[- ]year|period)[^.]{0,30}?ended\s+([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}(?:st|nd|rd|th)? [A-Za-z]+,? \d{4}|\d{2}-\d{2}-\d{4})/i.exec(
      subj,
    );
  if (q && fy) return `Q${q[1]} FY${fy[1]?.slice(-2)} results filed`;
  if (period) return `Results for quarter ended ${period[1]} filed`;
  if (
    /september 30, 2026|30 september 2026|30th september,? 2026|sep(tember)?[- ]2026|30\.09\.2026|30-09-2026/i.test(
      subj,
    )
  )
    return "Q2 FY27 results filed";
  return "Quarterly results filed";
}

function buildCardPayload(
  p: Work,
  ws: Work[],
  ol: OneLinerResult | undefined,
  bio: BioPayload | null,
  tier: Tier,
  priority: number,
  _company: Company | undefined,
): CardPayload {
  const real = ws
    .filter((w) => !w.isRepost)
    .sort((a, b) => a.filedAt - b.filedAt);
  const sources: CardSource[] = [];
  const seenUrl = new Set<string>();
  for (const w of real) {
    const url = w.raw.attchmntFile;
    if (url && !seenUrl.has(url)) {
      seenUrl.add(url);
      sources.push({
        url,
        kind: sourceKindFor(w.cls, url),
        label: sourceLabelFor(w.cls, w.raw.desc),
        announcementId: w.id,
        filedAtMs: w.filedAt,
      });
    }
    if (w.raw.voiceUrl && !seenUrl.has(w.raw.voiceUrl)) {
      seenUrl.add(w.raw.voiceUrl);
      sources.push({
        url: w.raw.voiceUrl,
        kind: "voice",
        label: "NSE audio summary",
        announcementId: w.id,
        filedAtMs: w.filedAt,
      });
    }
  }
  const tags = [...new Set(ws.map((w) => w.raw.desc).filter(Boolean))];
  const inp = {
    category: p.cls.category,
    desc: p.raw.desc,
    subject: p.raw.attchmntText,
    voiceSummary: p.raw.voiceSummary,
    companyName: p.raw.sm_name,
  };
  let title = ol?.title ?? fallbackTitle(inp);
  let oneLiner = ol?.oneLiner ?? fallbackOneLiner(inp);
  if (p.cls.category === "results") {
    title = resultsTitle(real);
    const follow = real
      .filter((w) => w.id !== p.id)
      .map((w) => sourceLabelFor(w.cls, w.raw.desc).toLowerCase());
    const base = p.raw.voiceSummary
      ? firstSentence(p.raw.voiceSummary)
      : `${p.raw.sm_name} filed its quarterly results on ${formatIst(p.filedAt, "dd MMM")}.`;
    oneLiner = follow.length
      ? `${base} Also filed: ${[...new Set(follow)].join(", ")}.`
      : base;
  }
  if (
    bio &&
    p.cls.category === "management_change" &&
    bio.confidence !== "low" &&
    !ol
  ) {
    oneLiner = `${bio.name} — ${bio.role}${bio.effectiveDate ? ` (effective ${bio.effectiveDate})` : ""}.`;
  }
  const voiceSummary =
    real.find((w) => w.raw.voiceSummary)?.raw.voiceSummary ?? null;
  return {
    version: 1,
    title,
    oneLiner,
    category: p.cls.category,
    subcategory: p.cls.subcategory,
    tier,
    priority,
    fields: ol?.fields ?? null,
    bio,
    extraction: ol
      ? {
          by: ol.source,
          model: ol.model,
          grounded: ol.grounded,
          dropped: ol.dropped,
        }
      : { by: "none", grounded: true, dropped: [] },
    primaryAnnouncementId: p.id,
    sources,
    tags,
    voiceSummary,
    cue: p.llmReason ? `llm:${p.llmReason}` : p.cue,
  };
}

// ---------------------------------------------------------------------------
// Fetch + ingest for the portfolio
// ---------------------------------------------------------------------------

export interface FetchIngestOptions extends IngestAnnouncementsOptions {
  /** look-back window in days (default 30) */
  days?: number;
  /** restrict to these symbols (default: every company in the DB) */
  symbols?: string[];
  /** reference "now" (ms); default Date.now() */
  now?: number;
  /** fetch only, do not ingest (returns the raw rows) */
  fetchOnly?: boolean;
}

export interface FetchIngestResult {
  raw: AnnouncementRaw[];
  perSymbol: Record<string, number>;
  fetchErrors: string[];
  fetchMs: number;
  ingest: AnnouncementsIngestResult | null;
}

/** Per-symbol windows (≤ 2 req/s via the shared pacer) → one ingest pass. */
export async function fetchAndIngestAnnouncements(
  o: FetchIngestOptions = {},
): Promise<FetchIngestResult> {
  const now = o.now ?? Date.now();
  const days = o.days ?? 30;
  const toKey = istDateKey(now);
  const fromKey = addDaysKey(toKey, -days);
  const all = await listCompanies();
  const wanted = o.symbols?.length
    ? new Set(o.symbols.map((s) => s.toUpperCase()))
    : null;
  const targets = all.filter(
    (c) =>
      !wanted ||
      wanted.has(c.nseSymbol.toUpperCase()) ||
      c.aliases.some((a) => wanted.has(a.toUpperCase())),
  );
  if (wanted) {
    for (const s of wanted) {
      if (
        !targets.some(
          (c) =>
            c.nseSymbol.toUpperCase() === s ||
            c.aliases.map((a) => a.toUpperCase()).includes(s),
        )
      ) {
        log.warn(
          { symbol: s },
          "symbol not in companies table — run ingest:companies --adhoc first; fetching anyway",
        );
      }
    }
  }
  const symbols = wanted
    ? [...new Set([...targets.map((c) => c.nseSymbol), ...wanted])]
    : targets.map((c) => c.nseSymbol);
  const t0 = Date.now();
  const raw: AnnouncementRaw[] = [];
  const perSymbol: Record<string, number> = {};
  const fetchErrors: string[] = [];
  for (const sym of symbols) {
    try {
      const rows = await fetchAnnouncements({ from: fromKey, to: toKey }, sym);
      perSymbol[sym] = rows.length;
      raw.push(...rows);
    } catch (e) {
      fetchErrors.push(`${sym}: ${e instanceof Error ? e.message : String(e)}`);
      log.warn(
        { symbol: sym, err: e instanceof Error ? e.message : String(e) },
        "announcements fetch failed",
      );
    }
  }
  const fetchMs = Date.now() - t0;
  log.info(
    {
      symbols: symbols.length,
      rows: raw.length,
      from: fromKey,
      to: toKey,
      ms: fetchMs,
      errors: fetchErrors.length,
    },
    "announcements fetched for portfolio",
  );
  if (o.fetchOnly)
    return { raw, perSymbol, fetchErrors, fetchMs, ingest: null };
  const ingest = await ingestAnnouncements(raw, o);
  return { raw, perSymbol, fetchErrors, fetchMs, ingest };
}

/** Re-attach follow-ups check helper exported for tests. */
export { isResultsFollowUp };
export type { GroupedEvent };
