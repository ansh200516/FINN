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

vi.mock("@/engine/llm/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/llm/gateway")>();
  return { ...actual, callStructured: vi.fn() };
});

import { db, getDb } from "@/db/client";
import { companies, llmLedger, users } from "@/db/schema";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  todayPt,
} from "@/engine/llm/gateway";
import { runFinnieTurn } from "@/lib/finnieTurn";
import { FINNIE_MODEL_DOWN, FINNIE_OUT_OF_CALLS } from "@/lib/finnieTypes";

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
});
