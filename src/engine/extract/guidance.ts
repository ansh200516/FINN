/**
 * Guidance extraction (owner: Builder C): transcript → management turns →
 * chunked Flash-Lite calls → code gates → `GuidanceStatement[]` → `guidance` rows.
 *
 * Gates (nothing unverified reaches the DB):
 *   1. verifyQuote(quote, turn text) — exact after normalisation; falls back to
 *      the chunk, then the whole document (fixing the page); else DROPPED.
 *   2. groundNumbers(values, quote) — every explicit number must be literally
 *      in the quote; else DROPPED.
 *   3. adjectival guidance ("high single digit", "mid-twenties") → numeric band
 *      from the table in docs/research/02 §2.3, `isExplicit=false`.
 *   4. horizon → fiscal label + period end (relative terms resolved from the call's period).
 *
 * Speaker and page always come from the parser (turn id), never from the model.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { guidance } from "@/db/schema";
import { callStructured } from "@/engine/llm/gateway";
import {
  extractNumbers,
  groundNumbers,
  verifyQuote,
} from "@/engine/llm/verify";
import { logger } from "@/lib/logger";
import type {
  DocumentText,
  GuidanceDirection,
  GuidanceStatement,
  TranscriptTurn,
} from "../types";
import {
  type FiscalPeriod,
  makePeriod,
  managementTurns,
  type ParsedTranscript,
  parsePeriodLabel,
  parseTranscript,
} from "./transcript";

const log = logger.child({ mod: "engine/extract/guidance" });

export const GUIDANCE_PROMPT_VERSION = "g3";
/** ~6.5k tokens of management speech per call */
export const CHUNK_CHARS = 26_000;

// ---------------------------------------------------------------------------
// Model schema
// ---------------------------------------------------------------------------

export const METRICS = [
  "revenue_growth",
  "revenue",
  "ebitda_margin",
  "ebit_margin",
  "operating_margin",
  "pbt_margin",
  "net_margin",
  "gross_margin",
  "ebitda",
  "ebitda_growth",
  "pat",
  "pat_growth",
  "capex",
  "volume_growth",
  "volume",
  "order_inflow",
  "order_book",
  "net_debt",
  "debt_reduction",
  "capacity",
  "tax_rate",
  "roa",
  "roe",
  "nim",
  "credit_cost",
  "loan_growth",
  "deposit_growth",
  "headcount",
  "pricing",
  "dividend",
  "other",
] as const;
export type GuidanceMetric = (typeof METRICS)[number];

const ModelStatement = z.object({
  turn: z
    .number()
    .int()
    .describe("the T-number of the turn the quote is copied from"),
  quote: z
    .string()
    .describe("8-60 words copied verbatim and contiguously from that turn"),
  metric: z.enum(METRICS),
  direction: z.enum(["increase", "decrease", "maintain", "range", "target"]),
  value_low: z
    .number()
    .nullable()
    .describe("lower bound, only if the number appears literally in the quote"),
  value_high: z
    .number()
    .nullable()
    .describe("upper bound (equal to value_low for a point estimate)"),
  unit: z.enum([
    "pct",
    "bps",
    "inr_cr",
    "inr_mn",
    "inr_bn",
    "inr_lakh",
    "usd_mn",
    "usd_bn",
    "x",
    "units",
    "text",
  ]),
  horizon: z
    .string()
    .describe(
      "'FY27' | 'Q3FY27' | 'H2FY27' | 'FY28' | 'next 2-3 years' | 'medium term' | 'FY30'",
    ),
  comparison: z.enum(["yoy", "qoq", "absolute", "cc", "none"]),
  revision: z.enum(["new", "maintained", "raised", "cut", "withdrawn"]),
  is_explicit: z
    .boolean()
    .describe("true only when the quote states a number for the metric"),
  confidence: z
    .number()
    .describe("0..1 that this is a genuine forward-looking commitment"),
});
const ModelOutput = z.object({ statements: z.array(ModelStatement) });
export type ModelStatementT = z.infer<typeof ModelStatement>;

