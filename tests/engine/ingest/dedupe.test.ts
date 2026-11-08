import { describe, expect, it } from "vitest";
import {
  eventKeyFor,
  findExactReposts,
  groupIntoEvents,
  isResultsFollowUp,
  normaliseSubject,
} from "@/engine/ingest/dedupe";
import type { AnnouncementRaw } from "@/engine/types";

function raw(over: Partial<AnnouncementRaw>): AnnouncementRaw {
  return {
    symbol: "RELIANCE",
    sm_name: "Reliance Industries Limited",
    sm_isin: "INE002A01018",
    smIndustry: null,
    desc: "Outcome of Board Meeting",
    attchmntText:
      "Reliance Industries Limited has submitted to the Exchange, the financial results for the period ended September 30, 2026.",
    attchmntFile:
      "https://nsearchives.nseindia.com/corporate/RELIANCE_30102026194011_Results.pdf",
    attFileSize: "8.41 MB",
    fileSize: "8.41 MB",
    hasXbrl: "Yes",
    an_dt: "30-Oct-2026 19:40:11",
    sort_date: "2026-10-30 19:40:11",
    exchdisstime: "30-Oct-2026 19:40:11",
    seq_id: "1",
    ...over,
  };
}

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 30, 14, 10, 11); // 30 Oct 2026 19:40:11 IST

describe("normaliseSubject / eventKeyFor", () => {
  it("strips the exchange boilerplate and punctuation", () => {
    expect(
      normaliseSubject(
        "Bajaj Finance Limited has informed the Exchange about Schedule of meet",
      ),
    ).toBe("schedule of meet");
    expect(
      normaliseSubject(
        "X has submitted to the Exchange, the Financial Results!",
      ),
    ).toBe("the financial results");
  });
  it("keys by isin | category | IST day of filing", () => {
    expect(eventKeyFor(raw({ an_dt: "30-Oct-2026 23:30:00" }), "results")).toBe(
      "INE002A01018|results|2026-10-30",
    );
    // 23:30 IST is 18:00 UTC — the IST day must win
    expect(eventKeyFor(raw({ an_dt: "31-Oct-2026 00:30:00" }), "results")).toBe(
      "INE002A01018|results|2026-10-31",
    );
  });
});

describe("findExactReposts (L0)", () => {
  it("flags the same PDF under the same subject category posted twice (RELIANCE 30 Oct)", () => {
    const a = raw({ seq_id: "106837394" });
    const b = raw({ seq_id: "106837395" });
    expect([...findExactReposts([a, b])]).toEqual(["106837395"]);
  });
  it("flags identical subject + identical size within 24h (BAJFINANCE schedule of meet)", () => {
    const a = raw({
      seq_id: "a",
      desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
      attchmntText:
        "Bajaj Finance Limited has informed the Exchange about Schedule of meet",
      attFileSize: "392.96 KB",
      attchmntFile: "https://x/a.pdf",
    });
    const b = raw({
      seq_id: "b",
      desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
      attchmntText:
        "Bajaj Finance Limited has informed the Exchange about Schedule of meet",
      attFileSize: "392.96 KB",
      attchmntFile: "https://x/b.pdf",
      an_dt: "30-Oct-2026 19:41:00",
    });
    expect([...findExactReposts([a, b])]).toEqual(["b"]);
  });
  it("does NOT flag the same boilerplate subject when sizes differ (BHARTIARTL orders passed) or > 24h apart", () => {
    const a = raw({
      seq_id: "a",
      desc: "Action(s) taken or orders passed",
      attchmntText:
        "Bharti Airtel Limited has informed the Exchange about Action(s) taken or orders passed",
      attFileSize: "290.13 KB",
      attchmntFile: "https://x/1.pdf",
    });
    const b = raw({
      seq_id: "b",
      desc: "Action(s) taken or orders passed",
      attchmntText:
        "Bharti Airtel Limited has informed the Exchange about Action(s) taken or orders passed",
      attFileSize: "289.68 KB",
      attchmntFile: "https://x/2.pdf",
      an_dt: "30-Oct-2026 22:40:24",
    });
    const c = raw({
      seq_id: "c",
      attFileSize: "8.41 MB",
      an_dt: "01-Nov-2026 19:40:11",
    });
    expect(findExactReposts([a, b, c]).size).toBe(0);
  });
  it("keeps the same PDF under DIFFERENT subject categories (KPIT omnibus: Appointment vs Acquisition)", () => {
    const url = "https://x/omnibus.pdf";
    const a = raw({
      seq_id: "a",
      desc: "Appointment",
      attchmntText: "Appointment of Independent Director",
      attchmntFile: url,
      attFileSize: "1.48 MB",
    });
    const b = raw({
      seq_id: "b",
      desc: "Acquisition",
      attchmntText: "Incorporation of a wholly owned subsidiary",
      attchmntFile: url,
      attFileSize: "1.48 MB",
    });
    expect(findExactReposts([a, b]).size).toBe(0);
  });
});

