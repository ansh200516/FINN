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
import { FinnieStep, runFinnieTurn } from "@/lib/finnieTurn";
import {
  FINNIE_DOES_NOT_HAVE,
  FINNIE_MODEL_DOWN,
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
  it("adds PIIND when the model picks add_to_portfolio, and does not list the book", async () => {
    llm
      .mockResolvedValueOnce(
        model({ tool: "add_to_portfolio", args: { symbol: "PIIND" } }),
      )
      .mockResolvedValueOnce(
        model({ done: true, say: "Already in the book: PIIND." }),
      );

    const result = await runFinnieTurn("add PIIND to my portfolio", null);

    expect(result.tools).toEqual(["add_to_portfolio"]);
    expect(result.tools).not.toContain("list_portfolio");
    expect(result.book).toBe("already_in");
    expect(result.say).toBe("Already in the book: PIIND.");
    expect(result.card).toBeNull();
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[0]?.[0]).toMatchObject({
      task: "finnie",
      tier: "bulk",
    });
    const first = String(llm.mock.calls[0]?.[0].prompt);
    expect(first).toContain("add PIIND to my portfolio");
    expect(first).toContain("add_to_portfolio");
    const follow = String(llm.mock.calls[1]?.[0].prompt);
    expect(follow).toContain("already_in");
    expect(follow).toContain("PIIND");
    expect(follow).not.toContain("ITC Limited");
  });

  it("lists the book when the model picks list_portfolio", async () => {
    llm
      .mockResolvedValueOnce(model({ tool: "list_portfolio" }))
      .mockResolvedValueOnce(
        model({ done: true, say: "ITC Limited is already in the book." }),
      );

    const result = await runFinnieTurn("whats in my portfolio", null);

    expect(result.tools).toEqual(["list_portfolio"]);
    expect(result.say).toBe("2 names.");
    expect(result.say).not.toContain("ITC Limited");
    expect(result.card?.kind).toBe("portfolio");
    if (result.card?.kind === "portfolio") {
      expect(result.card.names.map((row) => row.symbol)).toEqual([
        "ITC",
        "PIIND",
      ]);
    }
  });

  it("says one sentence and shows no card when the model call fails", async () => {
    llm.mockRejectedValue(new Error("down"));
    const result = await runFinnieTurn("add PIIND to my portfolio", null);
    expect(result.say).toBe(FINNIE_MODEL_DOWN);
    expect(result.card).toBeNull();
    expect(result.tools).toEqual([]);
    expect(llm.mock.calls.map((call) => call[0].tier)).toEqual([
      "bulk",
      "reason",
    ]);
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

  it("returns Act lines and the watch and filed-away counts from the brief", async () => {
    const at = Date.now() - 5 * 60 * 1000;
    const actKey = `${PIIND}|management_change|chat`;
    await db.insert(events).values([
      {
        eventKey: actKey,
        isin: PIIND,
        category: "management_change",
        firstAt: at,
        lastAt: at,
        tier: 1,
        cardType: "management_change",
        cardJson: JSON.stringify({
          title: "CFO resigns",
          oneLiner: "The chief financial officer resigns.",
          category: "management_change",
          tier: 1,
          priority: 70,
        }),
        announcementIdsJson: "[]",
      },
      {
        eventKey: `${PIIND}|unclassified|chat`,
        isin: PIIND,
        category: "unclassified",
        firstAt: at,
        lastAt: at,
        tier: 3,
        cardType: "routine",
        cardJson: JSON.stringify({
          title: "Routine filing",
          oneLiner: "A routine filing.",
          category: "unclassified",
          tier: 3,
          priority: 1,
        }),
        announcementIdsJson: "[]",
      },
    ]);

    llm
      .mockResolvedValueOnce(
        model({ tool: "get_brief", args: { window: "24h" } }),
      )
      .mockResolvedValueOnce(
        model({
          done: true,
          say: "The chief financial officer resigns. The filing has the names.",
        }),
      );

    const result = await runFinnieTurn("what should I act on", null);

    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).toBe("1 name needs a decision.");
    expect(result.card?.kind).toBe("lines");
    if (result.card?.kind === "lines") {
      expect(result.card.lines.map((line) => line.symbol)).toEqual(["PIIND"]);
      expect(result.card.lines[0]?.href).toBe(
        `/e/${encodeURIComponent(actKey)}`,
      );
      expect(result.card.lines[0]?.text.toLowerCase()).toContain(
        "chief financial officer",
      );
    }
    expect(result.say).not.toMatch(/chief financial officer/i);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0]?.[0].prompt).toContain("get_brief");
  });

  it("lists missed and cut promises and leaves unverifiable rows out", async () => {
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

    llm
      .mockResolvedValueOnce(model({ tool: "missed_promises" }))
      .mockResolvedValueOnce(
        model({
          done: true,
          say: "PIIND revenue growth 12%, FY27, missed.",
        }),
      );

    const result = await runFinnieTurn("which promises were missed", null);

    expect(result.tools).toEqual(["missed_promises"]);
    expect(result.say).toBe("1 missed or cut promise.");
    expect(result.say).not.toContain("revenue growth");
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
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("sends the previous sentence and tool so a follow-up reuses the symbol", async () => {
    llm
      .mockResolvedValueOnce(model({ tool: "get_promises" }))
      .mockResolvedValueOnce(
        model({ done: true, say: "PIIND’s promises are the card." }),
      );

    const result = await runFinnieTurn("and its promises", "PIIND", {
      sentence: "show me PIIND results",
      tool: "get_results",
    });

    expect(result.tools).toEqual(["get_promises"]);
    expect(result.symbol).toBe("PIIND");
    const first = String(llm.mock.calls[0]?.[0].prompt);
    expect(first).toContain("Sentence: and its promises");
    expect(first).toContain("Previous sentence: show me PIIND results");
    expect(first).toContain("Previous tool: get_results");
    expect(first).toContain("Focus: PIIND");
    expect(llm).toHaveBeenCalled();
    expect(llm.mock.calls.every((call) => call[0].task === "finnie")).toBe(
      true,
    );
  });

  it("calls get_brief when the model refuses an act question", async () => {
    const at = Date.now() - 5 * 60 * 1000;
    const actKey = `${PIIND}|management_change|act-question`;
    await db
      .insert(events)
      .values({
        eventKey: actKey,
        isin: PIIND,
        category: "management_change",
        firstAt: at,
        lastAt: at,
        tier: 1,
        cardType: "management_change",
        cardJson: JSON.stringify({
          title: "CFO resigns",
          oneLiner: "The chief financial officer resigns.",
          category: "management_change",
          tier: 1,
          priority: 70,
        }),
        announcementIdsJson: "[]",
      })
      .onConflictDoNothing();

    llm
      .mockResolvedValueOnce(model({ done: true, say: FINNIE_DOES_NOT_HAVE }))
      .mockResolvedValueOnce(
        model({ done: true, say: "PIIND is the name to act on." }),
      );

    const result = await runFinnieTurn(
      "which stocks should i act upon right now?",
      null,
    );

    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).not.toBe("PIIND is the name to act on.");
    expect(result.say).not.toBe(FINNIE_DOES_NOT_HAVE);
    expect(result.say).toMatch(
      /^(1 name needs a decision\.|\d+ names need a decision\.)$/,
    );
    expect(result.card?.kind).toBe("lines");
    if (result.card?.kind === "lines") {
      const line = result.card.lines.find((row) =>
        row.href.includes("act-question"),
      );
      expect(line?.symbol).toBe("PIIND");
      expect(line?.href.startsWith("/e/")).toBe(true);
      expect(line?.text.toLowerCase()).toContain("chief financial officer");
    }
    const call = llm.mock.calls[0]?.[0];
    const prompt = String(call?.prompt);
    const system = String(call?.system);
    for (const name of FINNIE_TOOLS) expect(prompt).toContain(name);
    expect(system).toContain('{"tool":"get_brief","args":{}}');
    expect(system).toContain("should I buy Reliance");
    expect(system).toContain("get_results, then get_promises, then get_quote");
    expect(system).toContain("The decision is yours.");
    expect(system).not.toContain(FINNIE_DOES_NOT_HAVE);
    expect(prompt).not.toContain(FINNIE_DOES_NOT_HAVE);
    expect(prompt).not.toContain("whether to buy");
    expect(system).not.toContain("whether to buy");
  });

  it("calls get_brief when the model names a tool that does not exist", async () => {
    llm
      .mockResolvedValueOnce(
        model({ tool: "act_cards", args: { window: "24h" } }),
      )
      .mockResolvedValueOnce(
        model({ done: true, say: "PIIND is the name to act on." }),
      );

    const result = await runFinnieTurn(
      "which stocks should i act upon right now?",
      null,
    );

    expect(result.tools).toEqual(["get_brief"]);
    expect(result.card?.kind).toBe("lines");
    if (result.card?.kind === "lines") {
      expect(result.card.lines.some((row) => row.href.startsWith("/e/"))).toBe(
        true,
      );
    }
    expect(result.say).not.toBe(FINNIE_DOES_NOT_HAVE);
  });

  it("lists the book when the model refuses a portfolio question", async () => {
    llm
      .mockResolvedValueOnce(model({ done: true, say: FINNIE_DOES_NOT_HAVE }))
      .mockResolvedValueOnce(model({ done: true, say: "Two names." }));

    const result = await runFinnieTurn("what's in my portfolio", null);

    expect(result.tools).toEqual(["list_portfolio"]);
    expect(result.say).toBe("2 names.");
    expect(result.say).not.toBe("Two names.");
    expect(result.card?.kind).toBe("portfolio");
    if (result.card?.kind === "portfolio") {
      expect(result.card.names.map((row) => row.symbol)).toEqual([
        "ITC",
        "PIIND",
      ]);
    }
  });

  it("shows filings and the price for a buy, and leaves the decision", async () => {
    const line =
      "I can only give you the filings and the price. The decision is yours.";
    for (const sentence of [
      "should I buy Reliance",
      "is ITC a buy",
      "should I sell Voltas",
    ]) {
      llm.mockReset();
      llm.mockResolvedValue(
        model({ tool: "none", say: "Buy it. Target 1500. I can't do that." }),
      );
      const result = await runFinnieTurn(sentence, null);
      expect(result.tools).toEqual([
        "get_results",
        "get_promises",
        "get_quote",
      ]);
      expect(result.say).toBe(line);
      expect(result.say).toContain("The decision is yours.");
      expect(result.say).not.toBe("The decision is yours.");
      expect(
        result.say.split(/[.!?]+/).filter((part) => part.trim()).length,
      ).toBeGreaterThan(1);
      expect(result.say).not.toMatch(
        /\bbuy\b|don’t buy|don't buy|target|rating/i,
      );
      expect(result.say).not.toMatch(/\d|₹/);
      expect(result.sayAfter).toBe(true);
      expect(
        result.cards.map((card) =>
          card.kind === "reply" ? card.reply.kind : card.kind,
        ),
      ).toEqual(["results", "promises", "nse"]);
      const price = result.cards[2];
      if (price?.kind === "reply" && price.reply.kind === "nse")
        expect(price.reply.headline).toContain("₹");
      expect(result.say).not.toContain("1500");
      expect(result.say).not.toContain("I can't");
    }
  });

  it("shows the results card when asked for shareholding or delivery", async () => {
    llm.mockResolvedValue(model({ tool: "none", say: "I can't do that." }));
    const holding = await runFinnieTurn(
      "what is the shareholding of ITC",
      null,
    );
    expect(holding.tools).toEqual(["get_results"]);
    expect(holding.say).toBe("Shareholding is not in the filings I have.");
    expect(holding.symbol).toBe("ITC");
    expect(holding.cards[0]).toMatchObject({
      kind: "reply",
      reply: { kind: "results" },
    });

    const delivery = await runFinnieTurn("delivery data for ITC", null);
    expect(delivery.tools).toEqual(["get_results"]);
    expect(delivery.say).toBe("Delivery is not in the filings I have.");
    expect(delivery.cards[0]).toMatchObject({
      kind: "reply",
      reply: { kind: "results" },
    });
  });

  it("shows the index quote when asked if the market is open", async () => {
    llm.mockResolvedValue(model({ tool: "none", say: FINNIE_DOES_NOT_HAVE }));
    const result = await runFinnieTurn("is the market open", null);
    expect(result.tools).toEqual(["get_index"]);
    expect(result.say).toBe("NSE does not publish whether the market is open.");
    expect(result.say).not.toMatch(/\d/);
    const card = result.cards[0];
    expect(card?.kind).toBe("reply");
    if (card?.kind === "reply" && card.reply.kind === "nse") {
      expect(card.reply.headline).toContain("NIFTY 50");
      expect(card.reply.note.startsWith("NSE")).toBe(true);
    }
  });

  it("shows Act lines when asked for news", async () => {
    llm.mockResolvedValue(model({ tool: "none", say: "I can't do that." }));
    const result = await runFinnieTurn("any news today", null);
    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).toBe(
      "I don't have news. Here is what needs a decision.",
    );
    expect(result.say).not.toBe("I can't do that.");
  });

  it("drops a recommendation and keeps the quote the tool returned", async () => {
    llm
      .mockResolvedValueOnce(
        model({ tool: "get_quote", args: { symbol: "ITC" } }),
      )
      .mockResolvedValueOnce(
        model({ tool: "none", say: "Buy it. Target 1500." }),
      );
    const result = await runFinnieTurn("what is the ITC quote", null);
    expect(result.tools).toEqual(["get_quote"]);
    expect(result.say).not.toMatch(/\bbuy\b|target|1500/i);
    expect(result.say).toContain("ITC");
    expect(result.card?.kind).toBe("reply");
  });

  it("does not answer with only a refusal when nothing matches", async () => {
    llm.mockResolvedValue(model({ tool: "none", say: "I can't do that." }));
    const result = await runFinnieTurn("what is the weather", null);
    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).not.toBe("I can't do that.");
    expect(result.say).not.toBe(FINNIE_DOES_NOT_HAVE);
    expect(result.say.toLowerCase()).not.toContain("can't");
  });

  it("does not quote the first Act row when two names need a decision", async () => {
    await db.delete(events);
    const now = Date.now();
    await db.insert(events).values([
      {
        eventKey: `${PIIND}|management_change|two-a`,
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
        eventKey: `${ITC}|management_change|two-b`,
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

    llm
      .mockResolvedValueOnce(model({ tool: "get_brief", args: {} }))
      .mockResolvedValueOnce(
        model({
          done: true,
          say: "Jayant Balan becomes MD. The filing has the names.",
        }),
      );

    const result = await runFinnieTurn("which stocks should i act upon", null);

    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).toBe("2 names need a decision.");
    expect(result.say.toLowerCase()).not.toMatch(/\bbuy\b|\brecommend/);
    expect(result.card?.kind).toBe("lines");
    if (result.card?.kind === "lines") {
      expect(result.card.lines).toHaveLength(2);
      expect(result.card.lines.map((line) => line.symbol)).toEqual([
        "PIIND",
        "ITC",
      ]);
      for (const line of result.card.lines) {
        expect(line.href.startsWith("/e/")).toBe(true);
        expect(result.say).not.toBe(line.text);
      }
      expect(result.card.lines[0]?.text).toContain("Jayant Balan");
    }
    expect(llm).toHaveBeenCalledTimes(1);

    await db.delete(events);
    llm.mockResolvedValueOnce(
      model({
        done: true,
        say: "Jayant Balan becomes MD. The filing has his profile.",
      }),
    );
    const empty = await runFinnieTurn("which stocks should i act upon", null);
    expect(empty.tools).toEqual(["get_brief"]);
    expect(empty.say).toBe("Nothing to act on.");
    expect(empty.card).toBeNull();
  });

  it("requires a tool in one object, including get_brief", () => {
    const js = z.toJSONSchema(FinnieStep, {
      target: "draft-7",
      io: "output",
    }) as {
      anyOf?: unknown;
      required?: string[];
      properties?: { tool?: { enum?: string[]; description?: string } };
    };
    expect(js.anyOf).toBeUndefined();
    expect(js.required).toContain("tool");
    expect(js.properties?.tool?.enum).toEqual([...FINNIE_TOOLS, "none"]);
    expect(js.properties?.tool?.description).toContain("get_brief");
    expect(js.properties?.tool?.description).toContain("not a buy");
  });
});
