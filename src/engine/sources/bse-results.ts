/**
 * BSE structured-results cross-check (owner: Builder B — results engine).
 *
 * BSE's JSON API (`api.bseindia.com/BseIndiaAPI/api/...`) is TLS-fingerprinted:
 * a plain Node fetch returns 403 (re-verified 8 Nov 2026 from this machine with
 * UA + Referer + Origin). So this module is a *best-effort* cross-check that
 * returns `null` when blocked, plus pure helpers that are unit-tested:
 *
 *   bseQuarterId("2026-09-30") → 131   (BSE `Qtr` ids: 131 = Sep-2026, +1 per quarter)
 *   compareWithBse(xbrlQuarter, bseRows) → per-line agreement after auto-detecting
 *   the BSE scale (BSE publishes ₹ million; XBRL is absolute rupees).
 *
 * Endpoints (docs/research/05 §2.6):
 *   Corp_BSEDnBResults_SEBI_Consolidated_Res_ng/w?type1=c&strtype=131.00&strscripcd=500325&...  → consolidated P&L rows
 *   Corp_detailedResult_Transpose_ng/w?Scrip_cd=500325&Qtr=131.00                               → standalone P&L rows
 */
import { logger } from "@/lib/logger";
import type { ResultsQuarter } from "../types";
import { NSE_UA } from "./nse-results";

const log = logger.child({ mod: "engine/sources/bse-results" });

const BSE_API = "https://api.bseindia.com/BseIndiaAPI/api";
const BSE_HEADERS: Record<string, string> = {
  "User-Agent": NSE_UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.bseindia.com/",
  Origin: "https://www.bseindia.com",
};

/** Anchor verified 8 Nov 2026: Qtr 131 = quarter ended 30-Sep-2026. */
const ANCHOR_QTR_ID = 131;
const ANCHOR_YEAR = 2026;
const ANCHOR_MONTH = 9;

/** BSE `Qtr` id for a quarter-end date key ('YYYY-MM-DD'); null for non quarter-ends. */
export function bseQuarterId(periodEnd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodEnd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (![3, 6, 9, 12].includes(mo)) return null;
  const quartersFromAnchor = (y - ANCHOR_YEAR) * 4 + (mo - ANCHOR_MONTH) / 3;
  return ANCHOR_QTR_ID + quartersFromAnchor;
}

export interface BseResultRow {
  Description?: string | null;
  Amount?: string | number | null;
  RowType?: string | null;
  /** standalone endpoint uses these names */
  fld_desc?: string | null;
  Value?: string | number | null;
}

/**
 * Consolidated P&L rows for a scrip + quarter, or null when BSE blocks us
 * (403) or returns something unexpected. Never throws.
 */
export async function fetchBseConsolidatedResult(
  scripCode: string,
  periodEnd: string,
  opts: { timeoutMs?: number } = {},
): Promise<BseResultRow[] | null> {
  const qtr = bseQuarterId(periodEnd);
  if (qtr === null) return null;
  const qs = new URLSearchParams({
    type1: "c",
    strtype: `${qtr}.00`,
    strscripcd: scripCode,
    strscripname: "",
    strresultType: "",
    action: "show",
  });
  const url = `${BSE_API}/Corp_BSEDnBResults_SEBI_Consolidated_Res_ng/w?${qs}`;
  try {
    const res = await fetch(url, {
      headers: BSE_HEADERS,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) {
      log.info(
        { status: res.status, scripCode, qtr },
        "bse blocked/unavailable",
      );
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    const body = (await res.json()) as unknown;
    if (Array.isArray(body)) return body as BseResultRow[];
    if (body && typeof body === "object") {
      const t =
        (body as { Table?: unknown; table1?: unknown }).Table ??
        (body as { table1?: unknown }).table1;
      if (Array.isArray(t)) return t as BseResultRow[];
    }
    return null;
  } catch (e) {
    log.info(
      { scripCode, qtr, err: e instanceof Error ? e.message : String(e) },
      "bse fetch failed",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure comparison
// ---------------------------------------------------------------------------

const BSE_LABELS: Array<{ key: keyof ResultsQuarter; re: RegExp }> = [
  {
    key: "revenue",
    re: /^(revenue from operations|net sales|interest earned|total revenue from operations)/i,
  },
  { key: "otherIncome", re: /^other income/i },
  { key: "financeCosts", re: /^(finance costs?|interest expended)/i },
  { key: "dna", re: /^depreciation/i },
  {
    key: "pbt",
    re: /^(profit\s*\/?\s*\(?loss\)? before tax|profit before tax|p\/l before tax|profit from ordinary activities before tax)/i,
  },
  { key: "tax", re: /^(tax expense|total tax|tax)/i },
  {
    key: "pat",
    re: /^(net profit|profit\s*\/?\s*\(?loss\)? for the period|profit after tax|net p\/l after)/i,
  },
];

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.replace(/,/g, "").trim();
  if (!s || s === "-" || s === "--") return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[()\-\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export interface BseComparison {
  /** multiplier that turns BSE numbers into rupees (1e6 = ₹ million, 1e5 = lakh, 1e7 = crore) */
  scale: number | null;
  compared: number;
  agreed: number;
  lines: Array<{ key: string; xbrl: number; bse: number; agree: boolean }>;
}

/**
 * Compare an XBRL quarter against BSE rows. The scale is inferred from the
 * revenue line (the ratio closest to 1e5/1e6/1e7 wins); lines agree when
 * within 0.5 % or ₹1 crore.
 */
export function compareWithBse(
  q: ResultsQuarter,
  rows: BseResultRow[],
): BseComparison {
  const picked = new Map<string, number>();
  for (const r of rows) {
    const label = (r.Description ?? r.fld_desc ?? "").trim();
    const val = toNumber(r.Amount ?? r.Value);
    if (!label || val === null) continue;
    for (const { key, re } of BSE_LABELS) {
      if (!picked.has(key) && re.test(label)) picked.set(key, val);
    }
  }
  const rev = picked.get("revenue");
  let scale: number | null = null;
  if (rev && q.revenue) {
    const ratio = Math.abs(q.revenue / rev);
    scale = [1e5, 1e6, 1e7].reduce((best, s) =>
      Math.abs(Math.log10(ratio / s)) < Math.abs(Math.log10(ratio / best))
        ? s
        : best,
    );
  }
  const lines: BseComparison["lines"] = [];
  if (scale !== null) {
    for (const [key, bseVal] of picked) {
      const xv = q[key as keyof ResultsQuarter];
      if (typeof xv !== "number") continue;
      const bv = bseVal * scale;
      const tol = Math.max(0.005 * Math.max(Math.abs(xv), Math.abs(bv)), 1e7);
      lines.push({ key, xbrl: xv, bse: bv, agree: Math.abs(xv - bv) <= tol });
    }
  }
  return {
    scale,
    compared: lines.length,
    agreed: lines.filter((l) => l.agree).length,
    lines,
  };
}
