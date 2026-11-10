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

import { db, getDb } from "@/db/client";
import { companies, events, llmLedger, users } from "@/db/schema";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  todayPt,
} from "@/engine/llm/gateway";
import { estimateTokens } from "@/lib/ask";
import type { ChatContext } from "@/lib/finnieContext";
import { fitChatContext } from "@/lib/finnieContext";
import { FinnieReply, runFinnieTurn } from "@/lib/finnieTurn";
import { FINNIE_NO_MATCH, FINNIE_OUT_OF_CALLS } from "@/lib/finnieTypes";

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

function contextOf(prompt: string): ChatContext {
  const marker = "\n\nContext:\n";
  const at = prompt.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return JSON.parse(prompt.slice(at + marker.length)) as ChatContext;
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
  it("answers an unseen question from the act lines, and does not require list_portfolio", async () => {
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

    const sentence = "blorp the quartz ledger";
    const say = "PIIND has a management change to read. The decision is yours.";
    llm.mockResolvedValueOnce(model({ say, showList: false, write: null }));

    const result = await runFinnieTurn(sentence, null);

    expect(result.say).toBe(say);
    expect(result.say).not.toContain("ITC Limited");
    expect(result.say).not.toContain("PI Industries");
    expect(result.tools).toEqual([]);
    expect(result.tools).not.toContain("list_portfolio");
    expect(result.card).toBeNull();
    expect(result.cards).toEqual([]);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(llm.mock.calls[0]?.[0]).toMatchObject({
      task: "finnie",
      tier: "bulk",
      schema: FinnieReply,
    });
    const prompt = String(llm.mock.calls[0]?.[0].prompt);
    expect(prompt.startsWith(`Question: ${sentence}\n`)).toBe(true);
    const context = contextOf(prompt);
    expect(context.brief.act.map((line) => line.symbol).sort()).toEqual([
      "ITC",
      "PIIND",
    ]);
    expect(
      context.brief.act.some((line) => line.sentence.includes("Jayant Balan")),
    ).toBe(true);
    expect(
      context.brief.act.some((line) =>
        line.sentence.toLowerCase().includes("finance chief"),
      ),
    ).toBe(true);
    for (const line of context.brief.act) {
      expect(line.href.startsWith("/e/")).toBe(true);
    }
    expect(context.portfolio.map((row) => row.symbol)).toEqual([
      "ITC",
      "PIIND",
    ]);
    expect(String(llm.mock.calls[0]?.[0].system)).toContain(
      "using only the context JSON",
    );
    expect(String(llm.mock.calls[0]?.[0].system)).not.toContain(
      "list_portfolio",
    );
    await db.delete(events);
  });

  it("loads the same context for a rating question and an unseen question", async () => {
    const reply = {
      say: "Noted.",
      showList: false,
      write: null,
    };
    llm.mockResolvedValue(model(reply));
    await runFinnieTurn("blorp the quartz ledger", null);
    await runFinnieTurn("rate my portfolio", null);
    const first = contextOf(String(llm.mock.calls[0]?.[0].prompt));
    const second = contextOf(String(llm.mock.calls[1]?.[0].prompt));
    expect(second).toEqual(first);
    expect(String(llm.mock.calls[1]?.[0].prompt)).toContain(
      "Question: rate my portfolio",
    );
    expect(llm.mock.calls.every((call) => call[0].schema === FinnieReply)).toBe(
      true,
    );
  });

  it("shows the holdings card only when the model sets showList", async () => {
    llm.mockResolvedValueOnce(
      model({
        say: "The book is the card.",
        showList: true,
        write: null,
      }),
    );
    const shown = await runFinnieTurn("qqqq list the names", null);
    expect(shown.say).toBe("The book is the card.");
    expect(shown.card?.kind).toBe("portfolio");
    if (shown.card?.kind === "portfolio") {
      expect(shown.card.names.map((row) => row.symbol)).toEqual([
        "ITC",
        "PIIND",
      ]);
    }
    expect(shown.tools).toEqual([]);

    llm.mockResolvedValueOnce(
      model({
        say: "Two names, and that is enough.",
        showList: false,
        write: null,
      }),
    );
    const hidden = await runFinnieTurn("whats in my portfolio", null);
    expect(hidden.say).toBe("Two names, and that is enough.");
    expect(hidden.card).toBeNull();
    expect(hidden.say).not.toContain("ITC Limited");
  });

  it("runs a write the model asked for and keeps the model's sentence", async () => {
    const say = "PIIND is already in the book.";
    llm.mockResolvedValueOnce(
      model({
        say,
        showList: false,
        write: { tool: "add_to_portfolio", args: { symbol: "PIIND" } },
      }),
    );
    const result = await runFinnieTurn("put PIIND in the book", null);
    expect(result.say).toBe(say);
    expect(result.tools).toEqual(["add_to_portfolio"]);
    expect(result.book).toBe("already_in");
    expect(result.symbol).toBe("PIIND");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when the model names a read as a write", async () => {
    llm.mockResolvedValueOnce(
      model({
        say: "Nothing to change.",
        showList: false,
        write: { tool: "list_portfolio", args: {} },
      }),
    );
    const result = await runFinnieTurn("zzzz quantum holdings", null);
    expect(result.say).toBe("Nothing to change.");
    expect(result.tools).toEqual([]);
    expect(result.card).toBeNull();
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("includes the open company for every sentence once a company is in focus", async () => {
    llm.mockResolvedValue(
      model({ say: "Noted.", showList: false, write: null }),
    );
    await runFinnieTurn("any sentence at all", "PIIND");
    await runFinnieTurn("a totally different sentence", null);
    const focused = contextOf(String(llm.mock.calls[0]?.[0].prompt));
    const plain = contextOf(String(llm.mock.calls[1]?.[0].prompt));
    expect(focused.company?.symbol).toBe("PIIND");
    expect(focused.company?.scoredPromises.missed).toBe(0);
    expect(plain.company).toBeNull();
    expect({ ...focused, company: null }).toEqual(plain);
  });

  it("says it could not match when the model call fails", async () => {
    llm.mockRejectedValue(new Error("down"));
    const result = await runFinnieTurn("blorp the quartz ledger", null);
    expect(result.say).toBe(FINNIE_NO_MATCH);
    expect(result.card).toBeNull();
    expect(result.tools).toEqual([]);
    expect(llm).toHaveBeenCalledTimes(1);
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
      const result = await runFinnieTurn("rate my portfolio", null);
      expect(result.say).toBe(FINNIE_OUT_OF_CALLS);
      expect(llm).not.toHaveBeenCalled();
    } finally {
      await db.delete(llmLedger).where(eq(llmLedger.model, name));
    }
  });

  it("keeps the context under the token cap and the list caps", () => {
    const row = (i: number) => ({
      symbol: `S${i}`,
      name: "N".repeat(400),
    });
    const fitted = fitChatContext({
      portfolio: Array.from({ length: 40 }, (_, i) => row(i)),
      brief: {
        watch: 3,
        filedAway: 9,
        act: Array.from({ length: 40 }, (_, i) => ({
          symbol: `A${i}`,
          sentence: "S".repeat(500),
          href: "/e/x",
        })),
      },
      missed: Array.from({ length: 40 }, (_, i) => ({
        symbol: `M${i}`,
        metric: "revenue growth",
        clause: "C".repeat(500),
        href: "/c/M",
      })),
      movers: Array.from({ length: 40 }, (_, i) => ({
        symbol: `V${i}`,
        pct: i,
      })),
      upcoming: Array.from({ length: 20 }, (_, i) => ({
        symbol: `U${i}`,
        what: "W".repeat(400),
        date: "Wed 12 Nov",
      })),
      company: null,
    });
    expect(estimateTokens(JSON.stringify(fitted))).toBeLessThanOrEqual(12_000);
    expect(fitted.missed.length).toBeLessThanOrEqual(15);
    expect(fitted.movers.length).toBeLessThanOrEqual(15);
    expect(fitted.upcoming.length).toBeLessThanOrEqual(8);
    expect(fitted.brief.act.length).toBeLessThanOrEqual(30);
    expect(fitted.brief.watch).toBe(3);
    expect(fitted.brief.filedAway).toBe(9);
  });

  it("has no phrase-to-tool table", () => {
    const turn = readFileSync("src/lib/finnieTurn.ts", "utf8");
    const context = readFileSync("src/lib/finnieContext.ts", "utf8");
    expect(turn).not.toContain("list_portfolio");
    expect(turn).not.toContain("get_brief");
    expect(turn).not.toContain("missed_promises");
    expect(turn).not.toContain("rate my");
    expect(context).not.toContain("list_portfolio");
    expect(context).not.toMatch(/loadChatPack\([^)]*sentence/);
    expect(context).toContain(
      "export async function loadChatPack(focus: string | null)",
    );
    const schema = z.toJSONSchema(FinnieReply, {
      target: "draft-7",
      io: "output",
    });
    const enums = stringEnums(schema);
    expect(enums.some((items) => items.includes("list_portfolio"))).toBe(false);
    expect(enums.some((items) => items.includes("get_brief"))).toBe(false);
    expect(enums.some((items) => items.includes("add_to_portfolio"))).toBe(
      true,
    );
    expect(enums.some((items) => items.includes("mark_read"))).toBe(true);
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
