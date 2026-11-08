/**
 * Results card (owner: Builder B). Pure: ResultsQuarter[] → ResultsCard.
 *
 * Conventions (docs/research/02 §1.4–1.6, 12 §2.5):
 *   - EBITDA (shown) = PBEIT + finance costs + D&A − other income  ("ex_other_income");
 *     the alternative PBEIT + finance costs + D&A is returned as `ebitdaInclOtherIncomeCr`.
 *   - Banks: NII = interest earned − interest expended; PPOP = operating profit before
 *     provisions; EBITDA is not meaningful (interest is the business) → null.
 *   - NBFCs: total income, NII (interest income − finance costs), PPOP (= PBEIT +
 *     impairment), PBT, PAT; EBITDA null for the same reason.
 *   - PBT is the taxonomy's `ProfitBeforeTax` (before share of associates/JV); PAT is
 *     `ProfitLossForPeriod` (after associates, before non-controlling interest).
 *   - QoQ = vs the immediately preceding quarter-end; YoY = vs the same quarter a year
 *     earlier; a comparison is null when the comparative is missing or the signs differ.
 *   - Basis: consolidated preferred; standalone with an explicit label when no consolidated
 *     filing exists for the latest quarter. Banks default to STANDALONE (consolidated folds
 *     in insurance/AMC subsidiaries and HDFC Bank's consolidated XBRL nets minority interest
 *     above PBT) unless only consolidated exists. `preferBasis` overrides when available.
 *   - Verification: every identity of the latest quarter must pass (0.5 % / ₹1 cr tolerance);
 *     `h1Check` = the filing's own YTD vs the sum of this FY's quarters we hold.
 *     A failed half-year is not a pass (`resultsVerified` is false) even when
 *     every quarter identity passed and the source is exchange XBRL.
 */
import {
  fiscalQuarter,
  shiftQuarterEnd,
  withinTolerance,
} from "../ingest/parse-xbrl";
import type {
  ResultsBasis,
  ResultsCard,
  ResultsHeadlineRow,
  ResultsQuarter,
  ResultsVerification,
} from "../types";

export type CardVariant = NonNullable<ResultsCard["variant"]>;

export interface BuildResultsCardOptions {
  /** force a basis when quarters exist for it; otherwise the default rule applies */
  preferBasis?: ResultsBasis;
}

// ---------------------------------------------------------------------------
// Small pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** % change with null-safety; null when the base is 0/null or the signs differ (loss ↔ profit). */
export function pctChange(
  now: number | null,
  base: number | null,
): number | null {
  if (
    now === null ||
    base === null ||
    base === 0 ||
    !Number.isFinite(now) ||
    !Number.isFinite(base)
  )
    return null;
  if (now !== 0 && now < 0 !== base < 0) return null;
  return round2(((now - base) / Math.abs(base)) * 100);
}

export function toCrore(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v / 1e5) / 100;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function delta(now: number | null, base: number | null): number | null {
  if (now === null || base === null) return null;
  return now - base;
}

function ratioPct(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0) return null;
  return round2((num / den) * 100);
}

/** Detect the statement variant from a quarter (checks.variant wins; otherwise infer from the fields). */
export function variantOf(q: ResultsQuarter): CardVariant {
  if (q.checks.variant) return q.checks.variant;
  if (
    q.dna === null &&
    q.checks.nii !== undefined &&
    q.checks.ppop !== undefined
  )
    return "bank";
  if (q.checks.impairment !== undefined) return "nbfc";
  return "corporate";
}

/** EBITDA under both conventions (rupees). Null when the inputs are missing. */
export function ebitdaOf(q: ResultsQuarter): {
  exOtherIncome: number | null;
  inclOtherIncome: number | null;
} {
  const pbeit =
    q.pbeit ?? (q.pbt !== null ? q.pbt - (q.exceptional ?? 0) : null);
  if (pbeit === null || q.financeCosts === null || q.dna === null)
    return { exOtherIncome: null, inclOtherIncome: null };
  const incl = pbeit + q.financeCosts + q.dna;
  return {
    exOtherIncome: q.otherIncome === null ? null : incl - q.otherIncome,
    inclOtherIncome: incl,
  };
}

