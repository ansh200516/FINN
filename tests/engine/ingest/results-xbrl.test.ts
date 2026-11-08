import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectVariant,
  fiscalQuarter,
  parseXbrlInstance,
  quarterFromXbrl,
  selectPeriods,
  shiftQuarterEnd,
  withinTolerance,
  xbrlIsin,
} from "@/engine/ingest/parse-xbrl";
import { parseXbrlResults } from "@/engine/ingest/results";

const FIX = join(process.cwd(), "tests", "fixtures", "results");
const read = (f: string) => readFileSync(join(FIX, f), "utf8");
const cr = (v: number | null | undefined) =>
  v == null ? null : Math.round(v / 1e5) / 100;

const RIL_URL =
  "https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1750537_30102026093254_WEB.xml";

describe("parseXbrlInstance", () => {
  it("reads contexts (scenario = dimensional) and flat facts from the SEBI taxonomy", () => {
    const inst = parseXbrlInstance(read("RELIANCE_Q2FY27_consolidated.xml"));
    expect(inst.namespacePrefix).toBe("in-capmkt");
    expect(inst.contexts.get("OneD")).toMatchObject({
      start: "2026-07-01",
      end: "2026-09-30",
      dimensional: false,
    });
    expect(inst.contexts.get("OneReportable1D")?.dimensional).toBe(true);
    expect(inst.contexts.get("OneI")?.instant).toBe("2026-09-30");
    const rev = inst.facts.find(
      (f) => f.name === "RevenueFromOperations" && f.contextRef === "OneD",
    );
    expect(rev?.value).toBe("3328610000000");
    expect(rev?.unitRef).toBe("INR");
  });

  it("selects the richest 3-month context as the quarter and the fiscal YTD as ytd", () => {
    const inst = parseXbrlInstance(read("RELIANCE_Q2FY27_consolidated.xml"));
    const p = selectPeriods(inst);
    expect(p.quarter?.contextId).toBe("OneD");
    expect(p.quarter?.days).toBe(92);
    expect(p.ytd?.contextId).toBe("FourD");
    expect(p.ytd?.start).toBe("2026-04-01");
  });

  it("legacy BSE taxonomy: uses DateOfStart/EndOfReportingPeriod facts (the FourD context repeats the quarter's dates)", () => {
    const xml = read("BAJFINANCE_Q3FY25_legacy_consolidated.xml");
    const inst = parseXbrlInstance(xml);
    expect(inst.namespacePrefix).toBe("in-bse-fin");
    expect(inst.contexts.get("FourD")?.start).toBe("2024-10-01"); // mislabelled in the file
    const p = selectPeriods(inst);
    expect(p.quarter?.contextId).toBe("OneD");
    expect(p.ytd?.contextId).toBe("FourD");
    expect(p.ytd?.start).toBe("2024-04-01"); // corrected from the facts
    expect(p.ytd?.days).toBe(275);
  });

  it("throws on non-XBRL input", () => {
    expect(() =>
      parseXbrlInstance("<html><body>blocked</body></html>"),
    ).toThrow(/xbrl/);
  });
});

