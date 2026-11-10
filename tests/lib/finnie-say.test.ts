import { describe, expect, it } from "vitest";
import {
  clipQuarterWall,
  repairSay,
  stateFilingSurface,
} from "@/lib/finnieSay";

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
  it("leaves quarter figures out of say", () => {
    const facts = [{ tool: "get_results", data: { quarters } }];
    const say = repairSay("Q2 FY27 revenue held up.", facts);
    expect(say).toBe("Q2 FY27 revenue held up.");
    expect(say).not.toContain("Q3 FY26");
    expect(say).not.toContain("-5.1");
    expect(say).not.toMatch(/qoqPct|yoyPct/);
  });

  it("clips a quarter recital to two sentences and keeps the decision line", () => {
    const wall = [
      "For Q3 FY26, Revenue was 100, EBITDA was 10, PBT was 8, and PAT was 6.",
      "For Q4 FY26, Revenue was 110, EBITDA was 11, PBT was 9, and PAT was 7.",
      "For Q1 FY27, Revenue was 90, EBITDA was 9, PBT was 7, and PAT was 5.",
      "The decision is yours.",
    ].join(" ");
    const say = clipQuarterWall(wall);
    expect(say).toBe(
      "For Q3 FY26, Revenue was 100, EBITDA was 10, PBT was 8, and PAT was 6. The decision is yours.",
    );
    expect(say.split(/(?<=[.!?])\s+/)).toHaveLength(2);
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

  it("drops a false ticker denial without reciting the quarters", () => {
    const say = repairSay("GUJFLUORO is not an NSE-listed equity symbol.", [
      { tool: "get_results", data: { quarters } },
    ]);
    expect(say).toBe("The quarters are in the table.");
    expect(say).not.toMatch(/NSE-listed/i);
    expect(say).not.toContain("-5.1");
  });
});
