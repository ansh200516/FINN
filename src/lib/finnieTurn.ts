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
  LlmBudgetExhausted,
  MODEL_LADDERS,
  remainingBudget,
} from "@/engine/llm/gateway";
import type { LlmTier } from "@/engine/types";
import {
  type CompanyName,
  companiesMentioned,
  matchCompanyName,
  mentionsToken,
  omitCompaniesAbsentFrom,
} from "@/lib/companyMatch";
import { repairSay } from "@/lib/finnieSay";
import { executeTool } from "@/lib/finnieTools";
import {
  FINNIE_CHAIN_CAP,
  FINNIE_MODEL_DOWN,
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
import { dropUngroundedSentences, ungroundedNumbers } from "@/lib/groundedSay";
import { listCompanyNames } from "@/lib/queries";

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
    "Headline quarterly results for one company. Use this for a results question, and together with get_promises for promised versus delivered. args.symbol is the NSE symbol of the company named in the latest sentence. HDFC Bank is HDFCBANK, not a fund or an AMC. args.quarters is 1 to 8 and defaults to 4. Each period includes Revenue or NII or Total income, EBITDA or PPOP, PBT, and PAT, with qoqPct and yoyPct when computed.",
  get_promises:
    "What management guided for one company, up to 12 rows: quote, metric, horizon, promised value, verdict, and delivered value. A null delivered value means the row was not scored, not that the quarter is missing. args.symbol. Call this with get_results when the question is promised versus delivered over recent quarters. This is not the pull-menu Guidance reading.",
  get_reading:
    "One of the eight pull readings. args.symbol. args.which is exactly Business snapshot, Financial snapshot, Trajectory, Balance sheet, Cash quality, Narrative vs. numbers, Guidance, or Bull vs. bear. Promised versus delivered over recent quarters is get_results and get_promises, not this tool alone.",
  get_quote: "Live price for one symbol. args.symbol.",
  get_index: "Live index level. args.name.",
  get_corporate_actions:
    "Dividends, splits, and bonuses for one symbol. args.symbol. Whether a filing earns a card or one line is get_brief.",
  set_alert:
    "Watch a threshold the user sets. args.scope is a symbol or the book. args.kind is price, volume, or category. A price move beyond a chosen percent uses params.pct. Volume more than about 2× its recent average uses params.ratio and params.lookbackDays. A material filing type uses params.categories, including results, m_and_a, and management_change.",
  disable_alert: "Turn off an alert. args.scope, args.kind, args.params.",
  open_company: "Page for one symbol. args.symbol.",
  get_brief:
    "Windowed digest of filings for the book or one company. What matters is listed first. For one company, filings lists each item with surface card or line and a sentence. A routine filing is a line, not a card. args.symbol limits the digest to that company. args.window is 24h, 48h, 7d, 30d, or close. The default window is the last 24 hours.",
  list_unread: "Unread inbox rows.",
  mark_read: "Mark the inbox read.",
  get_upcoming: "Upcoming filings and events.",
  missed_promises:
    "Missed or cut guidance across the whole book. One company's promised versus delivered walk is get_results and get_promises, not this tool.",
  movers:
    "Holdings that already moved. args.pct is optional. A watch for a future move is set_alert.",
  get_management:
    "A management change for one company: the person, the role, the action, the profile excerpt, and prior roles, so the answer can say who they are and where they came from. args.symbol.",
  compare: "Latest results for two symbols. args.symbolA and args.symbolB.",
};

/** Illustrations for the tool step. The code does not match these strings. */
const TOOL_CHOICE_EXAMPLES = [
  "Examples of tool choice. These illustrate the catalog. They are not strings the code matches.",
  'Windowed digest: "For a time window I choose — by default the last 24 hours, but let me pick the period — show me every corporate filing/announcement across my portfolio, filtered and prioritised so I see what matters first and the routine stuff is collapsed or hidden." Tool: get_brief.',
  'Triggered alert: "a material announcement of a type I care about (results, M&A, management change, and so on)" or "volume more than ~2× its recent average, or a price move beyond ±X% in a day." Tool: set_alert.',
  'Management change: don\'t just say "CFO resigned." Who the incoming person is and where they came from. Tool: get_management.',
  "Quarterly results: Revenue, EBITDA, PBT and PAT, this quarter vs. last quarter (QoQ) and vs. the same quarter a year ago (YoY). A bank uses NII, PPOP, PBT and PAT. Tool: get_results.",
  "Pull menu, one reading: Business snapshot; Financial snapshot; Trajectory; Balance sheet; Cash quality; Narrative vs. numbers; Guidance; Bull vs. bear. Tool: get_reading. args.which is that reading.",
  'Promised versus delivered: "take the last four quarters and, against management\'s own headline guidance and growth commentary, tell me what was promised vs. what was actually delivered." Tools: get_results with args.quarters 4, and get_promises. Both. Not get_reading alone.',
].join("\n");

