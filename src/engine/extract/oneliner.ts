/**
 * Category one-liners — per-category zod schemas with LIST-shaped fields
 * (never model-summed totals; totals are computed in code), batched many
 * items per Flash-Lite call, every number grounded against the source text
 * with `groundNumbers`, every verbatim excerpt checked with `verifyQuote`.
 * Anything that fails a gate is dropped (set to null), never repaired.
 *
 * Input text priority: attachment text (when downloaded) + NSE voiceSummary
 * + the subject line. Rules-only fallbacks produce a title/one-liner from the
 * subject when the LLM is unavailable or its output fails the gates.
 */
import { z } from "zod";
import { logger } from "@/lib/logger";
import { callStructured, LlmBudgetExhausted } from "../llm/gateway";
import { groundNumbers, verifyQuote } from "../llm/verify";
import type { AnnouncementRaw, Category } from "../types";
import type { OneLiner } from "./index";

const log = logger.child({ mod: "engine/extract/oneliner" });

// ---------------------------------------------------------------------------
// Schemas (one per category; list-shaped where a filing can carry several items)
// ---------------------------------------------------------------------------

const S = z.string().max(300).nullable();
const N = z.number().nullable();

export const DividendFields = z.object({
  dividends: z.array(
    z.object({
      amount_per_share: N,
      type: z.enum(["interim", "final", "special", "unknown"]),
      record_date: S,
      ex_date: S,
      payment_date: S,
      face_value: N,
    }),
  ),
});

export const CreditRatingFields = z.object({
  ratings: z.array(
    z.object({
      agency: S,
      instrument: S,
      old_rating: S,
      new_rating: S,
      outlook: S,
      action: z.enum([
        "upgrade",
        "downgrade",
        "reaffirm",
        "assign",
        "outlook_change",
        "watch",
        "withdraw",
        "unknown",
      ]),
      amount_as_stated: N,
      amount_unit: S,
    }),
  ),
});

export const MnaFields = z.object({
  deals: z.array(
    z.object({
      counterparty: S,
      type: z.enum([
        "acquisition",
        "stake_increase",
        "divestment",
        "merger",
        "demerger",
        "jv",
        "incorporation",
        "ipo",
        "other",
      ]),
      stake_pct: N,
      consideration: N,
      currency: S,
      unit: S,
      target_turnover: N,
      completion: S,
      related_party: z.boolean().nullable(),
    }),
  ),
});

export const FundRaiseFields = z.object({
  instruments: z.array(
    z.object({
      instrument: S,
      amount: N,
      currency: S,
      unit: S,
      price_per_share: N,
      discount_pct: N,
      quantity: N,
      allottees: S,
    }),
  ),
});

export const PledgingFields = z.object({
  pledges: z.array(
    z.object({
      pledgor: S,
      pledgor_type: z.enum(["promoter", "company", "other", "unknown"]),
      action: z.enum(["creation", "release", "invocation", "other"]),
      shares: N,
      pct_of_total_shares: N,
      pct_of_promoter_holding_after: N,
      pct_of_total_shares_after: N,
      lender: S,
    }),
  ),
});

export const InsiderFields = z.object({
  persons: z.array(
    z.object({
      name: S,
      relation: S,
      action: z.enum(["buy", "sell", "pledge", "gift", "esop", "other"]),
      quantity: N,
      value: N,
      pct_of_equity: N,
      mode: S,
      holding_after_pct: N,
    }),
  ),
});

export const CapexFields = z.object({
  projects: z.array(
    z.object({
      amount: N,
      currency: S,
      unit: S,
      location: S,
      capacity: S,
      timeline: S,
      funding: S,
    }),
  ),
});

export const LitigationFields = z.object({
  matters: z.array(
    z.object({
      authority: S,
      amount: N,
      currency: S,
      unit: S,
      stage: S,
      nature: S,
      favourable: z.boolean().nullable(),
      company_stance: S,
    }),
  ),
});

