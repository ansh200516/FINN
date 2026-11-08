import { describe, expect, it } from "vitest";
import { bseQuarterId, compareWithBse } from "@/engine/sources/bse-results";
import {
  auditedFromLabel,
  basisFromLabel,
  type IntegratedFilingRaw,
  isFinancialResultsRow,
  type LegacyResultRaw,
  normaliseIntegratedRows,
  normaliseLegacyRows,
  taxonomyFromUrl,
  xbrlCachePath,
} from "@/engine/sources/nse-results";
import type { ResultsQuarter } from "@/engine/types";

const row = (over: Partial<IntegratedFilingRaw>): IntegratedFilingRaw => ({
  symbol: "RELIANCE",
  cmName: "Reliance Industries Limited",
  qe_Date: "30-SEP-2026",
  consolidated: "Consolidated",
  audited: "Un-Audited",
  broadcast_Date: "30-Oct-2026 21:32:55",
  type: "Integrated Filing- Financials",
  type_Sub: "Original",
  xbrl: "https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1750537_30102026093254_WEB.xml",
  ixbrl: "https://nsearchives.nseindia.com/corporate/ixbrl/x.html",
  pdf_attach: "https://nsearchives.nseindia.com/corporate/null",
  seq_Id: "207709",
  revised_Date: null,
  revision_Remark: null,
  ...over,
});

describe("nse-results normalisers", () => {
  it("taxonomyFromUrl recognises the integrated and legacy file-name tokens", () => {
    expect(taxonomyFromUrl("…/INTEGRATED_FILING_INDAS_1_WEB.xml")).toBe(
      "INDAS",
    );
    expect(taxonomyFromUrl("…/INTEGRATED_FILING_BANKING_1_WEB.xml")).toBe(
      "BANKING",
    );
    expect(taxonomyFromUrl("…/INTEGRATED_FILING_NBFC_INDAS_1_WEB.xml")).toBe(
      "NBFC",
    );
    expect(taxonomyFromUrl("…/INTEGRATED_FILING_NONINDAS_1_WEB.xml")).toBe(
      "NONINDAS",
    );
    expect(
      taxonomyFromUrl(
        "https://nsearchives.nseindia.com/corporate/xbrl/BANKING_117525_1359016.xml",
      ),
    ).toBe("BANKING");
    expect(
      taxonomyFromUrl("https://nsearchives.nseindia.com/corporate/xbrl/-"),
    ).toBe("UNKNOWN");
    expect(taxonomyFromUrl(null)).toBe("UNKNOWN");
  });

  it("basis/audited labels from both indexes", () => {
    expect(basisFromLabel("Consolidated")).toBe("consolidated");
    expect(basisFromLabel("Standalone")).toBe("standalone");
    expect(basisFromLabel("Non-Consolidated")).toBe("standalone");
    expect(basisFromLabel(null)).toBeNull();
    expect(auditedFromLabel("Un-Audited")).toBe(false);
    expect(auditedFromLabel("Unaudited")).toBe(false);
    expect(auditedFromLabel("Audited")).toBe(true);
    expect(auditedFromLabel("")).toBeNull();
  });

  it("keeps financial rows, drops governance rows and junk pdf links", () => {
    const rows = [
      row({}),
      row({
        type: "Integrated Filing- Governance",
        xbrl: "https://x/INTEGRATED_FILING_GOVERNANCE_1.xml",
      }),
      row({
        consolidated: "Standalone",
        xbrl: "https://x/INTEGRATED_FILING_INDAS_2_WEB.xml",
        seq_Id: "2",
      }),
    ];
    expect(isFinancialResultsRow(rows[1] as IntegratedFilingRaw)).toBe(false);
    const out = normaliseIntegratedRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      periodEnd: "2026-09-30",
      basis: "consolidated",
      audited: false,
      taxonomy: "INDAS",
      pdfUrl: null,
      index: "integrated",
      isRevision: false,
      filedAtIst: "30-Oct-2026 21:32:55",
    });
    expect(typeof out[0]?.filedAt).toBe("number");
  });

  it("dedupes revisions to the latest filing per quarter+basis and sorts newest first", () => {
    const out = normaliseIntegratedRows([
      row({
        broadcast_Date: "17-Jul-2026 19:50:03",
        qe_Date: "30-JUN-2026",
        seq_Id: "a",
      }),
      row({ seq_Id: "orig", broadcast_Date: "30-Oct-2026 21:32:55" }),
      row({
        seq_Id: "rev",
        type_Sub: "Revision",
        broadcast_Date: "02-Nov-2026 10:00:00",
        revised_Date: "02-Nov-2026",
      }),
    ]);
    expect(out.map((f) => f.periodEnd)).toEqual(["2026-09-30", "2026-06-30"]);
    expect(out[0]?.seqId).toBe("rev");
    expect(out[0]?.isRevision).toBe(true);
  });

  it("normalises legacy rows (Non-Consolidated, toDate, bare array)", () => {
    const legacy: LegacyResultRaw[] = [
      {
        symbol: "RELIANCE",
        toDate: "31-Dec-2024",
        consolidated: "Non-Consolidated",
        audited: "Un-Audited",
        broadCastDate: "16-Jan-2025 20:20:21",
        period: "Quarterly",
        xbrl: "https://nsearchives.nseindia.com/corporate/xbrl/INDAS_117298_1348254_16012025082021.xml",
        seqNumber: "1189823",
      },
      {
        symbol: "RELIANCE",
        toDate: "31-Mar-2024",
        consolidated: "Consolidated",
        audited: "Audited",
        period: "Annual",
        xbrl: "https://x/INDAS_1.xml",
      },
      {
        symbol: "RELIANCE",
        toDate: "30-Sep-2024",
        consolidated: "Consolidated",
        audited: "Un-Audited",
        period: "Quarterly",
        xbrl: null,
      },
    ];
    const out = normaliseLegacyRows(legacy);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      periodEnd: "2024-12-31",
      basis: "standalone",
      taxonomy: "INDAS",
      index: "legacy",
      audited: false,
    });
  });

  it("xbrlCachePath is stable and file-system safe", () => {
    expect(
      xbrlCachePath(
        "https://nsearchives.nseindia.com/corporate/xbrl/INTEGRATED_FILING_INDAS_1_WEB.xml",
        "/c",
      ),
    ).toBe("/c/INTEGRATED_FILING_INDAS_1_WEB.xml");
  });
});

