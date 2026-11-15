import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildResultsCard,
  computeResultsCard,
  ebitdaOf,
  pctChange,
  resultsVerified,
  SECONDARY_IDENTITIES,
  selectBasis,
  toCrore,
  ytdCheck,
} from "@/engine/analyse/results";
import type { ResultsBasis, ResultsQuarter } from "@/engine/types";
import { verificationForSnapshot } from "@/lib/queries";
import { quartersUpToFiling, quotedPeriodEnd } from "@/lib/resultsAlign";
import { ResultsGrid, snapshotChip } from "@/ui/ResultsGrid";

const CR = 1e7;

/** Build a consistent corporate quarter from crore inputs. */
function corp(
  periodEnd: string,
  v: {
    rev: number;
    oi: number;
    fc: number;
    dna: number;
    pbeit: number;
    exc?: number;
    tax: number;
    assoc?: number;
  },
  over: Partial<ResultsQuarter> = {},
): ResultsQuarter {
  const exc = v.exc ?? 0;
  const pbt = v.pbeit + exc;
  const patCont = pbt - v.tax;
  const pat = patCont + (v.assoc ?? 0);
  const expenses = v.rev + v.oi - v.pbeit;
  return {
    isin: "INE000A00000",
    periodEnd,
    basis: "consolidated",
    source: "xbrl",
    audited: false,
    revenue: v.rev * CR,
    otherIncome: v.oi * CR,
    financeCosts: v.fc * CR,
    dna: v.dna * CR,
    pbeit: v.pbeit * CR,
    exceptional: exc * CR,
    pbt: pbt * CR,
    tax: v.tax * CR,
    pat: pat * CR,
    patCont: patCont * CR,
    eps: 10,
    checks: {
      warnings: [],
      identities: {
        income_eq_rev_plus_oi: true,
        pbeit_eq_income_minus_expenses: true,
        pbt_eq_pbeit_plus_exceptional: true,
        patcont_eq_pbt_minus_tax: true,
      },
      variant: "corporate",
      income: (v.rev + v.oi) * CR,
      expenses: expenses * CR,
      assocShare: (v.assoc ?? 0) * CR,
      faceValue: 10,
    },
    sourceUrl: `https://x/${periodEnd}-${over.basis ?? "consolidated"}.xml`,
    filedAt: 1_700_000_000_000,
    ...over,
  };
}

// Reliance-like series (₹ cr): Q2 FY26 … Q2 FY27 consolidated
const Q2FY26 = corp("2025-09-30", {
  rev: 258898,
  oi: 4482,
  fc: 6827,
  dna: 14416,
  pbeit: 29124,
  tax: 6978,
  assoc: -54,
});
const Q3FY26 = corp("2025-12-31", {
  rev: 269496,
  oi: 4000,
  fc: 6500,
  dna: 14500,
  pbeit: 29697,
  tax: 7200,
});
const Q4FY26 = corp(
  "2026-03-31",
  {
    rev: 298621,
    oi: 4447,
    fc: 6585,
    dna: 14808,
    pbeit: 27195,
    tax: 6579,
    assoc: -27,
  },
  { audited: true },
);
const Q1FY27 = corp("2026-06-30", {
  rev: 311850,
  oi: 6550,
  fc: 8337,
  dna: 15100,
  pbeit: 30630,
  tax: 7629,
  assoc: 195,
});
const Q2FY27 = corp("2026-09-30", {
  rev: 332861,
  oi: 5793,
  fc: 8481,
  dna: 15315,
  pbeit: 38613,
  tax: 9363,
  assoc: 300,
});
Q2FY27.checks.ytd = {
  start: "2026-04-01",
  end: "2026-09-30",
  days: 183,
  revenue: (332861 + 311850) * CR,
  income: null,
  pbt: (38613 + 30630) * CR,
  pat: (29550 + 23196) * CR,
  nii: null,
  ppop: null,
};

