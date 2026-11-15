/**
 * Pull menu for /c/[symbol]. Eight readings from the brief, each one a
 * number or a sentence that is either computed from `results_quarters` or
 * copied from a `document_pages` row and checked with `verifyQuote`.
 * No model calls.
 */

import { verifyQuote } from "@/engine/llm/verify";
import { formatBp, formatCrore, formatPct, quarterLabel } from "@/lib/format";

export const NOT_IN_FILINGS = "not in the filings";

export const PULL_TITLES = [
  "Business snapshot",
  "Financial snapshot",
  "Trajectory",
  "Balance sheet",
  "Cash quality",
  "Narrative vs. numbers",
  "Guidance",
  "Bull vs. bear",
] as const;

export type PullTitle = (typeof PULL_TITLES)[number];

export interface PullCite {
  label: string;
  href: string | null;
  /** Verbatim page text. Absent for an XBRL row. */
  quote?: string;
}

export interface PullTable {
  headers: string[];
  rows: string[][];
}

export interface PullBlock {
  title: PullTitle;
  verdict: string;
  lines: string[];
  table?: PullTable;
  cites: PullCite[];
}

export interface PullPage {
  page: number;
  text: string;
}

export interface PullQuarter {
  periodEnd: string;
  basis: "consolidated" | "standalone";
  source: string;
  sourceUrl: string | null;
  revenue: number | null;
  ebitda: number | null;
  pat: number | null;
  nii: number | null;
  ppop: number | null;
}

export interface PullGuide {
  metric: string;
  low: number | null;
  high: number | null;
  unit: string | null;
  horizon: string | null;
  status: string;
  verdict?: string | null;
  page: number | null;
  quote: string;
  url: string | null;
  docKind: string;
  period: string | null;
}

export interface PullInput {
  isBank: boolean;
  hasTranscript: boolean;
  period: string | null;
  reportUrl: string | null;
  pages: PullPage[];
  /** Business description and segment pages. Not used for ratios. */
  profilePages?: PullPage[];
  quarters: PullQuarter[];
  guidance: PullGuide[];
}

type Basis = "consolidated" | "standalone" | "printed";
type MoneyKey = "revenue" | "total_income" | "pat" | "pat_cont";

interface NumTok {
  raw: string;
  value: number;
  percent: boolean;
}

interface MoneyFact {
  key: MoneyKey;
  basis: Basis;
  unit: string | null;
  now: number;
  prev: number;
  nowRaw: string;
  prevRaw: string;
  page: number;
  quote: string;
  statement: boolean;
}

interface RatioFact {
  key: string;
  now: number;
  prev: number | null;
  nowRaw: string;
  prevRaw: string | null;
  page: number;
  quote: string;
  nil: boolean;
  ratioPage: boolean;
}

interface CashFact {
  kind: "net" | "generated";
  basis: Basis;
  unit: string | null;
  now: number;
  prev: number;
  nowRaw: string;
  prevRaw: string;
  page: number;
  quote: string;
  /** Profit after tax printed on the same cash-flow statement. */
  patNow: number | null;
  patRaw: string | null;
}

interface BorrowFact {
  basis: Basis;
  unit: string | null;
  now: number;
  prev: number | null;
  nowRaw: string;
  prevRaw: string | null;
  page: number;
  quote: string;
}

interface KeptSentence {
  page: number;
  quote: string;
  letter: boolean;
}

interface Facts {
  money: MoneyFact[];
  ratios: RatioFact[];
  cash: CashFact[];
  borrowings: BorrowFact[];
  debtNote: KeptSentence | null;
  sentences: KeptSentence[];
}

const NUM_RE =
  /(?<![A-Za-z0-9.])\(?-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\)?%?|(?<![A-Za-z0-9.])\(?-?\d+(?:\.\d+)?\)?%?(?![A-Za-z])/g;

export const HEADLINE_METRICS = [
  "revenue_growth",
  "operating_margin",
  "ebitda_margin",
  "gross_margin",
  "ebit_margin",
  "pbt_margin",
  "capex",
  "volume_growth",
  "pat_growth",
  "revenue",
  "ebitda",
  "ebitda_growth",
  "volume",
  "net_debt",
  "debt_reduction",
  "loan_growth",
  "nim",
  "pat",
] as const;

const METRIC_LABEL: Record<string, string> = {
  revenue_growth: "Revenue growth",
  operating_margin: "Operating margin",
  ebitda_margin: "EBITDA margin",
  gross_margin: "Gross margin",
  ebit_margin: "EBIT margin",
  pbt_margin: "PBT margin",
  capex: "Capex",
  volume_growth: "Volume growth",
  pat_growth: "PAT growth",
  revenue: "Revenue",
  ebitda: "EBITDA",
  ebitda_growth: "EBITDA growth",
  volume: "Volume",
  net_debt: "Net debt",
  debt_reduction: "Debt reduction",
  loan_growth: "Loan growth",
  nim: "NIM",
  pat: "PAT",
};

const RATIO_SPECS: Array<{
  key: string;
  re: RegExp;
  min: number;
  max: number;
}> = [
  { key: "current", re: /current ratio/i, min: 0.05, max: 40 },
  {
    key: "de",
    re: /debt[-\s]?equity ratio|debt to equity|debt-to-equity/i,
    min: -5,
    max: 25,
  },
  {
    key: "op_margin",
    re: /operating (?:profit )?margin/i,
    min: -80,
    max: 90,
  },
  { key: "np_margin", re: /net profit margin/i, min: -80, max: 90 },
  {
    key: "roe",
    re: /return on (?:equity|net worth)/i,
    min: -80,
    max: 200,
  },
  {
    key: "debtors",
    re: /debtors turnover|trade receivables turnover/i,
    min: 0.05,
    max: 2000,
  },
  { key: "inventory", re: /inventory turnover/i, min: 0.05, max: 2000 },
  {
    key: "interest",
    re: /interest (?:service )?coverage|interest coverage/i,
    min: -20,
    max: 5000,
  },
  {
    key: "cost_income",
    re: /cost-to-income ratio|cost to income ratio/i,
    min: 1,
    max: 99,
  },
  {
    key: "roa",
    re: /return on (?:average )?assets/i,
    min: 0.05,
    max: 20,
  },
  { key: "nim", re: /net interest margin/i, min: 0.1, max: 20 },
  { key: "car", re: /capital adequacy ratio/i, min: 1, max: 40 },
];

export function gateQuote(quote: string, source: string): string | null {
  const q = quote.replace(/\s+/g, " ").trim();
  if (q.length < 8) return null;
  return verifyQuote(q, source) == null ? null : q;
}

/** A long verified quote is cut on a word boundary only if the cut still matches. */
export function clipQuote(quote: string, source: string): string | null {
  const full = gateQuote(quote, source);
  if (!full) return null;
  if (full.length <= 420) return full;
  const cut = full.slice(0, 400).replace(/\s+\S*$/, "");
  if (cut.length < 80) return null;
  return gateQuote(cut, source);
}

function tokens(s: string): NumTok[] {
  const out: NumTok[] = [];
  for (const m of s.matchAll(NUM_RE)) {
    const raw = m[0] ?? "";
    const percent = raw.endsWith("%");
    const neg = raw.startsWith("(") || raw.startsWith("-");
    const n = Number(raw.replace(/[(),%\s]/g, ""));
    if (!Number.isFinite(n)) continue;
    out.push({ raw, value: neg ? -Math.abs(n) : n, percent });
  }
  return out;
}

function isYear(t: NumTok): boolean {
  return (
    !t.raw.includes(".") &&
    !t.raw.includes(",") &&
    !t.percent &&
    t.value >= 1990 &&
    t.value <= 2040
  );
}

function isFootnote(t: NumTok): boolean {
  return (
    !t.raw.includes(".") &&
    !t.raw.includes(",") &&
    !t.percent &&
    t.value > 0 &&
    t.value < 15
  );
}

/** Ratio cells are two figures. A leading or trailing 1–14 is a footnote or a serial. */
function tidyRatio(toks: NumTok[]): NumTok[] {
  let xs = toks.filter((t) => !isYear(t));
  // "FY 2024-25" leaves a bare 25 beside a real decimal. Drop those suffixes.
  if (xs.some((t) => t.raw.includes("."))) {
    xs = xs.filter(
      (t) =>
        t.raw.includes(".") ||
        t.raw.includes(",") ||
        t.percent ||
        t.value < 20 ||
        t.value >= 100,
    );
  }
  while (xs.length >= 3 && xs[0] && isFootnote(xs[0])) xs = xs.slice(1);
  const last = xs.at(-1);
  if (xs.length >= 3 && last && isFootnote(last)) xs = xs.slice(0, -1);
  // A trailing percent beside two levels is the variance column.
  if (
    xs.length >= 3 &&
    xs.at(-1)?.percent &&
    xs.filter((t) => !t.percent).length >= 2
  ) {
    xs = xs.filter((t) => !t.percent);
  }
  // A third figure on a ratio row is a variance or a serial, not a third year.
  if (xs.length === 3) xs = xs.slice(0, 2);
  return xs.length === 2 ? xs : [];
}

function cleanNums(toks: NumTok[], mode: "ratio" | "money"): NumTok[] {
  const base = toks.filter((t) => !isYear(t));
  if (mode === "ratio") return tidyRatio(base);
  const moneyish = base.filter(
    (t) =>
      t.raw.includes(".") || t.raw.includes(",") || Math.abs(t.value) >= 100,
  );
  if (moneyish.length >= 2) return moneyish;
  return base;
}

function yoy(now: number, prev: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(prev) || prev === 0)
    return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

function columnOrder(page: string): "sa-first" | "co-first" | null {
  const head = page.slice(0, 1800).toLowerCase();
  const s = head.lastIndexOf("standalone");
  const k = head.lastIndexOf("consolidated");
  if (s < 0 || k < 0 || Math.abs(s - k) > 80) return null;
  return s < k ? "sa-first" : "co-first";
}

function basisOf(page: string): Basis {
  const h = page.slice(0, 500).toLowerCase();
  const co = h.includes("consolidated");
  const sa = h.includes("standalone");
  if (co && !sa) return "consolidated";
  if (sa && !co) return "standalone";
  return "printed";
}