const SYSTEM = `You extract MANAGEMENT GUIDANCE from an Indian listed company's earnings-call transcript. You receive numbered management turns tagged [T<n> | speaker | p<page>]. Return JSON only.

Include every forward-looking statement by management about a measurable outcome of THIS company: revenue or growth, margins, EBITDA/PAT, capex, volumes, order inflow/book, debt or leverage, capacity additions, tax rate, return ratios (ROA/ROE/NIM), credit cost, loan or deposit growth, headcount, pricing, dividend policy. Qualitative outlooks count ("double-digit growth", "margins should improve", "flat volumes"), as do reiterations ("we maintain our guidance"), revisions ("we are raising... from 20% to mid-twenties") and withdrawals ("we are not giving guidance any more").

Exclude: reported or historical numbers, analyst speech, industry/macro commentary with no company target, and refusals to guide ("we don't give guidance") unless they withdraw an earlier guidance.

Rules:
1. quote: copy VERBATIM and CONTIGUOUS text from ONE turn — same words, same order, same numbers, no ellipses, no corrections — 8 to 60 words, containing the metric and its number or adjective (and the period if present). A program string-matches the quote against the transcript; anything that does not match exactly is discarded.
2. turn: the T-number the quote is copied from.
3. value_low / value_high: only numbers that appear literally in the quote, in the quote's unit (for "13,500 to 14,000 crores" → 13500 / 14000, unit inr_cr; for "about 10%" → 10 / 10, unit pct; for "at least 15%" → 15 / 15). For adjectival guidance ("teens", "high single digit") leave both null and set is_explicit=false. Never infer or convert numbers.
4. horizon: the period the statement is about, as stated or clearly implied — 'FY27', 'Q3FY27', 'H2FY27', 'FY28', 'FY30', 'next 2-3 years', 'medium term', 'long term'. The call discusses {{PERIOD}}; "this year"/"full year"/"current year" → the fiscal year containing {{PERIOD}}; "next quarter" → the following quarter; "second half"/"H2" → H2 of that fiscal year.
5. revision: 'maintained' when the speaker says the guidance is unchanged/reiterated, 'raised'/'cut' when they say it changed versus earlier guidance, 'withdrawn' when they stop guiding a metric, else 'new'.
6. comparison: 'cc' for constant-currency growth, 'yoy' for year-on-year growth, 'qoq' for sequential growth, 'absolute' for margins, amounts, ratios and levels, 'none' otherwise.
7. Prefer the speaker's clearest sentence; one statement per (metric, horizon) per turn; do not duplicate the same commitment across turns unless the wording differs materially.`;

// ---------------------------------------------------------------------------
// Adjective → band (docs/research/02 §2.3)
// ---------------------------------------------------------------------------

export interface Band {
  low: number | null;
  high: number | null;
  phrase: string;
}

const BAND_TABLE: Array<[RegExp, number | null, number | null]> = [
  [/\blow[- ]single[- ]digits?\b/i, 1, 3],
  [/\bmid[- ]single[- ]digits?\b/i, 4, 6],
  [/\bhigh[- ]single[- ]digits?\b/i, 7, 9],
  [/\bsingle[- ]digits?\b/i, 0, 9],
  [/\blow[- ]double[- ]digits?\b/i, 10, 12],
  [/\bdouble[- ]digits?\b/i, 10, null],
  [/\blow[- ]teens?\b/i, 10, 13],
  [/\bmid[- ]teens?\b/i, 14, 16],
  [/\bhigh[- ]teens?\b/i, 17, 19],
  [/\bteens?\b/i, 13, 19],
  [/\b(early|low)[- ](twenties|20s)\b/i, 20, 23],
  [/\bmid[- ](twenties|20s)\b/i, 24, 26],
  [/\b(high|late)[- ](twenties|20s)\b/i, 27, 29],
  [/\b(twenties|20s)\b/i, 20, 29],
  [/\bmid[- ](thirties|30s)\b/i, 34, 36],
  [/\b(thirties|30s)\b/i, 30, 39],
  [
    /\bflat(tish)?\b|\bstable\b|\bmaintain(ed)?\b|\bsimilar (level|to last year)\b|\bin line with (last|previous) year\b/i,
    0,
    0,
  ],
];

/** Map adjectival guidance in a quote to a numeric band (percent). Null when none. */
export function adjectiveBand(quote: string): Band | null {
  for (const [re, low, high] of BAND_TABLE) {
    const m = re.exec(quote);
    if (m) return { low, high, phrase: m[0] };
  }
  return null;
}

const APPROX_RE =
  /\b(about|around|approximately|approx\.?|roughly|circa|close to|nearly|~|in the region of|ballpark)\s*(?:INR|Rs\.?|₹|\$|USD)?\s*[\d,.]+/i;
const FLOOR_RE =
  /\b(at least|minimum of|a minimum|more than|upwards of|north of|over|in excess of|exceed(ing)?|above|not (be )?less than|\+)\s*(?:INR|Rs\.?|₹|\$|USD)?\s*[\d,.]+/i;
const CEILING_RE =
  /\b(up to|not (be )?more than|maximum of|a maximum|below|under|less than|within|capped at|not exceed(ing)?)\s*(?:INR|Rs\.?|₹|\$|USD)?\s*[\d,.]+/i;

