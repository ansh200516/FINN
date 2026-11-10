/**
 * One chat turn, two model calls. The first call picks tools and does not
 * answer. We run those tools. The second call sees only the sentence and
 * the JSON the tools returned, and writes the bubble. Cards stay the tool
 * payloads. Nothing here matches phrases to tools.
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
  FINNIE_NO_MATCH,
  FINNIE_OUT_OF_CALLS,
  FINNIE_TOOLS,
  type FinnieCard,
  type FinniePrior,
  type FinnieTool,
  type FinnieTurnResult,
  MAX_TOOL_CALLS,
  type ToolArgs,
  type ToolOutcome,
} from "@/lib/finnieTypes";

const Args = z.object({
  symbol: z.string().optional(),
  symbolA: z.string().optional(),
  symbolB: z.string().optional(),
  which: z.string().optional(),
  name: z.string().optional(),
  scope: z.string().optional(),
  kind: z.string().optional(),
  window: z.string().optional(),
  pct: z.number().optional(),
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

const ToolCall = z.object({
  tool: z
    .enum(FINNIE_TOOLS)
    .describe("One tool from the list. This step does not answer."),
  args: Args,
});

/** Tool step. No say. At most four calls are run. */
export const FinnieCalls = z.object({
  calls: z.array(ToolCall).max(MAX_TOOL_CALLS),
});

/** Answer step. The bubble, and nothing else. */
export const FinnieSay = z.object({
  say: z.string(),
});

const TOOL_SYSTEM = [
  "You are Finnie, a research desk.",
  "Choose tools. Do not answer the user. Do not write a sentence.",
  "Return JSON whose calls array holds one to four objects. Each object has tool and args.",
  "tool is one name from the tool list. args is an object, empty when the tool needs nothing.",
  "A factual question must use a tool. Return more than one call when the question needs more than one tool.",
  "If no tool fits, return a calls array with nothing in it.",
  "Do not recommend.",
].join(" ");

const ANSWER_SYSTEM = [
  "You write say for Finnie.",
  "say is a short answer a person can use.",
  "Use only the JSON after the question.",
  "If the JSON does not contain a fact, do not state that fact.",
  "Write about the companies and what the rows say. Do not answer with only a count.",
  "No buy. No sell. No target price.",
  'If the person asked whether to buy, sell, or act, end with "The decision is yours."',
].join(" ");

const TOOL_LIST = [
  "list_portfolio()",
  "add_to_portfolio(symbol) — add an NSE symbol; already_in if it is in the book",
  "remove_from_portfolio(symbol)",
  "get_results(symbol)",
  "get_promises(symbol)",
  "get_reading(symbol, which) — Business snapshot, Financial snapshot, Trajectory, Balance sheet, Cash quality, Narrative vs. numbers, Guidance, Bull vs. bear",
  "get_quote(symbol)",
  "get_index(name)",
  "get_corporate_actions(symbol)",
  "set_alert(scope, kind, params) — replaces the threshold. scope is one symbol or book; kind is price_move, volume_ratio, category, or text. enabled false turns that rule off",
  "disable_alert(scope, kind) — turns off price_move, volume_ratio, or an announcement category, for one symbol or the book",
  "open_company(symbol) — returns /c/SYMBOL",
  "get_brief(window) — the Act list: companies with something to deal with now, plus the watch count and the filed-away count. Omit window for the brief on screen. Otherwise 24h, 48h, 7d, 30d, or close",
  "list_unread() — inbox rows with no read time",
  "mark_read() — mark those unread rows read",
  "get_upcoming() — board meetings, results, and calls already on the brief",
  "missed_promises() — missed or cut promises across the book",
  "movers(pct) — book names whose latest stored session moved at least pct, default 5",
  "get_management(symbol) — latest management-change card",
  "compare(symbolA, symbolB) — both results headlines",
].join("\n");

type Chosen = { tool: FinnieTool; args: ToolArgs };

