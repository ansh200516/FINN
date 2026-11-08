import { describe, expect, it } from "vitest";
import {
  type AdjudicatedRow,
  adjudicateAll,
  compareBand,
  compareDirection,
  computeDelivered,
  ebitdaOp,
  type LedgerInput,
  metricFamily,
  quartersFor,
  summarise,
} from "@/engine/analyse/ledger";
import { makePeriod } from "@/engine/extract/transcript";
import type { ResultsQuarter } from "@/engine/types";

const CR = 1e7;

/** Supreme-Industries-like consolidated quarters (₹ crore → rupees). */
function q(
  periodEnd: string,
  rev: number,
  oi: number,
  fc: number,
  dna: number,
  pbeit: number,
  tax: number,
  pat: number,
  basis: ResultsQuarter["basis"] = "consolidated",
): ResultsQuarter {
  return {
    isin: "INE195A01028",
    periodEnd,
    basis,
    source: "xbrl",
    audited: false,
    revenue: rev * CR,
    otherIncome: oi * CR,
    financeCosts: fc * CR,
    dna: dna * CR,
    pbeit: pbeit * CR,
    exceptional: 0,
    pbt: pbeit * CR,
    tax: tax * CR,
    pat: pat * CR,
    patCont: pat * CR,
    eps: null,
    checks: { warnings: [] },
    sourceUrl: `https://nsearchives.nseindia.com/xbrl/${periodEnd}.xml`,
    filedAt: null,
  };
}

// FY25 (base year) and FY26 (guided year) + H1 FY27
const QUARTERS: ResultsQuarter[] = [
  q("2024-06-30", 2636, 21, 3, 86, 319, 84, 273),
  q("2024-09-30", 2273, 15, 3, 90, 242, 63, 207),
  q("2024-12-31", 2510, 9, 3, 91, 223, 58, 187),
  q("2025-03-31", 3027, 12, 3, 91, 334, 73, 294),
  q("2025-06-30", 2609, 17, 3, 93, 240, 63, 202),
  q("2025-09-30", 2394, 16, 6, 104, 203, 53, 165),
  q("2025-12-31", 2687, 4, 11, 110, 197, 53, 153),
  q("2026-03-31", 3528, 9, 9, 121, 501, 120, 434),
  q("2026-06-30", 2718, 9, 4, 122, 281, 73, 281),
  q("2026-09-30", 3361, 9, 3, 122, 314, 82, 262),
];
const FY26_REV = 2609 + 2394 + 2687 + 3528; // 11,218
const FY25_REV = 2636 + 2273 + 2510 + 3027; // 10,446  → +7.4% YoY
const FY26_EBITDA =
  240 +
  3 +
  93 -
  17 +
  (203 + 6 + 104 - 16) +
  (197 + 11 + 110 - 4) +
  (501 + 9 + 121 - 9); // 1,552 → 13.8% margin

const T_Q1FY26 = Date.UTC(2025, 6, 24);
const T_Q2FY26 = Date.UTC(2025, 9, 27);
const T_Q3FY26 = Date.UTC(2026, 0, 21);
const T_Q2FY27 = Date.UTC(2026, 9, 26);
const NOW = Date.UTC(2026, 10, 8);

function input(
  over: Partial<LedgerInput> & Pick<LedgerInput, "id" | "metric">,
): LedgerInput {
  return {
    isin: "INE195A01028",
    docId: "doc_q1fy26",
    speaker: "M. P. Taparia",
    role: "management",
    page: 3,
    quote: "we expect revenue growth of 10% to 12% for FY26",
    direction: "range",
    low: 10,
    high: 12,
    unit: "%",
    horizon: "FY26",
    horizonEnd: "2026-03-31",
    isExplicit: true,
    revision: "new",
    comparison: "yoy",
    statedAt: T_Q1FY26,
    statedPeriod: "Q1FY26",
    evidence: {},
    ...over,
  };
}
const TRANSCRIPTS = [
  { docId: "doc_q1fy26", period: "Q1FY26", publishedAt: T_Q1FY26 },
  { docId: "doc_q2fy26", period: "Q2FY26", publishedAt: T_Q2FY26 },
  { docId: "doc_q3fy26", period: "Q3FY26", publishedAt: T_Q3FY26 },
  { docId: "doc_q2fy27", period: "Q2FY27", publishedAt: T_Q2FY27 },
];

