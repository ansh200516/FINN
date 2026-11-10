import { describe, expect, it } from "vitest";
import { classifyLiveAsk } from "@/lib/nseLive";

describe("classifyLiveAsk", () => {
  it("keeps filings, promises, and alerts off the live feed", () => {
    expect(
      classifyLiveAsk("what did they say about the plant", "ITC"),
    ).toBeNull();
    expect(
      classifyLiveAsk("how much debt is on the balance sheet", "ITC"),
    ).toBeNull();
    expect(
      classifyLiveAsk("results for the plastics business", "ITC"),
    ).toBeNull();
    expect(classifyLiveAsk("set price alert to 4%", "ITC")).toBeNull();
    expect(classifyLiveAsk("guidance", "ITC")).toBeNull();
    expect(classifyLiveAsk("today's announcement", "RELIANCE")).toBeNull();
  });

  it("routes a price, an index, and market status", () => {
    expect(classifyLiveAsk("reliance price", null)).toEqual({
      kind: "quote",
      symbol: "RELIANCE",
    });
    expect(classifyLiveAsk("price", "ITC")).toEqual({
      kind: "quote",
      symbol: "ITC",
    });
    expect(classifyLiveAsk("tcs price", "ITC")).toEqual({
      kind: "quote",
      symbol: "TCS",
    });
    expect(classifyLiveAsk("nifty", "ITC")).toEqual({
      kind: "index",
      indexName: "NIFTY 50",
    });
    expect(classifyLiveAsk("bank nifty", null)).toEqual({
      kind: "index",
      indexName: "NIFTY BANK",
    });
    expect(classifyLiveAsk("is the market open?", null)).toEqual({
      kind: "status",
    });
    expect(classifyLiveAsk("hdfc bank price", "ITC")?.kind).toBe(
      "needs-symbol",
    );
  });

  it("routes corporate actions and one dated index close", () => {
    expect(classifyLiveAsk("corporate actions", "RELIANCE")).toEqual({
      kind: "actions",
      symbol: "RELIANCE",
      scope: "all",
    });
    expect(classifyLiveAsk("infy corporate actions", null)).toEqual({
      kind: "actions",
      symbol: "INFY",
      scope: "all",
    });
    expect(classifyLiveAsk("corporate actions", null)).toEqual({
      kind: "needs-symbol",
      bare: true,
    });
    expect(classifyLiveAsk("check for splits or bonuses too", "ITC")).toEqual({
      kind: "actions",
      symbol: "ITC",
      scope: "capital",
    });
    expect(classifyLiveAsk("splits, bonuses or dividends", "ITC")).toEqual({
      kind: "actions",
      symbol: "ITC",
      scope: "all",
    });
    expect(classifyLiveAsk("nifty on 6 october 2026", "ITC")).toEqual({
      kind: "index-close",
      indexName: "NIFTY 50",
      date: "2026-10-06",
    });
    expect(
      classifyLiveAsk("what did nifty close at on 2026-11-09", null),
    ).toEqual({
      kind: "index-close",
      indexName: "NIFTY 50",
      date: "2026-11-09",
    });
    expect(classifyLiveAsk("bank nifty as of 6 oct 2026", null)).toEqual({
      kind: "index-close",
      indexName: "NIFTY BANK",
      date: "2026-10-06",
    });
    expect(classifyLiveAsk("nifty", "ITC")).toEqual({
      kind: "index",
      indexName: "NIFTY 50",
    });
    expect(
      classifyLiveAsk("compare nifty and bank nifty on 6 october 2026", null),
    ).toBeNull();
    expect(classifyLiveAsk("infy dividend", "ITC")).toEqual({
      kind: "actions",
      symbol: "INFY",
      scope: "all",
    });
    expect(classifyLiveAsk("reliance dividends", null)).toEqual({
      kind: "actions",
      symbol: "RELIANCE",
      scope: "all",
    });
    expect(classifyLiveAsk("dividends", "RELIANCE")).toEqual({
      kind: "actions",
      symbol: "RELIANCE",
      scope: "all",
    });
    expect(classifyLiveAsk("reliance price", null)?.kind).toBe("quote");
  });
});