const PLAN_SYSTEM = [
  "You are Finnie.",
  "Choose tools for the latest sentence. Do not answer it.",
  "The catalog is the only data in this call. The book is not included.",
  "Return 1 to 4 calls. Use an empty calls list only when the sentence asks for nothing in the catalog.",
  "A buy, a sell, a target price, or a put still needs get_results or get_quote for the company named in the sentence or already in the thread. Do not skip the tools.",
  "If the sentence says it, that, or the same company, keep the company from the thread.",
  "args are optional. args.symbol is the NSE symbol of the company the latest sentence names. Do not substitute a similar ticker. HDFC Bank is HDFCBANK. IndusInd Bank is INDUSINDBK.",
  "get_results may set args.quarters from 1 to 8. Omitted, it is 4.",
  "Promised versus delivered over recent quarters is get_results and get_promises together.",
  "A results question is get_results. A management change is get_management. A filing digest is get_brief. Whether a filing earns a card or one line, or whether a filing deserves attention, is get_brief with that company's symbol. A dividend, a split, or a bonus is get_corporate_actions. A threshold to watch is set_alert. One pull-menu reading is get_reading.",
  "The examples under the catalog illustrate tool choice. They are not strings to match.",
  "Do not invent a tool.",
].join(" ");

const ANSWER_SYSTEM = [
  "You are Finnie.",
  "Answer the latest sentence using only the tool JSON.",
  "say is that answer. Be concise.",
  "Do not state a number or a name that is not in the tool JSON.",
  "Do not add numbers to make a total. A count has to be a count field the tool JSON already returned.",
  "No buy. No sell. No target price. No news.",
  "Read every row you were given and answer the question.",
  "When the tool JSON includes results and no guidance rows, say is at most two short sentences. Do not list every quarter's Revenue, EBITDA, PBT, and PAT. When the lines are NII and PPOP, do not list every quarter of those either. Name what stands out. The screen draws one table for the quarters. Do not write qoqPct or yoyPct. Do not say the results are missing when the quarters array is present.",
  'When the tool JSON includes guidance rows, read every row, including a comment that is not a numeric range. If they asked promised versus delivered, say what management said and what the quarters show, including when a comment is about Jio or one business and the quarter is the consolidated number, so it cannot be scored. Do not invent a promise. Do not say a promise is missing if a guidance row is in the JSON. Two or three sentences, then "The decision is yours." No buy or sell.',
  "A management-change question names the person and the profile, including prior roles when the tool JSON has them.",
  "A pull reading answers from that reading's verdict, lines, and table.",
  "When the question asks whether a filing earns a card or one line, or whether a filing deserves attention, use the filings array. Name the company and the filing sentence, then say it earns a card when surface is card, or one line when surface is line. Write a full sentence. If filings is empty, say there is no filing in the window. Do not answer with only the word card or the words one line.",
  'When the question asks for a judgment, or compares what was promised with what was delivered, or asks whether to buy, sell, or for a target price or a put, refuse the trade and end with "The decision is yours."',
  'Do not answer a trade question with only "No buy." Use the filings or the price in the tool JSON.',
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

/** Tool JSON from the latest turn. The chat path leaves this unset. */
let finnieFactTap:
  | ((rows: Array<{ tool: string; data: unknown }>) => void)
  | null = null;

export function setFinnieFactTap(
  tap: ((rows: Array<{ tool: string; data: unknown }>) => void) | null,
): void {
  finnieFactTap = tap;
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

  const directory = await companyDirectory();
  const named = companiesMentioned(text, directory);
  const earlier = earlierCompanies(memory, open, directory);
  const allowed = named.length ? named : earlier;
  const toolFocus = named.length === 1 ? (named[0] ?? null) : open;
  let calls: PlanCall[];
  try {
    calls = await planCalls(text, memory);
  } catch (error) {
    if (error instanceof LlmBudgetExhausted) return quiet(FINNIE_OUT_OF_CALLS);
    return quiet(FINNIE_MODEL_DOWN);
  }
  if (!calls.length) return quiet(FINNIE_NO_MATCH);
  if (calls.some((call) => callMissesCompany(call, allowed, directory, text))) {
    const hint = allowed.length === 1 ? allowed[0] : allowed.join(" and ");
    if (hint) {
      try {
        const retried = await planCalls(text, memory, hint);
        if (retried.length) calls = retried;
      } catch (error) {
        if (error instanceof LlmBudgetExhausted)
          return quiet(FINNIE_OUT_OF_CALLS);
      }
    }
  }
  if (allowed.length === 1) {
    calls = calls.map((call) =>
      withCompany(call, allowed[0] ?? "", named.length === 1, directory, text),
    );
  }
  calls = calls.filter((call) => callFits(call, allowed, directory));
  if (!calls.length) return quiet(FINNIE_NO_MATCH);

  const ran: Ran[] = [];
  for (const call of calls) {
    try {
      const outcome = await executeTool(
        call.tool,
        call.args,
        toolFocus,
        Boolean(toolFocus),
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

  finnieFactTap?.(
    ran.map((item) => ({ tool: item.tool, data: item.outcome.fact })),
  );

  let say = "";
  try {
    const answered = await callWithRetry(() =>
      callStructured({
        task: "finnie",
        tier: "bulk",
        schema: FinnieSay,
        prompt: answerPrompt(text, memory, ran),
        system: ANSWER_SYSTEM,
        promptVersion: "answer-9",
        temperature: 0,
        maxTokens: 2048,
      }),
    );
    say = cleanSay(answered.data.say);
    const facts = ran.map((item) => ({
      tool: item.tool,
      data: item.outcome.fact,
    }));
    if (ungroundedNumbers(say, text, facts).length) {
      try {
        const again = await callWithRetry(() =>
          callStructured({
            task: "finnie",
            tier: "bulk",
            schema: FinnieSay,
            prompt: answerPrompt(
              text,
              memory,
              ran,
              ungroundedNumbers(say, text, facts),
            ),
            system: ANSWER_SYSTEM,
            promptVersion: "answer-9",
            temperature: 0,
            maxTokens: 2048,
          }),
        );
        say = cleanSay(again.data.say);
      } catch {
        // The first answer stands. The stray sentence is removed below.
      }
      say = dropUngroundedSentences(say, text, facts);
    }
    say = repairSay(say, facts);
    if (ungroundedNumbers(say, text, facts).length) {
      const kept = dropUngroundedSentences(say, text, facts);
      if (kept) say = kept;
    }
    say = omitCompaniesAbsentFrom(say, facts, directory);
  } catch (error) {
    if (error instanceof LlmBudgetExhausted)
      return present(FINNIE_OUT_OF_CALLS, ran, open, allowed, named.length > 0);
    return present(FINNIE_MODEL_DOWN, ran, open, allowed, named.length > 0);
  }
  if (!say) {
    return present(FINNIE_NO_MATCH, ran, open, allowed, named.length > 0);
  }
  return ensureCompanyLinks(
    present(say, ran, toolFocus ?? open, allowed, named.length > 0),
    named,
  );
}

const RETRY_PAUSE_MS = 2_500;

async function callWithRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LlmBudgetExhausted) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    return run();
  }
}

async function companyDirectory(): Promise<CompanyName[]> {
  try {
    return await listCompanyNames();
  } catch {
    return [];
  }
}

async function planCalls(
  sentence: string,
  memory: FinnieMemory[],
  company?: string,
): Promise<PlanCall[]> {
  const planned = await callWithRetry(() =>
    callStructured({
      task: "finnie",
      tier: "bulk",
      schema: ToolPlan,
      prompt: planPrompt(sentence, memory, company),
      system: PLAN_SYSTEM,
      promptVersion: company ? "plan-7" : "plan-6",
      temperature: 0,
      maxTokens: 512,
    }),
  );
  return planned.data.calls.map((call) => ({
    tool: call.tool,
    args: call.args ?? {},
  }));
}

const SYMBOL_TOOLS = new Set<FinnieTool>([
  "add_to_portfolio",
  "remove_from_portfolio",
  "get_results",
  "get_promises",
  "get_reading",
  "get_quote",
  "get_corporate_actions",
  "set_alert",
  "disable_alert",
  "open_company",
  "get_brief",
  "get_management",
  "compare",
]);

function symbolArgs(args: ToolArgs): string[] {
  const out: string[] = [];
  for (const key of ["symbol", "symbolA", "symbolB", "scope"] as const) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean || clean.toLowerCase() === "book") continue;
    out.push(clean);
  }
  return out;
}