const byId = (rows: AdjudicatedRow[], id: string) =>
  rows.find((r) => r.id === id) as AdjudicatedRow;

describe("results math", () => {
  it("computes operating EBITDA ex other income and picks one basis for every quarter", () => {
    expect(ebitdaOp(QUARTERS[9] as ResultsQuarter)).toBe(
      (314 + 3 + 122 - 9) * CR,
    );
    const fy26 = makePeriod("year", 2026, null);
    expect(
      quartersFor(QUARTERS, [
        "2025-06-30",
        "2025-09-30",
        "2025-12-31",
        "2026-03-31",
      ])?.basis,
    ).toBe("consolidated");
    expect(quartersFor(QUARTERS, ["2025-06-30", "2027-03-31"])).toBeNull();
    const d = computeDelivered(
      "revenue_growth",
      "revenue_growth",
      fy26,
      "yoy",
      QUARTERS,
    );
    expect(d.value).toBeCloseTo((FY26_REV / FY25_REV - 1) * 100, 3);
    expect(d.settledBy).toBe("Q4FY26");
    expect(d.source).toMatch(/2026-03-31/);
    const m = computeDelivered(
      "margin_ebitda",
      "ebitda_margin",
      fy26,
      "absolute",
      QUARTERS,
    );
    expect(m.value).toBeCloseTo((FY26_EBITDA / FY26_REV) * 100, 3);
    expect(
      computeDelivered("other", "capex", fy26, "absolute", QUARTERS).value,
    ).toBeNull();
    expect(
      computeDelivered("revenue_growth", "revenue_growth", fy26, "cc", QUARTERS)
        .note,
    ).toMatch(/constant-currency/);
  });
  it("applies tolerances and cost-like inversion", () => {
    const g = { family: "revenue_growth" as const, unit: "%", costLike: false };
    expect(compareBand(10.5, { low: 10, high: 12 }, g).verdict).toBe("kept");
    expect(compareBand(13.2, { low: 10, high: 12 }, g).verdict).toBe("beat");
    expect(compareBand(12.9, { low: 10, high: 12 }, g).verdict).toBe("kept"); // ±1pp
    expect(compareBand(8.5, { low: 10, high: 12 }, g).verdict).toBe("missed");
    const m = { family: "margin_ebitda" as const, unit: "%", costLike: false };
    expect(compareBand(13.6, { low: 14, high: 14.5 }, m).verdict).toBe("kept"); // ±0.5pp
    expect(compareBand(13.4, { low: 14, high: 14.5 }, m).verdict).toBe(
      "missed",
    );
    const t = { family: "tax_rate" as const, unit: "%", costLike: true };
    expect(compareBand(27, { low: 29, high: 30 }, t).verdict).toBe("beat");
    const a = { family: "revenue" as const, unit: "INR", costLike: false };
    expect(
      compareBand(13_200 * CR, { low: 13_500 * CR, high: 14_000 * CR }, a)
        .verdict,
    ).toBe("kept"); // ±3%
    expect(
      compareBand(12_900 * CR, { low: 13_500 * CR, high: 14_000 * CR }, a)
        .verdict,
    ).toBe("missed");
    expect(compareBand(16, { low: 15, high: null }, g).verdict).toBe("kept");
    expect(compareBand(14, { low: 15, high: null }, g).rule).toMatch(/floor/);
    expect(compareDirection(1.2, "up", "margin_ebitda").verdict).toBe("kept");
    expect(compareDirection(-0.1, "up", "margin_ebitda").verdict).toBe(
      "missed",
    );
    expect(compareDirection(0.3, "flat", "margin_ebitda").verdict).toBe("kept");
  });
});

