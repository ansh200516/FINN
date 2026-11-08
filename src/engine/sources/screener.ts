/**
 * screener.in document discovery (owner: Builder C). Secondary source.
 *
 *   GET https://www.screener.in/company/<SLUG>/consolidated/   (browser UA, ≤ 1 req/s)
 *   → `#documents .concalls li`  : "<Mon YYYY>" + links Transcript / PPT / REC / Notes
 *   → `#documents .annual-reports a` : "Annual Report YYYY" → BSE / NSE PDF
 *
 * Plain regex over the HTML (no DOM library); the markup is stable and small.
 * Transcript links are BSE `AnnPdfOpen.aspx?Pname=<uuid>.pdf` in most cases,
 * company IR domains otherwise (THERMAX, VEDL, LT) — tagged `source: "ir"`.
 */

import { logger } from "@/lib/logger";
import { periodForTranscriptDate } from "../extract/transcript";
import type { DiscoveredDocument } from "../types";
import { BROWSER_UA, isBseUrl, normaliseBseUrl } from "./bse-docs";

const log = logger.child({ mod: "engine/sources/screener" });

const SCREENER_BASE = "https://www.screener.in";
const TIMEOUT_MS = 20_000;

let lastRequestAt = 0;
async function politeDelay(): Promise<void> {
  const wait = lastRequestAt + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export async function fetchScreenerCompanyHtml(slug: string): Promise<string> {
  const urls = [
    `${SCREENER_BASE}/company/${encodeURIComponent(slug)}/consolidated/`,
    `${SCREENER_BASE}/company/${encodeURIComponent(slug)}/`,
  ];
  let lastErr: unknown;
  for (const url of urls) {
    await politeDelay();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
        },
        redirect: "follow",
        signal: ctrl.signal,
      });
      if (res.status === 404) {
        lastErr = new Error(`screener ${url} → 404`);
        continue;
      }
      if (res.status !== 200)
        throw new Error(`screener ${url} → HTTP ${res.status}`);
      const html = await res.text();
      if (!html.includes('id="documents"'))
        throw new Error(
          `screener ${url}: no #documents section (${html.length} bytes)`,
        );
      return html;
    } catch (e) {
      lastErr = e;
      log.warn(
        { url, err: e instanceof Error ? e.message : String(e) },
        "screener fetch failed",
      );
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("screener: unreachable");
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export interface ScreenerConcallRow {
  /** "Nov 2026" */
  label: string;
  /** first-of-month, ms UTC (IST midnight) */
  monthMs: number;
  transcript: string | null;
  ppt: string | null;
  rec: string | null;
  notes: string | null;
}

export interface ScreenerDocuments {
  concalls: ScreenerConcallRow[];
  annualReports: Array<{ label: string; year: number; url: string }>;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function monthLabelToMs(label: string): number | null {
  const m = /^([A-Za-z]{3})\s+(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const mon = MONTHS[(m[1] ?? "").toLowerCase()];
  if (mon === undefined) return null;
  // IST midnight of the 1st (UTC−5:30 the previous evening) — month granularity is all we need
  return Date.UTC(Number(m[2]), mon, 1, 0, 0, 0) - 5.5 * 3_600_000;
}

/** Pure: parse the Documents section out of a screener company page. */
export function parseScreenerDocuments(html: string): ScreenerDocuments {
  const out: ScreenerDocuments = { concalls: [], annualReports: [] };
  const docsStart = html.indexOf('id="documents"');
  const section = docsStart >= 0 ? html.slice(docsStart) : html;

  // --- concalls ---------------------------------------------------------
  const concallsIdx = section.search(/class="documents concalls/);
  if (concallsIdx >= 0) {
    const block = section.slice(concallsIdx);
    const endIdx = block.search(/class="documents annual-reports|<\/section>/);
    const list = endIdx > 0 ? block.slice(0, endIdx) : block;
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    for (const li of list.matchAll(liRe)) {
      const inner = li[1] ?? "";
      const labelM = /nowrap"[^>]*>\s*([A-Z][a-z]{2}\s+\d{4})\s*</.exec(inner);
      const label = labelM?.[1]?.trim();
      if (!label) continue;
      const monthMs = monthLabelToMs(label);
      if (monthMs === null) continue;
      const row: ScreenerConcallRow = {
        label,
        monthMs,
        transcript: null,
        ppt: null,
        rec: null,
        notes: null,
      };
      const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
      for (const a of inner.matchAll(aRe)) {
        const attrs = a[1] ?? "";
        const text = (a[2] ?? "").replace(/<[^>]+>/g, "").trim();
        const hrefM = /href="([^"]+)"/.exec(attrs);
        if (!hrefM?.[1]) continue;
        const href = decodeEntities(hrefM[1]);
        if (/^Transcript$/i.test(text)) row.transcript = href;
        else if (/^PPT$/i.test(text)) row.ppt = href;
        else if (/^REC$/i.test(text)) row.rec = href;
        else if (/^Notes$/i.test(text)) row.notes = href;
      }
      out.concalls.push(row);
    }
  }

  // --- annual reports ---------------------------------------------------
  const arIdx = section.search(/class="documents annual-reports/);
  if (arIdx >= 0) {
    const block = section.slice(arIdx);
    const endIdx = block.search(
      /class="documents (concalls|credit-ratings|announcements)|<\/section>/,
    );
    const list = endIdx > 0 ? block.slice(0, endIdx) : block;
    const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
    for (const a of list.matchAll(aRe)) {
      const attrs = a[1] ?? "";
      const text = (a[2] ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const yM = /Annual Report\s+(\d{4})/i.exec(text);
      const hrefM = /href="([^"]+)"/.exec(attrs);
      if (!yM?.[1] || !hrefM?.[1]) continue;
      out.annualReports.push({
        label: text,
        year: Number(yM[1]),
        url: decodeEntities(hrefM[1]),
      });
    }
  }
  return out;
}

/** Pure: screener rows → DiscoveredDocument[] (transcripts + annual reports). */
export function documentsFromScreener(
  docs: ScreenerDocuments,
  opts: { sinceMs?: number; maxAnnualReports?: number } = {},
): DiscoveredDocument[] {
  const out: DiscoveredDocument[] = [];
  for (const c of docs.concalls) {
    if (!c.transcript) continue;
    if (opts.sinceMs !== undefined && c.monthMs < opts.sinceMs) continue;
    const url = normaliseBseUrl(c.transcript);
    out.push({
      kind: "transcript",
      period: periodForTranscriptDate(c.monthMs),
      url,
      source: isBseUrl(url) ? "screener" : "ir",
      publishedAtMs: c.monthMs,
      title: `Concall ${c.label} (screener)`,
      announcementId: null,
    });
  }
  const ars = [...docs.annualReports].sort((a, b) => b.year - a.year);
  for (const ar of ars.slice(0, opts.maxAnnualReports ?? 2)) {
    const url = normaliseBseUrl(ar.url);
    out.push({
      kind: "annual_report",
      period: `FY${String(ar.year).slice(-2)}`,
      url,
      source: isBseUrl(url) ? "screener" : /nseindia/i.test(url) ? "nse" : "ir",
      publishedAtMs: null,
      title: ar.label,
      announcementId: null,
    });
  }
  return out;
}
