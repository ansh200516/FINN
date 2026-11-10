import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatQuarter, ChatQuarterMetric } from "@/lib/finnieTypes";
import { comparisonsFor } from "@/lib/promiseCompare";
import { FinnieAnswer } from "@/ui/Desk";

function line(
  label: string,
  crore: number,
  qoqPct: number,
  yoyPct: number,
): ChatQuarterMetric {
  return { label, crore, qoqPct, yoyPct };
}

const quarters: ChatQuarter[] = [
  {
    period: "Q3 FY26",
    revenue: line("Revenue", 269496, 4.1, 10.5),
    ebitda: line("EBITDA", 46018, 0.3, 5.1),
    pbt: line("PBT", 29697, 2, 3.7),
    pat: line("PAT", 22290, 0.9, 1.6),
  },
  {
    period: "Q4 FY26",
    revenue: line("Revenue", 298621, 10.8, 12.9),
    ebitda: line("EBITDA", 44141, -4.1, 0.7),
    pbt: line("PBT", 27195, -8.4, 6.6),
    pat: line("PAT", 20589, -7.6, 8.9),
  },
  {
    period: "Q1 FY27",
    revenue: line("Revenue", 311850, 4.4, 25.4),
    ebitda: line("EBITDA", 47517, 7.7, 10.6),
    pbt: line("PBT", 30630, 12.6, 17.5),
    pat: line("PAT", 23196, 12.7, 14.2),
  },
  {
    period: "Q2 FY27",
    revenue: line("Revenue", 352861, 6.7, 28.6),
    ebitda: line("EBITDA", 56616, 19.2, 23.4),
    pbt: line("PBT", 38613, 26.1, 32.6),
    pat: line("PAT", 29550, 27.4, 33.8),
  },
];

const wall = [
  "For Q3 FY26, Revenue was 269496, EBITDA was 46018, PBT was 29697, and PAT was 22290.",
  "For Q4 FY26, Revenue was 298621, EBITDA was 44141, PBT was 27195, and PAT was 20589.",
  "Reliance has open rows where delivered is null, so those promises are still open.",
].join(" ");

describe("promised versus delivered", () => {
  it("renders the growth row with the quarter YoY and drops the festive season", () => {
    const html = renderToStaticMarkup(
      createElement(FinnieAnswer, {
        say: wall,
        cards: [
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: { kind: "results", card: null },
            quarters,
          },
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: {
              kind: "promises",
              rows: [
                {
                  id: "growth",
                  quote: "Revenue growth stays between 20 and 30 percent.",
                  metric: "revenue_growth",
                  direction: "range",
                  low: 20,
                  high: 30,
                  unit: "%",
                  horizon: "FY27",
                  status: "open",
                  verdict: null,
                  delivered: null,
                },
                {
                  id: "festive",
                  quote:
                    "A strong festive season can lift growth into the mid teens.",
                  metric: "revenue_growth",
                  direction: "range",
                  low: 14,
                  high: 16,
                  unit: "%",
                  horizon: "Q3 FY27",
                  status: "open",
                  verdict: null,
                  delivered: null,
                },
              ] as never,
            },
          },
        ],
      }),
    );
    const list = html.slice(html.indexOf('data-promised=""'));
    expect(list).toContain("Revenue growth stays between 20 and 30 percent.");
    expect(list).toContain("FY27");
    expect(list).toContain("Q2 FY27");
    expect(list).toContain("+28.6% YoY");
    expect(list).not.toContain("+25.4%");
    expect(list).toContain("Kept");
    expect(list).not.toContain("festive season");
    expect(html).not.toContain("delivered is null");
    expect(html).not.toContain("Revenue was 269496");
    expect(html).toContain("One headline promise was kept.");
    expect(html).toContain("The decision is yours.");
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).toContain("2,69,496");
    expect(html).toContain("3,52,861");
    expect(html).toContain("YoY");
    expect(html).not.toContain("QoQ");
  });

  it("leaves a horizon open only when no printed quarter covers it", () => {
    const rows = comparisonsFor(
      [
        quarters[3] ?? {
          period: "Q2 FY27",
          revenue: null,
          ebitda: null,
          pbt: null,
          pat: null,
        },
      ],
      [
        {
          quote: "Revenue growth of 20 to 30 percent.",
          metric: "revenue_growth",
          low: 20,
          high: 30,
          unit: "%",
          horizon: "FY28",
          status: "open",
          delivered: null,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("open");
    expect(rows[0]?.delivered).toBeNull();
    expect(rows[0]?.period).toBe("FY28");
  });

  it("marks a shortfall missed from the matching quarter", () => {
    const rows = comparisonsFor(
      [
        {
          period: "Q2 FY27",
          revenue: line("Revenue", 100, 1, 8),
          ebitda: null,
          pbt: null,
          pat: null,
        },
      ],
      [
        {
          quote: "Revenue growth of 20 to 30 percent.",
          metric: "revenue_growth",
          low: 20,
          high: 30,
          unit: "%",
          horizon: "Q2 FY27",
          status: "open",
          delivered: null,
        },
      ],
    );
    expect(rows[0]?.verdict).toBe("missed");
    expect(rows[0]?.delivered).toContain("8.0");
    expect(rows[0]?.delivered).toContain("YoY");
  });
});
