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
  FINNIE_DECISION_LINE,
  FINNIE_DOES_NOT_HAVE,
  FINNIE_MODEL_DOWN,
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

const STEP_TOOLS = [...FINNIE_TOOLS, "none"] as const;

const SYSTEM = [
  "You are Finnie, a research desk.",
  "Set tool to the one tool that answers the sentence, or none to finish.",
  "say is one sentence and may use only facts a tool returned. Leave say empty when tool is not none.",
  "Do not invent a figure, a quote, or a company. Do not recommend.",
  "Act means the brief’s Act cards. It is not a buy or a sell.",
  `Example: “which stocks should I act upon right now?” → {"tool":"get_brief","args":{}}`,
  `Example: “should I buy Reliance?” → get_results, then get_promises, then get_quote. Then {"tool":"none","say":"${FINNIE_DECISION_LINE}"}`,
  "That question uses 3 calls. The cap is 4. Do not say buy, do not say do not buy, do not name a target price, and do not give a rating.",
  "Shareholding or delivery is get_results, then one line that it is not in the filings.",
  "Whether the market is open is get_index. News is get_brief, the Act lines.",
  "If the sentence is not a perfect tool match, call the closest tool and show that card. Do not answer with only a refusal.",
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
  "get_brief(window) — Act lines, plus the watch count and the filed-away count. Omit window for right now; that is the brief on screen, widened when the day is empty. Otherwise 24h, 48h, 7d, 30d, or since close",
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

export const FinnieStep = z.object({
  tool: z
    .enum(STEP_TOOLS)
    .describe(
      "get_brief is the Act list: act, act on, act upon, and the brief. It is not a buy or a sell. A buy or a sell is get_results, then get_promises, then get_quote. none finishes. It does not refuse.",
    ),
  args: Args,
  say: z.string().optional(),
});

type Step = { done: true; say: string } | { tool: string; args: ToolArgs };

type Call =
  | { kind: "call"; tool: FinnieTool; args: ToolArgs }
  | { kind: "say"; say: string }
  | { kind: "stop" };

export async function runFinnieTurn(
  sentence: string,
  focus: string | null,
  prior?: FinniePrior | null,
): Promise<FinnieTurnResult> {
  const text = sentence.trim().slice(0, 500);
  if (!text) return quiet("Name a company.");
  const open = focusSymbol(focus);
  const earlier = cleanPrior(prior);
  const script = scriptFor(text, open);
  if (script) return runScript(script, text, open);

  if (await modelAtSoftCap("bulk")) return quiet(FINNIE_OUT_OF_CALLS);

  const tools: string[] = [];
  const notes: string[] = [];
  const cards: FinnieCard[] = [];
  let last: ToolOutcome | null = null;

  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    const step = await decide(text, open, earlier, notes, false);
    if (step === "capped" || step === null) {
      if (!tools.length)
        return quiet(
          step === "capped" ? FINNIE_OUT_OF_CALLS : FINNIE_MODEL_DOWN,
        );
      return present(fallbackSay(last), tools, last, cards);
    }
    let next = chooseCall(step, text, tools, notes);
    if (next.kind === "stop" && !tools.length)
      next = { kind: "call", tool: "get_brief", args: {} };
    if (next.kind === "say") return present(next.say, tools, last, cards);
    if (next.kind === "stop")
      return present(fallbackSay(last), tools, last, cards);
    tools.push(next.tool);
    last = await runTool(next.tool, text, next.args, open, Boolean(earlier));
    if (last.card) cards.push(last.card);
    notes.push(`${next.tool}: ${clip(JSON.stringify(last.fact))}`);
    const fixed = fixedSay(next.tool, last);
    if (fixed) return present(fixed, tools, last, cards);
  }

  const closing = await decide(text, open, earlier, notes, true);
  if (
    closing &&
    closing !== "capped" &&
    "done" in closing &&
    closing.say &&
    usableSay(closing.say, notes, text)
  )
    return present(closing.say, tools, last, cards);
  return present(fallbackSay(last), tools, last, cards);
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
    promptVersion: "4",
    temperature: 0,
    maxTokens: 512,
  });
}