function callMissesCompany(
  call: PlanCall,
  allowed: string[],
  rows: CompanyName[],
  utterance: string,
): boolean {
  if (!allowed.length || !SYMBOL_TOOLS.has(call.tool)) return false;
  const args = symbolArgs(call.args);
  if (!args.length) return false;
  for (const raw of args) {
    if (mentionsToken(utterance, raw)) continue;
    const resolved = matchCompanyName(raw, rows)?.symbol ?? null;
    if (resolved && allowed.includes(resolved)) continue;
    return true;
  }
  return false;
}

function withCompany(
  call: PlanCall,
  symbol: string,
  namedInSentence: boolean,
  rows: CompanyName[],
  utterance: string,
): PlanCall {
  if (!symbol || !SYMBOL_TOOLS.has(call.tool)) return call;
  const args = { ...call.args };
  const current = typeof args.symbol === "string" ? args.symbol.trim() : "";
  if (current && mentionsToken(utterance, current)) return call;
  const resolved = current
    ? (matchCompanyName(current, rows)?.symbol ?? null)
    : null;
  if (resolved === symbol) return call;
  if (!current && !namedInSentence) return call;
  if (!namedInSentence && !resolved) return call;
  args.symbol = symbol;
  if (
    typeof args.scope === "string" &&
    args.scope.trim().toLowerCase() !== "book" &&
    !mentionsToken(utterance, args.scope)
  ) {
    const scope = matchCompanyName(args.scope, rows)?.symbol ?? null;
    if (scope !== symbol) args.scope = symbol;
  }
  return { tool: call.tool, args };
}

