/**
 * One chat turn. Every sentence gets the same context from the database.
 * One model call writes the bubble. A write, when the model asks for one,
 * runs after that call and does not replace the bubble.
 */
import { z } from "zod";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  remainingBudget,
} from "@/engine/llm/gateway";
import type { LlmTier } from "@/engine/types";
import { type ChatContext, loadChatPack } from "@/lib/finnieContext";
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

const WRITES = [
  "add_to_portfolio",
  "remove_from_portfolio",
  "set_alert",
  "disable_alert",
  "mark_read",
] as const;

type WriteTool = (typeof WRITES)[number];

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

/** The only model call. say is the bubble. showList draws the holdings card. */
export const FinnieReply = z.object({
  say: z.string(),
  showList: z.boolean(),
  write: WriteCall.nullable(),
});

const SYSTEM = [
  "You are Finnie.",
  "Answer the user using only the context JSON.",
  "Do not invent a number, a quote, or a name that is not in the JSON.",
  "Do not recite every holding, and do not list the portfolio in order.",
  'For a judgment question, say what stands out in brief.act, missed, and movers. At most five companies. End with "The decision is yours."',
  "No buy. No sell. No target price.",
  "If the context does not contain what they asked, say that in one clause and answer from what is there.",
  "say is that answer.",
  "showList is true only when the answer is the list of holdings. Otherwise false. The app draws that list.",
  "write is null, or one change: add_to_portfolio, remove_from_portfolio, set_alert, disable_alert, or mark_read.",
  "Do not use a write to fetch data.",
  "If you set a write, say may describe that change.",
  "add_to_portfolio and remove_from_portfolio take args.symbol.",
  "set_alert and disable_alert take args.scope (a symbol or book), args.kind (price_move, volume_ratio, or category), and args.params.",
  "mark_read takes an empty args object.",
].join(" ");

interface Reply {
  say: string;
  showList: boolean;
  write: { tool: WriteTool; args: ToolArgs } | null;
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
      promptVersion: "7",
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
  return present(reply, pack.names, outcome, open);
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

function present(
  reply: Reply,
  names: Array<{ symbol: string; name: string; aliases: string[] }>,
  outcome: ToolOutcome | null,
  focus: string | null,
): FinnieTurnResult {
  const cards: FinnieCard[] = [];
  if (reply.showList && names.length) {
    cards.push({ kind: "portfolio", names });
  }
  return {
    say: reply.say,
    tools: reply.write ? [reply.write.tool] : [],
    card: cards.at(-1) ?? null,
    cards,
    sayAfter: false,
    href: outcome?.href ?? null,
    link: outcome?.link ?? null,
    symbol: outcome?.symbol ?? focus,
    book: outcome?.book ?? null,
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

function readReply(data: unknown): Reply {
  const parsed = FinnieReply.safeParse(data);
  if (parsed.success) {
    return {
      say: cleanSay(parsed.data.say),
      showList: parsed.data.showList,
      write: readWrite(parsed.data.write),
    };
  }
  if (!data || typeof data !== "object") {
    return { say: "", showList: false, write: null };
  }
  const rec = data as { say?: unknown; showList?: unknown; write?: unknown };
  return {
    say: typeof rec.say === "string" ? cleanSay(rec.say) : "",
    showList: rec.showList === true,
    write: readWrite(rec.write),
  };
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
