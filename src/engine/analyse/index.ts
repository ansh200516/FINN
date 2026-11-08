/**
 * engine/analyse — deterministic analysis (contracts).
 */
// Builder B implementation (quarterly results card): results.ts

// Builder A implementations: priority.ts, anomalies.ts, tripwires.ts, brief.ts
export {
  type AnomalyOptions,
  type BarMetrics,
  barMetrics,
  corporateActionDatesFrom,
  DEFAULT_ANOMALY_OPTIONS,
  detectAnomalies,
  volumeBaseline,
} from "./anomalies";
export {
  type BriefCounts,
  type BriefModel,
  type BriefQuery,
  type BriefThresholds,
  type BriefTier3Group,
  type BriefUpcoming,
  type BriefWindow,
  buildBrief,
  type EventCard,
  type EventCardSource,
  firstFutureDate,
  parseLooseDate,
  renderBriefText,
  windowLabel,
} from "./brief";
// Builder C implementation (promise ledger): ledger.ts
export {
  type AdjudicatedRow,
  type AdjudicateOptions,
  adjudicate,
  adjudicateAll,
  compareBand,
  compareDirection,
  computeDelivered,
  type Delivered,
  ebit,
  ebitdaOp,
  getLedger,
  type LedgerInput,
  loadLedgerInputs,
  type MetricFamily,
  metricFamily,
  operatingMarginBasisFor,
  type SettleResult,
  scopeOf,
  settleGuidance,
  summarise,
  TOLERANCE,
  type TranscriptMeta,
} from "./ledger";
export {
  amountBonus,
  computePriority,
  extractAmountsInr,
  type PriorityContext,
  TIER1_MIN,
  TIER2_MIN,
  tierFor,
} from "./priority";
export {
  type BuildResultsCardOptions,
  buildResultsCard,
  type CardVariant,
  computeResultsCard,
  ebitdaOf,
  pctChange,
  SECONDARY_IDENTITIES,
  selectBasis,
  toCrore,
  variantOf,
  ytdCheck,
} from "./results";
export {
  type BacktestResult,
  backtest,
  backtestTripwire,
  evaluateTripwire,
  evaluateTripwiresForWindow,
  type TripwireContext,
} from "./tripwires";
