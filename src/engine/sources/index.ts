/**
 * engine/sources — raw fetchers (contracts). Implementations live in sibling
 * files (nse.ts, bhavcopy.ts, …) and are re-exported from here.
 */

export interface DateRange {
  /** 'DD-MM-YYYY' as NSE expects, or 'YYYY-MM-DD' — implementers normalise */
  from: string;
  to: string;
}

export interface IntegratedFilingRow {
  symbol: string;
  cmName: string;
  /** "30-SEP-2026" */
  qe_Date: string;
  consolidated: "Consolidated" | "Standalone" | null;
  audited: string | null;
  broadcast_Date: string;
  type: string;
  type_Sub: string | null;
  xbrl: string | null;
  ixbrl: string | null;
  pdf_attach: string | null;
  seq_Id: string;
  revised_Date: string | null;
  revision_Remark: string | null;
}

export interface BhavcopyRow {
  TradDt: string;
  TckrSymb: string;
  SctySrs: string;
  ISIN: string;
  OpnPric: number;
  HghPric: number;
  LwPric: number;
  ClsPric: number;
  LastPric: number;
  PrvsClsgPric: number;
  TtlTradgVol: number;
  TtlTrfVal: number;
  TtlNbOfTxsExctd: number;
}

export interface EquityMasterRow {
  symbol: string;
  name: string;
  isin: string;
  series: string;
  listingDate: string;
}

// Builder A implementations (nse-announcements.ts, nse-master.ts, bhavcopy.ts, upstox.ts)
export {
  BhavcopyNotAvailable,
  bhavcopyUrl,
  EQUITY_SERIES,
  fetchBhavcopy,
  parseBhavcopyCsv,
  parseBhavcopyZip,
  readZipEntries,
  type ZipEntry,
} from "./bhavcopy";
// Builder B implementations (quarterly results): nse-results.ts, bse-results.ts
export {
  type BseComparison,
  type BseResultRow,
  bseQuarterId,
  compareWithBse,
  fetchBseConsolidatedResult,
} from "./bse-results";
export {
  ATTACHMENT_MAX_BYTES,
  announcementsUrl,
  BodyTooLargeError,
  BROWSER_UA,
  bytesToText,
  type FetchAnnouncementsOptions,
  fetchAnnouncementHistory,
  fetchAnnouncements,
  fetchAttachment,
  HttpError,
  type HttpGetOptions,
  type HttpResponse,
  httpGet,
  NSE_API_HEADERS,
  normaliseAnnouncement,
  parseAnnouncementsBody,
  parseFileSize,
  toNseApiDate,
} from "./nse-announcements";
export {
  EQUITY_MASTER_URL,
  type FetchMasterOptions,
  fetchEquityMaster,
  indexMaster,
  type MasterIndex,
  parseEquityMasterCsv,
  resolveSymbol,
  SYMBOL_ALIASES,
  splitCsvLine,
} from "./nse-master";
export {
  auditedFromLabel,
  basisFromLabel,
  type DownloadOptions,
  defaultXbrlCacheDir,
  downloadXbrl,
  type FetchOptions as ResultsFetchOptions,
  type IntegratedFilingRaw,
  isFinancialResultsRow,
  type LegacyResultRaw,
  listIntegratedFilingRows,
  listIntegratedFilings,
  listLegacyResults,
  NSE_UA,
  NseFetchError,
  normaliseIntegratedRows,
  normaliseLegacyRows,
  nseGetJson,
  type ResultsFiling,
  type ResultsTaxonomy,
  taxonomyFromUrl,
  xbrlCachePath,
} from "./nse-results";
export {
  fetchUpstoxDaily,
  parseUpstoxBody,
  upstoxCandleUrl,
  upstoxEnabled,
} from "./upstox";

import {
  downloadXbrl as downloadXbrlImpl,
  listLegacyResults as listLegacyImpl,
  listIntegratedFilingRows as listRowsImpl,
} from "./nse-results";

/** Integrated-filing index for one symbol (financial-results rows, raw NSE shape; governance rows dropped). */
export async function fetchIntegratedFilings(
  symbol: string,
): Promise<IntegratedFilingRow[]> {
  const rows = await listRowsImpl(symbol);
  return rows.map((r) => ({
    symbol: r.symbol,
    cmName: r.cmName ?? r.smName ?? "",
    qe_Date: r.qe_Date,
    consolidated:
      r.consolidated === "Consolidated" || r.consolidated === "Standalone"
        ? r.consolidated
        : null,
    audited: r.audited ?? null,
    broadcast_Date: r.broadcast_Date ?? r.creation_Date ?? "",
    type: r.type,
    type_Sub: r.type_Sub ?? null,
    xbrl: r.xbrl ?? null,
    ixbrl: r.ixbrl ?? null,
    pdf_attach: r.pdf_attach ?? null,
    seq_Id: String(r.seq_Id),
    revised_Date: r.revised_Date ?? null,
    revision_Remark: r.revision_Remark ?? null,
  }));
}

/** Raw XBRL XML for one filing URL (cached under data/cache/xbrl). */
export async function fetchXbrl(url: string): Promise<string> {
  return downloadXbrlImpl(url);
}

/** Legacy results index (/api/corporates-financial-results), quarters ≤ Dec-2024 — normalised ResultsFiling rows. */
export async function fetchLegacyResults(symbol: string): Promise<unknown[]> {
  return listLegacyImpl(symbol);
}
