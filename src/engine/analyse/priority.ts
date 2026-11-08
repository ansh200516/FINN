/**
 * Priority 0–100 and Tier for an announcement.
 *
 *   priority = base[category/subcategory]
 *            + materiality cues (red-flag words, amounts vs company size)
 *            + novelty (first time in 180 days for this ISIN+category)
 *            − repetition decay (same ISIN+category ≥ 2× in 7 days)
 *            + market reaction (optional)
 *   tier     = ≥ 60 → 1 (needs you) · ≥ 30 → 2 (one-liner) · else 3 (filed away)
 *
 * Bases follow docs/research/02 §4.3 and 14 §4.2, with routine variants
 * (newspaper copy, CP allotment, meet schedule, WOS incorporation …) forced
 * into Tier 3 via the subcategory. Pure; no I/O.
 */
import type { AnnouncementRaw, Category, Classification, Tier } from "../types";

export const TIER1_MIN = 60;
export const TIER2_MIN = 30;

export interface PriorityContext {
  /** this ISIN already had this category in the last 180 days */
  seenBefore: boolean;
  /** same ISIN+category items in the last 7 days (excluding this one) */
  recentSameCategory?: number;
  /** attachment text (first pages) when downloaded */
  extraText?: string;
  /** market cap in rupees for amount materiality (optional) */
  mcapInr?: number;
  /** an extracted headline amount in rupees (overrides text parsing) */
  amountInr?: number;
  /** structured fields from the one-liner extractor (e.g. credit_rating.action) */
  extracted?: Record<string, unknown> | null;
  /** same-day EOD move/volume beyond the user's thresholds */
  marketReaction?: boolean;
}

const BASE: Readonly<Record<Category, number>> = {
  results: 70,
  m_and_a: 60,
  fund_raise: 50,
  management_change: 50,
  litigation: 55,
  insider_trading: 35,
  earnings_call: 32,
  investor_meetings: 10,
  credit_rating: 40,
  dividend: 45,
  bonus_split: 55,
  capex: 45,
  press_release: 30,
  postal_ballot: 15,
  agm_egm: 15,
  pledging: 60,
  unclassified: 5,
};

/** Subcategory overrides of the base (routine variants and material ones). */
const SUB_BASE: Readonly<Record<string, number>> = {
  // results
  "results/bm_intimation": 20,
  "results/newspaper": 10,
  "results/presentation": 40,
  "results/press_release": 45,
  "results/auditor_report": 35,
  "results/integrated_filing": 40,
  // m&a
  "m_and_a/wos_incorporation": 22,
  "m_and_a/restructuring": 22,
  "m_and_a/update": 45,
  "m_and_a/subsidiary_ipo": 62,
  "m_and_a/agreement": 55,
  // fund raise
  "fund_raise/equity": 62,
  "fund_raise/buyback": 62,
  "fund_raise/debt": 22,
  "fund_raise/cp": 12,
  "fund_raise/call_money": 15,
  "fund_raise/procedural": 30,
  // management change
  "management_change/cxo": 70,
  "management_change/auditor": 65,
  "management_change/auditor_appointment": 40,
  "management_change/director": 60,
  "management_change/smp": 40,
  "management_change/cs": 35,
  "management_change/cs_junior": 20,
  "management_change/term_end": 32,
  "management_change/redesignation": 30,
  "management_change/other": 45,
  // litigation
  "litigation/cirp": 70,
  "litigation/regulatory": 65,
  "litigation/tax": 45,
  // insider
  "insider_trading/promoter": 55,
  // earnings call
  "earnings_call/schedule": 20,
  "earnings_call/recording": 32,
  "earnings_call/transcript": 40,
  // credit rating
  "credit_rating/change": 62,
  "credit_rating/reaffirm": 30,
  "credit_rating/new": 40,
  // dividend
  "dividend/declaration": 45,
  "dividend/record_date": 30,
  "dividend/payment": 15,
  "dividend/newspaper": 10,
  "dividend/special": 65,
  // bonus/split
  "bonus_split/record_date": 35,
  // press release
  "press_release/order_win": 38,
  "press_release/rumour": 35,
  "press_release/csr": 10,
  "press_release/spurt": 10,
  "press_release/approval": 42,
  "press_release/business_update": 35,
  "press_release/product": 32,
  "press_release/partnership": 35,
  // postal ballot / agm
  "postal_ballot/notice": 15,
  "postal_ballot/results": 20,
  "agm_egm/notice": 15,
  "agm_egm/proceedings": 18,
  "agm_egm/annual_report": 25,
  // pledging
  "pledging/creation": 62,
  "pledging/invocation": 80,
  "pledging/release": 42,
  // unclassified
  "unclassified/newspaper": 5,
  "unclassified/esop": 5,
  "unclassified/certificate": 3,
  "unclassified/trading_window": 3,
  "unclassified/admin": 5,
};

