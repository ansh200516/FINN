import { describe, expect, it } from "vitest";
import {
  announcementsUrl,
  normaliseAnnouncement,
  parseAnnouncementsBody,
  parseFileSize,
  toNseApiDate,
} from "@/engine/sources/nse-announcements";
import {
  indexMaster,
  parseEquityMasterCsv,
  resolveSymbol,
} from "@/engine/sources/nse-master";
import { parseUpstoxBody, upstoxCandleUrl } from "@/engine/sources/upstox";

describe("nse-announcements", () => {
  it("formats dates the way the API wants (DD-MM-YYYY)", () => {
    expect(toNseApiDate("2026-11-08")).toBe("08-11-2026");
    expect(toNseApiDate("08-11-2026")).toBe("08-11-2026");
    expect(() => toNseApiDate("Nov 8")).toThrow();
    expect(
      announcementsUrl({ from: "2026-10-09", to: "2026-11-08" }, "RELIANCE"),
    ).toBe(
      "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=RELIANCE&from_date=09-10-2026&to_date=08-11-2026",
    );
    expect(announcementsUrl(undefined, "RELIANCE")).toBe(
      "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=RELIANCE",
    );
  });
  it("validates the body: must be a JSON array (empty 200s are legal, objects/HTML are not)", () => {
    expect(parseAnnouncementsBody("[]", "t")).toEqual([]);
    expect(() =>
      parseAnnouncementsBody("<html>Access Denied</html>", "t"),
    ).toThrow(/not JSON/);
    expect(() => parseAnnouncementsBody('{"data":[]}', "t")).toThrow(
      /not an array/,
    );
  });
  it("normalises records: boolean hasXbrl → Yes/No, drops rows without seq_id/symbol/an_dt", () => {
    const rec = normaliseAnnouncement({
      symbol: "RELIANCE",
      sm_isin: "INE002A01018",
      desc: "Credit Rating",
      attchmntText: "x",
      attchmntFile: "https://a/b.pdf",
      attFileSize: "1.2 MB",
      hasXbrl: true,
      an_dt: "04-Nov-2026 20:47:14",
      sort_date: "2026-11-04 20:47:14",
      seq_id: 106845760,
      voiceSummary: null,
    });
    expect(rec).toMatchObject({
      seq_id: "106845760",
      hasXbrl: "Yes",
      an_dt: "04-Nov-2026 20:47:14",
      sm_isin: "INE002A01018",
    });
    expect(normaliseAnnouncement({ symbol: "X" })).toBeNull();
    expect(normaliseAnnouncement(null)).toBeNull();
  });
  it("parses attachment sizes", () => {
    expect(parseFileSize("228.94 KB")).toBe(234435);
    expect(parseFileSize("1.2 MB")).toBe(1258291);
    expect(parseFileSize("0 Bytes")).toBe(0);
    expect(parseFileSize(null)).toBeNull();
    expect(parseFileSize("big")).toBeNull();
  });
});

describe("nse-master", () => {
  const csv = `SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
TMPV,Tata Motors Passenger Vehicles Limited,EQ,12-NOV-2025,2,1,INE155A01022,2
TMCV,Tata Motors Limited,EQ,12-NOV-2025,2,1,INE1TAE01010,2
ETERNAL,ETERNAL LIMITED,EQ,23-JUL-2021,1,1,INE758T01015,1
RAJESHEXPO,Rajesh Exports Limited,BZ,07-FEB-1995,1,1,INE343B01030,1
BAD,Broken Row,EQ,01-JAN-2000,1,1,NOTANISIN,1
`;
  it("parses headers with leading spaces and skips rows without a valid ISIN", () => {
    const rows = parseEquityMasterCsv(csv);
    expect(rows.map((r) => r.symbol)).toEqual([
      "TMPV",
      "TMCV",
      "ETERNAL",
      "RAJESHEXPO",
    ]);
    expect(rows[3]).toMatchObject({
      series: "BZ",
      isin: "INE343B01030",
      listingDate: "07-FEB-1995",
    });
  });
  it("resolves symbols, ISINs, old symbols (aliases) and name prefixes", () => {
    const idx = indexMaster(parseEquityMasterCsv(csv));
    expect(resolveSymbol(idx, "tmpv")?.isin).toBe("INE155A01022");
    expect(resolveSymbol(idx, "INE758T01015")?.symbol).toBe("ETERNAL");
    expect(resolveSymbol(idx, "ZOMATO")?.symbol).toBe("ETERNAL");
    expect(resolveSymbol(idx, "TATAMOTORS")?.symbol).toMatch(/^TM[PC]V$/);
    expect(resolveSymbol(idx, "Rajesh Exp")?.symbol).toBe("RAJESHEXPO");
    expect(resolveSymbol(idx, "NOPE")).toBeNull();
  });
});

describe("upstox", () => {
  it("builds the v3 URL and parses candles newest-first into ascending bars with prevClose", () => {
    expect(upstoxCandleUrl("INE002A01018", "2026-10-01", "2026-11-08")).toBe(
      "https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE002A01018/days/1/2026-11-08/2026-10-01",
    );
    const body = JSON.stringify({
      status: "success",
      data: {
        candles: [
          [
            "2026-11-06T00:00:00+05:30",
            1314.1,
            1324.9,
            1310,
            1320,
            22768301,
            0,
          ],
          ["2026-11-05T00:00:00+05:30", 1300, 1316, 1298, 1313.5, 20000000, 0],
        ],
      },
    });
    const bars = parseUpstoxBody(body, "INE002A01018", (d) =>
      d === "2026-11-08" ? "special" : "normal",
    );
    expect(bars.map((b) => b.date)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(bars[1]).toMatchObject({
      close: 1320,
      prevClose: 1313.5,
      volume: 22768301,
      sessionType: "normal",
    });
    expect(() =>
      parseUpstoxBody('{"status":"error"}', "X", () => "normal"),
    ).toThrow();
  });
});
