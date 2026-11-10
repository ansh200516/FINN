/**
 * One chat turn. Every sentence gets the same context from the database.
 * One model call writes the bubble and chooses any cards. A write, when
 * the model asks for one, runs after that call and does not replace the bubble.
 */
import { z } from "zod";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  remainingBudget,
} from "@/engine/llm/gateway";
import type { LlmTier } from "@/engine/types";
import { scoredPromises } from "@/lib/companyTurn";
import {
  type ActLine,
  type ChatContext,
  type ChatPack,
  loadChatPack,
} from "@/lib/finnieContext";
import { executeTool } from "@/lib/finnieTools";
import {
  FINNIE_NO_MATCH,
  FINNIE_OUT_OF_CALLS,
  type FinnieCard,
  type FinniePrior,
  type FinnieTool,
  type FinnieTurnResult,
  type ToolArgs,
  type ToolOutcome,
} from "@/lib/finnieTypes";
import {
  getCompanyBySymbol,
  getCompanyResultsCard,
  getLedger,
} from "@/lib/queries";

const WRITES = [
  "add_to_portfolio",
  "remove_from_portfolio",
  "set_alert",
  "disable_alert",
  "mark_read",
] as const;

const CARD_KINDS = ["results", "promises", "management", "brief"] as const;

type WriteTool = (typeof WRITES)[number];
type CardKind = (typeof CARD_KINDS)[number];

const CARD_CAP = 8;
const LINK_CAP = 5;

const WriteArgs = z.object({
  symbol: z.string().optional(),
  scope: z.string().optional(),
  kind: z.string().optional(),
  enabled: z.boolean().optional(),
  pct: z.number().optional(),
  params: z
    .object({
      pct: z.number().optional(),
      ratio: z.number().optional(),
      lookbackDays: z.number().optional(),
      categories: z.array(z.string()).optional(),
      pattern: z.string().optional(),
      flags: z.string().optional(),
    })
    .optional(),
});

const WriteCall = z.object({
  tool: z.enum(WRITES),
  args: WriteArgs.optional(),
});

const CardPickSchema = z.object({
  symbol: z.string(),
  kind: z.enum(CARD_KINDS),
});

/** The only model call. say is the bubble. The model chooses the cards. */
export const FinnieReply = z.object({
  say: z.string(),
  showList: z.boolean(),
  cards: z.array(CardPickSchema).default([]),
  write: WriteCall.nullable(),
});

const SYSTEM = [
  "You are Finnie.",
  "Answer the user using only the context JSON.",
  "Do not invent a number, a quote, or a name that is not in the JSON.",
  "Do not recite every holding, and do not list the portfolio in order.",
  "Each portfolio row has movePct, results (label, crore, and yoyPct for revenue or NII), promises (kept, missed, open), and href.",
  'For a judgment across the book, say what stands out in brief.act, missed, and movers. At most five companies. End with "The decision is yours."',
  "When the question is about a company, say must use that row's results figure and year-on-year change, and its promise counts. Do not answer with only the price or volume line.",
  "If yoyPct is null, do not invent a year-on-year change. If results is null, say the results are not on file.",
  "No buy. No sell. No target price.",
  "If the context does not contain what they asked, say that in one clause and answer from what is there.",
  "say is that answer. Name a company by its symbol.",
  "showList is true only when the answer is the list of holdings. Otherwise false. The app draws that list.",
  "cards is a list of {symbol, kind} to draw under say. kind is results, promises, management, or brief.",
  "You choose the kind. results draws the results card. promises draws the promise ledger. management draws the people. brief draws that symbol's act row.",
  "For a question about one company, choose results, unless they asked only about promises or only about management.",
  "When they ask which stocks to act on, choose brief for each symbol you name. say stays your sentence. The app draws the act rows.",
  "cards is empty when no card helps.",
  "write is null, or one change: add_to_portfolio, remove_from_portfolio, set_alert, disable_alert, or mark_read.",
  "Do not use a write to fetch data.",
  "If you set a write, say may describe that change.",
  "add_to_portfolio and remove_from_portfolio take args.symbol.",
  "set_alert and disable_alert take args.scope (a symbol or book), args.kind (price_move, volume_ratio, or category), and args.params.",
  "mark_read takes an empty args object.",
].join(" ");

interface CardPick {
  symbol: string;
  kind: CardKind;
}

interface Reply {
  say: string;
  showList: boolean;
  cards: CardPick[];
  write: { tool: WriteTool; args: ToolArgs } | null;
}

interface Drawn {
  card: FinnieCard | null;
  page: string | null;
}

interface PageLink {
  href: string;
  label: string;
}

