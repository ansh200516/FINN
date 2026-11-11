import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatQuarter, ChatQuarterMetric } from "@/lib/finnieTypes";
import {
  comparisonBubble,
  comparisonsFor,
  isHeadlinePromise,
} from "@/lib/promiseCompare";
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

const jio = {
  quote:
    "What is important is. We are able to, in our minds at least, we see visibility of high teen growth for Jio, and those are the points that Akash was talking about.",
  metric: "revenue_growth",
  low: null,
  high: null,
  unit: "%",
  horizon: "medium_term",
  status: "settled",
  verdict: "unverifiable",
  delivered: null,
};

const festive = {
  quote:
    "So, we did see that turn through the quarter and we hope that this will continue. Beyond the festive season as we look to the rest of the year.",
  metric: "revenue_growth",
  low: null,
  high: null,
  unit: "qualitative",
  horizon: "FY27",
  status: "open",
  verdict: null,
  delivered: null,
};

const capacity = {
  quote:
    "When it comes to the solar value chain, as indicated, I think our module capacity is now six plus gigawatt, and we will be achieving up to 20 gigawatt early next year.",
  metric: "capacity",
  low: null,
  high: 20,
  unit: "units",
  horizon: "FY28",
  status: "open",
  verdict: null,
  delivered: null,
};

const ebitdaLater = {
  quote:
    "And on new energy, I just wanted to say that it is accelerating and we see the benefit, earnings contribution definitely starting in FY 2028.",
  metric: "ebitda",
  low: null,
  high: null,
  unit: "qualitative",
  horizon: "FY28",
  status: "open",
  verdict: null,
  delivered: null,
};

const bullish = {
  quote:
    "And so, we are very bullish about the rest of the financial year as well. So, with that, I will pass on to the O2C team.",
  metric: "other",
  low: null,
  high: null,
  unit: "qualitative",
  horizon: "FY27",
  status: "open",
  verdict: null,
  delivered: null,
};

const solarCell = {
  quote:
    "Similarly, solar cell is now nearing around 5-gigawatt and we will be achieving again 20-gigawatt capacity sometime first half next year.",
  metric: "capacity",
  low: 20,
  high: 20,
  unit: "units",
  horizon: "H2FY27",
  status: "open",
  verdict: null,
  delivered: null,
};

const bess = {
  quote:
    "On the battery side, in next half year we will commission our BESS facility, which is a pack and container up to 40-gigawatt hour and cell will come sometime I would say late next year, which is again around 35-gigawatt to 40-gigawatt hour.",
  metric: "capacity",
  low: null,
  high: 40,
  unit: "units",
  horizon: "H2FY27",
  status: "open",
  verdict: null,
  delivered: null,
};

const revenueLater = {
  quote:
    "I think we have already given the indication that we will see the revenues for FY2028 from the new energy complex.",
  metric: "revenue",
  low: null,
  high: null,
  unit: "qualitative",
  horizon: "FY28",
  status: "open",
  verdict: null,
  delivered: null,
};

const gas = {
  quote:
    "As such, like I mentioned, currently the ceiling price is $8.9, which is almost $1.14 lower than what it was the previous half. But again, we expect this to trend upwards and go towards $9.9 in the second half. That is the outlook.",
  metric: "other",
  low: 9900000000,
  high: 9900000000,
  unit: "USD",
  horizon: "H2FY27",
  status: "open",
  verdict: null,
  delivered: null,
};

const relianceLedger = [
  ebitdaLater,
  jio,
  festive,
  bullish,
  capacity,
  solarCell,
  bess,
  revenueLater,
  gas,
];

function answer(rows: unknown[]): string {
  return renderToStaticMarkup(
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
          reply: { kind: "promises", rows: rows as never },
        },
      ],
    }),
  );
}

