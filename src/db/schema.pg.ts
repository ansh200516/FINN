/**
 * FINN data model — Drizzle Postgres dialect (Supabase).
 *
 * SQLite twin: `schema.sqlite.ts`. `schema.ts` picks one from DATABASE_URL.
 * Edit both when columns change. Apply with `pnpm db:push:pg` (not the sqlite migrations).
 *
 * Mapping from SQLite:
 * - epoch-ms and other INTEGER columns are bigint (SQLite integers are 64-bit;
 *   Postgres integer is int4 and cannot hold epoch milliseconds)
 * - integer boolean mode (0/1) is boolean
 * - REAL money columns are double precision
 * - JSON stays text. Reads that used json_extract / json_each go through
 *   finn_json_text / finn_json_array, created by `pnpm db:load:pg`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const nowMs = sql`(floor(extract(epoch from clock_timestamp()) * 1000))::bigint`;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const companies = pgTable(
  "companies",
  {
    isin: text("isin").primaryKey(),
    nseSymbol: text("nse_symbol").notNull(),
    bseCode: text("bse_code"),
    name: text("name").notNull(),
    sector: text("sector"),
    industry: text("industry"),
    /** JSON string[] — old symbols, short names (TATAMOTORS→TMPV, ZOMATO→ETERNAL) */
    aliasesJson: text("aliases_json").notNull().default("[]"),
    screenerSlug: text("screener_slug"),
    inPortfolio: boolean("in_portfolio").notNull().default(false),
    isAdhoc: boolean("is_adhoc").notNull().default(false),
    addedAt: bigint("added_at", { mode: "number" }).notNull().default(nowMs),
  },
  (t) => [uniqueIndex("companies_nse_symbol_uq").on(t.nseSymbol)],
);

// ---------------------------------------------------------------------------
// Prices (EOD bars from NSE UDiFF bhavcopy; Upstox/yfinance as fallbacks)
// ---------------------------------------------------------------------------

export const prices = pgTable(
  "prices",
  {
    isin: text("isin").notNull(),
    /** trade date as IST calendar day, 'YYYY-MM-DD' */
    date: text("date").notNull(),
    open: doublePrecision("open"),
    high: doublePrecision("high"),
    low: doublePrecision("low"),
    close: doublePrecision("close"),
    prevClose: doublePrecision("prev_close"),
    volume: bigint("volume", { mode: "number" }),
    /** traded value in rupees */
    turnover: doublePrecision("turnover"),
    trades: bigint("trades", { mode: "number" }),
    /** 'normal' | 'special' (e.g. Muhurat) — special sessions are excluded from averages */
    sessionType: text("session_type").notNull().default("normal"),
    /** 'nse_bhav' | 'upstox' | 'yfinance' */
    source: text("source").notNull().default("nse_bhav"),
  },
  (t) => [
    primaryKey({ columns: [t.isin, t.date] }),
    index("prices_isin_date_idx").on(t.isin, t.date),
    index("prices_date_idx").on(t.date),
  ],
);

// ---------------------------------------------------------------------------
// Announcements (one row per exchange filing) and Events (deduped cards)
// ---------------------------------------------------------------------------

