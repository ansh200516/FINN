import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { z } from "zod";

vi.mock("@/engine/llm/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/llm/gateway")>();
  return { ...actual, callStructured: vi.fn() };
});

vi.mock("@/engine/sources/nse-mcp", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/engine/sources/nse-mcp")>();
  return {
    ...actual,
    answerNse: vi.fn(
      async (ask: { kind: string; symbol?: string; indexName?: string }) => {
        if (ask.kind === "index") {
          return {
            headline: `${ask.indexName ?? "NIFTY 50"} 25,044.65, up 0.23%.`,
            note: "NSE · 09 Nov 2026 15:30",
          };
        }
        const symbol = ask.symbol ?? "NSE";
        return {
          headline: `${symbol} ₹ 1,324.40, up 0.03%.`,
          note: "NSE · 09 Nov 2026 16:00",
        };
      },
    ),
  };
});

import { db, getDb } from "@/db/client";
import { companies, events, guidance, llmLedger, users } from "@/db/schema";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  todayPt,
} from "@/engine/llm/gateway";
import { FinnieCalls, FinnieSay, runFinnieTurn } from "@/lib/finnieTurn";
import {
  FINNIE_NO_MATCH,
  FINNIE_OUT_OF_CALLS,
  FINNIE_TOOLS,
} from "@/lib/finnieTypes";

const llm = callStructured as unknown as Mock<typeof callStructured>;

const PIIND = "INE603J01030";
const ITC = "INE154A01025";

function model(data: unknown) {
  return {
    data,
    model: "gemini-3.5-flash-lite",
    cached: false,
    tokensIn: 1,
    tokensOut: 1,
    tokensThought: 0,
    latencyMs: 1,
    cacheKey: "test",
  };
}

function answerPrompt(sentence: string, prompt: string): string {
  expect(prompt.startsWith(`${sentence}\n`)).toBe(true);
  const tail = prompt.slice(sentence.length + 1);
  expect(JSON.stringify(JSON.parse(tail))).toBe(tail);
  return tail;
}

