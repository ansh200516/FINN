/**
 * Company-thread commands. Rules first: a short ask for a card or a
 * tripwire never calls a model. Anything else is left for grounded Ask.
 */
import {
  CATEGORIES,
  type Category,
  type ResultsCard,
  type Tripwire,
} from "@/engine/types";
import { categoryLabel, groupIndian } from "@/lib/format";
import type { PullBlock, PullTitle } from "@/lib/pull";
import type { LedgerRowView } from "@/ui/model";

export const COMPANY_EMPTY =
  "Ask for the results, the promises, or a rule. I’ll only show that.";

export const NO_RESULTS = "No results on file.";
export const NO_PROMISES = "No scored promise on file.";
export const NOT_IN_FILINGS_LINE = "not in the filings";

const SCORED = [
  "missed",
  "cut",
  "withdrawn",
  "not_addressed",
  "kept",
  "beat",
  "raised",
] as const;

const RANK: Record<string, number> = {
  missed: 0,
  cut: 1,
  withdrawn: 2,
  not_addressed: 3,
  kept: 4,
  beat: 5,
  raised: 6,
};

const READING_BY_COMMAND: Record<string, PullTitle> = {
  guidance: "Guidance",
  "balance sheet": "Balance sheet",
  cash: "Cash quality",
  "cash quality": "Cash quality",
  "cash flow": "Cash quality",
  business: "Business snapshot",
  "business snapshot": "Business snapshot",
  trajectory: "Trajectory",
  "financial snapshot": "Financial snapshot",
  narrative: "Narrative vs. numbers",
  "narrative vs numbers": "Narrative vs. numbers",
  "bull vs bear": "Bull vs. bear",
  "bull bear": "Bull vs. bear",
};

const RESULTS = new Set([
  "results",
  "result",
  "numbers",
  "quarterly results",
  "latest results",
  "latest numbers",
  "results card",
]);

const PROMISES = new Set([
  "promises",
  "promise",
  "promise ledger",
  "ledger",
  "what did they say",
  "what did management say",
  "what have they said",
  "what'd they say",
  "what they said",
]);

const CATEGORY_ALIAS = new Map<string, Category>([
  ["management changes", "management_change"],
  ["management change", "management_change"],
  ["change in management", "management_change"],
  ["changes in management", "management_change"],
  ["management", "management_change"],
  ["investor meetings", "investor_meetings"],
  ["investor meeting", "investor_meetings"],
  ["investor meets", "investor_meetings"],
  ["insider trading", "insider_trading"],
  ["insider trades", "insider_trading"],
  ["earnings calls", "earnings_call"],
  ["earnings call", "earnings_call"],
  ["conference call", "earnings_call"],
  ["credit ratings", "credit_rating"],
  ["credit rating", "credit_rating"],
  ["postal ballot", "postal_ballot"],
  ["press releases", "press_release"],
  ["press release", "press_release"],
  ["fund raising", "fund_raise"],
  ["fund raise", "fund_raise"],
  ["bonus or split", "bonus_split"],
  ["bonus split", "bonus_split"],
  ["m and a", "m_and_a"],
  ["m&a", "m_and_a"],
  ["mergers", "m_and_a"],
  ["acquisitions", "m_and_a"],
  ["acquisition", "m_and_a"],
  ["quarterly results", "results"],
  ["results", "results"],
  ["result", "results"],
  ["dividends", "dividend"],
  ["dividend", "dividend"],
  ["litigation", "litigation"],
  ["lawsuits", "litigation"],
  ["lawsuit", "litigation"],
  ["pledges", "pledging"],
  ["pledging", "pledging"],
  ["pledge", "pledging"],
  ["capex", "capex"],
  ["capital expenditure", "capex"],
  ["agm", "agm_egm"],
  ["egm", "agm_egm"],
  ["bonus", "bonus_split"],
  ["split", "bonus_split"],
  ["routine filings", "unclassified"],
  ["routine", "unclassified"],
  ["unclassified", "unclassified"],
]);

const BOOK =
  /\b(?:my portfolio|the portfolio|our portfolio|the book|whole book|the whole book|everything i hold)\b/;

const PRICE_RES = [
  /^(?:please\s+)?set\s+(?:a\s+)?price\s+alert\s+to\s+(\d+(?:\.\d+)?)\s*(?:%|percent)(?!\w)(.*)$/,
  /^(?:please\s+)?(?:tell me if|tell me when|alert me if|alert me when|let me know if|let me know when|notify me if)\s+(?:it|the price|the stock|price)\s+moves?\s+(?:more than|over|by|at least)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)(?!\w)(.*)$/,
  /^(?:please\s+)?price\s+alert\s+(?:to|at|of)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)(?!\w)(.*)$/,
];