/** Choose the basis for the card given what exists for the latest quarter. */
export function selectBasis(
  quarters: ResultsQuarter[],
  variant: CardVariant,
  preferBasis?: ResultsBasis,
): { basis: ResultsBasis; note: string | null } | null {
  if (quarters.length === 0) return null;
  const latestEnd = quarters.reduce(
    (m, q) => (q.periodEnd > m ? q.periodEnd : m),
    quarters[0]?.periodEnd ?? "",
  );
  const atLatest = new Set(
    quarters.filter((q) => q.periodEnd === latestEnd).map((q) => q.basis),
  );
  const has = (b: ResultsBasis) => atLatest.has(b);

  if (preferBasis && has(preferBasis))
    return { basis: preferBasis, note: null };
  if (variant === "bank") {
    if (has("standalone"))
      return {
        basis: "standalone",
        note: "standalone (bank convention: consolidated adds insurance/AMC subsidiaries)",
      };
    if (has("consolidated"))
      return {
        basis: "consolidated",
        note: "consolidated — no standalone filing",
      };
  } else {
    if (has("consolidated")) return { basis: "consolidated", note: null };
    if (has("standalone"))
      return {
        basis: "standalone",
        note: "standalone — no consolidated filing",
      };
  }
  const any = quarters.find((q) => q.periodEnd === latestEnd);
  return any ? { basis: any.basis, note: null } : null;
}

/**
 * Identities that gate `identitiesPassed`: the revenue → PAT chain. Secondary
 * identities (owners + NCI, group PAT, PAT incl. associates) describe filer
 * tagging quality and are reported in notes / failedIdentities without
 * un-verifying the headline numbers.
 */
export const SECONDARY_IDENTITIES: ReadonlySet<string> = new Set([
  "pat_eq_owners_plus_nci",
  "patgroup_eq_pat_minus_minority_plus_assoc",
  "pat_total_eq_pat_plus_assoc",
]);

/**
 * The card reads as verified only when the source is exchange XBRL and every
 * gate that was checked passed. A failed half-year (`h1Check === false`) is
 * not a pass. Legacy cards with no verification block follow `checksum`.
 */
export function resultsVerified(card: {
  checksum: "exchange_xbrl" | "preliminary";
  verification?: ResultsVerification;
}): boolean {
  if (card.checksum !== "exchange_xbrl") return false;
  const v = card.verification;
  if (!v) return true;
  if (!v.identitiesPassed) return false;
  if (v.h1Check === false) return false;
  return true;
}