describe("quarterFromXbrl — INDAS (Reliance Q2 FY27 consolidated)", () => {
  const r = quarterFromXbrl(read("RELIANCE_Q2FY27_consolidated.xml"), {
    isin: "INE002A01018",
    sourceUrl: RIL_URL,
    taxonomy: "INDAS",
    filedAt: 1_793_000_000_000,
  });
  const q = r.quarter;

  it("maps the headline line items in absolute rupees (verified against the press release)", () => {
    expect(r.variant).toBe("corporate");
    expect(q.basis).toBe("consolidated");
    expect(q.audited).toBe(false);
    expect(q.periodEnd).toBe("2026-09-30");
    expect(cr(q.revenue)).toBe(332861);
    expect(cr(q.otherIncome)).toBe(5793);
    expect(cr(q.financeCosts)).toBe(8481);
    expect(cr(q.dna)).toBe(15315);
    expect(cr(q.pbeit)).toBe(38613);
    expect(q.exceptional).toBe(0);
    expect(cr(q.pbt)).toBe(38613);
    expect(cr(q.tax)).toBe(9363);
    expect(cr(q.patCont)).toBe(29250);
    expect(cr(q.pat)).toBe(29550);
    expect(q.eps).toBe(18.88);
    expect(q.source).toBe("xbrl");
    expect(q.sourceUrl).toBe(RIL_URL);
    expect(q.filedAt).toBe(1_793_000_000_000);
  });

  it("passes every identity and records the YTD (H1) figures and extras", () => {
    expect(Object.values(q.checks.identities ?? {}).every(Boolean)).toBe(true);
    expect(q.checks.identities).toMatchObject({
      income_eq_rev_plus_oi: true,
      pbeit_eq_income_minus_expenses: true,
      pbt_eq_pbeit_plus_exceptional: true,
      patcont_eq_pbt_minus_tax: true,
      pat_eq_patcont_plus_assoc_disc: true,
      pat_eq_owners_plus_nci: true,
    });
    expect(cr(q.checks.ytd?.revenue)).toBe(644711);
    expect(cr(q.checks.ytd?.pat)).toBe(52746);
    expect(q.checks.ytd?.start).toBe("2026-04-01");
    expect(cr(q.checks.patOwners)).toBe(25548);
    expect(cr(q.checks.assocShare)).toBe(300);
    expect(q.checks.taxonomy).toBe("INDAS");
    expect(q.checks.variant).toBe("corporate");
    expect(q.checks.reportingQuarter).toBe("Second quarter");
    expect(q.checks.faceValue).toBe(10);
    expect(q.checks.warnings.some((w) => /ISIN mismatch/.test(w))).toBe(false);
  });

  it("exposes the distinct quarter-context tags for discovery", () => {
    expect(r.tags).toContain("RevenueFromOperations");
    expect(r.tags).toContain("ProfitBeforeExceptionalItemsAndTax");
    expect(r.tags).toContain("DepreciationDepletionAndAmortisationExpense");
    expect(r.tags.length).toBeGreaterThan(60);
  });

  it("warns on an ISIN mismatch instead of failing", () => {
    const other = quarterFromXbrl(read("RELIANCE_Q2FY27_consolidated.xml"), {
      isin: "INE000000000",
      sourceUrl: RIL_URL,
    });
    expect(
      other.quarter.checks.warnings.some((w) => /ISIN mismatch/.test(w)),
    ).toBe(true);
  });

  it("parseXbrlResults contract wrapper infers source and taxonomy from the URL", () => {
    const viaContract = parseXbrlResults(
      read("RELIANCE_Q2FY27_consolidated.xml"),
      {
        isin: "INE002A01018",
        sourceUrl: RIL_URL,
      },
    );
    expect(viaContract.source).toBe("xbrl");
    expect(cr(viaContract.pat)).toBe(29550);
    const legacy = parseXbrlResults(
      read("BAJFINANCE_Q3FY25_legacy_consolidated.xml"),
      {
        isin: "INE296A01024",
        sourceUrl:
          "https://nsearchives.nseindia.com/corporate/xbrl/NBFC_INDAS_118072_1365160_29012025074915.xml",
      },
    );
    expect(legacy.source).toBe("legacy");
    expect(legacy.checks.variant).toBe("nbfc");
    expect(cr(legacy.revenue)).toBe(18035.11);
  });
});

describe("quarterFromXbrl — BANKING (HDFC Bank Q2 FY27 consolidated)", () => {
  const r = quarterFromXbrl(read("HDFCBANK_Q2FY27_consolidated.xml"), {
    isin: "INE040A01034",
    sourceUrl: "x/INTEGRATED_FILING_BANKING_1740913.xml",
    taxonomy: "BANKING",
  });
  const q = r.quarter;

  it("maps the RBI format: interest earned / expended, PPOP, provisions, PBT, PAT", () => {
    expect(r.variant).toBe("bank");
    expect(cr(q.revenue)).toBe(95131.63); // interest earned
    expect(cr(q.otherIncome)).toBe(34227.06);
    expect(cr(q.financeCosts)).toBe(50667.43); // interest expended
    expect(q.dna).toBeNull();
    expect(cr(q.checks.nii)).toBe(44464.2);
    expect(cr(q.checks.ppop)).toBe(32871.54);
    expect(cr(q.checks.provisions)).toBe(4209);
    expect(cr(q.pbt)).toBe(27825.48);
    expect(cr(q.tax)).toBe(7125.45);
    expect(cr(q.pat)).toBe(20700.03);
    expect(q.eps).toBe(13.43);
    expect(Object.values(q.checks.identities ?? {}).every(Boolean)).toBe(true);
  });

  it("detects the minority-interest-as-exceptional quirk and keeps the pre-minority PBT", () => {
    expect(cr(q.exceptional)).toBe(-837.06);
    expect(q.checks.minorityAsExceptional).toBe(true);
    expect(cr(q.checks.pbtBeforeMinority)).toBe(28662.54);
    expect(cr(q.pbeit)).toBe(28662.54);
    expect(q.checks.warnings.some((w) => /minority interest/.test(w))).toBe(
      true,
    );
  });

  it("does not report GNPA at consolidated level (tagged 0 = not reported)", () => {
    expect(q.checks.gnpaPct).toBeUndefined();
  });
});

