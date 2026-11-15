/**
 * NSE equity master (EQUITY_L.csv) — the ISIN-keyed symbol list.
 * https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv (UA only,
 * ~186 KB, 2,632 rows). Cached on disk for 24 h under data/cache/nse/.
 *
 * Column names carry trailing spaces in the source ("NAME OF COMPANY", " SERIES",
 * " ISIN NUMBER") — they are trimmed here.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@/lib/logger";
import type { EquityMasterRow } from "./index";
import { BROWSER_UA, bytesToText, httpGet } from "./nse-announcements";

const log = logger.child({ mod: "engine/sources/nse-master" });

export const EQUITY_MASTER_URL =
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

export const DEFAULT_MASTER_CACHE = join(
  process.cwd(),
  "data",
  "cache",
  "nse",
  "EQUITY_L.csv",
);

/** Minimal CSV line splitter (handles quoted fields with commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseEquityMasterCsv(csv: string): EquityMasterRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("EQUITY_L.csv: no data rows");
  const header = splitCsvLine(lines[0] ?? "").map((h) =>
    h.trim().toUpperCase(),
  );
  const col = (name: string): number => header.indexOf(name);
  const iSym = col("SYMBOL");
  const iName = col("NAME OF COMPANY");
  const iSeries = col("SERIES");
  const iIsin = col("ISIN NUMBER");
  const iList = col("DATE OF LISTING");
  if (iSym < 0 || iName < 0 || iIsin < 0) {
    throw new Error(`EQUITY_L.csv: unexpected header ${header.join("|")}`);
  }
  const rows: EquityMasterRow[] = [];
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line).map((x) => x.trim());
    const symbol = f[iSym] ?? "";
    const isin = f[iIsin] ?? "";
    if (!symbol || !/^IN[A-Z0-9]{10}$/.test(isin)) continue;
    rows.push({
      symbol,
      name: f[iName] ?? "",
      isin,
      series: iSeries >= 0 ? (f[iSeries] ?? "") : "",
      listingDate: iList >= 0 ? (f[iList] ?? "") : "",
    });
  }
  return rows;
}

export interface FetchMasterOptions {
  cachePath?: string;
  /** reuse the cached file if younger than this (default 24 h); 0 forces a refresh */
  maxAgeMs?: number;
}

/** Download (or load from cache) and parse the master. */
export async function fetchEquityMaster(
  o: FetchMasterOptions = {},
): Promise<EquityMasterRow[]> {
  const cachePath = o.cachePath ?? DEFAULT_MASTER_CACHE;
  const maxAge = o.maxAgeMs ?? 24 * 3_600_000;
  if (maxAge > 0 && existsSync(cachePath)) {
    const age = Date.now() - statSync(cachePath).mtimeMs;
    if (age < maxAge) {
      const rows = parseEquityMasterCsv(readFileSync(cachePath, "utf8"));
      log.info(
        { rows: rows.length, cachePath, ageMin: Math.round(age / 60000) },
        "equity master from cache",
      );
      return rows;
    }
  }
  const res = await httpGet(EQUITY_MASTER_URL, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/csv,*/*" },
    timeoutMs: 30_000,
    retries: 2,
  });
  const csv = bytesToText(res.bytes);
  const rows = parseEquityMasterCsv(csv); // validates before caching
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, csv);
  } catch (e) {
    log.warn(
      { cachePath, err: e instanceof Error ? e.message : String(e) },
      "equity master cache write failed",
    );
  }
  log.info(
    { rows: rows.length, bytes: res.bytes.byteLength, ms: res.latencyMs },
    "equity master downloaded",
  );
  return rows;
}

/** Known symbol churn (old → current). Extend as names change; ISIN is the key everywhere else. */
export const SYMBOL_ALIASES: Readonly<Record<string, string[]>> = {
  TMPV: ["TATAMOTORS"],
  TMCV: ["TATAMOTORS"],
  ETERNAL: ["ZOMATO"],
};

export interface MasterIndex {
  bySymbol: Map<string, EquityMasterRow>;
  byIsin: Map<string, EquityMasterRow>;
}

export function indexMaster(rows: EquityMasterRow[]): MasterIndex {
  const bySymbol = new Map<string, EquityMasterRow>();
  const byIsin = new Map<string, EquityMasterRow>();
  for (const r of rows) {
    bySymbol.set(r.symbol.toUpperCase(), r);
    // prefer EQ when an ISIN appears under several series
    const prev = byIsin.get(r.isin);
    if (!prev || (prev.series !== "EQ" && r.series === "EQ"))
      byIsin.set(r.isin, r);
  }
  return { bySymbol, byIsin };
}

/**
 * Resolve a user-typed symbol or ISIN to a master row: exact symbol, ISIN,
 * alias table, then a case-insensitive name prefix match.
 */
export function resolveSymbol(
  idx: MasterIndex,
  query: string,
): EquityMasterRow | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const direct = idx.bySymbol.get(q);
  if (direct) return direct;
  const byIsin = idx.byIsin.get(q);
  if (byIsin) return byIsin;
  for (const [current, olds] of Object.entries(SYMBOL_ALIASES)) {
    if (olds.includes(q)) {
      const r = idx.bySymbol.get(current);
      if (r) return r;
    }
  }
  for (const r of idx.bySymbol.values()) {
    if (r.name.toUpperCase().startsWith(q)) return r;
  }
  return null;
}
