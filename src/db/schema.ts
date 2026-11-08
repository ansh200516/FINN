/**
 * FINN data model — Drizzle, SQLite dialect (libSQL locally and on Turso).
 *
 * Conventions
 * - ids are text (ULID/UUID or source-derived like `nse:<seq_id>`)
 * - `*_at` columns are integer epoch **milliseconds UTC**
 * - `*_ist` columns are human-readable IST strings exactly as the source
 *   stamped them (e.g. NSE `an_dt` "08-Nov-2026 17:32:09")
 * - `*_json` columns are JSON serialised as text; parse with `src/db/json.ts`
 * - money is stored in **absolute rupees** as REAL (XBRL is in INR, not crore);
 *   divide by 1e7 at the presentation layer
 *
 * See docs/research/20-synthesis-and-decision.md §3 for the model and
 * CONTRIBUTING-AGENTS.md for ownership. Schema changes: edit here, then
 * `pnpm db:generate && pnpm db:migrate`.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const companies = sqliteTable(
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
    inPortfolio: integer("in_portfolio", { mode: "boolean" })
      .notNull()
      .default(false),
    isAdhoc: integer("is_adhoc", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at").notNull().default(nowMs),
  },
  (t) => [uniqueIndex("companies_nse_symbol_uq").on(t.nseSymbol)],
);

// ---------------------------------------------------------------------------
// Prices (EOD bars from NSE UDiFF bhavcopy; Upstox/yfinance as fallbacks)
// ---------------------------------------------------------------------------

export const prices = sqliteTable(
  "prices",
  {
    isin: text("isin").notNull(),
    /** trade date as IST calendar day, 'YYYY-MM-DD' */
    date: text("date").notNull(),
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close"),
    prevClose: real("prev_close"),
    volume: integer("volume"),
    /** traded value in rupees */
    turnover: real("turnover"),
    trades: integer("trades"),
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

export const announcements = sqliteTable(
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
    attachmentSize: integer("attachment_size"),
    hasXbrl: integer("has_xbrl", { mode: "boolean" }).notNull().default(false),
    /** epoch ms UTC derived from an_dt (IST) */
    filedAt: integer("filed_at").notNull(),
    /** NSE an_dt verbatim, e.g. "08-Nov-2026 17:32:09" */
    filedAtIst: text("filed_at_ist").notNull(),
    /** Category — see src/engine/types.ts */
    category: text("category").notNull().default("unclassified"),
    subcategory: text("subcategory"),
    /** 'rule' | 'llm' | 'bse' | null */
    classifiedBy: text("classified_by"),
    /** 0..100 priority score; higher = louder */
    priority: integer("priority").notNull().default(0),
    /** 1 = card, 2 = one-liner, 3 = filed away */
    tier: integer("tier").notNull().default(3),
    /** dedupe key shared with events.event_key */
    eventKey: text("event_key"),
    voiceSummary: text("voice_summary"),
    voiceUrl: text("voice_url"),
    /** the raw source record (AnnouncementRaw) */
    rawJson: text("raw_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    index("announcements_isin_filed_at_idx").on(t.isin, t.filedAt),
    index("announcements_filed_at_idx").on(t.filedAt),
    index("announcements_event_key_idx").on(t.eventKey),
  ],
);

export const events = sqliteTable(
  "events",
  {
    eventKey: text("event_key").primaryKey(),
    isin: text("isin").notNull(),
    category: text("category").notNull(),
    firstAt: integer("first_at").notNull(),
    lastAt: integer("last_at").notNull(),
    tier: integer("tier").notNull().default(3),
    /** CardType — see src/engine/types.ts */
    cardType: text("card_type").notNull().default("routine"),
    /** the rendered card payload (shape depends on card_type; zod in src/db/json.ts) */
    cardJson: text("card_json").notNull().default("{}"),
    /** JSON string[] of announcements.id that fold into this event */
    announcementIdsJson: text("announcement_ids_json").notNull().default("[]"),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    index("events_isin_last_at_idx").on(t.isin, t.lastAt),
    index("events_last_at_idx").on(t.lastAt),
  ],
);

// ---------------------------------------------------------------------------
// Results (from NSE Integrated-Filing XBRL; legacy API; PDF fallback)
// ---------------------------------------------------------------------------

export const resultsQuarters = sqliteTable(
  "results_quarters",
  {
    isin: text("isin").notNull(),
    /** quarter end 'YYYY-MM-DD' */
    periodEnd: text("period_end").notNull(),
    /** 'consolidated' | 'standalone' */
    basis: text("basis").notNull(),
    /** 'xbrl' | 'legacy' | 'pdf' */
    source: text("source").notNull(),
    audited: integer("audited", { mode: "boolean" }),
    /** all money in absolute rupees (INR) */
    revenue: real("revenue"),
    otherIncome: real("other_income"),
    financeCosts: real("finance_costs"),
    /** depreciation & amortisation */
    dna: real("dna"),
    /** profit before exceptional items and tax */
    pbeit: real("pbeit"),
    exceptional: real("exceptional"),
    pbt: real("pbt"),
    tax: real("tax"),
    pat: real("pat"),
    /** PAT from continuing operations */
    patCont: real("pat_cont"),
    /** basic EPS, rupees */
    eps: real("eps"),
    /** bank/NBFC extras and identity checks: { nii, ppop, identities: {...}, warnings: [] } */
    checksJson: text("checks_json").notNull().default("{}"),
    sourceUrl: text("source_url"),
    filedAt: integer("filed_at"),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    primaryKey({ columns: [t.isin, t.periodEnd, t.basis] }),
    index("results_isin_period_idx").on(t.isin, t.periodEnd),
  ],
);