describe("pctChange", () => {
  it("handles nulls, zero bases and sign flips", () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(null, 100)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(50, -100)).toBeNull(); // loss → profit is not a percentage
    expect(pctChange(-50, -100)).toBe(50); // smaller loss = +50 %
    expect(pctChange(-150, -100)).toBe(-50);
    expect(pctChange(0, -100)).toBe(100);
  });
  it("toCrore rounds to 2 dp", () => {
    expect(toCrore(3328610000000)).toBe(332861);
    expect(toCrore(123456789)).toBe(12.35);
    expect(toCrore(null)).toBeNull();
  });
});

describe("ebitdaOf", () => {
  it("returns both conventions", () => {
    const e = ebitdaOf(Q2FY27);
    expect(toCrore(e.exOtherIncome)).toBe(56616); // 38613 + 8481 + 15315 − 5793
    expect(toCrore(e.inclOtherIncome)).toBe(62409);
  });
  it("is null when inputs are missing", () => {
    expect(ebitdaOf({ ...Q2FY27, dna: null }).exOtherIncome).toBeNull();
  });
});

describe("buildResultsCard — corporate", () => {
  const card = buildResultsCard([Q4FY26, Q2FY26, Q2FY27, Q1FY27, Q3FY26]);

  it("picks the latest quarter, labels it and prefers consolidated", () => {
    expect(card).not.toBeNull();
    expect(card?.fiscalLabel).toBe("Q2 FY27");
    expect(card?.periodEnd).toBe("2026-09-30");
    expect(card?.basis).toBe("consolidated");
    expect(card?.basisLabel).toBe("Consolidated · Unaudited · ₹ cr");
    expect(card?.variant).toBe("corporate");
    expect(card?.checksum).toBe("exchange_xbrl");
    expect(card?.quartersAvailable).toBe(5);
    expect(card?.prevPeriodEnd).toBe("2026-06-30");
    expect(card?.yoyPeriodEnd).toBe("2025-09-30");
  });

  it("computes QoQ / YoY deltas in ₹ cr and %, plus margins", () => {
    const rows = Object.fromEntries(
      (card?.headline ?? []).map((r) => [r.metric, r]),
    );
    expect(rows.revenue).toMatchObject({
      currentCr: 332861,
      prevQuarterCr: 311850,
      yoyQuarterCr: 258898,
    });
    expect(rows.revenue?.qoqDeltaCr).toBe(21011);
    expect(rows.revenue?.qoqPct).toBe(6.74);
    expect(rows.revenue?.yoyPct).toBe(28.57);
    expect(rows.revenue?.marginPct).toBeNull();
    expect(rows.ebitda?.currentCr).toBe(56616);
    expect(rows.ebitda?.prevQuarterCr).toBe(47517);
    expect(rows.ebitda?.marginPct).toBe(17.01);
    expect(rows.pbt?.currentCr).toBe(38613);
    expect(rows.pat?.currentCr).toBe(29550);
    expect(rows.pat?.yoyQuarterCr).toBe(22092);
    expect(rows.pat?.yoyPct).toBe(33.76);
    expect(card?.margins).toEqual({
      ebitdaPct: 17.01,
      patPct: 8.88,
      pbtPct: 11.6,
    });
    expect(card?.ebitdaConvention).toBe("ex_other_income");
    expect(card?.ebitdaInclOtherIncomeCr).toBe(62409);
  });

  it("fills the legacy contract rows in rupees with a 5-quarter spark (oldest first)", () => {
    const rev = card?.rows.find((r) => r.metric === "revenue");
    expect(rev?.value).toBe(332861 * CR);
    expect(rev?.qoqPct).toBe(6.74);
    expect(rev?.spark.map((v) => (v === null ? null : v / CR))).toEqual([
      258898, 269496, 298621, 311850, 332861,
    ]);
    expect(card?.ebitdaFormula).toBe("pbt+fin+dna-oi");
  });

  it("verifies identities and the H1 (Q1+Q2 vs YTD) check", () => {
    expect(card?.verification?.identitiesPassed).toBe(true);
    expect(card?.verification?.h1Check).toBe(true);
    expect(card && resultsVerified(card)).toBe(true);
    expect(card?.verification?.source).toBe("xbrl");
    expect(
      card?.verification?.notes.some((n) => /H1 check passed/.test(n)),
    ).toBe(true);
    expect(card?.exceptional?.flagged).toBe(false);
  });

  it("flags a failed YTD check and a missing quarter", () => {
    const bad = {
      ...Q2FY27,
      checks: {
        ...Q2FY27.checks,
        ytd: {
          ...(Q2FY27.checks.ytd as NonNullable<
            ResultsQuarter["checks"]["ytd"]
          >),
          pat: 40000 * CR,
        },
      },
    };
    const byEnd = new Map([
      [bad.periodEnd, bad],
      [Q1FY27.periodEnd, Q1FY27],
    ]);
    expect(ytdCheck(bad, byEnd, "corporate").result).toBe(false);
    expect(
      ytdCheck(Q2FY27, new Map([[Q2FY27.periodEnd, Q2FY27]]), "corporate"),
    ).toMatchObject({ result: undefined });
    expect(ytdCheck(Q1FY27, new Map(), "corporate").result).toBeUndefined();
  });

  it("sets identitiesPassed=false (and names the identity) when a core identity fails; secondary ones only annotate", () => {
    const broken = {
      ...Q2FY27,
      checks: {
        ...Q2FY27.checks,
        identities: {
          ...Q2FY27.checks.identities,
          patcont_eq_pbt_minus_tax: false,
        },
      },
    };
    const c1 = buildResultsCard([broken, Q1FY27, Q2FY26]);
    expect(c1?.verification?.identitiesPassed).toBe(false);
    expect(c1 && resultsVerified(c1)).toBe(false);
    expect(c1?.verification?.failedIdentities).toEqual([
      "patcont_eq_pbt_minus_tax",
    ]);
    const secondary = {
      ...Q2FY27,
      checks: {
        ...Q2FY27.checks,
        identities: {
          ...Q2FY27.checks.identities,
          pat_eq_owners_plus_nci: false,
        },
      },
    };
    const c2 = buildResultsCard([secondary, Q1FY27, Q2FY26]);
    expect(SECONDARY_IDENTITIES.has("pat_eq_owners_plus_nci")).toBe(true);
    expect(c2?.verification?.identitiesPassed).toBe(true);
    expect(c2?.verification?.failedIdentities).toEqual([
      "pat_eq_owners_plus_nci",
    ]);
    expect(
      c2?.verification?.notes.some((n) => /secondary identity/.test(n)),
    ).toBe(true);
  });

  it("flags material exceptional items and explains the EBITDA/PBT conventions", () => {
    const withExc = corp("2026-09-30", {
      rev: 1000,
      oi: 10,
      fc: 20,
      dna: 30,
      pbeit: 100,
      exc: -40,
      tax: 15,
    });
    const c = buildResultsCard([withExc]);
    expect(c?.exceptional).toMatchObject({ currentCr: -40, flagged: true });
    expect(c?.headline?.find((r) => r.metric === "pbt")?.currentCr).toBe(60);
    expect(c?.headline?.find((r) => r.metric === "ebitda")?.currentCr).toBe(
      140,
    ); // 100 + 20 + 30 − 10, exceptional excluded
    expect(
      c?.verification?.notes.some((n) => /no Q1 FY27 filing/.test(n)),
    ).toBe(true);
  });

  it("returns null QoQ/YoY when comparatives are missing and null for no quarters", () => {
    const c = buildResultsCard([Q2FY27]);
    expect(c?.headline?.[0]?.qoqPct).toBeNull();
    expect(c?.headline?.[0]?.yoyPct).toBeNull();
    expect(buildResultsCard([])).toBeNull();
  });

  it("notes an EPS discontinuity on a face-value change", () => {
    const yoy = { ...Q2FY26, checks: { ...Q2FY26.checks, faceValue: 2 } };
    const c = buildResultsCard([Q2FY27, yoy]);
    expect(
      c?.verification?.notes.some((n) => /face value changed 2 → 10/.test(n)),
    ).toBe(true);
  });
});

