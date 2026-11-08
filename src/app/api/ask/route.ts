import { NextResponse } from "next/server";
import { z } from "zod";
import { LlmBudgetExhausted, LlmCallFailed } from "@/engine/llm/gateway";
import {
  ASK_COOKIE,
  ASK_DAILY_LIMIT,
  answerQuestion,
  asksRemaining,
  cookieFromHeader,
  readAskCount,
  remainingBudget,
  sealAskCookie,
  todayPt,
} from "@/lib/ask";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const log = logger.child({ mod: "api/ask" });

const Body = z.object({
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9&.-]{1,20}$/),
  question: z.string().trim().min(1).max(500),
});

function cookieHeader(count: number, day: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ASK_COOKIE}=${sealAskCookie(count, day)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=129600${secure}`;
}

/**
 * POST /api/ask  { symbol, question }
 * Answer from that company's filings only. Sets the signed per-device counter.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "body must be JSON" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success)
    return NextResponse.json(
      { ok: false, error: "symbol and question are required" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );

  const day = todayPt();
  const used = readAskCount(cookieFromHeader(req.headers.get("cookie")), day);
  const budget = await remainingBudget().catch(() => []);
  if (used.count >= ASK_DAILY_LIMIT) {
    return NextResponse.json(
      {
        ok: false,
        error: "Daily ask limit reached",
        asksRemaining: 0,
        budget,
      },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "set-cookie": cookieHeader(used.count, day),
        },
      },
    );
  }

  try {
    const answered = await answerQuestion(
      parsed.data.symbol,
      parsed.data.question,
    );
    if (!answered)
      return NextResponse.json(
        {
          ok: false,
          error: "Unknown symbol",
          budget,
          asksRemaining: asksRemaining(used.count),
        },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    const next = used.count + 1;
    return NextResponse.json(
      {
        ok: true,
        answer: answered.answer,
        citations: answered.citations,
        notInFilings: answered.notInFilings,
        model: answered.model,
        cached: answered.cached,
        quotesDropped: answered.quotesDropped,
        asksRemaining: asksRemaining(next),
        budget,
      },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": cookieHeader(next, day),
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      e instanceof LlmBudgetExhausted || e instanceof LlmCallFailed ? 503 : 500;
    log.warn({ err: msg.slice(0, 200), status }, "ask failed");
    return NextResponse.json(
      {
        ok: false,
        error:
          e instanceof LlmBudgetExhausted
            ? "Model budget exhausted"
            : "Ask failed",
        asksRemaining: asksRemaining(used.count),
        budget,
      },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