function readStep(result: { data: unknown } | null | undefined): Step | null {
  if (!result || typeof result.data !== "object" || result.data == null)
    return null;
  const rec = result.data as Record<string, unknown>;
  const tool =
    typeof rec.tool === "string"
      ? rec.tool
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      : "";
  const say =
    typeof rec.say === "string" ? rec.say.replace(/\s+/g, " ").trim() : "";
  const args = readArgs(rec.args);
  if (tool && tool !== "none" && tool !== "done" && tool !== "finish")
    return { tool, args };
  if (
    rec.done === true ||
    tool === "none" ||
    tool === "done" ||
    tool === "finish"
  )
    return { done: true, say };
  if (say) return { done: true, say };
  return null;
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
    "Act, act on, and act upon are get_brief.",
    `A buy or a sell, such as should I buy Reliance, is get_results, then get_promises, then get_quote. Then finish with exactly: ${FINNIE_DECISION_LINE}`,
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
      ? 'No more tools. Return {"tool":"none","say":"..."} using only the results above.'
      : 'Return {"tool":"<one tool>","args":{...}} or {"tool":"none","say":"..."}.',
    "Call list_portfolio only when the user asked which names are in the portfolio.",
    "When a tool has answered the sentence, finish. Do not list the book after an add or a remove.",
    "A follow-up such as “and its promises” or “remove that one” uses Focus, the company from the previous turn. Pass that symbol.",
    "Do not recommend. Do not invent a figure. Shareholding or delivery is get_results. Whether the market is open is get_index. News is get_brief.",
    "If nothing matches exactly, call the closest tool. Do not finish with a refusal and no card.",
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
  cards: FinnieCard[] = [],
  sayAfter = false,
): FinnieTurnResult {
  const all = cards.length ? cards : last?.card ? [last.card] : [];
  return {
    say: oneLine(say),
    tools,
    card: all.at(-1) ?? null,
    cards: all,
    sayAfter,
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
    cards: [],
    sayAfter: false,
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

function chooseCall(
  step: Step,
  sentence: string,
  ran: string[],
  notes: string[],
): Call {
  if ("tool" in step) {
    const known = knownTool(step.tool);
    if (known) return { kind: "call", tool: known, args: step.args };
    const covered = coveredTool(sentence);
    if (covered && !ran.includes(covered))
      return { kind: "call", tool: covered, args: {} };
    if (!ran.length) return { kind: "call", tool: "get_brief", args: {} };
    return { kind: "stop" };
  }
  const unusable = !step.say.trim() || !usableSay(step.say, notes, sentence);
  if (unusable || !ran.length) {
    const covered = coveredTool(sentence);
    if (covered && !ran.includes(covered))
      return { kind: "call", tool: covered, args: {} };
    if (!ran.length) return { kind: "call", tool: "get_brief", args: {} };
    return { kind: "stop" };
  }
  return { kind: "say", say: step.say };
}

function normAsk(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s.&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRefusal(say: string): boolean {
  const n = normAsk(say);
  if (!n) return false;
  if (n === normAsk(FINNIE_DOES_NOT_HAVE) || n.includes("does not have that"))
    return true;
  return (
    /\bi can't\b/.test(n) || /\bi cannot\b/.test(n) || /\bi can not\b/.test(n)
  );
}

function isRecommendation(say: string): boolean {
  const n = normAsk(say);
  if (!n) return false;
  if (/\b(buy|sell|short|purchase|accumulate|rating)\b/.test(n)) return true;
  if (/\b(a hold|don't buy|do not buy|dont buy)\b/.test(n)) return true;
  return /\b(target price|price target|outperform|underperform|overweight|underweight)\b/.test(
    n,
  );
}

function usableSay(say: string, notes: string[], sentence: string): boolean {
  if (isRefusal(say) || isRecommendation(say)) return false;
  return !inventedNumber(say, notes, sentence);
}

function inventedNumber(
  say: string,
  notes: string[],
  sentence: string,
): boolean {
  const nums = say.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const blob = `${notes.join("\n")} ${sentence}`;
  return nums.some((raw) => {
    const plain = raw.replace(/,/g, "");
    return !blob.includes(raw) && !blob.includes(plain);
  });
}

function knownTool(name: string): FinnieTool | null {
  return (FINNIE_TOOLS as readonly string[]).includes(name)
    ? (name as FinnieTool)
    : null;
}

function coveredTool(sentence: string): FinnieTool | null {
  const n = normAsk(sentence);
  if (!n) return null;
  if (isPortfolioList(n)) return "list_portfolio";
  if (/\b(add|put)\b/.test(n) && /\b(portfolio|book)\b/.test(n))
    return "add_to_portfolio";
  if (/\b(remove|delete|drop)\b/.test(n) && /\b(portfolio|book)\b/.test(n))
    return "remove_from_portfolio";
  if (isBrief(n)) return "get_brief";
  if (/\bmark\b/.test(n) && /\bread\b/.test(n)) return "mark_read";
  if (/\b(unread|inbox)\b/.test(n)) return "list_unread";
  if (/\b(upcoming|coming up|board meeting)\b/.test(n)) return "get_upcoming";
  if (/\b(missed|cut)\b/.test(n) && /\bpromise/.test(n))
    return "missed_promises";
  if (/\b(mover|moved)\b/.test(n)) return "movers";
  if (/\bmanagement\b/.test(n)) return "get_management";
  if (/\bcompare\b/.test(n) || /\bversus\b/.test(n) || /\bvs\b/.test(n))
    return "compare";
  if (/\b(disable|turn off|switch off)\b/.test(n) && /\balert\b/.test(n))
    return "disable_alert";
  if (/\balert\b/.test(n)) return "set_alert";
  if (/\bresults?\b/.test(n)) return "get_results";
  if (/\bpromises?\b/.test(n)) return "get_promises";
  if (
    /\b(balance sheet|cash quality|narrative|guidance|trajectory|bull)\b/.test(
      n,
    )
  )
    return "get_reading";
  if (/\b(quote|share price|stock price)\b/.test(n)) return "get_quote";
  if (/\b(nifty|sensex|india vix)\b/.test(n)) return "get_index";
  if (/\b(corporate action|dividend|bonus|split)\b/.test(n))
    return "get_corporate_actions";
  if (/^(?:open|show)\s+[a-z0-9&.-]{2,20}$/.test(n)) return "open_company";
  return null;
}

function isPortfolioList(n: string): boolean {
  if (/\b(add|remove|delete|drop|put)\b/.test(n)) return false;
  return /\b(portfolio|holdings|my book|the book)\b/.test(n);
}

function isBrief(n: string): boolean {
  if (/\bbrief\b/.test(n) || /\bact\b/.test(n)) return true;
  if (/\bwhat needs (?:a decision|me)\b/.test(n)) return true;
  return /\bwhat do i need to do\b/.test(n);
}

function namedWindow(sentence: string): string | null {
  const n = normAsk(sentence);
  if (/\b48\s*h\b|\b48 hours\b|\blast 48\b/.test(n)) return "48h";
  if (/\b7\s*d\b|\blast 7\b|\b7 days\b|\bthis week\b|\bweek\b/.test(n))
    return "7d";
  if (/\b30\s*d\b|\blast 30\b|\b30 days\b|\bthis month\b|\bmonth\b/.test(n))
    return "30d";
  if (/\bsince (?:the )?close\b/.test(n)) return "close";
  if (/\b24\s*h\b|\blast 24\b|\b24 hours\b/.test(n)) return "24h";
  return null;
}

function argsForTool(
  tool: FinnieTool,
  sentence: string,
  args: ToolArgs,
): ToolArgs {
  if (tool !== "get_brief") return args;
  const named = namedWindow(sentence);
  if (named) return { ...args, window: named };
  const rest = { ...args };
  delete rest.window;
  return rest;
}

function readArgs(value: unknown): ToolArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ToolArgs;
}

function focusSymbol(focus: string | null): string | null {
  if (!focus) return null;
  const symbol = focus.trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}

const SHAREHOLDING_LINE = "Shareholding is not in the filings I have.";
const DELIVERY_LINE = "Delivery is not in the filings I have.";
const MARKET_LINE = "NSE does not publish whether the market is open.";
const NEWS_LINE = "I don't have news. Here is what needs a decision.";
const PRICE_LINE = "I can only give you the price.";

const SKIP = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "should",
  "shall",
  "ought",
  "would",
  "could",
  "can",
  "do",
  "does",
  "did",
  "is",
  "are",
  "am",
  "be",
  "been",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "and",
  "or",
  "please",
  "now",
  "today",
  "right",
  "time",
  "good",
  "bad",
  "stock",
  "stocks",
  "share",
  "shares",
  "company",
  "name",
  "what",
  "whats",
  "show",
  "get",
  "tell",
  "about",
  "how",
  "worth",
  "recommend",
  "recommendation",
  "buy",
  "sell",
  "short",
  "purchase",
  "accumulate",
  "hold",
  "holding",
  "holdings",
  "it",
  "its",
  "this",
  "that",
  "there",
  "market",
  "open",
  "closed",
  "nse",
  "news",
  "latest",
  "any",
  "some",
  "price",
  "target",
  "shareholding",
  "delivery",
  "data",
  "volume",
  "percent",
  "percentage",
  "qty",
  "quantity",
  "pattern",
  "promoter",
  "fii",
  "dii",
  "industries",
  "limited",
  "ltd",
  "corp",
  "co",
  "plc",
  "from",
  "with",
  "into",
]);

interface Script {
  steps: Array<{ tool: FinnieTool; args: ToolArgs }>;
  say: string;
  sayAfter: boolean;
}

function scriptFor(sentence: string, focus: string | null): Script | null {
  const n = normAsk(sentence);
  if (!n) return null;
  const args = symbolArgs(sentence, focus);
  if (isDecision(n)) {
    return {
      steps: [
        { tool: "get_results", args },
        { tool: "get_promises", args },
        { tool: "get_quote", args },
      ],
      say: FINNIE_DECISION_LINE,
      sayAfter: true,
    };
  }
  if (isTarget(n))
    return {
      steps: [{ tool: "get_quote", args }],
      say: PRICE_LINE,
      sayAfter: false,
    };
  if (isShareholding(n))
    return {
      steps: [{ tool: "get_results", args }],
      say: SHAREHOLDING_LINE,
      sayAfter: false,
    };
  if (isDelivery(n))
    return {
      steps: [{ tool: "get_results", args }],
      say: DELIVERY_LINE,
      sayAfter: false,
    };
  if (isMarketOpen(n))
    return {
      steps: [{ tool: "get_index", args: { name: marketIndex(n) } }],
      say: MARKET_LINE,
      sayAfter: false,
    };
  if (/\bnews\b/.test(n))
    return {
      steps: [{ tool: "get_brief", args: {} }],
      say: NEWS_LINE,
      sayAfter: false,
    };
  return null;
}

async function runScript(
  script: Script,
  sentence: string,
  focus: string | null,
): Promise<FinnieTurnResult> {
  const tools: string[] = [];
  const cards: FinnieCard[] = [];
  let last: ToolOutcome | null = null;
  for (const step of script.steps) {
    if (tools.length >= MAX_TOOL_CALLS) break;
    tools.push(step.tool);
    last = await runTool(step.tool, sentence, step.args, focus, false);
    const shown = shownCard(step.tool, last);
    if (shown) cards.push(shown);
  }
  return present(script.say, tools, last, cards, script.sayAfter);
}

async function runTool(
  tool: FinnieTool,
  sentence: string,
  args: ToolArgs,
  focus: string | null,
  carry: boolean,
): Promise<ToolOutcome> {
  try {
    return await executeTool(
      tool,
      argsForTool(tool, sentence, args),
      focus,
      carry,
    );
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

function shownCard(tool: string, last: ToolOutcome): FinnieCard | null {
  if (last.card) return last.card;
  const message = typeof last.fact.error === "string" ? last.fact.error : null;
  if (message && !last.symbol)
    return { kind: "reply", symbol: "", reply: { kind: "error", message } };
  const symbol = last.symbol ?? "";
  if (tool === "get_results")
    return { kind: "reply", symbol, reply: { kind: "results", card: null } };
  if (tool === "get_promises")
    return { kind: "reply", symbol, reply: { kind: "promises", rows: [] } };
  if ((tool === "get_quote" || tool === "get_index") && message)
    return { kind: "reply", symbol, reply: { kind: "error", message } };
  return null;
}

function isDecision(n: string): boolean {
  const trade =
    /\b(buy|sell|short|purchase|accumulate)\b/.test(n) ||
    /\b(a buy|a sell|a hold)\b/.test(n) ||
    /\bhold\b/.test(n);
  if (!trade) return false;
  if (
    /\bact\b/.test(n) &&
    !/\b(buy|sell|short|purchase|accumulate)\b/.test(n) &&
    !/\b(a buy|a sell)\b/.test(n)
  )
    return false;
  return (
    /\b(should|shall|ought|would|could|can|do|does|recommend|worth|is|are)\b/.test(
      n,
    ) || /\b(a buy|a sell|a hold)\b/.test(n)
  );
}

function isTarget(n: string): boolean {
  return /\b(price target|target price)\b/.test(n);
}

function isShareholding(n: string): boolean {
  return /\bshareholding\b/.test(n) || /\bshare holding\b/.test(n);
}

function isDelivery(n: string): boolean {
  return /\bdelivery\b/.test(n);
}

function isMarketOpen(n: string): boolean {
  if (!/\bopen\b/.test(n)) return false;
  return /\b(market|nse|nifty|sensex)\b/.test(n);
}

function marketIndex(n: string): string {
  if (/\bbank nifty\b|\bnifty bank\b/.test(n)) return "NIFTY BANK";
  if (/\bnifty it\b/.test(n)) return "NIFTY IT";
  if (/\bindia vix\b/.test(n)) return "INDIA VIX";
  return "NIFTY 50";
}

function symbolArgs(sentence: string, focus: string | null): ToolArgs {
  const symbol = extractSymbol(sentence) ?? focus;
  return symbol ? { symbol } : {};
}

function extractSymbol(sentence: string): string | null {
  const tokens = normAsk(sentence)
    .split(" ")
    .filter(
      (token) => token.length >= 2 && !SKIP.has(token) && !/^\d+$/.test(token),
    );
  const raw = tokens.at(-1);
  if (!raw) return null;
  const symbol = raw.toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}
