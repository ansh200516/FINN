import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@/engine/llm/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/llm/gateway")>();
  return {
    ...actual,
    callStructured: vi.fn(),
    remainingBudget: vi.fn(async () => []),
  };
});

vi.mock("@/lib/finnieTools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/finnieTools")>();
  return { ...actual, executeTool: vi.fn() };
});

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return {
    ...actual,
    listCompanyNames: vi.fn(async () => [
      {
        isin: "INE040A01034",
        symbol: "HDFCBANK",
        name: "HDFC Bank Limited",
        aliases: ["HDFC Bank"],
      },
    ]),
  };
});

import { callStructured } from "@/engine/llm/gateway";
import { executeTool } from "@/lib/finnieTools";
import { mapBounded, runFinnieTurn, TOOL_CONCURRENCY } from "@/lib/finnieTurn";

const llm = callStructured as unknown as Mock<typeof callStructured>;
const tools = executeTool as unknown as Mock<typeof executeTool>;

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

beforeEach(() => {
  llm.mockReset();
  tools.mockReset();
});

describe("parallel requirements", () => {
  it("starts two independent tool requirements together", async () => {
    const steps: string[] = [];
    const thoughts: string[] = [];
    const spans = new Map<string, { start: number; end: number }>();
    let active = 0;
    let maxActive = 0;
    llm.mockImplementation(async (opts) => {
      const prompt = String(opts.prompt);
      if (prompt.includes("Catalog:")) {
        opts.onThought?.({
          text: "**Splitting the question**\nQuarters and guidance are separate.",
          fresh: true,
        });
        return model({
          calls: [
            {
              tool: "get_results",
              args: { symbol: "HDFCBANK", quarters: 4 },
            },
            { tool: "get_promises", args: { symbol: "HDFCBANK" } },
          ],
        });
      }
      opts.onThought?.({
        text: "**Writing from the rows**\nNo new figures.",
        fresh: true,
      });
      return model({ say: "The growth range is still open." });
    });
    tools.mockImplementation(async (tool: string) => {
      const start = Date.now();
      active += 1;
      maxActive = Math.max(maxActive, active);
      const hold = tool === "get_promises" ? 30 : 80;
      await new Promise((resolve) => setTimeout(resolve, hold));
      active -= 1;
      spans.set(tool, { start, end: Date.now() });
      if (tool === "get_results") {
        return {
          fact: {
            status: "results",
            symbol: "HDFCBANK",
            quarters: [
              {
                period: "Q2 FY26",
                revenue: { label: "NII", crore: 32000 },
              },
            ],
          },
          card: null,
          symbol: "HDFCBANK",
          href: null,
          link: null,
          book: null,
        };
      }
      return {
        fact: {
          status: "promises",
          symbol: "HDFCBANK",
          rows: [{ quote: "NII growth stays in the mid teens." }],
        },
        card: null,
        symbol: "HDFCBANK",
        href: null,
        link: null,
        book: null,
      };
    });

    const result = await runFinnieTurn(
      "HDFCBANK last four quarters against the guidance",
      null,
      null,
      {
        step(title) {
          steps.push(title);
        },
        thought(thought) {
          thoughts.push(thought.text);
        },
      },
    );

    const results = spans.get("get_results");
    const promises = spans.get("get_promises");
    expect(results).toBeTruthy();
    expect(promises).toBeTruthy();
    expect(results?.start).toBeLessThan(promises?.end ?? 0);
    expect(promises?.start).toBeLessThan(results?.end ?? 0);
    expect(maxActive).toBe(2);

    const startResults = steps.indexOf("Reading the last four quarters");
    const startPromises = steps.indexOf("Reading HDFC Bank guidance");
    const doneResults = steps.indexOf("Read the last four quarters");
    const donePromises = steps.indexOf("Read HDFC Bank guidance");
    expect(startResults).toBeGreaterThanOrEqual(0);
    expect(startPromises).toBeGreaterThanOrEqual(0);
    expect(startResults).toBeLessThan(donePromises);
    expect(startPromises).toBeLessThan(doneResults);

    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[0]?.[0]).toMatchObject({
      task: "finnie",
      cache: false,
    });
    expect(llm.mock.calls[1]?.[0]).toMatchObject({
      task: "finnie",
      cache: false,
    });
    expect(String(llm.mock.calls[0]?.[0].system)).toContain(
      "Do not split those",
    );
    const prompt = String(llm.mock.calls[1]?.[0].prompt);
    expect(prompt).toContain("32000");
    expect(prompt).toContain("NII growth stays in the mid teens.");
    expect(result.tools).toEqual(["get_results", "get_promises"]);
    expect(result.say).toBe("The growth range is still open.");
    expect(thoughts).toEqual([
      "**Splitting the question**\nQuarters and guidance are separate.",
      "**Writing from the rows**\nNo new figures.",
    ]);
  });

  it("leaves a price as the one call the planner named", async () => {
    llm.mockResolvedValueOnce(
      model({
        calls: [{ tool: "get_quote", args: { symbol: "HDFCBANK" } }],
      }),
    );
    llm.mockResolvedValueOnce(model({ say: "The price is on the card." }));
    tools.mockResolvedValue({
      fact: { status: "quote", symbol: "HDFCBANK" },
      card: null,
      symbol: "HDFCBANK",
      href: null,
      link: null,
      book: null,
    });
    const result = await runFinnieTurn("HDFCBANK price", null);
    expect(tools).toHaveBeenCalledTimes(1);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(result.tools).toEqual(["get_quote"]);
    expect(result.say).toBe("The price is on the card.");
  });

  it("keeps at most four requirements in flight", async () => {
    expect(TOOL_CONCURRENCY).toBe(4);
    let active = 0;
    let maxActive = 0;
    await mapBounded([0, 1, 2, 3, 4], TOOL_CONCURRENCY, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
    });
    expect(maxActive).toBe(4);
  });
});