export const announcements = pgTable(
  "announcements",
  {
    /** `nse:<seq_id>` or `bse:<news_id>` */
    id: text("id").primaryKey(),
    isin: text("isin").notNull(),
    symbol: text("symbol").notNull(),
    /** 'NSE' | 'BSE' */
    exchange: text("exchange").notNull().default("NSE"),
    /** NSE `desc` — the exchange's own subject category */
    desc: text("desc").notNull().default(""),
    /** short subject / headline (NSE `attchmntText` first line or BSE headline) */
    subject: text("subject").notNull().default(""),
    /** full `attchmntText` paragraph */
    text: text("text").notNull().default(""),
    attachmentUrl: text("attachment_url"),
    attachmentSize: bigint("attachment_size", { mode: "number" }),
    hasXbrl: boolean("has_xbrl").notNull().default(false),
    /** epoch ms UTC derived from an_dt (IST) */
    filedAt: bigint("filed_at", { mode: "number" }).notNull(),
    /** NSE an_dt verbatim, e.g. "08-Nov-2026 17:32:09" */
    filedAtIst: text("filed_at_ist").notNull(),
    /** Category — see src/engine/types.ts */
    category: text("category").notNull().default("unclassified"),
    subcategory: text("subcategory"),
    /** 'rule' | 'llm' | 'bse' | null */
    classifiedBy: text("classified_by"),
    /** 0..100 priority score; higher = louder */
    priority: bigint("priority", { mode: "number" }).notNull().default(0),
    /** 1 = card, 2 = one-liner, 3 = filed away */
    tier: bigint("tier", { mode: "number" }).notNull().default(3),
    /** dedupe key shared with events.event_key */
    eventKey: text("event_key"),
    voiceSummary: text("voice_summary"),
    voiceUrl: text("voice_url"),
    /** the raw source record (AnnouncementRaw) */
    rawJson: text("raw_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("announcements_isin_filed_at_idx").on(t.isin, t.filedAt),
    index("announcements_filed_at_idx").on(t.filedAt),
    index("announcements_event_key_idx").on(t.eventKey),
  ],
);

export const events = pgTable(
  "events",
  {
    eventKey: text("event_key").primaryKey(),
    isin: text("isin").notNull(),
    category: text("category").notNull(),
    firstAt: bigint("first_at", { mode: "number" }).notNull(),
    lastAt: bigint("last_at", { mode: "number" }).notNull(),
    tier: bigint("tier", { mode: "number" }).notNull().default(3),
    /** CardType — see src/engine/types.ts */
    cardType: text("card_type").notNull().default("routine"),
    /** the rendered card payload (shape depends on card_type; zod in src/db/json.ts) */
    cardJson: text("card_json").notNull().default("{}"),
    /** JSON string[] of announcements.id that fold into this event */
    announcementIdsJson: text("announcement_ids_json").notNull().default("[]"),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("events_isin_last_at_idx").on(t.isin, t.lastAt),
    index("events_last_at_idx").on(t.lastAt),
  ],
);

// ---------------------------------------------------------------------------
// Results (from NSE Integrated-Filing XBRL; legacy API; PDF fallback)
// ---------------------------------------------------------------------------

export const resultsQuarters = pgTable(
  "results_quarters",
  {
    isin: text("isin").notNull(),
    /** quarter end 'YYYY-MM-DD' */
    periodEnd: text("period_end").notNull(),
    /** 'consolidated' | 'standalone' */
    basis: text("basis").notNull(),
    /** 'xbrl' | 'legacy' | 'pdf' */
    source: text("source").notNull(),
    audited: boolean("audited"),
    /** all money in absolute rupees (INR) */
    revenue: doublePrecision("revenue"),
    otherIncome: doublePrecision("other_income"),
    financeCosts: doublePrecision("finance_costs"),
    /** depreciation & amortisation */
    dna: doublePrecision("dna"),
    /** profit before exceptional items and tax */
    pbeit: doublePrecision("pbeit"),
    exceptional: doublePrecision("exceptional"),
    pbt: doublePrecision("pbt"),
    tax: doublePrecision("tax"),
    pat: doublePrecision("pat"),
    /** PAT from continuing operations */
    patCont: doublePrecision("pat_cont"),
    /** basic EPS, rupees */
    eps: doublePrecision("eps"),
    /** bank/NBFC extras and identity checks: { nii, ppop, identities: {...}, warnings: [] } */
    checksJson: text("checks_json").notNull().default("{}"),
    sourceUrl: text("source_url"),
    filedAt: bigint("filed_at", { mode: "number" }),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.isin, t.periodEnd, t.basis] }),
    index("results_isin_period_idx").on(t.isin, t.periodEnd),
  ],
);

