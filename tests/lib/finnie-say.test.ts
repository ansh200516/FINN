import { describe, expect, it } from "vitest";
import { coverQuarters, repairSay, stateFilingSurface } from "@/lib/finnieSay";

const quarters = [
  {
    period: "Q3 FY26",
    revenue: { label: "Revenue", crore: 100, qoqPct: -5.1, yoyPct: 10 },
  },
  {
    period: "Q4 FY26",
    revenue: { label: "Revenue", crore: 110, qoqPct: 10, yoyPct: null },
  },
  {
    period: "Q1 FY27",
    revenue: { label: "Revenue", crore: 90, qoqPct: -18.2, yoyPct: 6 },
  },
  {
    period: "Q2 FY27",
    revenue: { label: "Revenue", crore: 120, qoqPct: 33.3, yoyPct: 20 },
  },
];

describe("finnie say repair", () => {
  it("adds payload periods the model left out", () => {
    const facts = [{ tool: "get_results", data: { quarters } }];
    const say = coverQuarters("Q2 FY27 revenue 120.", facts);
    expect(say).toContain("Q3 FY26");
    expect(say).toContain("Q4 FY26");
    expect(say).toContain("Q1 FY27");
    expect(say).toContain("Q2 FY27");
    expect(say).toContain("-5.1");
  });

  it("replaces a short no-filing line when the payload has a surface", () => {
    const facts = [
      {
        tool: "get_brief",
        data: {
          symbol: "BHARTIARTL",
          filings: [
            {
              symbol: "BHARTIARTL",
              surface: "line",
              sentence: "Outcome of Board Meeting filed.",
            },
          ],
        },
      },
    ];
    const say = stateFilingSurface("There is no filing in the window.", facts);
    expect(say).toBe(
      "BHARTIARTL Outcome of Board Meeting filed earns one line.",
    );
    expect(say).not.toMatch(/no filing/i);
  });

  it("names the company when the window really has no filing", () => {
    const facts = [
      { tool: "get_brief", data: { symbol: "BHARTIARTL", filings: [] } },
    ];
    const say = stateFilingSurface("There is no filing in the window.", facts);
    expect(say).toContain("BHARTIARTL");
    expect(say).toContain("no filing");
    expect(say.length).toBeGreaterThan(40);
  });

  it("drops a false ticker denial and recites the quarters", () => {
    const say = repairSay("GUJFLUORO is not an NSE-listed equity symbol.", [
      { tool: "get_results", data: { quarters } },
    ]);
    expect(say).not.toMatch(/NSE-listed/i);
    expect(say).toContain("Q3 FY26");
    expect(say).toContain("Q2 FY27");
  });
});