export async function runFinnieTurn(
  sentence: string,
  focus: string | null,
  prior?: FinniePrior | null,
): Promise<FinnieTurnResult> {
  const text = sentence.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!text) return quiet("Name a company.");
  const open = focusSymbol(focus);
  const earlier = cleanPrior(prior);
  if (await modelAtSoftCap("bulk")) return quiet(FINNIE_OUT_OF_CALLS);

  let chosen: Chosen[] = [];
  try {
    const picked = await callStructured({
      task: "finnie",
      tier: "bulk",
      schema: FinnieCalls,
      prompt: toolPrompt(text, earlier, open),
      system: TOOL_SYSTEM,
      promptVersion: "5",
      temperature: 0,
      maxTokens: 512,
    });
    chosen = readCalls(picked.data);
  } catch {
    return quiet(FINNIE_NO_MATCH);
  }
  if (!chosen.length) return quiet(FINNIE_NO_MATCH);

  const tools: string[] = [];
  const outcomes: ToolOutcome[] = [];
  const carry = Boolean(earlier);
  for (const call of chosen) {
    tools.push(call.tool);
    outcomes.push(await runTool(call.tool, call.args, open, carry));
  }

  const json = JSON.stringify(
    outcomes.map((outcome, index) => ({
      tool: tools[index],
      data: outcome.fact,
    })),
  );
  let say = "";
  try {
    const answered = await callStructured({
      task: "finnie",
      tier: "bulk",
      schema: FinnieSay,
      prompt: `${text}\n${json}`,
      system: ANSWER_SYSTEM,
      promptVersion: "5",
      temperature: 0,
      maxTokens: 512,
    });
    say = readSay(answered.data);
  } catch {
    say = "";
  }
  return present(say, tools, outcomes);
}

function toolPrompt(
  sentence: string,
  prior: FinniePrior | null,
  focus: string | null,
): string {
  const lines = [`Sentence: ${sentence}`];
  if (prior) lines.push(`Previous sentence: ${prior.sentence}`);
  if (focus) lines.push(`Open company: ${focus}`);
  lines.push("", "Tools:", TOOL_LIST);
  return lines.join("\n");
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

function present(
  say: string,
  tools: string[],
  outcomes: ToolOutcome[],
): FinnieTurnResult {
  const cards: FinnieCard[] = [];
  let href: string | null = null;
  let link: string | null = null;
  let symbol: string | null = null;
  let book: FinnieTurnResult["book"] = null;
  for (const outcome of outcomes) {
    if (outcome.card) cards.push(outcome.card);
    if (outcome.href) href = outcome.href;
    if (outcome.link) link = outcome.link;
    if (outcome.symbol) symbol = outcome.symbol;
    if (outcome.book) book = outcome.book;
  }
  return {
    say,
    tools,
    card: cards.at(-1) ?? null,
    cards,
    sayAfter: false,
    href,
    link,
    symbol,
    book,
  };
}

function quiet(say: string): FinnieTurnResult {
  return {
    say,
    tools: [],
    card: null,
    cards: [],
    sayAfter: false,
    href: null,
    link: null,
    symbol: null,
    book: null,
  };
}

function readSay(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const say = (data as { say?: unknown }).say;
  if (typeof say !== "string") return "";
  return say.replace(/\s+/g, " ").trim();
}

function readCalls(data: unknown): Chosen[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as { calls?: unknown }).calls;
  if (!Array.isArray(raw)) return [];
  const out: Chosen[] = [];
  for (const item of raw) {
    if (out.length >= MAX_TOOL_CALLS) break;
    if (!item || typeof item !== "object") continue;
    const name = (item as { tool?: unknown }).tool;
    if (typeof name !== "string") continue;
    const tool = knownTool(name);
    if (!tool) continue;
    out.push({
      tool,
      args: readArgs((item as { args?: unknown }).args),
    });
  }
  return out;
}

function knownTool(name: string): FinnieTool | null {
  const tool = name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (FINNIE_TOOLS as readonly string[]).includes(tool)
    ? (tool as FinnieTool)
    : null;
}

function readArgs(value: unknown): ToolArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ToolArgs;
}

function cleanPrior(prior: FinniePrior | null | undefined): FinniePrior | null {
  if (!prior || typeof prior.sentence !== "string") return null;
  const sentence = prior.sentence.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!sentence) return null;
  const tool =
    typeof prior.tool === "string" &&
    (FINNIE_TOOLS as readonly string[]).includes(prior.tool)
      ? prior.tool
      : null;
  return { sentence, tool };
}

function focusSymbol(focus: string | null): string | null {
  if (!focus) return null;
  const symbol = focus.trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}

async function runTool(
  tool: FinnieTool,
  args: ToolArgs,
  focus: string | null,
  carry: boolean,
): Promise<ToolOutcome> {
  try {
    return await executeTool(tool, args, focus, carry);
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
