/**
 * engine/ingest — raw → DB (contracts).
 */
import type {
  AnnouncementRaw,
  Anomaly,
  Classification,
  DocumentKind,
  PriceBar,
  ResultsQuarter,
} from "../types";

export interface IngestSummary {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Upsert raw announcements, classify, dedupe into events. */
export async function ingestAnnouncements(
  _raw: AnnouncementRaw[],
): Promise<IngestSummary> {
  throw new Error("not implemented: ingest.ingestAnnouncements");
}

/** Pure: rules + optional LLM residue. */
export async function classify(_raw: AnnouncementRaw): Promise<Classification> {
  throw new Error("not implemented: ingest.classify");
}

/** Pure: build the dedupe key (isin | category | normalised subject | date bucket). */
export function eventKeyFor(_raw: AnnouncementRaw, _category: string): string {
  throw new Error("not implemented: ingest.eventKeyFor");
}

/** Upsert EOD bars for the given IST date (fetches bhavcopy unless bars are supplied). */
export async function ingestPrices(
  _dateKey: string,
  _bars?: PriceBar[],
): Promise<IngestSummary> {
  throw new Error("not implemented: ingest.ingestPrices");
}

/** Pure: scan bars for volume/price anomalies (special sessions excluded from averages). */
export function detectAnomalies(
  _bars: PriceBar[],
  _opts: { volumeRatio: number; pricePct: number; lookbackDays: number },
): Anomaly[] {
  throw new Error("not implemented: ingest.detectAnomalies");
}

/** Fetch integrated-filing index + XBRL for a symbol and upsert results_quarters. */
export async function ingestResults(
  _isin: string,
  _symbol: string,
): Promise<IngestSummary> {
  throw new Error("not implemented: ingest.ingestResults");
}

/** Pure: parse one XBRL XML string into a ResultsQuarter (absolute INR). */
export function parseXbrlResults(
  _xml: string,
  _ctx: { isin: string; sourceUrl: string },
): ResultsQuarter {
  throw new Error("not implemented: ingest.parseXbrlResults");
}

/** Discover, download and text-extract documents for a company. */
export async function ingestDocuments(
  _isin: string,
  _kinds: DocumentKind[],
): Promise<IngestSummary> {
  throw new Error("not implemented: ingest.ingestDocuments");
}