export const PressReleaseFields = z.object({
  headline: S,
  kind: z.enum([
    "order_win",
    "product",
    "partnership",
    "approval",
    "rumour",
    "business_update",
    "csr",
    "other",
  ]),
  entities: z.array(z.string().max(120)),
  amounts: z.array(
    z.object({
      label: S,
      value: N,
      currency: S,
      unit: S,
    }),
  ),
});

export const ManagementChangeFields = z.object({
  changes: z.array(
    z.object({
      person: S,
      role: S,
      action: z.enum([
        "appointed",
        "resigned",
        "retired",
        "ceased",
        "demise",
        "redesignated",
        "reappointed",
        "other",
      ]),
      effective_date: S,
      reason: S,
      successor: S,
      brief_profile_excerpt: z.string().max(4000).nullable(),
      prior_roles: z.array(z.string().max(160)),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

export const BonusSplitFields = z.object({
  actions: z.array(
    z.object({
      kind: z.enum(["bonus", "split", "other"]),
      ratio: S,
      record_date: S,
      face_value_from: N,
      face_value_to: N,
    }),
  ),
});

export const GenericFields = z.object({
  summary_points: z.array(z.string().max(200)),
});

const FIELD_SCHEMAS: Partial<Record<Category, z.ZodTypeAny>> = {
  dividend: DividendFields,
  credit_rating: CreditRatingFields,
  m_and_a: MnaFields,
  fund_raise: FundRaiseFields,
  pledging: PledgingFields,
  insider_trading: InsiderFields,
  capex: CapexFields,
  litigation: LitigationFields,
  press_release: PressReleaseFields,
  management_change: ManagementChangeFields,
  bonus_split: BonusSplitFields,
};

/** Categories we spend LLM calls on. results/earnings_call/investor_meetings/etc. are rules-only. */
export const LLM_CATEGORIES: ReadonlySet<Category> = new Set(
  Object.keys(FIELD_SCHEMAS) as Category[],
);

function batchSchema(fields: z.ZodTypeAny) {
  return z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string().max(90),
        one_liner: z.string().max(260),
        fields,
      }),
    ),
  });
}

const FIELD_GUIDE: Partial<Record<Category, string>> = {
  dividend:
    "dividends[]: amount_per_share (number as printed), type, record_date/ex_date/payment_date exactly as written in the text, face_value.",
  credit_rating:
    "ratings[]: one entry per instrument/agency line. action must be downgrade/upgrade/reaffirm/assign/outlook_change/watch/withdraw. amount_as_stated = a rated amount ONLY if that exact total is printed (never add lines up).",
  m_and_a:
    "deals[]: counterparty (target/seller/partner), type, stake_pct, consideration as printed with currency and unit (crore/lakh/million), target_turnover if stated, completion timeline, related_party.",
  fund_raise:
    "instruments[]: QIP/preferential/rights/NCD/CP/warrants/buyback; amount as printed with unit; price_per_share; discount_pct; quantity of securities; allottees.",
  pledging:
    "pledges[]: ONE entry per pledgor; pledgor_type promoter/company/other; shares; pct_of_total_shares; cumulative % after; lender.",
  insider_trading:
    "persons[]: ONE entry per person/transaction row (do not merge rows); action buy/sell/pledge/gift/esop; quantity; value; pct_of_equity; mode (market/off-market); holding_after_pct.",
  capex:
    "projects[]: amount with currency/unit, location, capacity (with units), timeline/commissioning date, funding source.",
  litigation:
    "matters[]: ONE entry per order/notice; authority; amount with currency/unit (per order, never summed); stage; nature; favourable true/false/null; company_stance (impact statement, short).",
  press_release:
    "headline (≤ 15 words), kind, entities (counterparties/products named), amounts[] with label/value/currency/unit exactly as printed.",
  management_change:
    "changes[]: ONE entry per person. action appointed/resigned/retired/ceased/demise/redesignated/reappointed. effective_date as written. reason (for exits, from the letter). successor if named. brief_profile_excerpt = COPY VERBATIM (exact characters, ≤ 1200) the filing's 'brief profile' paragraph for THIS person, or null if the filing has none. prior_roles = short strings from that profile only. confidence high only when a verbatim profile exists.",
  bonus_split:
    "actions[]: kind bonus/split; ratio as written (e.g. '3:1'); record_date; face values.",
};

