import { describe, expect, it } from "vitest";
import {
  buildResultsCard,
  computeResultsCard,
  ebitdaOf,
  pctChange,
  SECONDARY_IDENTITIES,
  selectBasis,
  toCrore,
  ytdCheck,
} from "@/engine/analyse/results";
import type { ResultsBasis, ResultsQuarter } from "@/engine/types";

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