function unitBefore(page: string, index: number): string | null {
  const w = page.slice(Math.max(0, index - 2200), index).toLowerCase();
  const marks: Array<{ re: RegExp; unit: string }> = [
    { re: /(?:rs\.?|in)\s*crores?|` in crore/g, unit: "crore" },
    { re: /(?:rs\.?|in)\s*(?:lakhs?|lacs?)/g, unit: "lakh" },
    { re: /(?:rs\.?|in)\s*millions?/g, unit: "million" },
  ];
  let best: { i: number; unit: string } | null = null;
  for (const m of marks) {
    for (const hit of w.matchAll(m.re)) {
      const i = hit.index ?? 0;
      if (!best || i >= best.i) best = { i, unit: m.unit };
    }
  }
  return best?.unit ?? null;
}

function isStatementPage(text: string): boolean {
  const h = text.slice(0, 700);
  return /balance sheet as at|statement of profit|statement of cash flow|cash flow statement|financial highlights|key financial ratio|profit and loss/i.test(
    h,
  );
}

function isLetterPage(text: string): boolean {
  const h = text.slice(0, 900);
  if (
    /balance sheet as at|statement of cash flow|independent auditor|key financial ratio/i.test(
      h,
    )
  ) {
    return false;
  }
  return /dear shareholders|message from the chairman|letter from the managing director|management discussion|directors' report|director's report|directors report|report of the board of directors|board's report|board’s report/i.test(
    h,
  );
}

function prosePage(text: string): boolean {
  if (
    /balance sheet as at|statement of cash flow|cash flow statement|independent auditor|key financial ratio/i.test(
      text.slice(0, 500),
    )
  ) {
    return false;
  }
  if (isLetterPage(text)) return true;
  return /your company|your directors|dear shareholder|segment revenue|consolidated revenue|private sector bank|scheduled commercial bank|product groups of the company|share in turnover/i.test(
    text.slice(0, 4000),
  );
}

function broken(s: string): boolean {
  return (s.match(/\b[A-Z] [a-z]\b/g)?.length ?? 0) >= 1;
}

function boilerplate(s: string): boolean {
  return /https?:|www\.|e-voting|depository|sexual harassment|whistleblower|regulation \d|pursuant to section|cin:|din:/i.test(
    s,
  );
}

function moneyLabel(line: string): MoneyKey | null {
  const s = line.trim();
  if (s.length > 260) return null;
  if (/comprehensive income|attributable to/i.test(s)) return null;
  if (/discontinued/i.test(s) && !/continuing/i.test(s)) return null;
  if (
    /profit for the year from continuing|profit after tax from continuing/i.test(
      s,
    )
  )
    return "pat_cont";
  if (
    /^(?:[IVXLC]+\s+|\d+[.)]\s*|\([ivx]+\)\s*)?profit for the year\b/i.test(s)
  )
    return "pat";
  if (
    /^(?:[IVXLC]+\s+|\d+[.)]\s*|\([ivx]+\)\s*)?profit after tax(?:ation)?\b/i.test(
      s,
    )
  )
    return "pat";
  if (/revenue from operations/i.test(s)) return "revenue";
  if (/^(?:[IVXLC]+\s+|\d+[.)]\s*|\([ivx]+\)\s*)?total income\b/i.test(s))
    return "total_income";
  return null;
}

function pushMoney(
  into: MoneyFact[],
  fact: Omit<MoneyFact, "quote"> & { quote: string | null },
): void {
  if (!fact.quote) return;
  if (fact.now === 0 && fact.prev === 0) return;
  const dup = into.some(
    (m) => m.key === fact.key && m.basis === fact.basis && m.page === fact.page,
  );
  if (dup) return;
  into.push({ ...fact, quote: fact.quote });
}

function extractMoneyLine(
  page: PullPage,
  line: string,
  into: MoneyFact[],
): void {
  const key = moneyLabel(line);
  if (!key) return;
  const nums = cleanNums(tokens(line), "money");
  if (nums.length !== 2 && nums.length !== 4) return;
  const quote = gateQuote(line, page.text);
  const unit = unitBefore(
    page.text,
    Math.max(0, page.text.indexOf(line.slice(0, 24))),
  );
  const statement =
    isStatementPage(page.text) ||
    /financial highlights|particulars/i.test(page.text.slice(0, 800));
  const order = columnOrder(page.text);
  if (order && nums.length >= 4 && nums[0] && nums[1] && nums[2] && nums[3]) {
    const first = order === "sa-first" ? "standalone" : "consolidated";
    const second = order === "sa-first" ? "consolidated" : "standalone";
    pushMoney(into, {
      key,
      basis: first,
      unit,
      now: nums[0].value,
      prev: nums[1].value,
      nowRaw: nums[0].raw,
      prevRaw: nums[1].raw,
      page: page.page,
      quote,
      statement,
    });
    pushMoney(into, {
      key,
      basis: second,
      unit,
      now: nums[2].value,
      prev: nums[3].value,
      nowRaw: nums[2].raw,
      prevRaw: nums[3].raw,
      page: page.page,
      quote,
      statement,
    });
    return;
  }
  if (nums.length >= 2 && nums[0] && nums[1]) {
    pushMoney(into, {
      key,
      basis: basisOf(page.text),
      unit,
      now: nums[0].value,
      prev: nums[1].value,
      nowRaw: nums[0].raw,
      prevRaw: nums[1].raw,
      page: page.page,
      quote,
      statement,
    });
  }
}

const PROSE_PAIR =
  /(revenue from operations|operating income|total income|profit after tax|net profit after tax|consolidated net profit after tax|profit after tax stood at)[^.]{0,160}?([\d,]+(?:\.\d+)?)\s*(crores?|million|lakhs?|lacs?)[^.]{0,140}?(?:compared to|against|previous year)[^.]{0,50}?([\d,]+(?:\.\d+)?)/gi;

function proseKey(label: string): MoneyKey | null {
  const s = label.toLowerCase();
  if (s.includes("revenue from operations")) return "revenue";
  if (s.includes("operating income") || s.includes("total income"))
    return "total_income";
  if (s.includes("profit")) return "pat";
  return null;
}

function unitWord(w: string): string | null {
  const s = w.toLowerCase();
  if (s.startsWith("crore")) return "crore";
  if (s.startsWith("million")) return "million";
  if (s.startsWith("lakh") || s.startsWith("lac")) return "lakh";
  return null;
}

function extractProseMoney(page: PullPage, into: MoneyFact[]): void {
  if (!prosePage(page.text)) return;
  const flat = page.text.replace(/\s+/g, " ");
  for (const m of flat.matchAll(PROSE_PAIR)) {
    const key = proseKey(m[1] ?? "");
    const nowRaw = m[2] ?? "";
    const prevRaw = m[4] ?? "";
    const now = Number(nowRaw.replace(/,/g, ""));
    const prev = Number(prevRaw.replace(/,/g, ""));
    if (!key || !Number.isFinite(now) || !Number.isFinite(prev) || prev === 0)
      continue;
    const start = m.index ?? 0;
    const sentence = sentenceAt(flat, start);
    const quote = sentence ? gateQuote(sentence, page.text) : null;
    const basis: Basis = /consolidated/i.test(m[0] ?? "")
      ? "consolidated"
      : /standalone/i.test(m[0] ?? "")
        ? "standalone"
        : "printed";
    pushMoney(into, {
      key,
      basis,
      unit: unitWord(m[3] ?? ""),
      now,
      prev,
      nowRaw,
      prevRaw,
      page: page.page,
      quote,
      statement: false,
    });
  }
}

function sentenceAt(flat: string, index: number): string | null {
  const before = flat.slice(0, index);
  const start = Math.max(before.lastIndexOf(". ") + 2, 0);
  const rest = flat.slice(start);
  const endDot = rest.indexOf(". ");
  const sentence = (endDot >= 0 ? rest.slice(0, endDot + 1) : rest).trim();
  if (sentence.length < 40 || sentence.length > 460) return null;
  return sentence;
}

const NEXT_RATIO =
  /\b(?:current ratio|debt[-\s]?equity|operating (?:profit )?margin|net profit margin|return on (?:equity|net worth|average assets|assets)|debtors turnover|trade receivables turnover|inventory turnover|interest (?:service )?coverage|interest coverage|cost-to-income|cost to income|capital adequacy|net interest margin|gross npa|net npa)\b/i;

function cutAtNextRatio(rest: string): string {
  const m = NEXT_RATIO.exec(rest);
  if (!m || m.index <= 0) return rest;
  return rest.slice(0, m.index);
}

function isNilRest(rest: string): boolean {
  const core = rest
    .replace(/times/gi, "")
    .replace(/[()%]/g, "")
    .replace(/\b\d{1,2}\b/g, "")
    .trim();
  return /[–—-]/.test(rest) && /^[\s–—-]*$/.test(core);
}

function extractRatios(page: PullPage, into: RatioFact[]): void {
  const lines = page.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const own = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    const line =
      tidyRatio(tokens(own).filter((t) => !isYear(t))).length === 2 ||
      NEXT_RATIO.test(next)
        ? own
        : [own, next].filter(Boolean).join(" ");
    if (/not relevant|negligible debt|virtually debt-free/i.test(line))
      continue;
    const onRatioPage =
      /financial ratio|additional regulatory|ratio analysis/i.test(page.text);
    for (const spec of RATIO_SPECS) {
      const held = into.findIndex((r) => r.key === spec.key);
      if (held >= 0 && (into[held]?.ratioPage || !onRatioPage)) continue;
      if (held >= 0) into.splice(held, 1);
      const m = spec.re.exec(line);
      if (!m) continue;
      const rest = cutAtNextRatio(line.slice(m.index + m[0].length));
      const rawNums = tokens(rest)
        .filter((t) => !isYear(t))
        .filter((t) => t.value >= spec.min && t.value <= spec.max);
      let nums = tidyRatio(rawNums);
      let nil = false;
      if (nums.length !== 2 && spec.key === "de" && isNilRest(rest)) {
        nums = [
          { raw: "—", value: 0, percent: false },
          { raw: "—", value: 0, percent: false },
        ];
        nil = true;
      }
      if (nums.length !== 2 && rawNums.length === 1 && rawNums[0]) {
        nums = rawNums;
      }
      if ((nums.length !== 1 && nums.length !== 2) || !nums[0]) continue;
      const fromAt = rest.toLowerCase().indexOf(" from ");
      const toAt = rest.toLowerCase().indexOf(" to ");
      if (fromAt >= 0 && toAt > fromAt && nums[0] && nums[1]) {
        nums = [nums[1], nums[0]];
      }
      const snippet = `${m[0]}${rest}`.replace(/\s+/g, " ").trim();
      const quote = gateQuote(snippet, page.text) ?? gateQuote(line, page.text);
      if (!quote) continue;
      const prev = nums[1];
      into.push({
        key: spec.key,
        now: nums[0].value,
        prev: prev?.value ?? null,
        nowRaw: nums[0].raw,
        prevRaw: prev?.raw ?? null,
        page: page.page,
        quote,
        nil,
        ratioPage: onRatioPage,
      });
    }
  }
}

function extractCash(page: PullPage, into: CashFact[]): void {
  const head = page.text.slice(0, 500);
  if (/[‘'’`]\s*000/.test(head) && !/crore/i.test(head)) return;
  const flat = page.text.replace(/\s+/g, " ");
  const specs: Array<{ kind: "net" | "generated"; re: RegExp }> = [
    {
      kind: "net",
      re: /net cash(?:\s+flows?)?(?:\s+generated)?\s+from(?:\s*\/\s*\(\s*used\s*\))?(?:\s+in)?\s+operating activities(?:\s*\(\s*[A-Z]\s*\))?[^0-9(]{0,24}(\(?[\d,]+(?:\.\d+)?\)?)\s+(\(?[\d,]+(?:\.\d+)?\)?)/i,
    },
    {
      kind: "generated",
      re: /cash generated from operations[^0-9(]{0,16}(\(?[\d,]+(?:\.\d+)?\)?)\s+(\(?[\d,]+(?:\.\d+)?\)?)/i,
    },
  ];
  for (const spec of specs) {
    const m = spec.re.exec(flat);
    if (!m || !m[1] || !m[2]) continue;
    const a = tokens(m[1])[0];
    const b = tokens(m[2])[0];
    if (!a || !b) continue;
    const quote = gateQuote(m[0], page.text);
    if (!quote) continue;
    const idx = page.text.toLowerCase().indexOf(m[1].slice(0, 6).toLowerCase());
    const unit = unitBefore(page.text, idx < 0 ? 0 : idx);
    if (!unit && a.value > 100_000) continue;
    const patM =
      /profit after tax(?:\s+and minority interest)?[^0-9]{0,70}(\(?[\d,]+(?:\.\d+)?\)?)\s+(\(?[\d,]+(?:\.\d+)?\)?)/i.exec(
        flat,
      );
    const patTok = patM?.[1] ? tokens(patM[1])[0] : undefined;
    into.push({
      kind: spec.kind,
      basis: basisOf(page.text),
      unit,
      now: a.value,
      prev: b.value,
      nowRaw: a.raw,
      prevRaw: b.raw,
      page: page.page,
      quote,
      patNow: patTok && unit ? patTok.value : null,
      patRaw: patTok && unit ? patTok.raw : null,
    });
    if (spec.kind === "net") return;
  }
}

function extractBorrowings(page: PullPage, into: BorrowFact[]): void {
  if (!/balance sheet as at/i.test(page.text.slice(0, 800))) return;
  for (const line of page.text.split(/\r?\n/)) {
    if (!/^\s*(?:\([ivx0-9]+\)\s*)?borrowings\b/i.test(line)) continue;
    if (/proceeds|repayment|cost of/i.test(line)) continue;
    const nums = cleanNums(tokens(line), "money");
    if (!nums[0]) continue;
    const quote = gateQuote(line, page.text);
    if (!quote) continue;
    into.push({
      basis: basisOf(page.text),
      unit: unitBefore(
        page.text,
        Math.max(0, page.text.indexOf(line.slice(0, 16))),
      ),
      now: nums[0].value,
      prev: nums[1]?.value ?? null,
      nowRaw: nums[0].raw,
      prevRaw: nums[1]?.raw ?? null,
      page: page.page,
      quote,
    });
  }
}

function extractSentences(page: PullPage, into: KeptSentence[]): void {
  if (!prosePage(page.text)) return;
  const flat = page.text.replace(/\s+/g, " ").trim();
  const parts = flat.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const letter = isLetterPage(page.text);
  for (const part of parts) {
    const quote = gateQuote(part, page.text);
    if (!quote || quote.length < 70 || quote.length > 500) continue;
    if (broken(quote) || boilerplate(quote)) continue;
    if (/\. [a-z]/.test(quote)) continue;
    if (
      /key findings|policy for determination|materiality of events|forms an integral part|reporting approach|about the report/i.test(
        quote,
      )
    )
      continue;
    into.push({ page: page.page, quote, letter });
  }
}

function extractDebtNote(page: PullPage): KeptSentence | null {
  const flat = page.text.replace(/\s+/g, " ");
  const at = flat.search(/debt-free|negligible debt/i);
  if (at < 0) return null;
  const company = flat.lastIndexOf("The Company", at);
  const sentenceStart = flat.lastIndexOf(". ", at) + 2;
  const start =
    company >= 0 && at - company < 90
      ? company
      : Math.max(sentenceStart, at - 60);
  const end = flat.indexOf(".", at);
  const slice = flat.slice(start, end < 0 ? at + 160 : end + 1).trim();
  const quote = gateQuote(slice, page.text);
  if (!quote || quote.length > 320) return null;
  return { page: page.page, quote, letter: prosePage(page.text) };
}

export function extractFacts(pages: PullPage[]): Facts {
  const money: MoneyFact[] = [];
  const ratios: RatioFact[] = [];
  const cash: CashFact[] = [];
  const borrowings: BorrowFact[] = [];
  const sentences: KeptSentence[] = [];
  let debtNote: KeptSentence | null = null;
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/))
      extractMoneyLine(page, line, money);
    extractProseMoney(page, money);
    extractRatios(page, ratios);
    extractCash(page, cash);
    extractBorrowings(page, borrowings);
    extractSentences(page, sentences);
    if (!debtNote) debtNote = extractDebtNote(page);
  }
  return { money, ratios, cash, borrowings, debtNote, sentences };
}