const SYSTEM = `You extract structured fields from Indian stock-exchange (NSE) corporate filings for an investor's brief.
Hard rules:
- Use ONLY facts present in the provided text. Never use outside knowledge. Never guess.
- Copy numbers exactly as printed (same digits, same unit words). Do NOT compute totals, sums, conversions or percentages that are not printed.
- If a field is not stated, use null. Lists must contain one entry per distinct item in the filing (every person, every order, every pledgor).
- title: ≤ 10 words, no company name, the key fact first. one_liner: ONE sentence ≤ 30 words that carries at least one number or named entity from the text.
- Dates: copy as written in the filing (e.g. "12-Nov-2026" or "November 12, 2026").
Output JSON only, one item per id, same order as given.`;

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface OneLinerInput {
  id: string;
  category: Category;
  symbol: string;
  companyName: string;
  desc: string;
  subject: string;
  voiceSummary?: string | null;
  /** attachment text (already truncated) */
  text?: string | null;
  filedAtIst: string;
}

export interface OneLinerResult {
  id: string;
  category: Category;
  title: string;
  oneLiner: string;
  /** category-shaped fields after the gates; null when nothing survived or no LLM ran */
  fields: Record<string, unknown> | null;
  /** every number in title/one-liner/fields was found in the source text */
  grounded: boolean;
  /** field paths dropped by the gates */
  dropped: string[];
  source: "llm" | "rules";
  model?: string;
  cached?: boolean;
}

/** Text the model sees and the gates verify against. */
export function sourceTextFor(inp: OneLinerInput): string {
  // ordinal day suffixes ("12th November") are stripped so the date's number is
  // visible to groundNumbers (which deliberately ignores digits glued to letters)
  return [inp.subject, inp.voiceSummary ?? "", inp.text ?? ""]
    .filter(Boolean)
    .join("\n\n")
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
}

/** Keep the opening of the document plus a window around the brief-profile heading for KMP filings. */
export function focusText(
  text: string,
  category: Category,
  maxChars: number,
): string {
  if (text.length <= maxChars) return text;
  if (category === "management_change") {
    const m =
      /brief profile|profile of|brief background|background of|annexure/i.exec(
        text,
      );
    if (m && m.index > maxChars * 0.6) {
      const head = text.slice(0, Math.floor(maxChars * 0.55));
      const start = Math.max(0, m.index - 400);
      const win = text.slice(start, start + Math.floor(maxChars * 0.45));
      return `${head}\n[...]\n${win}`;
    }
  }
  return text.slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

const DATE_KEY = /date|timeline|completion|effective/i;

/** Dates: the day and the year must be in the source (month may be spelled out). */
function dateGrounded(value: string, source: string): boolean {
  const nums = value.match(/\d+/g) ?? [];
  if (nums.length === 0) return true;
  const srcNums = new Set(
    (source.match(/\d+/g) ?? []).map((n) => String(Number(n))),
  );
  const yearish = nums.filter((n) => n.length === 4);
  const dayish = nums.filter(
    (n) => n.length <= 2 && Number(n) >= 1 && Number(n) <= 31,
  );
  const okYear = yearish.every((y) => srcNums.has(String(Number(y))));
  const okDay =
    dayish.length === 0 || dayish.some((d) => srcNums.has(String(Number(d))));
  return okYear && okDay;
}

/**
 * Walk the fields object; null out any scalar whose numbers are not in the
 * source; verify verbatim excerpts; drop list entries that lost their key
 * value. Returns the cleaned object and the dropped paths.
 */
export function gateFields(
  fields: Record<string, unknown>,
  source: string,
): { fields: Record<string, unknown>; dropped: string[] } {
  const dropped: string[] = [];
  const visit = (v: unknown, path: string, key: string): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") {
      if (groundNumbers(String(v), source).length > 0) {
        dropped.push(path);
        return null;
      }
      return v;
    }
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      if (/excerpt|quote/i.test(key)) {
        if (verifyQuote(v, source) === null) {
          dropped.push(path);
          return null;
        }
        return v;
      }
      if (DATE_KEY.test(key)) {
        if (!dateGrounded(v, source)) {
          dropped.push(path);
          return null;
        }
        return v;
      }
      if (groundNumbers(v, source).length > 0) {
        dropped.push(path);
        return null;
      }
      return v;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        const cleaned = visit(v[i], `${path}[${i}]`, key);
        if (cleaned !== null) out.push(cleaned);
      }
      return out;
    }
    if (typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>))
        o[k] = visit(val, `${path}.${k}`, k);
      return o;
    }
    return v;
  };
  const cleaned = visit(fields, "fields", "fields") as Record<string, unknown>;
  return { fields: cleaned, dropped };
}