describe("promised versus delivered", () => {
  it("keeps Reliance's Jio growth line and drops capacity and festive remarks", () => {
    expect(isHeadlinePromise(jio)).toBe(true);
    expect(isHeadlinePromise(festive)).toBe(false);
    expect(isHeadlinePromise(capacity)).toBe(false);
    expect(isHeadlinePromise(bullish)).toBe(false);
    expect(isHeadlinePromise(solarCell)).toBe(false);
    expect(isHeadlinePromise(bess)).toBe(false);
    expect(isHeadlinePromise(gas)).toBe(false);
    expect(isHeadlinePromise(ebitdaLater)).toBe(true);
    expect(isHeadlinePromise(revenueLater)).toBe(true);
    const rows = comparisonsFor(quarters, relianceLedger);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.quote).toContain("high teen growth for Jio");
    expect(rows[0]?.quote).not.toMatch(/headline/i);
    expect(rows[0]?.promised).toBe("high teen");
    expect(rows[0]?.period).toContain("medium term");
    expect(rows[0]?.period).toContain("Q2 FY27");
    expect(rows[0]?.delivered).toBe("+28.6% YoY");
    expect(rows[0]?.verdict).toBe("unverifiable");

    const html = answer(relianceLedger);
    const list = html.slice(html.indexOf('data-promised=""'));
    expect(list).toContain("high teen growth for Jio");
    expect(list).toContain("high teen");
    expect(list).toContain("+28.6% YoY");
    expect(list).not.toContain("+25.4%");
    expect(list).toContain("Unverifiable");
    expect(list).not.toContain("Kept");
    expect(list).not.toContain("festive season");
    expect(list).not.toContain("gigawatt");
    expect(list).not.toContain("bullish");
    expect(list).not.toContain("$9.9");
    expect(list).not.toContain("FY2028");
    expect(html).not.toContain(
      "Revenue growth stays between 20 and 30 percent",
    );
    expect(html).not.toContain("No headline promise");
    expect(html).not.toContain("delivered is null");
    expect(html).not.toContain("Revenue was 269496");
    expect(html).toContain(
      "One growth comment is in this window, and it has no numeric range.",
    );
    expect(html).toContain("The decision is yours.");
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).toContain("2,69,496");
    expect(html).toContain("3,52,861");
    expect(html).toContain("YoY");
    expect(html).not.toContain("QoQ");
  });

  it("names capacity and festive remarks when nothing in the window qualifies", () => {
    const html = answer([festive, capacity]);
    expect(html).toContain(
      "The stored comments are capacity and festive-season remarks, not a revenue range.",
    );
    expect(html).toContain("The decision is yours.");
    expect(html).not.toContain("No headline promise");
    expect(html).not.toContain("festive season");
    expect(html).not.toContain("gigawatt");
    expect(html).toContain("2,69,496");
    expect(html).toContain("3,52,861");
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-promised=""');
  });

  it("does not say there is no promise when a growth comment is outside the window", () => {
    const html = answer([ebitdaLater]);
    expect(html).not.toContain("No headline promise");
    expect(html).toContain(
      "A growth comment is in the rows, and it has no numeric range for these quarters.",
    );
    expect(html).toContain("The decision is yours.");
    expect(html).not.toContain("earnings contribution");
    expect(html).toContain("3,52,861");
  });

  it("treats an FY27 range as inside the window when Q2 FY27 is on the table", () => {
    const rows = comparisonsFor(quarters, [
      {
        quote: "Revenue growth of 20 to 30 percent.",
        metric: "revenue_growth",
        low: 20,
        high: 30,
        unit: "%",
        horizon: "FY27",
        status: "open",
        delivered: null,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.period).toContain("FY27");
    expect(rows[0]?.period).toContain("Q2 FY27");
    expect(rows[0]?.promised).toBe("20–30%");
    expect(rows[0]?.delivered).toBe("+28.6% YoY");
    expect(rows[0]?.verdict).toBe("kept");
    expect(comparisonBubble(rows)).toBe(
      "One headline promise was kept. The decision is yours.",
    );
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