function preferMoney(facts: MoneyFact[], key: MoneyKey): MoneyFact | null {
  const rows = facts.filter((m) => m.key === key);
  const rank = (m: MoneyFact) =>
    (m.statement ? 0 : 4) +
    (m.basis === "consolidated" ? 0 : m.basis === "standalone" ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function citePage(
  period: string | null,
  page: number,
  url: string | null,
  quote?: string,
): PullCite {
  return {
    label: `AR ${period ?? "report"} p.${page}`,
    href: url ? `${url}#page=${page}` : null,
    quote,
  };
}

function cap(basis: Basis): string {
  if (basis === "printed") return "Printed";
  return basis.charAt(0).toUpperCase() + basis.slice(1);
}

function pairText(f: {
  nowRaw: string;
  prevRaw: string;
  unit: string | null;
  now: number;
  prev: number;
}): string {
  const pct = yoy(f.now, f.prev);
  const unit = f.unit ? ` ${f.unit}` : "";
  const ch = pct == null ? "" : ` (${formatPct(pct)})`;
  return `${f.nowRaw}${unit} against ${f.prevRaw}${ch}`;
}

function ratioText(r: RatioFact, name: string): string {
  if (r.nil) return `${name} is printed as a dash for both years`;
  const pctLike = /margin|return|income|adequacy|npa|nim/i.test(name);
  const suffix = (raw: string, value: number) =>
    pctLike && !raw.includes("%") && value >= 1 && value <= 100 ? "%" : "";
  if (r.prev == null || r.prevRaw == null) {
    return `${name} ${r.nowRaw}${suffix(r.nowRaw, r.now)}`;
  }
  const bp =
    pctLike && r.now >= 1 && r.prev >= 1
      ? `, ${formatBp((r.now - r.prev) * 100)}`
      : "";
  return `${name} ${r.nowRaw}${suffix(r.nowRaw, r.now)} against ${r.prevRaw}${suffix(r.prevRaw, r.prev)}${bp}`;
}

function words(s: string, n = 12): string {
  const p = s.split(/\s+/).filter(Boolean);
  return p.length <= n ? s : p.slice(0, n).join(" ");
}

function empty(title: PullTitle): PullBlock {
  return { title, verdict: NOT_IN_FILINGS, lines: [NOT_IN_FILINGS], cites: [] };
}

function scoreSentence(s: KeptSentence): { desc: number; mix: number } {
  const q = s.quote;
  let desc = s.letter ? 1 : 0;
  let mix = 0;
  if (
    /engaged in the business|business of|largest private sector bank|private sector bank|scheduled commercial bank|wholesale banking|retail banking|product groups of|manufactur/i.test(
      q,
    )
  )
    desc += 2;
  if (/largest private sector bank/i.test(q)) desc += 3;
  if (/\d/.test(q) && /segment revenue|revenue from operations|% of/i.test(q))
    mix += 5;
  if (
    /\d/.test(q) &&
    /segment revenue|growth of \d|consolidated revenue grew/i.test(q)
  )
    mix += 3;
  if (boilerplate(q) || broken(q)) return { desc: 0, mix: 0 };
  if ((q.match(/\d/g)?.length ?? 0) > 14) return { desc: 0, mix: 0 };
  return { desc, mix };
}

const SEGMENT_NAMES = [
  "Oil and Gas",
  "Digital Services",
  "O2C",
  "Retail",
  "Others",
  "Unallocable",
  "Total",
];

function inrNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function parseSegmentTurnover(
  page: PullPage,
): { line: string; quote: string; names: string[] } | null {
  const flat = page.text.replace(/\s+/g, " ");
  const at = flat.search(/Segment Revenue/i);
  if (at < 0) return null;
  const valueAt = flat.search(/Value of Sales and Services/i);
  const after = flat.slice(at);
  const extAt = after.search(/External Turnover/i);
  if (valueAt < 0 && (extAt < 0 || extAt > 120)) return null;
  const header = flat.slice(Math.max(0, at - 220), at);
  const found = SEGMENT_NAMES.map((name) => ({
    name,
    i: header.lastIndexOf(name),
  }))
    .filter((row) => row.i >= 0)
    .sort((a, b) => a.i - b.i);
  if (found.length < 4) return null;
  const tail =
    valueAt >= 0
      ? flat
          .slice(valueAt)
          .replace(/^Value of Sales and Services(?:\s*\(Revenue\))?\s*\*?/i, "")
          .trim()
      : after
          .slice(extAt)
          .replace(/^External Turnover/i, "")
          .trim();
  const nums: Array<string | null> = [];
  for (const tok of tail.split(/\s+/)) {
    if (tok === "-" || tok === "–") nums.push(null);
    else if (/^\d{1,3}(?:,\d{2,3})+$/.test(tok) || /^\d+(?:\.\d+)?$/.test(tok))
      nums.push(tok);
    else if (nums.length) break;
    if (nums.length >= found.length) break;
  }
  if (nums.length < found.length) return null;
  const pairs = found.map((row, i) => ({
    name: row.name,
    raw: nums[i] ?? null,
  }));
  const total = pairs.find((row) => row.name === "Total" && row.raw);
  const totalN = total?.raw ? inrNumber(total.raw) : null;
  const parts = pairs
    .filter((row) => row.name !== "Total" && row.raw)
    .map((row) => {
      const n = inrNumber(row.raw ?? "");
      const share =
        totalN && totalN > 0
          ? ` (${formatPct((n / totalN) * 100, { signed: false })} of the printed total, computed)`
          : "";
      return `${row.name} ${row.raw}${share}`;
    });
  if (parts.length < 3) return null;
  const quote = gateQuote(
    flat.slice(Math.max(0, at - 40), at + extAt + 40),
    page.text,
  );
  if (!quote) return null;
  const totalBit = total?.raw ? ` Printed total ${total.raw}.` : "";
  return {
    line: `${valueAt >= 0 ? "Value of sales and services" : "External segment turnover"}, ₹ crore: ${parts.join("; ")}.${totalBit}`,
    quote,
    names: parts.map((part) => part.replace(/\s[\d,].*$/, "")),
  };
}

function parsePercentMix(
  page: PullPage,
): { line: string; quote: string } | null {
  const flat = page.text.replace(/\s+/g, " ");
  const hits: Array<{ name: string; raw: string; pct: number; at: number }> =
    [];
  const re = /(\d{1,2}(?:\.\d+)?)%/g;
  for (const m of flat.matchAll(re)) {
    const raw = m[1] ?? "";
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    const before = flat.slice(Math.max(0, (m.index ?? 0) - 80), m.index).trim();
    const words = before.split(/\s+/);
    const picked: string[] = [];
    for (let i = words.length - 1; i >= 0 && picked.length < 3; i--) {
      const w = words[i] ?? "";
      if (!/^[A-Z][A-Za-z]+$/.test(w)) break;
      picked.unshift(w);
    }
    if (picked.length < 2) continue;
    hits.push({
      name: picked.join(" "),
      raw: `${raw}%`,
      pct,
      at: m.index ?? 0,
    });
  }
  for (let i = 0; i < hits.length; i++) {
    let sum = 0;
    const window: typeof hits = [];
    for (let j = i; j < hits.length && window.length < 6; j++) {
      const row = hits[j];
      if (!row) break;
      if (window.length && row.at - (window.at(-1)?.at ?? row.at) > 80) break;
      sum += row.pct;
      window.push(row);
      if (window.length >= 3 && sum >= 98 && sum <= 102) {
        const slice = flat.slice(
          Math.max(0, (window[0]?.at ?? 0) - 40),
          (window.at(-1)?.at ?? 0) + 4,
        );
        const quote = gateQuote(slice, page.text);
        if (!quote) return null;
        return {
          line: `Turnover mix, as printed: ${window.map((row) => `${row.name} ${row.raw}`).join(", ")}.`,
          quote,
        };
      }
      if (sum > 102) break;
    }
  }
  return null;
}

function readingPages(input: PullInput): PullPage[] {
  return [...input.pages, ...(input.profilePages ?? [])];
}

function businessBlock(input: PullInput, facts: Facts): PullBlock {
  const pages = readingPages(input);
  for (const page of pages) {
    const turnover = parseSegmentTurnover(page);
    if (!turnover) continue;
    const names = turnover.names.slice(0, 5);
    return {
      title: "Business snapshot",
      verdict: words(names.join(", ") || "Segment turnover"),
      lines: [`The printed segments are ${names.join(", ")}.`, turnover.line],
      cites: [
        citePage(input.period, page.page, input.reportUrl, turnover.quote),
      ],
    };
  }
  for (const page of pages) {
    const mix = parsePercentMix(page);
    if (!mix) continue;
    return {
      title: "Business snapshot",
      verdict: words(mix.line.replace("Turnover mix, as printed: ", ""), 8),
      lines: [
        "The turnover share is the revenue mix printed in the annual report.",
        mix.line,
      ],
      cites: [citePage(input.period, page.page, input.reportUrl, mix.quote)],
    };
  }
  const extra: KeptSentence[] = [];
  for (const page of input.profilePages ?? []) extractSentences(page, extra);
  const ranked = [...facts.sentences, ...extra]
    .map((s) => ({ s, ...scoreSentence(s) }))
    .filter((x) => x.desc > 0 || x.mix > 0);
  ranked.sort((a, b) => b.desc - a.desc || b.mix - a.mix);
  const desc = ranked.find((x) => x.desc > 0);
  const mix = [...ranked].sort((a, b) => b.mix - a.mix)[0];
  const picked: KeptSentence[] = [];
  if (desc) picked.push(desc.s);
  if (mix && mix.mix > 0 && mix.s.quote !== desc?.s.quote) picked.push(mix.s);
  if (!input.hasTranscript && picked.length === 0) {
    const letter = facts.sentences.find((s) => s.letter && !broken(s.quote));
    if (letter) picked.push(letter);
  }
  if (!picked.length) return empty("Business snapshot");
  const lines = picked.map((s) => s.quote);
  if (!mix || mix.mix <= 0) {
    lines.push("A segment revenue mix is not in the filings.");
  }
  const lead = desc?.s.quote ?? picked[0]?.quote ?? "";
  const bank = /largest private sector bank/i.exec(lead);
  const verdict = bank
    ? "Largest private sector bank by assets"
    : words(lead, 10);
  return {
    title: "Business snapshot",
    verdict: input.hasTranscript
      ? verdict
      : words(`No concall. ${verdict}`, 12),
    lines,
    cites: picked.map((s) =>
      citePage(input.period, s.page, input.reportUrl, s.quote),
    ),
  };
}

function poolOf(qs: PullQuarter[]): PullQuarter[] {
  const co = qs.filter((q) => q.basis === "consolidated");
  return (co.length ? co : qs)
    .slice()
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

function yearAgo(rows: PullQuarter[], latest: PullQuarter): PullQuarter | null {
  const key = `${Number(latest.periodEnd.slice(0, 4)) - 1}${latest.periodEnd.slice(4)}`;
  return rows.find((r) => r.periodEnd === key) ?? null;
}

function sumPick(
  rows: PullQuarter[],
  pick: (q: PullQuarter) => number | null,
): number | null {
  let s = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v == null) return null;
    s += v;
  }
  return s;
}

function xbrlCite(q: PullQuarter, text: string): PullCite {
  return {
    label: `XBRL ${quarterLabel(q.periodEnd)} ${q.basis}`,
    href: q.sourceUrl,
    quote: text,
  };
}

function moneyRows(
  latest: PullQuarter,
  base: PullQuarter | null,
  isBank: boolean,
): string[][] {
  const cell = (v: number | null) => (v == null ? "—" : formatCrore(v));
  const change = (a: number | null, b: number | null) => {
    const p = a == null || b == null ? null : yoy(a, b);
    return p == null ? "—" : formatPct(p);
  };
  const margin = (q: PullQuarter) =>
    q.revenue && q.ebitda != null ? (q.ebitda / q.revenue) * 100 : null;
  if (isBank) {
    return [
      [
        "NII, ₹ cr",
        cell(latest.nii),
        cell(base?.nii ?? null),
        change(latest.nii, base?.nii ?? null),
      ],
      [
        "PPOP, ₹ cr",
        cell(latest.ppop),
        cell(base?.ppop ?? null),
        change(latest.ppop, base?.ppop ?? null),
      ],
      [
        "PAT, ₹ cr",
        cell(latest.pat),
        cell(base?.pat ?? null),
        change(latest.pat, base?.pat ?? null),
      ],
    ];
  }
  const m1 = margin(latest);
  const m0 = base ? margin(base) : null;
  return [
    [
      "Revenue, ₹ cr",
      cell(latest.revenue),
      cell(base?.revenue ?? null),
      change(latest.revenue, base?.revenue ?? null),
    ],
    [
      "EBITDA, ₹ cr",
      cell(latest.ebitda),
      cell(base?.ebitda ?? null),
      change(latest.ebitda, base?.ebitda ?? null),
    ],
    [
      "EBITDA margin",
      m1 == null ? "—" : formatPct(m1, { signed: false }),
      m0 == null ? "—" : formatPct(m0, { signed: false }),
      m1 == null || m0 == null ? "—" : formatBp((m1 - m0) * 100),
    ],
    [
      "PAT, ₹ cr",
      cell(latest.pat),
      cell(base?.pat ?? null),
      change(latest.pat, base?.pat ?? null),
    ],
  ];
}

function ratioGlance(
  input: PullInput,
  facts: Facts,
): { lines: string[]; cites: PullCite[] } {
  const names: Record<string, string> = {
    roe: "Return on equity",
    roa: "Return on assets",
    nim: "Net interest margin",
    cost_income: "Cost-to-income",
    car: "Capital adequacy",
  };
  const lines: string[] = [];
  const cites: PullCite[] = [];
  for (const key of Object.keys(names)) {
    const ratio = facts.ratios.find((r) => r.key === key);
    if (!ratio) continue;
    lines.push(
      `${ratioText(ratio, names[key] ?? key)} (p.${ratio.page}). Annual report, not the quarter.`,
    );
    cites.push(
      citePage(input.period, ratio.page, input.reportUrl, ratio.quote),
    );
    if (lines.length >= 4) break;
  }
  return { lines, cites };
}

function financialBlock(input: PullInput, facts: Facts): PullBlock {
  const pool = poolOf(input.quarters);
  const latest = pool.at(-1);
  if (
    latest &&
    (input.isBank
      ? latest.nii != null || latest.pat != null
      : latest.revenue != null || latest.pat != null)
  ) {
    const base = yearAgo(pool, latest);
    const rows = moneyRows(latest, base, input.isBank);
    const rev = input.isBank
      ? yoy(latest.nii ?? NaN, base?.nii ?? NaN)
      : yoy(latest.revenue ?? NaN, base?.revenue ?? NaN);
    const pat = yoy(latest.pat ?? NaN, base?.pat ?? NaN);
    const top = input.isBank ? "NII" : "Revenue";
    const glance = ratioGlance(input, facts);
    const verdict = words(
      [
        rev != null && Number.isFinite(rev) ? `${top} ${formatPct(rev)}` : null,
        pat != null && Number.isFinite(pat)
          ? `PAT ${formatPct(pat)}`
          : quarterLabel(latest.periodEnd),
      ]
        .filter(Boolean)
        .join(" · "),
    );
    return {
      title: "Financial snapshot",
      verdict,
      lines: [
        `${quarterLabel(latest.periodEnd)} ${latest.basis}, computed from the exchange quarter${base ? ` against ${quarterLabel(base.periodEnd)}` : ""}. Figures are ₹ crore.`,
        ...glance.lines,
      ],
      table: {
        headers: [
          "",
          quarterLabel(latest.periodEnd),
          base ? quarterLabel(base.periodEnd) : "Year ago",
          "Change",
        ],
        rows,
      },
      cites: [
        xbrlCite(
          latest,
          `${latest.periodEnd} ${latest.basis} ${latest.source}`,
        ),
        ...glance.cites,
      ],
    };
  }
  const revenue =
    preferMoney(facts.money, "revenue") ??
    preferMoney(facts.money, "total_income");
  const pat = preferMoney(facts.money, "pat");
  const cont =
    pat && facts.money.find((m) => m.key === "pat_cont" && m.page === pat.page);
  const op = facts.ratios.find((r) => r.key === "op_margin");
  const np = facts.ratios.find((r) => r.key === "np_margin");
  const glance = ratioGlance(input, facts);
  if (!revenue && !pat && !op && !np && glance.lines.length === 0)
    return empty("Financial snapshot");
  const lines: string[] = [];
  const cites: PullCite[] = [];
  const rows: string[][] = [];
  const add = (label: string, f: MoneyFact) => {
    const pct = yoy(f.now, f.prev);
    rows.push([
      `${label}${f.unit ? `, ${f.unit}` : ""}`,
      f.nowRaw,
      f.prevRaw,
      pct == null ? "—" : formatPct(pct),
      `p.${f.page}`,
    ]);
    cites.push(citePage(input.period, f.page, input.reportUrl, f.quote));
  };
  if (revenue) {
    lines.push(
      `${cap(revenue.basis)} ${revenue.key === "total_income" ? "total income" : "revenue from operations"} is ${pairText(revenue)}.`,
    );
    add(revenue.key === "total_income" ? "Total income" : "Revenue", revenue);
  }
  if (pat) {
    lines.push(`${cap(pat.basis)} profit is ${pairText(pat)}.`);
    add("Profit", pat);
  }
  if (
    cont &&
    pat &&
    yoy(pat.now, pat.prev) != null &&
    yoy(cont.now, cont.prev) != null &&
    (yoy(pat.now, pat.prev) ?? 0) * (yoy(cont.now, cont.prev) ?? 0) < 0
  ) {
    lines.push(`Continuing operations profit is ${pairText(cont)}.`);
    add("Continuing profit", cont);
  }
  if (op) {
    lines.push(`${ratioText(op, "Operating margin")} (p.${op.page}).`);
    cites.push(citePage(input.period, op.page, input.reportUrl, op.quote));
  }
  if (np) {
    lines.push(`${ratioText(np, "Net profit margin")} (p.${np.page}).`);
    cites.push(citePage(input.period, np.page, input.reportUrl, np.quote));
  }
  const verdict = words(
    revenue
      ? `Revenue ${formatPct(yoy(revenue.now, revenue.prev) ?? null)}`
      : pat
        ? `Profit ${formatPct(yoy(pat.now, pat.prev) ?? null)}`
        : op
          ? ratioText(op, "Operating margin")
          : "Annual report",
  );
  return {
    title: "Financial snapshot",
    verdict,
    lines: [
      lines.length
        ? input.quarters.length
          ? lines.join(" ")
          : `No exchange quarter is on record. ${lines.join(" ")}`
        : "Annual-report ratios.",
      ...glance.lines,
    ],
    table: rows.length
      ? { headers: ["", "Later year", "Prior year", "Change", "Page"], rows }
      : undefined,
    cites: [...cites, ...glance.cites],
  };
}

function windowChange(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null) return null;
  return yoy(now, prev);
}