/** Code-computed totals for list fields (never asked of the model). */
export function computeTotals(
  category: Category,
  fields: Record<string, unknown>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  const sum = (arr: unknown, key: string): number | null => {
    if (!Array.isArray(arr)) return null;
    let s = 0;
    let n = 0;
    for (const it of arr) {
      const v = (it as Record<string, unknown>)[key];
      if (typeof v === "number") {
        s += v;
        n++;
      }
    }
    return n > 0 ? s : null;
  };
  if (category === "insider_trading") {
    const q = sum(fields.persons, "quantity");
    if (q !== null) totals.total_quantity = q;
    const v = sum(fields.persons, "value");
    if (v !== null) totals.total_value = v;
  }
  if (category === "pledging") {
    const s = sum(fields.pledges, "shares");
    if (s !== null) totals.total_shares = s;
  }
  if (category === "litigation") {
    const a = sum(fields.matters, "amount");
    if (a !== null) totals.sum_of_stated_amounts = a;
    if (Array.isArray(fields.matters)) totals.matters = fields.matters.length;
  }
  if (category === "management_change" && Array.isArray(fields.changes))
    totals.persons = fields.changes.length;
  return totals;
}

// ---------------------------------------------------------------------------
// Rules-only fallbacks
// ---------------------------------------------------------------------------

const BOILERPLATE =
  /^.{0,80}?has (informed|submitted)( to)? the exchange( about| regarding| that|,)?\s*/i;

const REG30_BOILERPLATE =
  /^(?:pursuant to|in terms of|in compliance with|further to)\s+(?:the )?(?:provisions of )?(?:regulation \d+(?:\(\d+\))?(?: and (?:\d+|other applicable regulations))?\s*)?(?:read with [^,]{0,60},?\s*)?(?:of )?(?:the )?sebi\s*\((?:listing obligations and disclosure requirements|lodr)\)\s*regulations,?\s*2015\s*(?:\([^)]{0,40}\))?,?\s*/i;
const VERB_BOILERPLATE =
  /^(?:we (?:wish to|hereby|would like to) inform (?:you|the exchange)s?(?: that)?,?\s*|please find (?:enclosed|attached)(?: herewith)?,?\s*(?:a copy of )?(?:the )?|this is to inform (?:you )?that,?\s*|kindly note that,?\s*)/i;

