import { describe, expect, it } from "vitest";
import {
  actionWindow,
  answerNse,
  crawlLabel,
  indexCard,
  NSE_EOD_FAILED,
  NSE_EOD_URL,
  NSE_FEED_FAILED,
  NSE_INDEX_MISSING,
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

  it("quotes a corporate action from NSE and leaves the factor off", async () => {
    const calls: Array<{ url: string; name?: string; args?: unknown }> = [];
    const card = await answerNse(
      { kind: "actions", symbol: "RELIANCE", scope: "all" },
      toolFetch(calls, {
        get_corporate_actions: {
          symbol: "RELIANCE",
          from: "2021-11-10",
          to: "2026-11-10",
          count: 7,
          actions: [
            {
              exDate: "2022-08-18",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 8 Per Share",
              adjustmentFactor: 1,
            },
            {
              exDate: "2023-07-20",
              actionType: "OTHER",
              purpose: "Demerger",
              adjustmentFactor: 1,
            },
            {
              exDate: "2023-08-21",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 9 Per Share",
              adjustmentFactor: 1,
            },
            {
              exDate: "2024-08-19",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 10 Per Share",
              adjustmentFactor: 1,
            },
            {
              exDate: "2024-10-28",
              actionType: "BONUS",
              purpose: "Bonus 1:1",
              adjustmentFactor: 0.5,
            },
            {
              exDate: "2025-08-14",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 5.5 Per Share",
              adjustmentFactor: 1,
            },
            {
              exDate: "2026-06-05",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 6 Per Share",
              adjustmentFactor: 1,
            },
          ],
        },
      }),
    );
    expect(card).toEqual({
      headline:
        "RELIANCE dividend ₹ 6 a share, ex-date 05 Jun 2026. Bonus 1:1, ex-date 28 Oct 2024. Demerger, ex-date 20 Jul 2023.",
      note: "NSE · 7 actions",
    });
    expect(JSON.stringify(card)).not.toContain("0.5");
    expect(JSON.stringify(card)).not.toContain("Rs 10");
    expect(JSON.stringify(card)).not.toContain("5.50");
    const call = calls.find((c) => c.name === "get_corporate_actions");
    expect(call?.url).toBe(NSE_EOD_URL);
    expect(call?.args).toMatchObject({ symbol: "RELIANCE", ...actionWindow() });
  });

  it("answers a split question without a dividend figure", async () => {
    const card = await answerNse(
      { kind: "actions", symbol: "RELIANCE", scope: "capital" },
      toolFetch([], {
        get_corporate_actions: {
          symbol: "RELIANCE",
          from: "2021-11-10",
          to: "2026-11-10",
          count: 2,
          actions: [
            {
              exDate: "2024-10-28",
              actionType: "BONUS",
              purpose: "Bonus 1:1",
              adjustmentFactor: 0.5,
            },
            {
              exDate: "2026-06-05",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 6 Per Share",
              adjustmentFactor: 1,
            },
          ],
        },
      }),
    );
    expect(card.headline).toBe("RELIANCE Bonus 1:1, ex-date 28 Oct 2024.");
    expect(card.note).toBe("NSE");
    expect(card.headline).not.toContain("₹");
  });

  it("says when NSE lists no split or bonus", async () => {
    const card = await answerNse(
      { kind: "actions", symbol: "INFY", scope: "capital" },
      toolFetch([], {
        get_corporate_actions: {
          symbol: "INFY",
          from: "2021-11-10",
          to: "2026-11-10",
          count: 1,
          actions: [
            {
              exDate: "2026-06-05",
              actionType: "DIVIDEND",
              purpose: "Dividend - Rs 6 Per Share",
            },
          ],
        },
      }),
    );
    expect(card.headline).toBe(
      "No NSE split or bonus for INFY from 10 Nov 2021 to 10 Nov 2026.",
    );
    expect(card.headline).not.toContain("₹");
  });

  it("refuses a corporate-action error instead of an empty list", async () => {
    await expect(
      answerNse(
        { kind: "actions", symbol: "INFY", scope: "all" },
        toolFetch([], { get_corporate_actions: { error: "lookup failed" } }),
      ),
    ).rejects.toThrow(NSE_EOD_FAILED);
  });

  it("prints one index close and ignores the neighbour and the P/E", async () => {
    const calls: Array<{ url: string; name?: string; args?: unknown }> = [];
    const card = await answerNse(
      { kind: "index-close", indexName: "NIFTY 50", date: "2026-11-09" },
      toolFetch(calls, {
        get_index_snapshot: {
          date: "2026-11-09",
          requested_date: "2026-11-09",
          indices: [
            {
              indexName: "Nifty 50",
              close: 25044.65,
              pctChange: 0.23,
              pe: 20.48,
              pb: 3.07,
              divYield: 1.38,
              date: "2026-11-09",
            },
            {
              indexName: "Nifty 500",
              close: 23567,
              pctChange: 0.33,
              pe: 22.11,
              date: "2026-11-09",
            },
          ],
        },
      }),
    );
    expect(card).toEqual({
      headline: "NIFTY 50 25,044.65, up 0.23%.",
      note: "NSE · 09 Nov 2026",
    });
    expect(JSON.stringify(card)).not.toContain("20.48");
    expect(JSON.stringify(card)).not.toContain("22.11");
    expect(JSON.stringify(card)).not.toContain("23,567");
    const call = calls.find((c) => c.name === "get_index_snapshot");
    expect(call?.url).toBe(NSE_EOD_URL);
    expect(call?.args).toEqual({ date: "2026-11-09", filter: "NIFTY 50" });
  });

  it("says when the snapshot did not list that index", async () => {
    await expect(
      answerNse(
        { kind: "index-close", indexName: "NIFTY 50", date: "2026-11-09" },
        toolFetch([], {
          get_index_snapshot: {
            date: "2026-11-09",
            indices: [{ indexName: "Nifty 500", close: 1, pctChange: 0 }],
          },
        }),
      ),
    ).rejects.toThrow(NSE_INDEX_MISSING);
  });

  it("asks five years back from a fixed day", () => {
    expect(actionWindow(new Date("2026-11-10T08:00:00+05:30"))).toEqual({
      fromDate: "2021-11-10",
      toDate: "2026-11-10",
    });
  });
});

function toolFetch(
  calls: Array<{ url: string; name?: string; args?: unknown }>,
  payloads: Record<string, unknown>,
) {
  return (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      params?: { name?: string; arguments?: unknown };
    };
    if (body.method === "tools/call") {
      calls.push({
        url,
        name: body.params?.name,
        args: body.params?.arguments,
      });
    }
    if (body.method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { protocolVersion: "2025-06-18" },
        }),
        { status: 200, headers: { "mcp-session-id": "test-session" } },
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    const name = body.params?.name ?? "";
    const payload = payloads[name] ?? {};
    const rpc = {
      jsonrpc: "2.0",
      id: 2,
      result: {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(payload) }],
      },
    };
    return new Response(JSON.stringify(rpc), { status: 200 });
  }) as typeof fetch;
}
