import { migrate } from "drizzle-orm/libsql/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { db, getDb } from "@/db/client";
import { announcements, companies, events, prices } from "@/db/schema";
import {
  buildBrief,
  firstFutureDate,
  parseLooseDate,
  renderBriefText,
  windowLabel,
} from "@/engine/analyse/brief";
import type { CardPayload } from "@/engine/ingest/announcements";
import { parseNseDateTime, tradingDaysBetween } from "@/lib/time";

const RIL = "INE002A01018";
const HDFC = "INE040A01034";
const H = 3_600_000;

function payload(over: Partial<CardPayload>): string {
  return JSON.stringify({
    version: 1,
    title: "t",
    oneLiner: "o",
    category: "results",
    tier: 1,
    priority: 80,
    fields: null,
    extraction: { by: "none", grounded: true, dropped: [] },
    primaryAnnouncementId: "nse:1",
    sources: [
      {
        url: "https://x/a.pdf",
        kind: "filing",
        label: "Filing",
        announcementId: "nse:1",
        filedAtMs: 0,
      },
    ],
    tags: ["Outcome of Board Meeting"],
    cue: "desc:outcome",
    ...over,
  } satisfies CardPayload);
}

beforeAll(async () => {
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  await db.insert(companies).values([
    {
      isin: RIL,
      nseSymbol: "RELIANCE",
      name: "Reliance Industries Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    },
    {
      isin: HDFC,
      nseSymbol: "HDFCBANK",
      name: "HDFC Bank Limited",
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: false,
    },
  ]);
  // Fri 6 Nov 2026 filings
  const t = (s: string) => parseNseDateTime(s);
  const ann = [
    {
      id: "nse:1",
      isin: RIL,
      symbol: "RELIANCE",
      desc: "Outcome of Board Meeting",
      subject: "financial results",
      text: "",
      filedAt: t("06-Nov-2026 16:20:40"),
      filedAtIst: "06-Nov-2026 16:20:40",
      category: "results",
      subcategory: "outcome",
      priority: 80,
      tier: 1,
      eventKey: `${RIL}|results|2026-11-06`,
      rawJson: "{}",
    },
    {
      id: "nse:2",
      isin: RIL,
      symbol: "RELIANCE",
      desc: "Investor Presentation",
      subject: "Investor Presentation",
      text: "",
      filedAt: t("06-Nov-2026 16:40:00"),
      filedAtIst: "06-Nov-2026 16:40:00",
      category: "results",
      subcategory: "presentation",
      priority: 50,
      tier: 2,
      eventKey: `${RIL}|results|2026-11-06`,
      rawJson: "{}",
    },
    {
      id: "nse:3",
      isin: HDFC,
      symbol: "HDFCBANK",
      desc: "Change in Management",
      subject: "change in Management",
      text: "",
      filedAt: t("06-Nov-2026 15:21:56"),
      filedAtIst: "06-Nov-2026 15:21:56",
      category: "management_change",
      subcategory: "cxo",
      priority: 80,
      tier: 1,
      eventKey: `${HDFC}|management_change|2026-11-06`,
      rawJson: "{}",
    },
    {
      id: "nse:4",
      isin: HDFC,
      symbol: "HDFCBANK",
      desc: "Shareholders meeting",
      subject: "Srutinizers report of Postal Ballot",
      text: "",
      filedAt: t("06-Nov-2026 22:27:43"),
      filedAtIst: "06-Nov-2026 22:27:43",
      category: "postal_ballot",
      subcategory: "results",
      priority: 20,
      tier: 3,
      eventKey: `${HDFC}|postal_ballot|2026-11-06`,
      rawJson: "{}",
    },
    {
      id: "nse:5",
      isin: RIL,
      symbol: "RELIANCE",
      desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
      subject:
        "Institutional Investors' Meeting - CLSA India Forum on November 16, 2026",
      text: "",
      filedAt: t("06-Nov-2026 19:10:58"),
      filedAtIst: "06-Nov-2026 19:10:58",
      category: "investor_meetings",
      subcategory: null,
      priority: 10,
      tier: 3,
      eventKey: `${RIL}|investor_meetings|2026-11-06`,
      rawJson: "{}",
    },
    // older results event whose transcript lands inside the window
    {
      id: "nse:6",
      isin: HDFC,
      symbol: "HDFCBANK",
      desc: "Outcome of Board Meeting",
      subject: "financial results",
      text: "",
      filedAt: t("17-Oct-2026 13:56:22"),
      filedAtIst: "17-Oct-2026 13:56:22",
      category: "results",
      subcategory: "outcome",
      priority: 80,
      tier: 1,
      eventKey: `${HDFC}|results|2026-10-17`,
      rawJson: "{}",
    },
    {
      id: "nse:7",
      isin: HDFC,
      symbol: "HDFCBANK",
      desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
      subject: "Transcript",
      text: "",
      filedAt: t("06-Nov-2026 10:00:00"),
      filedAtIst: "06-Nov-2026 10:00:00",
      category: "earnings_call",
      subcategory: "transcript",
      priority: 50,
      tier: 2,
      eventKey: `${HDFC}|results|2026-10-17`,
      rawJson: "{}",
    },
    // upcoming board meeting intimation
    {
      id: "nse:8",
      isin: RIL,
      symbol: "RELIANCE",
      desc: "Updates",
      subject:
        "Board meeting to be held on 13-Nov-2026 to consider and approve the financial results",
      text: "",
      filedAt: t("05-Nov-2026 18:00:00"),
      filedAtIst: "05-Nov-2026 18:00:00",
      category: "results",
      subcategory: "bm_intimation",
      priority: 20,
      tier: 3,
      eventKey: `${RIL}|results|2026-11-05`,
      rawJson: "{}",
    },
  ];
  await db.insert(announcements).values(ann);
  await db.insert(events).values([
    {
      eventKey: `${RIL}|results|2026-11-06`,
      isin: RIL,
      category: "results",
      firstAt: t("06-Nov-2026 16:20:40"),
      lastAt: t("06-Nov-2026 16:40:00"),
      tier: 1,
      cardType: "results",
      cardJson: payload({
        title: "Q2 FY27 results filed",
        oneLiner: "Reliance filed Q2 results.",
        category: "results",
      }),
      announcementIdsJson: JSON.stringify(["nse:1", "nse:2"]),
    },
    {
      eventKey: `${HDFC}|management_change|2026-11-06`,
      isin: HDFC,
      category: "management_change",
      firstAt: t("06-Nov-2026 15:21:56"),
      lastAt: t("06-Nov-2026 15:21:56"),
      tier: 1,
      cardType: "management_change",
      cardJson: payload({
        title: "New Chief Compliance Officer",
        oneLiner: "V. N. Srivatsan appointed CCO.",
        category: "management_change",
        primaryAnnouncementId: "nse:3",
      }),
      announcementIdsJson: JSON.stringify(["nse:3"]),
    },
    {
      eventKey: `${HDFC}|postal_ballot|2026-11-06`,
      isin: HDFC,
      category: "postal_ballot",
      firstAt: t("06-Nov-2026 22:27:43"),
      lastAt: t("06-Nov-2026 22:27:43"),
      tier: 3,
      cardType: "routine",
      cardJson: payload({
        title: "Postal ballot results",
        category: "postal_ballot",
        tier: 3,
        priority: 20,
      }),
      announcementIdsJson: JSON.stringify(["nse:4"]),
    },
    {
      eventKey: `${RIL}|investor_meetings|2026-11-06`,
      isin: RIL,
      category: "investor_meetings",
      firstAt: t("06-Nov-2026 19:10:58"),
      lastAt: t("06-Nov-2026 19:10:58"),
      tier: 3,
      cardType: "routine",
      cardJson: payload({
        title: "CLSA India Forum",
        category: "investor_meetings",
        tier: 3,
        priority: 10,
      }),
      announcementIdsJson: JSON.stringify(["nse:5"]),
    },
    {
      eventKey: `${HDFC}|results|2026-10-17`,
      isin: HDFC,
      category: "results",
      firstAt: t("17-Oct-2026 13:56:22"),
      lastAt: t("06-Nov-2026 10:00:00"),
      tier: 1,
      cardType: "results",
      cardJson: payload({
        title: "Q2 FY27 results filed",
        category: "results",
        primaryAnnouncementId: "nse:6",
      }),
      announcementIdsJson: JSON.stringify(["nse:6", "nse:7"]),
    },
    {
      eventKey: `${RIL}|results|2026-11-05`,
      isin: RIL,
      category: "results",
      firstAt: t("05-Nov-2026 18:00:00"),
      lastAt: t("05-Nov-2026 18:00:00"),
      tier: 3,
      cardType: "routine",
      cardJson: payload({
        title: "Board meeting for results",
        category: "results",
        tier: 3,
        priority: 20,
        primaryAnnouncementId: "nse:8",
      }),
      announcementIdsJson: JSON.stringify(["nse:8"]),
    },
  ]);
  // prices: flat RELIANCE then the real 2 Nov spike (+11.6 %, 5.8×), plus a tiny Muhurat bar
  const bars = [];
  let prev = 1164.9;
  for (const d of tradingDaysBetween("2026-09-15", "2026-11-08")) {
    const special = d === "2026-11-08";
    const spike = d === "2026-11-02";
    const close = spike ? 1300 : special ? prev * 1.003 : prev;
    bars.push({
      isin: RIL,
      date: d,
      open: prev,
      high: close,
      low: prev,
      close,
      prevClose: prev,
      volume: spike ? 88_121_121 : special ? 4_174_389 : 15_100_000,
      turnover: null,
      trades: null,
      sessionType: special ? "special" : "normal",
      source: "nse_bhav",
    });
    prev = close;
  }
  await db.insert(prices).values(bars);
});

describe("window helpers", () => {
  it("labels windows and parses loose dates", () => {
    expect(windowLabel(0, 24 * H)).toBe("Last 24 hours");
    expect(windowLabel(0, 7 * 24 * H)).toBe("Last 7 days");
    expect(parseLooseDate("13-Nov-2026")).toBe("2026-11-13");
    expect(parseLooseDate("November 13, 2026")).toBe("2026-11-13");
    expect(parseLooseDate("13th November, 2026")).toBe("2026-11-13");
    expect(parseLooseDate("30.10.2026")).toBe("2026-10-30");
    expect(parseLooseDate("nonsense")).toBeNull();
    expect(
      firstFutureDate(
        "Board meeting to be held on 13-Nov-2026 to consider results",
        "2026-11-08",
      ),
    ).toBe("2026-11-13");
    expect(firstFutureDate("held on 30-Oct-2026", "2026-11-08")).toBeNull();
  });
});

describe("buildBrief", () => {
  const isins = [RIL, HDFC];
  // window: Fri 6 Nov 09:00 IST → Sat 7 Nov 09:00 IST
  const from = parseNseDateTime("06-Nov-2026 09:00:00");
  const to = from + 24 * H;

  it("assembles tiers, counts, follow-ups and sources for a 24h window", async () => {
    const b = await buildBrief({ isins, fromMs: from, toMs: to });
    expect(b.window.label).toBe("Last 24 hours");
    expect(b.window.widened).toBeUndefined();
    expect(b.counts.filings).toBe(6); // nse:1,2,3,4,5,7 (nse:8 is 5 Nov, nse:6 is 17 Oct)
    expect(b.counts.events).toBe(5);
    expect(b.counts.needsYou).toBe(2);
    expect(b.counts.filedAway).toBe(2);
    expect(b.tier1.map((c) => c.symbol).sort()).toEqual([
      "HDFCBANK",
      "RELIANCE",
    ]);
    const ril = b.tier1.find((c) => c.symbol === "RELIANCE");
    expect(ril).toMatchObject({
      category: "results",
      title: "Q2 FY27 results filed",
      followUps: 1,
      companyName: "Reliance Industries Limited",
    });
    expect(ril?.filedAtIst).toBe("06 Nov 2026 16:20");
    expect(ril?.sources[0]).toEqual({
      url: "https://x/a.pdf",
      kind: "filing",
      label: "Filing",
    });
    // the older results event with a new transcript reads as a Tier-2 follow-up
    const follow = b.tier2.find(
      (c) => c.eventKey === `${HDFC}|results|2026-10-17`,
    );
    expect(follow).toBeDefined();
    expect(follow?.title).toBe("Earnings call transcript");
    expect(follow?.oneLiner).toMatch(
      /Follow-up to “Q2 FY27 results filed” \(first filed 17 Oct\)/,
    );
    expect(b.tier3.map((g) => g.category).sort()).toEqual([
      "investor_meetings",
      "postal_ballot",
    ]);
    expect(b.upcoming?.[0]).toMatchObject({
      symbol: "RELIANCE",
      what: "Board meeting — results",
      dateIst: "13 Nov 2026",
    });
    expect(b.quiet).toBeUndefined();
    const text = renderBriefText(b);
    expect(text).toContain("NEEDS YOU");
    expect(text).toContain("You're done.");
  });

  it("widens an empty window and says why (Muhurat-only day, plain weekend)", async () => {
    // Sun 8 Nov 08:00 → Mon 9 Nov 08:00 IST: only the Muhurat session closes inside → widen to 7 days
    const f = parseNseDateTime("08-Nov-2026 08:00:00");
    const b = await buildBrief({ isins, fromMs: f, toMs: f + 24 * H });
    expect(b.window.widened).toMatch(
      /^No filings in the last 24 hours \(Muhurat trading \(Diwali Laxmi Pujan\) only — no regular session\); showing the last 7 days\.$/,
    );
    expect(b.window.label).toBe("Last 7 days");
    expect(b.counts.events).toBeGreaterThan(0);
    const noWiden = await buildBrief({
      isins,
      fromMs: f,
      toMs: f + 24 * H,
      autoWiden: false,
    });
    expect(noWiden.counts.events).toBe(0);
    expect(noWiden.quiet?.reason).toMatch(/Muhurat/);
    // Sat 14 Nov 09:00 → Sun 15 Nov 09:00 IST: a plain weekend
    const w = parseNseDateTime("14-Nov-2026 09:00:00");
    const weekend = await buildBrief({
      isins,
      fromMs: w,
      toMs: w + 24 * H,
      autoWiden: false,
    });
    expect(weekend.quiet?.reason).toBe("Market closed — weekend");
    // Tue 10 Nov (Diwali-Balipratipada holiday)
    const h = parseNseDateTime("10-Nov-2026 06:00:00");
    const holiday = await buildBrief({
      isins,
      fromMs: h,
      toMs: h + 18 * H,
      autoWiden: false,
    });
    expect(holiday.quiet?.reason).toMatch(/Market closed — Diwali/);
  });

  it("reports EOD anomalies whose session close falls in the window, never the Muhurat bar", async () => {
    const f = parseNseDateTime("02-Nov-2026 09:00:00");
    const b = await buildBrief({
      isins,
      fromMs: f,
      toMs: f + 24 * H,
      thresholds: { volumeRatio: 2, pricePct: 5 },
    });
    const kinds = b.anomalies.map((a) => `${a.date}:${a.kind}`).sort();
    expect(kinds).toEqual(["2026-11-02:price_move", "2026-11-02:volume_ratio"]);
    const vol = b.anomalies.find((a) => a.kind === "volume_ratio");
    expect(vol?.value).toBeCloseTo(5.84, 1);
    const px = b.anomalies.find((a) => a.kind === "price_move");
    expect(px?.value).toBeCloseTo(11.6, 1);
    const muhurat = parseNseDateTime("08-Nov-2026 09:00:00");
    const m = await buildBrief({
      isins,
      fromMs: muhurat,
      toMs: muhurat + 24 * H,
      autoWiden: false,
    });
    expect(m.anomalies).toEqual([]);
    // thresholds are configurable
    const strict = await buildBrief({
      isins,
      fromMs: f,
      toMs: f + 24 * H,
      thresholds: { volumeRatio: 8, pricePct: 15 },
    });
    expect(strict.anomalies).toEqual([]);
  });

  it("handles an empty portfolio", async () => {
    const b = await buildBrief({ isins: [], fromMs: from, toMs: to });
    expect(b.counts).toEqual({
      filings: 0,
      events: 0,
      needsYou: 0,
      filedAway: 0,
    });
    expect(b.quiet?.reason).toMatch(/No companies/);
  });
});