export async function runFinnieTurn(
  sentence: string,
  focus: string | null,
  _prior?: FinniePrior | null,
): Promise<FinnieTurnResult> {
  const text = sentence.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!text) return quiet("Name a company.");
  const open = focusSymbol(focus);
  if (await modelAtSoftCap("bulk")) return quiet(FINNIE_OUT_OF_CALLS);

  const pack = await loadChatPack(open);
  let reply: Reply;
  try {
    const answered = await callStructured({
      task: "finnie",
      tier: "bulk",
      schema: FinnieReply,
      prompt: userPrompt(text, pack.context),
      system: SYSTEM,
      promptVersion: "8",
      temperature: 0,
      maxTokens: 1024,
    });
    reply = readReply(answered.data);
  } catch {
    return quiet(FINNIE_NO_MATCH);
  }

  let outcome: ToolOutcome | null = null;
  if (reply.write) {
    outcome = await runWrite(reply.write.tool, reply.write.args, open);
  }
  return present(reply, pack, outcome, open);
}

function userPrompt(sentence: string, context: ChatContext): string {
  return `Question: ${sentence}\n\nContext:\n${JSON.stringify(context)}`;
}

async function modelAtSoftCap(tier: LlmTier): Promise<boolean> {
  try {
    const model = MODEL_LADDERS[tier]()[0];
    if (!model) return true;
    const rows = await remainingBudget();
    const row = rows.find((item) => item.model === model);
    const cap = row?.cap ?? dailyCap(model);
    const requests = row?.requests ?? 0;
    if (cap <= 0) return true;
    return requests >= cap * 0.8;
  } catch {
    return false;
  }
}

async function present(
  reply: Reply,
  pack: ChatPack,
  outcome: ToolOutcome | null,
  focus: string | null,
): Promise<FinnieTurnResult> {
  const known = new Set(contextSymbols(pack.context));
  for (const row of pack.names) known.add(row.symbol);
  const drawn = await Promise.all(
    reply.cards.map((pick) =>
      drawPick(pick, pack.act, known).catch(() => null),
    ),
  );
  const cards: FinnieCard[] = [];
  const pages: Array<string | null> = [];
  const links: PageLink[] = [];
  for (const item of drawn) {
    if (!item) continue;
    if (item.card) {
      cards.push(item.card);
      pages.push(item.page);
    } else if (item.page) {
      links.push({ href: item.page, label: "Full page" });
    }
  }
  if (reply.showList && pack.names.length) {
    cards.push({ kind: "portfolio", names: pack.names });
    pages.push(null);
  }
  if (!reply.cards.length) {
    for (const symbol of symbolsNamed(reply.say, [...known])) {
      links.push({ href: companyHref(symbol), label: "Full page" });
    }
  }
  return {
    say: reply.say,
    tools: reply.write ? [reply.write.tool] : [],
    card: cards.at(-1) ?? null,
    cards,
    pages,
    links: links.slice(0, LINK_CAP),
    sayAfter: false,
    href: outcome?.href ?? null,
    link: outcome?.link ?? null,
    symbol: outcome?.symbol ?? focus,
    book: outcome?.book ?? null,
  };
}

async function drawPick(
  pick: CardPick,
  act: ActLine[],
  known: Set<string>,
): Promise<Drawn | null> {
  if (pick.kind === "brief") return drawBrief(pick.symbol, act, known);
  const company = await getCompanyBySymbol(pick.symbol);
  if (!company) return null;
  const symbol = company.nseSymbol.trim().toUpperCase();
  const page = companyHref(symbol);
  if (pick.kind === "results") {
    const card = await getCompanyResultsCard(company.isin);
    return {
      card: { kind: "reply", symbol, reply: { kind: "results", card } },
      page,
    };
  }
  if (pick.kind === "promises") {
    const rows = scoredPromises(await getLedger(company.isin));
    return {
      card: { kind: "reply", symbol, reply: { kind: "promises", rows } },
      page,
    };
  }
  const found = await executeTool("get_management", { symbol }, null, false);
  const href = pageOf(found.href, page);
  if (found.card?.kind === "management" && found.card.people.length) {
    return { card: found.card, page: href };
  }
  return { card: null, page: href };
}

function drawBrief(
  symbol: string,
  act: ActLine[],
  known: Set<string>,
): Drawn | null {
  const rows = act.filter((line) => line.symbol === symbol);
  if (!rows.length && !known.has(symbol)) return null;
  if (!rows.length) return { card: null, page: companyHref(symbol) };
  return {
    card: {
      kind: "lines",
      lines: rows.map((row) => ({
        symbol: row.symbol,
        text: row.sentence,
        href: row.href,
      })),
    },
    page:
      rows.length === 1
        ? (rows[0]?.href ?? companyHref(symbol))
        : companyHref(symbol),
  };
}

