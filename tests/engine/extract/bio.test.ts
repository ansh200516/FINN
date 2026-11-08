import { describe, expect, it } from "vitest";
import {
  shouldFetchAttachment,
  tidyText,
  xmlToLines,
} from "@/engine/extract/attachment-text";
import {
  dedupeLeadingName,
  detectProfilePointer,
  educationFrom,
  findBriefProfile,
  pageAt,
  splitAnnexurePeople,
  trimAtSentence,
  wordCount,
} from "@/engine/extract/bio";

const filing = `[[page 1]]
Sub: Intimation under Regulation 30 — Appointment of Chief Financial Officer
Details as required under SEBI Circular dated July 13, 2023:
1. Reason for change: Appointment
2. Date of appointment: January 1, 2027

[[page 2]]
Brief Profile:
Mr. Rajib Mukhopadhyay is a Chartered Accountant with over 28 years of experience in finance, treasury and corporate strategy. He was previously the Chief Financial Officer of Sutlej Textiles and Industries Limited and, before that, CFO of Indofil Industries. He holds a Bachelor of Commerce from Calcutta University and completed the Advanced Management Program at Harvard Business School.

Disclosure of relationships between directors: Not Applicable`;

describe("findBriefProfile", () => {
  it("locates the SEBI brief-profile paragraph, verbatim, with its page", () => {
    const c = findBriefProfile(filing);
    expect(c).toHaveLength(1);
    expect(
      c[0]?.excerpt.startsWith(
        "Mr. Rajib Mukhopadhyay is a Chartered Accountant",
      ),
    ).toBe(true);
    expect(c[0]?.excerpt.length).toBeGreaterThan(150);
    expect(c[0]?.page).toBe(2);
  });
  it("ignores 'Not Applicable' rows (resignations) and headings with no body", () => {
    expect(
      findBriefProfile(
        "Brief profile (in case of appointment): Not Applicable\n\nOther text",
      ),
    ).toEqual([]);
  });
});

describe("pointer / education / page helpers", () => {
  it("detects a pointer to an earlier filing", () => {
    expect(
      detectProfilePointer(
        "The brief profile of Mr. Leo Puri was disclosed vide our letter dated 7 September 2026 and is not repeated here.",
      ),
    ).toBe("7 September 2026");
    expect(detectProfilePointer(filing)).toBeNull();
  });
  it("extracts an education sentence from the excerpt", () => {
    const c = findBriefProfile(filing)[0];
    expect(educationFrom(c?.excerpt ?? "")).toMatch(
      /Chartered Accountant|Bachelor of Commerce from Calcutta University/,
    );
    expect(
      educationFrom(
        "He holds a Bachelor of Commerce from Calcutta University.",
      ),
    ).toMatch(/Bachelor of Commerce/);
    expect(educationFrom("He is a leader.")).toBeNull();
  });
  it("pageAt follows [[page N]] markers", () => {
    expect(pageAt("no markers here", 5)).toBeNull();
    expect(pageAt(filing, 0)).toBe(1);
    expect(pageAt(filing, filing.indexOf("Brief Profile"))).toBe(2);
  });
});

/** Voltas 6 Nov 2026 brief-profile annexure: two appointees, each name doubled at the start. */
const VOLTAS_ANNEXURE =
  "Mr. Jayant Balan Mr. Jayant Balan is a Mechanical Engineer and PGDM from SP Jain Institute of Management & Research. Mr. Balan joined the Tata Group in 1999 as part of the Tata Administrative Service and moved to Voltas in 2001. Over past two and a half decades, Mr. Balan has held leadership roles across manufacturing, supply chain, strategy, international operations, and consumer durables. Mr. Balan was serving as CEO of Voltbek Home Appliances Private Limited since 2019 before transitioning to the role of Head – Room Air Conditioner Business of the Company in January 2026. Mr. Venkatesalu Palaniswamy Mr. Venkatesalu Palaniswamy is a Commerce Graduate, Alumni of Harvard Business School (Advanced Management Program – AMP), Master’s in Management from Symbiosis (SIIB) Pune, CFA from the Institute of Chartered Financial Analysts of India (ICFAI). Mr. Venkatesalu Palaniswamy is the Managing Director of Trent Limited. Prior to that, he held the position of Executive Director and Chief Executive Officer of Trent. He joined Trent in 2008 and has been with the company for over 15 years and continues to pioneer Trent’s successful journey from strength to strength.";

const VOLTAS_CHANGES = [
  {
    person: "Mr. Noel N. Tata",
    role: "Chairman and Director",
    action: "retired",
    effective_date: "11th November, 2026",
  },
  {
    person: "Mr. Sunil Alaric D’Souza",
    role: "Chairman",
    action: "appointed",
    effective_date: "12th November, 2026",
  },
  {
    person: "Mr. Mukundan Menon C.P.",
    role: "Managing Director",
    action: "retired",
    effective_date: "24th May, 2027",
  },
  {
    person: "Mr. Jayant Balan",
    role: "Managing Director",
    action: "appointed",
    effective_date: "25th May, 2027",
    prior_roles: ["Head – Room Air Conditioner Business, Voltas"],
  },
  {
    person: "Mr. Venkatesalu Palaniswamy",
    role: "Director (Non-Independent Non-Executive)",
    action: "appointed",
    effective_date: "12th November, 2026",
    prior_roles: ["Managing Director, Trent Limited"],
  },
];

