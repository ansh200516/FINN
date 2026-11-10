import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import {
  companies,
  events,
  guidance,
  llmLedger,
  resultsQuarters,
  users,
} from "@/db/schema";
import {
  callStructured,
  dailyCap,
  MODEL_LADDERS,
  todayPt,
} from "@/engine/llm/gateway";
import { estimateTokens } from "@/lib/ask";
import { fitChatContext } from "@/lib/finnieContext";
import { FinnieSay, runFinnieTurn, ToolPlan } from "@/lib/finnieTurn";
import {
  FINNIE_NO_MATCH,
  FINNIE_OUT_OF_CALLS,
  FINNIE_TOOLS,
} from "@/lib/finnieTypes";
import { FinnieAnswer } from "@/ui/Desk";

const llm = callStructured as unknown as Mock<typeof callStructured>;

const PIIND = "INE603J01030";
const ITC = "INE154A01025";
const RELIANCE = "INE002A01018";
const CR = 1e7;

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

function factsOf(prompt: string): Array<{ tool: string; data: unknown }> {
  const marker = "\n\nTools:\n";
  const at = prompt.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  return JSON.parse(prompt.slice(at + marker.length)) as Array<{
    tool: string;
    data: unknown;
  }>;
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
  it("gives a novel question the tools the model named, and answers from those payloads", async () => {
    await db.delete(guidance).where(eq(guidance.isin, RELIANCE));
    await db.delete(resultsQuarters).where(eq(resultsQuarters.isin, RELIANCE));
    await db.delete(companies).where(eq(companies.isin, RELIANCE));
    const revs = [100, 110, 120, 130, 150];
    const ends = [
      "2024-09-30",
      "2024-12-31",
      "2025-03-31",
      "2025-06-30",
      "2025-09-30",
    ];
    const openQuote = Array.from(
      { length: 50 },
      (_, i) => `word${String(i).padStart(2, "0")}`,
    ).join(" ");
    await db.insert(companies).values({
      isin: RELIANCE,
      nseSymbol: "RELIANCE",
      name: "Reliance Industries Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    });
    await db.insert(resultsQuarters).values(
      ends.map((periodEnd, i) => ({
        isin: RELIANCE,
        periodEnd,
        basis: "consolidated",
        source: "xbrl",
        revenue: (revs[i] ?? 0) * CR,
        pat: (revs[i] ?? 0) * 0.1 * CR,
        checksJson: "{}",
        updatedAt: Date.now(),
      })),
    );
    await db.insert(guidance).values([
      {
        id: "rel-open",
        isin: RELIANCE,
        docId: "doc-rel",
        quote: openQuote,
        metric: "revenue_growth",
        direction: "range",
        low: 10,
        high: 12,
        unit: "%",
        horizon: "FY26",
        status: "open",
        verdict: null,
        evidenceJson: "{}",
        createdAt: Date.now(),
      },
      {
        id: "rel-kept",
        isin: RELIANCE,
        docId: "doc-rel",
        quote: "EBITDA margin holds at eleven percent.",
        metric: "ebitda_margin",
        direction: "absolute",
        low: 11,
        high: 11,
        unit: "%",
        status: "settled",
        verdict: "kept",
        evidenceJson: JSON.stringify({
          delivered: { value: 11, unit: "%", source: "xbrl" },
        }),
        createdAt: Date.now() - 1000,
      },
      {
        id: "rel-old",
        isin: RELIANCE,
        docId: "doc-rel",
        quote: "SUPERSEDED_MARKER should stay out of the payload.",
        metric: "capex",
        status: "superseded",
        verdict: "cut",
        evidenceJson: "{}",
        createdAt: Date.now() - 2000,
      },
    ]);
    try {
      const sentence = "zylophone the marigold ledger";
      const say =
        "RELIANCE revenue growth of 10–12% is open and not yet scored. Management said word00. The margin row was kept at 11%. The decision is yours.";
      llm.mockResolvedValueOnce(
        model({
          calls: [
            {
              tool: "get_results",
              args: { symbol: "RELIANCE", quarters: 4 },
            },
            { tool: "get_promises", args: { symbol: "RELIANCE" } },
          ],
        }),
      );
      llm.mockResolvedValueOnce(model({ say }));
      const result = await runFinnieTurn(sentence, null);
      expect(llm).toHaveBeenCalledTimes(2);
      expect(llm.mock.calls[0]?.[0]).toMatchObject({
        task: "finnie",
        tier: "bulk",
        schema: ToolPlan,
        system: expect.stringContaining("Do not answer"),
      });
      expect(llm.mock.calls[1]?.[0]).toMatchObject({
        schema: FinnieSay,
        system: expect.stringContaining("only the tool JSON"),
      });
      const first = String(llm.mock.calls[0]?.[0].prompt);
      const second = String(llm.mock.calls[1]?.[0].prompt);
      expect(first.startsWith(`Question: ${sentence}`)).toBe(true);
      expect(first).toContain("Catalog:");
      for (const name of FINNIE_TOOLS) expect(first).toContain(name);
      expect(first).not.toContain("PI Industries");
      expect(first).not.toContain("word00");
      expect(first).not.toContain('"crore":150');
      expect(second).not.toContain("Catalog:");
      expect(second.startsWith(`Question: ${sentence}`)).toBe(true);
      const facts = factsOf(second);
      expect(facts.map((row) => row.tool)).toEqual([
        "get_results",
        "get_promises",
      ]);
      const results = facts[0]?.data as {
        symbol: string;
        quarters: Array<{
          period: string;
          revenue: { crore: number; yoyPct: number | null };
        }>;
      };
      expect(results.symbol).toBe("RELIANCE");
      expect(results.quarters.map((row) => row.period)).toEqual([
        "Q3 FY25",
        "Q4 FY25",
        "Q1 FY26",
        "Q2 FY26",
      ]);
      expect(results.quarters[3]?.revenue).toMatchObject({
        crore: 150,
        yoyPct: 50,
      });
      const promises = facts[1]?.data as {
        rows: Array<{
          quote: string;
          metric: string;
          promised: string;
          verdict: string;
          delivered: string | null;
        }>;
      };
      expect(promises.rows).toHaveLength(2);
      const open = promises.rows.find((row) => row.verdict === "open");
      const kept = promises.rows.find((row) => row.verdict === "kept");
      expect(open?.metric).toBe("revenue growth");
      expect(open?.promised).toContain("10");
      expect(open?.promised).toContain("12");
      expect(open?.delivered).toBeNull();
      expect(open?.quote).toContain("word00");
      expect(open?.quote).toContain("word39");
      expect(open?.quote).not.toContain("word40");
      expect(kept?.quote).toContain("eleven percent");
      expect(kept?.delivered).toContain("11");
      expect(second).not.toContain("SUPERSEDED_MARKER");
      expect(result.say).toBe(say);
      expect(result.say).not.toContain("Q3 FY25");
      expect(result.say).not.toMatch(/qoqPct|yoyPct/);
      expect(result.say).not.toContain("the results are Q2");
      expect(result.tools).toEqual(["get_results", "get_promises"]);
      expect(result.pages).toEqual(["/c/RELIANCE", "/c/RELIANCE"]);
      const turn = readFileSync("src/lib/finnieTurn.ts", "utf8");
      const tools = readFileSync("src/lib/finnieTools.ts", "utf8");
      expect(turn).not.toContain("zylophone");
      expect(turn).not.toContain("marigold");
      expect(turn).not.toContain("loadChatPack");
      expect(turn).not.toContain("the results are Q2");
      expect(tools).not.toContain("the results are Q2");
      expect(first).toContain("Examples of tool choice");
      expect(second).not.toContain("Examples of tool choice");
      expect(turn).not.toMatch(
        /(?:sentence|text|question)\.(?:match|includes|search|toLowerCase)/,
      );
      expect(tools).not.toMatch(
        /(?:sentence|text|question)\.(?:match|includes|search|toLowerCase)/,
      );
      const html = renderToStaticMarkup(
        createElement(FinnieAnswer, {
          say: result.say,
          cards: result.cards,
          pages: result.pages,
          links: result.links,
        }),
      );
      expect(html).toContain(say);
      expect(html).toContain("word00");
      expect(html).not.toContain("word40");
      expect(html).toContain("eleven percent");
      expect(html).toContain("Open");
      expect(html).toContain("Kept");
      expect(html).toContain("Q3 FY25");
      expect(html).toContain("Q4 FY25");
      expect(html).toContain("Q1 FY26");
      expect(html).toContain("Q2 FY26");
      expect(html).toContain("Revenue");
      expect(html).toContain("QoQ");
      expect(html).toContain("YoY");
      expect(html).not.toContain("qoqPct");
      expect(html).not.toContain("yoyPct");
      expect(html).toContain("more on the company page");
      expect(html).toContain("Full page");
      expect(html).toContain('href="/c/RELIANCE"');
      expect(html).not.toContain("the results are Q2");
    } finally {
      await db.delete(guidance).where(eq(guidance.isin, RELIANCE));
      await db
        .delete(resultsQuarters)
        .where(eq(resultsQuarters.isin, RELIANCE));
      await db.delete(companies).where(eq(companies.isin, RELIANCE));
    }
  });

  it("gives the answer call both payloads for the brief's promised-versus-delivered sentence", async () => {
    const sentence =
      "take the last four quarters and, against management's own headline guidance and growth commentary, tell me what was promised vs. what was actually delivered";
    await db.delete(guidance).where(eq(guidance.isin, RELIANCE));
    await db.delete(resultsQuarters).where(eq(resultsQuarters.isin, RELIANCE));
    await db.delete(companies).where(eq(companies.isin, RELIANCE));
    const ends = [
      "2024-09-30",
      "2024-12-31",
      "2025-03-31",
      "2025-06-30",
      "2025-09-30",
    ];
    await db.insert(companies).values({
      isin: RELIANCE,
      nseSymbol: "RELIANCE",
      name: "Reliance Industries Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    });
    await db.insert(resultsQuarters).values(
      ends.map((periodEnd, i) => ({
        isin: RELIANCE,
        periodEnd,
        basis: "consolidated",
        source: "xbrl",
        revenue: (100 + i * 10) * CR,
        otherIncome: 0,
        financeCosts: 5 * CR,
        dna: 4 * CR,
        pbeit: 30 * CR,
        pbt: 20 * CR,
        pat: 12 * CR,
        checksJson: "{}",
        updatedAt: Date.now(),
      })),
    );
    await db.insert(guidance).values({
      id: "rel-brief-open",
      isin: RELIANCE,
      docId: "doc-rel",
      quote: "Revenue growth stays in the low teens.",
      metric: "revenue_growth",
      direction: "range",
      low: 10,
      high: 12,
      unit: "%",
      horizon: "FY26",
      status: "open",
      verdict: null,
      evidenceJson: "{}",
      createdAt: Date.now(),
    });
    try {
      llm.mockResolvedValueOnce(
        model({
          calls: [
            {
              tool: "get_results",
              args: { symbol: "RELIANCE", quarters: 4 },
            },
            { tool: "get_promises", args: { symbol: "RELIANCE" } },
          ],
        }),
      );
      llm.mockResolvedValueOnce(
        model({
          say: "Guidance is still open. The decision is yours.",
        }),
      );
      const result = await runFinnieTurn(sentence, null);
      expect(llm).toHaveBeenCalledTimes(2);
      const first = String(llm.mock.calls[0]?.[0].prompt);
      const second = String(llm.mock.calls[1]?.[0].prompt);
      expect(first.startsWith(`Question: ${sentence}`)).toBe(true);
      expect(second.startsWith(`Question: ${sentence}`)).toBe(true);
      expect(second).not.toContain("Catalog:");
      const facts = factsOf(second);
      expect(facts.map((row) => row.tool)).toEqual([
        "get_results",
        "get_promises",
      ]);
      const results = facts[0]?.data as {
        status: string;
        quarters: Array<{
          period: string;
          revenue: { qoqPct: number | null; yoyPct: number | null };
          ebitda: { label: string } | null;
          pbt: { label: string; crore: number | null } | null;
          pat: { label: string } | null;
        }>;
      };
      const promises = facts[1]?.data as {
        status: string;
        rows: Array<{
          quote: string;
          horizon: string | null;
          verdict: string;
          delivered: string | null;
        }>;
      };
      expect(results.status).toBe("results");
      expect(results.quarters.length).toBeGreaterThan(1);
      const latest = results.quarters.at(-1);
      expect(latest?.revenue.qoqPct).toEqual(expect.any(Number));
      expect(latest?.revenue.yoyPct).toEqual(expect.any(Number));
      expect(latest?.ebitda?.label).toBe("EBITDA");
      expect(latest?.pbt?.label).toBe("PBT");
      expect(latest?.pbt?.crore).toEqual(expect.any(Number));
      expect(latest?.pat?.label).toBe("PAT");
      expect(promises.status).toBe("promises");
      expect(promises.rows[0]?.quote).toContain("low teens");
      expect(promises.rows[0]?.horizon).toBe("FY26");
      expect(promises.rows[0]?.verdict).toBe("open");
      expect(promises.rows[0]?.delivered).toBeNull();
      expect(result.tools).toEqual(["get_results", "get_promises"]);
      expect(result.pages).toEqual(["/c/RELIANCE", "/c/RELIANCE"]);
      const turn = readFileSync("src/lib/finnieTurn.ts", "utf8");
      const tools = readFileSync("src/lib/finnieTools.ts", "utf8");
      expect(tools).not.toContain(sentence);
      expect(turn).not.toMatch(
        /(?:sentence|text|question)\.(?:match|includes|search|toLowerCase)/,
      );
      expect(String(llm.mock.calls[1]?.[0].system)).toContain(
        "two short sentences",
      );
      expect(String(llm.mock.calls[1]?.[0].system)).toContain(
        "The decision is yours.",
      );
      expect(String(llm.mock.calls[1]?.[0].system)).not.toContain(
        "name every period",
      );
      const html = renderToStaticMarkup(
        createElement(FinnieAnswer, {
          say: result.say,
          cards: result.cards,
          pages: result.pages,
          links: result.links,
        }),
      );
      expect(html).toContain("Full page");
      expect(html).toContain('href="/c/RELIANCE"');
    } finally {
      await db.delete(guidance).where(eq(guidance.isin, RELIANCE));
      await db
        .delete(resultsQuarters)
        .where(eq(resultsQuarters.isin, RELIANCE));
      await db.delete(companies).where(eq(companies.isin, RELIANCE));
    }
  });

  it("stops when the model names no tool", async () => {
    llm.mockResolvedValueOnce(model({ calls: [] }));
    const result = await runFinnieTurn("zzzz quantum holdings", null);
    expect(result.say).toBe(FINNIE_NO_MATCH);
    expect(result.cards).toEqual([]);
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
      const result = await runFinnieTurn("zylophone the marigold ledger", null);
      expect(result.say).toBe(FINNIE_OUT_OF_CALLS);
      expect(llm).not.toHaveBeenCalled();
    } finally {
      await db.delete(llmLedger).where(eq(llmLedger.model, name));
    }
  });

  it("runs a write the model asked for and keeps the model's sentence", async () => {
    const say = "PIIND is already in the book.";
    llm.mockResolvedValueOnce(
      model({
        calls: [{ tool: "add_to_portfolio", args: { symbol: "PIIND" } }],
      }),
    );
    llm.mockResolvedValueOnce(model({ say }));
    const result = await runFinnieTurn("blorp PIIND onto the shelf", null);
    expect(result.say).toBe(say);
    expect(result.tools).toEqual(["add_to_portfolio"]);
    expect(result.book).toBe("already_in");
    expect(result.symbol).toBe("PIIND");
    const second = String(llm.mock.calls[1]?.[0].prompt);
    expect(factsOf(second)[0]?.tool).toBe("add_to_portfolio");
  });

  it("sends only the last eight turns to both calls", async () => {
    llm.mockResolvedValueOnce(
      model({ calls: [{ tool: "list_portfolio", args: {} }] }),
    );
    llm.mockResolvedValueOnce(model({ say: "Noted." }));
    const memory = Array.from({ length: 10 }, (_, i) => {
      const label = String(i).padStart(2, "0");
      return {
        user: `user-${label} asked about PIIND`,
        say: `finnie-${label} kept a PIIND line`,
        results: [] as string[],
      };
    });
    await runFinnieTurn("and the latest sentence", null, memory);
    const first = String(llm.mock.calls[0]?.[0].prompt);
    const second = String(llm.mock.calls[1]?.[0].prompt);
    for (const prompt of [first, second]) {
      expect(prompt).toContain("finnie-02 kept a PIIND line");
      expect(prompt).toContain("finnie-09 kept a PIIND line");
      expect(prompt).not.toContain("finnie-00");
      expect(prompt).not.toContain("finnie-01");
    }
    expect(first).toContain("Catalog:");
    expect(second).not.toContain("Catalog:");
  });

  it("keeps the context under the token cap and the list caps", () => {
    const fitted = fitChatContext({
      portfolio: Array.from({ length: 40 }, (_, i) => ({
        symbol: `S${i}`,
        name: "N".repeat(400),
        href: `/c/S${i}`,
        movePct: null,
        results: null,
        promises: { kept: 0, missed: 0, open: 0 },
      })),
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

  it("regenerates an invented total once, then drops the sentence that still has it", async () => {
    const invented = "The names are on file. The total is 38.";
    llm.mockResolvedValueOnce(
      model({ calls: [{ tool: "list_portfolio", args: {} }] }),
    );
    llm.mockResolvedValueOnce(model({ say: invented }));
    llm.mockResolvedValueOnce(model({ say: invented }));
    const result = await runFinnieTurn("What is on the book?", null);
    expect(llm).toHaveBeenCalledTimes(3);
    const rewrite = String(llm.mock.calls[2]?.[0].prompt);
    expect(rewrite).toContain("38");
    expect(rewrite).toContain("not in the tool JSON");
    expect(result.say).toContain("The names are on file.");
    expect(result.say).not.toContain("38");
  });

  it("rejects a symbol the sentence did not name and retries once with that company", async () => {
    const voltas = "INE226A01021";
    const airtel = "INE397D01024";
    await db.insert(companies).values([
      {
        isin: voltas,
        nseSymbol: "VOLTAS",
        name: "Voltas Limited",
        aliasesJson: "[]",
        inPortfolio: true,
        isAdhoc: false,
      },
      {
        isin: airtel,
        nseSymbol: "BHARTIARTL",
        name: "Bharti Airtel Limited",
        aliasesJson: "[]",
        inPortfolio: true,
        isAdhoc: false,
      },
    ]);
    try {
      llm.mockResolvedValueOnce(
        model({
          calls: [
            {
              tool: "get_brief",
              args: { symbol: "BHARTIARTL", window: "7d" },
            },
          ],
        }),
      );
      llm.mockResolvedValueOnce(
        model({
          calls: [
            {
              tool: "get_brief",
              args: { symbol: "BHARTIARTL", window: "7d" },
            },
          ],
        }),
      );
      llm.mockResolvedValueOnce(
        model({ say: "The Voltas filing is one routine line." }),
      );
      const result = await runFinnieTurn(
        "If the latest Voltas filing is routine, give me one line and say why it does not need a longer card.",
        "BHARTIARTL",
      );
      expect(llm).toHaveBeenCalledTimes(3);
      expect(String(llm.mock.calls[1]?.[0].prompt)).toContain("VOLTAS");
      const facts = factsOf(String(llm.mock.calls[2]?.[0].prompt));
      expect(JSON.stringify(facts)).toContain("VOLTAS");
      expect(JSON.stringify(facts)).not.toContain("BHARTIARTL");
      expect(result.symbol).toBe("VOLTAS");
      const hrefs = [...result.links.map((link) => link.href), ...result.pages];
      expect(hrefs).toContain("/c/VOLTAS");
    } finally {
      await db.delete(companies).where(eq(companies.isin, voltas));
      await db.delete(companies).where(eq(companies.isin, airtel));
    }
  });

  it("drops an invented book total and keeps the sentence without it", async () => {
    const invented =
      "Over the last 7 days, the book filed 38 total items, with 13 in the brief and 25 filed away. Those that deserve attention are on the brief.";
    llm.mockResolvedValueOnce(
      model({ calls: [{ tool: "get_brief", args: { window: "7d" } }] }),
    );
    llm.mockResolvedValueOnce(model({ say: invented }));
    llm.mockResolvedValueOnce(model({ say: invented }));
    const result = await runFinnieTurn(
      "What did the book file over the last 7 days, and which of those deserve attention?",
      null,
    );
    expect(result.say).not.toContain("38");
    expect(result.say.length).toBeGreaterThan(20);
  });

  it("loads Gujarat Fluorochemicals quarters when the plan says GUJFLUORO", async () => {
    const fluoro = "INE09N301011";
    const sentence =
      "Gujarat Fluorochemicals across four quarters: revenue, EBITDA, profit before tax, profit after tax, both comparisons.";
    const ends = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];
    await db.insert(companies).values({
      isin: fluoro,
      nseSymbol: "FLUOROCHEM",
      name: "Gujarat Fluorochemicals Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    });
    await db.insert(resultsQuarters).values(
      ends.map((periodEnd, i) => ({
        isin: fluoro,
        periodEnd,
        basis: "consolidated",
        source: "xbrl",
        revenue: (100 + i * 10) * CR,
        pat: 10 * CR,
        checksJson: "{}",
        updatedAt: Date.now(),
      })),
    );
    try {
      llm.mockResolvedValueOnce(
        model({
          calls: [
            { tool: "get_results", args: { symbol: "GUJFLUORO", quarters: 4 } },
          ],
        }),
      );
      llm.mockResolvedValueOnce(
        model({
          calls: [
            { tool: "get_results", args: { symbol: "GUJFLUORO", quarters: 4 } },
          ],
        }),
      );
      llm.mockResolvedValueOnce(
        model({ say: "GUJFLUORO is not an NSE-listed equity symbol." }),
      );
      const result = await runFinnieTurn(sentence, "INOXWIND");
      const facts = factsOf(String(llm.mock.calls.at(-1)?.[0].prompt));
      const quarters = (
        facts[0]?.data as { quarters?: Array<{ period: string }> }
      ).quarters;
      expect(quarters?.length).toBeGreaterThanOrEqual(4);
      expect(result.say).toBe("The quarters are in the table.");
      expect(result.say).not.toMatch(/is not an NSE-listed/i);
      expect(result.say).not.toMatch(/qoqPct|yoyPct/);
      const html = renderToStaticMarkup(
        createElement(FinnieAnswer, {
          say: result.say,
          cards: result.cards,
          pages: result.pages,
          links: result.links,
        }),
      );
      for (const quarter of quarters ?? []) {
        expect(html).toContain(quarter.period);
      }
      expect(html).toContain("QoQ");
      expect(html).toContain("YoY");
      expect(html).not.toContain("qoqPct");
      expect(html).not.toContain("yoyPct");
      expect(result.symbol).toBe("FLUOROCHEM");
      const hrefs = [
        result.href,
        ...result.links.map((link) => link.href),
        ...result.pages,
      ];
      expect(hrefs).toContain("/c/FLUOROCHEM");
    } finally {
      await db.delete(resultsQuarters).where(eq(resultsQuarters.isin, fluoro));
      await db.delete(companies).where(eq(companies.isin, fluoro));
    }
  });

  it("judges an Airtel filing that sits outside the last 24 hours", async () => {
    const airtel = "INE397D01024";
    const filed = Date.now() - 5 * 86_400_000;
    await db.insert(companies).values({
      isin: airtel,
      nseSymbol: "BHARTIARTL",
      name: "Bharti Airtel Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    });
    await db.insert(events).values({
      eventKey: "airtel-board",
      isin: airtel,
      category: "results",
      firstAt: filed,
      lastAt: filed,
      tier: 1,
      cardType: "results",
      cardJson: JSON.stringify({
        title: "Outcome of Board Meeting",
        oneLiner: "Outcome of Board Meeting filed.",
        priority: 80,
      }),
      announcementIdsJson: "[]",
      updatedAt: Date.now(),
    });
    try {
      llm.mockResolvedValueOnce(
        model({
          calls: [
            {
              tool: "get_brief",
              args: { symbol: "BHARTIARTL", window: "24h" },
            },
          ],
        }),
      );
      llm.mockResolvedValueOnce(
        model({ say: "There is no filing in the window." }),
      );
      const result = await runFinnieTurn(
        "A board meeting notice just for Airtel. Does that earn a card, or one line? Say which.",
        null,
      );
      const facts = factsOf(String(llm.mock.calls.at(-1)?.[0].prompt));
      const filings = (facts[0]?.data as { filings?: unknown[] }).filings ?? [];
      expect(filings.length).toBeGreaterThan(0);
      expect(result.say).toMatch(/\b(a card|one line)\b/i);
      expect(result.say).not.toMatch(/no filing/i);
      const hrefs = [
        result.href,
        ...result.links.map((link) => link.href),
        ...result.pages,
      ];
      expect(hrefs).toContain("/c/BHARTIARTL");
    } finally {
      await db.delete(events).where(eq(events.isin, airtel));
      await db.delete(companies).where(eq(companies.isin, airtel));
    }
  });

  it("drops a Nuvama card when the sentence names Reliance", async () => {
    const nuvama = "INE531F01023";
    const sentence =
      "for reliance take the last four quarters and, against management's own headline guidance and growth commentary, tell me what was promised vs. what was actually delivered.";
    await db.delete(guidance).where(eq(guidance.isin, RELIANCE));
    await db.delete(guidance).where(eq(guidance.isin, nuvama));
    await db.delete(companies).where(eq(companies.isin, RELIANCE));
    await db.delete(companies).where(eq(companies.isin, nuvama));
    await db.insert(companies).values([
      {
        isin: RELIANCE,
        nseSymbol: "RELIANCE",
        name: "Reliance Industries Limited",
        aliasesJson: "[]",
        inPortfolio: true,
        isAdhoc: false,
      },
      {
        isin: nuvama,
        nseSymbol: "NUVAMA",
        name: "Nuvama Wealth Management Limited",
        aliasesJson: "[]",
        inPortfolio: true,
        isAdhoc: true,
      },
    ]);
    await db.insert(guidance).values([
      {
        id: "rel-turn-open",
        isin: RELIANCE,
        docId: "doc-rel",
        quote: "Revenue growth stays in the low teens.",
        metric: "revenue_growth",
        direction: "range",
        low: 10,
        high: 12,
        unit: "%",
        horizon: "FY26",
        status: "open",
        verdict: null,
        evidenceJson: "{}",
        createdAt: Date.now(),
      },
      {
        id: "nuv-marker",
        isin: nuvama,
        docId: "doc-nuv",
        quote: "NUVAMA_ONLY_MARKER wealth pledge stays open.",
        metric: "pledge",
        status: "open",
        verdict: null,
        evidenceJson: "{}",
        createdAt: Date.now(),
      },
    ]);
    try {
      const plan = {
        calls: [
          { tool: "get_results", args: { symbol: "RELIANCE", quarters: 4 } },
          { tool: "get_promises", args: { symbol: "NUVAMA" } },
        ],
      };
      llm.mockResolvedValueOnce(model(plan));
      llm.mockResolvedValueOnce(model(plan));
      llm.mockResolvedValueOnce(
        model({
          say: "Reliance delivered the four quarters. NUVAMA stays out of this answer.",
        }),
      );
      const result = await runFinnieTurn(sentence, null);
      const prompt = String(llm.mock.calls.at(-1)?.[0].prompt);
      expect(prompt).not.toContain("NUVAMA_ONLY_MARKER");
      expect(prompt).not.toContain("NUVAMA");
      expect(result.say).not.toContain("NUVAMA");
      expect(result.say).toContain("Reliance delivered the four quarters.");
      const html = renderToStaticMarkup(
        createElement(FinnieAnswer, {
          say: result.say,
          cards: result.cards,
          pages: result.pages,
          links: result.links,
          href: result.href,
          link: result.link,
        }),
      );
      expect(html.toUpperCase()).not.toContain("NUVAMA");
      expect(html).toContain("low teens");
      expect(html).toContain('href="/c/RELIANCE"');
    } finally {
      await db.delete(guidance).where(eq(guidance.isin, RELIANCE));
      await db.delete(guidance).where(eq(guidance.isin, nuvama));
      await db.delete(companies).where(eq(companies.isin, RELIANCE));
      await db.delete(companies).where(eq(companies.isin, nuvama));
    }
  });

  it("does not load the book for a sentence", () => {
    const turn = readFileSync("src/lib/finnieTurn.ts", "utf8");
    const context = readFileSync("src/lib/finnieContext.ts", "utf8");
    expect(turn).not.toContain("loadChatPack");
    expect(context).toContain(
      "export async function loadChatPack(focus: string | null)",
    );
    expect(context).not.toMatch(/loadChatPack\([^)]*sentence/);
  });
});