describe("adjudicateAll", () => {
  it("settles a due annual growth promise against exchange numbers (missed) with evidence", () => {
    const rows = adjudicateAll(
      [input({ id: "g1", metric: "revenue_growth" })],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const r = byId(rows, "g1");
    expect(r.verdict).toBe("missed");
    expect(r.status).toBe("settled");
    expect(r.settledByQuarter).toBe("Q4FY26");
    expect(r.delivered?.value).toBeCloseTo(7.39, 1);
    expect(r.delivered?.unit).toBe("%");
    expect(r.evidence).toMatchObject({ quoteDocId: "doc_q1fy26", page: 3 });
    expect(r.evidence.resultsSourceUrl).toMatch(/2026-03-31/);
    expect(String(r.evidence.rule)).toMatch(/below 10%/);
  });
  it("marks kept / beat on margins and absolute revenue", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "m1",
          metric: "ebitda_margin",
          quote: "margin of 13.5% to 14% for FY26",
          low: 13.5,
          high: 14,
          comparison: "absolute",
        }),
        input({
          id: "r1",
          metric: "revenue",
          quote: "revenue of INR10,500 crores for FY26",
          low: 10_500 * CR,
          high: 10_500 * CR,
          unit: "INR",
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "m1").verdict).toBe("kept"); // 13.8%
    expect(byId(rows, "r1").verdict).toBe("beat"); // 11,218 vs 10,500 (+6.8% > 3%)
  });
  it("chains revisions: a later lower band marks the earlier promise 'cut'; the latest is settled", () => {
    const rows = adjudicateAll(
      [
        input({ id: "g1", metric: "revenue_growth", low: 10, high: 12 }),
        input({
          id: "g2",
          metric: "revenue_growth",
          docId: "doc_q2fy26",
          statedAt: T_Q2FY26,
          statedPeriod: "Q2FY26",
          low: 6,
          high: 8,
          quote: "we now expect 6% to 8% growth for FY26",
          revision: "cut",
        }),
        input({
          id: "g3",
          metric: "revenue_growth",
          docId: "doc_q3fy26",
          statedAt: T_Q3FY26,
          statedPeriod: "Q3FY26",
          low: 6,
          high: 8,
          quote: "we maintain 6% to 8% growth for FY26",
          revision: "maintained",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "g1")).toMatchObject({
      verdict: "cut",
      status: "superseded",
    });
    expect(byId(rows, "g2")).toMatchObject({
      verdict: null,
      status: "superseded",
    });
    expect(String(byId(rows, "g2").evidence.note)).toMatch(/reiterated/);
    expect(byId(rows, "g3")).toMatchObject({
      verdict: "kept",
      status: "settled",
    }); // 7.4% within 6–8
    expect((byId(rows, "g3").evidence.chain as unknown[]).length).toBe(3);
    // rows come newest first
    expect(rows.map((r) => r.id)).toEqual(["g3", "g2", "g1"]);
  });
  it("marks 'raised' when a later band is higher and 'withdrawn' on explicit withdrawal", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "a",
          metric: "ebitda_margin",
          low: 13,
          high: 13.5,
          comparison: "absolute",
        }),
        input({
          id: "b",
          metric: "ebitda_margin",
          docId: "doc_q2fy26",
          statedAt: T_Q2FY26,
          statedPeriod: "Q2FY26",
          low: 14.5,
          high: 15,
          comparison: "absolute",
          revision: "raised",
        }),
        input({
          id: "c",
          metric: "capex",
          horizon: "FY26",
          low: 700 * CR,
          high: 750 * CR,
          unit: "INR",
          comparison: "absolute",
        }),
        input({
          id: "d",
          metric: "capex",
          docId: "doc_q3fy26",
          statedAt: T_Q3FY26,
          statedPeriod: "Q3FY26",
          low: null,
          high: null,
          unit: "qualitative",
          revision: "withdrawn",
          quote: "we are not guiding capex any more",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "a").verdict).toBe("raised");
    expect(byId(rows, "b").verdict).toBe("missed"); // 13.8% < 14.5 − 0.5
    expect(byId(rows, "c")).toMatchObject({
      verdict: "withdrawn",
      status: "withdrawn",
    });
    expect(byId(rows, "d").verdict).toBe("withdrawn");
  });
  it("is 'unverifiable' for metrics outside exchange P&L data and for constant-currency growth", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "v",
          metric: "volume_growth",
          quote: "volume growth of about 10% for FY26",
          low: 9,
          high: 11,
        }),
        input({
          id: "cc",
          metric: "revenue_growth",
          quote: "1% to 2% in constant currency for FY26",
          low: 1,
          high: 2,
          comparison: "cc",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "v")).toMatchObject({
      verdict: "unverifiable",
      status: "settled",
    });
    expect(String(byId(rows, "v").evidence.note)).toMatch(/not derivable/);
    expect(byId(rows, "cc").verdict).toBe("unverifiable");
  });
  it("is 'not_addressed' when a due promise has no actuals and the next call is silent; stays open otherwise", () => {
    const noActuals = QUARTERS.filter((x) => x.periodEnd < "2025-06-30");
    const rows = adjudicateAll(
      [input({ id: "g1", metric: "revenue_growth" })],
      noActuals,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "g1")).toMatchObject({
      verdict: "not_addressed",
      status: "settled",
    });
    // the same promise with a follow-up statement in a later call is not "silent"
    const rows2 = adjudicateAll(
      [
        input({ id: "g1", metric: "revenue_growth" }),
        input({
          id: "g2",
          metric: "revenue_growth",
          docId: "doc_q2fy27",
          statedAt: T_Q2FY27,
          statedPeriod: "Q2FY27",
          revision: "maintained",
        }),
      ],
      noActuals,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows2, "g2").verdict).toBeNull();
    expect(byId(rows2, "g2").status).toBe("open");
    expect(String(byId(rows2, "g2").evidence.note)).toMatch(/awaiting/);
  });
  it("keeps not-yet-due promises open with interim year-to-date progress", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "f27",
          metric: "revenue_growth",
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          docId: "doc_q2fy27",
          statedAt: T_Q2FY27,
          statedPeriod: "Q2FY27",
          low: 10,
          high: 12,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const r = byId(rows, "f27");
    expect(r.status).toBe("open");
    expect(r.verdict).toBeNull();
    const interim = r.evidence.interim as { value: number; note: string };
    expect(interim.value).toBeCloseTo(
      ((2718 + 3361) / (2609 + 2394) - 1) * 100,
      2,
    );
    expect(interim.note).toMatch(/2 of 4 quarters/);
  });
  it("settles 'operating margin' only when the EBITDA and EBIT readings agree", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "om",
          metric: "operating_margin",
          low: 13.5,
          high: 14,
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    // EBITDA margin 13.8% → kept; EBIT margin ≈ 10.0% → missed → ambiguous
    expect(byId(rows, "om").verdict).toBe("unverifiable");
    expect(String(byId(rows, "om").evidence.rule)).toMatch(/ambiguous/);
  });
  it("judges direction-only promises against the prior year", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "up",
          metric: "ebitda_margin",
          direction: "up",
          low: null,
          high: null,
          unit: "%",
          isExplicit: false,
          comparison: "absolute",
          quote: "margins will improve in FY26",
        }),
        input({
          id: "flat",
          metric: "ebitda_margin",
          direction: "flat",
          low: null,
          high: null,
          unit: "%",
          isExplicit: false,
          comparison: "absolute",
          quote: "margins will be maintained in FY26",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    // FY25 EBITDA margin 13.70% → FY26 13.84%: flat, not an improvement
    expect(byId(rows, "up").verdict).toBe("missed");
    expect(byId(rows, "flat").verdict).toBe("kept");
    expect(
      (byId(rows, "up").evidence.priorYear as { value: number }).value,
    ).toBeCloseTo(13.7, 1);
  });
  it("is idempotent and summarises in plain words", () => {
    const inputs = [
      input({ id: "g1", metric: "revenue_growth" }),
      input({
        id: "m1",
        metric: "ebitda_margin",
        low: 13.5,
        high: 14,
        comparison: "absolute",
      }),
      input({ id: "v", metric: "volume_growth", low: 9, high: 11 }),
    ];
    const a = adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW);
    const b = adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(summarise(a)).toBe(
      "2 of 3 promises settled: margin kept, growth missed · 1 unverifiable (volume growth)",
    );
    expect(metricFamily("ebit_margin")).toBe("margin_ebit");
  });
});

