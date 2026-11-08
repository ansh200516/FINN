import { describe, expect, it } from "vitest";
import {
  buildPageMap,
  detectFolioOffset,
  isTocPage,
} from "@/engine/extract/sections";
import type { DocumentText } from "@/engine/types";

function page(
  page: number,
  lines: string[],
  folio?: number,
): { page: number; text: string } {
  return {
    page,
    text: [...lines, ...(folio !== undefined ? [String(folio)] : [])].join(
      "\n",
    ),
  };
}

/** a 40-page synthetic annual report with a 2-page cover (folio = page − 2) */
const AR: DocumentText = {
  docId: "ar1",
  pages: [
    page(1, ["Covering letter to the exchanges", "Sub: Annual Report 2025-26"]),
    page(2, ["Integrated Annual Report 2025-26", "Our company"]),
    page(
      3,
      [
        "Contents",
        ...Array.from(
          { length: 14 },
          (_, i) => `Section ${i} ........ ${4 + i * 2}`,
        ),
      ],
      1,
    ),
    page(
      4,
      ["Chairman's message", "Dear shareholders, the year was strong."],
      2,
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      page(5 + i, ["Corporate overview", `Narrative page ${i}.`], 3 + i),
    ),
    page(
      9,
      [
        "Management Discussion and Analysis",
        "Industry structure and developments",
        "The industry grew.",
      ],
      7,
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      page(10 + i, ["MD&A continued", `Segment commentary ${i}.`], 8 + i),
    ),
    page(
      13,
      ["Board's Report", "Dear Members, your directors present the report."],
      11,
    ),
    page(
      14,
      [
        "Board's report continued",
        "Related party transactions are at arm's length.",
      ],
      12,
    ),
    page(15, ["Report on Corporate Governance", "Board composition."], 13),
    page(
      16,
      [
        "Independent Auditor's Report",
        "To the Members of X Limited",
        "Report on the audit of the standalone financial statements",
        "Key Audit Matters",
      ],
      14,
    ),
    page(
      17,
      ["Balance Sheet as at March 31, 2026", "Standalone", "Assets 1,000"],
      15,
    ),
    page(
      18,
      [
        "Statement of Profit and Loss for the year ended March 31, 2026",
        "Revenue 500",
      ],
      16,
    ),
    page(
      19,
      ["Cash Flow Statement for the year ended March 31, 2026", "Operating 80"],
      17,
    ),
    page(
      20,
      [
        "Notes forming part of the standalone financial statements",
        "Note 1 Corporate information",
      ],
      18,
    ),
    page(
      21,
      ["Notes continued", "Note 18 Borrowings", "Term loans from banks"],
      19,
    ),
    page(
      22,
      [
        "Notes continued",
        "Note 35 Contingent liabilities and commitments",
        "Disputed tax 12",
      ],
      20,
    ),
    page(
      23,
      [
        "Independent Auditor's Report",
        "Report on the audit of the consolidated financial statements",
      ],
      21,
    ),
    page(
      24,
      ["Consolidated Balance Sheet as at March 31, 2026", "Assets 1,200"],
      22,
    ),
    page(25, ["Consolidated Statement of Profit and Loss", "Revenue 600"], 23),
    page(26, ["Consolidated Statement of Cash Flows", "Operating 90"], 24),
    page(
      27,
      [
        "Notes to the consolidated financial statements",
        "Note 1 Group information",
      ],
      25,
    ),
    page(28, ["Notes continued", "Note 20 Borrowings", "Term loans"], 26),
    page(
      29,
      ["Notes continued", "Note 38 Contingent liabilities", "Guarantees 5"],
      27,
    ),
    page(
      30,
      [
        "Notes continued",
        "Note 40 Related party transactions",
        "Key management personnel",
      ],
      28,
    ),
    page(
      31,
      [
        "Notes continued",
        "Note 42 Segment information",
        "Two reportable segments",
      ],
      29,
    ),
    page(
      32,
      ["Notice of the 83rd Annual General Meeting", "Notice is hereby given"],
      30,
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      page(33 + i, ["AGM notice continued", `Resolution ${i}.`], 31 + i),
    ),
  ],
};

describe("annual-report page map", () => {
  const map = buildPageMap(AR);
  it("detects the contents page and the printed-folio offset", () => {
    expect(isTocPage(AR.pages[2]?.text ?? "", AR.pages.length)).toBe(true);
    expect(map.tocPages).toEqual([3]);
    expect(map.folioOffset).toBe(-2);
  });
  it("finds statutory sections and both financial-statement sets as page ranges", () => {
    const by = Object.fromEntries(map.sections.map((s) => [s.label, s]));
    expect(by.mdna).toMatchObject({ fromPage: 9, toPage: 12 });
    expect(by.directors_report).toMatchObject({ fromPage: 13, toPage: 14 });
    expect(by.corporate_governance).toMatchObject({ fromPage: 15, toPage: 15 });
    expect(by.auditors_report_standalone).toMatchObject({
      fromPage: 16,
      toPage: 16,
    });
    expect(by.balance_sheet_standalone).toMatchObject({ fromPage: 17 });
    expect(by.pnl_standalone).toMatchObject({ fromPage: 18 });
    expect(by.cash_flow_standalone).toMatchObject({ fromPage: 19 });
    expect(by.notes_standalone).toMatchObject({ fromPage: 20, toPage: 22 });
    expect(by.auditors_report_consolidated).toMatchObject({ fromPage: 23 });
    expect(by.balance_sheet_consolidated).toMatchObject({ fromPage: 24 });
    expect(by.pnl_consolidated).toMatchObject({ fromPage: 25 });
    expect(by.cash_flow_consolidated).toMatchObject({ fromPage: 26 });
    expect(by.notes_consolidated).toMatchObject({ fromPage: 27, toPage: 31 });
    expect(by.agm_notice).toMatchObject({ fromPage: 32, toPage: 40 });
    expect(by.corporate_overview).toMatchObject({
      fromPage: 1,
      toPage: 8,
      method: "inferred",
    });
    expect(
      map.sections.every((s) => s.confidence > 0 && s.confidence <= 1),
    ).toBe(true);
  });
  it("records note anchors (related party, contingent liabilities, borrowings, segment)", () => {
    expect(map.anchors.related_party).toEqual([14, 30]);
    expect(map.anchors.contingent_liabilities).toEqual([22, 29]);
    expect(map.anchors.borrowings).toEqual([21, 28]);
    expect(map.anchors.segment).toEqual([31]);
    expect(map.anchors.key_audit_matters).toEqual([16]);
  });
  it("returns no folio offset when pages are not numbered", () => {
    expect(
      detectFolioOffset({
        docId: "x",
        pages: [
          { page: 1, text: "hello" },
          { page: 2, text: "world" },
        ],
      }),
    ).toBeNull();
  });
});