describe("basis selection", () => {
  const cons = Q2FY27;
  const stand = corp(
    "2026-09-30",
    { rev: 174668, oi: 3899, fc: 1953, dna: 3994, pbeit: 20339, tax: 4985 },
    { basis: "standalone" },
  );
  const standOnlyLatest = corp(
    "2026-12-31",
    { rev: 100, oi: 1, fc: 1, dna: 1, pbeit: 10, tax: 2 },
    { basis: "standalone" },
  );

  it("prefers consolidated, falls back to standalone with an explicit note, honours preferBasis", () => {
    expect(selectBasis([cons, stand], "corporate")).toEqual({
      basis: "consolidated",
      note: null,
    });
    expect(selectBasis([stand], "corporate")).toEqual({
      basis: "standalone",
      note: "standalone — no consolidated filing",
    });
    expect(selectBasis([cons, stand], "corporate", "standalone")).toEqual({
      basis: "standalone",
      note: null,
    });
    expect(
      buildResultsCard([cons, stand], "standalone")?.headline?.[0]?.currentCr,
    ).toBe(174668);
    expect(
      buildResultsCard([cons, stand], { preferBasis: "standalone" })?.basis,
    ).toBe("standalone");
  });

  it("decides on what exists for the LATEST quarter", () => {
    const sel = selectBasis([cons, stand, standOnlyLatest], "corporate");
    expect(sel?.basis).toBe("standalone");
    expect(sel?.note).toMatch(/no consolidated/);
  });

  it("banks default to standalone unless only consolidated exists", () => {
    expect(selectBasis([cons, stand], "bank")?.basis).toBe("standalone");
    expect(selectBasis([cons], "bank")).toEqual({
      basis: "consolidated",
      note: "consolidated — no standalone filing",
    });
  });

  it("computeResultsCard contract is strict about the basis", () => {
    expect(computeResultsCard([cons], "standalone" as ResultsBasis)).toBeNull();
    expect(computeResultsCard([cons, stand], "standalone")?.basis).toBe(
      "standalone",
    );
  });
});

