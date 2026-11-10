/**
 * Shared engine types. These are the contracts between builder agents —
 * change them only with a note in CONTRIBUTING-AGENTS.md and a ping to the
 * other owners. DB row types live in src/db/schema.ts (`$inferSelect`).
 */

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export interface Company {
  isin: string;
  nseSymbol: string;
  bseCode?: string | null;
  name: string;
  sector?: string | null;
  industry?: string | null;
  /** old symbols / short names (TATAMOTORS→TMPV, ZOMATO→ETERNAL) */
  aliases: string[];
  screenerSlug?: string | null;
  inPortfolio: boolean;
  isAdhoc: boolean;
}

// ---------------------------------------------------------------------------
// Announcements — exactly as NSE returns them from
// GET /api/corporate-announcements?index=equities&from_date=..&to_date=..
// ---------------------------------------------------------------------------

export interface AnnouncementRaw {
  symbol: string;
  /** company name */
  sm_name: string;
  sm_isin: string;
  smIndustry: string | null;
  /** NSE's own subject category, e.g. "Acquisition", "Analysts/Institutional Investor Meet/Con. Call Updates" */
  desc: string;
  /** one-paragraph description */
  attchmntText: string;
  /** PDF URL (nsearchives.nseindia.com/corporate/...) */
  attchmntFile: string;
  /** e.g. "1.2 MB" */
  attFileSize: string | null;
  fileSize?: string | null;
  /** "Yes" | "No" */
  hasXbrl: string | null;
  /** "08-Nov-2026 17:32:09" (IST) */
  an_dt: string;
  /** "2026-11-08 17:32:09" (IST) */
  sort_date: string;
  /** exchange dissemination time "08-Nov-2026 17:32:09" */
  exchdisstime: string;
  /** "08-Nov-2026" */
  dt?: string;
  seq_id: string;
  orgid?: string | null;
  bflag?: string | null;
  csvName?: string | null;
  difference?: string | null;
  old_new?: string | null;
  /** 100–150 word NSE-generated summary (new since ~7 Nov 2026) */
  voiceSummary?: string | null;
  voiceUrl?: string | null;
}

