import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectUnit,
  extractDates,
  linesFromItems,
  numericTokens,
  parseIndianNumber,
  parseStatements,
  pdfTolerance,
  verifyStatements,
} from "@/engine/extract/results-pdf";

const FIX = join(process.cwd(), "tests", "fixtures", "results");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const cr = (v: number | null | undefined) =>
  v == null ? null : Math.round(v / 1e5) / 100;

describe("parseIndianNumber (OCR tolerant)", () => {
  it("parses Indian and western grouping, decimals, negatives", () => {
    expect(parseIndianNumber("3,32,861")).toBe(332861);
    expect(parseIndianNumber("332,861")).toBe(332861);
    expect(parseIndianNumber("1,23,456.78")).toBe(123456.78);
    expect(parseIndianNumber("(17,539)")).toBe(-17539);
    expect(parseIndianNumber("-12.5")).toBe(-12.5);
    expect(parseIndianNumber("18.88")).toBe(18.88);
    expect(parseIndianNumber("19.96%")).toBe(19.96);
  });
  it("repairs OCR artefacts only inside numeric tokens", () => {
    expect(parseIndianNumber("2O7OO.O3")).toBe(20700.03);
    expect(parseIndianNumber("1O586.63")).toBe(10586.63);
    expect(parseIndianNumber("{8,421)")).toBe(-8421);
    expect(parseIndianNumber("[20)")).toBe(-20);
    expect(parseIndianNumber("79362,78")).toBe(79362.78); // OCR decimal comma
    expect(parseIndianNumber("11.102.55")).toBe(11102.55); // thousands dots
    expect(parseIndianNumber("4,2so.n")).toBeNull(); // too damaged → null, never a guess
  });
  it("treats dashes/Nil as zero and rejects label fragments", () => {
    expect(parseIndianNumber("-")).toBe(0);
    expect(parseIndianNumber("Nil")).toBe(0);
    expect(parseIndianNumber("7)")).toBeNull(); // "(Refer note 7)" tail
    expect(parseIndianNumber("Revenue")).toBeNull();
    expect(parseIndianNumber("(a)")).toBeNull();
    expect(parseIndianNumber("")).toBeNull();
  });
  it("numericTokens splits values glued to label fragments", () => {
    expect(numericTokens("300 195Ventures 215")).toEqual([300, 195, 215]);
    expect(numericTokens("- - 12.5 (3.2)")).toEqual([0, 0, 12.5, -3.2]);
  });
});

describe("units and dates", () => {
  it("detectUnit never guesses", () => {
    expect(detectUnit("(₹ in crore, except per share data)")).toBe("crore");
    expect(detectUnit("Rs in Crores")).toBe("crore");
    expect(detectUnit("(₹ in Lakhs)")).toBe("lakh");
    expect(detectUnit("({ in Lacs)")).toBe("lakh");
    expect(detectUnit("~ in million")).toBe("million");
    expect(detectUnit("In crore")).toBe("crore");
    expect(detectUnit("Statement of results")).toBeNull();
  });
  it("extractDates handles dd.mm.yyyy, 30th Sep'26, September 30, 2026 and OCR zeros", () => {
    expect(extractDates("30.09.2026 30.06.2026 30.09.2025")).toEqual([
      "2026-09-30",
      "2026-06-30",
      "2025-09-30",
    ]);
    expect(extractDates("Quarter Ended 30th Sep'26 30th Jun'26")).toEqual([
      "2026-09-30",
      "2026-06-30",
    ]);
    expect(extractDates("HALF YEAR ENDED SEPTEMBER 30, 2026")).toEqual([
      "2026-09-30",
    ]);
    expect(extractDates("ENDED 30TH SEPTEMBER, 2026")).toEqual(["2026-09-30"]);
    expect(extractDates("3O.O9.2O26")).toEqual(["2026-09-30"]);
    expect(extractDates("39.09.2026")).toEqual([]); // impossible day → dropped
  });
  it("pdfTolerance is ±1.5 printed units", () => {
    expect(pdfTolerance(1e7)).toBe(1.5e7);
    expect(pdfTolerance(1e5)).toBe(1.5e5);
  });
});

describe("linesFromItems", () => {
  it("clusters positioned items into visual rows ordered left to right", () => {
    const lines = linesFromItems([
      { str: "Revenue from operations", x: 30, y: 500, fontSize: 9 },
      { str: "3361.27", x: 300, y: 500.8, fontSize: 9 },
      { str: "2717.66", x: 360, y: 499.4, fontSize: 9 },
      { str: "Other income", x: 30, y: 488, fontSize: 9 },
      { str: "8.69", x: 300, y: 488, fontSize: 9 },
      { str: " ", x: 100, y: 488, fontSize: 9 },
    ]);
    expect(lines).toEqual([
      "Revenue from operations 3361.27 2717.66",
      "Other income 8.69",
    ]);
  });
});

