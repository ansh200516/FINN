/**
 * One chat turn. The model picks a tool. We run it. Tool results are the
 * only facts in the reply. Four tool calls, then stop.
 */
import { z } from "zod";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  remainingBudget,
} from "@/engine/llm/gateway";
import type { LlmTier } from "@/engine/types";
import { NO_PROMISES, NO_RESULTS } from "@/lib/companyTurn";
import { bookCountLine } from "@/lib/deskTurn";
import { executeTool } from "@/lib/finnieTools";
import {
  FINNIE_DOES_NOT_HAVE,
  FINNIE_MODEL_DOWN,
  FINNIE_OUT_OF_CALLS,
  FINNIE_TOOLS,
  type FinniePrior,
  type FinnieTurnResult,
  MAX_TOOL_CALLS,
  type ToolOutcome,
} from "@/lib/finnieTypes";

const SYSTEM = [
  "You are Finnie, a research desk.",
  "Choose one tool, or finish.",
  "say is one sentence and may use only facts a tool returned.",
  "Do not invent a figure, a quote, or a company.",
  `If the ask is news, a target price, whether to buy, shareholding, delivery data, or whether the market is open, finish with “${FINNIE_DOES_NOT_HAVE}” and call no tool.`,
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
  "get_brief(window) — window is 24h, 48h, 7d, 30d, or since close. Act lines, plus the watch count and the filed-away count",
  "list_unread() — inbox rows with no read time",
  "mark_read() — mark those unread rows read",
  "get_upcoming() — board meetings, results, and calls already on the brief",
  "missed_promises() — missed or cut promises across the book",
  "movers(pct) — book names whose latest stored session moved at least pct, default 5",
  "get_management(symbol) — latest management-change card",
  "compare(symbolA, symbolB) — both results headlines. Do not say which is better",
].join("\n");

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

export const FinnieStep = z.union([
  z.object({
    done: z.boolean(),
    say: z.string(),
  }),
  z.object({
    tool: z.enum(FINNIE_TOOLS),
    args: Args.nullish(),
  }),
]);

type Step = z.infer<typeof FinnieStep>;

export async function runFinnieTurn(
  sentence: string,
  focus: string | null,
  prior?: FinniePrior | null,
): Promise<FinnieTurnResult> {
  const text = sentence.trim().slice(0, 500);
  if (!text) return quiet("Name a company.");
  const open = focusSymbol(focus);
  const earlier = cleanPrior(prior);
  if (await modelAtSoftCap("bulk")) return quiet(FINNIE_OUT_OF_CALLS);

  const tools: string[] = [];
  const notes: string[] = [];
  let last: ToolOutcome | null = null;

  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    const step = await decide(text, open, earlier, notes, false);
    if (step === "capped" || step === null) {
      if (!tools.length)
        return quiet(
          step === "capped" ? FINNIE_OUT_OF_CALLS : FINNIE_MODEL_DOWN,
        );
      return present(fallbackSay(last), tools, last);
    }
    if ("done" in step) return present(step.say, tools, last);
    tools.push(step.tool);
    try {
      last = await executeTool(
        step.tool,
        step.args ?? {},
        open,
        Boolean(earlier),
      );
    } catch {
      last = {
        fact: { error: "That did not run." },
        card: null,
        symbol: null,
        href: null,
        link: null,
        book: null,
      };
    }
    notes.push(`${step.tool}: ${clip(JSON.stringify(last.fact))}`);
    const fixed = fixedSay(step.tool, last);
    if (fixed) return present(fixed, tools, last);
  }

  const closing = await decide(text, open, earlier, notes, true);
  if (closing && closing !== "capped" && "done" in closing)
    return present(closing.say, tools, last);
  return present(fallbackSay(last), tools, last);
}

async function decide(
  sentence: string,
  focus: string | null,
  prior: FinniePrior | null,
  notes: string[],
  finish: boolean,
): Promise<Step | "capped" | null> {
  const prompt = promptFor(sentence, focus, prior, notes, finish);
  try {
    return readStep(await callTier("bulk", prompt));
  } catch {
    if (await modelAtSoftCap("reason")) return "capped";
    try {
      return readStep(await callTier("reason", prompt));
    } catch {
      return null;
    }
  }
}

async function callTier(tier: LlmTier, prompt: string) {
  return callStructured({
    task: "finnie",
    tier,
    schema: FinnieStep,
    prompt,
    system: SYSTEM,
    promptVersion: "2",
    temperature: 0,
    maxTokens: 512,
  });
}

function readStep(result: { data: unknown }): Step | null {
  const parsed = FinnieStep.safeParse(result.data);
  if (!parsed.success) return null;
  if ("done" in parsed.data) {
    const say = parsed.data.say.replace(/\s+/g, " ").trim();
    if (parsed.data.done !== true || !say) return null;
    return { done: true, say };
  }
  return parsed.data;
}