// ---------------------------------------------------------------------------
// Documents, guidance (promise ledger), facts, research sections
// ---------------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    isin: text("isin").notNull(),
    /** 'transcript' | 'annual_report' | 'results_pdf' | 'presentation' | 'press_release' | 'other' */
    kind: text("kind").notNull(),
    /** period label: 'Q2FY27', 'FY26' … */
    period: text("period"),
    url: text("url").notNull(),
    sha256: text("sha256"),
    pages: bigint("pages", { mode: "number" }),
    /** where the extracted text lives (data/cache path or inline key) */
    textRef: text("text_ref"),
    announcementId: text("announcement_id"),
    fetchedAt: bigint("fetched_at", { mode: "number" }),
    /** 'pending' | 'ok' | 'failed' */
    textStatus: text("text_status").notNull().default("pending"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    uniqueIndex("documents_url_uq").on(t.url),
    index("documents_isin_kind_idx").on(t.isin, t.kind),
  ],
);

export const guidance = pgTable(
  "guidance",
  {
    id: text("id").primaryKey(),
    isin: text("isin").notNull(),
    docId: text("doc_id").notNull(),
    speaker: text("speaker"),
    role: text("role"),
    page: bigint("page", { mode: "number" }),
    /** verbatim quote — must pass verifyQuote() against the document text */
    quote: text("quote").notNull(),
    metric: text("metric").notNull(),
    /** 'up' | 'down' | 'flat' | 'range' | 'absolute' | 'qualitative' */
    direction: text("direction"),
    low: doublePrecision("low"),
    high: doublePrecision("high"),
    unit: text("unit"),
    /** 'Q3FY27' | 'FY27' | 'H2FY27' | 'medium_term' … */
    horizon: text("horizon"),
    /** 'open' | 'settled' | 'superseded' | 'withdrawn' */
    status: text("status").notNull().default("open"),
    settledByQuarter: text("settled_by_quarter"),
    /** Verdict — see src/engine/types.ts */
    verdict: text("verdict"),
    evidenceJson: text("evidence_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("guidance_isin_status_idx").on(t.isin, t.status),
    index("guidance_doc_idx").on(t.docId),
  ],
);

export const facts = pgTable(
  "facts",
  {
    id: text("id").primaryKey(),
    isin: text("isin").notNull(),
    docId: text("doc_id"),
    page: bigint("page", { mode: "number" }),
    /** 'number' | 'quote' | 'table_cell' | 'xbrl' */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    valueJson: text("value_json").notNull().default("{}"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("facts_isin_idx").on(t.isin),
    index("facts_doc_idx").on(t.docId),
  ],
);

export const researchSections = pgTable(
  "research_sections",
  {
    isin: text("isin").notNull(),
    /** 'snapshot' | 'trajectory' | 'balance_sheet' | 'cash_quality' | 'narrative_vs_numbers' | 'bull_bear' | 'guidance' */
    section: text("section").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    json: text("json").notNull().default("{}"),
    /** JSON string[] of facts.id cited */
    factIdsJson: text("fact_ids_json").notNull().default("[]"),
    generatedAt: bigint("generated_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.isin, t.section] })],
);

// ---------------------------------------------------------------------------
// Users, tripwires, alerts
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  /** device/anonymous id (no auth in v1) */
  id: text("id").primaryKey(),
  portfolioIsinsJson: text("portfolio_isins_json").notNull().default("[]"),
  prefsJson: text("prefs_json").notNull().default("{}"),
  /** JSON PushSubscription[] */
  pushSubscriptionsJson: text("push_subscriptions_json")
    .notNull()
    .default("[]"),
  telegramChatId: text("telegram_chat_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(nowMs),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }),
});

export const tripwires = pgTable(
  "tripwires",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** optional scope to one company; null = whole portfolio */
    isin: text("isin"),
    /** Tripwire rule — see src/engine/types.ts */
    ruleJson: text("rule_json").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [index("tripwires_user_idx").on(t.userId)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    isin: text("isin"),
    /** 'tripwire' | 'announcement' | 'anomaly' | 'digest' */
    kind: text("kind").notNull(),
    tripwireId: text("tripwire_id"),
    eventKey: text("event_key"),
    payloadJson: text("payload_json").notNull().default("{}"),
    firedAt: bigint("fired_at", { mode: "number" }).notNull().default(nowMs),
    /** JSON { webpush?: 'sent'|'failed:410', telegram?: 'sent'|..., inbox: 'sent' } */
    deliveredViaJson: text("delivered_via_json").notNull().default("{}"),
    readAt: bigint("read_at", { mode: "number" }),
  },
  (t) => [
    index("alerts_user_fired_idx").on(t.userId, t.firedAt),
    index("alerts_event_key_idx").on(t.eventKey),
  ],
);

// ---------------------------------------------------------------------------
// LLM ledger + cache, jobs
// ---------------------------------------------------------------------------

export const llmLedger = pgTable(
  "llm_ledger",
  {
    model: text("model").notNull(),
    /** calendar day in America/Los_Angeles (quota reset = midnight Pacific) */
    datePt: text("date_pt").notNull(),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    tokensThought: bigint("tokens_thought", { mode: "number" })
      .notNull()
      .default(0),
    errors: bigint("errors", { mode: "number" }).notNull().default(0),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.model, t.datePt] })],
);