describe("bse-results helpers", () => {
  it("bseQuarterId anchors on Sep-2026 = 131", () => {
    expect(bseQuarterId("2026-09-30")).toBe(131);
    expect(bseQuarterId("2026-06-30")).toBe(130);
    expect(bseQuarterId("2025-09-30")).toBe(127);
    expect(bseQuarterId("2026-12-31")).toBe(132);
    expect(bseQuarterId("2026-11-30")).toBeNull();
  });

  it("compareWithBse infers the ₹ million scale and compares lines", () => {
    const q = {
      revenue: 3328610000000,
      otherIncome: 57930000000,
      pbt: 386130000000,
      tax: 93630000000,
      pat: 295500000000,
      financeCosts: 84810000000,
      dna: 153150000000,
    } as unknown as ResultsQuarter;
    const cmp = compareWithBse(q, [
      { Description: "Revenue From Operations", Amount: "3,328,610" },
      { Description: "Other Income", Amount: "57,930" },
      { Description: "Profit before tax", Amount: "386,130" },
      { Description: "Tax Expense", Amount: "93,630" },
      { Description: "Net Profit", Amount: "295,600" },
    ]);
    expect(cmp.scale).toBe(1e6);
    expect(cmp.compared).toBe(5);
    expect(cmp.agreed).toBe(5); // 10 mn off on PAT is within 0.5 %
  });
});
