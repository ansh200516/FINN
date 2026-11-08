/**
 * View models for the Brief and card surfaces.
 *
 * These mirror the types Builder A will export from
 * `src/engine/analyse/brief.ts`; keep them identical and switch the import
 * when that file lands. Engine-wide types (ResultsCard, LedgerRow, Verdict,
 * Anomaly, Tripwire …) come from `src/engine/types.ts` directly.
 */
import type {
  Anomaly,
  Category,
  LedgerRow,
  ResultsCard,
  Tier,
} from "@/engine/types";

export type { Anomaly, Category, LedgerRow, ResultsCard, Tier };

export interface SourceRef {
  url: string;
  /** 'filing' | 'xbrl' | 'pdf' | 'transcript' | 'presentation' | 'press_release' | 'annual_report' | 'other' */
  kind: string;
  /** chip text, e.g. "Results PDF p.10", "XBRL", "Reg 30 filing" */
  label: string;
}

export interface EventCard {
  eventKey: string;
  isin: string;
  symbol: string;
  companyName: string;
  category: Category;
  tier: Tier;
  /** 0..100 */
  priority: number;
  /** ≤ 10 words, muscle word first */
  title: string;
  oneLiner: string;
  filedAtMs: number;
  /** NSE an_dt verbatim, e.g. "06-Nov-2026 17:20:57" */
  filedAtIst: string;
  sources: SourceRef[];
  /**
   * Category-specific payload:
   *   results           → ResultsCard
   *   management_change → ManagementChangeCard
   *   others            → Record<string, unknown> rendered as label/value rows
   */
  card: unknown;
  /** number of follow-up filings folded into this event (re-posts, decks, record dates …) */
  followUps: number;
  voiceSummary?: string;
}

export interface ManagementChangeCard {
  person: string;
  role: string;
  /** 'appointed' | 'resigned' | 'retired' | 'ceased' | 're-appointed' | 'redesignated' */
  action: string;
  effective_date: string | null;
  reason: string | null;
  /** verbatim from the filing's SEBI-mandated brief profile (Schedule III para A.7.3) */
  brief_profile_excerpt: string | null;
  prior_roles: string[];
  /** 'high' = filing profile ≥150 chars; 'medium' = corroborated press only; 'low' = filing only, no profile */
  confidence: "high" | "medium" | "low";
  /** optional extras some filings carry */
  term?: string | null;
  successor?: string | null;
  others?: Array<{ person: string; role: string; action: string }>;
}

/** Generic field payload for dividend / credit_rating / m_and_a / fund_raise / pledging / insider_trading / capex / litigation. */
export interface FieldCard {
  [field: string]: unknown;
  /** fields in this list are shown with a "verbatim" badge (copied from the filing) */
  verbatim?: string[];
}

export interface Tier3Group {
  category: Category;
  count: number;
  items: EventCard[];
}

export interface UpcomingItem {
  isin: string;
  symbol: string;
  what: string;
  /** "Wed 12 Nov" */
  dateIst: string;
  /** 'YYYY-MM-DD' for sorting */
  dateKey: string;
}

export type WindowPreset = "24h" | "48h" | "7d" | "30d" | "custom" | "close";

export interface BriefWindow {
  fromMs: number;
  toMs: number;
  /** "Last 24 h" / "Since Fri close" / "1–8 Nov" */
  label: string;
  preset: WindowPreset;
  /** set when the default window was auto-widened, e.g. "Quiet weekend — showing since Friday's close" */
  widened?: string;
}

export interface BriefCounts {
  filings: number;
  events: number;
  needsYou: number;
  filedAway: number;
}

export interface BriefModel {
  window: BriefWindow;
  counts: BriefCounts;
  tier1: EventCard[];
  tier2: EventCard[];
  tier3: Tier3Group[];
  anomalies: Anomaly[];
  upcoming?: UpcomingItem[];
  quiet?: { reason: string };
  /** when the data was last checked, ms UTC (max announcements.created_at) */
  checkedAtMs: number | null;
  /** companies in scope */
  companiesChecked: number;
}

/** What `queries.getBrief` returns: the contract model with anomalies enriched for display. */
export interface BriefView extends Omit<BriefModel, "anomalies"> {
  anomalies: AnomalyWithSymbol[];
}

/** Result of `queries.getEventDetail` — the card plus what the detail page needs around it. */
export interface EventDetail {
  card: EventCard;
  /** every filing folded into the event, oldest first */
  filings: Array<{
    id: string;
    desc: string;
    subject: string;
    filedAtMs: number;
    filedAtIst: string;
    attachmentUrl: string | null;
    attachmentSize: number | null;
    hasXbrl: boolean;
  }>;
  /** settlement line for results cards */
  settlement: SettlementLine | null;
}

export interface SettlementLine {
  /** "2 of 3 promises settled: growth kept, margin missed" */
  text: string;
  settled: number;
  open: number;
  verdicts: Array<{ metric: string; verdict: string }>;
}

