import { describe, expect, it } from "vitest";
import {
  answerNse,
  crawlLabel,
  indexCard,
  NSE_FEED_FAILED,
  NSE_LIVE_URL,
  quoteCard,
  statusCard,
} from "@/engine/sources/nse-mcp";

const QUOTE = {
  updatedAt: "2026-11-09T19:29:27.114875372Z",
  stock: {
    symbol: "RELIANCE",
    lastTradedPrice: 1324.4,
    perChange: 0.03,
    latestTimestamp: "2026-11-09 16:00:27",
    commentary: "Reliance looks extended after a strong close.",
  },
};

function mcpFetch(payload: unknown, mode: "json" | "sse" | "prose" = "json") {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2025-06-18" },
        }),
        {
          status: 200,
          headers: { "mcp-session-id": "test-session" },
        },
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    const text =
      mode === "prose"
        ? "Reliance looks extended after a strong close."
        : JSON.stringify(payload);
    const rpc = {
      jsonrpc: "2.0",
      id: 2,
      result: { isError: false, content: [{ type: "text", text }] },
    };
    const raw =
      mode === "sse"
        ? `event: message\ndata: ${JSON.stringify(rpc)}\n`
        : JSON.stringify(rpc);
    return new Response(raw, { status: 200 });
  }) as typeof fetch;
}

describe("nse live cards", () => {
  it("prints the price and names NSE, not the prose field", () => {
    const card = quoteCard({
      symbol: "RELIANCE",
      last: 1324.4,
      changePct: 0.03,
      asOf: "2026-11-09 16:00:27",
    });
    expect(card).toEqual({
      headline: "RELIANCE ₹ 1,324.40, up 0.03%.",
      note: "NSE · 09 Nov 2026 16:00",
    });
    expect(card.headline).not.toContain("extended");
  });

  it("prints an index level without a rupee sign", () => {
    expect(
      indexCard({
        indexName: "NIFTY 50",
        last: 25044.65,
        changePct: 0.23,
        asOf: "09-Nov-2026 15:30:00",
      }),
    ).toEqual({
      headline: "NIFTY 50 25,044.65, up 0.23%.",
      note: "NSE · 09 Nov 2026 15:30",
    });
  });

  it("says the feed has no open flag, and keeps the crawl time", () => {
    const crawled = "2026-11-09T19:29:16.344465924Z";
    expect(crawlLabel(crawled)).toBe("10 Nov 2026 00:59 IST");
    expect(statusCard({ open: null, lastCrawled: crawled })).toEqual({
      headline: "NSE does not publish whether the market is open.",
      note: "NSE · last crawl 10 Nov 2026 00:59 IST",
    });
    expect(statusCard({ open: "closed", lastCrawled: null }).headline).toBe(
      "NSE says the market is closed.",
    );
  });

  it("reads a quote off the live server and drops prose", async () => {
    const card = await answerNse(
      { kind: "quote", symbol: "RELIANCE" },
      mcpFetch(QUOTE, "sse"),
    );
    expect(card.headline).toBe("RELIANCE ₹ 1,324.40, up 0.03%.");
    expect(card.note).toContain("NSE");
    expect(JSON.stringify(card)).not.toContain("extended");
  });

  it("refuses a prose tool body", async () => {
    await expect(
      answerNse({ kind: "status" }, mcpFetch({}, "prose")),
    ).rejects.toThrow(NSE_FEED_FAILED);
  });

  it("calls only the documented live endpoint", async () => {
    let url = "";
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      url = input;
      return mcpFetch({
        indices: { gainers: { lastCrawled: "2026-11-09T19:29:16.344Z" } },
      })(input, init);
    }) as typeof fetch;
    const card = await answerNse({ kind: "status" }, fetchImpl);
    expect(url).toBe(NSE_LIVE_URL);
    expect(card.headline).toBe(
      "NSE does not publish whether the market is open.",
    );
    expect(card.note).toContain("NSE");
  });
});