describe("scope and operating-margin basis", () => {
  it("does not chain a segment statement with a company-wide one, and keeps >3× bands apart", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "seg",
          metric: "revenue",
          quote: "we build a gas piping business to INR600 crores this year",
          low: 600 * CR,
          high: 600 * CR,
          unit: "INR",
          comparison: "absolute",
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          docId: "doc_q1fy27",
          statedAt: Date.UTC(2026, 6, 28),
          statedPeriod: "Q1FY27",
        }),
        input({
          id: "co",
          metric: "revenue",
          quote:
            "FY27, we expect our business to grow between INR13,500 crores to INR14,000 crores",
          low: 13_500 * CR,
          high: 14_000 * CR,
          unit: "INR",
          comparison: "absolute",
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          docId: "doc_q2fy27",
          statedAt: T_Q2FY27,
          statedPeriod: "Q2FY27",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "seg").verdict).toBeNull();
    expect(byId(rows, "seg").status).toBe("open");
    expect(byId(rows, "co").status).toBe("open");
  });
  it("settles 'operating margin' as EBITDA margin when told the company means OPM", () => {
    const inputs = [
      input({
        id: "om",
        metric: "operating_margin",
        low: 13.5,
        high: 14,
        comparison: "absolute",
      }),
    ];
    expect(
      byId(
        adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW, {
          operatingMarginBasis: "ebitda",
        }),
        "om",
      ).verdict,
    ).toBe("kept");
    expect(
      byId(
        adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW, {
          operatingMarginBasis: "ebit",
        }),
        "om",
      ).verdict,
    ).toBe("missed");
    expect(
      byId(adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW), "om").verdict,
    ).toBe("unverifiable");
  });
});