function trajectoryBlock(input: PullInput, facts: Facts): PullBlock {
  const pool = poolOf(input.quarters);
  const latest = pool.at(-1);
  const lines: string[] = [];
  const cites: PullCite[] = [];
  let verdict = "";
  if (latest && pool.length >= 8) {
    const last4 = pool.slice(-4);
    const prev4 = pool.slice(-8, -4);
    const revName = input.isBank ? "NII" : "Revenue";
    const rev = windowChange(
      sumPick(last4, (q) => (input.isBank ? q.nii : q.revenue)),
      sumPick(prev4, (q) => (input.isBank ? q.nii : q.revenue)),
    );
    const pat = windowChange(
      sumPick(last4, (q) => q.pat),
      sumPick(prev4, (q) => q.pat),
    );
    const mNow = input.isBank
      ? null
      : marginOf(
          sumPick(last4, (q) => q.ebitda),
          sumPick(last4, (q) => q.revenue),
        );
    const mPrev = input.isBank
      ? null
      : marginOf(
          sumPick(prev4, (q) => q.ebitda),
          sumPick(prev4, (q) => q.revenue),
        );
    const end = quarterLabel(latest.periodEnd);
    const start = quarterLabel(last4[0]?.periodEnd ?? latest.periodEnd);
    lines.push(
      `Four quarters ${start} to ${end}, ${latest.basis}, against the prior four. ${bits(rev, pat, mNow, mPrev, revName)} Computed from exchange quarters; nothing is interpolated.`,
    );
    cites.push(
      xbrlCite(
        latest,
        `${prev4[0]?.periodEnd ?? ""} to ${latest.periodEnd} ${latest.basis}`,
      ),
    );
    verdict = trajVerdict(rev, pat, mNow, mPrev, revName);
  } else if (latest) {
    const base = yearAgo(pool, latest);
    if (base) {
      const revName = input.isBank ? "NII" : "Revenue";
      const rev = input.isBank
        ? yoy(latest.nii ?? NaN, base.nii ?? NaN)
        : yoy(latest.revenue ?? NaN, base.revenue ?? NaN);
      const pat = yoy(latest.pat ?? NaN, base.pat ?? NaN);
      const mNow = input.isBank
        ? null
        : marginOf(latest.ebitda, latest.revenue);
      const mPrev = input.isBank ? null : marginOf(base.ebitda, base.revenue);
      lines.push(
        `${quarterLabel(latest.periodEnd)} against ${quarterLabel(base.periodEnd)}, ${latest.basis}. ${bits(rev, pat, mNow, mPrev, revName)}`,
      );
      cites.push(xbrlCite(latest, `${latest.periodEnd} vs ${base.periodEnd}`));
      verdict = trajVerdict(rev, pat, mNow, mPrev, revName);
    }
  }
  if (!lines.length) {
    const revenue =
      preferMoney(facts.money, "revenue") ??
      preferMoney(facts.money, "total_income");
    const pat = preferMoney(facts.money, "pat");
    const op = facts.ratios.find((r) => r.key === "op_margin");
    if (!revenue && !pat && !op) return empty("Trajectory");
    const parts: string[] = [];
    if (revenue) {
      parts.push(
        `${revenue.basis} ${revenue.key === "total_income" ? "total income" : "revenue"} ${pairText(revenue)}`,
      );
      cites.push(
        citePage(input.period, revenue.page, input.reportUrl, revenue.quote),
      );
    }
    if (pat) {
      parts.push(`profit ${pairText(pat)}`);
      cites.push(citePage(input.period, pat.page, input.reportUrl, pat.quote));
    }
    if (op) {
      parts.push(ratioText(op, "operating margin"));
      cites.push(citePage(input.period, op.page, input.reportUrl, op.quote));
    }
    lines.push(
      `No multi-year exchange series is on record. The annual report prints ${parts.join("; ")}.`,
    );
    const revP = revenue ? yoy(revenue.now, revenue.prev) : null;
    const patP = pat ? yoy(pat.now, pat.prev) : null;
    const mNow = op?.now ?? null;
    const mPrev = op?.prev ?? null;
    verdict = trajVerdict(revP, patP, mNow, mPrev);
  }
  return {
    title: "Trajectory",
    verdict: words(verdict || "Direction printed in the filings"),
    lines,
    cites,
  };
}

