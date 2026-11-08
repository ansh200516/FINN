import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inferPeriodFromText,
  makePeriod,
  managementTurns,
  matchRoster,
  parseLongDate,
  parsePeriodLabel,
  parseTranscript,
  periodForQuarterEnd,
  periodForTranscriptDate,
  previousQuarter,
  previousYearPeriod,
  quarterEndsOf,
  splitSpeakerTurns,
} from "@/engine/extract/transcript";
import type { DocumentText } from "@/engine/types";

const FIX = join(process.cwd(), "tests", "fixtures", "docs");
function fixture(name: string): DocumentText {
  const raw = JSON.parse(
    readFileSync(join(FIX, `${name}.pages.json`), "utf8"),
  ) as DocumentText;
  return { docId: raw.docId, pages: raw.pages };
}

describe("fiscal periods", () => {
  it("parses the label variants used in transcripts", () => {
    expect(parsePeriodLabel("Q2FY27")?.label).toBe("Q2FY27");
    expect(parsePeriodLabel("Q2 FY27")?.label).toBe("Q2FY27");
    expect(parsePeriodLabel("Q2 FY 2027")?.label).toBe("Q2FY27");
    expect(parsePeriodLabel("Q2 FY '27")?.label).toBe("Q2FY27");
    expect(parsePeriodLabel("Q2FY2026-27")?.label).toBe("Q2FY27");
    expect(parsePeriodLabel("3QFY26")?.label).toBe("Q3FY26");
    expect(parsePeriodLabel("FY27")?.label).toBe("FY27");
    expect(parsePeriodLabel("FY 2026-27")?.label).toBe("FY27");
    expect(parsePeriodLabel("H2FY27")?.label).toBe("H2FY27");
    expect(parsePeriodLabel("1H FY27")?.label).toBe("H1FY27");
    expect(parsePeriodLabel("next year")).toBeNull();
  });
  it("computes period boundaries on the Indian fiscal year", () => {
    expect(makePeriod("quarter", 2027, 2)).toMatchObject({
      start: "2026-07-01",
      end: "2026-09-30",
    });
    expect(makePeriod("quarter", 2027, 4)).toMatchObject({
      start: "2027-01-01",
      end: "2027-03-31",
    });
    expect(makePeriod("half", 2027, 2)).toMatchObject({
      start: "2026-10-01",
      end: "2027-03-31",
    });
    expect(makePeriod("year", 2027, null)).toMatchObject({
      start: "2026-04-01",
      end: "2027-03-31",
    });
    expect(quarterEndsOf(makePeriod("year", 2027, null))).toEqual([
      "2026-06-30",
      "2026-09-30",
      "2026-12-31",
      "2027-03-31",
    ]);
    expect(previousYearPeriod(makePeriod("quarter", 2027, 2)).label).toBe(
      "Q2FY26",
    );
    expect(previousQuarter(makePeriod("quarter", 2027, 1)).label).toBe(
      "Q4FY26",
    );
  });
  it("maps dates to quarters", () => {
    expect(periodForQuarterEnd("2026-09-30")).toBe("Q2FY27");
    expect(periodForQuarterEnd("2026-03-31")).toBe("Q4FY26");
    // a transcript filed 31 Oct 2026 discusses the quarter ended 30 Sep 2026
    expect(periodForTranscriptDate(Date.UTC(2026, 9, 31, 11))).toBe("Q2FY27");
    expect(periodForTranscriptDate(Date.UTC(2026, 0, 28, 11))).toBe("Q3FY26");
    expect(periodForTranscriptDate(Date.UTC(2026, 4, 4, 11))).toBe("Q4FY26");
    expect(periodForTranscriptDate(Date.UTC(2026, 7, 3, 11))).toBe("Q1FY27");
  });
  it("reads the period off cover text", () => {
    expect(
      inferPeriodFromText(
        "The Supreme Industries Limited Q2 FY27 Earnings Conference Call",
      ),
    ).toBe("Q2FY27");
    expect(
      inferPeriodFromText("Laurus Labs 3Q FY’26 Earnings Conference Call"),
    ).toBe("Q3FY26");
    expect(
      inferPeriodFromText(
        "results for the quarter and half year ended 30th September 2026",
      ),
    ).toBe("Q2FY27");
    expect(inferPeriodFromText("Second Quarter Financial Results FY27")).toBe(
      "Q2FY27",
    );
    expect(inferPeriodFromText("nothing here")).toBeNull();
  });
  it("parses long dates", () => {
    expect(parseLongDate("October 26, 2026")).toBe("2026-10-26");
    expect(parseLongDate("held on Monday, the 26th October, 2026.")).toBe(
      "2026-10-26",
    );
    expect(parseLongDate("November 02, 2026")).toBe("2026-11-02");
  });
});