const VOLUME_RE =
  /^(?:please\s+)?(?:set\s+(?:a\s+)?volume\s+alert\s+to|volume\s+(?:over|above|more than))\s+(\d+(?:\.\d+)?)\s*(?:x|times)\b(.*)$/;

const CATEGORY_RE =
  /^(?:please\s+)?(?:always\s+tell\s+me\s+about|always\s+surface|always\s+watch|watch(?:\s+for)?|notify\s+me\s+(?:about|of|on)|alert\s+me\s+(?:about|on|of|to)|let\s+me\s+know\s+about)\s+(.+)$/;

export type CompanyReply =
  | { kind: "results"; card: ResultsCard | null }
  | { kind: "promises"; rows: LedgerRowView[] }
  | { kind: "reading"; block: PullBlock }
  | { kind: "rule"; sentence: string }
  | { kind: "rejected"; sentence: string }
  | { kind: "error"; message: string }
  | { kind: "ask" };

export type CompanyIntent =
  | { kind: "results" }
  | { kind: "promises" }
  | { kind: "reading"; title: PullTitle }
  | { kind: "rule"; scope: "symbol" | "book"; rule: Tripwire }
  | { kind: "rejected"; sentence: string }
  | { kind: "ask" };

export interface AskChip {
  label: string;
  quote: string | null;
}

export function scoredPromises<
  T extends { verdict: string | null; status: string },
>(rows: T[]): T[] {
  return rows
    .filter(
      (r) =>
        r.status !== "superseded" &&
        r.verdict != null &&
        (SCORED as readonly string[]).includes(r.verdict),
    )
    .sort(
      (a, b) => (RANK[a.verdict ?? ""] ?? 9) - (RANK[b.verdict ?? ""] ?? 9),
    );
}

export function tripwireId(
  userId: string,
  kind: string,
  scope: "symbol" | "book",
  isin: string,
): string {
  if (scope === "book") return `${userId}:${kind}`;
  return `${userId}:${kind}:${isin}`;
}

/** Book-wide category rules keep what was already watched and add the new ones. */
function isCategory(c: string): c is Category {
  return (CATEGORIES as readonly string[]).includes(c);
}

export function mergeCategoryList(
  prev: readonly string[] | null,
  next: readonly string[],
): Category[] {
  const out: Category[] = [];
  for (const c of [...(prev ?? []), ...next]) {
    if (!isCategory(c) || out.includes(c)) continue;
    out.push(c);
  }
  return out;
}

export function confirmRule(
  symbol: string,
  scope: "symbol" | "book",
  rule: Tripwire,
): string {
  if (rule.kind === "price_move") {
    const who = scope === "book" ? "a portfolio name" : symbol;
    return `I’ll tell you when ${who} moves more than ${plainNum(rule.params.pct)}% in a day.`;
  }
  if (rule.kind === "volume_ratio") {
    const where = scope === "book" ? "the portfolio" : symbol;
    return `I’ll tell you when volume on ${where} is over ${plainNum(rule.params.ratio)}× its ${rule.params.lookbackDays}-day average.`;
  }
  if (rule.kind === "category") {
    const where = scope === "book" ? "the portfolio" : symbol;
    const names = rule.params.categories.map((c) =>
      categoryLabel(c).toLowerCase(),
    );
    return `I’ll tell you about ${joinAnd(names)} for ${where}.`;
  }
  const where = scope === "book" ? "the portfolio" : symbol;
  return `I’ll tell you when a filing on ${where} matches that text.`;
}

export function parseCompanyTurn(raw: string): CompanyIntent {
  const text = normalize(raw);
  if (!text) return { kind: "ask" };
  const scope = BOOK.test(text) ? "book" : "symbol";
  const body = stripBook(text);

  const price = parsePrice(body);
  if (price) return withScope(price, scope);
  const volume = parseVolume(body);
  if (volume) return withScope(volume, scope);
  const categories = parseCategories(body);
  if (categories) {
    return {
      kind: "rule",
      scope,
      rule: { kind: "category", params: { categories } },
    };
  }

  const core = commandCore(body);
  if (RESULTS.has(core)) return { kind: "results" };
  if (PROMISES.has(core)) return { kind: "promises" };
  const title = READING_BY_COMMAND[core];
  if (title) return { kind: "reading", title };
  return { kind: "ask" };
}

export function clipAskAnswer(raw: string, maxSentences = 3): string {
  const text = stripMarkdown(raw);
  if (!text) return "";
  const sentences: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    buf += ch;
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    if (ch === "." && /\d/.test(prev) && /\d/.test(next)) continue;
    if (next !== "" && !/\s/.test(next)) continue;
    const sentence = buf.trim();
    if (sentence) sentences.push(sentence);
    buf = "";
    if (sentences.length >= maxSentences) break;
  }
  const rest = buf.trim();
  if (rest && sentences.length < maxSentences) sentences.push(rest);
  return sentences.slice(0, maxSentences).join(" ");
}

