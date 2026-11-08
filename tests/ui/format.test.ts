import { describe, expect, it } from "vitest";
import {
  datelineLabel,
  deltaArrow,
  deltaSign,
  editionLabel,
  filedLabel,
  formatBp,
  formatCompactCount,
  formatCompactInr,
  formatCrore,
  formatInr,
  formatPct,
  formatRatio,
  groupIndian,
  MINUS,
  marketPhase,
  pctChange,
  quarterLabel,
  quarterMonths,
  readTime,
  relativeIst,
} from "@/lib/format";
import { parseNseDateTime } from "@/lib/time";

describe("Indian grouping", () => {
  it("groups the last three digits then pairs", () => {
    expect(groupIndian(123456)).toBe("1,23,456");
    expect(groupIndian(1234)).toBe("1,234");
    expect(groupIndian(999)).toBe("999");
    expect(groupIndian(123456789)).toBe("12,34,56,789");
    expect(groupIndian(332861)).toBe("3,32,861");
  });
  it("keeps decimals and uses a true minus", () => {
    expect(groupIndian(1234.5, 1)).toBe("1,234.5");
    expect(groupIndian(-150000, 0)).toBe(`${MINUS}1,50,000`);
  });
  it("formats rupees and crore", () => {
    expect(formatInr(123456)).toBe("₹ 1,23,456");
    expect(formatInr(null)).toBe("—");
    // RIL Q2 FY27 consolidated revenue, rupees → crore, unit said once in the header
    expect(formatCrore(3_32_861e7)).toBe("3,32,861");
    expect(formatCrore(8.69e7)).toBe("8.7");
    expect(formatCrore(null)).toBe("—");
  });
});

describe("compact rupees", () => {
  it("never over-rounds and picks the right unit", () => {
    expect(formatCompactInr(3_32_861e7)).toBe("₹ 3.33 L cr");
    expect(formatCompactInr(17_94_290e7)).toBe("₹ 17.9 L cr");
    expect(formatCompactInr(56_616e7)).toBe("₹ 56,616 cr");
    expect(formatCompactInr(8.69e7)).toBe("₹ 8.69 cr");
    expect(formatCompactInr(12_40_000)).toBe("₹ 12.4 L");
    expect(formatCompactInr(9_99_000)).toBe("₹ 9.99 L");
    expect(formatCompactInr(10_00_000)).toBe("₹ 10 L");
    expect(formatCompactInr(9500)).toBe("₹ 9,500");
    expect(formatCompactInr(-5e7)).toBe(`${MINUS}₹ 5 cr`);
  });
  it("compacts counts for volume chips", () => {
    expect(formatCompactCount(88_121_121)).toBe("8.81 cr");
    expect(formatCompactCount(22_768_301)).toBe("2.28 cr");
    expect(formatCompactCount(504_269)).toBe("5.04 L");
    expect(formatCompactCount(4500)).toBe("4,500");
  });
});

describe("signed deltas", () => {
  it("formats percent with a sign, one decimal and U+2212", () => {
    expect(formatPct(9.8)).toBe("+9.8%");
    expect(formatPct(-2.345)).toBe(`${MINUS}2.3%`);
    expect(formatPct(0)).toBe("0.0%");
    expect(formatPct(0.04)).toBe("0.0%");
    expect(formatPct(null)).toBe("—");
    expect(formatPct(28.57, { decimals: 0 })).toBe("+29%");
  });
  it("formats basis points and ratios", () => {
    expect(formatBp(150)).toBe("+150 bp");
    expect(formatBp(-49.6)).toBe(`${MINUS}50 bp`);
    expect(formatRatio(5.83)).toBe("5.8×");
    expect(formatRatio(17.28)).toBe("17×");
  });
  it("gives direction and arrows, grey below the epsilon", () => {
    expect(deltaSign(9.8)).toBe("up");
    expect(deltaSign(-0.2)).toBe("down");
    expect(deltaSign(0.02)).toBe("flat");
    expect(deltaSign(null)).toBe("none");
    expect(deltaArrow(5)).toBe("▲");
    expect(deltaArrow(-5)).toBe("▼");
    expect(deltaArrow(0)).toBe("");
  });
  it("computes percent change safely", () => {
    expect(pctChange(332861, 258898)).toBeCloseTo(28.57, 1);
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(null, 10)).toBeNull();
    expect(pctChange(50, -100)).toBe(150);
  });
});

