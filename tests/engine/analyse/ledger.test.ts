import { describe, expect, it } from "vitest";
import {
  type AdjudicatedRow,
  adjudicateAll,
  compareBand,
  compareDirection,
  computeDelivered,
  ebitdaOp,
  type LedgerInput,
  mergeLedgerEvidence,
  metricFamily,
  QUANTITY_NOTE,
  quartersFor,
  quoteContext,
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
    expect(String(byId(rows, "v").evidence.note)).toMatch(
      /no comparable XBRL line/,
    );
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
  it("shows direction-only and adjectival promises as quotes with the delivered figure, never a verdict", () => {
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
          id: "teens",
          metric: "revenue_growth",
          low: 13,
          high: 19,
          isExplicit: false,
          quote: "we expect teens revenue growth in FY26",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "up")).toMatchObject({
      verdict: "unverifiable",
      status: "settled",
    });
    expect(String(byId(rows, "up").evidence.note)).toMatch(
      /direction-only.*not adjudicated.*delivered 13\.8%/,
    );
    expect(
      (byId(rows, "up").evidence.priorYear as { value: number }).value,
    ).toBeCloseTo(13.7, 1);
    expect(byId(rows, "teens")).toMatchObject({ verdict: "unverifiable" });
    expect(String(byId(rows, "teens").evidence.note)).toMatch(
      /adjectival band 13–19%.*delivered 7\.4%/,
    );
    expect(byId(rows, "teens").delivered?.value).toBeCloseTo(7.39, 1);
  });
  it("flags ambiguous types and unclear horizons as unverifiable with a reason", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "typed",
          metric: "other",
          typeIssue: true,
          typeNote: "metric ambiguous: ebitda_margin with unit INR",
          low: 100 * CR,
          high: 100 * CR,
          unit: "INR",
        }),
        input({
          id: "hz",
          metric: "revenue_growth",
          horizon: "when the cycle turns",
          horizonEnd: null,
        }),
        input({
          id: "mt",
          metric: "revenue_growth",
          horizon: "medium_term",
          horizonEnd: null,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "typed")).toMatchObject({
      verdict: "unverifiable",
      status: "settled",
    });
    expect(String(byId(rows, "typed").evidence.note)).toMatch(
      /metric ambiguous/,
    );
    expect(byId(rows, "hz")).toMatchObject({ verdict: "unverifiable" });
    expect(String(byId(rows, "hz").evidence.note)).toMatch(/horizon unclear/);
    expect(byId(rows, "mt")).toMatchObject({ verdict: null, status: "open" });
  });
  it("widens the tolerance for 'about X' instead of storing derived bounds", () => {
    // FY26 revenue growth 7.39 %: "about 8.5%" (±1pp +1pp approx) → kept; exact 8.5 (±1pp) → missed
    expect(
      byId(
        adjudicateAll(
          [
            input({
              id: "a",
              metric: "revenue_growth",
              low: 8.5,
              high: 8.5,
              approx: true,
            }),
          ],
          QUARTERS,
          TRANSCRIPTS,
          NOW,
        ),
        "a",
      ).verdict,
    ).toBe("kept");
    expect(
      byId(
        adjudicateAll(
          [input({ id: "b", metric: "revenue_growth", low: 8.5, high: 8.5 })],
          QUARTERS,
          TRANSCRIPTS,
          NOW,
        ),
        "b",
      ).verdict,
    ).toBe("missed");
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
    expect(byId(rows, "foods").evidence.note).toBe(
      "segment, not the company total",
    );
    expect(byId(rows, "foods").delivered?.value).toBeNull();
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

describe("revision chains", () => {
  it("does not take the speaker's 'raised' at face value when the later band is lower", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "a",
          metric: "revenue_growth",
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          low: 20,
          high: 25,
          docId: "doc_q1fy27",
          statedAt: Date.UTC(2026, 6, 28),
          statedPeriod: "Q1FY27",
        }),
        input({
          id: "b",
          metric: "revenue_growth",
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          low: 13,
          high: 19,
          isExplicit: false,
          revision: "raised",
          docId: "doc_q2fy27",
          statedAt: T_Q2FY27,
          statedPeriod: "Q2FY27",
          quote: "we expect teens revenue growth this year",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "a")).toMatchObject({
      status: "superseded",
      verdict: null,
    });
    expect(String(byId(rows, "a").evidence.note)).toMatch(
      /does not match the stated 'raised'/,
    );
  });

  it("marks a derived figure unverifiable and does not score it", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "prod",
          metric: "volume",
          quote: "we will utilise 70% of the 70,000 ton capacity",
          low: 49_000,
          high: 49_000,
          unit: "units",
          isExplicit: true,
          derived: true,
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "prod")).toMatchObject({
      verdict: "unverifiable",
      status: "settled",
    });
    expect(byId(rows, "prod").evidence.note).toBe("derived figure");
  });
});

