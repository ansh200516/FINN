/**
 * engine/ingest — raw → DB (contracts).
 */

export interface IngestSummary {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// Builder A implementations: announcements.ts, classify.ts, dedupe.ts, prices.ts, companies.ts
// (detectAnomalies lives in analyse/anomalies.ts and is re-exported here for the contract)
export { detectAnomalies } from "../analyse/anomalies";
export {
  type AnnouncementsIngestResult,
  type BioPayload,
  type CardPayload,
  type CardSource,
  cardTypeFor,
  type FetchIngestOptions,
  type FetchIngestResult,
  fetchAndIngestAnnouncements,
  headlineAmount,
  type IngestAnnouncementsOptions,
  ingestAnnouncements,
  type SourceKind,
} from "./announcements";
export {
  type ClassifiedItem,
  type ClassifyBatchOptions,
  type ClassifyContext,
  classify,
  classifyBatch,
  classifyRules,
  llmResidueClassifier,
  RESIDUE_THRESHOLD,
  type ResidueClassifier,
  type ResidueItem,
  type ResidueResult,
  type RuleClassification,
  toClassification,
} from "./classify";
export {
  type CompanyInput,
  companyFormat,
  companyIndex,
  companyMcapInr,
  DEFAULT_ADHOC_SYMBOLS,
  DEFAULT_PORTFOLIO_SYMBOLS,
  type IngestCompaniesOptions,
  type IngestCompaniesResult,
  ingestCompanies,
  listCompanies,
  loadPortfolioSeed,
  reconcileWithMaster,
  upsertCompanies,
} from "./companies";
export {
  EVENT_WINDOW_MS,
  type ExistingEvent,
  eventKeyAt,
  eventKeyFor,
  filedAtMs,
  findExactReposts,
  type GroupedEvent,
  type GroupInput,
  groupIntoEvents,
  isResultsFollowUp,
  normaliseSubject,
  RESULTS_FOLLOWUP_WINDOW_MS,
} from "./dedupe";
// Builder C implementation (documents: discover → download → page text): documents.ts
export {
  type DiscoveryOptions,
  type DiscoveryResult,
  DOCS_CACHE_DIR,
  dedupeDocuments,
  discoverDocuments,
  docIdForSha,
  type IngestDocumentsOptions,
  type IngestDocumentsResult,
  type IngestedDocument,
  ingestDocuments,
  ingestOneDocument,
  listDocuments,
  loadDocumentText,
  loadPageText,
  recentQuarterLabels,
} from "./documents";
// Builder B implementations (quarterly results): results.ts, parse-xbrl.ts
export {
  detectVariant,
  durationPeriods,
  type FiscalQuarter,
  fiscalQuarter,
  IDENTITY_TOLERANCE,
  type ParsedXbrlQuarter,
  type PeriodSelection,
  parseXbrlInstance,
  quarterFromXbrl,
  type ResultsVariant,
  selectPeriods,
  shiftQuarterEnd,
  withinTolerance,
  type XbrlContext,
  type XbrlFact,
  type XbrlInstance,
  XbrlParseError,
  type XbrlPeriod,
  type XbrlQuarterContext,
  xbrlIsin,
} from "./parse-xbrl";
export {
  bhavRowsToBars,
  type IngestRangeResult,
  ingestPriceRange,
  ingestPrices,
  loadBars,
  loadBarsMany,
  sessionTypeFor,
  upsertBars,
} from "./prices";
export {
  type IngestResultsOptions,
  type IngestResultsReport,
  ingestResults,
  loadResultsQuarters,
  parseXbrlResults,
  quarterToRow,
  rowToQuarter,
  type UpsertOutcome,
  upsertResultsQuarter,
} from "./results";