export function presentAsk(input: {
  answer: string;
  notInFilings: boolean;
  citations: Array<{ ref: string; quote?: string | null }>;
}): { text: string; chips: AskChip[] } {
  const chips = input.citations
    .filter((c) => c.ref.trim())
    .map((c) => ({
      label: c.ref.trim(),
      quote: c.quote?.trim() ? c.quote.trim() : null,
    }));
  if (input.notInFilings) return { text: NOT_IN_FILINGS_LINE, chips };
  return { text: clipAskAnswer(input.answer), chips };
}

function withScope(
  found: { rule: Tripwire } | { reject: string },
  scope: "symbol" | "book",
): CompanyIntent {
  if ("reject" in found) return { kind: "rejected", sentence: found.reject };
  return { kind: "rule", scope, rule: found.rule };
}

function parsePrice(
  body: string,
): { rule: Tripwire } | { reject: string } | null {
  for (const re of PRICE_RES) {
    const m = re.exec(body);
    if (!m?.[1]) continue;
    if (!tailOk(m[2] ?? "")) return null;
    const pct = Number(m[1]);
    if (!Number.isFinite(pct)) return null;
    if (pct < 0.5 || pct > 30)
      return { reject: "Price alerts run from 0.5% to 30%." };
    return { rule: { kind: "price_move", params: { pct } } };
  }
  return null;
}

function parseVolume(
  body: string,
): { rule: Tripwire } | { reject: string } | null {
  const m = VOLUME_RE.exec(body);
  if (!m?.[1]) return null;
  const ratio = Number(m[1]);
  if (!Number.isFinite(ratio)) return null;
  const taken = takeLookback((m[2] ?? "").trim());
  if (taken.bad)
    return { reject: "The volume average runs from 5 to 60 days." };
  if (!tailOk(taken.rest)) return null;
  if (ratio < 1 || ratio > 10)
    return { reject: "Volume alerts run from 1× to 10×." };
  return {
    rule: {
      kind: "volume_ratio",
      params: { ratio, lookbackDays: taken.days ?? 20 },
    },
  };
}

function parseCategories(body: string): Category[] | null {
  const m = CATEGORY_RE.exec(body);
  if (!m?.[1]) return null;
  const found: Category[] = [];
  for (const piece of pieces(m[1])) {
    const cat = CATEGORY_ALIAS.get(piece);
    if (!cat) return null;
    if (!found.includes(cat)) found.push(cat);
  }
  return found.length ? found : null;
}

function pieces(tail: string): string[] {
  return tail
    .split(/\s*,\s*|\s+&\s+|\s+\band\b\s+/)
    .map((s) =>
      s
        .replace(/^(?:a|an|the|every|any|all|filings?|about)\s+/, "")
        .replace(/\s+filings?$/, "")
        .trim(),
    )
    .filter(Boolean);
}

function takeLookback(tail: string): {
  days: number | null;
  rest: string;
  bad: boolean;
} {
  const m = /^(?:its\s+)?(\d+)\s*-?\s*day(?:\s+average)?\b\s*(.*)$/.exec(tail);
  if (!m?.[1]) return { days: null, rest: tail, bad: false };
  const days = Number(m[1]);
  if (!Number.isInteger(days) || days < 5 || days > 60)
    return { days, rest: m[2] ?? "", bad: true };
  return { days, rest: m[2] ?? "", bad: false };
}

function tailOk(tail: string): boolean {
  const t = tail
    .trim()
    .replace(/^(?:please|thanks|thank you)\b/, "")
    .replace(/^(?:in a day|a day|per day)\b/, "")
    .replace(/^(?:for|on)\s+[a-z0-9&.-]{1,20}\b/, "")
    .trim();
  return t.length === 0;
}

function commandCore(text: string): string {
  return text
    .replace(/^(?:please\s+)+/, "")
    .replace(/^(?:show me|show|get me|give me|open|pull|get)\s+/, "")
    .replace(/^(?:the|a|an)\s+/, "")
    .trim();
}

function stripBook(text: string): string {
  return text
    .replace(
      /\b(?:for|on|across|in|over)\s+(?:my portfolio|the portfolio|our portfolio|the book|the whole book|my whole book)\b/g,
      " ",
    )
    .replace(BOOK, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/×/g, "x")
    .replace(/\u00a0/g, " ")
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(/[?!;:()[\]"]/g, " ")
    .replace(/[^a-z0-9%&.'x\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainNum(n: number): string {
  return groupIndian(n, Number.isInteger(n) ? 0 : 1);
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "a filing";
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`;
}