describe("groupIntoEvents (L1)", () => {
  const isin = "INE002A01018";
  it("groups same isin+category within 48h of the first filing; starts a new event after", () => {
    const g = groupIntoEvents([
      { id: "a", isin, category: "litigation", filedAt: t0 },
      { id: "b", isin, category: "litigation", filedAt: t0 + 30 * H },
      { id: "c", isin, category: "litigation", filedAt: t0 + 60 * H },
      { id: "d", isin, category: "litigation", filedAt: t0 + 70 * H },
    ]);
    expect(g.map((e) => e.ids)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(g[0]?.eventKey).toBe("INE002A01018|litigation|2026-10-30");
    expect(g[1]?.eventKey).toBe("INE002A01018|litigation|2026-11-02");
  });
  it("folds results follow-ups (deck, press release, newspaper, transcript) into the results event within 10 days", () => {
    const g = groupIntoEvents([
      {
        id: "res",
        isin,
        category: "results",
        subcategory: "outcome",
        filedAt: t0,
      },
      {
        id: "deck",
        isin,
        category: "results",
        subcategory: "presentation",
        filedAt: t0 + 1 * H,
      },
      {
        id: "pr",
        isin,
        category: "results",
        subcategory: "press_release",
        filedAt: t0 + 2 * H,
      },
      {
        id: "news",
        isin,
        category: "results",
        subcategory: "newspaper",
        filedAt: t0 + 20 * H,
      },
      {
        id: "rec",
        isin,
        category: "earnings_call",
        subcategory: "recording",
        filedAt: t0 + 22 * H,
      },
      {
        id: "tx",
        isin,
        category: "earnings_call",
        subcategory: "transcript",
        filedAt: t0 + 5 * 24 * H,
      },
      {
        id: "late",
        isin,
        category: "earnings_call",
        subcategory: "schedule",
        filedAt: t0 + 20 * 24 * H,
      },
    ]);
    const res = g.find((e) => e.category === "results");
    expect(res?.ids).toEqual(["res", "deck", "pr", "news", "rec", "tx"]);
    expect(res?.lastAt).toBe(t0 + 5 * 24 * H);
    expect(g.find((e) => e.ids.includes("late"))?.category).toBe(
      "earnings_call",
    );
  });
  it("a transcript with no results event nearby forms its own earnings_call event", () => {
    const g = groupIntoEvents([
      {
        id: "tx",
        isin,
        category: "earnings_call",
        subcategory: "transcript",
        filedAt: t0,
      },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]?.eventKey).toBe("INE002A01018|earnings_call|2026-10-30");
  });
  it("re-uses an existing (stored) event key for incremental runs", () => {
    const g = groupIntoEvents(
      [{ id: "new", isin, category: "m_and_a", filedAt: t0 + 10 * H }],
      [
        {
          eventKey: "INE002A01018|m_and_a|2026-10-30",
          isin,
          category: "m_and_a",
          firstAt: t0,
          lastAt: t0,
        },
      ],
    );
    expect(g).toEqual([
      {
        eventKey: "INE002A01018|m_and_a|2026-10-30",
        isin,
        category: "m_and_a",
        firstAt: t0,
        lastAt: t0 + 10 * H,
        ids: ["new"],
      },
    ]);
  });
  it("isResultsFollowUp", () => {
    expect(
      isResultsFollowUp({ category: "results", subcategory: "outcome" }),
    ).toBe(false);
    expect(
      isResultsFollowUp({ category: "results", subcategory: "presentation" }),
    ).toBe(true);
    expect(
      isResultsFollowUp({
        category: "earnings_call",
        subcategory: "transcript",
      }),
    ).toBe(true);
    expect(
      isResultsFollowUp({ category: "dividend", subcategory: "record_date" }),
    ).toBe(false);
  });
});