describe("buildResultsCard — bank and NBFC variants", () => {
  const bank = (
    periodEnd: string,
    ie: number,
    ix: number,
    oi: number,
    opex: number,
    prov: number,
    tax: number,
  ): ResultsQuarter => {
    const ppop = ie + oi - ix - opex;
    const pbt = ppop - prov;
    return {
      isin: "INE040A01034",
      periodEnd,
      basis: "standalone",
      source: "xbrl",
      audited: false,
      revenue: ie * CR,
      otherIncome: oi * CR,
      financeCosts: ix * CR,
      dna: null,
      pbeit: pbt * CR,
      exceptional: 0,
      pbt: pbt * CR,
      tax: tax * CR,
      pat: (pbt - tax) * CR,
      patCont: (pbt - tax) * CR,
      eps: 12,
      checks: {
        warnings: [],
        identities: {
          income_eq_interest_plus_oi: true,
          pbt_eq_ppop_minus_prov_plus_exc: true,
          pat_eq_pbt_minus_tax: true,
        },
        variant: "bank",
        income: (ie + oi) * CR,
        nii: (ie - ix) * CR,
        ppop: ppop * CR,
        provisions: prov * CR,
        gnpaPct: 1.11,
        nnpaPct: 0.37,
      },
      sourceUrl: "https://x/bank.xml",
      filedAt: 1_700_000_000_000,
    };
  };
  const b2 = bank(
    "2026-09-30",
    83426.6,
    48807.42,
    13831.02,
    18966.78,
    3573.62,
    6399.84,
  );
  const b1 = bank(
    "2026-06-30",
    79362.78,
    45828.83,
    12821.6,
    18187.49,
    3059.76,
    6048.58,
  );
  const b0 = bank(
    "2025-09-30",
    76690.7,
    45139.2,
    14350.02,
    17977.92,
    3500.53,
    5781.79,
  );

  it("shows NII / PPOP / PBT / PAT with margins on total income and surfaces NPA ratios", () => {
    const c = buildResultsCard([b0, b1, b2]);
    expect(c?.variant).toBe("bank");
    expect(c?.headline?.map((r) => r.metric)).toEqual([
      "nii",
      "ppop",
      "pbt",
      "pat",
    ]);
    const nii = c?.headline?.find((r) => r.metric === "nii");
    expect(nii?.currentCr).toBe(34619.18);
    expect(nii?.qoqPct).toBe(3.24);
    expect(nii?.yoyPct).toBe(9.72);
    expect(c?.headline?.find((r) => r.metric === "ppop")?.currentCr).toBe(
      29483.42,
    );
    expect(c?.headline?.find((r) => r.metric === "pat")?.currentCr).toBe(
      19509.96,
    );
    expect(c?.headline?.find((r) => r.metric === "pat")?.marginPct).toBe(20.06);
    expect(c?.rows.find((r) => r.metric === "ebitda")?.value).toBeNull();
    expect(c?.ebitdaInclOtherIncomeCr).toBeNull();
    expect(c?.gnpaPct).toBe(1.11);
    expect(c?.basisNote).toMatch(/bank convention/);
  });

  it("NBFC variant leads with total income, NII and PPOP", () => {
    const n: ResultsQuarter = {
      ...corp("2026-09-30", {
        rev: 24546.37,
        oi: 29.45,
        fc: 8601.73,
        dna: 321.07,
        pbeit: 8533.47,
        tax: 2170.63,
        assoc: 3.73,
      }),
      checks: {
        warnings: [],
        identities: { income_eq_rev_plus_oi: true },
        variant: "nbfc",
        income: 24575.82 * CR,
        interestIncome: 21936.39 * CR,
        impairment: 2166.09 * CR,
        nii: 13334.66 * CR,
        ppop: 10699.56 * CR,
      },
    };
    const c = buildResultsCard([n]);
    expect(c?.variant).toBe("nbfc");
    expect(c?.headline?.map((r) => r.label)).toEqual([
      "Total income",
      "NII",
      "PPOP",
      "PBT",
      "PAT",
    ]);
    expect(c?.headline?.[0]?.currentCr).toBe(24575.82);
    expect(c?.headline?.find((r) => r.metric === "pat")?.marginPct).toBe(25.91);
  });

  it("marks PDF-sourced quarters as preliminary", () => {
    const c = buildResultsCard([{ ...b2, source: "pdf", audited: null }]);
    expect(c?.checksum).toBe("preliminary");
    expect(c?.verification?.source).toBe("pdf");
    expect(c?.basisLabel).toBe("Standalone · Audit status n/a · ₹ cr");
  });
});

