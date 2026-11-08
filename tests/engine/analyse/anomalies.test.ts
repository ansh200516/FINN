import { describe, expect, it } from "vitest";
import {
  barMetrics,
  corporateActionDatesFrom,
  detectAnomalies,
  volumeBaseline,
} from "@/engine/analyse/anomalies";
import { parseLooseDate } from "@/engine/analyse/brief";
import type { PriceBar } from "@/engine/types";
import { tradingDaysBetween } from "@/lib/time";

/** Synthetic series: 25 normal sessions at ~1,000,000 volume, flat ₹100, then the Muhurat bar, then a spike day. */
function series(): PriceBar[] {
  const days = tradingDaysBetween("2026-10-01", "2026-11-09"); // includes 2026-11-08 (Muhurat, special)
  const bars: PriceBar[] = [];
  let prev = 100;
  for (const d of days) {
    const special = d === "2026-11-08";
    let close = prev;
    let volume = 1_000_000 + (bars.length % 5) * 10_000; // small jitter, mean ≈ 1.02 M
    if (special) {
      volume = 60_000; // ~1 hour of trading
      close = prev * 1.003;
    }
    if (d === "2026-11-09") {
      volume = 3_100_000; // 3× spike
      close = prev * 1.064; // +6.4 %
    }
    if (d === "2026-10-27") {
      close = prev * 0.945; // −5.5 % on normal volume
    }
    bars.push({
      isin: "INE000A01001",
      date: d,
      open: prev,
      high: Math.max(prev, close),
      low: Math.min(prev, close),
      close,
      prevClose: prev,
      volume,
      turnover: null,
      trades: null,
      sessionType: special ? "special" : "normal",
    });
    prev = close;
  }
  return bars;
}

describe("volumeBaseline", () => {
  it("excludes special sessions and the current bar; uses up to N normal sessions", () => {
    const bars = series();
    const iMon = bars.findIndex((b) => b.date === "2026-11-09");
    const base = volumeBaseline(bars, iMon, 20);
    expect(base.n).toBe(20);
    // mean of the 20 normal sessions before Monday — the 60k Muhurat bar must not drag it down
    expect(base.avg).toBeGreaterThan(1_000_000);
    expect(base.avg).toBeLessThan(1_050_000);
  });
  it("counts only the sessions that exist early in the series", () => {
    const bars = series();
    expect(volumeBaseline(bars, 3, 20).n).toBe(3);
    expect(volumeBaseline(bars, 0, 20)).toEqual({ avg: null, n: 0 });
  });
});

describe("detectAnomalies", () => {
  it("fires volume and price on the spike day, never on the Muhurat bar, and requires a minimum baseline", () => {
    const out = detectAnomalies(series(), {
      volumeRatio: 2,
      pricePct: 5,
      lookbackDays: 20,
      minBaselineDays: 10,
    });
    const dates = out.map((a) => `${a.date}:${a.kind}`);
    expect(dates).toContain("2026-11-09:volume_ratio");
    expect(dates).toContain("2026-11-09:price_move");
    expect(dates).toContain("2026-10-27:price_move");
    expect(dates.some((d) => d.startsWith("2026-11-08"))).toBe(false);
    const vol = out.find(
      (a) => a.date === "2026-11-09" && a.kind === "volume_ratio",
    );
    expect(vol?.value).toBeGreaterThan(2.9);
    expect(vol?.value).toBeLessThan(3.2);
    expect(vol?.summary).toMatch(/Volume 3\.\d× the 20-day average/);
    const px = out.find(
      (a) => a.date === "2026-11-09" && a.kind === "price_move",
    );
    expect(px?.value).toBeCloseTo(6.4, 0);
    expect(px?.summary).toMatch(/^\+6\.4% vs previous close/);
  });

  it("the Muhurat bar is not scored even if its volume ratio would be tiny / its move large", () => {
    const bars = series().map((b) =>
      b.date === "2026-11-08" ? { ...b, close: (b.prevClose ?? 100) * 1.2 } : b,
    );
    const out = detectAnomalies(bars, {
      volumeRatio: 2,
      pricePct: 5,
      lookbackDays: 20,
    });
    expect(out.some((a) => a.date === "2026-11-08")).toBe(false);
  });

  it("does not fire volume alerts before the baseline has minBaselineDays sessions", () => {
    const bars = series()
      .slice(0, 6)
      .map((b, i) => (i === 5 ? { ...b, volume: 9_000_000 } : b));
    const out = detectAnomalies(bars, {
      volumeRatio: 2,
      pricePct: 5,
      lookbackDays: 20,
      minBaselineDays: 10,
    });
    expect(out.filter((a) => a.kind === "volume_ratio")).toHaveLength(0);
  });

  it("suppresses price moves on corporate-action (ex/record) dates", () => {
    const out = detectAnomalies(series(), {
      volumeRatio: 2,
      pricePct: 5,
      lookbackDays: 20,
      corporateActionDates: new Set(["2026-10-27"]),
    });
    expect(out.some((a) => a.date === "2026-10-27")).toBe(false);
    expect(
      out.some((a) => a.date === "2026-11-09" && a.kind === "price_move"),
    ).toBe(true);
  });

  it("falls back to the previous bar's close when prevClose is missing", () => {
    const bars = series().map((b) => ({ ...b, prevClose: null }));
    const m = barMetrics(bars);
    const mon = m.find((x) => x.date === "2026-11-09");
    expect(mon?.pct).toBeCloseTo(6.4, 0);
  });

  it("respects configurable thresholds", () => {
    const strict = detectAnomalies(series(), {
      volumeRatio: 4,
      pricePct: 10,
      lookbackDays: 20,
    });
    expect(strict).toHaveLength(0);
  });
});

describe("corporateActionDatesFrom", () => {
  it("parses record dates from dividend/bonus subjects in several formats", () => {
    const s = corporateActionDatesFrom(
      [
        {
          category: "dividend",
          subject:
            "Hindustan Unilever Limited has informed the Exchange that Record date for the purpose of Interim Dividend for FY 2026-27 is 12-Nov-2026.",
        },
        {
          category: "bonus_split",
          subject: "Record Date for Bonus issue is November 20, 2026",
        },
        {
          category: "dividend",
          subject: "Record date for the purpose of Dividend is 30.10.2026",
        },
        { category: "results", subject: "Record date 01-Jan-2027" },
      ],
      parseLooseDate,
    );
    expect([...s].sort()).toEqual(["2026-10-30", "2026-11-12", "2026-11-20"]);
  });
});