function promptFor(
  sentence: string,
  focus: string | null,
  prior: FinniePrior | null,
  notes: string[],
  finish: boolean,
): string {
  return [
    prior ? `Previous sentence: ${prior.sentence}` : null,
    prior ? `Previous tool: ${prior.tool ?? "none"}` : null,
    `Sentence: ${sentence}`,
    `Focus: ${focus ?? "none"}`,
    "",
    "Tools:",
    TOOL_LIST,
    "args fields: symbol, symbolA, symbolB, which, name, scope, kind, window, pct, enabled, params.",
    "",
    "Results so far:",
    notes.length ? notes.map((note) => `- ${note}`).join("\n") : "- none",
    "",
    finish
      ? 'No more tools. Return {"done":true,"say":"..."} using only the results above.'
      : 'Return {"tool":"...","args":{...}} or {"done":true,"say":"..."}.',
    "Call list_portfolio only when the user asked which names are in the portfolio.",
    "When a tool has answered the sentence, finish. Do not list the book after an add or a remove.",
    "A follow-up such as “and its promises” or “remove that one” uses Focus, the company from the previous turn. Pass that symbol.",
    `News, a target price, whether to buy, shareholding, delivery data, and whether the market is open are not tools. Return {"done":true,"say":"${FINNIE_DOES_NOT_HAVE}"} and call no tool.`,
    "compare returns the card. Do not rank the two companies.",
    "mark_read is confirmed with the count the tool returned.",
  ]
    .filter((line): line is string => line != null)
    .join("\n");
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
  last: ToolOutcome | null,
): FinnieTurnResult {
  return {
    say: oneLine(say),
    tools,
    card: last?.card ?? null,
    href: last?.href ?? null,
    link: last?.link ?? null,
    symbol: last?.symbol ?? null,
    book: last?.book ?? null,
  };
}

function quiet(say: string): FinnieTurnResult {
  return {
    say,
    tools: [],
    card: null,
    href: null,
    link: null,
    symbol: null,
    book: null,
  };
}

function fallbackSay(last: ToolOutcome | null): string {
  if (!last) return FINNIE_MODEL_DOWN;
  const fact = last.fact;
  const symbol = typeof fact.symbol === "string" ? fact.symbol : null;
  const status = typeof fact.status === "string" ? fact.status : null;
  if (status === "already_in" && symbol)
    return `${symbol} is already in the portfolio.`;
  if (status === "added" && symbol) return `Added ${symbol}.`;
  if (status === "removed" && symbol) return `Removed ${symbol}.`;
  if (status === "not_in" && symbol)
    return `${symbol} is not in the portfolio.`;
  if (status === "listed" && typeof fact.count === "number")
    return bookCountLine(fact.count);
  if (status === "none" && fact.topic === "results") return NO_RESULTS;
  if (status === "none" && fact.topic === "promises") return NO_PROMISES;
  if (status === "none" && fact.topic === "missed")
    return "No missed or cut promise in the book.";
  if (status === "none" && fact.topic === "unread") return "Nothing unread.";
  if (status === "none" && fact.topic === "upcoming")
    return "Nothing is coming up.";
  if (status === "none" && fact.topic === "movers")
    return "No name in the book moved that far.";
  if (status === "none" && fact.topic === "management" && symbol)
    return `No management change on file for ${symbol}.`;
  if (status === "brief") return briefLine(fact);
  if (status === "marked" && typeof fact.count === "number")
    return markedLine(fact.count);
  if (status === "none" && symbol) return `Nothing is on file for ${symbol}.`;
  if (typeof fact.headline === "string" && fact.headline.trim())
    return oneLine(fact.headline);
  if (typeof fact.sentence === "string" && fact.sentence.trim())
    return oneLine(fact.sentence);
  if (typeof fact.error === "string" && fact.error.trim())
    return oneLine(fact.error);
  if (status === "link" && symbol) return `Open ${symbol}.`;
  return "Done.";
}

function oneLine(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "Done.";
  return text.length > 280 ? `${text.slice(0, 279).trim()}…` : text;
}

function clip(text: string): string {
  return text.length <= 3500 ? text : `${text.slice(0, 3500)}…`;
}

function fixedSay(tool: string, last: ToolOutcome): string | null {
  if (tool === "compare" && last.card?.kind === "compare") {
    const line = last.fact.line;
    return typeof line === "string" && line.trim() ? oneLine(line) : null;
  }
  if (tool === "mark_read" && typeof last.fact.count === "number")
    return markedLine(last.fact.count);
  return null;
}

function markedLine(count: number): string {
  if (count === 0) return "Nothing unread.";
  return count === 1 ? "Marked 1 read." : `Marked ${count} read.`;
}

function briefLine(fact: Record<string, unknown>): string {
  const act = Array.isArray(fact.act) ? fact.act.length : 0;
  const watch = typeof fact.watch === "number" ? fact.watch : 0;
  const filed = typeof fact.filedAway === "number" ? fact.filedAway : 0;
  return `${act} to act on, ${watch} to watch, ${filed} filed away.`;
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
