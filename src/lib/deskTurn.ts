/**
 * The desk turn. A sentence names a company, asks for one card, or
 * changes a tripwire. Rules run before any model call.
 */
import { parseCompanyTurn } from "@/lib/companyTurn";
import { classifyLiveAsk } from "@/lib/nseLive";

export interface DeskCompany {
  symbol: string;
  name: string;
  aliases: string[];
}

export interface DeskLine {
  symbol: string;
  sentence: string;
}

export type DeskParse =
  | { kind: "empty" }
  | { kind: "context"; symbol: string }
  | { kind: "need-company" }
  | { kind: "brief" }
  | { kind: "watch" }
  | { kind: "rejected"; sentence: string }
  | {
      kind: "rule";
      symbol: string | null;
      scope: "symbol" | "book";
      text: string;
    }
  | { kind: "card"; symbol: string; text: string }
  | { kind: "live"; text: string; symbol: string | null }
  | { kind: "ask"; symbol: string; question: string };

export const NAME_THE_COMPANY = "Name the company.";

const BRIEF = new Set([
  "what needs a decision",
  "what needs me",
  "what should i act on",
  "what do i need to do",
  "anything to act on",
  "what's the brief",
  "whats the brief",
  "what is the brief",
  "what's on",
  "whats on",
  "what is on",
]);

const WATCH = new Set([
  "what should i watch",
  "what's to watch",
  "whats to watch",
  "what is there to watch",
  "what's there to watch",
  "anything to watch",
  "what do i watch",
]);

/** Words that are commands or English, not tickers, unless typed in caps. */
const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "nor",
  "but",
  "if",
  "it",
  "to",
  "of",
  "on",
  "at",
  "by",
  "in",
  "is",
  "am",
  "as",
  "be",
  "we",
  "my",
  "me",
  "no",
  "so",
  "up",
  "us",
  "do",
  "did",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "show",
  "open",
  "tell",
  "ask",
  "set",
  "alert",
  "price",
  "volume",
  "about",
  "from",
  "with",
  "this",
  "that",
  "they",
  "them",
  "your",
  "have",
  "has",
  "was",
  "were",
  "are",
  "not",
  "can",
  "all",
  "any",
  "out",
  "our",
  "its",
  "into",
  "over",
  "more",
  "than",
  "just",
  "only",
  "results",
  "result",
  "promises",
  "promise",
  "guidance",
  "cash",
  "watch",
  "always",
  "please",
  "name",
  "book",
  "portfolio",
  "bank",
  "india",
  "state",
  "national",
  "industries",
  "industry",
  "limited",
  "company",
  "services",
  "international",
  "group",
  "holdings",
]);

const CONTEXT_ONLY =
  /^(?:please\s+)?(?:show(?:\s+me)?|open|switch(?:\s+to)?|look(?:\s+at)?|go(?:\s+to)?|pull(?:\s+up)?|bring(?:\s+up)?|see|tell\s+me(?:\s+about)?|ask(?:\s+about)?)$/i;

const LEGAL =
  /\b(?:ltd|limited|inc|incorporated|corp|corporation|co|plc|pvt|private|company)\b\.?/gi;

interface Phrase {
  phrase: string;
  symbol: string;
  caps: boolean;
}

interface Hit {
  symbol: string;
  start: number;
  end: number;
  len: number;
}

export function contextLine(symbol: string): string {
  return `On ${symbol}.`;
}

export function formatLines(
  head: (n: number) => string,
  empty: string,
  lines: DeskLine[],
  cap = 4,
): string {
  if (!lines.length) return empty;
  const shown = lines.slice(0, cap);
  const more = lines.length - shown.length;
  const body = shown.map((l) => `${l.symbol}. ${l.sentence}`).join(" ");
  if (lines.length === 1) return body;
  return [head(lines.length), body, more ? `${more} more.` : ""]
    .filter(Boolean)
    .join(" ");
}