function planPrompt(
  sentence: string,
  memory: FinnieMemory[],
  company?: string,
): string {
  const lines = [`Question: ${sentence}`];
  const thread = formatThread(memory);
  if (thread) lines.push("", thread);
  if (company) {
    lines.push(
      "",
      `The previous call used a different symbol. Use ${company} as args.symbol.`,
    );
  }
  lines.push("", "Catalog:", catalogText(), "", TOOL_CHOICE_EXAMPLES);
  return lines.join("\n");
}

function answerPrompt(
  sentence: string,
  memory: FinnieMemory[],
  ran: Ran[],
  stray?: string[],
): string {
  const lines = [`Question: ${sentence}`];
  const thread = formatThread(memory);
  if (thread) lines.push("", thread);
  const facts = ran.map((item) => ({
    tool: item.tool,
    data: item.outcome.fact,
  }));
  lines.push("", "Tools:", JSON.stringify(facts));
  if (stray?.length) {
    lines.push(
      "",
      `The previous answer used ${stray.join(", ")}, which is not in the tool JSON. Rewrite the answer without that number. Do not add figures together. A count has to be a count field the tool JSON already returned.`,
    );
  }
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

function linksCompany(href: string, symbol: string): boolean {
  const page = `/c/${encodeURIComponent(symbol)}`;
  return (
    href === page ||
    href.startsWith(`${page}/`) ||
    href.startsWith(`${page}#`) ||
    href.startsWith(`${page}?`)
  );
}

/** A company named in the sentence keeps a /c/ page even when a tool errors. */
function ensureCompanyLinks(
  result: FinnieTurnResult,
  symbols: string[],
): FinnieTurnResult {
  if (!symbols.length) return result;
  const links = [...result.links];
  let href = result.href;
  let symbol = result.symbol;
  for (const company of symbols) {
    const page = `/c/${encodeURIComponent(company)}`;
    const hrefs = [href, ...links.map((link) => link.href), ...result.pages];
    const has = hrefs.some(
      (item) => typeof item === "string" && linksCompany(item, company),
    );
    if (!has && links.length < LINK_CAP) {
      links.push({ href: page, label: company });
    }
    if (!href) href = page;
  }
  if (symbols.length === 1 && symbols[0] && symbol !== symbols[0]) {
    symbol = symbols[0];
  }
  return { ...result, links, href, symbol };
}

function present(
  say: string,
  ran: Ran[],
  focus: string | null,
  allowed: string[] = [],
  namedCompany = false,
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
    if (!symbolOk(outcome.symbol, allowed)) continue;
    if (outcome.book) book = outcome.book;
    if (outcome.symbol) symbol = outcome.symbol;
    const card = confineCard(outcome.card, allowed, namedCompany);
    if (card) {
      cards.push(card);
      const page = pageFor(outcome);
      pages.push(pageOk(page, allowed) ? page : null);
    } else if (!outcome.card) {
      const page = pageFor(outcome);
      if (page && pageOk(page, allowed))
        links.push({ href: page, label: "Full page" });
    }
    if (book && outcome.href && pageOk(outcome.href, allowed)) {
      href = outcome.href;
      link = outcome.link;
    }
  }
  if (symbol && !symbolOk(symbol, allowed)) symbol = allowed[0] ?? null;
  if (href && !pageOk(href, allowed)) {
    href = null;
    link = null;
  }
  return {
    say,
    tools: ran.map((item) => item.tool),
    card: cards.at(-1) ?? null,
    cards,
    pages,
    links: links.slice(0, LINK_CAP),
    sayAfter: say.includes("The decision is yours."),
    href,
    link,
    symbol,
    book,
  };
}

