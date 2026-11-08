/**
 * NSE document discovery (owner: Builder C).
 *
 * Two JSON endpoints, both answer to a Safari UA + `Accept: application/json`
 * without any cookie handshake (verified 8 Nov 2026 from the build Mac):
 *
 *   GET /api/corporate-announcements?index=equities&symbol=X   (no dates → full history, 2005→)
 *   GET /api/annual-reports?index=equities&symbol=X            → { data: [{fromYr,toYr,fileName,…}] }
 *
 * Never trust the status code alone: a "browser-like" header set gets empty
 * 200s. Every body is validated (JSON, expected shape) before use.
 */

import { logger } from "@/lib/logger";
import { parseNseDateTime } from "@/lib/time";
import { periodForTranscriptDate } from "../extract/transcript";
import type { AnnouncementRaw, DiscoveredDocument } from "../types";

const log = logger.child({ mod: "engine/sources/nse-docs" });

export const NSE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

const NSE_BASE = "https://www.nseindia.com";
const DEFAULT_TIMEOUT_MS = 25_000;

export interface NseAnnualReportRow {
  companyName: string;
  fromYr: string;
  toYr: string;
  submission_type?: string | null;
  broadcast_dttm?: string | null;
  disseminationDateTime?: string | null;
  fileName: string;
  attFileSize?: string | null;
}

async function nseJson(
  path: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const url = `${NSE_BASE}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": NSE_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          Referer:
            "https://www.nseindia.com/companies-listing/corporate-filings-announcements",
        },
        signal: ctrl.signal,
        redirect: "follow",
      });
      const text = await res.text();
      if (res.status !== 200)
        throw new Error(
          `NSE ${path} → HTTP ${res.status} (${text.length} bytes)`,
        );
      if (text.length < 2) throw new Error(`NSE ${path} → empty 200 body`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      log.warn(
        { path, attempt, err: e instanceof Error ? e.message : String(e) },
        "nse fetch failed",
      );
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Full per-symbol announcement history (one call; ~1–3k records for a large cap). */
export async function fetchNseAnnouncementHistory(
  symbol: string,
): Promise<AnnouncementRaw[]> {
  const body = await nseJson(
    `/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}`,
  );
  if (!Array.isArray(body))
    throw new Error("NSE announcements: body is not an array");
  return body.filter(
    (r): r is AnnouncementRaw =>
      !!r &&
      typeof r === "object" &&
      typeof (r as AnnouncementRaw).an_dt === "string" &&
      typeof (r as AnnouncementRaw).attchmntFile === "string",
  );
}

/** Annual reports index for a symbol (newest first as NSE returns them). */
export async function fetchNseAnnualReports(
  symbol: string,
): Promise<NseAnnualReportRow[]> {
  const body = await nseJson(
    `/api/annual-reports?index=equities&symbol=${encodeURIComponent(symbol)}`,
  );
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("NSE annual-reports: no data[]");
  return data.filter(
    (r): r is NseAnnualReportRow =>
      !!r &&
      typeof r === "object" &&
      typeof (r as NseAnnualReportRow).fileName === "string" &&
      /\.pdf(\?|$)/i.test((r as NseAnnualReportRow).fileName),
  );
}

// ---------------------------------------------------------------------------
// Pure classification of announcement rows → documents
// ---------------------------------------------------------------------------

const TRANSCRIPT_RE = /transcript/i;
/** things that carry the word "transcript" but are not earnings calls */
const NOT_EARNINGS_RE =
  /\b(audio|video|recording|webcast link|annual general meeting|\bAGM\b|EGM|extra[- ]?ordinary general|investor day|analyst day|AI day|capital markets? day|postal ballot|investor meet(ing)? (with|at)|conference (hosted|organi[sz]ed) by|non[- ]deal|roadshow|press conference only)/i;
const EARNINGS_HINT_RE =
  /(earning|result|quarter|Q[1-4]\b|FY\s?'?\d{2}|H[12]\b|financial (results|performance)|con(ference)?[- ]?call|concall|analyst)/i;
const PRESENTATION_RE =
  /investor presentation|earnings presentation|results presentation/i;

export interface NseDocCandidate extends DiscoveredDocument {
  /** higher = more likely the quarterly earnings-call transcript */
  score: number;
}

/**
 * Pure: pick transcript (and presentation) documents out of raw announcements.
 * `sinceMs` bounds the history (default: ~7 quarters back).
 */
export function transcriptsFromAnnouncements(
  rows: AnnouncementRaw[],
  opts: { sinceMs?: number; includePresentations?: boolean } = {},
): NseDocCandidate[] {
  const out: NseDocCandidate[] = [];
  for (const r of rows) {
    const text = `${r.attchmntText ?? ""} ${r.desc ?? ""}`;
    let filedAt: number;
    try {
      filedAt = parseNseDateTime(r.an_dt);
    } catch {
      continue;
    }
    if (opts.sinceMs !== undefined && filedAt < opts.sinceMs) continue;
    const url = (r.attchmntFile ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;

    const isTranscript =
      TRANSCRIPT_RE.test(text) && !NOT_EARNINGS_RE.test(text);
    const isPresentation =
      !!opts.includePresentations &&
      PRESENTATION_RE.test(text) &&
      !TRANSCRIPT_RE.test(text);
    if (!isTranscript && !isPresentation) continue;

    let score = 0;
    if (EARNINGS_HINT_RE.test(text)) score += 2;
    if (/con\.? call|conference call|earnings call/i.test(text)) score += 1;
    if (/Analysts\/Institutional Investor Meet/i.test(r.desc ?? "")) score += 1;
    if (/transcript/i.test(url)) score += 1;

    out.push({
      kind: isTranscript ? "transcript" : "presentation",
      period: periodForTranscriptDate(filedAt),
      url,
      source: "nse",
      publishedAtMs: filedAt,
      title: (r.attchmntText ?? "").trim().slice(0, 300) || null,
      announcementId: r.seq_id ? `nse:${r.seq_id}` : null,
      score,
    });
  }
  // newest first
  out.sort((a, b) => (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0));
  return out;
}

/** Pure: NSE annual-report rows → documents (`FY26` for 2025–2026). */
export function annualReportsFromNse(
  rows: NseAnnualReportRow[],
): DiscoveredDocument[] {
  const out: DiscoveredDocument[] = [];
  for (const r of rows) {
    const toYr = Number(r.toYr);
    if (!Number.isFinite(toYr) || toYr < 2000) continue;
    let publishedAtMs: number | null = null;
    const dt = r.broadcast_dttm ?? r.disseminationDateTime;
    if (dt) {
      try {
        publishedAtMs = parseNseDateTime(dt);
      } catch {
        publishedAtMs = null;
      }
    }
    out.push({
      kind: "annual_report",
      period: `FY${String(toYr).slice(-2)}`,
      url: r.fileName.trim(),
      source: "nse",
      publishedAtMs,
      title: `Annual Report ${r.fromYr}-${r.toYr}`,
      announcementId: null,
    });
  }
  out.sort((a, b) => (b.period ?? "").localeCompare(a.period ?? ""));
  return out;
}
