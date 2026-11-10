/**
 * One chat turn. The first call sees the tool catalog and the thread,
 * and names the calls. It does not answer. The second call sees the
 * sentence, the thread, and the JSON those calls returned, and writes
 * the bubble. The code does not pick a tool from the wording.
 */
import { z } from "zod";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  remainingBudget,
} from "@/engine/llm/gateway";
import type { LlmTier } from "@/engine/types";
import { executeTool } from "@/lib/finnieTools";
import {
  FINNIE_CHAIN_CAP,
  FINNIE_NO_MATCH,
  FINNIE_OUT_OF_CALLS,
  FINNIE_TOOLS,
  type FinnieCard,
  type FinnieMemory,
  type FinnieTool,
  type FinnieTurnResult,
  MAX_TOOL_CALLS,
  type ToolArgs,
  type ToolOutcome,
} from "@/lib/finnieTypes";

const CHAIN_USER_CAP = 500;
const CHAIN_SAY_CAP = 800;
const LINK_CAP = 5;

const ToolArgsSchema = z.object({
  symbol: z.string().optional(),
  symbolA: z.string().optional(),
  symbolB: z.string().optional(),
  which: z.string().optional(),
  name: z.string().optional(),
  scope: z.string().optional(),
  kind: z.string().optional(),
  window: z.string().optional(),
  pct: z.number().optional(),
  quarters: z.number().optional(),
  enabled: z.boolean().optional(),
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

const ToolCallSchema = z.object({
  tool: z.enum(FINNIE_TOOLS),
  args: ToolArgsSchema.optional(),
});

/** The first call. An empty list means nothing in the catalog applies. */
export const ToolPlan = z.object({
  calls: z.array(ToolCallSchema).max(MAX_TOOL_CALLS),
});

/** The second call. say is the bubble. */
export const FinnieSay = z.object({
  say: z.string(),
});

const TOOL_LINES: Record<FinnieTool, string> = {
  list_portfolio: "Symbols and names in the book.",
  add_to_portfolio: "Add one symbol to the book. args.symbol.",
  remove_from_portfolio: "Remove one symbol from the book. args.symbol.",
  get_results:
    "Results for one symbol. args.symbol. args.quarters is 1 to 8 and defaults to 4: each period with revenue or NII, EBITDA or PPOP, PAT, and year-on-year when computed.",
  get_promises:
    "Guidance for one symbol, up to 12 rows: quote, metric, promised value, verdict, and delivered value. args.symbol.",
  get_reading:
    "One of the eight readings for a symbol. args.symbol. args.which is the reading name.",
  get_quote: "Live price for one symbol. args.symbol.",
  get_index: "Live index level. args.name.",
  get_corporate_actions: "Corporate actions for one symbol. args.symbol.",
  set_alert:
    "Turn on a price, volume, or category alert. args.scope, args.kind, args.params.",
  disable_alert: "Turn off an alert. args.scope, args.kind, args.params.",
  open_company: "Page for one symbol. args.symbol.",
  get_brief: "Act lines on the brief. args.window is optional.",
  list_unread: "Unread inbox rows.",
  mark_read: "Mark the inbox read.",
  get_upcoming: "Upcoming filings and events.",
  missed_promises: "Missed or cut guidance across the book.",
  movers: "Holdings that moved. args.pct is optional.",
  get_management: "People changes for one symbol. args.symbol.",
  compare: "Latest results for two symbols. args.symbolA and args.symbolB.",
};

const PLAN_SYSTEM = [
  "You are Finnie.",
  "Choose tools for the latest sentence. Do not answer it.",
  "The catalog is the only data in this call. The book is not included.",
  "Return 1 to 4 calls. If no tool applies, return an empty calls list.",
  "args are optional. Use args.symbol for a company.",
  "get_results may set args.quarters from 1 to 8. Omitted, it is 4.",
  "Do not invent a tool.",
].join(" ");

const ANSWER_SYSTEM = [
  "You are Finnie.",
  "Answer the latest sentence using only the tool JSON.",
  "say is that answer.",
  "Do not state a number or a name that is not in the tool JSON.",
  "No buy. No sell. No target price.",
  "If the tool JSON includes results and promises, the sentence has to use both payloads.",
  "Walk the quarters against the guidance rows. Do not stop at the latest revenue figure.",
  "When delivered is null, say that row is not yet scored and include its quote.",
  'When the question asks for a comparison or a judgment, end with "The decision is yours."',
  "Do not invent guidance.",
].join(" ");

interface PlanCall {
  tool: FinnieTool;
  args: ToolArgs;
}

interface Ran {
  tool: FinnieTool;
  outcome: ToolOutcome;
}

export async function runFinnieTurn(
  sentence: string,
  focus: string | null,
  prior?: unknown,
): Promise<FinnieTurnResult> {
  const text = sentence.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!text) return quiet("Name a company.");
  const open = focusSymbol(focus);
  const memory = clipChain(prior);
  if (await modelAtSoftCap("bulk")) return quiet(FINNIE_OUT_OF_CALLS);

  let calls: PlanCall[];
  try {
    const planned = await callStructured({
      task: "finnie",
      tier: "bulk",
      schema: ToolPlan,
      prompt: planPrompt(text, memory),
      system: PLAN_SYSTEM,
      promptVersion: "plan-1",
      temperature: 0,
      maxTokens: 512,
    });
    calls = planned.data.calls.map((call) => ({
      tool: call.tool,
      args: call.args ?? {},
    }));
  } catch {
    return quiet(FINNIE_NO_MATCH);
  }
  if (!calls.length) return quiet(FINNIE_NO_MATCH);

  const ran: Ran[] = [];
  for (const call of calls) {
    try {
      const outcome = await executeTool(
        call.tool,
        call.args,
        open,
        Boolean(open),
      );
      ran.push({ tool: call.tool, outcome });
    } catch {
      ran.push({
        tool: call.tool,
        outcome: {
          fact: { error: "That did not run.", tool: call.tool },
          card: null,
          symbol: null,
          href: null,
          link: null,
          book: null,
        },
      });
    }
  }

  let say = "";
  try {
    const answered = await callStructured({
      task: "finnie",
      tier: "bulk",
      schema: FinnieSay,
      prompt: answerPrompt(text, memory, ran),
      system: ANSWER_SYSTEM,
      promptVersion: "answer-2",
      temperature: 0,
      maxTokens: 1024,
    });
    say = cleanSay(answered.data.say);
  } catch {
    return present(FINNIE_NO_MATCH, ran, open);
  }
  if (!say) return present(FINNIE_NO_MATCH, ran, open);
  return present(say, ran, open);
}

function planPrompt(sentence: string, memory: FinnieMemory[]): string {
  const lines = [`Question: ${sentence}`];
  const thread = formatThread(memory);
  if (thread) lines.push("", thread);
  lines.push("", "Catalog:", catalogText());
  return lines.join("\n");
}

function answerPrompt(
  sentence: string,
  memory: FinnieMemory[],
  ran: Ran[],
): string {
  const lines = [`Question: ${sentence}`];
  const thread = formatThread(memory);
  if (thread) lines.push("", thread);
  const facts = ran.map((item) => ({
    tool: item.tool,
    data: item.outcome.fact,
  }));
  lines.push("", "Tools:", JSON.stringify(facts));
  return lines.join("\n");
}

function catalogText(): string {
  return FINNIE_TOOLS.map((name) => `${name}: ${TOOL_LINES[name]}`).join("\n");
}

function formatThread(memory: FinnieMemory[]): string {
  if (!memory.length) return "";
  const lines = ["Thread:"];
  for (const turn of memory) {
    if (turn.user) lines.push(`User: ${turn.user}`);
    if (turn.say) lines.push(`Finnie: ${turn.say}`);
  }
  return lines.join("\n");
}

function present(
  say: string,
  ran: Ran[],
  focus: string | null,
): FinnieTurnResult {
  const cards: FinnieCard[] = [];
  const pages: Array<string | null> = [];
  const links: Array<{ href: string; label: string }> = [];
  let book: FinnieTurnResult["book"] = null;
  let symbol = focus;
  let href: string | null = null;
  let link: string | null = null;
  for (const item of ran) {
    const outcome = item.outcome;
    if (outcome.book) book = outcome.book;
    if (outcome.symbol) symbol = outcome.symbol;
    if (outcome.card) {
      cards.push(outcome.card);
      pages.push(pageFor(outcome));
    } else {
      const page = pageFor(outcome);
      if (page) links.push({ href: page, label: "Full page" });
    }
    if (book && outcome.href) {
      href = outcome.href;
      link = outcome.link;
    }
  }
  return {
    say,
    tools: ran.map((item) => item.tool),
    card: cards.at(-1) ?? null,
    cards,
    pages,
    links: links.slice(0, LINK_CAP),
    sayAfter: false,
    href,
    link,
    symbol,
    book,
  };
}

function pageFor(outcome: ToolOutcome): string | null {
  if (outcome.symbol) return `/c/${encodeURIComponent(outcome.symbol)}`;
  if (!outcome.href?.startsWith("/")) return null;
  const hash = outcome.href.indexOf("#");
  return hash === -1 ? outcome.href : outcome.href.slice(0, hash);
}

function clipChain(input: unknown): FinnieMemory[] {
  if (!Array.isArray(input)) return [];
  const out: FinnieMemory[] = [];
  for (const item of input.slice(-FINNIE_CHAIN_CAP)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { user?: unknown; say?: unknown; results?: unknown };
    const user = clipChainText(
      typeof rec.user === "string" ? rec.user : "",
      CHAIN_USER_CAP,
    );
    const say = clipChainText(
      typeof rec.say === "string" ? rec.say : "",
      CHAIN_SAY_CAP,
    );
    if (!user && !say) continue;
    out.push({ user, say, results: readSymbols(rec.results) });
  }
  return out;
}

function clipChainText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max);
}

function readSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const symbol = item.trim().toUpperCase();
    if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)) continue;
    if (out.includes(symbol)) continue;
    out.push(symbol);
  }
  return out;
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

function cleanSay(say: string): string {
  return say.replace(/\s+/g, " ").trim();
}

function focusSymbol(focus: string | null): string | null {
  if (!focus) return null;
  const symbol = focus.trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}