describe("same quantity", () => {
  const fy26 = {
    horizon: "FY26",
    horizonEnd: "2026-03-31",
    isExplicit: true,
    comparison: "absolute" as const,
  };

  it("does not call a dollar EBITDA a beat against the rupee line", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "ved",
          metric: "ebitda",
          unit: "USD",
          low: 6e9,
          high: 6e9,
          quote:
            "delivering record EBITDA in FY26, surpassing $6 billion at Vedanta India consol level",
          ...fy26,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "ved")).toMatchObject({
      verdict: "unverifiable",
      status: "settled",
    });
    expect(byId(rows, "ved").evidence.note).toBe("currency mismatch");
    expect(byId(rows, "ved").delivered?.value).toBeNull();
  });

  it("does not call an AUM band a miss against revenue growth", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "baj",
          metric: "revenue_growth",
          unit: "%",
          low: 22,
          high: 23,
          quote:
            "overall, we've taken a view that the top line growth or AUM growth will gravitate between 22% and 23%",
          ...fy26,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "baj").verdict).toBe("unverifiable");
    expect(byId(rows, "baj").evidence.note).toBe("metric mismatch");
    expect(byId(rows, "baj").delivered?.value).toBeNull();
  });

  it("does not score a slice, a brand, or an unanchored rupee band against company revenue", () => {
    // Company revenue on the scale of Dixon (~₹48,873 cr), so a ₹5,500–6,000 cr
    // band is a different quantity. The small fixture's ₹11,218 cr would not be.
    const big = QUARTERS.map((q) =>
      q.periodEnd >= "2025-06-30" && q.periodEnd <= "2026-03-31"
        ? { ...q, revenue: (48872.8 / 4) * CR }
        : q,
    );
    const rows = adjudicateAll(
      [
        input({
          id: "dixon",
          metric: "revenue",
          unit: "INR",
          low: 1500 * CR,
          high: 1500 * CR,
          quote:
            "So this year, we feel the revenue should be in the range of INR1,500-odd crores.",
          ...fy26,
        }),
        input({
          id: "exports",
          metric: "revenue",
          unit: "INR",
          low: 5500 * CR,
          high: 6000 * CR,
          quote:
            "We feel we should be closing at almost INR5,500 crores, INR6,000 crores in the current fiscal.",
          ...fy26,
        }),
        input({
          id: "telecom",
          metric: "revenue",
          unit: "INR",
          low: 5200 * CR,
          high: 5200 * CR,
          quote: "This year, we should have revenues close to INR5,200 crores.",
          ...fy26,
        }),
        input({
          id: "power",
          metric: "revenue",
          unit: "INR",
          low: 265 * CR,
          high: 275 * CR,
          quote:
            "Power-One is expected to deliver in the range of INR265 crores to INR275 crores this year.",
          ...fy26,
        }),
        input({
          id: "candere",
          metric: "revenue",
          unit: "INR",
          low: 500 * CR,
          high: 500 * CR,
          quote:
            "we will end Candere with PAT neutral and the revenue target for the year will be around INR500 crores.",
          ...fy26,
        }),
        input({
          id: "durable",
          metric: "revenue_growth",
          unit: "%",
          low: 15,
          high: 15,
          quote:
            "in consumer durable, we expect to do about 15% kind of a growth",
          ...fy26,
        }),
        input({
          id: "txn",
          metric: "revenue_growth",
          unit: "%",
          low: 20,
          high: 20,
          quote:
            "In transactional income, broadly, this year, we should see about 20% growth.",
          ...fy26,
        }),
      ],
      big,
      TRANSCRIPTS,
      NOW,
    );
    for (const id of [
      "dixon",
      "exports",
      "telecom",
      "power",
      "candere",
      "durable",
      "txn",
    ]) {
      expect(byId(rows, id).verdict, id).toBe("unverifiable");
      expect(byId(rows, id).evidence.note, id).toBe(
        "segment, not the company total",
      );
      expect(byId(rows, id).delivered?.value, id).toBeNull();
    }
  });

  it("does not score Amber's RAC answer or Candere's PAT direction against the company", () => {
    const amberQuote =
      "So we feel that the industry should be flattish this year, whereas we have again and again maintained our guidance, and we are hopeful to deliver about 14% to 15% kind of a growth.";
    const amberQuestion =
      "Sir, my first question is on RAC. So how should we read calendar '25 -- '26 from an RAC point of view?";
    const candereQuote =
      "Way forward, this financial year, we will end Candere with PAT neutral PAT positive and the revenue target for the year will be around INR500 crores.";
    const context = quoteContext(
      [
        { role: "analyst", text: amberQuestion },
        {
          role: "management",
          text: `See, this is how we look at room AC sector in the country. ${amberQuote}`,
        },
      ],
      amberQuote,
    );
    expect(context).toMatch(/\bRAC\b/);
    expect(context).toMatch(/room AC/);

    const rac = adjudicateAll(
      [
        input({
          id: "rac",
          metric: "revenue_growth",
          unit: "%",
          low: 14,
          high: 15,
          quote: amberQuote,
          context,
          ...fy26,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rac, "rac").verdict).toBe("unverifiable");
    expect(byId(rac, "rac").evidence.note).toBe(
      "segment, not the company total",
    );
    expect(byId(rac, "rac").delivered?.value).toBeNull();

    // The stored quote never says RAC. Without the question, do not invent a scope.
    const bare = adjudicateAll(
      [
        input({
          id: "bare",
          metric: "revenue_growth",
          unit: "%",
          low: 14,
          high: 15,
          quote: amberQuote,
          ...fy26,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(bare, "bare").verdict).toBe("missed");
    expect(byId(bare, "bare").delivered?.value).not.toBeNull();

    const pat = adjudicateAll(
      [
        input({
          id: "canderePat",
          metric: "pat",
          quote: candereQuote,
          direction: "qualitative",
          low: null,
          high: null,
          unit: "qualitative",
          ...fy26,
          isExplicit: false,
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(pat, "canderePat").verdict).toBe("unverifiable");
    expect(byId(pat, "canderePat").evidence.note).toBe(
      "segment, not the company total",
    );
    expect(byId(pat, "canderePat").delivered?.value).toBeNull();
    expect(String(byId(pat, "canderePat").evidence.note)).not.toMatch(
      /13503950000|1,350/,
    );

    const company = adjudicateAll(
      [
        input({
          id: "co",
          metric: "revenue_growth",
          unit: "%",
          low: 14,
          high: 15,
          quote: "we expect consolidated revenue growth of 14% to 15% for FY26",
          context: amberQuestion,
          ...fy26,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(company, "co").verdict).toBe("missed");
    expect(byId(company, "co").delivered?.value).not.toBeNull();
  });

  it("does not score Nuvama's 'here' once the remark has named asset services", () => {
    const quote =
      "But on a full year basis, we are confident that revenue growth will be more than 20-25% here.";
    const before =
      "With that, let me move to our next segment, asset services. Momentum was extremely strong this quarter. There was a significant business growth of around 20% quarter-on-quarter. Average client assets have come back to Q1 level of last year when we had lost a very large client and retention has continued to be strong. Just one word of caution, we have seen extraordinary level of growth here, I think over the coming few quarters, we are not expecting a quarter-on-quarter growth like this. There will be some amount of moderation as new client acquisition has happened and a lot of collateral is right now sitting in cash, which will get converted between cash and G-Secs. So we may see some level of moderation. ";
    expect(before.length).toBeGreaterThan(400);
    const context = quoteContext(
      [{ role: "management", text: `${before}${quote}` }],
      quote,
    );
    expect(context).toMatch(/asset services/i);

    const bare = quoteContext(
      [
        {
          role: "management",
          text: `So we may see some level of moderation. ${quote}`,
        },
      ],
      quote,
    );
    expect(bare).not.toMatch(/asset services/i);

    const rows = adjudicateAll(
      [
        input({
          id: "here",
          metric: "revenue_growth",
          unit: "%",
          low: 20,
          high: 25,
          quote,
          context,
          ...fy26,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "here").verdict).toBe("unverifiable");
    expect(byId(rows, "here").evidence.note).toBe(
      "segment, not the company total",
    );
    expect(byId(rows, "here").delivered?.value).toBeNull();

    const company = adjudicateAll(
      [
        input({
          id: "bare",
          metric: "revenue_growth",
          unit: "%",
          low: 20,
          high: 25,
          quote,
          context: bare,
          ...fy26,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(company, "bare").verdict).toBe("missed");
    expect(byId(company, "bare").delivered?.value).not.toBeNull();
  });

  it("does not score Amber's electronics margin when only the question names the division", () => {
    const quote =
      "Considering the job work change, we are expecting a 40% growth on the top line. And the margins, what we are expecting right now should be in the range of 9.5% to 10% range.";
    const question =
      "Sir, first, if you could clarify in terms of the growth, you said 40% revenue growth for the electronics business. Is this post the conversion, and hence the revenue growth number is weaker. So in that case, could you also clarify the margin for that division?";
    const context = quoteContext(
      [
        { role: "analyst", text: question },
        {
          role: "management",
          text: "So what conversion are you talking about?",
        },
        { role: "analyst", text: "The job work what you said…" },
        { role: "management", text: quote },
      ],
      quote,
    );
    expect(context).toMatch(/electronics/i);
    expect(context).not.toMatch(/top line/i);

    const rows = adjudicateAll(
      [
        input({
          id: "elec",
          metric: "ebitda_margin",
          unit: "%",
          low: 9.5,
          high: 10,
          quote,
          context,
          ...fy26,
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "elec").verdict).toBe("unverifiable");
    expect(byId(rows, "elec").evidence.note).toBe(
      "segment, not the company total",
    );
    expect(byId(rows, "elec").delivered?.value).toBeNull();

    const bare = adjudicateAll(
      [
        input({
          id: "bare",
          metric: "ebitda_margin",
          unit: "%",
          low: 9.5,
          high: 10,
          quote,
          ...fy26,
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(bare, "bare").verdict).toBe("beat");
    expect(byId(bare, "bare").delivered?.value).not.toBeNull();

    const durableQuote =
      "Yes, sir, your question was that does our guidance stand intact? So it's intact to the industry growth. It can vary from like between -- it should range between 13% to 15%. So we are in line to that.";
    const durable = quoteContext(
      [
        {
          role: "analyst",
          text: "On the consumer durable, you had mentioned that it will grow in line with the industry. So does that number still hold?",
        },
        {
          role: "management",
          text: "On the consumer durable question, I think, Sachin, you can answer.",
        },
        { role: "management", text: durableQuote },
      ],
      durableQuote,
    );
    expect(durable).toMatch(/consumer durable/i);
    const durableRows = adjudicateAll(
      [
        input({
          id: "cd",
          metric: "revenue_growth",
          unit: "%",
          low: 13,
          high: 15,
          quote: durableQuote,
          context: durable,
          ...fy26,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(durableRows, "cd").verdict).toBe("unverifiable");
    expect(byId(durableRows, "cd").evidence.note).toBe(
      "segment, not the company total",
    );
    expect(byId(durableRows, "cd").delivered?.value).toBeNull();
  });

  it("clears a company figure on a superseded solution-and-products promise without a new verdict", () => {
    const slice =
      "We expect 30% year-on-year revenue growth in solution and products, and we hope it will increase over the period.";
    const rows = adjudicateAll(
      [
        input({
          id: "kpit",
          metric: "revenue_growth",
          unit: "%",
          low: 30,
          high: 30,
          quote: slice,
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          docId: "doc_q3fy26",
          statedAt: T_Q3FY26,
          statedPeriod: "Q4FY26",
          comparison: "yoy",
        }),
        input({
          id: "later",
          metric: "revenue_growth",
          quote:
            "we will return to growth in H2 by Q4, driven by the Q4 performance and our profitability will return largely when the revenues come.",
          low: null,
          high: null,
          unit: "qualitative",
          isExplicit: false,
          horizon: "FY27",
          horizonEnd: "2027-03-31",
          docId: "doc_q2fy27",
          statedAt: T_Q2FY27,
          statedPeriod: "Q1FY27",
          revision: "maintained",
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "kpit");
    expect(row.status).toBe("superseded");
    expect(row.verdict).toBeNull();
    expect(String(row.evidence.note)).toMatch(/reiterated/);
    expect(row.evidence.interim ?? null).toBeNull();
    expect(row.delivered?.value ?? null).toBeNull();
    const stored = mergeLedgerEvidence(
      {
        interim: { value: 7.7, unit: "%", note: "YTD" },
        delivered: { value: 7.7, unit: "%", source: "xbrl" },
      },
      row,
      { isExplicit: true, derived: false, typeIssue: false, typeNote: null },
    );
    expect(stored.interim ?? null).toBeNull();
    expect(
      (stored.delivered as { value?: number | null } | null)?.value ?? null,
    ).toBeNull();
    expect(JSON.stringify(stored)).not.toContain("7.7");
  });

  it("still scores a company total that names itself, including a wide miss", () => {
    const rows = adjudicateAll(
      [
        input({
          id: "co",
          metric: "revenue",
          unit: "INR",
          low: 50_000 * CR,
          high: 50_000 * CR,
          quote: "we expect consolidated revenue of INR50,000 crores for FY26",
          ...fy26,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(rows, "co").verdict).toBe("missed");
    expect(byId(rows, "co").delivered?.value).toBe(FY26_REV * CR);
  });

  it("does not keep a company interim on an open brand promise, including one already saved", () => {
    const beardo =
      "Beardo perfectly exemplifies this. Since we took over the brand under Marico's leadership in 2020, the business has scaled by more than 6x and is expected to cross INR400 crores this year.";
    const companyTotal = 7854 * CR;
    const ytd = [
      q("2025-06-30", 3000, 10, 3, 90, 200, 50, 150),
      q("2025-09-30", 3000, 10, 3, 90, 200, 50, 150),
      q("2025-12-31", 3000, 10, 3, 90, 200, 50, 150),
      q("2026-03-31", 3000, 10, 3, 90, 200, 50, 150),
      q("2026-06-30", 4000, 10, 3, 90, 200, 50, 150),
      q("2026-09-30", 3854, 10, 3, 90, 200, 50, 150),
    ];
    const openFy27 = {
      horizon: "FY27",
      horizonEnd: "2027-03-31",
      docId: "doc_q2fy27",
      statedAt: T_Q2FY27,
      statedPeriod: "Q2FY27",
      isExplicit: true,
    };
    const rows = adjudicateAll(
      [
        input({
          id: "beardo",
          metric: "revenue",
          unit: "INR",
          low: 400 * CR,
          high: null,
          quote: beardo,
          comparison: "absolute",
          ...openFy27,
        }),
        input({
          id: "division",
          metric: "revenue_growth",
          unit: "%",
          low: 30,
          high: 35,
          quote:
            "For the full year, we expect this division to deliver growth of about 30% to 35% for the full year, as informed earlier.",
          comparison: "yoy",
          ...openFy27,
        }),
        input({
          id: "usd",
          metric: "ebitda",
          unit: "USD",
          low: 6e9,
          high: null,
          quote:
            "we are on track to deliver a lifetime high annual EBITDA of over $6 billion",
          comparison: "absolute",
          ...openFy27,
        }),
        input({
          id: "shampoo",
          metric: "revenue",
          unit: "INR",
          low: 100 * CR,
          high: 100 * CR,
          quote:
            "We are witnessing very good traction in shampoos and are confident of achieving INR100 crores plus ARR this year.",
          comparison: "absolute",
          ...openFy27,
        }),
        input({
          id: "vertical",
          metric: "revenue_growth",
          unit: "%",
          low: null,
          high: null,
          quote:
            "We expect this vertical to deliver high double-digit revenue growth in the current fiscal.",
          comparison: "yoy",
          ...openFy27,
          isExplicit: false,
          derived: true,
        }),
        input({
          id: "company",
          metric: "revenue",
          unit: "INR",
          low: 20_000 * CR,
          high: 20_000 * CR,
          quote: "we expect consolidated revenue of INR20,000 crores for FY27",
          comparison: "absolute",
          ...openFy27,
        }),
        input({
          id: "ebitda",
          metric: "ebitda",
          unit: "INR",
          low: 2_000 * CR,
          high: 2_000 * CR,
          quote:
            "we maintain our FY27 EBITDA guidance to be upwards of INR2,000 crores",
          comparison: "absolute",
          ...openFy27,
        }),
      ],
      ytd,
      TRANSCRIPTS,
      NOW,
    );
    const repaired = {
      isExplicit: true,
      derived: false,
      typeIssue: false,
      typeNote: null,
    };
    const saved = {
      interim: {
        value: companyTotal,
        unit: "INR",
        note: "2 of 4 quarters of FY27 (YTD):",
      },
    };

    for (const id of ["beardo", "division", "usd", "shampoo"] as const) {
      const row = byId(rows, id);
      expect(row.status, id).toBe("open");
      expect(row.verdict, id).toBeNull();
      expect(row.delivered?.value ?? null, id).toBeNull();
      expect(row.evidence.interim ?? null, id).toBeNull();
      const stored = mergeLedgerEvidence(saved, row, repaired);
      expect(stored.interim ?? null, id).toBeNull();
      expect(JSON.stringify(stored), id).not.toContain(String(companyTotal));
      const delivered = stored.delivered as { value?: number | null } | null;
      expect(delivered?.value ?? null, id).toBeNull();
    }

    const brand = byId(rows, "beardo");
    expect(brand.quote).toBe(beardo);
    expect(String(brand.evidence.note)).toMatch(/^due after /);

    const vertical = byId(rows, "vertical");
    expect(vertical.status).toBe("settled");
    expect(vertical.verdict).toBe("unverifiable");
    expect(vertical.evidence.note).toBe("derived figure");
    expect(vertical.evidence.interim ?? null).toBeNull();
    expect(
      mergeLedgerEvidence(saved, vertical, {
        ...repaired,
        isExplicit: false,
        derived: true,
      }).interim ?? null,
    ).toBeNull();

    const company = byId(rows, "company");
    expect(company.status).toBe("open");
    expect(company.verdict).toBeNull();
    const interim = company.evidence.interim as { value: number };
    expect(interim.value).toBe(companyTotal);
    const storedCo = mergeLedgerEvidence(
      { interim: { value: 1, unit: "INR", note: "stale" } },
      company,
      repaired,
    );
    expect((storedCo.interim as { value: number }).value).toBe(companyTotal);

    // Full-year company EBITDA still ahead of a smaller YTD stays. The
    // ratio is wide only because the year is unfinished.
    const ebitda = byId(rows, "ebitda");
    expect(ebitda.status).toBe("open");
    expect((ebitda.evidence.interim as { value: number }).value).toBe(566 * CR);
  });

  it("does not keep a company margin on a basis-point or other-metric promise, including one already saved", () => {
    const bajaj =
      "We remain pretty comfortable place to deliver a 25 to 40 basis point improvement in FY27 on opex-to-NTI.";
    // EBITDA = PBEIT + finance + D&A − other income = 708 on revenue 1,000 → 70.8%.
    const marginQ = (end: string) => q(end, 1000, 0, 0, 0, 708, 0, 708);
    const quarters = [
      marginQ("2025-06-30"),
      marginQ("2025-09-30"),
      marginQ("2025-12-31"),
      marginQ("2026-03-31"),
      marginQ("2026-06-30"),
      marginQ("2026-09-30"),
    ];
    const openFy27 = {
      horizon: "FY27",
      horizonEnd: "2027-03-31",
      docId: "doc_q2fy27",
      statedAt: T_Q2FY27,
      statedPeriod: "Q2FY27",
      isExplicit: true,
      comparison: "absolute" as const,
    };
    const repaired = {
      isExplicit: true,
      derived: false,
      typeIssue: false,
      typeNote: null,
    };
    const savedMargin = {
      interim: {
        value: 70.8,
        unit: "%",
        note: "2 of 4 quarters of FY27 (YTD): EBITDA margin",
      },
    };
    const rows = adjudicateAll(
      [
        input({
          id: "bajaj",
          metric: "operating_margin",
          unit: "bp",
          low: 25,
          high: 40,
          quote: bajaj,
          ...openFy27,
        }),
        input({
          id: "bajajDue",
          metric: "operating_margin",
          unit: "bp",
          low: 25,
          high: 40,
          quote: bajaj,
          horizon: "FY26",
          horizonEnd: "2026-03-31",
          isExplicit: true,
          comparison: "absolute",
        }),
        input({
          id: "expand",
          metric: "ebitda_margin",
          unit: "bp",
          low: 120,
          high: 150,
          quote:
            "So, this year, percentage margin could expand by about 120 to 150 basis points.",
          ...openFy27,
        }),
        input({
          id: "bpsImpact",
          metric: "ebit_margin",
          unit: "bp",
          low: 50,
          high: 50,
          quote:
            "acquisition that we have made will have 50 bps impact on our margins overall",
          ...openFy27,
        }),
        input({
          id: "railway",
          metric: "ebitda_margin",
          unit: "%",
          low: 16,
          high: 17,
          quote:
            "But the margins in the railway side, we expect in the range of 16% to 17%.",
          ...openFy27,
        }),
        input({
          id: "copper",
          metric: "ebitda_margin",
          unit: "%",
          low: 5,
          high: null,
          quote:
            "we do foresee the margin in the Copper business going from roughly 1% right now, going to at least 5% in FY '27.",
          ...openFy27,
        }),
        input({
          id: "fluoro",
          metric: "revenue_growth",
          unit: "%",
          low: 17,
          high: 20,
          quote:
            "we had guided for an annual growth of 17% to 20% in our fluoropolymers business.",
          ...openFy27,
          comparison: "yoy",
        }),
        input({
          id: "offshore",
          metric: "revenue_growth",
          unit: "%",
          low: 5,
          high: 7,
          quote:
            "Overall, revenue contribution from offshore will remain between 5% to 7% at least in this year.",
          ...openFy27,
          comparison: "yoy",
        }),
        input({
          id: "higher",
          metric: "revenue_growth",
          unit: "%",
          low: 12,
          high: 15,
          quote:
            "So we expect that the revenue growth should be at least 12% to 15% higher, if not more.",
          ...openFy27,
          comparison: "yoy",
        }),
        input({
          id: "costIncome",
          metric: "ebitda_margin",
          unit: "%",
          low: 36,
          high: 40,
          quote:
            "But I think overall full year basis, anywhere between 36% to 40% range is what will remain here.",
          context:
            "And what should we think about full year cost to income in that segment?",
          ...openFy27,
        }),
        input({
          id: "ppm",
          metric: "operating_margin",
          unit: "%",
          low: 7.8,
          high: 7.8,
          quote:
            "we continue to target the margin of around 7.8% for FY '27 with respect to the PPM portfolio.",
          ...openFy27,
          isExplicit: false,
          derived: true,
        }),
        input({
          id: "margin",
          metric: "ebitda_margin",
          unit: "%",
          low: 20,
          high: 22,
          quote:
            "we maintain our FY27 EBITDA margin guidance of 20% to 22% on a consol basis",
          ...openFy27,
        }),
        input({
          id: "ebitdaLevel",
          metric: "ebitda",
          unit: "INR",
          low: 3_000 * CR,
          high: null,
          quote:
            "we maintain our FY27 EBITDA guidance to be upwards of INR3,000 crores",
          ...openFy27,
        }),
        input({
          id: "derivedCo",
          metric: "ebitda_margin",
          unit: "%",
          low: null,
          high: null,
          quote:
            "We expect EBITDA margin to remain around the current guided range.",
          ...openFy27,
          isExplicit: false,
          derived: true,
        }),
      ],
      quarters,
      TRANSCRIPTS,
      NOW,
    );

    for (const id of [
      "bajaj",
      "expand",
      "bpsImpact",
      "railway",
      "copper",
      "fluoro",
      "offshore",
      "higher",
      "costIncome",
    ] as const) {
      const row = byId(rows, id);
      expect(row.status, id).toBe("open");
      expect(row.verdict, id).toBeNull();
      expect(row.delivered?.value ?? null, id).toBeNull();
      expect(row.evidence.interim ?? null, id).toBeNull();
      expect(JSON.stringify(row.evidence), id).not.toMatch(/70\.8/);
      const stored = mergeLedgerEvidence(savedMargin, row, repaired);
      expect(stored.interim ?? null, id).toBeNull();
      expect(JSON.stringify(stored), id).not.toContain("70.8");
    }

    const bajajRow = byId(rows, "bajaj");
    expect(bajajRow.quote).toBe(bajaj);
    expect(String(bajajRow.evidence.note)).toMatch(/^due after /);

    const due = byId(rows, "bajajDue");
    expect(due.status).toBe("settled");
    expect(due.verdict).toBe("unverifiable");
    expect(due.evidence.note).toBe("metric mismatch");
    expect(due.delivered?.value ?? null).toBeNull();
    expect(
      mergeLedgerEvidence(savedMargin, due, repaired).interim ?? null,
    ).toBeNull();

    const ppm = byId(rows, "ppm");
    expect(ppm.status).toBe("settled");
    expect(ppm.verdict).toBe("unverifiable");
    expect(ppm.evidence.note).toBe("derived figure");
    expect(ppm.evidence.interim ?? null).toBeNull();
    expect(
      mergeLedgerEvidence(savedMargin, ppm, {
        ...repaired,
        isExplicit: false,
        derived: true,
      }).interim ?? null,
    ).toBeNull();

    const margin = byId(rows, "margin");
    expect(margin.status).toBe("open");
    expect((margin.evidence.interim as { value: number }).value).toBeCloseTo(
      70.8,
      1,
    );
    const level = byId(rows, "ebitdaLevel");
    expect(level.status).toBe("open");
    expect((level.evidence.interim as { value: number }).value).toBe(1416 * CR);

    // A derived company-margin sentence is not recomputed here. A figure
    // already saved for that same line must survive re-settle.
    const derivedCo = byId(rows, "derivedCo");
    expect(derivedCo.evidence.note).toBe("derived figure");
    expect(
      (
        mergeLedgerEvidence(savedMargin, derivedCo, {
          ...repaired,
          isExplicit: false,
          derived: true,
        }).interim as { value: number }
      ).value,
    ).toBe(70.8);
  });
});

describe("a named business is not the company line", () => {
  const fy26 = {
    horizon: "FY26",
    horizonEnd: "2026-03-31",
    isExplicit: true,
    comparison: "absolute" as const,
  };
  const openFy27 = {
    horizon: "FY27",
    horizonEnd: "2027-03-31",
    isExplicit: true,
    comparison: "absolute" as const,
    docId: "doc_q2fy27",
    statedAt: T_Q2FY27,
    statedPeriod: "Q2FY27",
  };

  it("does not score L&T's P&M target of 8.5% as a beat against the company EBITDA margin", () => {
    const quote =
      "With the execution momentum expected to pick up in H2, we are reasonably confident to achieve our full year EBITDA margin target of 8.5%.";
    const lead =
      "Coming to the EBITDA margin for the P&M business. As you may have seen, the EBITDA margin for the P&M business has improved by 10 basis points in H1 FY '26.";
    const context = quoteContext(
      [{ role: "management", text: `${lead} ${quote}` }],
      quote,
    );
    expect(quote).toMatch(/target of 8\.5%/);
    expect(context).toMatch(/P&M business/);

    const rows = adjudicateAll(
      [
        input({
          id: "pm",
          metric: "ebitda_margin",
          unit: "%",
          low: 8.5,
          high: 8.5,
          quote,
          context,
          ...fy26,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "pm");
    expect(row.verdict).not.toBe("beat");
    expect(row.verdict).toBe("unverifiable");
    expect(row.evidence.note).toBe("segment, not the company total");
    expect(row.delivered?.value ?? null).toBeNull();
    expect(row.evidence.interim ?? null).toBeNull();

    // The same 8.5% sentence, with no division named, is the company margin.
    const company = adjudicateAll(
      [
        input({
          id: "co",
          metric: "ebitda_margin",
          unit: "%",
          low: 8.5,
          high: 8.5,
          quote,
          ...fy26,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(company, "co").verdict).toBe("beat");
    expect(byId(company, "co").delivered?.value).not.toBeNull();
  });

  it("does not keep the company EBITDA margin on a Projects, Products and Manufacturing guide", () => {
    const quote =
      "This has been factored in that the momentum of execution being a little softer in H1 FY'27, while we are guiding a stable margin profile for FY'27.";
    const question =
      "My first question -- the only question is that Projects, Products and Manufacturing margin have been range-bound between 7.7% to 7.8%. The guidance again is 7.8%.";
    const context = quoteContext(
      [
        { role: "analyst", text: question },
        { role: "management", text: quote },
      ],
      quote,
    );
    expect(context).toMatch(/Projects, Products and Manufacturing/);
    expect(context).toMatch(/7\.8%/);

    const rows = adjudicateAll(
      [
        input({
          id: "ppm",
          metric: "ebitda_margin",
          unit: "%",
          low: null,
          high: null,
          quote,
          context,
          ...openFy27,
          isExplicit: false,
          direction: "flat",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "ppm");
    expect(row.status).toBe("open");
    expect(row.verdict).toBeNull();
    expect(row.evidence.interim ?? null).toBeNull();
    expect(row.delivered?.value ?? null).toBeNull();
    expect(JSON.stringify(row.evidence)).not.toMatch(/8\.8/);
  });

  it("does not keep company revenue growth on a sports line", () => {
    const quote =
      "So, we did see that turn through the quarter and we hope that this will continue. Beyond the festive season as we look to the rest of the year.";
    const filler =
      "The series viewership stayed strong across digital and television. ".repeat(
        12,
      );
    const before = `I will now move on to the sports business. ${filler}`;
    expect(before.length).toBeGreaterThan(400);
    expect(before.length).toBeLessThan(1000);
    const context = quoteContext(
      [{ role: "management", text: `${before}${quote}` }],
      quote,
    );
    expect(context).toMatch(/sports business/i);

    const rows = adjudicateAll(
      [
        input({
          id: "sports",
          metric: "revenue_growth",
          unit: "qualitative",
          low: null,
          high: null,
          quote,
          context,
          ...openFy27,
          isExplicit: false,
          direction: "qualitative",
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "sports");
    expect(row.verdict).toBeNull();
    expect(row.evidence.interim ?? null).toBeNull();
    expect(row.delivered?.value ?? null).toBeNull();
    expect(JSON.stringify(row.evidence)).not.toMatch(/27\.0/);
  });

  it("does not score Inox Green's EBITDA guide against Inox Wind EBITDA", () => {
    const quote =
      "With all our investments formally folding into Inox Green's balance sheet, along with organic growth, we maintain our FY27 EBITDA guidance to be upwards of INR600 crores.";
    const rows = adjudicateAll(
      [
        input({
          id: "green",
          metric: "ebitda",
          unit: "INR",
          low: 600 * CR,
          high: null,
          quote,
          ...fy26,
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "green");
    expect(row.verdict).not.toBe("beat");
    expect(row.verdict).toBe("unverifiable");
    expect(row.evidence.note).toBe("segment, not the company total");
    expect(row.evidence.scope).toBe("inox green");
    expect(row.delivered?.value ?? null).toBeNull();
    expect(row.evidence.interim ?? null).toBeNull();
  });

  it("clears revenue growth when a later turn calls the same band loan growth", () => {
    const quote =
      "I would say probably between 26%, 27% growth we should deliver now on a full year basis.";
    const question =
      "what would be the growth guidance here onwards for near and medium term?";
    const later =
      "Yes, I was just saying 26%, 27% loan growth guidance is inclusive of all these calibrations that you have already made and are planning to make?";
    const turns = [
      { role: "analyst", text: question },
      { role: "management", text: quote },
      { role: "analyst", text: later },
      { role: "management", text: "Yes." },
    ];
    const context = quoteContext(turns, quote);
    expect(context).toMatch(/loan growth guidance/i);
    expect(context).not.toMatch(/\bAUM\b/);

    const rows = adjudicateAll(
      [
        input({
          id: "loan",
          metric: "revenue_growth",
          unit: "%",
          low: 26,
          high: 27,
          quote,
          context,
          ...openFy27,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "loan");
    expect(row.status).toBe("open");
    expect(row.verdict).toBeNull();
    expect(row.evidence.interim ?? null).toBeNull();
    expect(row.delivered?.value ?? null).toBeNull();

    // Without the later turn the question does not name a different metric.
    const bare = quoteContext(
      [
        { role: "analyst", text: question },
        { role: "management", text: quote },
      ],
      quote,
    );
    expect(bare).not.toMatch(/loan growth/i);
    const kept = adjudicateAll(
      [
        input({
          id: "bare",
          metric: "revenue_growth",
          unit: "%",
          low: 26,
          high: 27,
          quote,
          context: bare,
          ...openFy27,
          comparison: "yoy",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    expect(byId(kept, "bare").evidence.interim ?? null).not.toBeNull();
  });

  it("does not carry the company growth rate on Dixon's ex-Vivo 15% to 17%", () => {
    const quote =
      "We feel that without the Vivo also, the company will keep growing at almost 15% to 17%.";
    // Stored Dixon consolidated revenue, rupees. H1 FY27 / H1 FY26 = 34.9%.
    const fy26 = [
      ["2025-06-30", 128_356_600_000],
      ["2025-09-30", 148_550_400_000],
      ["2025-12-31", 106_715_900_000],
      ["2026-03-31", 105_105_100_000],
    ] as const;
    const fy27h1 = [
      ["2026-06-30", 155_476_600_000],
      ["2026-09-30", 217_936_400_000],
    ] as const;
    const quarters = [
      ...fy26.map(([end, revenue]) => ({
        ...q(end, 1, 1, 1, 1, 1, 1, 1),
        revenue,
      })),
      ...fy27h1.map(([end, revenue]) => ({
        ...q(end, 1, 1, 1, 1, 1, 1, 1),
        revenue,
      })),
      // A smaller prior year, so a due ex-Vivo growth line would have been a beat.
      ...[
        ["2024-06-30", 100_000_000_000],
        ["2024-09-30", 100_000_000_000],
        ["2024-12-31", 100_000_000_000],
        ["2025-03-31", 100_000_000_000],
      ].map(([end, revenue]) => ({
        ...q(end as string, 1, 1, 1, 1, 1, 1, 1),
        revenue: revenue as number,
      })),
    ];
    const ytd = fy27h1[0][1] + fy27h1[1][1];
    const h1Prior = fy26[0][1] + fy26[1][1];
    const companyGrowth = (ytd / h1Prior - 1) * 100;
    expect(companyGrowth).toBeCloseTo(34.9, 1);
    expect(fy26.reduce((s, [, r]) => s + r, 0) / CR).toBeCloseTo(48872.8, 1);
    expect(ytd / CR).toBeCloseTo(37341.3, 1);

    const openFy27 = {
      horizon: "FY27",
      horizonEnd: "2027-03-31",
      docId: "doc_q4fy26",
      statedAt: Date.UTC(2026, 4, 12),
      statedPeriod: "Q4FY26",
      isExplicit: true,
      comparison: "yoy" as const,
    };
    const repaired = {
      isExplicit: true,
      derived: false,
      typeIssue: false,
      typeNote: null,
    };

    const rows = adjudicateAll(
      [
        input({
          id: "vivo",
          metric: "revenue_growth",
          unit: "%",
          low: 15,
          high: 17,
          quote,
          ...openFy27,
        }),
      ],
      quarters,
      TRANSCRIPTS,
      NOW,
    );
    const row = byId(rows, "vivo");
    expect(row.status).toBe("open");
    expect(row.verdict).toBeNull();
    expect(row.verdict).not.toBe("beat");
    expect(row.verdict).not.toBe("missed");
    expect(row.evidence.interim ?? null).toBeNull();
    expect(row.delivered?.value ?? null).toBeNull();
    expect(row.evidence.note).toBe(QUANTITY_NOTE.carved);
    expect(String(row.evidence.scope)).toBe("ex-vivo");
    expect(JSON.stringify(row)).not.toMatch(/34\.9/);
    expect(JSON.stringify(row)).not.toContain(companyGrowth.toFixed(1));
    const stored = mergeLedgerEvidence(
      {
        interim: {
          value: companyGrowth,
          unit: "%",
          note: "2 of 4 quarters of FY27 (YTD): year-on-year, reported INR",
        },
      },
      row,
      repaired,
    );
    expect(stored.interim ?? null).toBeNull();
    expect(JSON.stringify(stored)).not.toMatch(/34\.9/);
    expect(JSON.stringify(stored)).not.toContain("year-on-year, reported INR");

    // The same band, with Vivo not carved out, is the company growth rate.
    const company = adjudicateAll(
      [
        input({
          id: "company",
          metric: "revenue_growth",
          unit: "%",
          low: 15,
          high: 17,
          quote:
            "We feel that the company will keep growing at almost 15% to 17%.",
          ...openFy27,
        }),
      ],
      quarters,
      TRANSCRIPTS,
      NOW,
    );
    expect(
      (byId(company, "company").evidence.interim as { value: number }).value,
    ).toBeCloseTo(companyGrowth, 5);

    // One-off gains are not a business carved out of the total.
    const oneOff = adjudicateAll(
      [
        input({
          id: "oneoff",
          metric: "revenue_growth",
          unit: "%",
          low: 15,
          high: 17,
          quote:
            "Excluding the one-off gains, we expect revenue growth of 15% to 17%.",
          ...openFy27,
        }),
      ],
      quarters,
      TRANSCRIPTS,
      NOW,
    );
    expect(
      (byId(oneOff, "oneoff").evidence.interim as { value: number }).value,
    ).toBeCloseTo(companyGrowth, 5);

    // Due year: the company rate would be a beat. The carved promise is not.
    const due = adjudicateAll(
      [
        input({
          id: "due",
          metric: "revenue_growth",
          unit: "%",
          low: 15,
          high: 17,
          quote,
          horizon: "FY26",
          horizonEnd: "2026-03-31",
          isExplicit: true,
          comparison: "yoy",
        }),
      ],
      quarters,
      TRANSCRIPTS,
      NOW,
    );
    const dueRow = byId(due, "due");
    expect(dueRow.verdict).toBe("unverifiable");
    expect(dueRow.verdict).not.toBe("beat");
    expect(dueRow.verdict).not.toBe("missed");
    expect(dueRow.delivered?.value ?? null).toBeNull();
    expect(dueRow.evidence.interim ?? null).toBeNull();
    expect(dueRow.evidence.note).toBe(QUANTITY_NOTE.carved);
    expect(JSON.stringify(dueRow)).not.toMatch(/34\.9/);

    // ₹56,000 cr without Vivo stays. FY26 reported ₹48,872.8 cr is the
    // ex-Vivo close management called ₹48,800-odd cr, and ₹37,341.3 cr is
    // that series' FY27 year-to-date.
    const level = adjudicateAll(
      [
        input({
          id: "level",
          metric: "revenue",
          unit: "INR",
          low: 56_000 * CR,
          high: 56_000 * CR,
          quote:
            "Next year, we are targeting almost INR56,000 crores without the Vivo numbers, and mobile volume being flat.",
          ...openFy27,
          comparison: "absolute",
        }),
      ],
      quarters,
      TRANSCRIPTS,
      NOW,
    );
    const levelRow = byId(level, "level");
    expect(levelRow.status).toBe("open");
    expect(levelRow.verdict).toBeNull();
    expect((levelRow.evidence.interim as { value: number }).value).toBe(ytd);

    // KPIT's company margin is the company margin. Do not clear it.
    const kpit = adjudicateAll(
      [
        input({
          id: "kpit",
          metric: "ebitda_margin",
          unit: "%",
          low: 20.5,
          high: 21.2,
          quote:
            "EBITDA 20.5 to 21.2 post increasing investment in AI solutions and products competency development and new markets.",
          ...openFy27,
          comparison: "absolute",
        }),
      ],
      QUARTERS,
      TRANSCRIPTS,
      NOW,
    );
    const kpitRow = byId(kpit, "kpit");
    expect(kpitRow.status).toBe("open");
    expect(kpitRow.verdict).toBeNull();
    expect((kpitRow.evidence.interim as { value: number }).value).toEqual(
      expect.any(Number),
    );
  });
});