describe("splitAnnexurePeople", () => {
  it("splits the Voltas annexure on change-table names and strips the doubled heading", () => {
    const people = splitAnnexurePeople(VOLTAS_ANNEXURE, VOLTAS_CHANGES);
    expect(people.map((p) => p.name)).toEqual([
      "Mr. Jayant Balan",
      "Mr. Venkatesalu Palaniswamy",
    ]);
    expect(people[0]).toMatchObject({
      role: "Managing Director",
      action: "appointed",
      effectiveDate: "25th May, 2027",
      priorRoles: ["Head – Room Air Conditioner Business, Voltas"],
    });
    expect(people[1]).toMatchObject({
      role: "Director (Non-Independent Non-Executive)",
      action: "appointed",
      effectiveDate: "12th November, 2026",
    });
    expect(
      people[0]?.excerpt.startsWith("Mr. Jayant Balan is a Mechanical"),
    ).toBe(true);
    expect(
      people[0]?.excerpt.includes("Mr. Jayant Balan Mr. Jayant Balan"),
    ).toBe(false);
    expect(
      people[1]?.excerpt.startsWith(
        "Mr. Venkatesalu Palaniswamy is a Commerce",
      ),
    ).toBe(true);
    expect(people[1]?.excerpt.includes("Mr. Venkatesalu Palaniswamy Mr.")).toBe(
      false,
    );
    for (const p of people)
      expect(wordCount(p.excerpt)).toBeLessThanOrEqual(90);
    // a later "Mr. Balan" inside Jayant's paragraph is not its own person
    expect(people).toHaveLength(2);
  });

  it("keeps a single-person profile intact and trims at a sentence boundary", () => {
    const one =
      "Mr. Rajib Mukhopadhyay is a Chartered Accountant with over 28 years of experience in finance, treasury and corporate strategy.";
    const people = splitAnnexurePeople(one, [
      { person: "Mr. Rajib Mukhopadhyay", role: "CFO", action: "appointed" },
    ]);
    expect(people).toHaveLength(1);
    expect(people[0]?.excerpt).toBe(one);
    expect(
      dedupeLeadingName(`Mr. Jayant Balan Mr. Jayant Balan is a engineer.`),
    ).toBe("Mr. Jayant Balan is a engineer.");
    const long = Array.from(
      { length: 40 },
      (_, i) => `Sentence ${i} has several extra words in it.`,
    ).join(" ");
    const trimmed = trimAtSentence(long, 90);
    expect(wordCount(trimmed)).toBeLessThanOrEqual(90);
    expect(trimmed.endsWith(".")).toBe(true);
    expect(wordCount(long)).toBeGreaterThan(90);
  });
});

describe("attachment-text helpers", () => {
  it("xmlToLines flattens XBRL tags to 'Tag: value' lines", () => {
    const xml = `<xbrli:xbrl><in-capmkt:NameOfDesignatedPerson contextRef="c1">Angan Guha</in-capmkt:NameOfDesignatedPerson><in-capmkt:BriefProfile contextRef="c1">Group CFO at CKA Birla; CA 1989.</in-capmkt:BriefProfile><xbrli:context id="c1"><xbrli:identifier scheme="x">500</xbrli:identifier></xbrli:context></xbrli:xbrl>`;
    const lines = xmlToLines(xml);
    expect(lines).toContain("NameOfDesignatedPerson: Angan Guha");
    expect(lines).toContain("BriefProfile: Group CFO at CKA Birla; CA 1989.");
    expect(lines).not.toMatch(/identifier/);
  });
  it("tidyText collapses runs of spaces but keeps paragraphs", () => {
    expect(tidyText("a   b \n\n\n\n c\t d")).toBe("a b\n\nc d");
  });
  it("shouldFetchAttachment: Tier 1/2 material categories only; skips newspaper/ESOP/certificates/CP, oversize and huge results PDFs", () => {
    const url = "https://nsearchives.nseindia.com/corporate/x.pdf";
    expect(
      shouldFetchAttachment(
        { category: "management_change", subcategory: "cxo", tier: 1 },
        url,
        300_000,
      ),
    ).toBe(true);
    expect(
      shouldFetchAttachment(
        { category: "credit_rating", subcategory: undefined, tier: 2 },
        url,
        300_000,
      ),
    ).toBe(true);
    expect(
      shouldFetchAttachment(
        { category: "unclassified", subcategory: "newspaper", tier: 3 },
        url,
        300_000,
      ),
    ).toBe(false);
    expect(
      shouldFetchAttachment(
        { category: "results", subcategory: "newspaper", tier: 3 },
        url,
        300_000,
      ),
    ).toBe(false);
    expect(
      shouldFetchAttachment(
        { category: "fund_raise", subcategory: "cp", tier: 3 },
        url,
        300_000,
      ),
    ).toBe(false);
    expect(
      shouldFetchAttachment(
        { category: "investor_meetings", subcategory: undefined, tier: 3 },
        url,
        300_000,
      ),
    ).toBe(false);
    expect(
      shouldFetchAttachment(
        { category: "m_and_a", subcategory: undefined, tier: 1 },
        url,
        20 * 1024 * 1024,
      ),
    ).toBe(false);
    expect(
      shouldFetchAttachment(
        { category: "results", subcategory: "outcome", tier: 1 },
        url,
        18 * 1024 * 1024,
      ),
    ).toBe(false);
    expect(
      shouldFetchAttachment(
        { category: "results", subcategory: "outcome", tier: 1 },
        url,
        2 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(
      shouldFetchAttachment(
        { category: "m_and_a", subcategory: undefined, tier: 1 },
        null,
        1000,
      ),
    ).toBe(false);
  });
});
