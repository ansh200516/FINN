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

  it("reads a segment turnover table and ignores a gas-portfolio fragment", () => {
    const table = `disclosed as Unallocable. Primary Segment Information (I in crore) 2025-26 O2C Oil and Gas Retail Digital Services Others Unallocable Total Segment Revenue External Turnover 6,58,991 19,008 3,65,820 59,777 72,323 - 11,75,919 Value of Sales and Services (Revenue) * 6,62,401 23,861 3,71,085 1,76,164 80,522 - 11,75,919`;
    const gas =
      "RIL's gas portfolio remains well-positioned to support this structural shift, contributing nearly 30% of the country's domestic gas production.";
    const blocks = composePull(
      input({
        hasTranscript: true,
        pages: [
          { page: 53, text: gas },
          { page: 168, text: table },
        ],
      }),
    );
    const biz = blocks.find((b) => b.title === "Business snapshot");
    const text = biz?.lines.join(" ") ?? "";
    expect(text).toContain("O2C");
    expect(text).toContain("Retail");
    expect(text).toContain("6,62,401");
    expect(text).toContain("1,76,164");
    expect(text).not.toMatch(/Unallocable 6,58,991/);
    expect(text).toContain("computed");
    expect(text).not.toContain("gas portfolio");
  });

  it("reads a printed turnover mix", () => {
    const page = `PRODUCT GROUP WISE SHARE IN TURNOVER Plastics Piping Products 70% Packaging Products 15% Industrial Products 11% Consumer Products 4%`;
    const blocks = composePull(
      input({
        hasTranscript: true,
        pages: [{ page: 52, text: page }],
      }),
    );
    const text =
      blocks.find((b) => b.title === "Business snapshot")?.lines.join(" ") ??
      "";
    expect(text).toContain("Plastics Piping Products 70%");
    expect(text).toContain("Consumer Products 4%");
  });

  it("does not pair return on equity with the next ratio", () => {
    const page = `KEY FINANCIAL RATIOS
Return on Equity: 14.3% y Cost-to-income ratio: 38.0%
Debt Equity Ratio for the year ended March 31, 2026 stood at 0.53 as compared to 0.74 in the previous year.
`;
    const blocks = composePull(
      input({
        isBank: true,
        hasTranscript: true,
        pages: [{ page: 83, text: page }],
      }),
    );
    const balance =
      blocks.find((b) => b.title === "Balance sheet")?.lines.join(" ") ?? "";
    expect(balance).toContain("14.3%");
    expect(balance).toContain("0.53");
    expect(balance).not.toContain("14.3% against 38");
    expect(balance).not.toContain("2,370");
    expect(balance).toMatch(/working-capital cycle is not printed/i);
    const glance =
      blocks.find((b) => b.title === "Financial snapshot")?.lines.join(" ") ??
      "";
    expect(glance).toContain("38.0%");
    expect(glance).not.toContain("against 38");
  });

  it("names NII, not revenue, on a bank trajectory", () => {
    const quarters = [
      "2024-12-31",
      "2025-03-31",
      "2025-06-30",
      "2025-09-30",
      "2025-12-31",
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
    ].map((periodEnd, i) => ({
      periodEnd,
      basis: "consolidated" as const,
      source: "xbrl",
      sourceUrl: null,
      revenue: (100 + i) * 1e7,
      ebitda: null,
      pat: (20 + i) * 1e7,
      nii: (40 + i) * 1e7,
      ppop: (30 + i) * 1e7,
    }));
    const blocks = composePull(
      input({ isBank: true, hasTranscript: true, quarters }),
    );
    const traj =
      blocks.find((b) => b.title === "Trajectory")?.lines.join(" ") ?? "";
    expect(traj).toContain("NII");
    expect(traj).not.toMatch(/Revenue \+/);
  });

  it("reads net cash flows and the profit on the same statement", () => {
    const page = `CONSOLIDATED CASH FLOW STATEMENT
(C in crore)
Cash flows from operating activities: Consolidated Profit after tax and minority interest 76,025.97 70,792.25
Net cash flows from operating activities 113,506.38 127,241.84
`;
    const blocks = composePull(
      input({
        isBank: true,
        hasTranscript: true,
        pages: [{ page: 498, text: page }],
      }),
    );
    const cash =
      blocks.find((b) => b.title === "Cash quality")?.lines.join(" ") ?? "";
    expect(cash).toContain("113,506.38");
    expect(cash).toContain("76,025.97");
    expect(cash).toMatch(/profit turning into operating cash/i);
  });
});
