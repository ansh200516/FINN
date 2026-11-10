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
        model({ done: true, say: "Two names are in the book." }),
      );

    const result = await runFinnieTurn("whats in my portfolio", null);

    expect(result.tools).toEqual(["list_portfolio"]);
    expect(result.say).toBe("Two names are in the book.");
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
        model({ done: true, say: "1 to act on, 0 to watch, 1 filed away." }),
      );

    const result = await runFinnieTurn("what should I act on", null);

    expect(result.tools).toEqual(["get_brief"]);
    expect(result.say).toBe("1 to act on, 0 to watch, 1 filed away.");
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
    const follow = String(llm.mock.calls[1]?.[0].prompt);
    expect(follow).toContain('"watch":0');
    expect(follow).toContain('"filedAway":1');
    expect(follow).toContain("PIIND");
    expect(follow).not.toContain("ITC");
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
        model({ done: true, say: "One missed promise is on the card." }),
      );

    const result = await runFinnieTurn("which promises were missed", null);

    expect(result.tools).toEqual(["missed_promises"]);
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
    const follow = String(llm.mock.calls[1]?.[0].prompt);
    expect(follow).toContain("revenue growth");
    expect(follow).not.toContain("unverifiable");
    expect(follow).not.toContain("ebitda_margin");
    expect(follow).not.toContain("order_inflow");
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
    expect(result.say).toBe("PIIND is the name to act on.");
    expect(result.say).not.toBe(FINNIE_DOES_NOT_HAVE);
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
    expect(result.say).toBe("Two names.");
    expect(result.card?.kind).toBe("portfolio");
    if (result.card?.kind === "portfolio") {
      expect(result.card.names.map((row) => row.symbol)).toEqual([
        "ITC",
        "PIIND",
      ]);
    }
  });

  it("answers a buy question in one sentence with no card and no target", async () => {
    llm.mockResolvedValue(
      model({
        tool: "get_quote",
        args: { symbol: "RELIANCE" },
        say: "Target 1500.",
      }),
    );

    const result = await runFinnieTurn("should I buy Reliance", null);

    expect(result.tools).toEqual([]);
    expect(result.card).toBeNull();
    expect(result.href).toBeNull();
    expect(result.say).toBe(FINNIE_DOES_NOT_HAVE);
    expect(result.say).not.toMatch(/\d|target|₹/i);
    expect(llm).not.toHaveBeenCalled();
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