/** The 17 reference-doc categories (docs/challenge/reference.txt) + unclassified. */
export const CATEGORIES = [
  "results",
  "m_and_a",
  "fund_raise",
  "management_change",
  "litigation",
  "insider_trading",
  "earnings_call",
  "investor_meetings",
  "credit_rating",
  "dividend",
  "bonus_split",
  "capex",
  "press_release",
  "postal_ballot",
  "agm_egm",
  "pledging",
  "unclassified",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** 1 = card (needs you), 2 = one-liner (worth knowing), 3 = filed away (routine) */
export type Tier = 1 | 2 | 3;

export interface Classification {
  category: Category;
  subcategory?: string;
  tier: Tier;
  /** 0..100 */
  priority: number;
  classifiedBy: "rule" | "llm" | "bse";
  /** dedupe key: isin|category|normalised subject|date bucket */
  eventKey: string;
}

export type CardType =
  | "results"
  | "management_change"
  | "oneliner"
  | "tripwire"
  | "anomaly"
  | "routine";

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ResultsBasis = "consolidated" | "standalone";
export type ResultsSource = "xbrl" | "legacy" | "pdf";

/** All money in absolute rupees (INR). Divide by 1e7 for crore at render time. */
export interface ResultsQuarter {
  isin: string;
  /** 'YYYY-MM-DD' */
  periodEnd: string;
  basis: ResultsBasis;
  source: ResultsSource;
  audited: boolean | null;
  revenue: number | null;
  otherIncome: number | null;
  financeCosts: number | null;
  dna: number | null;
  pbeit: number | null;
  exceptional: number | null;
  pbt: number | null;
  tax: number | null;
  pat: number | null;
  patCont: number | null;
  eps: number | null;
  /** bank/NBFC extras + identity checks */
  checks: {
    nii?: number;
    ppop?: number;
    identities?: Record<string, boolean>;
    warnings: string[];
    // --- additive (Builder B, results engine); all optional, money in rupees ---
    /** 'INDAS' | 'BANKING' | 'NBFC' | 'NONINDAS' (from the XBRL file name) */
    taxonomy?: string;
    variant?: "corporate" | "bank" | "nbfc";
    /** 'YYYY-MM-DD' start of the 3-month context */
    periodStart?: string;
    reportingQuarter?: string;
    levelOfRounding?: string;
    currency?: string;
    /** total income (revenue + other income; banks: interest earned + other income) */
    income?: number;
    /** total expenses (Ind AS) */
    expenses?: number;
    /** NBFC interest income / bank interest earned */
    interestIncome?: number;
    /** bank interest expended */
    interestExpended?: number;
    opex?: number;
    provisions?: number;
    /** NBFC impairment on financial instruments */
    impairment?: number;
    assocShare?: number;
    /** true when the filer presents associates/JV share above PBT */
    assocAbovePbt?: boolean;
    patOwners?: number;
    nci?: number;
    discontinued?: number;
    epsDiluted?: number;
    /** face value per share (₹) — EPS is not comparable across a change */
    faceValue?: number;
    gnpaPct?: number;
    nnpaPct?: number;
    /** PI-Industries pattern: owners-of-parent PAT tagged with total comprehensive income (ignored) */
    ownersTaggedAsTci?: boolean;
    /** HDFC-Bank pattern: minority interest tagged as a negative exceptional item above PBT */
    minorityAsExceptional?: boolean;
    pbtBeforeMinority?: number;
    /** fiscal year-to-date figures from the same filing (null for Q1 filings) */
    ytd?: {
      start: string;
      end: string;
      days: number;
      revenue: number | null;
      income: number | null;
      pbt: number | null;
      pat: number | null;
      nii: number | null;
      ppop: number | null;
    };
    /** preliminary PDF extraction provenance */
    pdf?: {
      confidence: number;
      unit: string;
      page: number;
      columns: string[];
      method: "text" | "llm";
    };
  };
  sourceUrl: string | null;
  filedAt: number | null;
}

/** One headline row of the results card. Money in ₹ crore (2 dp) — the card is render-ready. */
export interface ResultsHeadlineRow {
  metric:
    | "revenue"
    | "ebitda"
    | "pbt"
    | "pat"
    | "nii"
    | "ppop"
    | "total_income";
  /** "Revenue", "EBITDA", "NII", "PPOP", "PBT", "PAT", "Total income" */
  label: string;
  currentCr: number | null;
  prevQuarterCr: number | null;
  yoyQuarterCr: number | null;
  qoqDeltaCr: number | null;
  qoqPct: number | null;
  yoyDeltaCr: number | null;
  yoyPct: number | null;
  /** % of revenue (banks/NBFCs: % of total income); null for the top line */
  marginPct: number | null;
  prevMarginPct: number | null;
  yoyMarginPct: number | null;
}

export interface ResultsVerification {
  source: ResultsSource;
  identitiesPassed: boolean;
  /** Q1+Q2 (or Q1..Qn) vs the filing's own YTD within 0.5 %; undefined when not checkable */
  h1Check?: boolean;
  failedIdentities: string[];
  notes: string[];
}

export interface ResultsCard {
  isin: string;
  basis: ResultsBasis;
  /** 'exchange_xbrl' = verified against XBRL; 'preliminary' = from the filing PDF */
  checksum: "exchange_xbrl" | "preliminary";
  rows: Array<{
    metric: "revenue" | "ebitda" | "pbt" | "pat";
    /** rupees */
    value: number | null;
    qoqPct: number | null;
    yoyPct: number | null;
    /** last 5 quarters, oldest first, rupees */
    spark: Array<number | null>;
  }>;
  ebitdaFormula: "pbt+fin+dna-oi" | "pbt+fin+dna";
  sourceUrl: string | null;
  // --- additive (Builder B, results engine); all optional ---
  variant?: "corporate" | "bank" | "nbfc";
  /** 'YYYY-MM-DD' of the current quarter */
  periodEnd?: string;
  /** "Q2 FY27" */
  fiscalLabel?: string;
  prevPeriodEnd?: string | null;
  yoyPeriodEnd?: string | null;
  /** render-ready rows in ₹ crore: corporate = revenue/ebitda/pbt/pat; bank = nii/ppop/pbt/pat; nbfc = total_income/nii/ppop/pbt/pat */
  headline?: ResultsHeadlineRow[];
  ebitdaConvention?: "ex_other_income";
  /** the alternative convention (PBEIT + finance costs + D&A), ₹ crore */
  ebitdaInclOtherIncomeCr?: number | null;
  margins?: {
    ebitdaPct: number | null;
    patPct: number | null;
    pbtPct: number | null;
  };
  exceptional?: {
    currentCr: number | null;
    flagged: boolean;
    note: string | null;
  };
  /** "Consolidated · Unaudited · ₹ cr" */
  basisLabel?: string;
  /** why this basis was chosen (e.g. "standalone — no consolidated filing") */
  basisNote?: string | null;
  verification?: ResultsVerification;
  filedAtMs?: number | null;
  quartersAvailable?: number;
  epsCurrent?: number | null;
  epsYoy?: number | null;
  /** bank extras when reported (standalone filings) */
  gnpaPct?: number | null;
  nnpaPct?: number | null;
}

// ---------------------------------------------------------------------------
// Guidance / promise ledger
// ---------------------------------------------------------------------------

export type GuidanceDirection =
  | "up"
  | "down"
  | "flat"
  | "range"
  | "absolute"
  | "qualitative";
export type GuidanceStatus = "open" | "settled" | "superseded" | "withdrawn";

export interface GuidanceStatement {
  /** verbatim — must pass verifyQuote() against the document text */
  quote: string;
  speaker: string | null;
  role: string | null;
  page: number | null;
  /** e.g. 'revenue_growth', 'ebitda_margin', 'capex', 'net_debt' */
  metric: string;
  direction: GuidanceDirection;
  low: number | null;
  high: number | null;
  /** '%', 'bp', 'INR', 'INR_cr', 'x', 'qualitative' */
  unit: string | null;
  /** 'Q3FY27' | 'FY27' | 'H2FY27' | 'medium_term' | null */
  horizon: string | null;
  status: GuidanceStatus;
  /** last day of the horizon period, 'YYYY-MM-DD' (null for medium/long term) */
  horizonEnd?: string | null;
  /** true when the quote carries explicit numbers; false for adjectival bands ("high single digit") */
  isExplicit?: boolean;
  /** 0..1 extractor confidence */
  confidence?: number;
  /** how the speaker framed it relative to earlier guidance */
  revision?: "new" | "maintained" | "raised" | "cut" | "withdrawn";
  /** growth basis when the metric is a growth rate */
  comparison?: "yoy" | "qoq" | "absolute" | "cc";
}

export type Verdict =
  | "kept"
  | "beat"
  | "missed"
  | "cut"
  | "raised"
  | "withdrawn"
  | "not_addressed"
  | "unverifiable";

export interface LedgerRow extends GuidanceStatement {
  id: string;
  isin: string;
  docId: string;
  /** when the promise was made, ms UTC */
  statedAt: number;
  settledByQuarter: string | null;
  verdict: Verdict | null;
  /** what the exchange numbers actually showed */
  delivered: {
    value: number | null;
    unit: string | null;
    source: string | null;
  } | null;
  evidence: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tripwires / alerts
// ---------------------------------------------------------------------------

export type Tripwire =
  | { kind: "volume_ratio"; params: { ratio: number; lookbackDays: number } }
  | { kind: "price_move"; params: { pct: number } }
  | { kind: "category"; params: { categories: Category[] } }
  | { kind: "text"; params: { pattern: string; flags?: string } };

export type TripwireKind = Tripwire["kind"];

export interface TripwireHit {
  tripwireId: string;
  isin: string;
  kind: TripwireKind;
  /** human sentence, e.g. "Volume 2.4× the 20-day average" */
  summary: string;
  /** ms UTC */
  at: number;
  evidence: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type DocumentKind =
  | "transcript"
  | "annual_report"
  | "results_pdf"
  | "presentation"
  | "press_release"
  | "other";

export interface DocumentText {
  docId: string;
  /** 1-indexed pages */
  pages: Array<{ page: number; text: string }>;
}

export type DocumentSource = "nse" | "bse" | "screener" | "ir";

/** One document found by `discoverDocuments` before download (Builder C). */
export interface DiscoveredDocument {
  kind: DocumentKind;
  /** 'Q2FY27' | 'FY26' | null when the period could not be inferred */
  period: string | null;
  url: string;
  source: DocumentSource;
  /** filing / publication time, ms UTC (null when the source gives none) */
  publishedAtMs: number | null;
  /** listing text (announcement text, link label) */
  title: string | null;
  /** `nse:<seq_id>` when discovered from the NSE announcements feed */
  announcementId: string | null;
}

export type SpeakerRole = "management" | "analyst" | "moderator" | "unknown";
export type TranscriptSection = "opening" | "qa";

/** One speaker turn of a parsed concall transcript (Builder C). */
export interface TranscriptTurn {
  index: number;
  speaker: string | null;
  role: SpeakerRole;
  section: TranscriptSection;
  /** 1-indexed PDF page where the turn starts */
  page: number;
  text: string;
}

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

export const LLM_TASKS = [
  "classify_residue",
  "oneliner",
  "bio",
  "guidance_extract",
  "ar_section_label",
  "results_pdf_fallback",
  "ledger_adjudicate",
  "narrative_vs_numbers",
  "bull_bear",
  "ask",
  "finnie",
  "smoke",
] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

export type LlmTier = "bulk" | "reason";

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export type JobKind =
  | "research"
  | "announcements"
  | "prices"
  | "results"
  | "documents"
  | "digest";

export const JOB_STEPS = [
  "queued",
  "resolve_company",
  "fetch_announcements",
  "fetch_prices",
  "fetch_results",
  "discover_documents",
  "fetch_documents",
  "extract_guidance",
  "adjudicate_ledger",
  "build_sections",
  "done",
] as const;
export type JobStep = (typeof JOB_STEPS)[number];

export type JobState = "queued" | "running" | "done" | "failed";

export interface JobLogEntry {
  at: number;
  step: JobStep | string;
  msg: string;
  level?: "info" | "warn" | "error";
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export type SessionType = "normal" | "special";

export interface PriceBar {
  isin: string;
  /** 'YYYY-MM-DD' IST */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  prevClose: number | null;
  volume: number | null;
  turnover: number | null;
  trades: number | null;
  sessionType: SessionType;
}

export interface Anomaly {
  isin: string;
  date: string;
  kind: "volume_ratio" | "price_move";
  value: number;
  threshold: number;
  summary: string;
}