// ---------------------------------------------------------------------------
// Documents, guidance (promise ledger), facts, research sections
// ---------------------------------------------------------------------------

export const documents = sqliteTable(
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
    pages: integer("pages"),
    /** where the extracted text lives (data/cache path or inline key) */
    textRef: text("text_ref"),
    announcementId: text("announcement_id"),
    fetchedAt: integer("fetched_at"),
    /** 'pending' | 'ok' | 'failed' */
    textStatus: text("text_status").notNull().default("pending"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    uniqueIndex("documents_url_uq").on(t.url),
    index("documents_isin_kind_idx").on(t.isin, t.kind),
  ],
);

export const guidance = sqliteTable(
  "guidance",
  {
    id: text("id").primaryKey(),
    isin: text("isin").notNull(),
    docId: text("doc_id").notNull(),
    speaker: text("speaker"),
    role: text("role"),
    page: integer("page"),
    /** verbatim quote — must pass verifyQuote() against the document text */
    quote: text("quote").notNull(),
    metric: text("metric").notNull(),
    /** 'up' | 'down' | 'flat' | 'range' | 'absolute' | 'qualitative' */
    direction: text("direction"),
    low: real("low"),
    high: real("high"),
    unit: text("unit"),
    /** 'Q3FY27' | 'FY27' | 'H2FY27' | 'medium_term' … */
    horizon: text("horizon"),
    /** 'open' | 'settled' | 'superseded' | 'withdrawn' */
    status: text("status").notNull().default("open"),
    settledByQuarter: text("settled_by_quarter"),
    /** Verdict — see src/engine/types.ts */
    verdict: text("verdict"),
    evidenceJson: text("evidence_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    index("guidance_isin_status_idx").on(t.isin, t.status),
    index("guidance_doc_idx").on(t.docId),
  ],
);

export const facts = sqliteTable(
  "facts",
  {
    id: text("id").primaryKey(),
    isin: text("isin").notNull(),
    docId: text("doc_id"),
    page: integer("page"),
    /** 'number' | 'quote' | 'table_cell' | 'xbrl' */
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    valueJson: text("value_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [
    index("facts_isin_idx").on(t.isin),
    index("facts_doc_idx").on(t.docId),
  ],
);

export const researchSections = sqliteTable(
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
    generatedAt: integer("generated_at").notNull().default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.isin, t.section] })],
);

// ---------------------------------------------------------------------------
// Users, tripwires, alerts
// ---------------------------------------------------------------------------

export const users = sqliteTable("users", {
  /** device/anonymous id (no auth in v1) */
  id: text("id").primaryKey(),
  portfolioIsinsJson: text("portfolio_isins_json").notNull().default("[]"),
  prefsJson: text("prefs_json").notNull().default("{}"),
  /** JSON PushSubscription[] */
  pushSubscriptionsJson: text("push_subscriptions_json")
    .notNull()
    .default("[]"),
  telegramChatId: text("telegram_chat_id"),
  createdAt: integer("created_at").notNull().default(nowMs),
  lastSeenAt: integer("last_seen_at"),
});

export const tripwires = sqliteTable(
  "tripwires",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** optional scope to one company; null = whole portfolio */
    isin: text("isin"),
    /** Tripwire rule — see src/engine/types.ts */
    ruleJson: text("rule_json").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [index("tripwires_user_idx").on(t.userId)],
);

export const alerts = sqliteTable(
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
    firedAt: integer("fired_at").notNull().default(nowMs),
    /** JSON { webpush?: 'sent'|'failed:410', telegram?: 'sent'|..., inbox: 'sent' } */
    deliveredViaJson: text("delivered_via_json").notNull().default("{}"),
    readAt: integer("read_at"),
  },
  (t) => [
    index("alerts_user_fired_idx").on(t.userId, t.firedAt),
    index("alerts_event_key_idx").on(t.eventKey),
  ],
);

// ---------------------------------------------------------------------------
// LLM ledger + cache, jobs
// ---------------------------------------------------------------------------

export const llmLedger = sqliteTable(
  "llm_ledger",
  {
    model: text("model").notNull(),
    /** calendar day in America/Los_Angeles (quota reset = midnight Pacific) */
    datePt: text("date_pt").notNull(),
    requests: integer("requests").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensThought: integer("tokens_thought").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.model, t.datePt] })],
);

export const llmCache = sqliteTable(
  "llm_cache",
  {
    /** sha256(task | prompt_version | input) */
    key: text("key").primaryKey(),
    task: text("task").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    responseJson: text("response_json").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (t) => [index("llm_cache_task_idx").on(t.task)],
);

export const jobs = sqliteTable(
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
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (t) => [
    index("jobs_kind_state_idx").on(t.kind, t.state),
    index("jobs_isin_idx").on(t.isin),
  ],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type PriceRow = typeof prices.$inferSelect;
export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncementRow = typeof announcements.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type ResultsQuarterRow = typeof resultsQuarters.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type GuidanceRow = typeof guidance.$inferSelect;
export type FactRow = typeof facts.$inferSelect;
export type ResearchSectionRow = typeof researchSections.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type TripwireRow = typeof tripwires.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type LlmLedgerRow = typeof llmLedger.$inferSelect;
export type LlmCacheRow = typeof llmCache.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;

export * from "./schema-docs"; // document_pages + document_meta (Builder C)