describe("periods", () => {
  it("labels Indian fiscal quarters", () => {
    expect(quarterLabel("2026-09-30")).toBe("Q2 FY27");
    expect(quarterLabel("2026-03-31")).toBe("Q4 FY26");
    expect(quarterLabel("2025-12-31")).toBe("Q3 FY26");
    expect(quarterLabel("2026-06-30")).toBe("Q1 FY27");
    expect(quarterMonths("2026-09-30")).toBe("Jul–Sep 2026");
    expect(quarterMonths("2026-03-31")).toBe("Jan–Mar 2026");
  });
});

describe("IST filing labels", () => {
  const now = parseNseDateTime("08-Nov-2026 18:40:00");
  it("knows the phases of the trading day", () => {
    expect(marketPhase(parseNseDateTime("06-Nov-2026 18:42:00"))).toBe(
      "after close",
    );
    expect(marketPhase(parseNseDateTime("06-Nov-2026 09:12:00"))).toBe(
      "pre-open",
    );
    expect(marketPhase(parseNseDateTime("06-Nov-2026 11:00:00"))).toBe(
      "during trading",
    );
    expect(marketPhase(parseNseDateTime("10-Nov-2026 11:00:00"))).toBe(
      "market holiday",
    );
    expect(marketPhase(parseNseDateTime("07-Nov-2026 11:00:00"))).toBe(
      "weekend",
    );
    expect(marketPhase(parseNseDateTime("08-Nov-2026 14:30:00"))).toBe(
      "special session",
    );
    expect(marketPhase(parseNseDateTime("08-Nov-2026 18:40:00"))).toBe(
      "after close",
    );
  });
  it("writes 'filed 18:42 IST · after close'", () => {
    const f = filedLabel(parseNseDateTime("06-Nov-2026 18:42:00"), now);
    expect(f.short).toBe("filed 18:42 IST · after close");
    expect(f.day).toBe("Fri 6 Nov");
    expect(f.long).toBe("Fri 6 Nov · 18:42 IST · after close");
    expect(f.relative).toBe("Fri 6 Nov");
  });
  it("relative wording follows the IST calendar", () => {
    expect(relativeIst(parseNseDateTime("08-Nov-2026 17:20:00"), now)).toBe(
      "1 h ago",
    );
    expect(relativeIst(parseNseDateTime("08-Nov-2026 18:30:00"), now)).toBe(
      "10 min ago",
    );
    expect(relativeIst(parseNseDateTime("07-Nov-2026 18:10:00"), now)).toBe(
      "yesterday",
    );
    expect(relativeIst(parseNseDateTime("30-Oct-2026 19:42:00"), now)).toBe(
      "30 Oct",
    );
  });
  it("names the edition from the IST clock", () => {
    expect(editionLabel(now)).toBe("Evening edition · Sun 8 Nov");
    expect(editionLabel(parseNseDateTime("09-Nov-2026 08:30:00"))).toBe(
      "Morning edition · Mon 9 Nov",
    );
    expect(editionLabel(parseNseDateTime("09-Nov-2026 13:00:00"))).toBe(
      "Midday edition · Mon 9 Nov",
    );
    expect(datelineLabel(parseNseDateTime("10-Nov-2026 09:00:00"))).toBe(
      "Tuesday 10 November · market holiday · Diwali-Balipratipada",
    );
  });
  it("estimates reading time", () => {
    expect(readTime(3, 5)).toBe("~4 min");
    expect(readTime(0, 0)).toBe("~1 min");
  });
});
