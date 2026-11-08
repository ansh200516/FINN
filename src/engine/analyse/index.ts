/**
 * engine/analyse — deterministic analysis (contracts).
 */
import type {
  AnnouncementRaw,
  Classification,
  LedgerRow,
  PriceBar,
  ResultsBasis,
  ResultsCard,
  ResultsQuarter,
  Tier,
  Tripwire,
  TripwireHit,
  Verdict,
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

/** Pure: adjudicate one open promise against delivered numbers. */
export function adjudicate(
  _row: LedgerRow,
  _delivered: {
    value: number | null;
    unit: string | null;
    source: string | null;
  },
): Verdict {
  throw new Error("not implemented: analyse.adjudicate");
}

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
