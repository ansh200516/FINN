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

const mockSay =
  "Management said they see visibility of high teen growth for Jio. The consolidated figure is not that business. The decision is yours.";

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

function answer(rows: unknown[], say = mockSay): string {
  return renderToStaticMarkup(
    createElement(FinnieAnswer, {
      say,
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
    expect(rows[0]?.quote).toBe(
      "We are able to, in our minds at least, we see visibility of high teen growth for Jio, and those are the points that Akash was talking about.",
    );
    expect(rows[0]?.quote).toContain("visibility of high teen growth for Jio");
    expect(rows[0]?.quote).not.toMatch(/and those…|and those\.\.\./);
    expect(rows[0]?.quote.startsWith("What is important")).toBe(false);
    expect(rows[0]?.quote).not.toMatch(/headline/i);
    expect(rows[0]?.promised).toBe("high teen");
    expect(rows[0]?.period).toContain("medium term");
    expect(rows[0]?.period).toContain("Q2 FY27");
    expect(rows[0]?.delivered).toBe("+28.6% YoY consolidated revenue, not Jio");
    expect(rows[0]?.verdict).toBe("unverifiable");
    expect(comparisonBubble(rows)).toBe(
      "None kept, none missed, one unverifiable.",
    );

    const html = answer(relianceLedger);
    const bubble = html.indexOf('class="bubble-agent"');
    const table = html.indexOf("<table");
    const listAt = html.indexOf('data-promised=""');
    expect(bubble).toBeGreaterThan(-1);
    expect(bubble).toBeLessThan(table);
    expect(table).toBeLessThan(listAt);
    expect(html).toContain(
      "Management said they see visibility of high teen growth for Jio. The consolidated figure is not that business.",
    );
    expect(html.indexOf("Management said")).toBeLessThan(table);
    expect(html).not.toContain("None kept, none missed, one unverifiable.");
    expect(html).not.toContain(mockSay);
    expect(html).not.toContain("The decision is yours");
    expect(html).not.toContain("cannot be scored");
    expect(html).not.toContain("cannot be directly scored");
    const list = html.slice(listAt);
    expect(list).toContain("visibility of high teen growth for Jio");
    expect(list).toContain(
      "and those are the points that Akash was talking about.",
    );
    expect(list).not.toContain("and those…");
    expect(list).toContain("Promised:");
    expect(list).toContain("high teen");
    expect(list).toContain("Delivered:");
    expect(list.replace(/<[^>]+>/g, "")).toContain(
      "Delivered: +28.6% YoY consolidated revenue, not Jio",
    );
    expect(list).toContain("not Jio");
    const quoteAt = list.indexOf("visibility of high teen growth for Jio");
    const promisedAt = list.indexOf("Promised:");
    const deliveredAt = list.indexOf("Delivered:");
    const chipAt = list.indexOf("Unverifiable");
    expect(quoteAt).toBeLessThan(promisedAt);
    expect(promisedAt).toBeLessThan(deliveredAt);
    expect(deliveredAt).toBeLessThan(chipAt);
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
    expect(html).not.toContain(
      "One growth comment is in this window, and it has no numeric range.",
    );
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).toContain("2,69,496");
    expect(html).toContain("3,52,861");
    expect(html).toContain("YoY");
    expect(html).not.toContain("QoQ");
    expect(html).not.toMatch(/tool JSON|\bpayload\b|\bschema\b/i);
  });

  it("does not render a sentence that names the tool JSON", () => {
    const html = answer(
      relianceLedger,
      "Out of the guidance quotes in the tool JSON, zero were kept, zero were missed, and nine are unverifiable.",
    );
    expect(html).not.toContain("tool JSON");
    expect(html).not.toContain("zero were kept");
    expect(html).not.toContain("None kept, none missed, one unverifiable.");
    expect(html).toContain("Unverifiable");
  });

  it("shows the high-teen sentence when the quote was cut off", () => {
    const rows = comparisonsFor(quarters, [
      {
        ...jio,
        quote:
          "What is important is. We are able to, in our minds at least, we see visibility of high teen growth for Jio, and those…",
      },
    ]);
    expect(rows[0]?.quote).toContain("visibility of high teen growth for Jio");
    expect(rows[0]?.quote.startsWith("What is important")).toBe(false);
    expect(rows[0]?.quote).not.toMatch(/and those/);
    expect(rows[0]?.quote.endsWith(".")).toBe(true);
  });

  it("keeps the model's sentence when only asides are stored", () => {
    const say =
      "The rows here are capacity and a festive remark, not a revenue range. The decision is yours.";
    const html = answer([festive, capacity], say);
    expect(html).toContain(
      "The rows here are capacity and a festive remark, not a revenue range.",
    );
    expect(html).not.toContain("The decision is yours");
    expect(html).not.toContain("No headline promise");
    expect(html).not.toContain(
      "The stored comments are capacity and festive-season remarks",
    );
    expect(html).not.toContain("festive season");
    expect(html).not.toContain("gigawatt");
    expect(html).toContain("2,69,496");
    expect(html).toContain("3,52,861");
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).not.toContain('data-promised=""');
  });

  it("does not say there is no promise when a growth comment is outside the window", () => {
    const say =
      "A growth comment is stored for a later year. The decision is yours.";
    const html = answer([ebitdaLater], say);
    expect(html).toContain("A growth comment is stored for a later year.");
    expect(html).not.toContain("The decision is yours");
    expect(html).not.toContain("No headline promise");
    expect(html).not.toContain(
      "A growth comment is in the rows, and it has no numeric range for these quarters.",
    );
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
      "One kept, none missed, none unverifiable.",
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

  it("scores a full-year rupee band against the year, not the latest quarter", () => {
    const fy26: ChatQuarter[] = [
      {
        period: "Q1 FY26",
        revenue: line("Revenue", 2700, 0, 0),
        ebitda: null,
        pbt: null,
        pat: null,
      },
      {
        period: "Q2 FY26",
        revenue: line("Revenue", 2490, 0, 0),
        ebitda: null,
        pbt: null,
        pat: null,
      },
      {
        period: "Q3 FY26",
        revenue: line("Revenue", 2499.68, 0, 0),
        ebitda: null,
        pbt: null,
        pat: null,
      },
      {
        period: "Q4 FY26",
        revenue: line("Revenue", 3528, 0, 0),
        ebitda: null,
        pbt: null,
        pat: null,
      },
    ];
    const source = {
      quote:
        "We expect revenue for FY26 to be in the range of Rs 11,000 crore to Rs 11,500 crore.",
      metric: "revenue",
      horizon: "FY26",
      low: 1100_000_000_00,
      high: 1150_000_000_00,
      unit: "INR",
      status: "settled",
      verdict: "kept",
      delivered: { value: 1121_768_000_00, unit: "INR" },
    };
    const rows = comparisonsFor(fy26, [source]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("kept");
    expect(rows[0]?.promised).toBe("₹ 11,000–11,500 cr");
    expect(rows[0]?.promised).not.toContain("1,10,00,00,00,000");
    expect(rows[0]?.delivered).toContain("11,218");
    expect(rows[0]?.delivered).not.toContain("3,528");
    expect(rows[0]?.period).toBe("FY26");
    expect(rows[0]?.period).not.toContain("Q4");

    const judged = comparisonsFor(fy26, [
      { ...source, verdict: null, delivered: null },
    ]);
    expect(judged[0]?.verdict).toBe("kept");
    expect(judged[0]?.delivered).toContain("11,218");
    expect(judged[0]?.delivered).not.toContain("3,528");

    const onlyQuarter = comparisonsFor(
      [
        {
          period: "Q4 FY26",
          revenue: line("Revenue", 3528, 0, 0),
          ebitda: null,
          pbt: null,
          pat: null,
        },
      ],
      [source],
    );
    expect(onlyQuarter[0]?.verdict).toBe("kept");
    expect(onlyQuarter[0]?.delivered).toContain("11,218");
    expect(onlyQuarter[0]?.delivered).not.toContain("3,528");

    const above = comparisonsFor(fy26, [
      {
        ...source,
        verdict: null,
        delivered: { value: 13000, unit: "INR_cr" },
        low: 11000,
        high: 11500,
        unit: "INR_cr",
      },
    ]);
    expect(above[0]?.verdict).toBe("beat");
    expect(above[0]?.verdict).not.toBe("kept");
  });

  it("quotes the sentence that holds the rupee band", () => {
    const rows = comparisonsFor(
      [
        {
          period: "Q4 FY26",
          revenue: line("Revenue", 3528, 0, 16.5),
          ebitda: null,
          pbt: null,
          pat: null,
        },
      ],
      [
        {
          quote:
            "Even the topline, you see, polymer prices, they are coming down. So, instead of 12,000 crores, now we are maintaining 11,000 crores to 11,500 crores.",
          metric: "revenue",
          horizon: "FY26",
          low: 110000000000,
          high: 115000000000,
          unit: "INR",
          status: "settled",
          verdict: "kept",
          delivered: { value: 112176800000, unit: "INR" },
        },
      ],
    );
    expect(rows[0]?.quote).toContain("11,000 crores to 11,500");
    expect(rows[0]?.quote).not.toContain("polymer prices");
  });

  it("does not score piping growth or an export dollar aim as consolidated revenue", () => {
    const piping = comparisonsFor(quarters, [
      {
        quote:
          "And of course, we already stated to you that we anticipate to grow 15% to 17% piping business.",
        metric: "revenue_growth",
        horizon: "FY27",
        low: 15,
        high: 17,
        unit: "%",
        status: "open",
        verdict: null,
        delivered: null,
      },
    ]);
    expect(piping[0]?.verdict).toBe("unverifiable");
    expect(piping[0]?.delivered).toMatch(/not piping/i);
    const exp = comparisonsFor(quarters, [
      {
        quote:
          "Last year our export was USD26 million overall. We are aiming to reach USD150 millions in six to seven year from USD26 million.",
        metric: "revenue",
        horizon: "medium_term",
        low: 150000000,
        high: 150000000,
        unit: "USD",
        status: "open",
        verdict: null,
        delivered: null,
      },
    ]);
    expect(exp[0]?.promised).toBe("USD 150 million");
    expect(exp[0]?.verdict).toBe("unverifiable");
  });

  it("does not score a dollar band, a domestic CAGR, ASP, or a multi-year build as consolidated revenue", () => {
    const dollar = comparisonsFor(quarters, [
      {
        quote:
          "Five-six years is the estimate about somewhere about $ 80 million to $ 100 million of revenue in this space.",
        metric: "revenue",
        horizon: "medium_term",
        low: 80000000,
        high: 100000000,
        unit: "USD",
        status: "open",
        verdict: null,
        delivered: null,
      },
    ]);
    expect(dollar[0]?.promised).toBe("USD 80–100 million");
    expect(dollar[0]?.verdict).toBe("unverifiable");
    expect(dollar[0]?.delivered).not.toMatch(/₹/);
    const domestic = comparisonsFor(quarters, [
      {
        quote:
          "If you look at the past, we have given a 25-plus percent CAGR on the domestic business.",
        metric: "revenue_growth",
        horizon: "medium_term",
        low: 25,
        high: 25,
        unit: "%",
        status: "open",
        verdict: null,
        delivered: null,
      },
    ]);
    expect(domestic[0]?.verdict).toBe("unverifiable");
    expect(domestic[0]?.delivered).toMatch(/not domestic/i);
    const asp = comparisonsFor(quarters, [
      {
        quote: "In terms of ASP, we are in the 5% to 6% range.",
        metric: "revenue_growth",
        horizon: "FY27",
        low: 5,
        high: 6,
        unit: "%",
        status: "open",
        verdict: null,
        delivered: null,
      },
    ]);
    expect(asp[0]?.verdict).toBe("unverifiable");
    expect(asp[0]?.verdict).not.toBe("beat");
    const build = comparisonsFor(quarters, [
      {
        quote:
          "In the next two-three years we would be able to look at INR 500 to INR 600 crore top line.",
        metric: "revenue",
        horizon: "medium_term",
        low: 5000000000,
        high: 6000000000,
        unit: "INR",
        status: "open",
        verdict: null,
        delivered: null,
      },
    ]);
    expect(build[0]?.verdict).toBe("unverifiable");
    expect(build[0]?.verdict).not.toBe("beat");
  });

  it("scores a full-year margin from the ledger, not one quarter", () => {
    const rows = comparisonsFor(
      [
        {
          period: "Q4 FY26",
          revenue: line("Revenue", 3528, 0, 16.5),
          ebitda: line("EBITDA", 623, 0, 49.7),
          pbt: null,
          pat: null,
        },
      ],
      [
        {
          quote:
            "For the current year now, we have revised our guidelines. And we now believe that our margin will be between 13.5% to 14%.",
          metric: "operating_margin",
          horizon: "FY26",
          low: 13.5,
          high: 14,
          unit: "%",
          status: "settled",
          verdict: "kept",
          delivered: { value: 13.846, unit: "%" },
        },
      ],
    );
    expect(rows[0]?.period).toBe("FY26");
    expect(rows[0]?.period).not.toContain("Q4");
    expect(rows[0]?.delivered).not.toContain("17");
    expect(rows[0]?.verdict).toBe("kept");
    expect(rows[0]?.quote).toContain("13.5%");
  });
});