function marginOf(
  ebitda: number | null,
  revenue: number | null,
): number | null {
  if (ebitda == null || revenue == null || revenue === 0) return null;
  return (ebitda / revenue) * 100;
}

function bits(
  rev: number | null,
  pat: number | null,
  mNow: number | null,
  mPrev: number | null,
  revName = "Revenue",
): string {
  const parts: string[] = [];
  if (rev != null && Number.isFinite(rev))
    parts.push(`${revName} ${formatPct(rev)}`);
  if (pat != null && Number.isFinite(pat)) parts.push(`PAT ${formatPct(pat)}`);
  if (mNow != null && mPrev != null)
    parts.push(`EBITDA margin ${formatBp((mNow - mPrev) * 100)}`);
  return parts.length ? `${parts.join(". ")}.` : "";
}

function trajVerdict(
  rev: number | null,
  pat: number | null,
  mNow: number | null,
  mPrev: number | null,
  revName = "Revenue",
): string {
  const up = (n: number | null) => n != null && Number.isFinite(n) && n >= 3;
  const down = (n: number | null) => n != null && Number.isFinite(n) && n <= -3;
  const bp = mNow != null && mPrev != null ? (mNow - mPrev) * 100 : null;
  if (up(rev) && bp != null && bp <= -20)
    return `${revName} growing, margin compressing`;
  if (up(rev) && down(pat)) return `${revName} up, profit down`;
  if (up(rev) && up(pat)) return `${revName} and profit both higher`;
  if (down(rev) && down(pat)) return `${revName} and profit both lower`;
  if (bp != null && bp <= -20) return "Margin compressing";
  if (up(rev)) return `${revName} ${formatPct(rev)}`;
  if (up(pat)) return `Profit ${formatPct(pat)}`;
  return "Direction printed in the filings";
}

