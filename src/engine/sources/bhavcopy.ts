/**
 * NSE UDiFF bhavcopy — the primary EOD source (whole market, one zip per
 * trading day, no cookies). Verified 8 Nov 2026 (docs/research/00, 04, 21).
 *
 *   https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_YYYYMMDD_F_0000.csv.zip
 *
 * 404 ⇒ no session (holiday) or not yet published (~18:00–19:00 IST on
 * trading days). Zips are cached under data/cache/bhavcopy/. The zip is
 * unpacked with a small built-in reader (central directory → deflate-raw), so
 * no new dependency is needed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { logger } from "@/lib/logger";
import type { BhavcopyRow } from "./index";
import { BROWSER_UA, HttpError, httpGet } from "./nse-announcements";
import { splitCsvLine } from "./nse-master";

const log = logger.child({ mod: "engine/sources/bhavcopy" });

export const DEFAULT_BHAV_CACHE_DIR = join(
  process.cwd(),
  "data",
  "cache",
  "bhavcopy",
);

/** Equity series we keep (EQ regular, BE/BZ trade-for-trade, SM = SME). */
export const EQUITY_SERIES: ReadonlySet<string> = new Set([
  "EQ",
  "BE",
  "BZ",
  "SM",
]);

export class BhavcopyNotAvailable extends Error {
  readonly dateKey: string;
  constructor(dateKey: string, detail: string) {
    super(`bhavcopy not available for ${dateKey}: ${detail}`);
    this.name = "BhavcopyNotAvailable";
    this.dateKey = dateKey;
  }
}

export function bhavcopyUrl(dateKey: string): string {
  const ymd = dateKey.replace(/-/g, "");
  if (!/^\d{8}$/.test(ymd)) throw new Error(`bad date key ${dateKey}`);
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd}_F_0000.csv.zip`;
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader (stored or deflated entries)
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Read every file in a zip archive via its central directory. */
export function readZipEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // End of central directory record: signature 0x06054b50, search backwards (comment ≤ 64 KB)
  let eocd = -1;
  for (
    let i = buf.byteLength - 22;
    i >= Math.max(0, buf.byteLength - 22 - 65_536);
    i--
  ) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  const entries = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true); // offset of central directory
  const out: ZipEntry[] = [];
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < entries; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50)
      throw new Error("zip: bad central directory entry");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // local header: 30 bytes + name + extra (lengths from the LOCAL header)
    if (dv.getUint32(localOff, true) !== 0x04034b50)
      throw new Error("zip: bad local header");
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (method === 0) data = comp;
    else if (method === 8) data = new Uint8Array(inflateRawSync(comp));
    else throw new Error(`zip: unsupported compression method ${method}`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function num(v: string | undefined): number {
  if (v === undefined || v === "" || v === "-") return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Parse the UDiFF CSV; keeps only equity series (EQ/BE/BZ/SM) and rows with an ISIN. */
export function parseBhavcopyCsv(csv: string): BhavcopyRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.trim());
  const idx = new Map(header.map((h, i) => [h, i] as const));
  const need = [
    "TradDt",
    "TckrSymb",
    "SctySrs",
    "ISIN",
    "OpnPric",
    "HghPric",
    "LwPric",
    "ClsPric",
    "LastPric",
    "PrvsClsgPric",
    "TtlTradgVol",
    "TtlTrfVal",
    "TtlNbOfTxsExctd",
  ];
  for (const c of need)
    if (!idx.has(c)) throw new Error(`bhavcopy: missing column ${c}`);
  const g = (f: string[], c: string): string | undefined => f[idx.get(c) ?? -1];
  const rows: BhavcopyRow[] = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line);
    const series = (g(f, "SctySrs") ?? "").trim();
    if (!EQUITY_SERIES.has(series)) continue;
    const isin = (g(f, "ISIN") ?? "").trim();
    if (!isin) continue;
    rows.push({
      TradDt: (g(f, "TradDt") ?? "").trim(),
      TckrSymb: (g(f, "TckrSymb") ?? "").trim(),
      SctySrs: series,
      ISIN: isin,
      OpnPric: num(g(f, "OpnPric")),
      HghPric: num(g(f, "HghPric")),
      LwPric: num(g(f, "LwPric")),
      ClsPric: num(g(f, "ClsPric")),
      LastPric: num(g(f, "LastPric")),
      PrvsClsgPric: num(g(f, "PrvsClsgPric")),
      TtlTradgVol: num(g(f, "TtlTradgVol")),
      TtlTrfVal: num(g(f, "TtlTrfVal")),
      TtlNbOfTxsExctd: num(g(f, "TtlNbOfTxsExctd")),
    });
  }
  return rows;
}

export function parseBhavcopyZip(
  zip: Uint8Array,
  dateKey: string,
): BhavcopyRow[] {
  const entries = readZipEntries(zip);
  const csvEntry =
    entries.find((e) => e.name.toLowerCase().endsWith(".csv")) ?? entries[0];
  if (!csvEntry) throw new Error("bhavcopy zip has no entries");
  const rows = parseBhavcopyCsv(new TextDecoder("utf-8").decode(csvEntry.data));
  // stale-file guard: every row must carry the requested trade date
  const bad = rows.find((r) => r.TradDt !== dateKey);
  if (bad)
    throw new Error(
      `bhavcopy for ${dateKey} contains TradDt=${bad.TradDt} (stale or wrong file)`,
    );
  return rows;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface FetchBhavcopyOptions {
  cacheDir?: string;
  /** skip the disk cache */
  noCache?: boolean;
  timeoutMs?: number;
}

/**
 * Whole-market EOD bars for one IST trade date 'YYYY-MM-DD'.
 * Throws BhavcopyNotAvailable on 404 (holiday / not yet published).
 */
export async function fetchBhavcopy(
  dateKey: string,
  o: FetchBhavcopyOptions = {},
): Promise<BhavcopyRow[]> {
  const cacheDir = o.cacheDir ?? DEFAULT_BHAV_CACHE_DIR;
  const cachePath = join(cacheDir, `${dateKey.replace(/-/g, "")}.zip`);
  if (!o.noCache && existsSync(cachePath)) {
    const rows = parseBhavcopyZip(
      new Uint8Array(readFileSync(cachePath)),
      dateKey,
    );
    log.debug({ dateKey, rows: rows.length }, "bhavcopy from cache");
    return rows;
  }
  const url = bhavcopyUrl(dateKey);
  let bytes: Uint8Array;
  try {
    const res = await httpGet(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
      timeoutMs: o.timeoutMs ?? 30_000,
      retries: 2,
      maxBytes: 20 * 1024 * 1024,
    });
    bytes = res.bytes;
    log.info(
      { dateKey, bytes: bytes.byteLength, ms: res.latencyMs },
      "bhavcopy downloaded",
    );
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) {
      throw new BhavcopyNotAvailable(dateKey, `HTTP ${e.status}`);
    }
    throw e;
  }
  const rows = parseBhavcopyZip(bytes, dateKey); // validate before caching
  if (!o.noCache) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, bytes);
  }
  return rows;
}