describe("parseTranscript — vendor layout A (Supreme Industries)", () => {
  const p = parseTranscript(fixture("supremeind-q2fy27"));
  it("finds the roster with roles and the host analyst", () => {
    const names = p.roster.map((r) => r.name);
    expect(names).toContain("M. P. Taparia");
    expect(names).toContain("P. C. Somani");
    expect(p.roster.find((r) => r.name === "Aasim")).toMatchObject({
      role: "analyst",
      host: true,
    });
    expect(p.roster.find((r) => r.name === "M. P. Taparia")?.role).toBe(
      "management",
    );
  });
  it("skips the cover letter, dates the call and labels the period", () => {
    expect(p.layout).toBe("inline");
    expect(p.bodyStartPage).toBe(3);
    expect(p.callDate).toBe("2026-10-26");
    expect(p.period).toBe("Q2FY27");
  });
  it("splits opening remarks from Q&A and keeps pages", () => {
    const opening = p.turns.filter((t) => t.section === "opening");
    expect(opening.map((t) => t.role)).toEqual([
      "moderator",
      "analyst",
      "management",
    ]);
    const firstQa = p.turns.find((t) => t.section === "qa");
    expect(firstQa?.role).toBe("moderator");
    expect(firstQa?.text).toMatch(/first question/i);
    expect(firstQa?.page).toBe(4);
    const taparia = p.turns.filter((t) => t.speaker === "M. P. Taparia");
    expect(taparia.length).toBeGreaterThan(5);
    expect(taparia.every((t) => t.role === "management")).toBe(true);
    expect(p.turns.filter((t) => t.role === "unknown")).toHaveLength(0);
  });
  it("exposes the contract shape", () => {
    const turns = splitSpeakerTurns(fixture("supremeind-q2fy27"));
    expect(turns[0]).toMatchObject({ speaker: "Moderator", page: 3 });
    expect(
      managementTurns(p).every((t) => t.text.split(/\s+/).length >= 8),
    ).toBe(true);
  });
});

describe("parseTranscript — name-on-its-own-line layout (Infosys)", () => {
  const p = parseTranscript(fixture("infy-q2fy27"));
  it("uses the CORPORATE PARTICIPANTS / JOURNALISTS / ANALYSTS lists", () => {
    expect(p.layout).toBe("line");
    expect(p.roster.find((r) => r.name === "Salil Parekh")?.role).toBe(
      "management",
    );
    expect(p.roster.find((r) => r.name === "Jayesh Sanghrajka")?.role).toBe(
      "management",
    );
    expect(p.roster.find((r) => r.name === "Meghna Sen")).toMatchObject({
      role: "analyst",
      firm: "CNBC-TV18",
    });
    // a media outlet never becomes a speaker
    expect(p.roster.find((r) => r.name === "ET Now")).toBeUndefined();
  });
  it("attributes turns to the right people across the two transcripts in one PDF", () => {
    const salil = p.turns.filter((t) => t.speaker === "Salil Parekh");
    expect(salil.length).toBeGreaterThanOrEqual(2);
    expect(salil.every((t) => t.role === "management")).toBe(true);
    const first = p.turns[0];
    expect(first).toMatchObject({
      speaker: "Rishi Basu",
      role: "management",
      page: 4,
    });
    expect(first?.text).toMatch(/good evening/i);
    expect(p.callDate).toBe("2026-10-23");
    expect(p.period).toBe("Q2FY27");
  });
});

describe("parseTranscript — roster-less analyst meet (KPIT Q4 FY26)", () => {
  const p = parseTranscript(fixture("kpittech-analyst-meet-q4fy26"));
  it("treats pre-Q&A speakers as management and introduced questioners as analysts", () => {
    expect(p.roster).toHaveLength(0);
    expect(p.turns[0]).toMatchObject({
      speaker: "Sunil Phansalkar",
      role: "management",
      section: "opening",
      page: 2,
    });
    const qa = p.turns.filter((t) => t.section === "qa");
    expect(qa.length).toBeGreaterThan(2);
    expect(qa.find((t) => t.speaker === "Chandramouli Muthiah")?.role).toBe(
      "analyst",
    );
    expect(qa.find((t) => t.speaker === "Kishor Patil")?.role).toBe(
      "management",
    );
  });
});

describe("parseTranscript — KPIT Q2 FY27", () => {
  const p = parseTranscript(fixture("kpittech-q2fy27"));
  it("resolves speaker variants against the roster", () => {
    expect(p.callDate).toBe("2026-10-28");
    expect(matchRoster("Kishor Patil", p.roster)?.role).toBe("management");
    expect(matchRoster("Mr. Patil", p.roster)?.name).toBe("Kishor Patil");
    expect(matchRoster("Rahul Jain", p.roster)).toMatchObject({
      role: "analyst",
      host: true,
    });
    expect(p.turns.find((t) => t.section === "qa")?.text).toMatch(
      /first question/i,
    );
  });
});

