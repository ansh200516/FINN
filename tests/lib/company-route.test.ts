import { describe, expect, it } from "vitest";
import { companyHasSubstance, companyRouteMode } from "@/lib/companyRoute";

const empty = {
  onFile: false,
  inPortfolio: false,
  hasSubstance: false,
  researchFinished: false,
  jobOpen: false,
  jobFailed: false,
};

describe("companyRouteMode", () => {
  it("starts research for a symbol that is not on file", () => {
    expect(companyRouteMode(empty)).toBe("start");
  });

  it("keeps the receipt up while an ad-hoc job is open, even after a price lands", () => {
    expect(
      companyRouteMode({
        ...empty,
        onFile: true,
        hasSubstance: true,
        jobOpen: true,
      }),
    ).toBe("receipt");
  });

  it("renders the page once research has finished, including an empty filing set", () => {
    expect(
      companyRouteMode({
        ...empty,
        onFile: true,
        researchFinished: true,
      }),
    ).toBe("page");
  });

  it("keeps a portfolio company on its page while a job is open", () => {
    expect(
      companyRouteMode({
        ...empty,
        onFile: true,
        inPortfolio: true,
        hasSubstance: true,
        jobOpen: true,
      }),
    ).toBe("page");
  });

  it("shows a failed job instead of an empty company page", () => {
    expect(
      companyRouteMode({
        ...empty,
        onFile: true,
        jobFailed: true,
      }),
    ).toBe("receipt");
  });

  it("shows an ad-hoc company that already has filings and no open job", () => {
    expect(
      companyRouteMode({
        ...empty,
        onFile: true,
        hasSubstance: true,
      }),
    ).toBe("page");
  });

  it("restarts when the row exists but research never produced a job or a filing", () => {
    expect(companyRouteMode({ ...empty, onFile: true })).toBe("start");
  });
});

describe("companyHasSubstance", () => {
  const blank = {
    prices: { lastClose: null, closes: [] as Array<number | null> },
    events: [],
    quarters: [],
    documents: [],
  };

  it("is false for a resolved name with nothing filed or priced", () => {
    expect(companyHasSubstance(blank)).toBe(false);
  });

  it("is true for a price, a filing, a quarter, or a document", () => {
    expect(
      companyHasSubstance({
        ...blank,
        prices: { lastClose: 1420.5, closes: [1420.5] },
      }),
    ).toBe(true);
    expect(companyHasSubstance({ ...blank, events: [{}] })).toBe(true);
    expect(companyHasSubstance({ ...blank, quarters: [{}] })).toBe(true);
    expect(companyHasSubstance({ ...blank, documents: [{}] })).toBe(true);
  });
});