export function cleanSubject(subject: string): string {
  let s = subject.replace(BOILERPLATE, "").trim();
  s = s.replace(REG30_BOILERPLATE, "").trim();
  s = s.replace(VERB_BOILERPLATE, "");
  s = s.replace(/^['"‘’“”\s]+|[\s'"‘’“”.]+$/g, "");
  if (s.length > 0) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.replace(/\s+/g, " ").trim();
}

const TITLE_BY_CATEGORY: Record<Category, string> = {
  results: "Quarterly results filed",
  m_and_a: "Acquisition / restructuring filing",
  fund_raise: "Fund-raise filing",
  management_change: "Management change",
  litigation: "Regulatory / legal order",
  insider_trading: "Insider trade disclosed",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meeting",
  credit_rating: "Credit rating update",
  dividend: "Dividend",
  bonus_split: "Bonus / split",
  capex: "Capacity expansion",
  press_release: "Press release",
  postal_ballot: "Postal ballot",
  agm_egm: "Shareholder meeting",
  pledging: "Promoter pledge",
  unclassified: "Routine filing",
};

function words(s: string, n: number): string {
  const w = s.split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`;
}

const ABBR =
  /\b(rs|re|mr|mrs|ms|dr|prof|ltd|pvt|inc|co|no|nos|w\.e\.f|vs|approx|st|jr|sr|e\.g|i\.e|etc|sh|smt)\.$/i;

/** First sentence, without splitting on abbreviations ("Rs.", "Mr.") or initials ("V. N."). */
export function firstSentence(s: string): string {
  const re = /[.!?](?=\s+[A-Z0-9"“(])/g;
  let m: RegExpExecArray | null = re.exec(s);
  while (m) {
    const before = s.slice(0, m.index + 1);
    if (!ABBR.test(before) && !/\b[A-Z]\.$/.test(before)) return before.trim();
    m = re.exec(s);
  }
  return s.trim();
}

export function fallbackTitle(
  inp: Pick<OneLinerInput, "category" | "desc" | "subject">,
): string {
  const subj = cleanSubject(inp.subject);
  const descLc = inp.desc.toLowerCase();
  if (inp.category === "earnings_call") {
    if (/transcript/i.test(subj)) return "Earnings call transcript";
    if (/recording/i.test(subj)) return "Earnings call recording";
    return "Earnings call scheduled";
  }
  if (inp.category === "results" && /newspaper/i.test(`${descLc} ${subj}`))
    return "Results newspaper ad";
  if (inp.category === "results" && /presentation/i.test(`${descLc} ${subj}`))
    return "Investor presentation";
  if (inp.category === "dividend" && /record date/i.test(subj))
    return "Dividend record date";
  // an informative subject beats the generic label (first 10 words)
  if (
    subj &&
    subj.length >= 8 &&
    !/^(general updates?|updates?)\.?$/i.test(subj) &&
    !/informed the exchange|disclosure under regulation 30/i.test(subj)
  ) {
    return words(subj, 10);
  }
  if (inp.desc && !/^(updates?|general updates?)$/i.test(inp.desc))
    return words(inp.desc, 10);
  return TITLE_BY_CATEGORY[inp.category];
}

export function fallbackOneLiner(
  inp: Pick<OneLinerInput, "subject" | "voiceSummary" | "desc" | "companyName">,
): string {
  const subj = cleanSubject(inp.subject);
  if (
    subj &&
    subj.length > 12 &&
    !/^(general updates?|updates?)\.?$/i.test(subj)
  ) {
    const s = firstSentence(subj);
    return words(s, 32);
  }
  if (inp.voiceSummary) {
    const s = firstSentence(inp.voiceSummary);
    return words(s, 32);
  }
  return `${inp.companyName} filed "${inp.desc}".`;
}

export function rulesOnlyResult(inp: OneLinerInput): OneLinerResult {
  return {
    id: inp.id,
    category: inp.category,
    title: fallbackTitle(inp),
    oneLiner: fallbackOneLiner(inp),
    fields: null,
    grounded: true,
    dropped: [],
    source: "rules",
  };
}

// ---------------------------------------------------------------------------
// Batched extraction
// ---------------------------------------------------------------------------

export interface ExtractBatchOptions {
  /** shared call budget; decremented per real call (cache hits are free) */
  budget?: { remaining: number };
  maxItemsPerCall?: number;
  /** max chars of text per item sent to the model */
  maxCharsPerItem?: number;
  /** max total chars per call */
  maxCharsPerCall?: number;
  /** injectable for tests — returns the model's raw batch output */
  llm?: (
    category: Category,
    prompt: string,
    schema: z.ZodTypeAny,
  ) => Promise<{ data: unknown; model: string; cached: boolean }>;
}

type BatchOut = {
  items: Array<{
    id: string;
    title: string;
    one_liner: string;
    fields: Record<string, unknown>;
  }>;
};

async function defaultLlm(
  category: Category,
  prompt: string,
  schema: z.ZodTypeAny,
  nItems: number,
): Promise<{ data: unknown; model: string; cached: boolean }> {
  const r = await callStructured({
    task: "oneliner",
    tier: "bulk",
    schema: schema as z.ZodType<unknown>,
    system: SYSTEM,
    prompt,
    // management_change answers carry verbatim profiles — budget ~1,100 tokens per person
    maxTokens: Math.min(
      8192,
      category === "management_change"
        ? 800 + nItems * 1_100
        : 400 + nItems * 450,
    ),
    promptVersion: "3",
  });
  log.info(
    {
      category,
      items: nItems,
      model: r.model,
      cached: r.cached,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    },
    "oneliner batch ok",
  );
  return { data: r.data, model: r.model, cached: r.cached };
}

function buildPrompt(
  category: Category,
  chunk: OneLinerInput[],
  maxCharsPerItem: number,
): string {
  const guide = FIELD_GUIDE[category] ?? "summary_points: ≤ 3 short facts.";
  const blocks = chunk.map((it) => {
    const parts = [
      `### id=${it.id} | ${it.symbol} — ${it.companyName} | filed ${it.filedAtIst} | NSE subject: ${it.desc}`,
    ];
    parts.push(`headline: ${it.subject.slice(0, 500)}`);
    if (it.voiceSummary)
      parts.push(`exchange summary: ${it.voiceSummary.slice(0, 1500)}`);
    if (it.text)
      parts.push(
        `filing text:\n${focusText(it.text, category, maxCharsPerItem)}`,
      );
    return parts.join("\n");
  });
  return `Category: ${category}. Fields to extract — ${guide}\n\n${blocks.join("\n\n")}`;
}

