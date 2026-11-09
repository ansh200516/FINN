import { describe, expect, it } from "vitest";
import {
  composePull,
  gateQuote,
  NOT_IN_FILINGS,
  PULL_TITLES,
  type PullInput,
} from "@/lib/pull";

function input(partial: Partial<PullInput> = {}): PullInput {
  return {
    isBank: false,
    hasTranscript: false,
    period: "FY26",
    reportUrl: "https://example.test/ar.pdf",
    pages: [],
    quarters: [],
    guidance: [],
    ...partial,
  };
}

const ITC_PNL = `Consolidated Statement of Profit and Loss
(\` in Crores)
I Revenue From Operations 23A,23B 89913.33 81612.78
X Profit for the year from continuing operations (VIII-IX) 21018.15 20036.47
XV Profit for the year (X+XIV) 21018.15 35052.48
`;

const ITC_RATIOS = `KEY FINANCIAL RATIOS
(i) Operating Profit Margin (%) 33.4 35.4
(ii) Net Profit Margin (%)1 25.3 26.7
(v) Current Ratio 3.0 3.0
2. Interest Coverage Ratio and Debt-Equity ratio are not relevant for the Company as it has negligible debt.
`;

const ITC_FMCG = `Report of the Board of Directors
Your Company’s FMCG Businesses recorded Segment Revenue of \` 24209.75 crores during the year, representing growth of 10.1% over the previous year.
`;

describe("composePull", () => {
  it("always returns the eight brief names", () => {
    const blocks = composePull(input());
    expect(blocks.map((b) => b.title)).toEqual([...PULL_TITLES]);
    for (const b of blocks) {
      expect(b.lines).toEqual([NOT_IN_FILINGS]);
      expect(b.verdict).toBe(NOT_IN_FILINGS);
    }
  });

  it("reads ITC from the annual report when no quarter is filed", () => {
    const blocks = composePull(
      input({
        pages: [
          { page: 76, text: ITC_FMCG },
          { page: 255, text: ITC_PNL },
          { page: 155, text: ITC_RATIOS },
        ],
      }),
    );
    const by = Object.fromEntries(blocks.map((b) => [b.title, b]));
    expect(by["Business snapshot"]?.lines.join(" ")).toContain("24209.75");
    expect(by["Business snapshot"]?.lines.join(" ")).toContain("10.1%");
    expect(by["Financial snapshot"]?.lines.join(" ")).toContain("89913.33");
    expect(by["Financial snapshot"]?.lines.join(" ")).toContain("35052.48");
    expect(by["Financial snapshot"]?.lines.join(" ")).toContain("20036.47");
    expect(by["Narrative vs. numbers"]?.lines.join(" ")).toMatch(
      /opposite directions/i,
    );
    expect(by["Balance sheet"]?.verdict).toMatch(/negligible/i);
    expect(by.Guidance?.lines).toEqual([NOT_IN_FILINGS]);
    expect(by["Bull vs. bear"]?.lines.join(" ")).toContain("33.4%");
  });

  it("does not show a quote that fails verifyQuote", () => {
    const page =
      "The company mills plastic goods for the Indian market and for export.";
    expect(gateQuote("mills plastic goods", page)).not.toBeNull();
    expect(gateQuote("mills steel goods", page)).toBeNull();
    const blocks = composePull(
      input({
        hasTranscript: true,
        pages: [{ page: 4, text: page }],
      }),
    );
    const text = blocks.map((b) => b.lines.join(" ")).join(" ");
    expect(text).not.toContain("steel");
  });

  it("treats a variance column as not the ratio, and a from/to sentence in time order", () => {
    const page = `Additional Regulatory Information
Debt equity ratio Debt Networth 0.20 0.18 7.80 Not more than 25%
The Company is a debt-free Company.
Interest Coverage Ratio increased from 5.59 in FY 2024-25 to 8.83 in FY 2025-26.
`;
    const blocks = composePull(
      input({
        hasTranscript: true,
        pages: [{ page: 26, text: page }],
      }),
    );
    const balance = blocks.find((b) => b.title === "Balance sheet");
    const bear = blocks.find((b) => b.title === "Bull vs. bear");
    expect(balance?.lines.join(" ")).toContain("0.20");
    expect(balance?.lines.join(" ")).not.toContain("7.80");
    expect(bear?.lines.join(" ")).toContain("debt-free");
    expect(bear?.lines.join(" ")).not.toContain("5.59 against 25");
    expect(bear?.lines.join(" ")).not.toContain("5.59 against 8.83");
  });

  it("keeps a verified headline guide and drops other metrics", () => {
    const quote =
      "We now believe that our margin will be between 13.5% to 14%.";
    const blocks = composePull(
      input({
        hasTranscript: true,
        guidance: [
          {
            metric: "operating_margin",
            low: 13.5,
            high: 14,
            unit: "%",
            horizon: "FY27",
            status: "open",
            page: 6,
            quote,
            url: "https://example.test/call.pdf",
            docKind: "transcript",
            period: "Q2FY27",
          },
          {
            metric: "other",
            low: null,
            high: null,
            unit: null,
            horizon: "FY27",
            status: "open",
            page: 1,
            quote: "We are very bullish about the rest of the year.",
            url: null,
            docKind: "transcript",
            period: "Q2FY27",
          },
        ],
      }),
    );
    const g = blocks.find((b) => b.title === "Guidance");
    expect(g?.lines.join(" ")).toContain("13.5");
    expect(g?.lines.join(" ")).toContain("14%");
    expect(g?.lines.join(" ")).not.toMatch(/bullish/i);
    expect(g?.cites[0]?.quote).toBe(quote);
  });
});
