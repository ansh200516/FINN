import { describe, expect, it } from "vitest";
import { backtestTripwire, evaluateTripwire } from "@/engine/analyse/tripwires";
import type { PriceBar } from "@/engine/types";
import { sessionCloseMs, tradingDaysBetween } from "@/lib/time";

function bars(): PriceBar[] {
  const days = tradingDaysBetween("2026-10-01", "2026-11-09");
  const out: PriceBar[] = [];
  let prev = 200;
  for (const d of days) {
    const special = d === "2026-11-08";
    const spike = d === "2026-11-09";
    const close = spike ? prev * 1.08 : prev;
    out.push({
      isin: "INE000A01001",
      date: d,
      open: prev,
      high: close,
      low: prev,
      close,
      prevClose: prev,
      volume: special ? 50_000 : spike ? 2_600_000 : 1_000_000,
      turnover: null,
      trades: null,
      sessionType: special ? "special" : "normal",
    });
    prev = close;
  }
  return out;
}

describe("evaluateTripwire", () => {
  const isin = "INE000A01001";
  it("volume_ratio fires on the spike day with a human sentence", () => {
    const hit = evaluateTripwire(
      {
        id: "t1",
        kind: "volume_ratio",
        params: { ratio: 2, lookbackDays: 20 },
      },
      {
        isin,
        bars: bars(),
        categoriesToday: [],
        textsToday: [],
        at: sessionCloseMs("2026-11-09"),
      },
    );
    expect(hit).not.toBeNull();
    expect(hit?.summary).toMatch(/^Volume 2\.6× the 20-day average on 09 Nov/);
    expect(hit?.evidence.ratio).toBeCloseTo(2.6, 1);
  });
  it("volume_ratio does not fire when the latest bar is a special session", () => {
    const b = bars().filter((x) => x.date <= "2026-11-08");
    const hit = evaluateTripwire(
      {
        id: "t1",
        kind: "volume_ratio",
        params: { ratio: 2, lookbackDays: 20 },
      },
      {
        isin,
        bars: b,
        categoriesToday: [],
        textsToday: [],
        at: sessionCloseMs("2026-11-08"),
      },
    );
    expect(hit).toBeNull();
  });
  it("price_move honours the threshold", () => {
    const ctx = {
      isin,
      bars: bars(),
      categoriesToday: [],
      textsToday: [],
      at: sessionCloseMs("2026-11-09"),
    };
    expect(
      evaluateTripwire({ id: "p", kind: "price_move", params: { pct: 5 } }, ctx)
        ?.summary,
    ).toMatch(/^\+8\.0% on 09 Nov/);
    expect(
      evaluateTripwire(
        { id: "p", kind: "price_move", params: { pct: 10 } },
        ctx,
      ),
    ).toBeNull();
  });
  it("category and text rules evaluate today's filings", () => {
    const ctx = {
      isin,
      bars: [],
      categoriesToday: ["dividend", "unclassified"],
      textsToday: [
        "Board approves Interim Dividend of Rs. 19 per equity share",
      ],
      at: Date.UTC(2026, 10, 8, 12),
    };
    expect(
      evaluateTripwire(
        {
          id: "c",
          kind: "category",
          params: { categories: ["dividend", "pledging"] },
        },
        ctx,
      )?.summary,
    ).toBe("Filing in watched category: dividend");
    expect(
      evaluateTripwire(
        { id: "c", kind: "category", params: { categories: ["pledging"] } },
        ctx,
      ),
    ).toBeNull();
    expect(
      evaluateTripwire(
        {
          id: "x",
          kind: "text",
          params: { pattern: "interim dividend", flags: "i" },
        },
        ctx,
      )?.summary,
    ).toMatch(/matches \/interim dividend\//);
    expect(
      evaluateTripwire(
        { id: "x", kind: "text", params: { pattern: "[" } },
        ctx,
      ),
    ).toBeNull(); // bad regex → no crash
  });
});

describe("backtestTripwire", () => {
  it("counts fires over normal sessions and writes the sentence", () => {
    const r = backtestTripwire(
      { kind: "volume_ratio", params: { ratio: 2, lookbackDays: 20 } },
      bars(),
    );
    expect(r.fires).toBe(1);
    expect(r.days).toBe(
      bars().filter((b) => b.sessionType === "normal").length,
    );
    expect(r.sentence).toMatch(
      /^Would have fired 1× in the last \d+ sessions \(volume > 2× the 20-day average\)\./,
    );
    expect(
      backtestTripwire({ kind: "price_move", params: { pct: 5 } }, bars())
        .fires,
    ).toBe(1);
  });
});
