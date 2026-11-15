import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

vi.mock("@/engine/llm/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine/llm/gateway")>();
  return { ...actual, callStructured: vi.fn() };
});

vi.mock("@/engine/sources/nse-mcp", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/engine/sources/nse-mcp")>();
  return { ...actual, answerNse: vi.fn() };
});

vi.mock("@/engine/sources/bhavcopy", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/engine/sources/bhavcopy")>();
  return { ...actual, fetchBhavcopy: vi.fn() };
});

import { db, getDb } from "@/db/client";
import { companies, prices } from "@/db/schema";
import { callStructured } from "@/engine/llm/gateway";
import type { BhavcopyRow } from "@/engine/sources";
import { fetchBhavcopy } from "@/engine/sources/bhavcopy";
import { answerNse, NseFeedError } from "@/engine/sources/nse-mcp";
import { FINNIE_SOCIAL, socialReply } from "@/lib/finnieSocial";
import { runFinnieTurn } from "@/lib/finnieTurn";
import { FINNIE_NO_MATCH } from "@/lib/finnieTypes";
import { noSessionClose, sessionCloseSentence } from "@/lib/sessionClose";
import { lastMarketClose } from "@/lib/time";
import { FinnieAnswer } from "@/ui/Desk";

const llm = callStructured as unknown as Mock<typeof callStructured>;
const live = answerNse as unknown as Mock<typeof answerNse>;
const bhav = fetchBhavcopy as unknown as Mock<typeof fetchBhavcopy>;

const SBIN = "INE062A01020";

function model(data: unknown) {
  return {
    data,
    model: "gemini-3.5-flash-lite",
    cached: false,
    tokensIn: 1,
    tokensOut: 1,
    tokensThought: 0,
    latencyMs: 1,
    cacheKey: "test",
  };
}

function bar(
  symbol: string,
  close: number,
  prev: number,
  date: string,
): BhavcopyRow {
  return {
    TradDt: date,
    TckrSymb: symbol,
    SctySrs: "EQ",
    ISIN: SBIN,
    OpnPric: prev,
    HghPric: close,
    LwPric: prev,
    ClsPric: close,
    LastPric: close,
    PrvsClsgPric: prev,
    TtlTradgVol: 1,
    TtlTrfVal: 1,
    TtlNbOfTxsExctd: 1,
  };
}

function planQuote(symbol = "sbi") {
  llm.mockResolvedValueOnce(
    model({ calls: [{ tool: "get_quote", args: { symbol } }] }),
  );
}

beforeAll(async () => {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
});

beforeEach(async () => {
  llm.mockReset();
  live.mockReset();
  bhav.mockReset();
  live.mockRejectedValue(new NseFeedError());
  bhav.mockResolvedValue([]);
  await db.delete(prices).where(eq(prices.isin, SBIN));
  await db.delete(companies).where(eq(companies.isin, SBIN));
});

describe("greetings", () => {
  it("answers hi babe in code and does not call the model", async () => {
    expect(socialReply("hi babe")).toBe(FINNIE_SOCIAL);
    expect(socialReply("thanks")).toBe(FINNIE_SOCIAL);
    expect(socialReply("find last traded price of sbi")).toBeNull();
    const result = await runFinnieTurn("hi babe", null);
    expect(llm).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
    expect(result.say).toBe(FINNIE_SOCIAL);
    expect(result.say).not.toBe(FINNIE_NO_MATCH);
    expect(result.tools).toEqual([]);
  });
});

describe("sbi price when the live quote throws", () => {
  it("resolves sbi to SBIN and uses the bhavcopy close", async () => {
    const date = lastMarketClose(new Date()).dateKey;
    const close = 970.25;
    const prev = 960;
    bhav.mockResolvedValue([bar("SBIN", close, prev, date)]);
    planQuote("sbi");
    const result = await runFinnieTurn("find last traded price of sbi", null);
    const say = sessionCloseSentence(
      "SBIN",
      close,
      date,
      ((close - prev) / prev) * 100,
    );
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.say).toBe(say);
    expect(result.say).toContain("SBIN");
    expect(result.say).toContain("970.25");
    expect(result.say.toLowerCase()).not.toContain("live feed");
    expect(result.tools).toEqual(["get_quote"]);
    expect(result.pages).toContain("/c/SBIN");
    const html = renderToStaticMarkup(
      createElement(FinnieAnswer, {
        say: result.say,
        cards: result.cards,
        pages: result.pages,
        links: result.links,
      }),
    );
    expect(html).toContain('href="/c/SBIN"');
    expect(html).toContain("Full page");
    expect(html).not.toContain("live feed");
  });

  it("uses the stored session close and does not download a bhavcopy", async () => {
    await db.insert(companies).values({
      isin: SBIN,
      nseSymbol: "SBIN",
      name: "State Bank of India",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    });
    await db.insert(prices).values({
      isin: SBIN,
      date: "2026-11-13",
      close: 1000,
      prevClose: 980,
      sessionType: "normal",
      source: "nse_bhav",
    });
    planQuote("sbi");
    const result = await runFinnieTurn("find last traded price of sbi", null);
    expect(bhav).not.toHaveBeenCalled();
    expect(result.say).toBe(
      sessionCloseSentence(
        "SBIN",
        1000,
        "2026-11-13",
        ((1000 - 980) / 980) * 100,
      ),
    );
    expect(result.say).toContain("13 Nov 2026");
    expect(result.pages).toContain("/c/SBIN");
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("does not invent a price when no session close exists", async () => {
    planQuote("sbi");
    const result = await runFinnieTurn("find last traded price of sbi", null);
    expect(result.say).toBe(noSessionClose("SBIN"));
    expect(result.say).not.toMatch(/\d/);
    expect(result.links).toEqual([
      { href: "/c/SBIN", label: "Full page" },
      { href: "/add?research=SBIN", label: "Add" },
    ]);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("keeps a live quote when the feed answers", async () => {
    live.mockReset();
    live.mockResolvedValue({
      headline: "SBIN ₹ 1,050.00, up 0.40%.",
      note: "NSE · 16 Nov 2026 10:00",
    });
    planQuote("sbi");
    const result = await runFinnieTurn("sbi price", null);
    expect(bhav).not.toHaveBeenCalled();
    expect(result.say).toBe("SBIN ₹ 1,050.00, up 0.40%.");
    expect(result.pages).toContain("/c/SBIN");
  });
});