function balanceBlock(input: PullInput, facts: Facts): PullBlock {
  const want = [
    "de",
    "current",
    "debtors",
    "inventory",
    "interest",
    "roe",
  ] as const;
  const ratios = want
    .map((k) => facts.ratios.find((r) => r.key === k))
    .filter((r): r is RatioFact => !!r);
  const names: Record<string, string> = {
    de: "Debt-equity",
    current: "Current ratio",
    debtors: "Debtors turnover",
    inventory: "Inventory turnover",
    interest: "Interest coverage",
    roe: "Return on equity",
  };
  const lines: string[] = [];
  const cites: PullCite[] = [];
  for (const r of ratios) {
    lines.push(`${ratioText(r, names[r.key] ?? r.key)} (p.${r.page}).`);
    if ((r.key === "debtors" || r.key === "inventory") && !r.nil && r.now > 0) {
      const days = Math.round((365 / r.now) * 10) / 10;
      const label = r.key === "debtors" ? "Debtor days" : "Inventory days";
      lines.push(
        `${label} ${days}, computed from the printed ${names[r.key]?.toLowerCase() ?? "turnover"} of ${r.nowRaw}.`,
      );
    }
    cites.push(citePage(input.period, r.page, input.reportUrl, r.quote));
  }
  const b = [...facts.borrowings].sort((a, c) => {
    const basis = (x: BorrowFact) => (x.basis === "consolidated" ? 0 : 1);
    return basis(a) - basis(c) || c.now - a.now;
  })[0];
  if (b) {
    const prev = b.prevRaw ? ` against ${b.prevRaw}` : "";
    lines.push(
      `${b.basis} borrowings ${b.nowRaw}${b.unit ? ` ${b.unit}` : ""}${prev} (p.${b.page}).`,
    );
    cites.push(citePage(input.period, b.page, input.reportUrl, b.quote));
  }
  if (facts.debtNote) {
    lines.push(facts.debtNote.quote);
    cites.push(
      citePage(
        input.period,
        facts.debtNote.page,
        input.reportUrl,
        facts.debtNote.quote,
      ),
    );
  }
  if (!lines.length) return empty("Balance sheet");
  const de = facts.ratios.find((r) => r.key === "de");
  const current = facts.ratios.find((r) => r.key === "current");
  const debtWords = facts.debtNote?.quote ?? "";
  const verdict =
    words(
      /negligible debt|debt-free/i.test(debtWords) && (!de || de.nil)
        ? de?.nil
          ? "Debt-equity printed nil"
          : "Debt called negligible"
        : "",
    ) ||
    words(
      [
        de
          ? de.nil
            ? "Debt-equity printed nil"
            : `Debt-equity ${de.nowRaw}`
          : null,
        current ? `current ratio ${current.nowRaw}` : null,
        !de && !current && b ? `Borrowings ${b.nowRaw}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Printed in the annual report",
    );
  const funding = fundingLine(readingPages(input));
  if (funding) {
    lines.push(funding.line);
    cites.push(funding.cite);
  }
  if (ratios.some((r) => r.key === "debtors" || r.key === "inventory")) {
    lines.push(
      "Debtor and inventory days above are computed. The report does not print one working-capital cycle.",
    );
  } else if (input.isBank) {
    lines.push(
      "A working-capital cycle is not printed. A bank is funded by deposits and borrowings, not a trade cycle.",
    );
  }
  return { title: "Balance sheet", verdict, lines, cites };
}

function fundingLine(
  pages: PullPage[],
): { line: string; cite: PullCite } | null {
  for (const page of pages) {
    const flat = page.text.replace(/\s+/g, " ");
    const dep =
      /Total Deposits rose by.{0,90}?to\s+[H₹J]?\s*([\d,]+)\s*crore from\s+[H₹J]?\s*([\d,]+)\s*crore/i.exec(
        flat,
      );
    const adv = /Advances stood at\s+[H₹J]?\s*([\d,]+)\s*crore/i.exec(flat);
    if (dep?.[0] && dep[1] && dep[2]) {
      const quote = gateQuote(dep[0], page.text);
      const advQuote = adv?.[0] ? gateQuote(adv[0], page.text) : null;
      if (quote) {
        const advBit =
          adv?.[1] && advQuote ? `Advances stood at ${adv[1]} crore. ` : "";
        return {
          line: `${advBit}Deposits ${dep[1]} crore against ${dep[2]} crore, as printed. Deposits are the funding.`,
          cite: { label: `p.${page.page}`, href: null, quote },
        };
      }
    }
    const chart =
      /([J₹H]?\d{1,3}(?:,\d{2,3})+)\s*crore\s+ADVANCES\s+([J₹H]?\d{1,3}(?:,\d{2,3})+)\s*crore\s+DEPOSITS/i.exec(
        flat,
      );
    if (!chart?.[0] || !chart[1] || !chart[2]) continue;
    const quote = gateQuote(chart[0], page.text);
    if (!quote) continue;
    const advances = chart[1].replace(/^[J₹H]/, "");
    const deposits = chart[2].replace(/^[J₹H]/, "");
    return {
      line: `Advances ${advances} crore and deposits ${deposits} crore, as printed. Deposits are the funding.`,
      cite: { label: `p.${page.page}`, href: null, quote },
    };
  }
  return null;
}

function cashBlock(input: PullInput, facts: Facts): PullBlock {
  const nets = facts.cash.filter((c) => c.kind === "net");
  const cash =
    nets.find((c) => c.basis === "consolidated") ?? nets[0] ?? facts.cash[0];
  if (!cash) return empty("Cash quality");
  const label =
    cash.kind === "net"
      ? "Net cash from operations"
      : "Cash generated from operations";
  const lines = [
    `${cash.basis} ${label.toLowerCase()} is ${pairText(cash)} (p.${cash.page}).`,
  ];
  const cites = [
    citePage(input.period, cash.page, input.reportUrl, cash.quote),
  ];
  const pat =
    facts.money.find(
      (m) =>
        m.key === "pat" &&
        m.basis === cash.basis &&
        m.unit &&
        m.unit === cash.unit,
    ) ?? null;
  if (cash.patNow != null && cash.patRaw && cash.patNow !== 0) {
    const conv = (cash.now / cash.patNow) * 100;
    const unit = cash.unit ? ` ${cash.unit}` : "";
    lines.push(
      `Against profit after tax of ${cash.patRaw}${unit} on the same statement, that is ${formatPct(conv, { signed: false })} of profit turning into operating cash. Computed from those two printed lines.`,
    );
  } else if (pat && pat.now !== 0) {
    const conv = (cash.now / pat.now) * 100;
    lines.push(
      `Against profit of ${pat.nowRaw} ${pat.unit} on p.${pat.page}, that is ${formatPct(conv, { signed: false })} of profit turning into operating cash. The ratio is computed from those two printed lines.`,
    );
    cites.push(citePage(input.period, pat.page, input.reportUrl, pat.quote));
  } else {
    lines.push("Profit-to-cash conversion is not in the filings.");
  }
  const pct = yoy(cash.now, cash.prev);
  return {
    title: "Cash quality",
    verdict: words(
      pct != null && Number.isFinite(pct)
        ? `Operating cash ${formatPct(pct)}`
        : label,
    ),
    lines,
    cites,
  };
}

function quarterTension(
  input: PullInput,
): { line: string; cite: PullCite } | null {
  const pool = poolOf(input.quarters);
  const latest = pool.at(-1);
  if (!latest || pool.length < 8 || input.isBank) return null;
  const last4 = pool.slice(-4);
  const prev4 = pool.slice(-8, -4);
  const rev = windowChange(
    sumPick(last4, (q) => q.revenue),
    sumPick(prev4, (q) => q.revenue),
  );
  const pat = windowChange(
    sumPick(last4, (q) => q.pat),
    sumPick(prev4, (q) => q.pat),
  );
  const mNow = marginOf(
    sumPick(last4, (q) => q.ebitda),
    sumPick(last4, (q) => q.revenue),
  );
  const mPrev = marginOf(
    sumPick(prev4, (q) => q.ebitda),
    sumPick(prev4, (q) => q.revenue),
  );
  const bp = mNow != null && mPrev != null ? (mNow - mPrev) * 100 : null;
  const split =
    (rev != null && pat != null && rev >= 3 && pat <= -1) ||
    (rev != null && rev >= 3 && bp != null && bp <= -50);
  if (!split || rev == null) return null;
  const parts = [`revenue ${formatPct(rev)}`];
  if (pat != null) parts.push(`PAT ${formatPct(pat)}`);
  if (bp != null) parts.push(`EBITDA margin ${formatBp(bp)}`);
  return {
    line: `Over the last four exchange quarters against the prior four, ${parts.join(", ")}.`,
    cite: xbrlCite(
      latest,
      `${prev4[0]?.periodEnd ?? ""} to ${latest.periodEnd}`,
    ),
  };
}

function narrativeBlock(input: PullInput, facts: Facts): PullBlock {
  const lines: string[] = [];
  const cites: PullCite[] = [];
  const settled = input.guidance.filter(
    (g) =>
      g.verdict === "kept" ||
      g.verdict === "missed" ||
      g.verdict === "beat" ||
      g.verdict === "cut",
  );
  const settledMetric = new Set(settled.map((g) => g.metric));
  for (const g of settled.slice(0, 3)) {
    const name = METRIC_LABEL[g.metric] ?? g.metric.replace(/_/g, " ");
    const horizon = g.horizon ? ` ${g.horizon.replace(/_/g, " ")}` : "";
    lines.push(
      `${name}${horizon} is ${g.verdict} on the promise ledger, promised ${guideBand(g)}. This reading uses that settled comparison.`,
    );
    cites.push({
      label: `${g.docKind === "annual_report" ? "AR" : "Call"}${g.page ? ` p.${g.page}` : ""}`,
      href: g.url && g.page ? `${g.url}#page=${g.page}` : g.url,
      quote: g.quote,
    });
  }
  const de = facts.ratios.find((r) => r.key === "de");
  const debtFree =
    facts.debtNote &&
    /debt-free/i.test(facts.debtNote.quote) &&
    de &&
    !de.nil &&
    de.now >= 0.05
      ? facts.debtNote
      : null;
  if (debtFree && de) {
    lines.push(
      `The report says “${debtFree.quote}” Debt-equity is printed at ${de.nowRaw}${de.prevRaw ? ` against ${de.prevRaw}` : ""} (p.${de.page}).`,
    );
    cites.push(
      citePage(input.period, debtFree.page, input.reportUrl, debtFree.quote),
      citePage(input.period, de.page, input.reportUrl, de.quote),
    );
  }
  const total = preferMoney(facts.money, "pat");
  const cont =
    (total &&
      facts.money.find((m) => m.key === "pat_cont" && m.page === total.page)) ||
    null;
  if (total && cont) {
    const t = yoy(total.now, total.prev);
    const c = yoy(cont.now, cont.prev);
    if (t != null && c != null && t * c < 0) {
      lines.push(
        `${cap(total.basis)} profit for the year is ${pairText(total)}. Profit from continuing operations, on the same page, is ${pairText(cont)}. The two lines move in opposite directions.`,
      );
      cites.push(
        citePage(input.period, total.page, input.reportUrl, total.quote),
        citePage(input.period, cont.page, input.reportUrl, cont.quote),
      );
    }
  }
  const stand = facts.money
    .filter((m) => m.key === "pat" && m.basis === "standalone" && m.statement)
    .sort((a, b) => Number(b.statement) - Number(a.statement))[0];
  const coPat = facts.money
    .filter((m) => m.key === "pat" && m.basis === "consolidated" && m.statement)
    .sort((a, b) => Number(b.statement) - Number(a.statement))[0];
  if (
    stand &&
    coPat &&
    stand.page !== coPat.page &&
    stand.unit &&
    stand.unit === coPat.unit
  ) {
    const scale = stand.now / coPat.now;
    const a = yoy(stand.now, stand.prev);
    const b = yoy(coPat.now, coPat.prev);
    if (a != null && b != null && a * b < 0 && scale > 0.15 && scale < 6) {
      lines.push(
        `${stand.basis} profit is ${pairText(stand)} (p.${stand.page}). Consolidated profit is ${pairText(coPat)} (p.${coPat.page}).`,
      );
      cites.push(
        citePage(input.period, stand.page, input.reportUrl, stand.quote),
        citePage(input.period, coPat.page, input.reportUrl, coPat.quote),
      );
    }
  }
  const income =
    preferMoney(facts.money, "total_income") ??
    preferMoney(facts.money, "revenue");
  const profit = preferMoney(facts.money, "pat");
  const splitByDiscontinued =
    total &&
    cont &&
    (yoy(total.now, total.prev) ?? 0) * (yoy(cont.now, cont.prev) ?? 0) < 0;
  if (
    income &&
    profit &&
    income.unit &&
    income.unit === profit.unit &&
    !splitByDiscontinued
  ) {
    const a = yoy(income.now, income.prev);
    const b = yoy(profit.now, profit.prev);
    if (a != null && b != null && a - b >= 25 && a > 0) {
      lines.push(
        `${income.basis} ${income.key === "total_income" ? "total income" : "revenue"} is ${pairText(income)}. ${profit.basis} profit is ${pairText(profit)}. The top line ran well ahead of profit.`,
      );
      cites.push(
        citePage(input.period, income.page, input.reportUrl, income.quote),
        citePage(input.period, profit.page, input.reportUrl, profit.quote),
      );
    }
  }
  for (const s of facts.sentences) {
    const grew = /grew by\s+([\d.]+)%/i.exec(s.quote);
    const pair =
      /([\d,]+(?:\.\d+)?)\s*crores?\s*\(previous year[^)]*?([\d,]+(?:\.\d+)?)\s*crores?\)/i.exec(
        s.quote,
      );
    if (
      settledMetric.has("revenue") ||
      settledMetric.has("revenue_growth") ||
      settledMetric.has("pat") ||
      settledMetric.has("pat_growth")
    )
      continue;
    if (!grew?.[1] || !pair?.[1] || !pair[2]) continue;
    const stated = Number(grew[1]);
    const now = Number(pair[1].replace(/,/g, ""));
    const prev = Number(pair[2].replace(/,/g, ""));
    const actual = yoy(now, prev);
    if (actual == null || Math.abs(actual - stated) < 1.5) continue;
    lines.push(
      `One sentence states growth of ${stated}% and also prints ${pair[1]} crore against ${pair[2]} crore, which is ${formatPct(actual)}. “${s.quote}”`,
    );
    cites.push(citePage(input.period, s.page, input.reportUrl, s.quote));
    break;
  }
  if (
    !lines.length &&
    facts.debtNote &&
    de?.nil &&
    /debt-free/i.test(facts.debtNote.quote)
  ) {
    lines.push(
      `The report says “${facts.debtNote.quote}” Debt-equity is printed as a dash (p.${de.page}), so the ratio agrees.`,
    );
    cites.push(
      citePage(
        input.period,
        facts.debtNote.page,
        input.reportUrl,
        facts.debtNote.quote,
      ),
      citePage(input.period, de.page, input.reportUrl, de.quote),
    );
  }
  const tension = quarterTension(input);
  if (tension) {
    lines.push(tension.line);
    cites.push(tension.cite);
    const claim = facts.sentences.find(
      (s) =>
        /\b(?:up|grew)\s+\d/i.test(s.quote) &&
        /profit|pat|revenue/i.test(s.quote),
    );
    if (claim) {
      lines.unshift(
        `The report says “${claim.quote}” That full-year sentence is not the last four quarters.`,
      );
      cites.unshift(
        citePage(input.period, claim.page, input.reportUrl, claim.quote),
      );
    } else if (lines.length === 1) {
      lines.push(
        "A management sentence set against that split is not in the filings.",
      );
    }
  }
  if (
    !lines.length &&
    facts.debtNote &&
    /negligible debt/i.test(facts.debtNote.quote)
  ) {
    lines.push(`The report says debt is negligible: “${facts.debtNote.quote}”`);
    cites.push(
      citePage(
        input.period,
        facts.debtNote.page,
        input.reportUrl,
        facts.debtNote.quote,
      ),
    );
  }
  if (!lines.length) {
    if (!input.hasTranscript) {
      const s =
        [...facts.sentences]
          .map((row) => ({ row, ...scoreSentence(row) }))
          .filter((x) => x.desc > 0 || x.mix > 0)
          .sort((a, b) => b.desc + b.mix - (a.desc + a.mix))[0]?.row ??
        facts.sentences.find((x) => x.letter);
      if (s) {
        return {
          title: "Narrative vs. numbers",
          verdict: "Chairman’s words, no divergence printed",
          lines: [
            `The annual report says: “${s.quote}” A divergence between that wording and a printed figure is not in the filings.`,
          ],
          cites: [citePage(input.period, s.page, input.reportUrl, s.quote)],
        };
      }
    }
    return empty("Narrative vs. numbers");
  }
  return {
    title: "Narrative vs. numbers",
    verdict: words(
      lines[0]?.replace(/“[^”]*”/g, "").trim() || "Report and figures disagree",
    ),
    lines: lines.slice(0, 3),
    cites,
  };
}