beforeAll(async () => {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  await db.insert(companies).values([
    {
      isin: PIIND,
      nseSymbol: "PIIND",
      name: "PI Industries Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    },
    {
      isin: ITC,
      nseSymbol: "ITC",
      name: "ITC Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    },
  ]);
  await db.insert(users).values({
    id: "demo",
    portfolioIsinsJson: JSON.stringify([PIIND, ITC]),
    createdAt: Date.now(),
  });
});

beforeEach(() => {
  llm.mockReset();
});

describe("runFinnieTurn", () => {
  it("adds PIIND when the model picks add_to_portfolio, and says what the model wrote", async () => {
    const sentence = "add PIIND to my portfolio";
    const say = "Already in the book: PIIND.";
    llm
      .mockResolvedValueOnce(
        model({
          calls: [{ tool: "add_to_portfolio", args: { symbol: "PIIND" } }],
        }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn(sentence, null);

    expect(result.tools).toEqual(["add_to_portfolio"]);
    expect(result.tools).not.toContain("list_portfolio");
    expect(result.book).toBe("already_in");
    expect(result.say).toBe(say);
    expect(result.card).toBeNull();
    expect(result.sayAfter).toBe(false);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[0]?.[0]).toMatchObject({
      task: "finnie",
      tier: "bulk",
    });
    expect(llm.mock.calls[1]?.[0].tier).toBe("bulk");
    const first = String(llm.mock.calls[0]?.[0].prompt);
    expect(first).toContain(sentence);
    expect(first).toContain("add_to_portfolio");
    const tail = answerPrompt(sentence, String(llm.mock.calls[1]?.[0].prompt));
    expect(tail).toContain("already_in");
    expect(tail).toContain("PIIND");
    expect(tail).not.toContain("ITC Limited");
    expect(tail).not.toContain("Tools:");
  });

  it("lists the book and keeps the model's sentence, not a count", async () => {
    const say = "ITC and PIIND are already in the book.";
    llm
      .mockResolvedValueOnce(
        model({ calls: [{ tool: "list_portfolio", args: {} }] }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn("whats in my portfolio", null);

    expect(result.tools).toEqual(["list_portfolio"]);
    expect(result.say).toBe(say);
    expect(result.say).not.toBe("2 names.");
    expect(result.card?.kind).toBe("portfolio");
    if (result.card?.kind === "portfolio") {
      expect(result.card.names.map((row) => row.symbol)).toEqual([
        "ITC",
        "PIIND",
      ]);
    }
  });

  it("says it could not match when the tool step fails, and does not try another tier", async () => {
    llm.mockRejectedValue(new Error("down"));
    const result = await runFinnieTurn("add PIIND to my portfolio", null);
    expect(result.say).toBe(FINNIE_NO_MATCH);
    expect(result.card).toBeNull();
    expect(result.cards).toEqual([]);
    expect(result.tools).toEqual([]);
    expect(llm.mock.calls.map((call) => call[0].tier)).toEqual(["bulk"]);
  });

  it("does not call the model when the bulk ledger is at 80% of cap", async () => {
    const name = MODEL_LADDERS.bulk()[0] ?? "gemini-3.5-flash-lite";
    const cap = dailyCap(name);
    await db.delete(llmLedger).where(eq(llmLedger.model, name));
    await db.insert(llmLedger).values({
      model: name,
      datePt: todayPt(),
      requests: Math.ceil(cap * 0.8),
      tokensIn: 0,
      tokensOut: 0,
      tokensThought: 0,
      errors: 0,
      updatedAt: Date.now(),
    });
    try {
      const result = await runFinnieTurn("add PIIND to my portfolio", null);
      expect(result.say).toBe(FINNIE_OUT_OF_CALLS);
      expect(result.card).toBeNull();
      expect(llm).not.toHaveBeenCalled();
    } finally {
      await db.delete(llmLedger).where(eq(llmLedger.model, name));
    }
  });

  it("shows the model's sentence for a novel brief question, not a canned count", async () => {
    await db.delete(events);
    const now = Date.now();
    await db.insert(events).values([
      {
        eventKey: `${PIIND}|management_change|deal`,
        isin: PIIND,
        category: "management_change",
        firstAt: now - 60_000,
        lastAt: now - 60_000,
        tier: 1,
        cardType: "management_change",
        cardJson: JSON.stringify({
          title: "Managing director",
          oneLiner: "Jayant Balan becomes MD.",
          category: "management_change",
          tier: 1,
          priority: 80,
        }),
        announcementIdsJson: "[]",
      },
      {
        eventKey: `${ITC}|management_change|deal`,
        isin: ITC,
        category: "management_change",
        firstAt: now - 5 * 60_000,
        lastAt: now - 5 * 60_000,
        tier: 1,
        cardType: "management_change",
        cardJson: JSON.stringify({
          title: "Finance chief",
          oneLiner: "The finance chief leaves the board.",
          category: "management_change",
          tier: 1,
          priority: 70,
        }),
        announcementIdsJson: "[]",
      },
    ]);

    const sentence = "anything I need to deal with today?";
    const say =
      "PIIND and ITC each have a management change to read. The decision is yours.";
    llm
      .mockResolvedValueOnce(
        model({ calls: [{ tool: "get_brief", args: {} }] }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn(sentence, null);

    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).toBe(say);
    expect(result.say).not.toMatch(/names need a decision|Nothing to act on/);
    expect(result.say).not.toBe("Jayant Balan becomes MD.");
    expect(result.card?.kind).toBe("lines");
    if (result.card?.kind === "lines") {
      expect(result.card.lines.map((line) => line.symbol).sort()).toEqual([
        "ITC",
        "PIIND",
      ]);
      for (const line of result.card.lines) {
        expect(line.href.startsWith("/e/")).toBe(true);
        expect(result.say).not.toBe(line.text);
      }
      expect(
        result.card.lines.some((line) => line.text.includes("Jayant Balan")),
      ).toBe(true);
      expect(
        result.card.lines.some((line) => line.text.includes("finance chief")),
      ).toBe(true);
    }
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls.map((call) => call[0].tier)).toEqual([
      "bulk",
      "bulk",
    ]);
    const first = String(llm.mock.calls[0]?.[0].prompt);
    const system = String(llm.mock.calls[0]?.[0].system);
    expect(first).toContain(sentence);
    for (const name of FINNIE_TOOLS) expect(first).toContain(name);
    expect(first).not.toContain("names need a decision");
    expect(system).not.toContain("should I buy");
    expect(system).not.toContain("does not have that");
    const tail = answerPrompt(sentence, String(llm.mock.calls[1]?.[0].prompt));
    expect(tail).toContain("Jayant Balan");
    expect(tail).not.toContain("names need a decision");
    expect(tail).not.toContain("disable_alert");
    expect(String(llm.mock.calls[1]?.[0].system)).not.toContain("get_brief");
  });

  it("gives the answer step only the sentence and the tool JSON, with no price added", async () => {
    const sentence = "what is the price of ITC";
    const say = "ITC and PIIND are in the book.";
    llm
      .mockResolvedValueOnce(
        model({ calls: [{ tool: "list_portfolio", args: {} }] }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn(sentence, null);

    expect(llm).toHaveBeenCalledTimes(2);
    const call = llm.mock.calls[1]?.[0];
    expect(call?.parts).toBeUndefined();
    expect(call?.tier).toBe("bulk");
    const prompt = String(call?.prompt);
    const tail = answerPrompt(sentence, prompt);
    const payload = JSON.parse(tail) as Array<{
      tool: string;
      data: { names?: Array<{ symbol: string }> };
    }>;
    expect(payload).toEqual([
      {
        tool: "list_portfolio",
        data: {
          status: "listed",
          count: 2,
          names: [
            { symbol: "ITC", name: "ITC Limited" },
            { symbol: "PIIND", name: "PI Industries Limited" },
          ],
        },
      },
    ]);
    expect(tail).not.toMatch(/₹|1324|1,324|1500|1,500/);
    expect(tail.toLowerCase()).not.toContain("price");
    expect(prompt).not.toContain("Tools:");
    expect(prompt).not.toContain("Previous sentence");
    expect(prompt).not.toContain("get_quote");
    expect(String(call?.system)).not.toMatch(/₹|\d/);
    expect(String(call?.system)).not.toContain("ITC Limited");
    expect(result.say).toBe(say);
    expect(result.say).not.toMatch(/₹|\d/);
    expect(result.card?.kind).toBe("portfolio");
  });

  it("keeps the model's sentence for missed promises and still lists the row", async () => {
    await db.insert(guidance).values([
      {
        id: "g-miss-piind",
        isin: PIIND,
        docId: "doc-miss-piind",
        quote: "We expect revenue growth of 12 percent.",
        metric: "revenue_growth",
        direction: "up",
        low: 12,
        high: 12,
        unit: "%",
        horizon: "FY27",
        status: "settled",
        verdict: "missed",
        evidenceJson: "{}",
      },
      {
        id: "g-old-piind",
        isin: PIIND,
        docId: "doc-old-piind",
        quote: "Order inflow should rise.",
        metric: "order_inflow",
        status: "superseded",
        verdict: "missed",
        evidenceJson: "{}",
      },
      {
        id: "g-unver-itc",
        isin: ITC,
        docId: "doc-unver-itc",
        quote: "Margins should hold.",
        metric: "ebitda_margin",
        status: "open",
        verdict: "unverifiable",
        evidenceJson: "{}",
      },
    ]);

    const say = "PIIND missed the revenue-growth promise for FY27.";
    llm
      .mockResolvedValueOnce(
        model({ calls: [{ tool: "missed_promises", args: {} }] }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn("which promises were missed", null);

    expect(result.tools).toEqual(["missed_promises"]);
    expect(result.say).toBe(say);
    expect(result.say).not.toBe("1 missed or cut promise.");
    expect(result.card?.kind).toBe("lines");
    if (result.card?.kind === "lines") {
      expect(result.card.lines).toHaveLength(1);
      expect(result.card.lines[0]).toMatchObject({
        symbol: "PIIND",
        href: "/c/PIIND",
      });
      expect(result.card.lines[0]?.text).toContain("revenue growth");
      expect(result.card.lines[0]?.text).toContain("12%");
      expect(result.card.lines[0]?.text).toContain("missed");
      expect(result.card.lines[0]?.text).not.toContain("ebitda");
    }
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it("sends the previous sentence to the tool step only", async () => {
    const sentence = "and its promises";
    llm
      .mockResolvedValueOnce(
        model({ calls: [{ tool: "get_promises", args: { symbol: "PIIND" } }] }),
      )
      .mockResolvedValueOnce(model({ say: "PIIND’s promises are the card." }));

    const result = await runFinnieTurn(sentence, "PIIND", {
      sentence: "show me PIIND results",
      tool: "get_results",
    });

    expect(result.tools).toEqual(["get_promises"]);
    expect(result.symbol).toBe("PIIND");
    expect(result.say).toBe("PIIND’s promises are the card.");
    const first = String(llm.mock.calls[0]?.[0].prompt);
    expect(first).toContain("Sentence: and its promises");
    expect(first).toContain("Previous sentence: show me PIIND results");
    expect(first).toContain("Open company: PIIND");
    expect(first).not.toContain("Previous tool");
    const second = String(llm.mock.calls[1]?.[0].prompt);
    answerPrompt(sentence, second);
    expect(second).not.toContain("show me PIIND results");
    expect(second).not.toContain("Open company");
    expect(second).not.toContain("get_results");
    expect(llm.mock.calls.every((call) => call[0].tier === "bulk")).toBe(true);
  });

  it("does not invent a tool when the model returns none", async () => {
    llm.mockResolvedValue(model({ calls: [] }));
    for (const sentence of ["what is the weather", "should I buy Reliance"]) {
      llm.mockClear();
      llm.mockResolvedValue(model({ calls: [] }));
      const result = await runFinnieTurn(sentence, null);
      expect(result.say).toBe(FINNIE_NO_MATCH);
      expect(result.tools).toEqual([]);
      expect(result.cards).toEqual([]);
      expect(result.card).toBeNull();
      expect(llm).toHaveBeenCalledTimes(1);
    }
  });

  it("does not substitute get_brief when the model names an unknown tool", async () => {
    llm.mockResolvedValueOnce(
      model({ calls: [{ tool: "act_cards", args: { window: "24h" } }] }),
    );
    const result = await runFinnieTurn(
      "which stocks should i act upon right now?",
      null,
    );
    expect(result.say).toBe(FINNIE_NO_MATCH);
    expect(result.tools).toEqual([]);
    expect(result.card).toBeNull();
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("shows the cards with no sentence when the answer step fails", async () => {
    llm
      .mockResolvedValueOnce(
        model({ calls: [{ tool: "list_portfolio", args: {} }] }),
      )
      .mockRejectedValueOnce(new Error("down"));

    const result = await runFinnieTurn("whats in my portfolio", null);

    expect(result.tools).toEqual(["list_portfolio"]);
    expect(result.say).toBe("");
    expect(result.card?.kind).toBe("portfolio");
    if (result.card?.kind === "portfolio") {
      expect(result.card.names.map((row) => row.symbol)).toEqual([
        "ITC",
        "PIIND",
      ]);
    }
  });

  it("runs the tools the model chose for a buy question and keeps that say", async () => {
    const say = "The filings and the price are below. The decision is yours.";
    llm
      .mockResolvedValueOnce(
        model({
          calls: [
            { tool: "get_results", args: { symbol: "ITC" } },
            { tool: "get_promises", args: { symbol: "ITC" } },
            { tool: "get_quote", args: { symbol: "ITC" } },
          ],
        }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn("should I buy ITC", null);

    expect(result.tools).toEqual(["get_results", "get_promises", "get_quote"]);
    expect(result.say).toBe(say);
    expect(result.sayAfter).toBe(false);
    expect(result.say).not.toMatch(/\bbuy\b|target/i);
    const quote = result.cards.find(
      (card) => card.kind === "reply" && card.reply.kind === "nse",
    );
    expect(quote?.kind).toBe("reply");
    if (quote?.kind === "reply" && quote.reply.kind === "nse")
      expect(quote.reply.headline).toContain("₹");
    expect(
      result.cards.some(
        (card) => card.kind === "reply" && card.reply.kind === "results",
      ),
    ).toBe(false);
  });

  it("runs at most four tools", async () => {
    const say = "Four sets of rows.";
    llm
      .mockResolvedValueOnce(
        model({
          calls: [
            { tool: "list_portfolio", args: {} },
            { tool: "list_unread", args: {} },
            { tool: "get_upcoming", args: {} },
            { tool: "missed_promises", args: {} },
            { tool: "movers", args: { pct: 5 } },
          ],
        }),
      )
      .mockResolvedValueOnce(model({ say }));

    const result = await runFinnieTurn("what is on the desk", null);

    expect(result.tools).toEqual([
      "list_portfolio",
      "list_unread",
      "get_upcoming",
      "missed_promises",
    ]);
    expect(result.tools).not.toContain("movers");
    expect(result.say).toBe(say);
  });

  it("asks for tool calls in one object, then a say, and has no phrase router", () => {
    const calls = z.toJSONSchema(FinnieCalls, {
      target: "draft-7",
      io: "output",
    }) as {
      anyOf?: unknown;
      required?: string[];
      properties?: { say?: unknown; calls?: unknown };
    };
    expect(calls.anyOf).toBeUndefined();
    expect(calls.required).toContain("calls");
    expect(calls.properties?.say).toBeUndefined();
    const enums = stringEnums(calls);
    expect(enums).toContainEqual([...FINNIE_TOOLS]);
    expect(enums.some((items) => items.includes("none"))).toBe(false);

    const say = z.toJSONSchema(FinnieSay, {
      target: "draft-7",
      io: "output",
    }) as {
      anyOf?: unknown;
      required?: string[];
      properties?: { say?: unknown; tool?: unknown };
    };
    expect(say.anyOf).toBeUndefined();
    expect(say.required).toContain("say");
    expect(say.properties?.tool).toBeUndefined();

    const src = readFileSync("src/lib/finnieTurn.ts", "utf8");
    expect(src).not.toContain("names need a decision");
    expect(src).not.toContain("Nothing to act on");
    expect(src).not.toContain("does not have that");
    expect(src).not.toContain("coveredTool");
    expect(src).not.toContain("scriptFor");
    expect(src).not.toContain("FINNIE_DECISION_LINE");
  });
});

function stringEnums(node: unknown, found: string[][] = []): string[][] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const item of node) stringEnums(item, found);
    return found;
  }
  const rec = node as Record<string, unknown>;
  if (
    Array.isArray(rec.enum) &&
    rec.enum.every((item) => typeof item === "string")
  )
    found.push(rec.enum as string[]);
  for (const value of Object.values(rec)) stringEnums(value, found);
  return found;
}
