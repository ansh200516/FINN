/**
 * NSE corporate-announcements fetcher + the shared polite HTTP helper used by
 * every source in this folder (browser UA, hard timeouts, jittered retries,
 * per-host rate limiting, size caps, body validation).
 *
 * Verified 8 Nov 2026 (docs/research/00, 05): the minimal header set
 * (Safari UA + Accept: application/json + Accept-Encoding: gzip — never `br`)
 * returns full bodies; "more browser-like" sets return EMPTY 200s, so the body
 * is validated (must be a JSON array), never just the status code.
 */
import { logger } from "@/lib/logger";
import type { AnnouncementRaw } from "../types";
import type { DateRange } from "./index";

const log = logger.child({ mod: "engine/sources/nse-announcements" });

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

export const NSE_API_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": BROWSER_UA,
  Accept: "application/json",
  "Accept-Encoding": "gzip",
};

export interface HttpGetOptions {
  headers?: Record<string, string>;
  /** hard timeout per attempt (default 20 s) */
  timeoutMs?: number;
  /** additional attempts after the first (default 2) */
  retries?: number;
  /** reject bodies larger than this (default 50 MB) */
  maxBytes?: number;
  /** minimum spacing between requests to the same host (default 500 ms = 2 req/s) */
  minIntervalMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  bytes: Uint8Array;
  headers: Headers;
  url: string;
  latencyMs: number;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(status: number, url: string, detail?: string) {
    super(`HTTP ${status} for ${url}${detail ? `: ${detail}` : ""}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

export class BodyTooLargeError extends Error {
  readonly url: string;
  readonly bytes: number;
  constructor(url: string, bytes: number, max: number) {
    super(`body too large for ${url}: ${bytes} > ${max} bytes`);
    this.name = "BodyTooLargeError";
    this.url = url;
    this.bytes = bytes;
  }
}

const lastRequestAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gentle per-host pacing: waits until `minIntervalMs` has passed since the previous request to the host. */
async function pace(host: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - now;
  // reserve the slot before sleeping so concurrent callers queue behind us
  lastRequestAt.set(host, Math.max(now, last + minIntervalMs));
  if (wait > 0) await sleep(wait);
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * GET with browser UA, hard timeout, jittered retries, per-host pacing and a
 * size cap. Throws HttpError on non-2xx after retries (404 is NOT retried).
 */
export async function httpGet(
  url: string,
  o: HttpGetOptions = {},
): Promise<HttpResponse> {
  const timeoutMs = o.timeoutMs ?? 20_000;
  const retries = o.retries ?? 2;
  const maxBytes = o.maxBytes ?? 50 * 1024 * 1024;
  const minInterval = o.minIntervalMs ?? 500;
  const host = new URL(url).host;
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    ...(o.headers ?? {}),
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace(host, minInterval);
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`timeout after ${timeoutMs} ms`)),
      timeoutMs,
    );
    const onAbort = () => ctrl.abort(o.signal?.reason ?? new Error("aborted"));
    o.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, {
        headers,
        signal: ctrl.signal,
        redirect: "follow",
      });
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > maxBytes) throw new BodyTooLargeError(url, len, maxBytes);
      if (!res.ok) {
        // drain a little for logging, then decide
        const snippet = (await res.text().catch(() => "")).slice(0, 120);
        const err = new HttpError(res.status, url, snippet);
        if (isRetryableStatus(res.status) && attempt < retries) {
          lastErr = err;
          log.warn(
            { url, status: res.status, attempt },
            "retryable http status",
          );
          await sleep(500 + Math.random() * 1500 + attempt * 1000);
          continue;
        }
        throw err;
      }
      const bytes = await readCapped(res, maxBytes, url);
      return {
        status: res.status,
        bytes,
        headers: res.headers,
        url: res.url || url,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      if (e instanceof HttpError || e instanceof BodyTooLargeError) throw e;
      if (o.signal?.aborted) throw e;
      lastErr = e;
      if (attempt < retries) {
        log.warn(
          { url, attempt, err: e instanceof Error ? e.message : String(e) },
          "http error — retrying",
        );
        await sleep(500 + Math.random() * 1500 + attempt * 1000);
      }
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`request failed: ${url}`);
}

async function readCapped(
  res: Response,
  maxBytes: number,
  url: string,
): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError(url, total, maxBytes);
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

export function bytesToText(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' or 'DD-MM-YYYY' → 'DD-MM-YYYY' (what the NSE API expects). */
export function toNseApiDate(s: string): string {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t);
  if (m) return t;
  throw new Error(`unrecognised date for NSE API: ${s}`);
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export const NSE_ANNOUNCEMENTS_URL =
  "https://www.nseindia.com/api/corporate-announcements";

export function announcementsUrl(range?: DateRange, symbol?: string): string {
  const u = new URL(NSE_ANNOUNCEMENTS_URL);
  u.searchParams.set("index", "equities");
  if (symbol) u.searchParams.set("symbol", symbol);
  if (range) {
    u.searchParams.set("from_date", toNseApiDate(range.from));
    u.searchParams.set("to_date", toNseApiDate(range.to));
  }
  return u.toString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function strOrNull(v: unknown): string | null {
  return v == null || v === "" ? null : String(v);
}

/**
 * Coerce one API record into AnnouncementRaw. NSE returns `hasXbrl` as a
 * boolean (observed 8 Nov 2026) although older docs say "Yes"/"No"; both are
 * normalised to "Yes"/"No". Records without seq_id, symbol or an_dt are dropped.
 */
export function normaliseAnnouncement(rec: unknown): AnnouncementRaw | null {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  const seq = str(r.seq_id);
  const symbol = str(r.symbol).trim();
  const anDt = str(r.an_dt).trim();
  if (!seq || !symbol || !anDt) return null;
  let hasXbrl: string | null;
  if (typeof r.hasXbrl === "boolean") hasXbrl = r.hasXbrl ? "Yes" : "No";
  else hasXbrl = strOrNull(r.hasXbrl);
  return {
    symbol,
    sm_name: str(r.sm_name).trim(),
    sm_isin: str(r.sm_isin).trim(),
    smIndustry: strOrNull(r.smIndustry),
    desc: str(r.desc).trim(),
    attchmntText: str(r.attchmntText).trim(),
    attchmntFile: str(r.attchmntFile).trim(),
    attFileSize: strOrNull(r.attFileSize),
    fileSize: strOrNull(r.fileSize),
    hasXbrl,
    an_dt: anDt,
    sort_date: str(r.sort_date).trim() || anDt,
    exchdisstime: str(r.exchdisstime).trim() || anDt,
    dt: strOrNull(r.dt) ?? undefined,
    seq_id: seq,
    orgid: strOrNull(r.orgid),
    bflag: strOrNull(r.bflag),
    csvName: strOrNull(r.csvName),
    difference: strOrNull(r.difference),
    old_new: strOrNull(r.old_new),
    voiceSummary: strOrNull(r.voiceSummary),
    voiceUrl: strOrNull(r.voiceUrl),
  };
}

/** Parse + validate an announcements body: must be a JSON array (empty is legal but logged). */
export function parseAnnouncementsBody(
  text: string,
  ctx: string,
): AnnouncementRaw[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `NSE announcements body is not JSON (${ctx}): ${text.slice(0, 80)}`,
    );
  }
  if (!Array.isArray(json)) {
    throw new Error(
      `NSE announcements body is not an array (${ctx}): ${JSON.stringify(json).slice(0, 120)}`,
    );
  }
  const out: AnnouncementRaw[] = [];
  for (const rec of json) {
    const n = normaliseAnnouncement(rec);
    if (n) out.push(n);
  }
  if (json.length === 0) log.info({ ctx }, "NSE returned an empty array");
  return out;
}

export interface FetchAnnouncementsOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
}

/**
 * Market-wide or per-symbol announcements for a date range (DD-MM-YYYY or
 * YYYY-MM-DD). One request, no pagination (the server returns everything).
 */
export async function fetchAnnouncements(
  range: DateRange,
  symbol?: string,
  o: FetchAnnouncementsOptions = {},
): Promise<AnnouncementRaw[]> {
  const url = announcementsUrl(range, symbol);
  const res = await httpGet(url, {
    headers: { ...NSE_API_HEADERS },
    timeoutMs: o.timeoutMs ?? 20_000,
    retries: o.retries ?? 2,
    signal: o.signal,
  });
  const rows = parseAnnouncementsBody(
    bytesToText(res.bytes),
    `${symbol ?? "market"} ${range.from}..${range.to}`,
  );
  log.info(
    {
      symbol: symbol ?? "*",
      from: range.from,
      to: range.to,
      rows: rows.length,
      ms: res.latencyMs,
    },
    "announcements fetched",
  );
  return rows;
}

/** Per-symbol full history (no dates → everything back to 2004). Used for bio backfill. */
export async function fetchAnnouncementHistory(
  symbol: string,
  o: FetchAnnouncementsOptions = {},
): Promise<AnnouncementRaw[]> {
  const url = announcementsUrl(undefined, symbol);
  const res = await httpGet(url, {
    headers: { ...NSE_API_HEADERS },
    timeoutMs: o.timeoutMs ?? 30_000,
    retries: o.retries ?? 2,
    signal: o.signal,
  });
  const rows = parseAnnouncementsBody(
    bytesToText(res.bytes),
    `${symbol} history`,
  );
  log.info(
    { symbol, rows: rows.length, ms: res.latencyMs },
    "announcement history fetched",
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Download an attachment (PDF/ZIP) from nsearchives with a browser UA
 * (no UA → the connection hangs), 30 s timeout and a 15 MB cap.
 */
export async function fetchAttachment(
  url: string,
  o: { maxBytes?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const res = await httpGet(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "*/*" },
    timeoutMs: o.timeoutMs ?? 30_000,
    retries: 1,
    maxBytes: o.maxBytes ?? ATTACHMENT_MAX_BYTES,
    signal: o.signal,
  });
  return res.bytes;
}

/** "1.2 MB" | "228.94 KB" | "0 Bytes" → bytes (null when unparseable). */
export function parseFileSize(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^([\d.,]+)\s*(bytes?|kb|mb|gb)$/i.exec(s.trim());
  if (!m) return null;
  const n = Number((m[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mult = unit.startsWith("g")
    ? 1024 ** 3
    : unit.startsWith("m")
      ? 1024 ** 2
      : unit.startsWith("k")
        ? 1024
        : 1;
  return Math.round(n * mult);
}
