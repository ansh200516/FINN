/**
 * Preliminary results from the filing PDF (owner: Builder B).
 *
 * Same-evening results arrive as a PDF ~2 h before the XBRL. This module turns
 * that PDF into `ResultsQuarter` rows (`source: "pdf"`) WITHOUT an LLM:
 *
 *   1. `unpdf` text per page → score pages for the SEBI Reg. 33 statement
 *      (revenue/interest-earned + PBT + "quarter ended"; not segment/balance-sheet/
 *      cash-flow/review-report pages) → classify consolidated vs standalone, bank vs
 *      Ind AS;
 *   2. units from the header (crore / lakh / million / thousand) — fail closed when
 *      absent (mis-reading lakhs as crores is the one unforgivable bug);
 *   3. rows by LABEL, never by position; Indian + western grouping, `(123)` negatives
 *      incl. OCR brackets `{`/`[`, `O`→`0`, `l`/`I`→`1` inside numeric tokens only,
 *      OCR decimal commas (`79362,78`), `-`/`Nil` = 0, footnote markers `7)` rejected;
 *   4. columns: SEBI order is fixed — [this quarter, preceding quarter, same quarter
 *      last year, YTD this year, YTD last year, previous FY] (6 cols for Q2/Q3, 4 for
 *      Q1, 5 for Q4). Header dates are parsed as a plausibility check only — OCR
 *      mangles them (`39.09.2026`) — and the quarter end comes from the title or the
 *      caller;
 *   5. the SAME identity checks as the XBRL path per column; the current column must
 *      pass. One row may be repaired from an identity when every other relation
 *      holds (e.g. HDFC Bank's OCR layer reads PAT 19609.96 where PBT − tax = 19509.96)
 *      — the repair is recorded and lowers confidence; otherwise the extraction
 *      returns `null` with reasons. Unverified numbers are never emitted.
 *
 * Optional (flag `allowLlm`, ≤ a handful of Flash-Lite calls): the whole PDF is sent
 * to Gemini via `callStructured` with the statement page numbers in the prompt, and
 * the output goes through the identical checks. Off by default.
 */
import { z } from "zod";
import { logger } from "@/lib/logger";
import { shiftQuarterEnd } from "../ingest/parse-xbrl";
import { callStructured } from "../llm/gateway";
import type { ResultsBasis, ResultsQuarter } from "../types";

const log = logger.child({ mod: "engine/extract/results-pdf" });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PdfExtractContext {
  isin: string;
  sourceUrl: string;
  filedAt?: number | null;
  /** 'YYYY-MM-DD' quarter end if the caller knows it (from the board-meeting date) */
  periodEnd?: string;
  /** prefer this statement when both are in the PDF (default: consolidated, banks standalone) */
  preferBasis?: ResultsBasis;
  /** allow the Gemini fallback when the text path fails (default false) */
  allowLlm?: boolean;
}

export interface PdfStatement {
  page: number;
  basis: ResultsBasis;
  variant: "corporate" | "bank" | "nbfc";
  unit: UnitName;
  multiplier: number;
  /** column period ends, SEBI order; null when unknown */
  columnEnds: Array<string | null>;
  /** parsed line items per column (rupees) */
  columns: Array<Record<string, number | null>>;
  headerDates: string[];
  warnings: string[];
}

export interface PdfResultsExtraction {
  /** current quarter (column 0) for each statement that passed its checks */
  quarters: ResultsQuarter[];
  /** the preceding / year-ago columns when they passed their own checks */
  comparatives: ResultsQuarter[];
  statements: PdfStatement[];
  /** 0..1 — 1.0 = every row parsed and every identity held without repair */
  confidence: number;
  method: "text" | "llm";
  pages: number;
  reasons: string[];
}

export type UnitName = "crore" | "lakh" | "million" | "thousand";

// ---------------------------------------------------------------------------
// Number parsing (OCR tolerant) — exported for tests
// ---------------------------------------------------------------------------

const NIL_TOKENS = new Set([
  "-",
  "–",
  "—",
  "nil",
  "nil.",
  "--",
  "—-",
  "(-)",
  "0.00",
  "0",
]);

/**
 * Parse one numeric token from a results table. Returns null for non-numbers
 * (labels, footnote markers like "7)", percentages are returned as numbers).
 */