function contextSymbols(context: ChatContext): string[] {
  const symbols = new Set<string>();
  for (const row of context.portfolio) symbols.add(row.symbol);
  for (const row of context.brief.act) symbols.add(row.symbol);
  for (const row of context.movers) symbols.add(row.symbol);
  for (const row of context.missed) symbols.add(row.symbol);
  for (const row of context.upcoming) symbols.add(row.symbol);
  if (context.company) symbols.add(context.company.symbol);
  return [...symbols];
}

function symbolsNamed(say: string, symbols: string[]): string[] {
  const haystack = ` ${say.toUpperCase()} `;
  const hits: Array<{ symbol: string; at: number }> = [];
  for (const symbol of symbols) {
    if (!symbol) continue;
    const pattern = new RegExp(`[^A-Z0-9&.-]${escapeReg(symbol)}[^A-Z0-9&.-]`);
    const match = pattern.exec(haystack);
    if (!match) continue;
    hits.push({ symbol, at: match.index });
  }
  hits.sort((a, b) => a.at - b.at || a.symbol.localeCompare(b.symbol));
  return hits.slice(0, LINK_CAP).map((hit) => hit.symbol);
}

function companyHref(symbol: string): string {
  return `/c/${encodeURIComponent(symbol)}`;
}

function pageOf(href: string | null, fallback: string): string {
  if (href && (href.startsWith("/c/") || href.startsWith("/e/"))) return href;
  return fallback;
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quiet(say: string): FinnieTurnResult {
  return {
    say,
    tools: [],
    card: null,
    cards: [],
    pages: [],
    links: [],
    sayAfter: false,
    href: null,
    link: null,
    symbol: null,
    book: null,
  };
}

function readReply(data: unknown): Reply {
  const parsed = FinnieReply.safeParse(data);
  if (parsed.success) {
    return {
      say: cleanSay(parsed.data.say),
      showList: parsed.data.showList,
      cards: normalizePicks(parsed.data.cards),
      write: readWrite(parsed.data.write),
    };
  }
  if (!data || typeof data !== "object") {
    return { say: "", showList: false, cards: [], write: null };
  }
  const rec = data as {
    say?: unknown;
    showList?: unknown;
    cards?: unknown;
    write?: unknown;
  };
  return {
    say: typeof rec.say === "string" ? cleanSay(rec.say) : "",
    showList: rec.showList === true,
    cards: readCards(rec.cards),
    write: readWrite(rec.write),
  };
}

function normalizePicks(
  cards: Array<{ symbol: string; kind: CardKind }>,
): CardPick[] {
  const out: CardPick[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const symbol = card.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)) continue;
    const key = `${card.kind}:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol, kind: card.kind });
    if (out.length >= CARD_CAP) break;
  }
  return out;
}

function readCards(value: unknown): CardPick[] {
  if (!Array.isArray(value)) return [];
  const raw: Array<{ symbol: string; kind: CardKind }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { symbol?: unknown; kind?: unknown };
    if (typeof rec.symbol !== "string" || typeof rec.kind !== "string")
      continue;
    const kind = rec.kind.trim().toLowerCase();
    if (!(CARD_KINDS as readonly string[]).includes(kind)) continue;
    raw.push({ symbol: rec.symbol, kind: kind as CardKind });
  }
  return normalizePicks(raw);
}

function readWrite(value: unknown): { tool: WriteTool; args: ToolArgs } | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { tool?: unknown; args?: unknown };
  if (typeof rec.tool !== "string") return null;
  const tool = rec.tool
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!(WRITES as readonly string[]).includes(tool)) return null;
  const args =
    rec.args && typeof rec.args === "object" && !Array.isArray(rec.args)
      ? (rec.args as ToolArgs)
      : {};
  return { tool: tool as WriteTool, args };
}

function cleanSay(say: string): string {
  return say.replace(/\s+/g, " ").trim();
}

function focusSymbol(focus: string | null): string | null {
  if (!focus) return null;
  const symbol = focus.trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}

async function runWrite(
  tool: WriteTool,
  args: ToolArgs,
  focus: string | null,
): Promise<ToolOutcome> {
  try {
    return await executeTool(tool as FinnieTool, args, focus, Boolean(focus));
  } catch {
    return {
      fact: { error: "That did not run." },
      card: null,
      symbol: null,
      href: null,
      link: null,
      book: null,
    };
  }
}