/** Red-flag / materiality words → bonus (applied once per word family, capped). */
const CUES: ReadonlyArray<{ re: RegExp; bonus: number; only?: Category[] }> = [
  { re: /downgrad/i, bonus: 25, only: ["credit_rating"] },
  {
    re: /outlook .{0,20}negative|negative outlook|placed on (rating )?watch|credit ?watch/i,
    bonus: 18,
    only: ["credit_rating"],
  },
  { re: /upgrad/i, bonus: 15, only: ["credit_rating"] },
  { re: /\bresign/i, bonus: 8, only: ["management_change"] },
  {
    re: /with immediate effect|effective immediately/i,
    bonus: 8,
    only: ["management_change"],
  },
  {
    re: /qualified (opinion|conclusion)|basis for qualified|going concern|emphasis of matter/i,
    bonus: 25,
  },
  { re: /\bfraud\b|forensic|arrest|siphon|embezzl/i, bonus: 25 },
  { re: /\bnclt\b|\bnclat\b|insolvency|\bcirp\b/i, bonus: 15 },
  { re: /show[- ]cause/i, bonus: 10 },
  {
    re: /\bdefault\b/i,
    bonus: 12,
    only: ["litigation", "fund_raise", "credit_rating"],
  },
  { re: /special dividend|one-?time dividend/i, bonus: 20, only: ["dividend"] },
  { re: /invo[ck]ation|invoked/i, bonus: 20, only: ["pledging"] },
  { re: /open offer|delisting/i, bonus: 12, only: ["m_and_a"] },
  {
    re: /\bsebi\b.{0,40}\border\b|\border\b.{0,40}\bsebi\b/i,
    bonus: 15,
    only: ["litigation"],
  },
  {
    re: /no (material )?(financial )?impact|not material|does not have (any )?(material )?impact/i,
    bonus: -20,
    only: ["litigation", "press_release"],
  },
  { re: /\bmega\b|\bmajor\b/i, bonus: 12, only: ["press_release"] },
];

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

const USD_INR = 84;