describe("statement parsing on real page text", () => {
  it("Supreme Industries consolidated page: 6 columns, crore, associates above PBT, every identity holds", () => {
    const { statements, reasons } = parseStatements(
      [read("SUPREMEIND_Q2FY27_consolidated_page5.txt")],
      {},
    );
    expect(reasons).toEqual([]);
    expect(statements).toHaveLength(1);
    const st = statements[0];
    expect(st).toMatchObject({
      basis: "consolidated",
      variant: "corporate",
      unit: "crore",
    });
    expect(st?.columns).toHaveLength(6);
    expect(st?.columnEnds.slice(0, 3)).toEqual([
      "2026-09-30",
      "2026-06-30",
      "2025-09-30",
    ]);
    const res = verifyStatements(
      statements,
      { isin: "INE195A01028", sourceUrl: "fixture" },
      "text",
    );
    expect(res.quarters).toHaveLength(1);
    expect(res.comparatives).toHaveLength(2);
    expect(res.confidence).toBe(1);
    const q = res.quarters[0];
    expect(q?.source).toBe("pdf");
    expect(cr(q?.revenue)).toBe(3361.27);
    expect(cr(q?.otherIncome)).toBe(8.69);
    expect(cr(q?.financeCosts)).toBe(3.09);
    expect(cr(q?.dna)).toBe(122.3);
    expect(cr(q?.pbeit)).toBe(314.31);
    expect(cr(q?.pbt)).toBe(343.91); // printed PBT includes the associate share
    expect(cr(q?.tax)).toBe(81.47);
    expect(cr(q?.pat)).toBe(262.44);
    expect(q?.checks.assocAbovePbt).toBe(true);
    expect(cr(q?.checks.assocShare)).toBe(29.6);
    expect(Object.values(q?.checks.identities ?? {}).every(Boolean)).toBe(true);
    expect(q?.checks.pdf).toMatchObject({
      unit: "crore",
      page: 1,
      method: "text",
      confidence: 1,
    });
    expect(res.comparatives.map((c) => [c.periodEnd, cr(c.pat)])).toEqual([
      ["2026-06-30", 280.72],
      ["2025-09-30", 164.74],
    ]);
  });

  it("HDFC Bank standalone page (OCR layer): bank rows, identity repair of two OCR'd digits, SEBI column order", () => {
    const { statements } = parseStatements(
      [read("HDFCBANK_Q2FY27_standalone_page2.txt")],
      {},
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      basis: "standalone",
      variant: "bank",
      unit: "crore",
    });
    expect(statements[0]?.warnings.some((w) => /header dates/.test(w))).toBe(
      true,
    );
    const res = verifyStatements(
      statements,
      { isin: "INE040A01034", sourceUrl: "fixture" },
      "text",
    );
    expect(res.quarters).toHaveLength(1);
    const q = res.quarters[0];
    // the text layer reads total income 97267.62 and PAT 19609.96; the statement's own arithmetic says 97257.62 / 19509.96 (= XBRL)
    expect(cr(q?.checks.income)).toBe(97257.62);
    expect(cr(q?.pat)).toBe(19509.96);
    expect(cr(q?.checks.nii)).toBe(34619.18);
    expect(cr(q?.checks.ppop)).toBe(29483.42);
    expect(cr(q?.pbt)).toBe(25909.8);
    expect(q?.checks.warnings.filter((w) => /repaired/.test(w))).toHaveLength(
      2,
    );
    expect(Object.values(q?.checks.identities ?? {}).every(Boolean)).toBe(true);
    expect(res.confidence).toBeLessThan(1);
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    // the preceding-quarter column had two OCR errors too and is repaired the same way; the year-ago column was clean
    expect(res.comparatives.map((c) => [c.periodEnd, cr(c.pat)])).toEqual([
      ["2026-06-30", 19059.72],
      ["2025-09-30", 18641.28],
    ]);
  });

  it("refuses pages without units and documents without a statement", () => {
    const noUnit = read("SUPREMEIND_Q2FY27_consolidated_page5.txt").replace(
      "Rs in Crores",
      "",
    );
    const r1 = parseStatements([noUnit], {});
    expect(r1.statements).toHaveLength(0);
    expect(r1.reasons[0]).toMatch(/units not found/);
    const r2 = parseStatements(
      ["Dear Sir, please find enclosed the outcome of the board meeting."],
      {},
    );
    expect(r2.statements).toHaveLength(0);
    expect(r2.reasons[0]).toMatch(/no page looks like/);
  });

  it("rejects a statement whose current-quarter identities cannot be repaired (never emits unverified numbers)", () => {
    const broken = read("SUPREMEIND_Q2FY27_consolidated_page5.txt")
      .replace("TOTAL INCOME 3369.96", "TOTAL INCOME 3469.96")
      .replace(
        "PROFIT BEFORE TAX [3+4] 343.91",
        "PROFIT BEFORE TAX [3+4] 443.91",
      )
      .replace("Profit for the period", "Profit for the period");
    const { statements } = parseStatements([broken], {});
    const res = verifyStatements(
      statements,
      { isin: "X", sourceUrl: "fixture" },
      "text",
    );
    // total income can be repaired (two identities confirm it); PBT 443.91 breaks PBEIT+assoc and PBT−tax=PAT at once
    expect(res.quarters.length).toBeLessThanOrEqual(1);
    if (res.quarters.length === 1) {
      expect(cr(res.quarters[0]?.pbt)).toBe(343.91);
      expect(
        res.quarters[0]?.checks.warnings.filter((w) => /repaired/.test(w))
          .length,
      ).toBeGreaterThan(0);
    } else {
      expect(res.reasons.some((r) => /identities failed/.test(r))).toBe(true);
    }
  });
});