export function parseDeskTurn(
  raw: string,
  companies: DeskCompany[],
  active: string | null,
): DeskParse {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  const hit = findCompany(text, companies);
  const rest = hit ? chooseRest(text, hit.start, hit.end) : text;
  const intent = parseCompanyTurn(rest);
  if (intent.kind === "rejected")
    return { kind: "rejected", sentence: intent.sentence };
  if (isPhrase(rest, BRIEF) || (!hit && isPhrase(text, BRIEF)))
    return { kind: "brief" };
  if (isPhrase(rest, WATCH) || (!hit && isPhrase(text, WATCH)))
    return { kind: "watch" };
  if (hit && (rest === "" || CONTEXT_ONLY.test(rest)))
    return { kind: "context", symbol: hit.symbol };

  const symbol = hit?.symbol ?? (active ? active.trim().toUpperCase() : null);

  if (intent.kind === "rule") {
    const scope: "symbol" | "book" =
      intent.scope === "book" || !symbol ? "book" : "symbol";
    return {
      kind: "rule",
      symbol: scope === "symbol" ? symbol : null,
      scope,
      text: rest,
    };
  }
  if (intent.kind === "live") {
    const focus = hit?.symbol ?? (active ? active.trim().toUpperCase() : null);
    const live = classifyLiveAsk(rest, focus);
    if (live?.kind === "quote")
      return { kind: "live", text: rest, symbol: live.symbol };
    if (live?.kind === "index" || live?.kind === "status")
      return { kind: "live", text: rest, symbol: null };
    return { kind: "need-company" };
  }
  if (!symbol) return { kind: "need-company" };
  if (intent.kind === "ask") return { kind: "ask", symbol, question: text };
  return { kind: "card", symbol, text: rest };
}

function isPhrase(raw: string, set: Set<string>): boolean {
  return set.has(norm(raw));
}

function norm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseRest(raw: string, start: number, end: number): string {
  const plain = collapse(`${raw.slice(0, start)} ${raw.slice(end)}`);
  const trimmed = plain.replace(/\b(?:for|on|at|regarding)\s*$/i, "").trim();
  if (command(trimmed) && !command(plain)) return trimmed;
  return plain;
}

function command(s: string): boolean {
  if (!s || CONTEXT_ONLY.test(s)) return false;
  return parseCompanyTurn(s).kind !== "ask";
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function findCompany(raw: string, companies: DeskCompany[]): Hit | null {
  let best: Hit | null = null;
  for (const phrase of phrases(companies)) {
    const re = new RegExp(
      `(?:^|[^A-Za-z0-9&])(${escapeReg(phrase.phrase)})(?=$|[^A-Za-z0-9&])`,
      "gi",
    );
    for (const m of raw.matchAll(re)) {
      const text = m[1];
      if (!text || m.index == null) continue;
      if (phrase.caps && !isTickerCase(text)) continue;
      const start = m.index + m[0].length - text.length;
      const len = text.length;
      const hit: Hit = { symbol: phrase.symbol, start, end: start + len, len };
      if (
        !best ||
        hit.len > best.len ||
        (hit.len === best.len && hit.start < best.start)
      )
        best = hit;
    }
  }
  return best;
}

function phrases(companies: DeskCompany[]): Phrase[] {
  const out: Phrase[] = [];
  const firsts = new Map<string, Set<string>>();
  for (const c of companies) {
    const symbol = c.symbol.trim().toUpperCase();
    if (symbol.length < 2) continue;
    add(out, symbol, symbol);
    for (const alias of c.aliases) add(out, alias.trim(), symbol);
    const name = c.name.trim();
    if (name) add(out, name, symbol);
    const short = name.replace(LEGAL, "").replace(/\s+/g, " ").trim();
    if (short && short.toLowerCase() !== name.toLowerCase())
      add(out, short, symbol);
    const first = short.split(/\s+/)[0] ?? "";
    if (
      first.length >= 4 &&
      !STOP.has(first.toLowerCase()) &&
      first.toUpperCase() !== symbol
    ) {
      const key = first.toLowerCase();
      const set = firsts.get(key) ?? new Set<string>();
      set.add(symbol);
      firsts.set(key, set);
    }
  }
  for (const [token, symbols] of firsts) {
    if (symbols.size === 1) {
      const symbol = [...symbols][0];
      if (symbol) add(out, token, symbol);
    }
  }
  return out;
}

function add(out: Phrase[], phrase: string, symbol: string): void {
  const clean = phrase.trim();
  if (clean.length < 2 || clean.length > 80) return;
  out.push({ phrase: clean, symbol, caps: tickerOnly(clean) });
}

function tickerOnly(phrase: string): boolean {
  if (/\s/.test(phrase)) return false;
  if (STOP.has(phrase.toLowerCase())) return true;
  const letters = phrase.replace(/[^A-Za-z0-9]/g, "");
  return letters.length <= 2 && !phrase.includes("&");
}

function isTickerCase(text: string): boolean {
  return text === text.toUpperCase() && /[A-Z]/.test(text);
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