/** Extract one-liners + fields for many items with ≤ 1 LLM call per ~8 items per category. */
export async function extractOneLinersBatch(
  inputs: OneLinerInput[],
  o: ExtractBatchOptions = {},
): Promise<Map<string, OneLinerResult>> {
  const out = new Map<string, OneLinerResult>();
  const perCall = o.maxItemsPerCall ?? 8;
  const maxCharsPerItem = o.maxCharsPerItem ?? 9_000;
  const maxCharsPerCall = o.maxCharsPerCall ?? 48_000;
  const budget = o.budget ?? { remaining: Number.POSITIVE_INFINITY };

  const byCat = new Map<Category, OneLinerInput[]>();
  for (const inp of inputs) {
    if (!LLM_CATEGORIES.has(inp.category)) {
      out.set(inp.id, rulesOnlyResult(inp));
      continue;
    }
    const arr = byCat.get(inp.category) ?? [];
    arr.push(inp);
    byCat.set(inp.category, arr);
  }

  for (const [category, items] of byCat) {
    const fields = FIELD_SCHEMAS[category];
    if (!fields) continue;
    const schema = batchSchema(fields);
    // chunk by item count and total chars (KMP filings produce long verbatim profiles → smaller batches)
    const catPerCall =
      category === "management_change" ? Math.min(perCall, 4) : perCall;
    const chunks: OneLinerInput[][] = [];
    let cur: OneLinerInput[] = [];
    let curChars = 0;
    for (const it of items) {
      const c =
        Math.min(it.text?.length ?? 0, maxCharsPerItem) +
        (it.voiceSummary?.length ?? 0) +
        it.subject.length +
        200;
      if (
        cur.length >= catPerCall ||
        (cur.length > 0 && curChars + c > maxCharsPerCall)
      ) {
        chunks.push(cur);
        cur = [];
        curChars = 0;
      }
      cur.push(it);
      curChars += c;
    }
    if (cur.length) chunks.push(cur);

    for (const chunk of chunks) {
      if (budget.remaining <= 0) {
        log.warn(
          { category, items: chunk.length },
          "oneliner LLM budget exhausted — rules-only fallback",
        );
        for (const it of chunk) out.set(it.id, rulesOnlyResult(it));
        continue;
      }
      const prompt = buildPrompt(category, chunk, maxCharsPerItem);
      let res: { data: unknown; model: string; cached: boolean };
      try {
        res = o.llm
          ? await o.llm(category, prompt, schema)
          : await defaultLlm(category, prompt, schema, chunk.length);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(
          { category, err: msg.slice(0, 200) },
          "oneliner LLM call failed — rules-only fallback",
        );
        // a failed call still spent quota (the gateway retries once per model) — count it twice to stay conservative
        budget.remaining -= 2;
        if (e instanceof LlmBudgetExhausted) budget.remaining = 0;
        for (const it of chunk) out.set(it.id, rulesOnlyResult(it));
        continue;
      }
      if (!res.cached) budget.remaining -= 1;
      const parsed = schema.safeParse(res.data);
      const batch: BatchOut = parsed.success
        ? (parsed.data as BatchOut)
        : { items: [] };
      const byId = new Map(batch.items.map((it) => [it.id, it]));
      for (const it of chunk) {
        const m = byId.get(it.id);
        if (!m) {
          out.set(it.id, rulesOnlyResult(it));
          continue;
        }
        out.set(it.id, gateItem(it, m, res.model, res.cached));
      }
    }
  }
  return out;
}