function identitiesOk(q: ResultsQuarter): {
  passed: boolean;
  failed: string[];
  coreFailed: string[];
  secondaryFailed: string[];
} {
  const failed = Object.entries(q.checks.identities ?? {})
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  const coreFailed = failed.filter((k) => !SECONDARY_IDENTITIES.has(k));
  return {
    passed: coreFailed.length === 0,
    failed,
    coreFailed,
    secondaryFailed: failed.filter((k) => SECONDARY_IDENTITIES.has(k)),
  };
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/**
 * Build the results card from any set of quarters (both bases, any order).
 * Returns null when there is no quarter at all.
 */
export function buildResultsCard(
  quarters: ResultsQuarter[],
  preferBasis?: ResultsBasis | BuildResultsCardOptions,
): ResultsCard | null {
  const prefer =
    typeof preferBasis === "string" ? preferBasis : preferBasis?.preferBasis;
  if (quarters.length === 0) return null;
  const variant = variantOf(
    quarters.reduce((m, q) => (q.periodEnd > m.periodEnd ? q : m)),
  );
  const choice = selectBasis(quarters, variant, prefer);
  if (!choice) return null;
  const series = quarters
    .filter((q) => q.basis === choice.basis)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const latest = series[0];
  if (!latest) return null;
  const byEnd = new Map(series.map((q) => [q.periodEnd, q]));
  const prevEnd = shiftQuarterEnd(latest.periodEnd, -1);
  const yoyEnd = shiftQuarterEnd(latest.periodEnd, -4);
  const prev = byEnd.get(prevEnd) ?? null;
  const yoy = byEnd.get(yoyEnd) ?? null;
  const notes: string[] = [];
  if (choice.note) notes.push(choice.note);

  // metric accessors (rupees)
  const income = (q: ResultsQuarter | null): number | null =>
    q === null
      ? null
      : (q.checks.income ??
        (q.revenue !== null && q.otherIncome !== null
          ? q.revenue + q.otherIncome
          : null));
  const metricValue = (
    q: ResultsQuarter | null,
    m: ResultsHeadlineRow["metric"],
  ): number | null => {
    if (!q) return null;
    switch (m) {
      case "revenue":
        return q.revenue;
      case "total_income":
        return income(q);
      case "ebitda":
        return variant === "corporate" ? ebitdaOf(q).exOtherIncome : null;
      case "nii":
        return q.checks.nii ?? null;
      case "ppop":
        return q.checks.ppop ?? null;
      case "pbt":
        return q.pbt;
      case "pat":
        return q.pat;
    }
  };
  const marginBase = (q: ResultsQuarter | null): number | null =>
    variant === "corporate" ? (q?.revenue ?? null) : income(q);

  const headlineMetrics: Array<{
    metric: ResultsHeadlineRow["metric"];
    label: string;
    margin: boolean;
  }> =
    variant === "bank"
      ? [
          { metric: "nii", label: "NII", margin: false },
          { metric: "ppop", label: "PPOP", margin: true },
          { metric: "pbt", label: "PBT", margin: true },
          { metric: "pat", label: "PAT", margin: true },
        ]
      : variant === "nbfc"
        ? [
            { metric: "total_income", label: "Total income", margin: false },
            { metric: "nii", label: "NII", margin: false },
            { metric: "ppop", label: "PPOP", margin: true },
            { metric: "pbt", label: "PBT", margin: true },
            { metric: "pat", label: "PAT", margin: true },
          ]
        : [
            { metric: "revenue", label: "Revenue", margin: false },
            { metric: "ebitda", label: "EBITDA", margin: true },
            { metric: "pbt", label: "PBT", margin: true },
            { metric: "pat", label: "PAT", margin: true },
          ];

  const headline: ResultsHeadlineRow[] = headlineMetrics.map(
    ({ metric, label, margin }) => {
      const cur = metricValue(latest, metric);
      const pv = metricValue(prev, metric);
      const yv = metricValue(yoy, metric);
      return {
        metric,
        label,
        currentCr: toCrore(cur),
        prevQuarterCr: toCrore(pv),
        yoyQuarterCr: toCrore(yv),
        qoqDeltaCr: toCrore(delta(cur, pv)),
        qoqPct: pctChange(cur, pv),
        yoyDeltaCr: toCrore(delta(cur, yv)),
        yoyPct: pctChange(cur, yv),
        marginPct: margin ? ratioPct(cur, marginBase(latest)) : null,
        prevMarginPct: margin ? ratioPct(pv, marginBase(prev)) : null,
        yoyMarginPct: margin ? ratioPct(yv, marginBase(yoy)) : null,
      };
    },
  );

  // legacy contract rows (rupees) — revenue/ebitda/pbt/pat
  const sparkEnds = [4, 3, 2, 1, 0].map((i) =>
    shiftQuarterEnd(latest.periodEnd, -i),
  );
  const rowMetric = (m: "revenue" | "ebitda" | "pbt" | "pat") => {
    const get = (q: ResultsQuarter | null) => metricValue(q, m);
    return {
      metric: m,
      value: get(latest),
      qoqPct: pctChange(get(latest), get(prev)),
      yoyPct: pctChange(get(latest), get(yoy)),
      spark: sparkEnds.map((e) => get(byEnd.get(e) ?? null)),
    };
  };
  const rows: ResultsCard["rows"] = [
    rowMetric("revenue"),
    rowMetric("ebitda"),
    rowMetric("pbt"),
    rowMetric("pat"),
  ];

  // conventions & flags
  const e = ebitdaOf(latest);
  const exc = latest.exceptional;
  const excFlagged =
    exc !== null &&
    exc !== 0 &&
    !latest.checks.minorityAsExceptional &&
    (latest.pbeit === null
      ? Math.abs(exc) >= 1e7
      : Math.abs(exc) > 0.05 * Math.abs(latest.pbeit));
  const excNote = latest.checks.minorityAsExceptional
    ? "exceptional line is minority interest (filer quirk); PBT before minority in checks.pbtBeforeMinority"
    : excFlagged
      ? `exceptional items ${toCrore(exc)} cr (${latest.pbeit ? round2((Math.abs(exc ?? 0) / Math.abs(latest.pbeit)) * 100) : "?"} % of PBEIT) — PBT/PAT include them`
      : null;
  if (excNote) notes.push(excNote);
  if (
    latest.checks.assocShare &&
    latest.pbt &&
    Math.abs(latest.checks.assocShare) > 0.02 * Math.abs(latest.pbt)
  )
    notes.push(
      `PBT excludes share of associates/JV (${toCrore(latest.checks.assocShare)} cr); PAT includes it`,
    );
  if (
    variant === "corporate" &&
    latest.otherIncome !== null &&
    latest.pbt &&
    latest.otherIncome > 0.1 * Math.abs(latest.pbt)
  )
    notes.push(
      `other income ${toCrore(latest.otherIncome)} cr is >10 % of PBT`,
    );
  if (
    yoy &&
    latest.checks.faceValue &&
    yoy.checks.faceValue &&
    latest.checks.faceValue !== yoy.checks.faceValue
  )
    notes.push(
      `face value changed ${yoy.checks.faceValue} → ${latest.checks.faceValue}; EPS not comparable YoY`,
    );
  if (!prev)
    notes.push(
      `no ${fiscalQuarter(prevEnd).label} filing on this basis — QoQ unavailable`,
    );
  if (!yoy)
    notes.push(
      `no ${fiscalQuarter(yoyEnd).label} filing on this basis — YoY unavailable`,
    );
  if (prev && prev.source !== latest.source)
    notes.push(`QoQ comparative comes from the ${prev.source} source`);
  if (yoy && yoy.source !== latest.source)
    notes.push(`YoY comparative comes from the ${yoy.source} source`);

  // verification
  const idents = identitiesOk(latest);
  if (!idents.passed)
    notes.push(`identity checks failed: ${idents.coreFailed.join(", ")}`);
  if (idents.secondaryFailed.length)
    notes.push(
      `secondary identity failed (filer tagging; headline unaffected): ${idents.secondaryFailed.join(", ")}`,
    );
  for (const q of [prev, yoy]) {
    if (!q) continue;
    const r = identitiesOk(q);
    if (!r.passed)
      notes.push(
        `${fiscalQuarter(q.periodEnd).label} comparative failed: ${r.coreFailed.join(", ")}`,
      );
  }
  const h1 = ytdCheck(latest, byEnd, variant);
  if (h1.note) notes.push(h1.note);
  // parser warnings, minus the ones the card already states in its own words
  for (const w of latest.checks.warnings)
    if (
      !notes.includes(w) &&
      !/ISIN mismatch|^PBT excludes share of associates|^exceptional items/.test(
        w,
      )
    )
      notes.push(w);

  const verification: ResultsVerification = {
    source: latest.source,
    identitiesPassed: idents.passed,
    ...(h1.result === undefined ? {} : { h1Check: h1.result }),
    failedIdentities: idents.failed,
    notes,
  };

  const auditLabel =
    latest.audited === null
      ? "Audit status n/a"
      : latest.audited
        ? "Audited"
        : "Unaudited";
  const basisWord =
    choice.basis === "consolidated" ? "Consolidated" : "Standalone";

  return {
    isin: latest.isin,
    basis: choice.basis,
    checksum: latest.source === "pdf" ? "preliminary" : "exchange_xbrl",
    rows,
    ebitdaFormula: "pbt+fin+dna-oi",
    sourceUrl: latest.sourceUrl,
    variant,
    periodEnd: latest.periodEnd,
    fiscalLabel: fiscalQuarter(latest.periodEnd).label,
    prevPeriodEnd: prev ? prev.periodEnd : null,
    yoyPeriodEnd: yoy ? yoy.periodEnd : null,
    headline,
    ebitdaConvention: "ex_other_income",
    ebitdaInclOtherIncomeCr:
      variant === "corporate" ? toCrore(e.inclOtherIncome) : null,
    margins: {
      ebitdaPct:
        variant === "corporate"
          ? ratioPct(e.exOtherIncome, latest.revenue)
          : null,
      patPct: ratioPct(latest.pat, marginBase(latest)),
      pbtPct: ratioPct(latest.pbt, marginBase(latest)),
    },
    exceptional: {
      currentCr: toCrore(exc),
      flagged: excFlagged,
      note: excNote,
    },
    basisLabel: `${basisWord} · ${auditLabel} · ₹ cr`,
    basisNote: choice.note,
    verification,
    filedAtMs: latest.filedAt,
    quartersAvailable: series.length,
    epsCurrent: latest.eps,
    epsYoy: yoy ? yoy.eps : null,
    gnpaPct: latest.checks.gnpaPct ?? null,
    nnpaPct: latest.checks.nnpaPct ?? null,
  };
}

/**
 * The filing's own YTD vs the sum of the fiscal year's quarters we hold on the same
 * basis (Q1+Q2 for an H1 filing, Q1..Q3 for 9M, Q1..Q4 for FY). Undefined when the
 * filing is Q1 (YTD == quarter) or when a needed quarter is missing.
 */
export function ytdCheck(
  latest: ResultsQuarter,
  byEnd: Map<string, ResultsQuarter>,
  variant: CardVariant,
): { result: boolean | undefined; note: string | null } {
  const ytd = latest.checks.ytd;
  if (!ytd || ytd.days <= 100) return { result: undefined, note: null };
  const fq = fiscalQuarter(latest.periodEnd);
  const needed: ResultsQuarter[] = [];
  for (let i = 1; i < fq.q; i++) {
    const q = byEnd.get(shiftQuarterEnd(latest.periodEnd, -i));
    if (!q)
      return {
        result: undefined,
        note: `YTD check skipped — ${fiscalQuarter(shiftQuarterEnd(latest.periodEnd, -i)).label} not available`,
      };
    needed.push(q);
  }
  const all = [latest, ...needed];
  const sumOf = (
    pick: (q: ResultsQuarter) => number | null | undefined,
  ): number | null => {
    let s = 0;
    for (const q of all) {
      const v = pick(q);
      if (v === null || v === undefined) return null;
      s += v;
    }
    return s;
  };
  const comparisons: Array<[string, number | null, number | null]> = [
    ["revenue", sumOf((q) => q.revenue), ytd.revenue],
    ["pbt", sumOf((q) => q.pbt), ytd.pbt],
    ["pat", sumOf((q) => q.pat), ytd.pat],
  ];
  if (variant !== "corporate")
    comparisons.push(["nii", sumOf((q) => q.checks.nii), ytd.nii]);
  const checked = comparisons.filter(
    ([, a, b]) => a !== null && b !== null,
  ) as Array<[string, number, number]>;
  if (checked.length === 0) return { result: undefined, note: null };
  const failed = checked.filter(([, a, b]) => !withinTolerance(a, b));
  const label = fq.q === 2 ? "H1" : fq.q === 3 ? "9M" : "FY";
  if (failed.length === 0)
    return {
      result: true,
      note: `${label} check passed (sum of ${all.length} quarters = filing YTD)`,
    };
  const gapLine =
    failed.find(([k]) => k === "pat") ?? failed.find(([k]) => k === "pbt");
  const gap = gapLine ? Math.abs(gapLine[1] - gapLine[2]) : null;
  let because = "a prior quarter was restated or mis-parsed";
  if (gap !== null) {
    for (const q of all) {
      const nci = q.checks.nci;
      if (nci == null || nci === 0) continue;
      if (withinTolerance(gap, Math.abs(nci))) {
        because = `the gap equals minority interest of ${toCrore(Math.abs(nci))} cr in ${fiscalQuarter(q.periodEnd).label}`;
        break;
      }
    }
  }
  return {
    result: false,
    note: `${label} check failed on ${failed
      .map(([k, a, b]) => `${k} ${toCrore(a)} vs ${toCrore(b)} cr`)
      .join("; ")} — ${because}`,
  };
}

/** Contract: card for an explicit basis (no fallback); null when that basis has no quarter. */
export function computeResultsCard(
  quarters: ResultsQuarter[],
  basis: ResultsBasis,
): ResultsCard | null {
  const subset = quarters.filter((q) => q.basis === basis);
  if (subset.length === 0) return null;
  return buildResultsCard(subset, basis);
}