function guideSubject(g: PullGuide): string {
  const q = g.quote;
  if (/new energy/i.test(q)) return "New energy revenue";
  if (/\bjio\b/i.test(q)) return "Jio growth";
  if (/\bpiping\b/i.test(q)) return "Piping growth";
  return METRIC_LABEL[g.metric] ?? g.metric;
}

function guideBand(g: PullGuide): string {
  if (g.low == null && g.high == null && /high teens?/i.test(g.quote)) {
    return "high teens, in the quote";
  }
  const bp =
    g.unit === "bp" ||
    (g.metric === "nim" && g.unit !== "%" && g.unit !== "INR");
  const pct = !bp && (g.unit === "%" || /margin|growth|roe/.test(g.metric));
  const money = !bp && (g.unit === "INR" || g.unit === "₹");
  const fmt = (n: number) =>
    bp ? `${n} bp` : pct ? `${n}%` : money ? `${formatCrore(n)} cr` : String(n);
  if (g.low == null && g.high == null) return "no figure in the quote";
  if (g.low != null && g.high != null && g.low !== g.high) {
    if (bp) return `${g.low}–${g.high} bp`;
    return `${fmt(g.low).replace(/%$/, "")}–${fmt(g.high)}`;
  }
  return fmt(g.low ?? g.high ?? 0);
}

function guidanceBlock(input: PullInput): PullBlock {
  const rows = input.guidance.filter((g) =>
    (HEADLINE_METRICS as readonly string[]).includes(g.metric),
  );
  if (!rows.length) return empty("Guidance");
  const lines = rows.slice(0, 4).map((g) => {
    const where =
      g.docKind === "annual_report" ? "Annual report" : "Transcript";
    return `${guideSubject(g)}, ${g.horizon ?? "no horizon stated"}, ${guideBand(g)}, ${g.status}. ${where}${g.page ? ` p.${g.page}` : ""}.`;
  });
  const first = rows[0];
  const verdict = words(
    first ? `${guideSubject(first)} ${guideBand(first)}` : "Guidance",
  );
  return {
    title: "Guidance",
    verdict,
    lines,
    cites: rows.slice(0, 4).map((g) => ({
      label: `${g.docKind === "annual_report" ? "AR" : "Call"}${g.period ? ` ${g.period}` : ""}${g.page ? ` p.${g.page}` : ""}`,
      href: g.url && g.page ? `${g.url}#page=${g.page}` : g.url,
      quote: g.quote,
    })),
  };
}

interface CaseLine {
  score: number;
  text: string;
  cites: PullCite[];
}