describe("HDFC consolidated half-year", () => {
  /** Stored Q1/Q2 FY27 consolidated crores. Q1 PAT includes ₹1,137.98 cr of NCI. */
  function hdfc(
    periodEnd: string,
    v: {
      rev: number;
      nii: number;
      ppop: number;
      pbt: number;
      pat: number;
      nci?: number;
      ytd?: ResultsQuarter["checks"]["ytd"];
    },
    basis: ResultsBasis = "consolidated",
  ): ResultsQuarter {
    return {
      isin: "INE040A01034",
      periodEnd,
      basis,
      source: "xbrl",
      audited: false,
      revenue: v.rev * CR,
      otherIncome: null,
      financeCosts: null,
      dna: null,
      pbeit: v.pbt * CR,
      exceptional: 0,
      pbt: v.pbt * CR,
      tax: (v.pbt - v.pat) * CR,
      pat: v.pat * CR,
      patCont: v.pat * CR,
      eps: null,
      checks: {
        warnings: [],
        identities: {
          income_eq_interest_plus_oi: true,
          expenditure_eq_intexp_plus_opex: true,
          ppop_eq_income_minus_expenditure: true,
          pbt_eq_ppop_minus_prov_plus_exc: true,
          pat_eq_pbt_minus_tax: true,
        },
        variant: "bank",
        nii: v.nii * CR,
        ppop: v.ppop * CR,
        nci: v.nci == null ? undefined : v.nci * CR,
        patOwners: v.nci == null ? v.pat * CR : (v.pat - v.nci) * CR,
        ...(v.ytd ? { ytd: v.ytd } : {}),
      },
      sourceUrl: "https://x/hdfc.xml",
      filedAt: 1_700_000_000_000,
    };
  }

  const q1 = hdfc("2026-06-30", {
    rev: 90575.33,
    nii: 42949.7,
    ppop: 30996,
    pbt: 27193.16,
    pat: 20382.69,
    nci: 1137.98,
  });
  const q2 = hdfc("2026-09-30", {
    rev: 95131.63,
    nii: 44464.2,
    ppop: 32871.54,
    pbt: 27825.48,
    pat: 20700.03,
    nci: 0,
    ytd: {
      start: "2026-04-01",
      end: "2026-09-30",
      days: 183,
      revenue: 185706.96 * CR,
      income: null,
      pbt: 53880.66 * CR,
      pat: 39944.74 * CR,
      nii: 87413.9 * CR,
      ppop: null,
    },
  });
  const standQ1 = hdfc(
    "2026-06-30",
    {
      rev: 79362.78,
      nii: 33533.95,
      ppop: 28168.06,
      pbt: 25108.3,
      pat: 19059.72,
    },
    "standalone",
  );
  const standQ2 = hdfc(
    "2026-09-30",
    {
      rev: 83426.6,
      nii: 34619.18,
      ppop: 29483.42,
      pbt: 25909.8,
      pat: 19509.96,
      ytd: {
        start: "2026-04-01",
        end: "2026-09-30",
        days: 183,
        revenue: 162789.38 * CR,
        income: null,
        pbt: 51018.1 * CR,
        pat: 38569.68 * CR,
        nii: 68153.13 * CR,
        ppop: null,
      },
    },
    "standalone",
  );

  it("keeps the consolidated print and does not call a failed half-year verified", () => {
    // The page asks for consolidated. Standalone is a different row; selecting
    // it is the bank default when both bases are offered, and is not this fix.
    expect(selectBasis([q2, q1, standQ2, standQ1], "bank")?.basis).toBe(
      "standalone",
    );
    const card = computeResultsCard([q2, q1, standQ2, standQ1], "consolidated");
    expect(card?.basis).toBe("consolidated");
    expect(card?.headline?.map((r) => [r.metric, r.currentCr])).toEqual([
      ["nii", 44464.2],
      ["ppop", 32871.54],
      ["pbt", 27825.48],
      ["pat", 20700.03],
    ]);
    expect(card?.verification?.identitiesPassed).toBe(true);
    expect(card?.verification?.h1Check).toBe(false);
    expect(card && resultsVerified(card)).toBe(false);
    expect(card?.verification?.notes.join(" ")).toMatch(
      /H1 check failed on pbt 55018\.64 vs 53880\.66 cr; pat 41082\.72 vs 39944\.74 cr/,
    );
    expect(card?.verification?.notes.join(" ")).toMatch(
      /minority interest of 1137\.98 cr in Q1 FY27/,
    );
    const html = renderToStaticMarkup(
      createElement(ResultsGrid, { card: card as NonNullable<typeof card> }),
    );
    expect(html).not.toContain("Exchange XBRL verified");
    expect(html).toContain("H1 check failed");
    expect(html).toContain("minority interest of 1137.98 cr in Q1 FY27");
    expect(html).toContain("44,464");
    expect(html).toContain("20,700");
    const verification = verificationForSnapshot([q2, q1, standQ2, standQ1], {
      periodEnd: q2.periodEnd,
      basis: "consolidated",
    });
    const chip = snapshotChip({
      checksum: "exchange_xbrl",
      verification,
    });
    expect(chip.label).toBe("H1 check failed");
    expect(chip.label).not.toContain("XBRL verified");
    expect(chip.tone).toBe("warn");
    expect(chip.title).toMatch(
      /H1 check failed on pbt 55018\.64 vs 53880\.66 cr; pat 41082\.72 vs 39944\.74 cr/,
    );
    expect(
      ytdCheck(
        standQ2,
        new Map([
          [standQ2.periodEnd, standQ2],
          [standQ1.periodEnd, standQ1],
        ]),
        "bank",
      ).result,
    ).toBe(true);
  });

  it("keeps Reliance verified when the half-year matches to the rupee", () => {
    const card = buildResultsCard([Q4FY26, Q2FY26, Q2FY27, Q1FY27, Q3FY26]);
    expect(card?.headline?.find((r) => r.metric === "revenue")?.currentCr).toBe(
      332861,
    );
    expect(card?.headline?.find((r) => r.metric === "ebitda")?.currentCr).toBe(
      56616,
    );
    expect(card?.headline?.find((r) => r.metric === "pbt")?.currentCr).toBe(
      38613,
    );
    expect(card?.headline?.find((r) => r.metric === "pat")?.currentCr).toBe(
      29550,
    );
    expect(card?.verification?.h1Check).toBe(true);
    expect(card && resultsVerified(card)).toBe(true);
    const html = renderToStaticMarkup(
      createElement(ResultsGrid, { card: card as NonNullable<typeof card> }),
    );
    expect(html).toContain("Exchange XBRL verified");
    expect(html).toContain("Q1 + Q2 = H1");
    expect(html).not.toContain("H1 check failed");
    const verification = verificationForSnapshot(
      [Q4FY26, Q2FY26, Q2FY27, Q1FY27, Q3FY26],
      { periodEnd: "2026-09-30", basis: "consolidated" },
    );
    const chip = snapshotChip({
      checksum: "exchange_xbrl",
      verification,
    });
    expect(chip.label).toBe("XBRL verified");
    expect(chip.tone).toBe("up");
    expect(snapshotChip({ checksum: "preliminary", verification }).label).toBe(
      "Preliminary",
    );
  });
});