function symbolOk(symbol: string | null, allowed: string[]): boolean {
  if (!allowed.length || !symbol) return true;
  return allowed.includes(symbol.trim().toUpperCase());
}

function pageOk(href: string | null, allowed: string[]): boolean {
  if (!href || !allowed.length) return true;
  const matched = /^\/c\/([^/?#]+)/.exec(href);
  if (!matched?.[1]) return true;
  let symbol = matched[1];
  try {
    symbol = decodeURIComponent(symbol);
  } catch {
    symbol = matched[1];
  }
  return allowed.includes(symbol.toUpperCase());
}

function confineCard(
  card: FinnieCard | null,
  allowed: string[],
  namedCompany: boolean,
): FinnieCard | null {
  if (!card || !allowed.length) return card;
  if (card.kind === "portfolio") {
    if (!namedCompany) return card;
    const names = card.names.filter((company) =>
      allowed.includes(company.symbol.trim().toUpperCase()),
    );
    return names.length ? { ...card, names } : null;
  }
  if (card.kind === "lines") {
    if (!namedCompany) return card;
    const lines = card.lines.filter((line) =>
      allowed.includes(line.symbol.trim().toUpperCase()),
    );
    return lines.length ? { ...card, lines } : null;
  }
  if (card.kind === "compare") {
    const fit = [card.a.symbol, card.b.symbol].every((item) =>
      allowed.includes(item.trim().toUpperCase()),
    );
    return fit ? card : null;
  }
  const symbol = card.symbol.trim().toUpperCase();
  if (!symbol) return card;
  return allowed.includes(symbol) ? card : null;
}

function callFits(
  call: PlanCall,
  allowed: string[],
  rows: CompanyName[],
): boolean {
  if (!allowed.length || !SYMBOL_TOOLS.has(call.tool)) return true;
  for (const raw of symbolArgs(call.args)) {
    const resolved = matchCompanyName(raw, rows)?.symbol ?? null;
    if (resolved) {
      if (!allowed.includes(resolved)) return false;
      continue;
    }
    const token = raw.trim().toUpperCase();
    if (allowed.includes(token)) continue;
    if (/^[A-Z0-9&.-]{1,20}$/.test(token)) return false;
  }
  return true;
}

/** The open chip, or the company the previous turn already used. */
function earlierCompanies(
  memory: FinnieMemory[],
  focus: string | null,
  rows: CompanyName[],
): string[] {
  const open = focusSymbol(focus);
  if (open) return [open];
  const last = memory.at(-1);
  if (!last) return [];
  if (last.results.length) return last.results;
  return companiesMentioned(last.user, rows);
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
    const stopAt = Number(process.env.FINN_LLM_STOP_AT ?? "");
    if (Number.isFinite(stopAt) && stopAt > 0) return requests >= stopAt;
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