const AMOUNT_RE =
  /(?:(rs\.?|₹|inr|usd|us\$|\$|eur|€|gbp|£)\s*)?([\d]{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(crores?|\bcr\b|lakhs?|\blacs?\b|million|\bmn\b|\bmio\b|billion|\bbn\b)?/gi;

/** Every rupee-ish amount in `text`, converted to absolute rupees (crore/lakh/million/billion handled). */
export function extractAmountsInr(text: string): number[] {
  const out: number[] = [];
  const t = text.replace(/\s+/g, " ");
  for (const m of t.matchAll(AMOUNT_RE)) {
    const cur = (m[1] ?? "").toLowerCase();
    const unit = (m[3] ?? "").toLowerCase();
    if (!cur && !unit) continue; // bare number
    const n = Number((m[2] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    let mult = 1;
    if (unit.startsWith("cr")) mult = 1e7;
    else if (unit.startsWith("la")) mult = 1e5;
    else if (unit.startsWith("mi") || unit === "mn") mult = 1e6;
    else if (unit.startsWith("bi") || unit === "bn") mult = 1e9;
    else if (!unit) {
      // currency without unit: only count large plain numbers (≥ 1 lakh)
      if (n < 1e5) continue;
    }
    let fx = 1;
    if (cur === "usd" || cur === "us$" || cur === "$") fx = USD_INR;
    else if (cur === "eur" || cur === "€") fx = 90;
    else if (cur === "gbp" || cur === "£") fx = 105;
    out.push(n * mult * fx);
  }
  return out;
}

/** Bonus for the largest stated amount vs company size (mcap) or absolute fallback thresholds. */
export function amountBonus(
  amountInr: number | undefined,
  mcapInr: number | undefined,
): number {
  if (!amountInr || amountInr <= 0) return 0;
  if (mcapInr && mcapInr > 0) {
    const r = amountInr / mcapInr;
    if (r >= 0.05) return 30;
    if (r >= 0.01) return 22;
    if (r >= 0.0025) return 10;
    return 0;
  }
  if (amountInr >= 1000e7) return 25;
  if (amountInr >= 500e7) return 20;
  if (amountInr >= 100e7) return 10;
  return 0;
}

const AMOUNT_CATEGORIES: ReadonlySet<Category> = new Set([
  "m_and_a",
  "fund_raise",
  "capex",
  "litigation",
  "press_release",
  "pledging",
  "insider_trading",
]);

export function tierFor(priority: number): Tier {
  if (priority >= TIER1_MIN) return 1;
  if (priority >= TIER2_MIN) return 2;
  return 3;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Pure: materiality × weight × novelty → priority 0..100 and tier. */
export function computePriority(
  raw: AnnouncementRaw,
  cls: Omit<Classification, "priority" | "tier">,
  ctx: PriorityContext,
): { priority: number; tier: Tier } {
  const key = `${cls.category}/${cls.subcategory ?? ""}`;
  let p = SUB_BASE[key] ?? BASE[cls.category];
  const routine = p < TIER2_MIN;
  // the SEBI annexure's own row label "Reason for change (viz. appointment, resignation, removal, death or otherwise)"
  // appears in every KMP filing — it must not read as a resignation cue
  const text =
    `${raw.desc} ${raw.attchmntText} ${raw.voiceSummary ?? ""} ${(ctx.extraText ?? "").slice(0, 6000)}`
      .replace(/reason for change \(viz\.?[^)]*\)/gi, "reason for change")
      .replace(/appointment, resignation, removal, death or otherwise/gi, "");

  // red-flag / materiality words — not for routine variants (a newspaper ad mentioning "results" stays routine)
  if (!routine) {
    for (const c of CUES) {
      if (c.only && !c.only.includes(cls.category)) continue;
      if (c.re.test(text)) p += c.bonus;
    }
  }

  // amounts vs size
  if (!routine && AMOUNT_CATEGORIES.has(cls.category)) {
    let amount = ctx.amountInr;
    if (amount === undefined) {
      const amounts = extractAmountsInr(
        `${raw.attchmntText} ${raw.voiceSummary ?? ""} ${(ctx.extraText ?? "").slice(0, 6000)}`,
      );
      if (amounts.length) amount = Math.max(...amounts);
    }
    p += amountBonus(amount, ctx.mcapInr);
  }

  // extracted-field hints (post-enrichment re-score)
  const ex = ctx.extracted;
  if (ex && !routine) {
    const action = String(ex.action ?? "").toLowerCase();
    if (cls.category === "credit_rating") {
      if (action.includes("downgrade")) p = Math.max(p, 78);
      else if (action.includes("upgrade") || action.includes("outlook"))
        p = Math.max(p, 65);
      else if (action.includes("reaffirm") || action.includes("assign"))
        p = Math.min(p, 45);
    }
    if (cls.category === "pledging" && action.includes("invo"))
      p = Math.max(p, 80);
    // only when the filing's own subject is about a person (not an auditor / CS / term-end notice)
    if (
      cls.category === "management_change" &&
      (cls.subcategory === undefined ||
        ["other", "smp", "director", "cxo"].includes(cls.subcategory))
    ) {
      const role = String(ex.role ?? "").toLowerCase();
      if (
        /chief executive|\bceo\b|managing director|\bmd\b|chief financial|\bcfo\b|chairman|chairperson|whole[- ]time/.test(
          role,
        )
      )
        p = Math.max(p, 70);
    }
  }

  // novelty & repetition
  if (!routine && !ctx.seenBefore) p += 10;
  if ((ctx.recentSameCategory ?? 0) >= 2) p -= 10;
  if (ctx.marketReaction) p += 10;

  const priority = clamp(p);
  return { priority, tier: tierFor(priority) };
}