export interface AnomalyWithSymbol extends Anomaly {
  symbol: string;
  companyName: string;
  close: number | null;
  pctMove: number | null;
  volumeRatio: number | null;
}

export interface QuarterRow {
  periodEnd: string;
  basis: "consolidated" | "standalone";
  source: "xbrl" | "legacy" | "pdf";
  audited: boolean | null;
  revenue: number | null;
  ebitda: number | null;
  pbt: number | null;
  pat: number | null;
  eps: number | null;
  exceptional: number | null;
  otherIncome: number | null;
  financeCosts: number | null;
  dna: number | null;
  nii: number | null;
  ppop: number | null;
  sourceUrl: string | null;
}

export interface Snapshot {
  periodEnd: string | null;
  basis: "consolidated" | "standalone" | null;
  revenue: number | null;
  ebitda: number | null;
  pat: number | null;
  revenueYoy: number | null;
  ebitdaYoy: number | null;
  patYoy: number | null;
  /** bank / NBFC extras when present */
  nii: number | null;
  ppop: number | null;
  isBank: boolean;
  checksum: "exchange_xbrl" | "preliminary" | null;
}

export interface PriceSeries {
  dates: string[];
  closes: Array<number | null>;
  volumes: Array<number | null>;
  sessionTypes: string[];
  lastClose: number | null;
  lastPct: number | null;
  lastDate: string | null;
}

export interface DocumentItem {
  id: string;
  kind: string;
  period: string | null;
  url: string;
  pages: number | null;
  fetchedAt: number | null;
  textStatus: string;
}

export interface CompanyPageModel {
  company: {
    isin: string;
    symbol: string;
    name: string;
    sector: string | null;
    industry: string | null;
    inPortfolio: boolean;
    isAdhoc: boolean;
    aliases: string[];
  };
  snapshot: Snapshot;
  prices: PriceSeries;
  ledger: LedgerRowView[];
  quarters: QuarterRow[];
  events: EventCard[];
  documents: DocumentItem[];
}

export interface LedgerRowView extends LedgerRow {
  docKind: string | null;
  docPeriod: string | null;
  docUrl: string | null;
  /** "26 Oct 2026" when the statement date is known; null → the UI shows the document instead */
  statedOnIst: string | null;
}

export interface CompanyIndexRow {
  isin: string;
  symbol: string;
  name: string;
  industry: string | null;
  inPortfolio: boolean;
  isAdhoc: boolean;
  lastClose: number | null;
  lastPct: number | null;
  spark: Array<number | null>;
  lastFilingMs: number | null;
  openPromises: number;
}

export interface TripwireView {
  id: string;
  kind: "volume_ratio" | "price_move" | "category" | "text";
  params: Record<string, unknown>;
  enabled: boolean;
  isin: string | null;
}

export interface BacktestGrid {
  /** sessions scanned (normal sessions only) */
  sessions: number;
  /** calendar days spanned */
  days: number;
  /** fires per threshold for volume ratios (key = ratio with one decimal, e.g. "2.0") */
  volume: Record<string, number>;
  /** fires per threshold for |move| % (key e.g. "5.0") */
  price: Record<string, number>;
  /** fires when either rule trips, keyed "ratio|pct" e.g. "2.00|5.0" */
  either: Record<string, number>;
  /** days on which either default rule fired, by symbol, for the default thresholds */
  topOffenders: Array<{ symbol: string; fires: number }>;
  /** per-date fires at default thresholds for the 30-bar strip */
  strip: Array<{ date: string; fires: number }>;
}

export interface InboxItem {
  id: string;
  kind: string;
  symbol: string | null;
  companyName: string | null;
  title: string;
  body: string | null;
  firedAtMs: number;
  deliveredVia: Record<string, string>;
  readAt: number | null;
  href: string | null;
  /** plain-language rule that fired, if any */
  because: string | null;
}

export interface StatusModel {
  dbOk: boolean;
  nowMs: number;
  datePt: string;
  models: Array<{
    model: string;
    tier: string;
    requests: number;
    cap: number;
    remaining: number;
    tokensIn: number;
    tokensOut: number;
    tokensThought: number;
    errors: number;
    /** paid-equivalent USD at the published list price */
    costUsd: number;
  }>;
  totals: {
    requests: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  cache: { entries: number; byTask: Array<{ task: string; n: number }> };
  freshness: Array<{
    table: string;
    rows: number;
    /** ms UTC of the newest row, or null */
    newestMs: number | null;
    /** what the timestamp means: "filed", "trade date", "updated" … */
    stamp: string;
    note?: string;
  }>;
  jobs: Array<{
    id: string;
    kind: string;
    isin: string | null;
    step: string;
    state: string;
    updatedAt: number;
  }>;
  fixtureRows: number;
}
