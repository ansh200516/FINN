import { describe, expect, it } from "vitest";
import {
  amountBonus,
  computePriority,
  extractAmountsInr,
  tierFor,
} from "@/engine/analyse/priority";
import type { AnnouncementRaw, Category } from "@/engine/types";

function raw(over: Partial<AnnouncementRaw>): AnnouncementRaw {
  return {
    symbol: "X",
    sm_name: "X Limited",
    sm_isin: "INE000A01001",
    smIndustry: null,
    desc: "Updates",
    attchmntText: "",
    attchmntFile: "",
    attFileSize: null,
    fileSize: null,
    hasXbrl: "No",
    an_dt: "08-Nov-2026 17:00:00",
    sort_date: "2026-11-08 17:00:00",
    exchdisstime: "08-Nov-2026 17:00:00",
    seq_id: "1",
    ...over,
  };
}

function p(
  category: Category,
  subcategory: string | undefined,
  text: string,
  ctx: Partial<Parameters<typeof computePriority>[2]> = {},
) {
  return computePriority(
    raw({ attchmntText: text }),
    { category, subcategory, classifiedBy: "rule", eventKey: "" },
    { seenBefore: false, ...ctx },
  );
}

describe("tierFor", () => {
  it("maps 0–100 to tiers", () => {
    expect(tierFor(60)).toBe(1);
    expect(tierFor(59)).toBe(2);
    expect(tierFor(30)).toBe(2);
    expect(tierFor(29)).toBe(3);
  });
});

describe("computePriority — category bases", () => {
  it("results outcome is Tier 1; its deck / press release / newspaper ad are not", () => {
    expect(p("results", "outcome", "financial results").tier).toBe(1);
    expect(p("results", "presentation", "Investor Presentation").tier).toBe(2);
    expect(
      p("results", "newspaper", "Newspaper publication of Q2 results").tier,
    ).toBe(3);
    expect(
      p(
        "results",
        "bm_intimation",
        "Board meeting on 13 Nov to consider results",
      ).tier,
    ).toBe(3);
  });
  it("routine variants stay Tier 3 regardless of red-flag words in the subject", () => {
    expect(
      p(
        "unclassified",
        "newspaper",
        "Newspaper ad: NCLT penalty fraud downgrade",
      ).priority,
    ).toBeLessThan(30);
    expect(p("fund_raise", "cp", "allotment of commercial paper").tier).toBe(3);
    expect(p("investor_meetings", undefined, "Schedule of meet").tier).toBe(3);
  });
  it("novelty: first time in 180 days gets +10; a repeat litigation drops to Tier 2", () => {
    expect(
      p("litigation", undefined, "Action(s) taken or orders passed").tier,
    ).toBe(1);
    expect(
      p("litigation", undefined, "Action(s) taken or orders passed", {
        seenBefore: true,
      }).tier,
    ).toBe(2);
  });
  it("repetition decay: 2+ in 7 days takes 10 off", () => {
    const a = p("press_release", "order_win", "Bagging of order", {
      seenBefore: true,
    }).priority;
    const b = p("press_release", "order_win", "Bagging of order", {
      seenBefore: true,
      recentSameCategory: 3,
    }).priority;
    expect(a - b).toBe(10);
  });
});

describe("computePriority — materiality cues", () => {
  it("credit rating: downgrade promotes to Tier 1, reaffirmation stays Tier 2", () => {
    expect(
      p("credit_rating", "change", "CRISIL downgrades rating to AA-").tier,
    ).toBe(1);
    expect(
      p("credit_rating", "reaffirm", "CARE reaffirms AA; Stable").tier,
    ).toBe(2);
    expect(p("credit_rating", undefined, "Credit Rating").tier).toBe(2);
  });
  it("extracted action from the one-liner re-scores a rating", () => {
    expect(
      p("credit_rating", undefined, "Credit Rating", {
        seenBefore: true,
        extracted: { action: "downgrade" },
      }).priority,
    ).toBeGreaterThanOrEqual(78);
    expect(
      p("credit_rating", "change", "revision", {
        seenBefore: true,
        extracted: { action: "reaffirm" },
      }).tier,
    ).toBe(2);
  });
  it("red flags: qualified opinion, fraud, NCLT, going concern add points", () => {
    const base = p(
      "results",
      "outcome",
      "Unaudited financial results",
    ).priority;
    expect(
      p(
        "results",
        "outcome",
        "Unaudited financial results with qualified opinion of the auditors",
      ).priority,
    ).toBeGreaterThan(base);
    expect(
      p(
        "litigation",
        undefined,
        "NCLT admits insolvency petition; forensic audit initiated",
      ).priority,
    ).toBeGreaterThanOrEqual(90);
  });
  it("'no material impact' demotes a routine tax order", () => {
    const a = p(
      "litigation",
      "tax",
      "GST order; penalty of Rs. 1,20,000; no material impact on the company",
    ).tier;
    expect(a).toBe(2);
  });
  it("management change: CxO and directors are Tier 1, SMP Tier 2, junior CS Tier 3", () => {
    expect(p("management_change", "cxo", "appointment of CEO").tier).toBe(1);
    expect(
      p("management_change", "director", "appointment of Independent Director")
        .tier,
    ).toBe(1);
    expect(
      p("management_change", "smp", "changes in Senior Management Personnel")
        .tier,
    ).toBe(2);
    expect(
      p("management_change", "cs_junior", "Joint Company Secretary").tier,
    ).toBe(3);
  });
  it("pledging: invocation is the loudest", () => {
    expect(
      p("pledging", "invocation", "invocation of pledge by lender").priority,
    ).toBeGreaterThanOrEqual(90);
    expect(p("pledging", "release", "release of pledge").tier).toBe(2);
  });
  it("market reaction adds 10", () => {
    const a = p("dividend", "declaration", "Interim dividend Rs 5").priority;
    const b = p("dividend", "declaration", "Interim dividend Rs 5", {
      marketReaction: true,
    }).priority;
    expect(b - a).toBe(10);
  });
});

describe("amounts", () => {
  it("extractAmountsInr handles crore/lakh/million and USD", () => {
    const a = extractAmountsInr(
      "consideration of Rs. 523.8 crore and INR 1,500 million; order worth USD 26.14 million; Rs. 12 per share",
    );
    expect(a).toContain(523.8e7);
    expect(a).toContain(1500e6);
    expect(a).toContain(26.14e6 * 84);
    expect(a).not.toContain(12);
  });
  it("amountBonus scales with market cap when known, else absolute thresholds", () => {
    expect(amountBonus(600e7, 565_000e7)).toBe(0); // 0.1% of mcap
    expect(amountBonus(6000e7, 565_000e7)).toBe(22); // ~1.06%
    expect(amountBonus(600e7, undefined)).toBe(20);
    expect(amountBonus(50e7, undefined)).toBe(0);
  });
  it("order wins become Tier 1 only when material versus company size", () => {
    const small = p("press_release", "order_win", "order worth Rs 600 crore", {
      mcapInr: 565_000e7,
    });
    const big = p(
      "press_release",
      "order_win",
      "mega order worth Rs 12,000 crore",
      { mcapInr: 565_000e7 },
    );
    expect(small.tier).toBe(2);
    expect(big.tier).toBe(1);
  });
});