describe("segment scope", () => {
  it("never settles a segment-level target against consolidated numbers", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "foods",
          metric: "revenue",
          quote:
            "we expect the Foods portfolio to reach INR1,000 crores this year",
          low: 1000 * CR,
          high: 1000 * CR,
          unit: "INR",
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "foods").verdict).toBe("unverifiable");
    expect(String(byId(rows, "foods").evidence.note)).toMatch(/segment-level/);
    expect(byId(rows, "foods").evidence.scope).toBe("food");
  });
});

describe("margin label noise", () => {
  it("reads 'operating margin' in the quote through the company convention whatever the model's label", () => {
    const inputs = [
      input({
        id: "om",
        metric: "ebitda_margin",
        quote: "Our operating margin guidance for the year is 13.5% to 14%",
        low: 13.5,
        high: 14,
        comparison: "absolute",
      }),
    ];
    // FY26 EBITDA margin 13.8% (kept) vs EBIT margin ≈ 10% (missed)
    expect(
      byId(
        adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW, {
          operatingMarginBasis: "ebit",
        }),
        "om",
      ).verdict,
    ).toBe("missed");
    expect(
      byId(
        adjudicateAll(inputs, QUARTERS, TRANSCRIPTS, NOW, {
          operatingMarginBasis: "ebitda",
        }),
        "om",
      ).verdict,
    ).toBe("kept");
  });
});