/** Apply the number/quote gates to one model item; fall back to rules text where gates fail. */
export function gateItem(
  inp: OneLinerInput,
  m: { title: string; one_liner: string; fields: Record<string, unknown> },
  model?: string,
  cached?: boolean,
): OneLinerResult {
  const source = sourceTextFor(inp);
  const dropped: string[] = [];
  let title = m.title.trim().replace(/[.\s]+$/g, "");
  let oneLiner = m.one_liner.trim();
  if (groundNumbers(title, source).length > 0) {
    dropped.push("title");
    title = fallbackTitle(inp);
  }
  if (title.split(/\s+/).length > 10) title = words(title, 10);
  if (groundNumbers(oneLiner, source).length > 0) {
    dropped.push("one_liner");
    oneLiner = fallbackOneLiner(inp);
  }
  const gated = gateFields(m.fields, source);
  dropped.push(...gated.dropped);
  const totals = computeTotals(inp.category, gated.fields);
  const fields: Record<string, unknown> = { ...gated.fields };
  if (Object.keys(totals).length) fields._totals = totals;
  return {
    id: inp.id,
    category: inp.category,
    title,
    oneLiner,
    fields,
    grounded: dropped.length === 0,
    dropped,
    source: "llm",
    model,
    cached,
  };
}

/** Contract: category-specific one-liner + fields for one announcement (one LLM call, cached). */
export async function extractOneLiner(
  raw: AnnouncementRaw,
  category: Category,
  filingText?: string,
): Promise<OneLiner> {
  const inp: OneLinerInput = {
    id: raw.seq_id,
    category,
    symbol: raw.symbol,
    companyName: raw.sm_name,
    desc: raw.desc,
    subject: raw.attchmntText,
    voiceSummary: raw.voiceSummary ?? null,
    text: filingText ?? null,
    filedAtIst: raw.an_dt,
  };
  const res =
    (await extractOneLinersBatch([inp])).get(raw.seq_id) ??
    rulesOnlyResult(inp);
  const flat: Record<string, string | number | null> = {};
  const walk = (v: unknown, prefix: string): void => {
    if (v === null || v === undefined) {
      flat[prefix] = null;
      return;
    }
    if (typeof v === "string" || typeof v === "number") {
      flat[prefix] = v;
      return;
    }
    if (typeof v === "boolean") {
      flat[prefix] = v ? 1 : 0;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, `${prefix}[${i}]`);
      });
      return;
    }
    if (typeof v === "object")
      for (const [k, x] of Object.entries(v as Record<string, unknown>))
        walk(x, prefix ? `${prefix}.${k}` : k);
  };
  if (res.fields) walk(res.fields, "");
  return {
    category,
    headline: res.oneLiner,
    fields: flat,
    grounded: res.grounded,
  };
}