/** "about 10%" → ±1pp (percent) / ±2% (absolute); "at least X" → open-ended high; "up to X" → open-ended low. */
export function applyCueWords(
  quote: string,
  low: number | null,
  high: number | null,
  unit: string,
): { low: number | null; high: number | null } {
  if (low === null && high === null) return { low, high };
  if (low !== null && high !== null && low === high) {
    if (FLOOR_RE.test(quote)) return { low, high: null };
    if (CEILING_RE.test(quote)) return { low: null, high };
    if (APPROX_RE.test(quote)) {
      if (unit === "%") return { low: low - 1, high: high + 1 };
      return {
        low: Math.round(low * 0.98 * 1000) / 1000,
        high: Math.round(high * 1.02 * 1000) / 1000,
      };
    }
  }
  return { low, high };
}

// ---------------------------------------------------------------------------
// Horizon parsing
// ---------------------------------------------------------------------------

export interface ParsedHorizon {
  /** 'FY27' | 'Q3FY27' | 'H2FY27' | 'medium_term' | 'long_term' | null */
  label: string | null;
  /** 'YYYY-MM-DD' end of the period; null for open-ended horizons */
  end: string | null;
  period: FiscalPeriod | null;
}

/**
 * The fiscal year a call is HELD in: a Q4FY26 call happens in Apr–Jun 2026,
 * i.e. in FY27, so "this year" on that call means FY27.
 */
export function callFiscalYear(callPeriod: FiscalPeriod): number {
  return callPeriod.kind === "quarter" && callPeriod.n === 4
    ? callPeriod.fy + 1
    : callPeriod.fy;
}

