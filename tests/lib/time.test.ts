import { describe, expect, it } from "vitest";
import {
  formatIst,
  isTradingDay,
  istDateKey,
  lastMarketClose,
  NSE_HOLIDAYS_2026,
  nextTradingDay,
  nonTradingReason,
  parseNseDate,
  parseNseDateTime,
  previousTradingDay,
  sessionCloseMs,
  sessionType,
  tradingDaysBetween,
  windowBounds,
} from "@/lib/time";

describe("parseNseDateTime", () => {
  it("parses NSE an_dt as IST", () => {
    // 08-Nov-2026 17:32:09 IST = 12:02:09 UTC
    expect(parseNseDateTime("08-Nov-2026 17:32:09")).toBe(
      Date.UTC(2026, 10, 8, 12, 2, 9),
    );
  });
  it("parses date-only and upper-case month forms", () => {
    expect(parseNseDateTime("30-SEP-2026")).toBe(
      Date.UTC(2026, 8, 29, 18, 30, 0),
    );
    expect(parseNseDate("30-SEP-2026")).toBe("2026-09-30");
  });
  it("parses sort_date ISO-like form", () => {
    expect(parseNseDateTime("2026-11-08 17:32:09")).toBe(
      Date.UTC(2026, 10, 8, 12, 2, 9),
    );
    expect(parseNseDate("2026-11-08 17:32:09")).toBe("2026-11-08");
  });
  it("throws on garbage", () => {
    expect(() => parseNseDateTime("yesterday")).toThrow();
  });
});

describe("istDateKey / formatIst", () => {
  it("rolls the IST day over at 18:30 UTC", () => {
    expect(istDateKey(Date.UTC(2026, 10, 8, 18, 29, 59))).toBe("2026-11-08");
    expect(istDateKey(Date.UTC(2026, 10, 8, 18, 30, 0))).toBe("2026-11-09");
    expect(formatIst(Date.UTC(2026, 10, 8, 12, 2, 9))).toBe(
      "08 Nov 2026 17:32",
    );
  });
});

describe("windowBounds", () => {
  it("is a half-open window ending at now", () => {
    const now = Date.UTC(2026, 10, 8, 12, 0, 0);
    const w = windowBounds(now, 24);
    expect(w.to).toBe(now);
    expect(w.from).toBe(now - 24 * 3_600_000);
    expect(w.fromIst).toBe("07 Nov 2026 17:30");
    expect(w.toIst).toBe("08 Nov 2026 17:30");
  });
});

describe("trading calendar 2026", () => {
  it("has the 15 holidays from NSE circular CMTR71775", () => {
    expect(Object.keys(NSE_HOLIDAYS_2026)).toHaveLength(15);
    expect(NSE_HOLIDAYS_2026["2026-11-10"]).toMatch(/Balipratipada/);
  });
  it("classifies days", () => {
    expect(sessionType("2026-11-08")).toBe("special"); // Muhurat, a Sunday
    expect(sessionType("2026-11-09")).toBe("normal");
    expect(sessionType("2026-11-10")).toBe("holiday");
    expect(sessionType("2026-11-14")).toBe("weekend");
    expect(sessionType("2026-12-25")).toBe("holiday");
  });
  it("isTradingDay includes special sessions and excludes holidays/weekends", () => {
    expect(isTradingDay("2026-11-08")).toBe(true);
    expect(isTradingDay("2026-11-10")).toBe(false);
    expect(isTradingDay("2026-11-15")).toBe(false);
    expect(isTradingDay("2026-11-11")).toBe(true);
  });
  it("walks to previous/next trading days across the Diwali holiday", () => {
    expect(previousTradingDay("2026-11-11")).toBe("2026-11-09");
    expect(nextTradingDay("2026-11-09")).toBe("2026-11-11");
    expect(previousTradingDay("2026-11-09")).toBe("2026-11-08"); // Muhurat counts
    expect(previousTradingDay("2026-11-08")).toBe("2026-11-06");
  });
  it("lists trading days in a range", () => {
    expect(tradingDaysBetween("2026-11-06", "2026-11-14")).toEqual([
      "2026-11-06",
      "2026-11-08",
      "2026-11-09",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]);
  });
  it("knows session close times", () => {
    expect(sessionCloseMs("2026-11-09")).toBe(Date.UTC(2026, 10, 9, 10, 0, 0)); // 15:30 IST
    expect(sessionCloseMs("2026-11-08")).toBe(Date.UTC(2026, 10, 8, 10, 0, 0)); // Muhurat ends 15:30 too
  });
  it("finds the last completed close", () => {
    // Tue 10 Nov 12:00 IST (holiday) → Mon 9 Nov close
    expect(lastMarketClose(Date.UTC(2026, 10, 10, 6, 30)).dateKey).toBe(
      "2026-11-09",
    );
    // Mon 9 Nov 12:00 IST (mid-session) → Sun 8 Nov Muhurat close
    expect(lastMarketClose(Date.UTC(2026, 10, 9, 6, 30)).dateKey).toBe(
      "2026-11-08",
    );
    // Mon 9 Nov 16:00 IST → today
    expect(lastMarketClose(Date.UTC(2026, 10, 9, 10, 30)).dateKey).toBe(
      "2026-11-09",
    );
  });
  it("explains non-trading days", () => {
    expect(nonTradingReason("2026-11-10")).toMatch(/Market closed/);
    expect(nonTradingReason("2026-11-15")).toBe("Market closed — weekend");
    expect(nonTradingReason("2026-11-09")).toBeNull();
  });
});
