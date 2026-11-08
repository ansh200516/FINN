/**
 * engine/analyse — deterministic analysis (contracts).
 */
import type {
  AnnouncementRaw,
  Classification,
  PriceBar,
  ResultsBasis,
  ResultsCard,
  ResultsQuarter,
  Tier,
  Tripwire,
  TripwireHit,
} from "../types";

/** Pure: quarters (any order) → results card for a basis; null if fewer than 1 quarter. */
export function computeResultsCard(
  _quarters: ResultsQuarter[],
  _basis: ResultsBasis,
): ResultsCard | null {
  throw new Error("not implemented: analyse.computeResultsCard");
}

/** Pure: % change with null-safety and sign conventions (null if base is 0/null). */
export function pctChange(
  _now: number | null,
  _base: number | null,
): number | null {
  throw new Error("not implemented: analyse.pctChange");
}

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

/** Pure: materiality × weight × novelty → priority 0..100 and tier. */
export function computePriority(
  _raw: AnnouncementRaw,
  _cls: Omit<Classification, "priority" | "tier">,
  _ctx: { seenBefore: boolean },
): { priority: number; tier: Tier } {
  throw new Error("not implemented: analyse.computePriority");
}

/** Pure: evaluate a rule over recent bars / events for one company. */
export function evaluateTripwire(
  _rule: Tripwire & { id: string },
  _ctx: {
    isin: string;
    bars: PriceBar[];
    categoriesToday: string[];
    textsToday: string[];
    at: number;
  },
): TripwireHit | null {
  throw new Error("not implemented: analyse.evaluateTripwire");
}

/** Pure: how often a rule would have fired over the given bars. */
export function backtestTripwire(
  _rule: Tripwire,
  _bars: PriceBar[],
): { fires: number; days: number; sentence: string } {
  throw new Error("not implemented: analyse.backtestTripwire");
}