describe("quarterFromXbrl — NBFC (Bajaj Finance Q2 FY27 consolidated)", () => {
  const r = quarterFromXbrl(read("BAJFINANCE_Q2FY27_consolidated.xml"), {
    isin: "INE296A01032",
    sourceUrl: "x/INTEGRATED_FILING_NBFC_INDAS_1742040.xml",
    taxonomy: "NBFC",
  });
  const q = r.quarter;

  it("maps Ind AS NBFC items with NII and pre-provision operating profit", () => {
    expect(r.variant).toBe("nbfc");
    expect(cr(q.revenue)).toBe(24546.37);
    expect(cr(q.checks.interestIncome)).toBe(21936.39);
    expect(cr(q.financeCosts)).toBe(8601.73);
    expect(cr(q.checks.impairment)).toBe(2166.09);
    expect(cr(q.checks.nii)).toBe(13334.66);
    expect(cr(q.pbt)).toBe(8533.47);
    expect(cr(q.checks.ppop)).toBe(10699.56);
    expect(cr(q.pat)).toBe(6366.57);
    expect(q.eps).toBe(10.07);
    expect(Object.values(q.checks.identities ?? {}).every(Boolean)).toBe(true);
  });

  it("detectVariant falls back to the taxonomy hint", () => {
    const inst = parseXbrlInstance(read("BAJFINANCE_Q2FY27_consolidated.xml"));
    const p = selectPeriods(inst).quarter;
    expect(p && detectVariant(p, null)).toBe("nbfc");
  });
});

describe("helpers", () => {
  it("fiscalQuarter follows the Indian FY (Apr–Mar)", () => {
    expect(fiscalQuarter("2026-09-30").label).toBe("Q2 FY27");
    expect(fiscalQuarter("2026-06-30").label).toBe("Q1 FY27");
    expect(fiscalQuarter("2026-12-31").label).toBe("Q3 FY27");
    expect(fiscalQuarter("2026-03-31").label).toBe("Q4 FY26");
    expect(fiscalQuarter("2024-12-31")).toMatchObject({
      q: 3,
      fy: 2025,
      fyLabel: "FY25",
    });
  });

  it("shiftQuarterEnd steps across year boundaries and month lengths", () => {
    expect(shiftQuarterEnd("2026-09-30", -1)).toBe("2026-06-30");
    expect(shiftQuarterEnd("2026-09-30", -4)).toBe("2025-09-30");
    expect(shiftQuarterEnd("2026-03-31", -1)).toBe("2025-12-31");
    expect(shiftQuarterEnd("2025-12-31", 1)).toBe("2026-03-31");
    expect(shiftQuarterEnd("2026-06-30", -2)).toBe("2025-12-31");
  });

  it("withinTolerance uses 0.5 % with a ₹1 crore floor", () => {
    expect(withinTolerance(1e9, 1e9 + 9e6)).toBe(true); // 0.9 cr apart, under the floor
    expect(withinTolerance(1e9, 1e9 + 1.2e7)).toBe(false); // 1.2 cr apart on 100 cr (1.2 %)
    expect(withinTolerance(1e12, 1e12 + 4e9)).toBe(true); // 0.4 %
    expect(withinTolerance(1e12, 1e12 + 6e9)).toBe(false); // 0.6 %
  });

  it("xbrlIsin reads the ISIN fact (absent from some legacy instances)", () => {
    expect(xbrlIsin(read("RELIANCE_Q2FY27_consolidated.xml"))).toBe(
      "INE002A01018",
    );
    expect(xbrlIsin(read("HDFCBANK_Q2FY27_consolidated.xml"))).toBe(
      "INE040A01034",
    );
    expect(
      xbrlIsin(read("BAJFINANCE_Q3FY25_legacy_consolidated.xml")),
    ).toBeNull();
  });
});