/** Normalise a free-text horizon relative to the call's period (e.g. 'Q2FY27'). */
export function parseHorizon(
  raw: string | null | undefined,
  callPeriod: FiscalPeriod | null,
): ParsedHorizon {
  const none: ParsedHorizon = { label: null, end: null, period: null };
  if (!raw) return none;
  const t = raw.trim().replace(/[’']/g, "").replace(/\s+/g, " ");
  const direct = parsePeriodLabel(t);
  if (direct) return { label: direct.label, end: direct.end, period: direct };
  // "FY 2026-27", "fiscal 2027", "FY2027", "financial year 2027"
  let m =
    /^(?:FY|fiscal(?: year)?|financial year|F\.?Y\.?)\s*((?:\d{4}[-/–]\d{2,4})|\d{4}|\d{2})$/i.exec(
      t,
    );
  if (m) {
    const p = parsePeriodLabel(`FY${m[1]}`);
    if (p) return { label: p.label, end: p.end, period: p };
  }
  // "Q3 of FY27", "3Q FY27", "Q3 FY 27", "third quarter FY27"
  m =
    /^(?:Q\s?([1-4])|([1-4])\s?Q|(first|second|third|fourth) quarter)(?: of)?\s*(?:FY|fiscal)?\s*((?:\d{4}[-/–]\d{2,4})|\d{4}|\d{2})?$/i.exec(
      t,
    );
  if (m) {
    const ord: Record<string, number> = {
      first: 1,
      second: 2,
      third: 3,
      fourth: 4,
    };
    const q = Number(m[1] ?? m[2] ?? ord[(m[3] ?? "").toLowerCase()] ?? 0);
    const fyTok = m[4];
    if (q >= 1 && q <= 4) {
      if (fyTok) {
        const p = parsePeriodLabel(`Q${q}FY${fyTok}`);
        if (p) return { label: p.label, end: p.end, period: p };
      } else if (callPeriod) {
        // bare "Q3" → the next occurrence of that quarter after the call's quarter
        const fy = q > (callPeriod.n ?? 0) ? callPeriod.fy : callPeriod.fy + 1;
        const p = makePeriod("quarter", fy, q);
        return { label: p.label, end: p.end, period: p };
      }
    }
  }
  // "H2 FY27", "second half", "H2", "1H FY27"
  m =
    /^(?:H\s?([12])|([12])\s?H|(first|second) half)(?: of)?\s*(?:FY|fiscal)?\s*((?:\d{4}[-/–]\d{2,4})|\d{4}|\d{2})?$/i.exec(
      t,
    );
  if (m) {
    const h = Number(
      m[1] ?? m[2] ?? (m[3]?.toLowerCase() === "second" ? 2 : 1),
    );
    const fyTok = m[4];
    if (fyTok) {
      const p = parsePeriodLabel(`H${h}FY${fyTok}`);
      if (p) return { label: p.label, end: p.end, period: p };
    } else if (callPeriod) {
      const p = makePeriod("half", callPeriod.fy, h);
      return { label: p.label, end: p.end, period: p };
    }
  }
  if (callPeriod) {
    const fy = callFiscalYear(callPeriod);
    if (
      /^(this|current|the current|full|the full|the|present)\s*(fiscal|financial)?\s*(year|fy)$|^fy$|^full[- ]year$|^current fy$|^this fiscal$/i.test(
        t,
      )
    ) {
      const p = makePeriod("year", fy, null);
      return { label: p.label, end: p.end, period: p };
    }
    if (
      /^(next|the next|coming|following)\s*(fiscal|financial)?\s*(year|fy)$|^next fiscal$/i.test(
        t,
      )
    ) {
      const p = makePeriod("year", fy + 1, null);
      return { label: p.label, end: p.end, period: p };
    }
    if (/^(next|the next|coming|following|this|current) quarter$/i.test(t)) {
      // relative to the quarter being discussed (a Q4FY26 call's "next quarter" is Q1FY27)
      const q = callPeriod.n ?? 1;
      const qfy = callPeriod.fy;
      const p = /^(this|current)/i.test(t)
        ? q === 4
          ? makePeriod("quarter", qfy + 1, 1)
          : makePeriod("quarter", qfy, q + 1)
        : q === 4
          ? makePeriod("quarter", qfy + 1, 1)
          : makePeriod("quarter", qfy, q + 1);
      return { label: p.label, end: p.end, period: p };
    }
    if (
      /^(second half|h2|2h|rest of (the )?(year|fy)|remaining (quarters|year)|balance (of the )?year)$/i.test(
        t,
      )
    ) {
      const p = makePeriod("half", fy, 2);
      return { label: p.label, end: p.end, period: p };
    }
    if (
      /^(exit( rate| quarter)?|by (the )?(end of (the )?)?(year|fy|march)|year[- ]end|march (end|quarter))$/i.test(
        t,
      )
    ) {
      const p = makePeriod("quarter", fy, 4);
      return { label: p.label, end: p.end, period: p };
    }
    if (
      /^(next (few|couple of|2|two|2-3|3) quarters|near[- ]term|short[- ]term|coming quarters)$/i.test(
        t,
      )
    ) {
      const q = callPeriod.n ?? 1;
      const qfy = callPeriod.fy;
      const p =
        q >= 3
          ? makePeriod("quarter", qfy + 1, q - 2)
          : makePeriod("quarter", qfy, q + 2);
      return { label: `near_term`, end: p.end, period: null };
    }
  }
  // "by FY30", "FY30 vision", "by 2030", "by March 2028", "CY2027"
  m = /\bFY\s?((?:\d{4}[-/–]\d{2,4})|\d{4}|\d{2})\b/i.exec(t);
  if (m) {
    const p = parsePeriodLabel(`FY${m[1]}`);
    if (p) return { label: p.label, end: p.end, period: p };
  }
  m =
    /\b(?:by|in|calendar|CY)\s*(?:march|mar|dec(ember)?)?\s*(20\d{2})\b/i.exec(
      t,
    );
  if (m) {
    const y = Number(m[2]);
    // "by 2030" → treat as FY ending March 2030 (Indian usage); "December 2027" → CY end
    if (/dec/i.test(t))
      return {
        label: `CY${String(y).slice(-2)}`,
        end: `${y}-12-31`,
        period: null,
      };
    const p = makePeriod("year", y, null);
    return { label: p.label, end: p.end, period: p };
  }
  if (
    /\b(medium|mid)[- ]term\b|next (2|two|3|three)(-| to |–)?(3|three|4|four|5|five)? years|\b(2|two|3|three) years\b/i.test(
      t,
    )
  )
    return { label: "medium_term", end: null, period: null };
  if (
    /\blong[- ]term\b|\b(5|five|7|seven|10|ten)\s*(-|to)?\s*(years|year)\b|\bdecade\b/i.test(
      t,
    )
  )
    return { label: "long_term", end: null, period: null };
  if (/\b(near|short)[- ]term\b/i.test(t))
    return { label: "near_term", end: null, period: null };
  return { label: t.slice(0, 40), end: null, period: null };
}

const THIS_YEAR_RE =
  /\b(this|the current|current|the present|the)\s+(financial|fiscal)?\s*year\b|\bfull[- ]year\b|\bfor the (full )?year\b|\bthis fiscal\b/i;
const EXPLICIT_FY_RE =
  /\b(?:FY|F\.Y\.|(?:financial|fiscal)\s+year)\s?[’']?((?:\d{4}[-/–]\d{2,4})|\d{4}|\d{2})\b/i;

/**
 * Code guard on the model's horizon:
 *  - an explicit fiscal year in the quote ("financial year 2027", "FY'27") wins;
 *  - "this year" / "full year" without an explicit year is the fiscal year the
 *    call is held in (a Q4FY26 call in April 2026 guides FY27);
 *  - an annual horizon more than one year out with no year or "next/by/over"
 *    cue in the quote is model drift → the call's fiscal year.
 */
export function reconcileHorizon(
  quote: string,
  parsed: ParsedHorizon,
  callPeriod: FiscalPeriod | null,
): ParsedHorizon {
  if (!callPeriod) return parsed;
  const callFy = callFiscalYear(callPeriod);
  const fyTok = EXPLICIT_FY_RE.exec(quote);
  if (fyTok) {
    const p = parsePeriodLabel(`FY${fyTok[1]}`);
    if (
      p &&
      (parsed.period === null || parsed.period.kind === "year") &&
      parsed.period?.fy !== p.fy &&
      !/\b(by|till|until|through)\b/i.test(quote.slice(0, fyTok.index))
    ) {
      return { label: p.label, end: p.end, period: p };
    }
    return parsed;
  }
  if (
    THIS_YEAR_RE.test(quote) &&
    !/\bnext\s+(financial|fiscal)?\s*year\b/i.test(quote)
  ) {
    if (parsed.period?.kind === "year" && parsed.period.fy !== callFy) {
      const p = makePeriod("year", callFy, null);
      return { label: p.label, end: p.end, period: p };
    }
    return parsed;
  }
  if (
    parsed.period?.kind === "year" &&
    parsed.period.fy > callFy + 1 &&
    !/\b(next|by|over|term|years|20\d\d)\b/i.test(quote)
  ) {
    const p = makePeriod("year", callFy, null);
    return { label: p.label, end: p.end, period: p };
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export interface TurnChunk {
  index: number;
  /** turn ids included (with sub-part letters for split turns) */
  turnIds: number[];
  text: string;
  chars: number;
}

function splitLongText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z0-9"“(])/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

/** Group management turns into chunks of ≈ `maxChars`; long turns are split at sentence boundaries. */
export function chunkTurns(
  turns: TranscriptTurn[],
  maxChars = CHUNK_CHARS,
): TurnChunk[] {
  const chunks: TurnChunk[] = [];
  let cur: { ids: number[]; parts: string[]; chars: number } = {
    ids: [],
    parts: [],
    chars: 0,
  };
  const flush = () => {
    if (!cur.parts.length) return;
    chunks.push({
      index: chunks.length,
      turnIds: cur.ids,
      text: cur.parts.join("\n\n"),
      chars: cur.chars,
    });
    cur = { ids: [], parts: [], chars: 0 };
  };
  for (const t of turns) {
    const pieces = splitLongText(t.text, Math.floor(maxChars * 0.9));
    for (let k = 0; k < pieces.length; k++) {
      const piece = pieces[k] as string;
      const tag = `[T${t.index} | ${t.speaker ?? "Management"} | p${t.page}${pieces.length > 1 ? ` | part ${k + 1}/${pieces.length}` : ""}]`;
      const block = `${tag}\n${piece}`;
      if (cur.chars && cur.chars + block.length > maxChars) flush();
      cur.parts.push(block);
      cur.chars += block.length;
      if (!cur.ids.includes(t.index)) cur.ids.push(t.index);
    }
  }
  flush();
  return chunks;
}

// ---------------------------------------------------------------------------
// Gates + normalisation
// ---------------------------------------------------------------------------

export interface VerifiedStatement extends GuidanceStatement {
  turn: number;
  /** 'turn' when verified against the claimed turn, 'doc' when found elsewhere (page fixed) */
  verifiedAgainst: "turn" | "doc";
  /** 0-based chunk index the statement came from */
  chunk: number;
  model: string;
  /** how many later turns restated the same commitment (dropped as duplicates) */
  restatements?: number;
  /** the model's horizon string before normalisation */
  horizonRaw?: string;
}

export interface GateStats {
  candidates: number;
  quoteRejected: number;
  numberRejected: number;
  /** horizon already over when the call took place (a reported number, not a promise) */
  backwardRejected: number;
  duplicates: number;
  kept: number;
  adjectival: number;
}

const UNIT_FACTOR: Record<string, { unit: string; factor: number }> = {
  pct: { unit: "%", factor: 1 },
  bps: { unit: "bp", factor: 1 },
  inr_cr: { unit: "INR", factor: 1e7 },
  inr_mn: { unit: "INR", factor: 1e6 },
  inr_bn: { unit: "INR", factor: 1e9 },
  inr_lakh: { unit: "INR", factor: 1e5 },
  usd_mn: { unit: "USD", factor: 1e6 },
  usd_bn: { unit: "USD", factor: 1e9 },
  x: { unit: "x", factor: 1 },
  units: { unit: "units", factor: 1 },
  text: { unit: "qualitative", factor: 1 },
};

const DIRECTION_MAP: Record<ModelStatementT["direction"], GuidanceDirection> = {
  increase: "up",
  decrease: "down",
  maintain: "flat",
  range: "range",
  target: "absolute",
};

/**
 * Make a quote number-friendly for `groundNumbers`: hyphenated ranges ("700-750")
 * would parse as a negative number → "700 to 750"; glued currency prefixes
 * ("INR13,500", "Rs.700", "₹5,893") hide the digits → "INR 13,500".
 */
export function numberFriendly(quote: string): string {
  return quote
    .replace(/(INR|Rs\.?|₹|\$|USD|US\$|EUR|€|GBP|£)(?=\d)/gi, "$1 ")
    .replace(/(\d)\s*[-–—]\s*(?=\d)/g, "$1 to ");
}

/** Pure: run every code gate on one model statement. Null = dropped (reason in `stats`). */
export function gateStatement(
  s: ModelStatementT,
  ctx: {
    turns: Map<number, TranscriptTurn>;
    chunkText: string;
    docText: DocumentText;
    callPeriod: FiscalPeriod | null;
    chunk: number;
    model: string;
    callDate?: string | null;
  },
  stats: GateStats,
): VerifiedStatement | null {
  stats.candidates++;
  const quote = s.quote.trim();
  if (quote.split(/\s+/).length < 4) {
    stats.quoteRejected++;
    return null;
  }

  // --- gate 1: verbatim ---------------------------------------------------------
  let turn = ctx.turns.get(s.turn) ?? null;
  let verifiedAgainst: "turn" | "doc" = "turn";
  let page: number | null = turn?.page ?? null;
  if (!turn || verifyQuote(quote, turn.text) === null) {
    // maybe the model mis-numbered the turn: search the other turns of the chunk
    let found: TranscriptTurn | null = null;
    for (const t of ctx.turns.values()) {
      if (verifyQuote(quote, t.text) !== null) {
        found = t;
        break;
      }
    }
    if (found) {
      turn = found;
      page = found.page;
    } else {
      // anywhere in the document (page-spanning quotes): accept, fix the page
      let hitPage: number | null = null;
      for (let i = 0; i < ctx.docText.pages.length; i++) {
        const p = ctx.docText.pages[i] as { page: number; text: string };
        const next = ctx.docText.pages[i + 1];
        if (
          verifyQuote(quote, next ? `${p.text}\n${next.text}` : p.text) !== null
        ) {
          hitPage = p.page;
          break;
        }
      }
      if (hitPage === null) {
        stats.quoteRejected++;
        return null;
      }
      verifiedAgainst = "doc";
      page = hitPage;
      if (!turn) turn = null;
    }
  }

  // --- unit + values -----------------------------------------------------------------
  const uf = UNIT_FACTOR[s.unit] ?? UNIT_FACTOR.text;
  let unit = (uf as { unit: string }).unit;
  const factor = (uf as { factor: number }).factor;
  let low: number | null = s.value_low;
  let high: number | null = s.value_high;
  let isExplicit = s.is_explicit && (low !== null || high !== null);

  if (isExplicit) {
    // --- gate 2: number grounding (values must literally appear in the quote) -----------
    const vals = [low, high].filter((v): v is number => v !== null);
    const missing = groundNumbers(
      vals.map((v) => String(v)).join(" "),
      numberFriendly(quote),
    );
    if (missing.length) {
      stats.numberRejected++;
      return null;
    }
    if (low !== null && high !== null && low > high) [low, high] = [high, low];
    const cued = applyCueWords(quote, low, high, unit);
    low = cued.low;
    high = cued.high;
    if (low !== null) low *= factor;
    if (high !== null) high *= factor;
  } else {
    low = null;
    high = null;
    const band = adjectiveBand(quote);
    const growthish =
      /growth|grow|increase|decline|de-?growth|margin|rate|yield|return/i.test(
        `${s.metric} ${quote}`,
      );
    if (band && (band.low !== 0 || band.high !== 0) && growthish) {
      low = band.low;
      high = band.high;
      unit = "%";
      stats.adjectival++;
    } else if (band && band.low === 0 && band.high === 0) {
      // "flat / maintain" — a direction, not a band; tolerance handled by the ledger
      unit = /margin/i.test(s.metric) ? "%" : "qualitative";
      stats.adjectival++;
    } else {
      // numbers present in the quote that the model did not structure → keep as qualitative
      unit = "qualitative";
    }
    isExplicit = false;
  }

  const h = reconcileHorizon(
    quote,
    parseHorizon(s.horizon, ctx.callPeriod),
    ctx.callPeriod,
  );
  // --- gate 3: a horizon that ended before the call is a reported number, not a promise ---------
  const callDate = ctx.callDate ?? ctx.callPeriod?.end ?? null;
  if (h.end && callDate && h.end < callDate) {
    stats.backwardRejected++;
    return null;
  }
  const direction: GuidanceDirection =
    unit === "qualitative" && low === null && high === null
      ? "qualitative"
      : (DIRECTION_MAP[s.direction] ?? "qualitative");

  stats.kept++;
  return {
    quote,
    speaker: turn?.speaker ?? null,
    role: "management",
    page,
    metric: s.metric,
    direction,
    low,
    high,
    unit,
    horizon: h.label,
    horizonEnd: h.end,
    status: "open",
    isExplicit,
    confidence: Math.max(0, Math.min(1, s.confidence)),
    revision: s.revision,
    comparison: s.comparison === "none" ? undefined : s.comparison,
    turn: turn?.index ?? s.turn,
    verifiedAgainst,
    chunk: ctx.chunk,
    model: ctx.model,
    horizonRaw: s.horizon,
  };
}

/**
 * Pure: drop duplicates within one document — the same quote, or the same
 * commitment (metric + horizon + band + unit) restated in a later turn. The
 * first occurrence is kept; restatements are counted on it.
 */
export function dedupeStatements<
  T extends GuidanceStatement & { restatements?: number },
>(items: T[], stats?: GateStats): T[] {
  const byQuote = new Set<string>();
  const byCommitment = new Map<string, T>();
  const out: T[] = [];
  for (const it of items) {
    const qKey = `${it.metric}|${it.horizon ?? ""}|${it.quote
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .split(/\s+/)
      .slice(0, 12)
      .join(" ")}`;
    if (byQuote.has(qKey)) {
      if (stats) stats.duplicates++;
      continue;
    }
    byQuote.add(qKey);
    const cKey =
      it.isExplicit === false && it.low === null
        ? `${qKey}`
        : `${it.metric}|${it.horizon ?? ""}|${it.low ?? ""}|${it.high ?? ""}|${it.unit ?? ""}`;
    const prev = byCommitment.get(cKey);
    if (prev) {
      prev.restatements = (prev.restatements ?? 0) + 1;
      if (stats) stats.duplicates++;
      continue;
    }
    byCommitment.set(cKey, it);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface ExtractGuidanceResult {
  statements: VerifiedStatement[];
  parsed: ParsedTranscript;
  chunks: number;
  calls: number;
  cached: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  stats: GateStats;
  errors: string[];
}

export interface ExtractGuidanceOptions {
  /** stop after this many model calls (budget guard) */
  maxCalls?: number;
  maxChars?: number;
  signal?: AbortSignal;
}

/** Transcript → verified guidance statements with gate statistics (the real entry point). */
export async function extractGuidanceDetailed(
  doc: DocumentText,
  ctx: { isin: string; period: string | null },
  opts: ExtractGuidanceOptions = {},
): Promise<ExtractGuidanceResult> {
  const t0 = Date.now();
  const parsed = parseTranscript(doc);
  const periodLabel = parsed.period ?? ctx.period;
  const callPeriod = periodLabel ? parsePeriodLabel(periodLabel) : null;
  const mgmt = managementTurns(parsed);
  const chunks = chunkTurns(mgmt, opts.maxChars ?? CHUNK_CHARS);
  const turnMap = new Map(parsed.turns.map((t) => [t.index, t]));
  const stats: GateStats = {
    candidates: 0,
    quoteRejected: 0,
    numberRejected: 0,
    backwardRejected: 0,
    duplicates: 0,
    kept: 0,
    adjectival: 0,
  };
  const out: VerifiedStatement[] = [];
  const errors: string[] = [];
  let calls = 0;
  let cached = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  const system = SYSTEM.replace(
    /\{\{PERIOD\}\}/g,
    periodLabel ?? "the latest reported quarter",
  );
  for (const chunk of chunks) {
    // cache hits are free: only uncached calls count against the budget
    if (opts.maxCalls !== undefined && calls - cached >= opts.maxCalls) {
      errors.push(
        `budget: stopped after ${calls - cached} uncached calls (${chunks.length - chunk.index} chunks left)`,
      );
      break;
    }
    const prompt = `Company ISIN ${ctx.isin}. Call period: ${periodLabel ?? "unknown"}${parsed.callDate ? ` (held ${parsed.callDate})` : ""}. Chunk ${chunk.index + 1} of ${chunks.length}: management turns T${chunk.turnIds[0]}–T${chunk.turnIds[chunk.turnIds.length - 1]}.\n\nExtract every guidance statement. JSON only.`;
    try {
      const r = await callStructured({
        task: "guidance_extract",
        tier: "bulk",
        schema: ModelOutput,
        system,
        prompt,
        parts: [{ kind: "text", text: chunk.text }],
        promptVersion: GUIDANCE_PROMPT_VERSION,
        maxTokens: 4096,
        signal: opts.signal,
      });
      calls++;
      if (r.cached) cached++;
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      const chunkTurns = new Map<number, TranscriptTurn>();
      for (const id of chunk.turnIds) {
        const t = turnMap.get(id);
        if (t) chunkTurns.set(id, t);
      }
      for (const s of r.data.statements) {
        const v = gateStatement(
          s,
          {
            turns: chunkTurns,
            chunkText: chunk.text,
            docText: doc,
            callPeriod,
            chunk: chunk.index,
            model: r.model,
            callDate: parsed.callDate,
          },
          stats,
        );
        if (v) out.push(v);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`chunk ${chunk.index}: ${msg.slice(0, 200)}`);
      log.warn(
        { docId: doc.docId, chunk: chunk.index, err: msg.slice(0, 200) },
        "guidance chunk failed",
      );
      if (/budget exhausted/i.test(msg)) break;
    }
  }
  const statements = dedupeStatements(out, stats);
  stats.kept = statements.length;
  log.info(
    {
      docId: doc.docId,
      period: periodLabel,
      chunks: chunks.length,
      calls,
      cached,
      ...stats,
      ms: Date.now() - t0,
    },
    "guidance extracted",
  );
  return {
    statements,
    parsed,
    chunks: chunks.length,
    calls,
    cached,
    tokensIn,
    tokensOut,
    latencyMs: Date.now() - t0,
    stats,
    errors,
  };
}

/** Contract from extract/index.ts: transcript → verified guidance statements. */
export async function extractGuidance(
  doc: DocumentText,
  ctx: { isin: string; period: string | null },
): Promise<GuidanceStatement[]> {
  const r = await extractGuidanceDetailed(doc, ctx);
  return r.statements.map(
    ({ turn: _t, verifiedAgainst: _v, chunk: _c, model: _m, ...s }) => s,
  );
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function guidanceId(
  docId: string,
  s: Pick<GuidanceStatement, "quote" | "metric" | "horizon">,
): string {
  const h = createHash("sha256")
    .update(docId)
    .update("|")
    .update(s.quote.toLowerCase().replace(/\s+/g, " ").trim())
    .update("|")
    .update(s.metric)
    .update("|")
    .update(s.horizon ?? "")
    .digest("hex");
  return `g_${h.slice(0, 20)}`;
}

export interface PersistGuidanceResult {
  inserted: number;
  existing: number;
  ids: string[];
}

/** Idempotent: insert verified statements as `guidance` rows (status 'open'); existing ids are kept. */
export async function persistGuidance(
  isin: string,
  docId: string,
  statements: VerifiedStatement[],
  meta: {
    period: string | null;
    callDate: string | null;
    publishedAt: number | null;
  },
): Promise<PersistGuidanceResult> {
  let inserted = 0;
  let existing = 0;
  const ids: string[] = [];
  for (const s of statements) {
    const id = guidanceId(docId, s);
    ids.push(id);
    const already = await db
      .select({ id: guidance.id })
      .from(guidance)
      .where(eq(guidance.id, id))
      .limit(1);
    if (already.length) {
      existing++;
      continue;
    }
    await db.insert(guidance).values({
      id,
      isin,
      docId,
      speaker: s.speaker,
      role: s.role,
      page: s.page,
      quote: s.quote,
      metric: s.metric,
      direction: s.direction,
      low: s.low,
      high: s.high,
      unit: s.unit,
      horizon: s.horizon,
      status: "open",
      settledByQuarter: null,
      verdict: null,
      evidenceJson: JSON.stringify({
        horizonEnd: s.horizonEnd ?? null,
        horizonRaw: s.horizonRaw ?? null,
        isExplicit: s.isExplicit ?? false,
        confidence: s.confidence ?? null,
        revision: s.revision ?? "new",
        comparison: s.comparison ?? null,
        turn: s.turn,
        verified: "verbatim",
        verifiedAgainst: s.verifiedAgainst,
        restatements: s.restatements ?? 0,
        statedPeriod: meta.period,
        callDate: meta.callDate,
        publishedAt: meta.publishedAt,
        promptVersion: GUIDANCE_PROMPT_VERSION,
        model: s.model,
      }),
      createdAt: Date.now(),
    });
    inserted++;
  }
  return { inserted, existing, ids };
}

export { extractNumbers };