export const llmCache = pgTable(
  "llm_cache",
  {
    /** sha256(task | prompt_version | input) */
    key: text("key").primaryKey(),
    task: text("task").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    responseJson: text("response_json").notNull(),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [index("llm_cache_task_idx").on(t.task)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    /** 'research' | 'announcements' | 'prices' | 'results' | 'documents' | 'digest' */
    kind: text("kind").notNull(),
    isin: text("isin"),
    /** JobStep — see src/engine/types.ts */
    step: text("step").notNull().default("queued"),
    /** 'queued' | 'running' | 'done' | 'failed' */
    state: text("state").notNull().default("queued"),
    /** JSON JobLogEntry[] — the "working receipt" */
    logJson: text("log_json").notNull().default("[]"),
    error: text("error"),
    createdAt: bigint("created_at", { mode: "number" })
      .notNull()
      .default(nowMs),
    updatedAt: bigint("updated_at", { mode: "number" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("jobs_kind_state_idx").on(t.kind, t.state),
    index("jobs_isin_idx").on(t.isin),
  ],
);

export const documentPages = pgTable(
  "document_pages",
  {
    /** documents.id */
    docId: text("doc_id").notNull(),
    /** 1-indexed PDF page (what a viewer's `#page=N` expects) */
    page: bigint("page", { mode: "number" }).notNull(),
    text: text("text").notNull().default(""),
    /** non-whitespace characters on the page (< 200 ⇒ low-text / scanned) */
    chars: bigint("chars", { mode: "number" }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.docId, t.page] }),
    index("document_pages_doc_idx").on(t.docId),
  ],
);

export const documentMeta = pgTable("document_meta", {
  /** documents.id */
  docId: text("doc_id").primaryKey(),
  /** 'nse' | 'bse' | 'screener' | 'ir' */
  source: text("source").notNull().default("nse"),
  /** exchange filing / publication time, ms UTC (null when unknown) */
  publishedAt: bigint("published_at", { mode: "number" }),
  /** human title from the source listing (announcement text, link label) */
  title: text("title"),
  /** 'ok' | 'mixed' | 'low' | 'scanned' */
  textQuality: text("text_quality").notNull().default("ok"),
  /** total non-whitespace characters across pages */
  chars: bigint("chars", { mode: "number" }).notNull().default(0),
  /** pages with < 200 characters */
  lowTextPages: bigint("low_text_pages", { mode: "number" })
    .notNull()
    .default(0),
  /** true when pages were 2-up spreads split at the midline */
  spreads: boolean("spreads").notNull().default(false),
  /** downloaded bytes */
  bytes: bigint("bytes", { mode: "number" }),
  /** transcript: parsed turn count; AR: mapped section count — JSON { turns, mgmtTurns, sections, callDate, ... } */
  structureJson: text("structure_json").notNull().default("{}"),
  /**
   * documents.id of the canonical copy when this row is a cross-source duplicate
   * (same sha256, or same isin+kind+period with near-identical text); the
   * duplicate's documents.text_status is 'duplicate'
   */
  duplicateOf: text("duplicate_of"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(nowMs),
});
