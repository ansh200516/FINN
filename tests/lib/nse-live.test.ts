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
});