describe("filing quarter vs XBRL grid", () => {
  it("does not render a Q1 grid as Exchange XBRL verified under a Q2 title", () => {
    const card = buildResultsCard([Q1FY27]);
    expect(card?.periodEnd).toBe("2026-06-30");
    expect(card?.fiscalLabel).toBe("Q1 FY27");
    expect(quotedPeriodEnd("Q2 FY27 results filed")).toBe("2026-09-30");
    expect(quartersUpToFiling([Q1FY27], "Q2 FY27 results filed")).toBeNull();
    const mismatch = renderToStaticMarkup(
      createElement(ResultsGrid, {
        card: card as NonNullable<typeof card>,
        filingTitle: "Q2 FY27 results filed",
      }),
    );
    expect(mismatch).not.toContain("Exchange XBRL verified");
    expect(mismatch).toContain("XBRL on file is Q1 FY27");
    const match = renderToStaticMarkup(
      createElement(ResultsGrid, {
        card: card as NonNullable<typeof card>,
        filingTitle: "Q1 FY27 results filed",
      }),
    );
    expect(match).toContain("Exchange XBRL verified");
    const compact = renderToStaticMarkup(
      createElement(ResultsGrid, {
        card: card as NonNullable<typeof card>,
        filingTitle: "Q2 FY27 results filed",
        showMeta: false,
        compactMeta: true,
      }),
    );
    expect(compact).not.toContain("XBRL ✓");
    expect(compact).toContain("XBRL on file is Q1 FY27");
  });
});
