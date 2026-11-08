/**
 * NSE structured quarterly-results sources (owner: Builder B — results engine).
 *
 * Two indexes, one download:
 *
 *   listIntegratedFilings(symbol)  GET /api/integrated-filing-results?index=equities&symbol=X&size=100
 *                                  SEBI Integrated Filing (Financials) — quarters from Mar-2025 onward.
 *                                  Financial rows carry an XBRL URL whose file name encodes the
 *                                  taxonomy: INTEGRATED_FILING_INDAS_* | INTEGRATED_FILING_BANKING_* |
 *                                  INTEGRATED_FILING_NBFC_INDAS_* (verified 8 Nov 2026 on RELIANCE /
 *                                  HDFCBANK / BAJFINANCE). Governance rows are dropped.
 *   listLegacyResults(symbol)      GET /api/corporates-financial-results?index=equities&symbol=X&period=Quarterly
 *                                  Frozen at the Dec-2024 quarter. Returns a bare JSON array whose rows
 *                                  link the older BSE-taxonomy XBRL (INDAS_* | BANKING_* | NBFC_INDAS_*).
 *                                  `consolidated` is "Consolidated" | "Non-Consolidated" here.
 *   downloadXbrl(url)              nsearchives.nseindia.com, plain UA, cached under data/cache/xbrl/.
 *
 * Transport rules (docs/research/05 §1): Safari UA + `Accept: application/json`,
 * `Accept-Encoding: gzip, deflate` (never advertise br without a decoder — Node's
 * fetch decodes gzip/deflate itself), 20 s hard timeout, two retries with jitter,
 * and ALWAYS validate the body — a browser-like header set yields empty 200s.
 *
 * No parsing beyond JSON → typed records and no DB writes happen here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { logger } from "@/lib/logger";
import { parseNseDate, parseNseDateTime } from "@/lib/time";
import type { ResultsBasis } from "../types";

const log = logger.child({ mod: "engine/sources/nse-results" });

export const NSE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const NSE_API = "https://www.nseindia.com/api";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Results taxonomy, derived from the XBRL file name and confirmed by the facts. */
export type ResultsTaxonomy =
  | "INDAS"
  | "BANKING"
  | "NBFC"
  | "NONINDAS"
  | "UNKNOWN";

/** One quarterly results filing (one basis), normalised from either NSE index. */
export interface ResultsFiling {
  symbol: string;
  companyName: string | null;
  /** quarter end 'YYYY-MM-DD' */
  periodEnd: string;
  basis: ResultsBasis;
  /** null when the index did not say */
  audited: boolean | null;
  /** exchange broadcast time, ms UTC (null if unparseable) */
  filedAt: number | null;
  /** verbatim IST stamp from the index, e.g. "30-Oct-2026 21:32:55" */
  filedAtIst: string | null;
  seqId: string;
  xbrlUrl: string;
  ixbrlUrl: string | null;
  /** the index's pdf link; NSE often returns ".../corporate/null" — nulled here */
  pdfUrl: string | null;
  taxonomy: ResultsTaxonomy;
  /** type_Sub === "Revision" (integrated index only) */
  isRevision: boolean;
  revisedAt: string | null;
  index: "integrated" | "legacy";
}

/** Raw row of /api/integrated-filing-results (fields observed 8 Nov 2026). */
export interface IntegratedFilingRaw {
  symbol: string;
  cmName?: string | null;
  smName?: string | null;
  qe_Date: string;
  consolidated: string | null;
  audited: string | null;
  broadcast_Date?: string | null;
  creation_Date?: string | null;
  type: string;
  type_Sub?: string | null;
  xbrl?: string | null;
  xbrlFileSize?: string | null;
  ixbrl?: string | null;
  ixbrlFileSize?: string | null;
  pdf_attach?: string | null;
  attFileSize?: string | null;
  seq_Id: string | number;
  revised_Date?: string | null;
  revision_Remark?: string | null;
  diff?: string | null;
}