describe("fiscal-year tokens and period reconciliation (Bug 1)", () => {
  it("reads every FY spelling, including Reliance's 'Q2 FY2026 - 2027'", async () => {
    const { fyFromToken, resolveTranscriptPeriod } = await import(
      "@/engine/extract/transcript"
    );
    expect(fyFromToken("27")).toBe(2027);
    expect(fyFromToken("2027")).toBe(2027);
    expect(fyFromToken("2026-27")).toBe(2027);
    expect(fyFromToken("2026 - 2027")).toBe(2027);
    expect(fyFromToken("26-27")).toBe(2027);
    for (const t of [
      "Q2 FY27",
      "Q2FY27",
      "2Q FY27",
      "Q2 FY2026-27",
      "Q2 FY2026 - 2027",
      "Q2 F.Y. 2026-27",
    ])
      expect(parsePeriodLabel(t)?.label, t).toBe("Q2FY27");
    expect(parsePeriodLabel("FY 2026-27")?.label).toBe("FY27");
    expect(parsePeriodLabel("H1 FY27")?.label).toBe("H1FY27");
    expect(
      inferPeriodFromText(
        "RIL Q2 FY2026 - 2027 Media & Analyst Meet Transcript 30 October 2026",
      ),
    ).toBe("Q2FY27");
    expect(
      inferPeriodFromText("results for the quarter ended September 30, 2026"),
    ).toBe("Q2FY27");
    expect(inferPeriodFromText("H1 FY27 earnings call")).toBe("Q2FY27");
    // date-derived fallback and the one-FY-off rule
    expect(
      resolveTranscriptPeriod(null, Date.UTC(2026, 10, 1, 12)),
    ).toMatchObject({ period: "Q2FY27", source: "date" });
    expect(
      resolveTranscriptPeriod("Q2FY26", Date.UTC(2026, 10, 1, 12)),
    ).toMatchObject({ period: "Q2FY27", source: "date" });
    expect(
      resolveTranscriptPeriod("Q2FY26", Date.UTC(2026, 10, 1, 12)).warning,
    ).toMatch(/using the date/);
    expect(
      resolveTranscriptPeriod("Q2FY27", Date.UTC(2026, 10, 1, 12)),
    ).toMatchObject({ period: "Q2FY27", source: "text", warning: null });
    // a different quarter in the text is kept (late filing / non-results event)
    expect(
      resolveTranscriptPeriod("Q1FY27", Date.UTC(2026, 10, 1, 12)),
    ).toMatchObject({ period: "Q1FY27", source: "text" });
  });
  it("labels the Reliance Q2 FY27 transcript correctly from its cover", () => {
    const p = parseTranscript(fixture("reliance-q2fy27"));
    expect(p.period).toBe("Q2FY27");
    expect(p.callDate).toBe("2026-10-30");
  });
});

describe("parseTranscript — 'Name – Role' lines (Bharti Airtel) and bullet layout (Ola Electric)", () => {
  it("recognises the moderator and analysts from the role text and the roster without dashes", () => {
    const p = parseTranscript(fixture("bhartiartl-q1fy27"));
    expect(p.roster.map((r) => r.name)).toContain("Gopal Vittal");
    expect(p.roster.find((r) => r.name === "Gopal Vittal")?.role).toBe(
      "management",
    );
    expect(p.turns.find((t) => t.speaker === "Vaidehi Sharma")?.role).toBe(
      "moderator",
    );
    expect(p.turns.find((t) => t.speaker === "Gopal Vittal")?.role).toBe(
      "management",
    );
    expect(p.turns.find((t) => t.speaker === "Piyush Choudhary")?.role).toBe(
      "analyst",
    );
    expect(p.stats.management).toBeGreaterThan(3);
  });
  it("strips bullets and parses 'Mr. Name - Role:' labels", () => {
    const p = parseTranscript(fixture("olaelec-q4fy26"));
    expect(p.roster.map((r) => r.name)).toEqual(
      expect.arrayContaining(["Bhavish Aggarwal", "Deepak Rastogi"]),
    );
    expect(p.turns.find((t) => t.speaker === "Bhavish Aggarwal")?.role).toBe(
      "management",
    );
    expect(p.turns.find((t) => t.speaker === "Arvind Sharma")?.role).toBe(
      "analyst",
    );
    expect(p.turns.some((t) => t.speaker === "Moderator")).toBe(true);
    expect(
      p.turns.every(
        (t) => !t.text.startsWith("− ") && !t.text.startsWith("- "),
      ),
    ).toBe(true);
    expect(p.period).toBe("Q4FY26");
  });
});