function cases(
  input: PullInput,
  facts: Facts,
): { bull: CaseLine | null; bear: CaseLine | null } {
  const bulls: CaseLine[] = [];
  const bears: CaseLine[] = [];
  const add = (
    side: "bull" | "bear",
    score: number,
    text: string,
    cites: PullCite[],
  ) => {
    if (score < 8) return;
    (side === "bull" ? bulls : bears).push({ score, text, cites });
  };
  const lineName = input.isBank ? "NII" : "Revenue";
  const pool = poolOf(input.quarters);
  const latest = pool.at(-1);
  if (latest && pool.length >= 8) {
    const last4 = pool.slice(-4);
    const prev4 = pool.slice(-8, -4);
    const rev = windowChange(
      sumPick(last4, (q) => (input.isBank ? q.nii : q.revenue)),
      sumPick(prev4, (q) => (input.isBank ? q.nii : q.revenue)),
    );
    const pat = windowChange(
      sumPick(last4, (q) => q.pat),
      sumPick(prev4, (q) => q.pat),
    );
    const cite = [
      xbrlCite(latest, `${prev4[0]?.periodEnd ?? ""}–${latest.periodEnd}`),
    ];
    if (rev != null && rev >= 3)
      add(
        "bull",
        Math.abs(rev),
        `${lineName} over the last four quarters is ${formatPct(rev)} on the prior four.`,
        cite,
      );
    if (rev != null && rev <= -3)
      add(
        "bear",
        Math.abs(rev),
        `${lineName} over the last four quarters is ${formatPct(rev)} on the prior four.`,
        cite,
      );
    if (pat != null && pat >= 3)
      add(
        "bull",
        Math.abs(pat) + 2,
        `PAT over the last four quarters is ${formatPct(pat)} on the prior four.`,
        cite,
      );
    if (pat != null && pat <= -3)
      add(
        "bear",
        Math.abs(pat) + 2,
        `PAT over the last four quarters is ${formatPct(pat)} on the prior four.`,
        cite,
      );
    const mNow = marginOf(
      sumPick(last4, (q) => q.ebitda),
      sumPick(last4, (q) => q.revenue),
    );
    const mPrev = marginOf(
      sumPick(prev4, (q) => q.ebitda),
      sumPick(prev4, (q) => q.revenue),
    );
    if (mNow != null && mPrev != null) {
      const bp = (mNow - mPrev) * 100;
      if (bp >= 20)
        add(
          "bull",
          Math.abs(bp) / 8,
          `EBITDA margin is ${formatBp(bp)} over those four quarters.`,
          cite,
        );
      if (bp <= -20)
        add(
          "bear",
          Math.abs(bp) / 8,
          `EBITDA margin is ${formatBp(bp)} over those four quarters.`,
          cite,
        );
    }
  } else if (latest) {
    const base = yearAgo(pool, latest);
    if (base) {
      const rev = yoy(
        (input.isBank ? latest.nii : latest.revenue) ?? NaN,
        (input.isBank ? base.nii : base.revenue) ?? NaN,
      );
      const pat = yoy(latest.pat ?? NaN, base.pat ?? NaN);
      const cite = [
        xbrlCite(latest, `${latest.periodEnd} vs ${base.periodEnd}`),
      ];
      if (rev != null && Number.isFinite(rev) && rev >= 3)
        add(
          "bull",
          Math.abs(rev),
          `${quarterLabel(latest.periodEnd)} ${lineName} is ${formatPct(rev)} on ${quarterLabel(base.periodEnd)}.`,
          cite,
        );
      if (rev != null && Number.isFinite(rev) && rev <= -3)
        add(
          "bear",
          Math.abs(rev),
          `${quarterLabel(latest.periodEnd)} ${lineName} is ${formatPct(rev)} on ${quarterLabel(base.periodEnd)}.`,
          cite,
        );
      if (pat != null && Number.isFinite(pat) && pat >= 3)
        add(
          "bull",
          Math.abs(pat) + 2,
          `${quarterLabel(latest.periodEnd)} PAT is ${formatPct(pat)} on ${quarterLabel(base.periodEnd)}.`,
          cite,
        );
      if (pat != null && Number.isFinite(pat) && pat <= -3)
        add(
          "bear",
          Math.abs(pat) + 2,
          `${quarterLabel(latest.periodEnd)} PAT is ${formatPct(pat)} on ${quarterLabel(base.periodEnd)}.`,
          cite,
        );
      const m1 = marginOf(latest.ebitda, latest.revenue);
      const m0 = marginOf(base.ebitda, base.revenue);
      if (m1 != null && m0 != null) {
        const bp = (m1 - m0) * 100;
        if (bp >= 20)
          add(
            "bull",
            Math.abs(bp) / 8,
            `EBITDA margin is ${formatBp(bp)} on the year-ago quarter.`,
            cite,
          );
        if (bp <= -20)
          add(
            "bear",
            Math.abs(bp) / 8,
            `EBITDA margin is ${formatBp(bp)} on the year-ago quarter.`,
            cite,
          );
      }
    }
  }
  const netCash =
    facts.cash.find((c) => c.kind === "net" && c.basis === "consolidated") ??
    facts.cash.find((c) => c.kind === "net");
  if (netCash) {
    const pct = yoy(netCash.now, netCash.prev);
    const cite = [
      citePage(input.period, netCash.page, input.reportUrl, netCash.quote),
    ];
    const unit = netCash.unit ? ` ${netCash.unit}` : "";
    if (pct != null && pct <= -3) {
      add(
        "bear",
        Math.abs(pct),
        `Operating cash is ${formatPct(pct)}, ${netCash.nowRaw}${unit} against ${netCash.prevRaw}.`,
        cite,
      );
    }
  }
  const revenue =
    preferMoney(facts.money, "revenue") ??
    preferMoney(facts.money, "total_income");
  const pat =
    preferMoney(facts.money, "pat_cont") ?? preferMoney(facts.money, "pat");
  const usePat = facts.money.find((m) => m.key === "pat_cont") ?? pat;
  if (!latest || pool.length < 5) {
    if (revenue) {
      const p = yoy(revenue.now, revenue.prev);
      const cite = [
        citePage(input.period, revenue.page, input.reportUrl, revenue.quote),
      ];
      if (p != null && p >= 3)
        add(
          "bull",
          Math.abs(p),
          `Annual-report revenue is ${pairText(revenue)}.`,
          cite,
        );
      if (p != null && p <= -3)
        add(
          "bear",
          Math.abs(p),
          `Annual-report revenue is ${pairText(revenue)}.`,
          cite,
        );
    }
    if (usePat) {
      const p = yoy(usePat.now, usePat.prev);
      const cite = [
        citePage(input.period, usePat.page, input.reportUrl, usePat.quote),
      ];
      if (p != null && p >= 3)
        add(
          "bull",
          Math.abs(p) + 2,
          `Printed profit is ${pairText(usePat)}.`,
          cite,
        );
      if (p != null && p <= -3)
        add(
          "bear",
          Math.abs(p) + 2,
          `Printed profit is ${pairText(usePat)}.`,
          cite,
        );
    }
  }
  const op = facts.ratios.find((r) => r.key === "op_margin");
  if (op && !op.nil && op.prev != null) {
    const bp = (op.now - op.prev) * 100;
    const cite = [citePage(input.period, op.page, input.reportUrl, op.quote)];
    if (bp >= 20)
      add(
        "bull",
        Math.abs(bp) / 8,
        `${ratioText(op, "Operating margin")}.`,
        cite,
      );
    if (bp <= -20)
      add(
        "bear",
        Math.abs(bp) / 8,
        `${ratioText(op, "Operating margin")}.`,
        cite,
      );
  }
  const de = facts.ratios.find((r) => r.key === "de");
  if (de && !de.nil && de.prev != null && de.prevRaw) {
    const cite = [citePage(input.period, de.page, input.reportUrl, de.quote)];
    if (de.prev - de.now >= 0.03)
      add(
        "bull",
        (de.prev - de.now) * 80,
        `Debt-equity eased from ${de.prevRaw} to ${de.nowRaw}.`,
        cite,
      );
    if (de.now - de.prev >= 0.03)
      add(
        "bear",
        (de.now - de.prev) * 80,
        `Debt-equity rose from ${de.prevRaw} to ${de.nowRaw}.`,
        cite,
      );
  }
  const cover = facts.ratios.find((r) => r.key === "interest");
  if (
    cover &&
    cover.prev != null &&
    cover.prev > 0 &&
    (cover.prev - cover.now) / cover.prev >= 0.25
  ) {
    add(
      "bear",
      30,
      `Interest coverage is printed at ${cover.nowRaw} against ${cover.prevRaw}.`,
      [citePage(input.period, cover.page, input.reportUrl, cover.quote)],
    );
  }
  if (
    facts.debtNote &&
    de &&
    /debt-free/i.test(facts.debtNote.quote) &&
    de.now >= 0.05
  ) {
    add(
      "bear",
      60,
      `The MD&A calls the company debt-free while debt-equity is printed at ${de.nowRaw}.`,
      [
        citePage(
          input.period,
          facts.debtNote.page,
          input.reportUrl,
          facts.debtNote.quote,
        ),
        citePage(input.period, de.page, input.reportUrl, de.quote),
      ],
    );
  }
  const current = facts.ratios.find((r) => r.key === "current");
  if (
    current &&
    !current.nil &&
    current.prev != null &&
    current.prev - current.now >= 0.4
  ) {
    add(
      "bear",
      (current.prev - current.now) * 25,
      `Current ratio is printed at ${current.nowRaw} against ${current.prevRaw}.`,
      [citePage(input.period, current.page, input.reportUrl, current.quote)],
    );
  }
  const best = (xs: CaseLine[]) =>
    xs.sort((a, b) => b.score - a.score)[0] ?? null;
  return { bull: best(bulls), bear: best(bears) };
}

function bullBlock(input: PullInput, facts: Facts): PullBlock {
  const { bull, bear } = cases(input, facts);
  if (!bull && !bear) return empty("Bull vs. bear");
  const lines = [
    bull ? `Bull. ${bull.text}` : `Bull. ${NOT_IN_FILINGS}`,
    bear ? `Bear. ${bear.text}` : `Bear. ${NOT_IN_FILINGS}`,
  ];
  return {
    title: "Bull vs. bear",
    verdict: words(
      `${bull ? "Bull has a printed case" : "No bull case"} · ${bear ? "bear has a printed case" : "no bear case"}`,
    ),
    lines,
    cites: [...(bull?.cites ?? []), ...(bear?.cites ?? [])],
  };
}

export function composePull(input: PullInput): PullBlock[] {
  const facts = extractFacts(input.pages);
  const byTitle = new Map<PullTitle, PullBlock>([
    ["Business snapshot", businessBlock(input, facts)],
    ["Financial snapshot", financialBlock(input, facts)],
    ["Trajectory", trajectoryBlock(input, facts)],
    ["Balance sheet", balanceBlock(input, facts)],
    ["Cash quality", cashBlock(input, facts)],
    ["Narrative vs. numbers", narrativeBlock(input, facts)],
    ["Guidance", guidanceBlock(input)],
    ["Bull vs. bear", bullBlock(input, facts)],
  ]);
  return PULL_TITLES.map((title) => byTitle.get(title) ?? empty(title));
}
