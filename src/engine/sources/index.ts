/**
 * engine/sources — raw fetchers (contracts). Implementations live in sibling
 * files (nse.ts, bhavcopy.ts, …) and are re-exported from here.
 */
import type { AnnouncementRaw } from "../types";

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

/** Market-wide or per-symbol announcements. `symbol` omitted = whole market. */
export async function fetchAnnouncements(
  _range: DateRange,
  _symbol?: string,
): Promise<AnnouncementRaw[]> {
  throw new Error("not implemented: sources.fetchAnnouncements");
}

/** Integrated-filing index for one symbol (results + governance rows). */
export async function fetchIntegratedFilings(
  _symbol: string,
): Promise<IntegratedFilingRow[]> {
  throw new Error("not implemented: sources.fetchIntegratedFilings");
}

/** Raw XBRL XML for one filing URL. */
export async function fetchXbrl(_url: string): Promise<string> {
  throw new Error("not implemented: sources.fetchXbrl");
}

/** Legacy results index (/api/corporates-financial-results), quarters ≤ Dec-2024. */
export async function fetchLegacyResults(_symbol: string): Promise<unknown[]> {
  throw new Error("not implemented: sources.fetchLegacyResults");
}

/** Whole-market EOD bars for one IST trade date 'YYYY-MM-DD'. */
export async function fetchBhavcopy(_dateKey: string): Promise<BhavcopyRow[]> {
  throw new Error("not implemented: sources.fetchBhavcopy");
}

/** EQUITY_L.csv — the ISIN-keyed symbol master. */
export async function fetchEquityMaster(): Promise<EquityMasterRow[]> {
  throw new Error("not implemented: sources.fetchEquityMaster");
}

/** Download an attachment (PDF) with the right UA/timeouts; returns bytes. */
export async function fetchAttachment(_url: string): Promise<Uint8Array> {
  throw new Error("not implemented: sources.fetchAttachment");
}
