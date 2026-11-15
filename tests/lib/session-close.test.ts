import { describe, expect, it } from "vitest";
import { chooseSessionClose, storedCoversSession } from "@/lib/sessionClose";

const older = {
  close: 262.75,
  prevClose: 265.1,
  date: "2026-09-30",
};
const later = {
  close: 285,
  prevClose: 284.05,
  date: "2026-11-13",
};

describe("latest session close", () => {
  it("keeps the later bar and does not fall back to an older one", () => {
    expect(chooseSessionClose(older, later)).toEqual({
      print: later,
      source: "bhavcopy",
    });
    expect(chooseSessionClose(later, older)).toEqual({
      print: later,
      source: "stored",
    });
    expect(chooseSessionClose(later, null)?.print.date).toBe("2026-11-13");
    expect(chooseSessionClose(null, null)).toBeNull();
  });

  it("treats 30 Sep as current only when that session is the last close", () => {
    const monday = new Date("2026-11-16T02:59:00+05:30");
    expect(storedCoversSession("2026-11-13", monday)).toBe(true);
    expect(storedCoversSession("2026-09-30", monday)).toBe(false);
    expect(chooseSessionClose(older, null)?.print).toEqual(older);
  });
});