export function parseIndianNumber(tokenRaw: string): number | null {
  let t = tokenRaw.trim();
  if (!t) return null;
  if (NIL_TOKENS.has(t.toLowerCase())) return 0;
  // footnote marker "7)" / "12)" without an opening bracket is a label fragment
  if (/[)\]}]$/.test(t) && !/^[([{]/.test(t)) return null;
  const neg = /^[([{]/.test(t) || /^[-−–]/.test(t);
  t = t
    .replace(/^[([{]|[)\]}]$/g, "")
    .replace(/^[-−–]/, "")
    .replace(/%$/, "");
  if (!/\d/.test(t)) return null;
  // OCR: letters that stand for digits — only when the token is otherwise numeric
  const repaired = t.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
  if (!/^[0-9][0-9,.\s']*$/.test(repaired)) return null;
  let s = repaired.replace(/[\s']/g, "");
  // OCR decimal comma: "79362,78" (comma + exactly 2 digits at the end, no dot) → decimal point
  if (!s.includes(".") && /,\d{2}$/.test(s) && !/,\d{3}$/.test(s))
    s = `${s.slice(0, -3)}.${s.slice(-2)}`;
  // "11.102.55" → thousands dots
  if ((s.match(/\./g) ?? []).length > 1) {
    const i = s.lastIndexOf(".");
    s = s.slice(0, i).replace(/\./g, "") + s.slice(i);
  }
  s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Split a text fragment into numeric tokens (values and nil dashes), left to right. */
export function numericTokens(fragment: string): Array<number | null> {
  const out: Array<number | null> = [];
  for (const raw of fragment.split(/\s+/)) {
    if (!raw) continue;
    if (/^[-–—]$/.test(raw)) {
      out.push(0);
      continue;
    }
    // "195Ventures": a value glued to the next label fragment by the text layer
    const glued = /^([([{]?[-–]?\d[\d,.]*[)\]}]?)([A-Za-z][A-Za-z-]{2,})$/.exec(
      raw,
    );
    const tok = glued?.[1] ?? raw;
    const v = parseIndianNumber(tok);
    if (v !== null) out.push(v);
  }
  return out;
}

export const UNIT_MULTIPLIER: Record<UnitName, number> = {
  crore: 1e7,
  lakh: 1e5,
  million: 1e6,
  thousand: 1e3,
};

/** Detect the statement's unit from its header region; null when absent (caller must fail closed). */
export function detectUnit(headerText: string): UnitName | null {
  const h = headerText.toLowerCase();
  const m =
    /\b(crores?|cr\.?|lakhs?|lacs?|millions?|mn\.?|thousands?|'000)\b/.exec(h);
  if (!m) return null;
  const w = m[1] ?? "";
  if (w.startsWith("cr")) return "crore";
  if (w.startsWith("la")) return "lakh";
  if (w.startsWith("mi") || w.startsWith("mn")) return "million";
  return "thousand";
}

// ---------------------------------------------------------------------------
// Dates (title / header)
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** Dates in a header/title fragment → 'YYYY-MM-DD' (quarter-end style dates only). */
export function extractDates(text: string): string[] {
  const t = text.replace(/[Oo]/g, (c, i: number) =>
    /\d/.test(text[i - 1] ?? "") || /\d/.test(text[i + 1] ?? "") ? "0" : c,
  );
  const out: string[] = [];
  const push = (y: number, m: number, d: number) => {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return;
    out.push(
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  };
  for (const m of t.matchAll(/(\d{2})[./-](\d{2})[./-](\d{4})/g))
    push(Number(m[3]), Number(m[2]), Number(m[1]));
  for (const m of t.matchAll(
    /(\d{1,2})(?:st|nd|rd|th)?\s*([A-Za-z]{3,9})[,.']?\s*(\d{4}|\d{2})\b/gi,
  )) {
    const mon =
      MONTHS[(m[2] ?? "").toLowerCase().slice(0, 4)] ??
      MONTHS[(m[2] ?? "").toLowerCase().slice(0, 3)];
    if (!mon) continue;
    const yRaw = Number(m[3]);
    push(yRaw < 100 ? 2000 + yRaw : yRaw, mon, Number(m[1]));
  }
  for (const m of t.matchAll(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})\b/g)) {
    const mon =
      MONTHS[(m[1] ?? "").toLowerCase().slice(0, 4)] ??
      MONTHS[(m[1] ?? "").toLowerCase().slice(0, 3)];
    if (!mon) continue;
    push(Number(m[3]), mon, Number(m[2]));
  }
  return out;
}

function isQuarterEnd(d: string): boolean {
  return /-(03-31|06-30|09-30|12-31)$/.test(d);
}

// ---------------------------------------------------------------------------
// Page selection
// ---------------------------------------------------------------------------

interface PageInfo {
  page: number;
  text: string;
  lower: string;
  score: number;
  basis: ResultsBasis | null;
  variant: "corporate" | "bank" | "nbfc";
}

function scorePage(page: number, text: string): PageInfo {
  const lower = text.toLowerCase();
  const head = lower.slice(0, 900);
  let score = 0;
  if (
    /(revenue from operations|interest earned|income from operations|total revenue from operations)/.test(
      lower,
    )
  )
    score += 2;
  if (/(profit|loss)[^\n]{0,80}before tax/.test(lower)) score += 2;
  if (
    /(quarter|three months|3 months)\s+ended/.test(head) ||
    /quarter ended/.test(lower)
  )
    score += 1;
  if (
    /(financial results|statement of (unaudited|audited) results|results for the)/.test(
      head,
    )
  )
    score += 1;
  if (
    /(profit|loss)[^\n]{0,40}for the (period|quarter|year)/.test(lower) ||
    /net profit/.test(lower)
  )
    score += 1;
  if (
    /^[\s\S]{0,400}(segment|balance sheet|statement of assets|cash flow|review report|auditor)/.test(
      head,
    )
  )
    score -= 3;
  if (/segment (revenue|results)/.test(head)) score -= 2;
  if (lower.length < 600) score -= 2;
  const isBank =
    /interest earned/.test(lower) && /interest expended/.test(lower);
  const isNbfc = !isBank && /impairment on financial instruments/.test(lower);
  const consolidatedHead = /consolidated/.test(head);
  const standaloneHead = /standalone/.test(head);
  let basis: ResultsBasis | null = null;
  if (consolidatedHead && !standaloneHead) basis = "consolidated";
  else if (standaloneHead && !consolidatedHead) basis = "standalone";
  else if (consolidatedHead && standaloneHead) {
    // "(Consolidated and Standalone)" in the cover letter — use the body rows
    basis =
      /(non-controlling|minority interest|attributable to owners|share of profit)/.test(
        lower,
      )
        ? "consolidated"
        : "standalone";
  } else if (
    /(non-controlling|minority interest|attributable to owners of)/.test(lower)
  )
    basis = "consolidated";
  return {
    page,
    text,
    lower,
    score,
    basis,
    variant: isBank ? "bank" : isNbfc ? "nbfc" : "corporate",
  };
}

// ---------------------------------------------------------------------------
// Row parsing
// ---------------------------------------------------------------------------

interface RowSpec {
  key: string;
  re: RegExp;
  /** when several lines match, prefer the earliest unless `preferLast` */
  priority?: number;
}

const PREFIX = String.raw`^\s*(?:\(?[ivxa-z0-9]{1,4}[).:]?\s+)?(?:[-–•]\s*)?`;
const PL = String.raw`(?:net\s+)?(?:profit|loss)\s*(?:\/|\(|and|or)?\s*\(?(?:loss|profit)?\)?`;

const CORP_ROWS: RowSpec[] = [
  {
    key: "revenue",
    re: new RegExp(
      `${PREFIX}(?:total\\s+)?(?:revenue from operations?|income from operations|net sales|sales\\s*/\\s*income from operations|revenue \\(net\\))`,
      "i",
    ),
  },
  { key: "otherIncome", re: new RegExp(`${PREFIX}other income`, "i") },
  { key: "income", re: new RegExp(`${PREFIX}total income`, "i") },
  { key: "financeCosts", re: new RegExp(`${PREFIX}finance costs?`, "i") },
  { key: "dna", re: new RegExp(`${PREFIX}depreciation`, "i") },
  {
    key: "impairment",
    re: new RegExp(`${PREFIX}impairment on financial instruments`, "i"),
  },
  { key: "expenses", re: new RegExp(`${PREFIX}total expenses`, "i") },
  {
    key: "pbeit",
    re: new RegExp(
      `${PREFIX}${PL}[^\\n]{0,60}before[^\\n]{0,30}exceptional`,
      "i",
    ),
    priority: 2,
  },
  {
    key: "pbeitAssoc",
    re: new RegExp(`${PREFIX}${PL}[^\\n]{0,40}before share of`, "i"),
    priority: 1,
  },
  {
    key: "assoc",
    re: new RegExp(`${PREFIX}share of (?:net\\s+)?(?:profit|loss)`, "i"),
  },
  { key: "exceptional", re: new RegExp(`${PREFIX}exceptional items?`, "i") },
  {
    key: "pbt",
    re: new RegExp(`${PREFIX}${PL}[^\\n]{0,30}before tax\\b`, "i"),
  },
  { key: "taxTotal", re: new RegExp(`${PREFIX}total tax expenses?`, "i") },
  { key: "tax", re: new RegExp(`${PREFIX}(?:income\\s+)?tax expenses?`, "i") },
  { key: "currentTax", re: new RegExp(`${PREFIX}current tax`, "i") },
  { key: "deferredTax", re: new RegExp(`${PREFIX}deferred tax`, "i") },
  {
    key: "patAfterAssoc",
    re: new RegExp(`${PREFIX}${PL}[^\\n]{0,20}after tax and share of`, "i"),
  },
  {
    key: "pat",
    re: new RegExp(
      `${PREFIX}${PL}[^\\n]{0,20}(?:for the (?:period|quarter|year)|after tax)(?![^\\n]{0,12}and share of)`,
      "i",
    ),
  },
  {
    key: "patOwners",
    re: new RegExp(
      `${PREFIX}(?:${PL}[^\\n]{0,40})?(?:attributable to\\s+)?owners of the (?:company|parent)`,
      "i",
    ),
  },
];

const BANK_ROWS: RowSpec[] = [
  { key: "revenue", re: new RegExp(`${PREFIX}interest earned`, "i") },
  { key: "otherIncome", re: new RegExp(`${PREFIX}other income`, "i") },
  { key: "income", re: new RegExp(`${PREFIX}total income`, "i") },
  { key: "financeCosts", re: new RegExp(`${PREFIX}interest expended`, "i") },
  { key: "opex", re: new RegExp(`${PREFIX}operating expenses`, "i") },
  { key: "expenditure", re: new RegExp(`${PREFIX}total expenditure`, "i") },
  {
    key: "ppop",
    re: new RegExp(`${PREFIX}operating profit before provisions`, "i"),
  },
  {
    key: "provisions",
    re: new RegExp(
      `${PREFIX}provisions[^\\n]{0,30}(?:other than tax|contingencies)`,
      "i",
    ),
  },
  { key: "exceptional", re: new RegExp(`${PREFIX}exceptional items?`, "i") },
  { key: "pbt", re: new RegExp(`${PREFIX}${PL}[^\\n]{0,60}before tax`, "i") },
  { key: "tax", re: new RegExp(`${PREFIX}tax expenses?`, "i") },
  {
    key: "patOrdinary",
    re: new RegExp(`${PREFIX}net profit[^\\n]{0,40}after tax`, "i"),
  },
  {
    key: "patBeforeMinority",
    re: new RegExp(`${PREFIX}net profit[^\\n]{0,30}before minority`, "i"),
  },
  {
    key: "minority",
    re: new RegExp(`${PREFIX}(?:less\\s*:?\\s*)?minority interest`, "i"),
  },
  {
    key: "pat",
    re: new RegExp(
      `${PREFIX}(?:consolidated\\s+)?net profit[^\\n]{0,30}for the (?:period|quarter|year)(?![^\\n]{0,20}before minority)`,
      "i",
    ),
  },
];

/** Strip label cross-references "(1)+(2)", "(7)-(8)-(9)", "(Refer note 12)", "(a)+(b)" from a line remainder. */
function stripRefs(s: string): string {
  return s
    .replace(/\((?:refer|see|note)[^)]*\)/gi, " ")
    .replace(
      /\((?:[ivx]{1,4}|[a-z]|[0-9]{1,2})\)(?:\s*[+\-–]\s*\((?:[ivx]{1,4}|[a-z]|[0-9]{1,2})\))*/gi,
      " ",
    )
    .replace(/\[[^\]]{1,12}\]/g, " ")
    .replace(/\((?:net of[^)]*|face value[^)]*|not annuali[sz]ed)\)/gi, " ");
}

function isLabelLine(line: string): boolean {
  const letters = (line.match(/[A-Za-z]/g) ?? []).length;
  return letters >= 6 && !/^\s*[-–—\d(),.\s%OIl]+$/.test(line);
}

interface ParsedRow {
  key: string;
  values: Array<number | null>;
  line: number;
}

/**
 * Parse rows by label. For each spec take the first matching line; numbers come
 * from the remainder of that line and, when short, from following non-label lines.
 */
export function parseRows(
  pageText: string,
  specs: RowSpec[],
  ncolsHint?: number,
): { rows: ParsedRow[]; ncols: number } {
  const lines = pageText.split(/\r?\n/);
  const found = new Map<string, ParsedRow>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    for (const spec of specs) {
      const m = spec.re.exec(line);
      if (!m) continue;
      const existing = found.get(spec.key);
      if (existing && (spec.priority ?? 0) <= 0) continue;
      if (existing && existing.line < i && (spec.priority ?? 0) > 0) continue;
      let remainder = stripRefs(line.slice(m[0].length));
      // the label may continue in words before the numbers: drop leading words
      remainder = remainder.replace(/^[^\d(\-–—{[]*?(?=[\d(\-–—{[]|$)/, "");
      let values = numericTokens(remainder);
      let j = i + 1;
      const want = ncolsHint ?? 6;
      while (values.length < want && j < lines.length && j <= i + 3) {
        const next = lines[j] ?? "";
        if (isLabelLine(next) && !/^[\s\d.,()\-–—%OIl]+$/.test(next)) {
          if (/\d/.test(next) && values.length === 0) break;
          if (!/\d/.test(next)) {
            j++;
            continue;
          }
          break;
        }
        values = values.concat(numericTokens(stripRefs(next)));
        j++;
      }
      found.set(spec.key, { key: spec.key, values, line: i });
    }
  }
  const rows = [...found.values()];
  const counts = rows
    .filter((r) =>
      [
        "revenue",
        "income",
        "pbt",
        "pat",
        "tax",
        "financeCosts",
        "expenses",
        "ppop",
      ].includes(r.key),
    )
    .map((r) => r.values.length)
    .filter((n) => n >= 3 && n <= 7);
  const mode = counts.length
    ? (counts.sort(
        (a, b) =>
          counts.filter((v) => v === b).length -
            counts.filter((v) => v === a).length || b - a,
      )[0] ?? 0)
    : 0;
  return { rows, ncols: ncolsHint ?? mode };
}

// ---------------------------------------------------------------------------
// Statement → quarters with identity checks
// ---------------------------------------------------------------------------

interface ColumnCheck {
  identities: Record<string, boolean>;
  warnings: string[];
  repaired: string[];
  /** share of associates/JV is presented above PBT (printed PBT includes it) */
  assocAbovePbt?: boolean;
}

/**
 * Printed statements are exact to the last printed digit, so identities must
 * hold within ±1.5 printed units (rounding of up to three terms) — far tighter
 * than the XBRL path's 0.5 %. A single-digit OCR error is ≥ 10 units and fails.
 */
export function pdfTolerance(multiplier: number): number {
  return 1.5 * multiplier;
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function val(col: Record<string, number | null>, k: string): number | null {
  const v = col[k];
  return v === undefined ? null : v;
}

function checkCorporateColumn(
  col: Record<string, number | null>,
  allowRepair: boolean,
  tol: number,
): ColumnCheck {
  const res: ColumnCheck = { identities: {}, warnings: [], repaired: [] };
  const run = () => {
    res.identities = {};
    const rev = val(col, "revenue");
    const oi = val(col, "otherIncome");
    const inc = val(col, "income");
    const exp = val(col, "expenses");
    const pbeit = val(col, "pbeit") ?? val(col, "pbeitAssoc");
    const exc = val(col, "exceptional") ?? 0;
    const pbt = val(col, "pbt");
    if (
      val(col, "taxTotal") === null &&
      val(col, "tax") === null &&
      val(col, "currentTax") !== null &&
      val(col, "deferredTax") !== null
    )
      col.tax = (val(col, "currentTax") ?? 0) + (val(col, "deferredTax") ?? 0);
    const tax = val(col, "taxTotal") ?? val(col, "tax");
    const pat = val(col, "pat");
    const patAfterAssoc = val(col, "patAfterAssoc");
    const assoc = val(col, "assoc") ?? 0;
    if (patAfterAssoc !== null && pat !== null && val(col, "assoc") !== null)
      res.identities.pat_total_eq_pat_plus_assoc = near(
        patAfterAssoc,
        pat + assoc,
        tol,
      );
    if (rev !== null && oi !== null && inc !== null)
      res.identities.income_eq_rev_plus_oi = near(inc, rev + oi, tol);
    if (inc !== null && exp !== null && pbeit !== null)
      res.identities.pbeit_eq_income_minus_expenses =
        near(pbeit, inc - exp, tol) || near(pbeit, inc - exp + assoc, tol);
    if (pbeit !== null && pbt !== null) {
      res.identities.pbt_eq_pbeit_plus_exceptional =
        near(pbt, pbeit + exc, tol) || near(pbt, pbeit + exc + assoc, tol);
      res.assocAbovePbt =
        assoc !== 0 &&
        !near(pbt, pbeit + exc, tol) &&
        near(pbt, pbeit + exc + assoc, tol);
    } else if (inc !== null && exp !== null && pbt !== null) {
      res.identities.pbt_eq_income_minus_expenses_plus_exc =
        near(pbt, inc - exp + exc, tol) ||
        near(pbt, inc - exp + exc + assoc, tol);
      res.assocAbovePbt =
        assoc !== 0 &&
        !near(pbt, inc - exp + exc, tol) &&
        near(pbt, inc - exp + exc + assoc, tol);
    }
    if (pbt !== null && tax !== null && pat !== null)
      res.identities.pat_eq_pbt_minus_tax =
        near(pat, pbt - tax, tol) || near(pat, pbt - tax + assoc, tol);
  };
  run();
  if (allowRepair)
    repairOnce(col, res, run, tol, [
      [
        "pat",
        (c) =>
          val(c, "pbt") !== null &&
          (val(c, "taxTotal") ?? val(c, "tax")) !== null
            ? (val(c, "pbt") ?? 0) - (val(c, "taxTotal") ?? val(c, "tax") ?? 0)
            : null,
      ],
      [
        "pbt",
        (c) =>
          val(c, "pbeit") !== null
            ? (val(c, "pbeit") ?? 0) + (val(c, "exceptional") ?? 0)
            : null,
      ],
      [
        "income",
        (c) =>
          val(c, "revenue") !== null && val(c, "otherIncome") !== null
            ? (val(c, "revenue") ?? 0) + (val(c, "otherIncome") ?? 0)
            : null,
      ],
      [
        "tax",
        (c) =>
          val(c, "pbt") !== null && val(c, "pat") !== null
            ? (val(c, "pbt") ?? 0) - (val(c, "pat") ?? 0)
            : null,
      ],
    ]);
  return res;
}

function checkBankColumn(
  col: Record<string, number | null>,
  allowRepair: boolean,
  tol: number,
): ColumnCheck {
  const res: ColumnCheck = { identities: {}, warnings: [], repaired: [] };
  const run = () => {
    res.identities = {};
    const ie = val(col, "revenue");
    const oi = val(col, "otherIncome");
    const inc = val(col, "income");
    const ix = val(col, "financeCosts");
    const opex = val(col, "opex");
    const expd = val(col, "expenditure");
    const ppop = val(col, "ppop");
    const prov = val(col, "provisions");
    const exc = val(col, "exceptional") ?? 0;
    const pbt = val(col, "pbt");
    const tax = val(col, "tax");
    const pat =
      val(col, "patOrdinary") ??
      val(col, "patBeforeMinority") ??
      val(col, "pat");
    const patPeriod = val(col, "pat");
    const minority = val(col, "minority");
    if (ie !== null && oi !== null && inc !== null)
      res.identities.income_eq_interest_plus_oi = near(inc, ie + oi, tol);
    if (expd !== null && ix !== null && opex !== null)
      res.identities.expenditure_eq_intexp_plus_opex = near(
        expd,
        ix + opex,
        tol,
      );
    if (ppop !== null && inc !== null && ix !== null && opex !== null)
      res.identities.ppop_eq_income_minus_expenditure = near(
        ppop,
        inc - ix - opex,
        tol,
      );
    if (pbt !== null && ppop !== null && prov !== null)
      res.identities.pbt_eq_ppop_minus_prov_plus_exc =
        near(pbt, ppop - prov + exc, tol) || near(pbt, ppop - prov - exc, tol);
    if (pbt !== null && tax !== null && pat !== null)
      res.identities.pat_eq_pbt_minus_tax = near(pat, pbt - tax, tol);
    // net profit for the period = profit after tax − minority interest (standalone: identical rows)
    if (patPeriod !== null && pat !== null && patPeriod !== pat)
      res.identities.pat_period_eq_after_tax_minus_minority = near(
        patPeriod,
        pat - (minority ?? 0),
        tol,
      );
  };
  run();
  if (allowRepair)
    repairOnce(col, res, run, tol, [
      [
        "pat",
        (c) => {
          // after-tax row when present, else PBT − tax (the only PAT row in many standalone statements)
          const afterTax =
            val(c, "patOrdinary") ??
            val(c, "patBeforeMinority") ??
            (val(c, "pbt") !== null && val(c, "tax") !== null
              ? (val(c, "pbt") ?? 0) - (val(c, "tax") ?? 0)
              : null);
          return afterTax === null
            ? null
            : afterTax - (val(c, "minority") ?? 0);
        },
      ],
      [
        "patOrdinary",
        (c) =>
          val(c, "pbt") !== null && val(c, "tax") !== null
            ? (val(c, "pbt") ?? 0) - (val(c, "tax") ?? 0)
            : null,
      ],
      [
        "pbt",
        (c) =>
          val(c, "ppop") !== null && val(c, "provisions") !== null
            ? (val(c, "ppop") ?? 0) -
              (val(c, "provisions") ?? 0) -
              (val(c, "exceptional") ?? 0)
            : null,
      ],
      [
        "income",
        (c) =>
          val(c, "revenue") !== null && val(c, "otherIncome") !== null
            ? (val(c, "revenue") ?? 0) + (val(c, "otherIncome") ?? 0)
            : null,
      ],
      [
        "ppop",
        (c) =>
          val(c, "income") !== null &&
          val(c, "financeCosts") !== null &&
          val(c, "opex") !== null
            ? (val(c, "income") ?? 0) -
              (val(c, "financeCosts") ?? 0) -
              (val(c, "opex") ?? 0)
            : null,
      ],
    ]);
  return res;
}

/**
 * Repair OCR-broken rows from identities. Structural rows (total income, PBT,
 * operating profit…) are replaced only when the derived value reduces the number
 * of failing identities without creating a new failure; one leaf row (PAT / tax)
 * may then be derived when it is the only remaining failure. At most three
 * repairs; every identity must hold at the end or the column is rejected.
 */
const TWIN_ROWS: Record<string, string[]> = {
  patOrdinary: ["pat", "patBeforeMinority"],
  patBeforeMinority: ["patOrdinary", "pat"],
  pat: ["patOrdinary", "patBeforeMinority"],
  tax: ["taxTotal"],
  taxTotal: ["tax"],
};

function repairOnce(
  col: Record<string, number | null>,
  res: ColumnCheck,
  run: () => void,
  tol: number,
  candidates: Array<
    [string, (c: Record<string, number | null>) => number | null]
  >,
): void {
  const failing = () =>
    Object.values(res.identities).filter((ok) => !ok).length;
  const leafKeys = new Set(["pat", "patOrdinary", "tax", "taxTotal"]);
  let leafUsed = false;
  for (let round = 0; round < 3 && failing() > 0; round++) {
    let progressed = false;
    for (const [key, derive] of candidates) {
      if (!(key in col)) continue;
      const isLeaf = leafKeys.has(key);
      if (isLeaf && (leafUsed || failing() !== 1)) continue;
      const original = col[key] ?? null;
      const derived = derive(col);
      if (
        derived === null ||
        (original !== null && near(original, derived, tol))
      )
        continue;
      const before = failing();
      // rows that merely repeat this row (standalone "net profit for the period" = "after tax") follow it
      const twins = Object.keys(col).filter(
        (k) =>
          k !== key &&
          original !== null &&
          col[k] === original &&
          TWIN_ROWS[key]?.includes(k),
      );
      col[key] = derived;
      for (const k of twins) col[k] = derived;
      run();
      const after = failing();
      if (after < before) {
        res.repaired.push(key);
        res.warnings.push(
          `${key} repaired from identities: ${fmtCr(original)} → ${fmtCr(derived)} cr`,
        );
        if (isLeaf) leafUsed = true;
        progressed = true;
        break;
      }
      col[key] = original;
      for (const k of twins) col[k] = original;
      run();
    }
    if (!progressed) break;
  }
  run();
}

function fmtCr(v: number | null): string {
  return v === null ? "—" : (v / 1e7).toFixed(2);
}

function columnToQuarter(
  st: PdfStatement,
  colIdx: number,
  periodEnd: string,
  check: ColumnCheck,
  ctx: PdfExtractContext,
  confidence: number,
  method: "text" | "llm",
): ResultsQuarter {
  const col = st.columns[colIdx] ?? {};
  const v = (k: string) => val(col, k);
  const isBank = st.variant === "bank";
  const pbeit = isBank
    ? v("pbt") !== null
      ? (v("pbt") ?? 0) - (v("exceptional") ?? 0)
      : null
    : (v("pbeit") ?? v("pbeitAssoc"));
  const tax = isBank ? v("tax") : (v("taxTotal") ?? v("tax"));
  const pat = isBank
    ? (v("pat") ?? v("patOrdinary"))
    : (v("patAfterAssoc") ?? v("pat"));
  const checks: ResultsQuarter["checks"] = {
    warnings: [...st.warnings, ...check.warnings],
    identities: check.identities,
    variant: st.variant,
    income: v("income") ?? undefined,
    expenses: isBank ? undefined : (v("expenses") ?? undefined),
    opex: isBank ? (v("opex") ?? undefined) : undefined,
    provisions: isBank ? (v("provisions") ?? undefined) : undefined,
    impairment:
      st.variant === "nbfc" ? (v("impairment") ?? undefined) : undefined,
    assocShare: isBank ? undefined : (v("assoc") ?? undefined),
    assocAbovePbt: check.assocAbovePbt || undefined,
    patOwners: (isBank ? v("pat") : v("patOwners")) ?? undefined,
    nci: isBank ? (v("minority") ?? undefined) : undefined,
    pdf: {
      confidence,
      unit: st.unit,
      page: st.page,
      columns: st.columnEnds.map((e) => e ?? "?"),
      method,
    },
  };
  if (isBank && v("revenue") !== null && v("financeCosts") !== null)
    checks.nii = (v("revenue") ?? 0) - (v("financeCosts") ?? 0);
  if (isBank && v("ppop") !== null) checks.ppop = v("ppop") ?? undefined;
  if (st.variant === "nbfc" && pbeit !== null && v("impairment") !== null)
    checks.ppop = pbeit + (v("impairment") ?? 0);
  return {
    isin: ctx.isin,
    periodEnd,
    basis: st.basis,
    source: "pdf",
    audited: null,
    revenue: v("revenue"),
    otherIncome: v("otherIncome"),
    financeCosts: v("financeCosts"),
    dna: isBank ? null : v("dna"),
    pbeit,
    exceptional: v("exceptional"),
    pbt: v("pbt"),
    tax,
    pat: isBank ? (v("pat") ?? v("patOrdinary")) : pat,
    patCont: isBank
      ? v("patOrdinary")
      : v("patAfterAssoc") !== null
        ? v("pat")
        : null,
    eps: null,
    checks,
    sourceUrl: ctx.sourceUrl,
    filedAt: ctx.filedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Text pipeline
// ---------------------------------------------------------------------------

interface PositionedItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
}

/**
 * Rebuild visual lines from positioned text items: cluster by y (PDF origin is
 * bottom-left, so sort descending), order by x, join with spaces. This keeps a
 * table row on one line even when the text layer emits the columns in blocks
 * (Reliance's filings) or the OCR layer wraps labels.
 */
export function linesFromItems(items: PositionedItem[]): string[] {
  const toks = items
    .filter((i) => i.str.trim().length > 0)
    .map((i) => ({ x: i.x, y: i.y, s: i.str.trim(), f: i.fontSize || 10 }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; f: number; items: typeof toks }> = [];
  for (const t of toks) {
    const cur = lines[lines.length - 1];
    const tol = Math.max(2.5, 0.4 * Math.min(cur?.f ?? t.f, t.f));
    if (cur && Math.abs(cur.y - t.y) <= tol) {
      cur.items.push(t);
      cur.y = (cur.y * (cur.items.length - 1) + t.y) / cur.items.length;
    } else lines.push({ y: t.y, f: t.f, items: [t] });
  }
  return lines.map((l) =>
    l.items
      .sort((a, b) => a.x - b.x)
      .map((i) => i.s)
      .join(" "),
  );
}

export async function pdfPagesText(bytes: Uint8Array): Promise<string[]> {
  const { extractText, extractTextItems, getDocumentProxy } = await import(
    "unpdf"
  );
  // pdf.js transfers (detaches) the buffer it is given — hand it a copy so callers can reuse `bytes`
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const { items } = await extractTextItems(pdf);
    const pages = items.map((pageItems) =>
      linesFromItems(pageItems).join("\n"),
    );
    if (pages.some((p) => p.trim().length > 0)) return pages;
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "extractTextItems failed; falling back to extractText",
    );
  }
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

/** Pure: page texts → statements (one per basis) with parsed columns; no checks yet. */
export function parseStatements(
  pages: string[],
  ctx: Pick<PdfExtractContext, "periodEnd">,
): { statements: PdfStatement[]; reasons: string[] } {
  const reasons: string[] = [];
  const infos = pages
    .map((t, i) => scorePage(i + 1, t))
    .filter((p) => p.score >= 4);
  if (infos.length === 0)
    return {
      statements: [],
      reasons: ["no page looks like the Reg. 33 results statement"],
    };
  const statements: PdfStatement[] = [];
  const seenBasis = new Set<ResultsBasis>();
  const docMentionsConsolidated = pages.some((t) =>
    /consolidated/i.test(t.slice(0, 900)),
  );
  for (const p of infos.sort((a, b) => b.score - a.score || a.page - b.page)) {
    // an unlabelled statement is standalone only when the whole filing never says "consolidated"
    const basis = p.basis ?? (docMentionsConsolidated ? null : "standalone");
    if (!basis) {
      reasons.push(
        `page ${p.page}: statement basis not identifiable — skipped`,
      );
      continue;
    }
    if (seenBasis.has(basis)) continue;
    const warnings: string[] = [];
    const header = p.text.slice(0, 1200);
    const unit = detectUnit(header) ?? detectUnit(p.text.slice(0, 2500));
    if (!unit) {
      reasons.push(
        `page ${p.page}: units not found in the header — refusing to guess`,
      );
      continue;
    }
    const specs = p.variant === "bank" ? BANK_ROWS : CORP_ROWS;
    const { rows, ncols } = parseRows(p.text, specs);
    if (!ncols || ncols < 3) {
      reasons.push(
        `page ${p.page}: could not determine the column count (rows: ${rows.map((r) => `${r.key}:${r.values.length}`).join(" ")})`,
      );
      continue;
    }
    const columns: Array<Record<string, number | null>> = Array.from(
      { length: ncols },
      () => ({}),
    );
    for (const r of rows) {
      if (r.values.length === ncols) {
        r.values.forEach((v, i) => {
          (columns[i] as Record<string, number | null>)[r.key] =
            v === null ? null : v * UNIT_MULTIPLIER[unit];
        });
      } else if (
        r.values.length > ncols &&
        ["pat", "pbt", "revenue", "income"].includes(r.key)
      ) {
        warnings.push(
          `${r.key} row had ${r.values.length} tokens for ${ncols} columns — first ${ncols} used`,
        );
        r.values.slice(0, ncols).forEach((v, i) => {
          (columns[i] as Record<string, number | null>)[r.key] =
            v === null ? null : v * UNIT_MULTIPLIER[unit];
        });
      } else if (r.values.length > 0) {
        warnings.push(
          `${r.key} row had ${r.values.length} tokens for ${ncols} columns — ignored`,
        );
      }
    }
    // period end: caller → title → header dates
    const headerDates = extractDates(header).filter(isQuarterEnd);
    let current = ctx.periodEnd ?? null;
    if (!current) {
      const title = /ended\s+([^\n]{4,40})/i.exec(p.text.slice(0, 700));
      const fromTitle = title
        ? extractDates(title[0]).filter(isQuarterEnd)
        : [];
      current = fromTitle[0] ?? headerDates[0] ?? null;
    }
    if (!current) {
      reasons.push(`page ${p.page}: quarter end not found (pass periodEnd)`);
      continue;
    }
    const columnEnds: Array<string | null> = Array.from(
      { length: ncols },
      () => null,
    );
    columnEnds[0] = current;
    columnEnds[1] = shiftQuarterEnd(current, -1);
    columnEnds[2] = shiftQuarterEnd(current, -4);
    if (
      headerDates.length >= 3 &&
      (headerDates[0] !== current || headerDates[2] !== columnEnds[2])
    )
      warnings.push(
        `header dates ${headerDates.slice(0, 3).join(", ")} disagree with the SEBI column order — SEBI order used`,
      );
    statements.push({
      page: p.page,
      basis,
      variant: p.variant,
      unit,
      multiplier: UNIT_MULTIPLIER[unit],
      columnEnds,
      columns,
      headerDates,
      warnings,
    });
    seenBasis.add(basis);
  }
  return { statements, reasons };
}

/** Pure: statements → verified quarters. */
export function verifyStatements(
  statements: PdfStatement[],
  ctx: PdfExtractContext,
  method: "text" | "llm",
): PdfResultsExtraction {
  const quarters: ResultsQuarter[] = [];
  const comparatives: ResultsQuarter[] = [];
  const reasons: string[] = [];
  let worst = 1;
  for (const st of statements) {
    const checker =
      st.variant === "bank" ? checkBankColumn : checkCorporateColumn;
    const colChecks = st.columns.map((c, i) =>
      checker(c, i <= 2, pdfTolerance(st.multiplier)),
    );
    const cur = colChecks[0];
    const curCol = st.columns[0] ?? {};
    const required =
      st.variant === "bank"
        ? ["revenue", "pbt", "pat"]
        : ["revenue", "pbt", "pat"];
    const missing = required.filter(
      (k) =>
        val(curCol, k) === null &&
        !(
          st.variant === "bank" &&
          k === "pat" &&
          val(curCol, "patOrdinary") !== null
        ),
    );
    if (missing.length) {
      reasons.push(
        `page ${st.page} (${st.basis}): missing rows ${missing.join(", ")}`,
      );
      continue;
    }
    const idents = Object.entries(cur?.identities ?? {});
    if (idents.length < 2) {
      reasons.push(
        `page ${st.page} (${st.basis}): too few identities computable (${idents.length})`,
      );
      continue;
    }
    const failed = idents.filter(([, ok]) => !ok).map(([k]) => k);
    if (failed.length) {
      reasons.push(
        `page ${st.page} (${st.basis}): identities failed for the current quarter — ${failed.join(", ")}`,
      );
      continue;
    }
    let confidence =
      1 -
      0.15 * (cur?.repaired.length ?? 0) -
      (st.warnings.some((w) => /header dates/.test(w)) ? 0.1 : 0) -
      0.05 * st.warnings.filter((w) => /ignored|first/.test(w)).length;
    confidence = Math.max(0.3, Math.round(confidence * 100) / 100);
    worst = Math.min(worst, confidence);
    quarters.push(
      columnToQuarter(
        st,
        0,
        st.columnEnds[0] ?? "",
        cur as ColumnCheck,
        ctx,
        confidence,
        method,
      ),
    );
    for (const i of [1, 2]) {
      const chk = colChecks[i];
      const end = st.columnEnds[i];
      if (!chk || !end) continue;
      const ok =
        Object.values(chk.identities).length >= 2 &&
        Object.values(chk.identities).every(Boolean);
      if (ok)
        comparatives.push(
          columnToQuarter(
            st,
            i,
            end,
            chk,
            ctx,
            Math.max(0.3, confidence - 0.15 * chk.repaired.length),
            method,
          ),
        );
      else
        reasons.push(
          `page ${st.page} (${st.basis}): comparative column ${i} (${end}) failed its checks — dropped`,
        );
    }
  }
  return {
    quarters,
    comparatives,
    statements,
    confidence: quarters.length ? worst : 0,
    method,
    pages: 0,
    reasons,
  };
}

/**
 * Main entry: PDF bytes (or a URL) → verified preliminary quarters, or null
 * when nothing passes. Never emits unverified numbers.
 */
export async function extractResultsFromPdf(
  input: Uint8Array | string,
  ctx: PdfExtractContext,
): Promise<PdfResultsExtraction | null> {
  const bytes = typeof input === "string" ? await fetchPdf(input) : input;
  const pages = await pdfPagesText(bytes);
  const { statements, reasons } = parseStatements(pages, ctx);
  const picked = pickBasis(statements, ctx.preferBasis);
  let result = verifyStatements(picked, ctx, "text");
  result.pages = pages.length;
  result.reasons = [...reasons, ...result.reasons];
  if (result.quarters.length === 0 && ctx.allowLlm) {
    const llm = await llmFallback(bytes, pages, statements, ctx);
    if (llm) {
      llm.pages = pages.length;
      llm.reasons = [...result.reasons, ...llm.reasons];
      result = llm;
    }
  }
  if (result.quarters.length === 0) {
    log.warn(
      { url: ctx.sourceUrl, reasons: result.reasons },
      "pdf extraction rejected",
    );
    return null;
  }
  log.info(
    {
      url: ctx.sourceUrl,
      quarters: result.quarters.length,
      comparatives: result.comparatives.length,
      confidence: result.confidence,
      method: result.method,
    },
    "pdf extraction ok",
  );
  return result;
}

function pickBasis(
  statements: PdfStatement[],
  prefer?: ResultsBasis,
): PdfStatement[] {
  if (statements.length <= 1) return statements;
  const bank = statements.some((s) => s.variant === "bank");
  const want = prefer ?? (bank ? "standalone" : "consolidated");
  return [...statements].sort((a, b) =>
    a.basis === want ? -1 : b.basis === want ? 1 : 0,
  );
}

async function fetchPdf(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      Accept: "application/pdf,*/*",
    },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Optional Gemini fallback (flagged; bulk tier; same checks)
// ---------------------------------------------------------------------------

const LlmItem = z.enum([
  "revenue",
  "otherIncome",
  "income",
  "expenses",
  "financeCosts",
  "dna",
  "impairment",
  "pbeit",
  "exceptional",
  "pbt",
  "tax",
  "pat",
  "patOwners",
  "opex",
  "expenditure",
  "ppop",
  "provisions",
  "patOrdinary",
  "minority",
]);

const LlmSchema = z.object({
  statementType: z.enum(["consolidated", "standalone"]),
  isBank: z.boolean(),
  unit: z.enum(["crore", "lakh", "million", "thousand"]),
  page: z.number().int(),
  columns: z.array(
    z.object({
      header: z.string(),
      periodEnd: z.string().nullable(),
      periodType: z.enum(["quarter", "ytd", "year"]),
    }),
  ),
  rows: z.array(
    z.object({
      item: LlmItem,
      label: z.string(),
      values: z.array(z.number().nullable()),
    }),
  ),
});

/**
 * Force the Gemini path (bulk tier, one call): used by the CLI/UI "AI-read"
 * badge experiment and by extractResultsFromPdf when the text path fails and
 * `allowLlm` is set. The output still has to pass every identity check.
 */
export async function extractResultsWithLlm(
  bytes: Uint8Array,
  ctx: PdfExtractContext,
): Promise<PdfResultsExtraction | null> {
  const pages = await pdfPagesText(bytes);
  const { statements } = parseStatements(pages, ctx);
  const res = await llmFallback(bytes, pages, statements, ctx);
  if (res) res.pages = pages.length;
  return res;
}

async function llmFallback(
  bytes: Uint8Array,
  pages: string[],
  statements: PdfStatement[],
  ctx: PdfExtractContext,
): Promise<PdfResultsExtraction | null> {
  const candidatePages = statements.length
    ? statements.map((s) => s.page)
    : pages
        .map((t, i) => scorePage(i + 1, t))
        .filter((p) => p.score >= 3)
        .map((p) => p.page);
  if (candidatePages.length === 0) return null;
  const want =
    ctx.preferBasis ??
    (statements.some((s) => s.variant === "bank")
      ? "standalone"
      : "consolidated");
  try {
    const { data } = await callStructured({
      task: "results_pdf_fallback",
      tier: "bulk",
      schema: LlmSchema,
      promptVersion: "1",
      prompt: [
        `This PDF is an Indian listed company's SEBI Regulation 33 quarterly financial results filing.`,
        `Read ONLY the ${want} statement of profit and loss, which is on page ${candidatePages.join(" or ")}.`,
        `Return every column in the table's left-to-right order with its header text, the period end as YYYY-MM-DD when printed, and whether it is a quarter, year-to-date or full-year column.`,
        `Return the rows listed in the schema's item enum using the exact numbers printed (negatives for amounts in brackets, null for dashes). Do not compute or round. Report the unit printed in the header.`,
      ].join("\n"),
      parts: [
        {
          kind: "pdf",
          bytes,
          label: `${ctx.isin} results PDF p${candidatePages.join(",")}`,
          resolution: "low",
        },
      ],
      maxTokens: 3000,
    });
    const mult = UNIT_MULTIPLIER[data.unit];
    const ncols = data.columns.length;
    const columns: Array<Record<string, number | null>> = Array.from(
      { length: ncols },
      () => ({}),
    );
    for (const r of data.rows) {
      r.values.slice(0, ncols).forEach((v, i) => {
        (columns[i] as Record<string, number | null>)[r.item] =
          v === null ? null : v * mult;
      });
    }
    const quarterCols = data.columns
      .map((c, i) => ({ ...c, i }))
      .filter((c) => c.periodType === "quarter");
    const current = ctx.periodEnd ?? quarterCols[0]?.periodEnd ?? null;
    if (!current) return null;
    // SEBI column order is fixed; the model's header reading is a plausibility check only
    const columnEnds: Array<string | null> = data.columns.map(
      (c) => c.periodEnd,
    );
    const modelEnds = columnEnds.slice(0, 3);
    columnEnds[0] = current;
    columnEnds[1] = shiftQuarterEnd(current, -1);
    columnEnds[2] = shiftQuarterEnd(current, -4);
    const disagreement = modelEnds.some(
      (e, i) => e !== null && e !== columnEnds[i],
    );
    const st: PdfStatement = {
      page: data.page,
      basis: data.statementType,
      variant: data.isBank
        ? "bank"
        : data.rows.some((r) => r.item === "impairment")
          ? "nbfc"
          : "corporate",
      unit: data.unit,
      multiplier: mult,
      columnEnds,
      columns,
      headerDates: data.columns.map((c) => c.periodEnd ?? "?"),
      warnings: [
        "numbers read by Gemini from the PDF pages (text path failed); verified by identities",
        ...(disagreement
          ? [
              "model's column dates disagreed with the SEBI column order — SEBI order used",
            ]
          : []),
      ],
    };
    return verifyStatements([st], ctx, "llm");
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "llm fallback failed",
    );
    return null;
  }
}
