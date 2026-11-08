import { describe, expect, it } from "vitest";
import {
  shouldFetchAttachment,
  tidyText,
  xmlToLines,
} from "@/engine/extract/attachment-text";
import {
  detectProfilePointer,
  educationFrom,
  findBriefProfile,
  pageAt,
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