/** Raw row of /api/corporates-financial-results (fields observed 8 Nov 2026). */
export interface LegacyResultRaw {
  symbol: string;
  companyName?: string | null;
  isin?: string | null;
  fromDate?: string | null;
  toDate: string;
  consolidated: string | null;
  audited: string | null;
  filingDate?: string | null;
  broadCastDate?: string | null;
  exchdisstime?: string | null;
  period?: string | null;
  xbrl?: string | null;
  resultDetailedDataLink?: string | null;
  seqNumber?: string | number | null;
  bank?: string | null;
  indAs?: string | null;
  cumulative?: string | null;
  format?: string | null;
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

export class NseFetchError extends Error {
  readonly url: string;
  readonly status: number | undefined;
  constructor(url: string, message: string, status?: number) {
    super(`${message} (${url})`);
    this.name = "NseFetchError";
    this.url = url;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

function jitterMs(attempt: number): number {
  return 600 * (attempt + 1) + Math.floor(Math.random() * 900);
}

function combineSignals(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  if (!outer) return t;
  return AbortSignal.any([t, outer]);
}

/**
 * GET with hard timeout + jittered retries. `validate` must throw for bodies
 * that are the wrong shape (empty 200s are NSE's favourite failure mode).
 */
async function fetchText(
  url: string,
  headers: Record<string, string>,
  opts: FetchOptions,
  validate: (body: string, res: Response) => void,
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers,
        redirect: "follow",
        signal: combineSignals(timeoutMs, opts.signal),
      });
      const body = await res.text();
      if (!res.ok)
        throw new NseFetchError(url, `HTTP ${res.status}`, res.status);
      validate(body, res);
      log.debug(
        { url, bytes: body.length, ms: Date.now() - t0, attempt },
        "nse fetch ok",
      );
      return body;
    } catch (e) {
      lastErr = e;
      if (opts.signal?.aborted) throw e;
      const status = e instanceof NseFetchError ? e.status : undefined;
      log.warn(
        {
          url,
          attempt,
          status,
          err: e instanceof Error ? e.message.slice(0, 200) : String(e),
        },
        "nse fetch failed",
      );
      // 404s are final; everything else (403/429/5xx/timeouts/empty bodies) is retried
      if (status === 404) break;
      if (attempt < retries) await sleep(jitterMs(attempt), opts.signal);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new NseFetchError(url, String(lastErr));
}

const API_HEADERS: Record<string, string> = {
  "User-Agent": NSE_UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  Referer:
    "https://www.nseindia.com/companies-listing/corporate-filings-financial-results",
};

const ARCHIVE_HEADERS: Record<string, string> = {
  "User-Agent": NSE_UA,
  Accept: "*/*",
  "Accept-Encoding": "gzip, deflate",
};

/** GET an NSE API path and parse JSON; throws NseFetchError on empty/invalid bodies. */
export async function nseGetJson(
  path: string,
  params: Record<string, string>,
  opts: FetchOptions = {},
): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${NSE_API}${path}?${qs}`;
  let parsed: unknown;
  await fetchText(url, API_HEADERS, opts, (body) => {
    const trimmed = body.trim();
    if (trimmed.length < 2)
      throw new NseFetchError(url, "empty body (browser-like headers?)");
    if (trimmed.startsWith("<"))
      throw new NseFetchError(url, "HTML instead of JSON (blocked?)");
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new NseFetchError(url, "body is not JSON");
    }
  });
  return parsed;
}

// ---------------------------------------------------------------------------
// Normalisation helpers (pure; exported for tests)
// ---------------------------------------------------------------------------

/** Taxonomy from an XBRL file name — integrated (`INTEGRATED_FILING_*`) or legacy (`INDAS_*`). */
export function taxonomyFromUrl(
  url: string | null | undefined,
): ResultsTaxonomy {
  if (!url) return "UNKNOWN";
  const name = basename(url).toUpperCase();
  if (name.includes("BANKING")) return "BANKING";
  if (name.includes("NBFC")) return "NBFC";
  if (name.includes("NONINDAS") || name.includes("NON_INDAS"))
    return "NONINDAS";
  if (name.includes("INDAS")) return "INDAS";
  return "UNKNOWN";
}

/** The integrated index flags results rows by `type`; the XBRL file name is the backstop. */
export function isFinancialResultsRow(row: IntegratedFilingRaw): boolean {
  const t = (row.type ?? "").toLowerCase();
  if (t.includes("financial")) return true;
  if (t.includes("governance")) return false;
  const x = (row.xbrl ?? "").toUpperCase();
  return (
    x.includes("INTEGRATED_FILING_INDAS_") ||
    x.includes("INTEGRATED_FILING_NBFC_") ||
    x.includes("INTEGRATED_FILING_BANKING_") ||
    x.includes("INTEGRATED_FILING_NONINDAS_")
  );
}

export function basisFromLabel(
  s: string | null | undefined,
): ResultsBasis | null {
  const v = (s ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith("non") || v.startsWith("stand")) return "standalone";
  if (v.startsWith("consol")) return "consolidated";
  return null;
}

export function auditedFromLabel(s: string | null | undefined): boolean | null {
  const v = (s ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (!v) return null;
  if (v.startsWith("unaudited") || v.startsWith("unaudit")) return false;
  if (v.startsWith("audited")) return true;
  return null;
}

function safeDate(s: string | null | undefined): string | null {
  if (!s) return null;
  try {
    return parseNseDate(s);
  } catch {
    return null;
  }
}

function safeDateTime(s: string | null | undefined): number | null {
  if (!s) return null;
  try {
    return parseNseDateTime(s);
  } catch {
    return null;
  }
}

function cleanUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.trim();
  if (!s || s.endsWith("/null") || s === "null") return null;
  return s;
}

/** Pure: integrated-index rows → normalised filings (financial rows only, latest revision per quarter+basis). */
export function normaliseIntegratedRows(
  rows: IntegratedFilingRaw[],
): ResultsFiling[] {
  const out: ResultsFiling[] = [];
  for (const r of rows) {
    if (!isFinancialResultsRow(r)) continue;
    const xbrlUrl = cleanUrl(r.xbrl);
    if (!xbrlUrl) continue;
    const periodEnd = safeDate(r.qe_Date);
    const basis = basisFromLabel(r.consolidated);
    if (!periodEnd || !basis) continue;
    const stamp = r.broadcast_Date ?? r.creation_Date ?? null;
    out.push({
      symbol: r.symbol,
      companyName: r.cmName ?? r.smName ?? null,
      periodEnd,
      basis,
      audited: auditedFromLabel(r.audited),
      filedAt: safeDateTime(stamp),
      filedAtIst: stamp,
      seqId: String(r.seq_Id),
      xbrlUrl,
      ixbrlUrl: cleanUrl(r.ixbrl),
      pdfUrl: cleanUrl(r.pdf_attach),
      taxonomy: taxonomyFromUrl(xbrlUrl),
      isRevision: (r.type_Sub ?? "").toLowerCase().includes("revis"),
      revisedAt: r.revised_Date ?? null,
      index: "integrated",
    });
  }
  return dedupeLatest(out);
}

/** Pure: legacy-index rows → normalised filings (quarterly rows with an XBRL link only). */
export function normaliseLegacyRows(rows: LegacyResultRaw[]): ResultsFiling[] {
  const out: ResultsFiling[] = [];
  for (const r of rows) {
    if ((r.period ?? "Quarterly").toLowerCase() !== "quarterly") continue;
    const xbrlUrl = cleanUrl(r.xbrl);
    if (!xbrlUrl) continue;
    const periodEnd = safeDate(r.toDate);
    const basis = basisFromLabel(r.consolidated);
    if (!periodEnd || !basis) continue;
    const stamp = r.broadCastDate ?? r.exchdisstime ?? r.filingDate ?? null;
    out.push({
      symbol: r.symbol,
      companyName: r.companyName ?? null,
      periodEnd,
      basis,
      audited: auditedFromLabel(r.audited),
      filedAt: safeDateTime(stamp),
      filedAtIst: stamp,
      seqId: String(r.seqNumber ?? ""),
      xbrlUrl,
      ixbrlUrl: null,
      pdfUrl: null,
      taxonomy: taxonomyFromUrl(xbrlUrl),
      isRevision: false,
      revisedAt: null,
      index: "legacy",
    });
  }
  return dedupeLatest(out);
}

/** Keep the most recently filed row per (periodEnd, basis); sort newest quarter first. */
function dedupeLatest(rows: ResultsFiling[]): ResultsFiling[] {
  const best = new Map<string, ResultsFiling>();
  for (const r of rows) {
    const k = `${r.periodEnd}|${r.basis}`;
    const cur = best.get(k);
    if (!cur || (r.filedAt ?? 0) > (cur.filedAt ?? 0)) best.set(k, r);
  }
  return [...best.values()].sort((a, b) =>
    a.periodEnd === b.periodEnd
      ? a.basis.localeCompare(b.basis)
      : b.periodEnd.localeCompare(a.periodEnd),
  );
}

// ---------------------------------------------------------------------------
// Index fetchers
// ---------------------------------------------------------------------------

/** Raw integrated-filing rows for one symbol, financial-results rows only (NSE shape, unnormalised). */
export async function listIntegratedFilingRows(
  symbol: string,
  opts: FetchOptions & { size?: number } = {},
): Promise<IntegratedFilingRaw[]> {
  const raw = await nseGetJson(
    "/integrated-filing-results",
    {
      index: "equities",
      symbol: symbol.toUpperCase(),
      size: String(opts.size ?? 100),
    },
    opts,
  );
  return extractRows<IntegratedFilingRaw>(raw).filter(isFinancialResultsRow);
}

/**
 * Integrated-filing index for one symbol → financial-results filings (both
 * bases, deduped to the latest revision), newest first. Mar-2025 onward.
 */
export async function listIntegratedFilings(
  symbol: string,
  opts: FetchOptions & { size?: number } = {},
): Promise<ResultsFiling[]> {
  const rows = await listIntegratedFilingRows(symbol, opts);
  const filings = normaliseIntegratedRows(rows);
  log.info(
    { symbol, rows: rows.length, filings: filings.length },
    "integrated filings listed",
  );
  return filings;
}

/**
 * Legacy results index (quarters ≤ Dec-2024) → filings with XBRL links,
 * newest first. Use for trajectory depth beyond the integrated window.
 */
export async function listLegacyResults(
  symbol: string,
  opts: FetchOptions = {},
): Promise<ResultsFiling[]> {
  const raw = await nseGetJson(
    "/corporates-financial-results",
    { index: "equities", symbol: symbol.toUpperCase(), period: "Quarterly" },
    opts,
  );
  const rows = extractRows<LegacyResultRaw>(raw);
  const filings = normaliseLegacyRows(rows);
  log.info(
    { symbol, rows: rows.length, filings: filings.length },
    "legacy results listed",
  );
  return filings;
}

function extractRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const d = (raw as { data?: unknown }).data;
    if (Array.isArray(d)) return d as T[];
  }
  return [];
}

// ---------------------------------------------------------------------------
// XBRL download with on-disk cache
// ---------------------------------------------------------------------------

export interface DownloadOptions extends FetchOptions {
  /** default: <cwd>/data/cache/xbrl (gitignored) */
  cacheDir?: string;
  /** bypass the cache */
  force?: boolean;
}

export function defaultXbrlCacheDir(): string {
  return join(process.cwd(), "data", "cache", "xbrl");
}

/** Cache path for an XBRL URL (file name is unique per filing on nsearchives). */
export function xbrlCachePath(
  url: string,
  cacheDir = defaultXbrlCacheDir(),
): string {
  const name = basename(new URL(url).pathname).replace(/[^A-Za-z0-9._-]/g, "_");
  return join(cacheDir, name);
}

/**
 * Download one XBRL instance (XML string). Cached forever: a filing URL never
 * changes content (revisions get a new URL). Validates that the body is XML
 * with an xbrl root; a tarpitted/empty response throws.
 */
export async function downloadXbrl(
  url: string,
  opts: DownloadOptions = {},
): Promise<string> {
  const cacheDir = opts.cacheDir ?? defaultXbrlCacheDir();
  const path = xbrlCachePath(url, cacheDir);
  if (!opts.force && existsSync(path)) {
    const cached = readFileSync(path, "utf8");
    if (looksLikeXbrl(cached)) return cached;
  }
  const body = await fetchText(url, ARCHIVE_HEADERS, opts, (b) => {
    if (!looksLikeXbrl(b))
      throw new NseFetchError(url, "body is not an XBRL instance");
  });
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path, body, "utf8");
  } catch (e) {
    log.warn(
      { path, err: e instanceof Error ? e.message : String(e) },
      "xbrl cache write failed",
    );
  }
  return body;
}

function looksLikeXbrl(s: string): boolean {
  const head = s.slice(0, 4000);
  return (
    head.includes("<xbrli:xbrl") ||
    /<xbrl[\s>]/.test(head) ||
    head.includes(":xbrl ")
  );
}
