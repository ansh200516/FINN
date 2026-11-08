/**
 * NSE/BSE results XBRL → ResultsQuarter (pure; owner: Builder B).
 *
 * Handles both generations of the Indian results taxonomy:
 *   - SEBI Integrated Filing (`in-capmkt`, 2026-01-31): INTEGRATED_FILING_INDAS_ /
 *     _NBFC_INDAS_ / _BANKING_ files, Mar-2025 onward;
 *   - legacy BSE taxonomy (`in-bse-fin`, 2019/2020): INDAS_ / NBFC_INDAS_ / BANKING_
 *     files from /api/corporates-financial-results, quarters ≤ Dec-2024.
 *
 * Facts verified on real filings (8 Nov 2026):
 *   - money facts are ABSOLUTE RUPEES (`unitRef="INR"`, `decimals="-7"`), whatever
 *     `LevelOfRounding` says; ratios are `pure` fractions (GNPA 1.11 % = 0.0111);
 *   - each instance holds only the current quarter (`OneD`) and the fiscal YTD
 *     (`FourD`) — comparatives come from earlier filings;
 *   - dimensional contexts (segments, expense break-ups, RPTs) use `xbrli:scenario`,
 *     not `segment`; headline facts live in non-dimensional contexts;
 *   - LEGACY TRAP: the legacy `FourD` context repeats the quarter's dates; the real
 *     YTD period is only in the `DateOfStartOfReportingPeriod` /
 *     `DateOfEndOfReportingPeriod` facts inside the context → we always prefer those;
 *   - HDFC Bank books minority interest as a negative `ExceptionalItems` above PBT
 *     (consolidated); `SegmentProfitBeforeTax` still carries the pre-minority PBT;
 *   - `ProfitOrLossAttributableToOwnersOfParent` can be a literal 0 (RAJESHEXPO) —
 *     only trusted when non-zero.
 */
import { XMLParser } from "fast-xml-parser";
import type { ResultsBasis, ResultsQuarter, ResultsSource } from "../types";

// ---------------------------------------------------------------------------
// Instance model
// ---------------------------------------------------------------------------

export interface XbrlContext {
  id: string;
  start: string | null;
  end: string | null;
  instant: string | null;
  /** has xbrli:segment or xbrli:scenario children (dimension members) */
  dimensional: boolean;
}

export interface XbrlFact {
  /** local name without namespace prefix */
  name: string;
  contextRef: string;
  unitRef: string | null;
  decimals: string | null;
  /** iXBRL-style power-of-ten scale if present (never seen on NSE instances; applied defensively) */
  scale: number | null;
  value: string | null;
}

export interface XbrlInstance {
  /** namespace prefix of the taxonomy, e.g. "in-capmkt" | "in-bse-fin" */
  namespacePrefix: string | null;
  contexts: Map<string, XbrlContext>;
  facts: XbrlFact[];
}

type OrderedNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

function childList(node: OrderedNode): {
  tag: string;
  children: OrderedNode[];
  attrs: Record<string, string>;
} | null {
  const attrs = node[":@"] ?? {};
  for (const k of Object.keys(node)) {
    if (k === ":@") continue;
    const v = node[k];
    return {
      tag: k,
      children: Array.isArray(v) ? (v as OrderedNode[]) : [],
      attrs,
    };
  }
  return null;
}

function textOf(children: OrderedNode[]): string | null {
  for (const c of children) {
    if (typeof c["#text"] === "string") return c["#text"] as string;
  }
  return null;
}

function findChild(children: OrderedNode[], tag: string): OrderedNode[] | null {
  for (const c of children) {
    if (tag in c) {
      const v = c[tag];
      return Array.isArray(v) ? (v as OrderedNode[]) : [];
    }
  }
  return null;
}

/** Parse an XBRL instance document into contexts + flat facts. Throws on non-XBRL input. */
export function parseXbrlInstance(xml: string): XbrlInstance {
  const nsMatch =
    /xmlns:(in-[a-z]+(?:-[a-z]+)?)="http:\/\/www\.(?:sebi\.gov\.in|bseindia\.com)\//i.exec(
      xml.slice(0, 6000),
    );
  const namespacePrefix = nsMatch?.[1] ?? null;

  const doc = parser.parse(xml) as OrderedNode[];
  let rootChildren: OrderedNode[] | null = null;
  for (const n of doc) {
    const c = childList(n);
    if (c && c.tag === "xbrl") {
      rootChildren = c.children;
      break;
    }
  }
  if (!rootChildren) throw new Error("not an XBRL instance (no xbrl root)");

  const contexts = new Map<string, XbrlContext>();
  const facts: XbrlFact[] = [];

  for (const node of rootChildren) {
    const c = childList(node);
    if (!c) continue;
    if (c.tag === "context") {
      const id = c.attrs.id;
      if (!id) continue;
      const period = findChild(c.children, "period") ?? [];
      const start = textOf(findChild(period, "startDate") ?? []);
      const end = textOf(findChild(period, "endDate") ?? []);
      const instant = textOf(findChild(period, "instant") ?? []);
      const dimensional =
        findChild(c.children, "scenario") !== null ||
        findChild(c.children, "segment") !== null ||
        (findChild(c.children, "entity") ?? []).some((e) => "segment" in e);
      contexts.set(id, { id, start, end, instant, dimensional });
      continue;
    }
    if (
      c.tag === "unit" ||
      c.tag === "schemaRef" ||
      c.tag === "#text" ||
      c.tag === "#comment"
    )
      continue;
    const contextRef = c.attrs.contextRef;
    if (!contextRef) continue;
    const nil = (c.attrs.nil ?? "").toLowerCase() === "true";
    const scaleRaw = c.attrs.scale;
    facts.push({
      name: c.tag,
      contextRef,
      unitRef: c.attrs.unitRef ?? null,
      decimals: c.attrs.decimals ?? null,
      scale:
        scaleRaw !== undefined && scaleRaw !== "" ? Number(scaleRaw) : null,
      value: nil ? null : textOf(c.children),
    });
  }
  return { namespacePrefix, contexts, facts };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface XbrlPeriod {
  contextId: string;
  /** effective reporting period (facts override the context when present) */
  start: string;
  end: string;
  days: number;
  facts: Map<string, XbrlFact>;
}

function daysBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000) + 1;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Non-dimensional duration contexts with their facts. The effective period is
 * taken from DateOfStart/EndOfReportingPeriod facts when they exist (legacy
 * files mislabel the YTD context's dates), else from the context itself.
 */
export function durationPeriods(inst: XbrlInstance): XbrlPeriod[] {
  const byCtx = new Map<string, Map<string, XbrlFact>>();
  for (const f of inst.facts) {
    const ctx = inst.contexts.get(f.contextRef);
    if (!ctx || ctx.dimensional || ctx.instant || !ctx.start || !ctx.end)
      continue;
    let m = byCtx.get(f.contextRef);
    if (!m) {
      m = new Map();
      byCtx.set(f.contextRef, m);
    }
    if (!m.has(f.name) || (m.get(f.name)?.value == null && f.value != null))
      m.set(f.name, f);
  }
  const out: XbrlPeriod[] = [];
  for (const [contextId, facts] of byCtx) {
    const ctx = inst.contexts.get(contextId);
    if (!ctx?.start || !ctx.end) continue;
    const fs = facts.get("DateOfStartOfReportingPeriod")?.value ?? null;
    const fe = facts.get("DateOfEndOfReportingPeriod")?.value ?? null;
    const start = fs && ISO_DATE.test(fs) ? fs : ctx.start;
    const end = fe && ISO_DATE.test(fe) ? fe : ctx.end;
    const days = daysBetween(start, end);
    if (!Number.isFinite(days) || days <= 0) continue;
    out.push({ contextId, start, end, days, facts });
  }
  return out;
}

export interface PeriodSelection {
  quarter: XbrlPeriod | null;
  /** fiscal year-to-date period ending on the same date (null for Q1 — YTD == quarter) */
  ytd: XbrlPeriod | null;
  all: XbrlPeriod[];
}

/** A quarter is 80–100 days (Feb-short Q4 = 90, Jul–Sep = 92); the richest one wins. */
export function selectPeriods(
  inst: XbrlInstance,
  opts: { periodEnd?: string } = {},
): PeriodSelection {
  const all = durationPeriods(inst);
  const quarters = all.filter(
    (p) =>
      p.days >= 80 &&
      p.days <= 100 &&
      (!opts.periodEnd || p.end === opts.periodEnd),
  );
  quarters.sort(
    (a, b) => b.facts.size - a.facts.size || b.end.localeCompare(a.end),
  );
  const quarter = quarters[0] ?? null;
  let ytd: XbrlPeriod | null = null;
  if (quarter) {
    const longer = all
      .filter((p) => p.end === quarter.end && p.days > 100)
      .sort((a, b) => b.days - a.days || b.facts.size - a.facts.size);
    ytd = longer[0] ?? null;
  }
  return { quarter, ytd, all };
}

// ---------------------------------------------------------------------------
// Fact access
// ---------------------------------------------------------------------------

function num(p: XbrlPeriod, ...names: string[]): number | null {
  for (const n of names) {
    const f = p.facts.get(n);
    if (!f || f.value == null || f.value === "") continue;
    const v = Number(f.value.replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    return f.scale ? v * 10 ** f.scale : v;
  }
  return null;
}

function str(p: XbrlPeriod, ...names: string[]): string | null {
  for (const n of names) {
    const v = p.facts.get(n)?.value;
    if (v != null && v !== "") return v;
  }
  return null;
}

/** First non-null among candidates, but a literal 0 is treated as "absent" (RAJESHEXPO owners-of-parent trap). */
function numNonZero(p: XbrlPeriod, ...names: string[]): number | null {
  const v = num(p, ...names);
  return v === 0 ? null : v;
}

// ---------------------------------------------------------------------------
// Taxonomy variants and identity checks
// ---------------------------------------------------------------------------

export type ResultsVariant = "corporate" | "bank" | "nbfc";

export function detectVariant(
  p: XbrlPeriod,
  hint?: string | null,
): ResultsVariant {
  const has = (n: string) => p.facts.has(n);
  if (
    has("InterestExpended") &&
    (has("OperatingProfitBeforeProvisionAndContingencies") ||
      has("ProfitLossFromOrdinaryActivitiesBeforeTax"))
  )
    return "bank";
  if (
    has("ImpairmentOnFinancialInstruments") ||
    (hint ?? "").toUpperCase().includes("NBFC")
  )
    return "nbfc";
  if ((hint ?? "").toUpperCase().includes("BANKING")) return "bank";
  return "corporate";
}

/** ₹1 crore floor, 0.5 % of the larger operand otherwise. */
export const IDENTITY_TOLERANCE = { pct: 0.005, floorInr: 1e7 } as const;

export function withinTolerance(a: number, b: number): boolean {
  const tol = Math.max(
    IDENTITY_TOLERANCE.pct * Math.max(Math.abs(a), Math.abs(b)),
    IDENTITY_TOLERANCE.floorInr,
  );
  return Math.abs(a - b) <= tol;
}

interface IdentityResult {
  identities: Record<string, boolean>;
  warnings: string[];
}

function check(
  res: IdentityResult,
  name: string,
  lhs: number | null,
  rhs: number | null,
  warn: string,
): void {
  if (lhs === null || rhs === null) return;
  const ok = withinTolerance(lhs, rhs);
  res.identities[name] = ok;
  if (!ok)
    res.warnings.push(
      `${warn}: ${(lhs / 1e7).toFixed(2)} vs ${(rhs / 1e7).toFixed(2)} cr`,
    );
}

// ---------------------------------------------------------------------------
// Mapping → ResultsQuarter
// ---------------------------------------------------------------------------

export interface XbrlQuarterContext {
  isin: string;
  sourceUrl: string;
  /** 'xbrl' for integrated filings, 'legacy' for the pre-2025 index */
  source?: ResultsSource;
  filedAt?: number | null;
  /** from the index; the instance's own facts win when they disagree */
  basis?: ResultsBasis | null;
  audited?: boolean | null;
  /** expected quarter end 'YYYY-MM-DD' (selects the right 3-month context) */
  periodEnd?: string;
  /** taxonomy hint from the file name */
  taxonomy?: string | null;
}

export interface ParsedXbrlQuarter {
  quarter: ResultsQuarter;
  variant: ResultsVariant;
  taxonomyPrefix: string | null;
  /** distinct tag names in the quarter context (for taxonomy discovery / reports) */
  tags: string[];
  periods: PeriodSelection;
}

export class XbrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XbrlParseError";
  }
}

/** Parse one XBRL instance and map the current-quarter context to a ResultsQuarter (absolute INR). */
export function quarterFromXbrl(
  xml: string,
  ctx: XbrlQuarterContext,
): ParsedXbrlQuarter {
  const inst = parseXbrlInstance(xml);
  const periods = selectPeriods(inst, { periodEnd: ctx.periodEnd });
  const q = periods.quarter;
  if (!q) {
    throw new XbrlParseError(
      `no 3-month context${ctx.periodEnd ? ` ending ${ctx.periodEnd}` : ""} (durations: ${
        periods.all.map((p) => `${p.start}..${p.end}`).join(", ") || "none"
      })`,
    );
  }
  const variant = detectVariant(q, ctx.taxonomy);
  const res: IdentityResult = { identities: {}, warnings: [] };

  const natureRaw = str(q, "NatureOfReportStandaloneConsolidated");
  const basisFromFacts: ResultsBasis | null = natureRaw
    ? /consol/i.test(natureRaw)
      ? "consolidated"
      : "standalone"
    : null;
  const basis = basisFromFacts ?? ctx.basis ?? "standalone";
  if (basisFromFacts && ctx.basis && basisFromFacts !== ctx.basis)
    res.warnings.push(
      `index says ${ctx.basis} but the XBRL says ${basisFromFacts}; using the XBRL`,
    );

  const auditedRaw = str(q, "WhetherResultsAreAuditedOrUnaudited");
  const audited = auditedRaw
    ? !/^un/i.test(auditedRaw.trim())
    : (ctx.audited ?? null);

  const isinFact = str(q, "ISIN");
  if (isinFact && isinFact.trim().toUpperCase() !== ctx.isin.toUpperCase())
    res.warnings.push(
      `ISIN mismatch: expected ${ctx.isin}, XBRL has ${isinFact}`,
    );

  const currency = str(q, "DescriptionOfPresentationCurrency");
  if (currency && currency.toUpperCase() !== "INR")
    res.warnings.push(`presentation currency ${currency}`);

  const checks: ResultsQuarter["checks"] = {
    warnings: res.warnings,
    identities: res.identities,
    taxonomy: (ctx.taxonomy ?? "").toUpperCase() || undefined,
    variant,
    periodStart: q.start,
    reportingQuarter: str(q, "ReportingQuarter") ?? undefined,
    levelOfRounding: str(q, "LevelOfRounding") ?? undefined,
    currency: currency ?? undefined,
    faceValue: num(q, "FaceValueOfEquityShareCapital") ?? undefined,
  };

  let row: ResultsQuarter;
  if (variant === "bank") row = mapBank(q, basis, audited, ctx, res, checks);
  else row = mapIndAs(q, variant, basis, audited, ctx, res, checks);

  if (periods.ytd) row.checks.ytd = ytdSummary(periods.ytd, variant);

  return {
    quarter: row,
    variant,
    taxonomyPrefix: inst.namespacePrefix,
    tags: [...q.facts.keys()].sort(),
    periods,
  };
}

function base(
  q: XbrlPeriod,
  basis: ResultsBasis,
  audited: boolean | null,
  ctx: XbrlQuarterContext,
  checks: ResultsQuarter["checks"],
): Omit<
  ResultsQuarter,
  | "revenue"
  | "otherIncome"
  | "financeCosts"
  | "dna"
  | "pbeit"
  | "exceptional"
  | "pbt"
  | "tax"
  | "pat"
  | "patCont"
  | "eps"
> {
  return {
    isin: ctx.isin,
    periodEnd: q.end,
    basis,
    source: ctx.source ?? "xbrl",
    audited,
    checks,
    sourceUrl: ctx.sourceUrl,
    filedAt: ctx.filedAt ?? null,
  };
}

function mapIndAs(
  q: XbrlPeriod,
  variant: ResultsVariant,
  basis: ResultsBasis,
  audited: boolean | null,
  ctx: XbrlQuarterContext,
  res: IdentityResult,
  checks: ResultsQuarter["checks"],
): ResultsQuarter {
  const revenue = num(
    q,
    "RevenueFromOperations",
    "Revenue",
    "TotalRevenueFromOperations",
  );
  const otherIncome = num(q, "OtherIncome");
  const income = num(q, "Income", "TotalIncome");
  const expenses = num(q, "Expenses", "TotalExpenses");
  const financeCosts = num(q, "FinanceCosts");
  const dna = num(
    q,
    "DepreciationDepletionAndAmortisationExpense",
    "DepreciationAndAmortisationExpense",
  );
  const pbeit = num(q, "ProfitBeforeExceptionalItemsAndTax");
  const exceptional = num(q, "ExceptionalItemsBeforeTax", "ExceptionalItems");
  const pbt = num(q, "ProfitBeforeTax");
  const tax = num(q, "TaxExpense");
  const patCont = num(q, "ProfitLossForPeriodFromContinuingOperations");
  const pat = num(q, "ProfitLossForPeriod", "ProfitLossForThePeriod");
  const patOwners = numNonZero(q, "ProfitOrLossAttributableToOwnersOfParent");
  const nci = num(q, "ProfitOrLossAttributableToNonControllingInterests");
  const assoc = num(
    q,
    "ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",
  );
  const disc = num(q, "ProfitLossFromDiscontinuedOperationsAfterTax");
  const eps = num(
    q,
    "BasicEarningsLossPerShareFromContinuingOperations",
    "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
    "BasicEarningsPerShareAfterExtraordinaryItems",
  );
  const epsDiluted = num(
    q,
    "DilutedEarningsLossPerShareFromContinuingOperations",
    "DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
  );

  // Identities (Ind AS presentation):
  check(
    res,
    "income_eq_rev_plus_oi",
    income,
    sum(revenue, otherIncome),
    "Total income ≠ revenue + other income",
  );
  if (pbeit !== null && income !== null && expenses !== null) {
    const plain = income - expenses;
    if (withinTolerance(pbeit, plain))
      res.identities.pbeit_eq_income_minus_expenses = true;
    else if (assoc !== null && withinTolerance(pbeit, plain + assoc)) {
      res.identities.pbeit_eq_income_minus_expenses = true;
      res.warnings.push(
        "share of associates/JV is presented above PBT in this filing",
      );
      checks.assocAbovePbt = true;
    } else
      check(
        res,
        "pbeit_eq_income_minus_expenses",
        pbeit,
        plain,
        "PBEIT ≠ income − expenses",
      );
  }
  check(
    res,
    "pbt_eq_pbeit_plus_exceptional",
    pbt,
    sum(pbeit, exceptional ?? 0),
    "PBT ≠ PBEIT + exceptional",
  );
  if (pbt !== null && tax !== null) {
    const afterTax = pbt - tax;
    if (patCont !== null)
      check(
        res,
        "patcont_eq_pbt_minus_tax",
        patCont,
        afterTax,
        "PAT (continuing) ≠ PBT − tax",
      );
    else if (pat !== null) {
      if (withinTolerance(pat, afterTax))
        res.identities.pat_eq_pbt_minus_tax = true;
      else if (assoc !== null && withinTolerance(pat, afterTax + assoc))
        res.identities.pat_eq_pbt_minus_tax = true;
      else check(res, "pat_eq_pbt_minus_tax", pat, afterTax, "PAT ≠ PBT − tax");
    }
  }
  if (pat !== null && patCont !== null) {
    const expected =
      patCont + (checks.assocAbovePbt ? 0 : (assoc ?? 0)) + (disc ?? 0);
    check(
      res,
      "pat_eq_patcont_plus_assoc_disc",
      pat,
      expected,
      "PAT ≠ PAT continuing + associates + discontinued",
    );
  }
  let ownersOk: boolean | null = null;
  if (pat !== null && patOwners !== null && nci !== null) {
    ownersOk = withinTolerance(pat, patOwners + nci);
    const tci = num(q, "ComprehensiveIncomeForThePeriod");
    const tciOwners = num(
      q,
      "ComprehensiveIncomeForThePeriodAttributableToOwnersOfParent",
    );
    const looksLikeTci =
      (tci !== null && withinTolerance(patOwners, tci)) ||
      (tciOwners !== null && withinTolerance(patOwners, tciOwners));
    if (!ownersOk && looksLikeTci) {
      // PI Industries pattern: the owners-of-parent slot carries total comprehensive income
      res.warnings.push(
        "owners-of-parent PAT is tagged with total comprehensive income (filer quirk) — ignored",
      );
      checks.ownersTaggedAsTci = true;
    } else {
      check(
        res,
        "pat_eq_owners_plus_nci",
        pat,
        patOwners + nci,
        "PAT ≠ owners + non-controlling interests",
      );
    }
  }

  if (
    exceptional !== null &&
    exceptional !== 0 &&
    pbeit !== null &&
    Math.abs(exceptional) > 0.05 * Math.abs(pbeit)
  )
    res.warnings.push(
      `exceptional items ${(exceptional / 1e7).toFixed(2)} cr (>5 % of PBEIT)`,
    );
  if (
    assoc !== null &&
    assoc !== 0 &&
    pbt !== null &&
    Math.abs(assoc) > 0.02 * Math.abs(pbt)
  )
    res.warnings.push(
      `PBT excludes share of associates/JV ${(assoc / 1e7).toFixed(2)} cr (the printed PBT may include it)`,
    );
  if (
    patOwners === null &&
    q.facts.has("ProfitOrLossAttributableToOwnersOfParent") &&
    basis === "consolidated"
  )
    res.warnings.push("owners-of-parent PAT tagged as 0 — ignored");

  checks.income = income ?? undefined;
  checks.expenses = expenses ?? undefined;
  checks.assocShare = assoc ?? undefined;
  checks.patOwners = checks.ownersTaggedAsTci
    ? undefined
    : (patOwners ?? undefined);
  checks.nci = nci ?? undefined;
  checks.discontinued = disc ?? undefined;
  checks.epsDiluted = epsDiluted ?? undefined;

  if (variant === "nbfc") {
    const interestIncome = num(q, "InterestEarned", "InterestIncome");
    const impairment = num(q, "ImpairmentOnFinancialInstruments");
    checks.interestIncome = interestIncome ?? undefined;
    checks.impairment = impairment ?? undefined;
    if (interestIncome !== null && financeCosts !== null)
      checks.nii = interestIncome - financeCosts;
    // pre-provision operating profit = PBEIT + impairment (credit cost is the "provision" of an NBFC)
    if (pbeit !== null && impairment !== null) checks.ppop = pbeit + impairment;
  }

  return {
    ...base(q, basis, audited, ctx, checks),
    revenue,
    otherIncome,
    financeCosts,
    dna,
    pbeit,
    exceptional,
    pbt,
    tax,
    pat,
    patCont,
    eps,
  };
}

function mapBank(
  q: XbrlPeriod,
  basis: ResultsBasis,
  audited: boolean | null,
  ctx: XbrlQuarterContext,
  res: IdentityResult,
  checks: ResultsQuarter["checks"],
): ResultsQuarter {
  const interestEarned = num(q, "InterestEarned");
  const otherIncome = num(q, "OtherIncome");
  const income = num(q, "Income", "TotalIncome");
  const interestExpended = num(q, "InterestExpended");
  const opex = num(q, "OperatingExpenses");
  const expenditure = num(q, "ExpenditureExcludingProvisionsAndContingencies");
  const ppop = num(
    q,
    "OperatingProfitBeforeProvisionAndContingencies",
    "OperatingProfitBeforeProvisionsAndContingencies",
  );
  const provisions = num(q, "ProvisionsOtherThanTaxAndContingencies");
  const exceptional = num(q, "ExceptionalItems", "ExceptionalItemsBeforeTax");
  const pbt = num(
    q,
    "ProfitLossFromOrdinaryActivitiesBeforeTax",
    "ProfitBeforeTax",
  );
  const tax = num(q, "TaxExpense");
  const patOrdinary = num(q, "ProfitLossFromOrdinaryActivitiesAfterTax");
  const pat = num(q, "ProfitLossForThePeriod", "ProfitLossForPeriod");
  const patGroup = num(
    q,
    "ProfitLossAfterTaxesMinorityInterestAndShareOfProfitLossOfAssociates",
  );
  const minority = num(q, "ProfitLossOfMinorityInterest");
  const assoc = num(q, "ShareOfProfitLossOfAssociates");
  const segmentPbt = num(q, "SegmentProfitBeforeTax");
  const eps = num(
    q,
    "BasicEarningsPerShareAfterExtraordinaryItems",
    "BasicEarningsPerShareBeforeExtraordinaryItems",
    "BasicEarningsLossPerShareFromContinuingOperations",
  );
  const epsDiluted = num(
    q,
    "DilutedEarningsPerShareAfterExtraordinaryItems",
    "DilutedEarningsPerShareBeforeExtraordinaryItems",
  );
  const gnpa = num(q, "PercentageOfGrossNpa");
  const nnpa = num(q, "PercentageOfNpa", "PercentageOfNetNpa");

  check(
    res,
    "income_eq_interest_plus_oi",
    income,
    sum(interestEarned, otherIncome),
    "Total income ≠ interest earned + other income",
  );
  if (expenditure !== null)
    check(
      res,
      "expenditure_eq_intexp_plus_opex",
      expenditure,
      sum(interestExpended, opex),
      "Expenditure ≠ interest expended + operating expenses",
    );
  check(
    res,
    "ppop_eq_income_minus_expenditure",
    ppop,
    income !== null && interestExpended !== null && opex !== null
      ? income - interestExpended - opex
      : null,
    "Operating profit ≠ income − interest expended − opex",
  );
  check(
    res,
    "pbt_eq_ppop_minus_prov_plus_exc",
    pbt,
    ppop !== null && provisions !== null
      ? ppop - provisions + (exceptional ?? 0)
      : null,
    "PBT ≠ operating profit − provisions + exceptional",
  );
  check(
    res,
    "pat_eq_pbt_minus_tax",
    patOrdinary ?? pat,
    pbt !== null && tax !== null ? pbt - tax : null,
    "PAT ≠ PBT − tax",
  );
  if (
    pat !== null &&
    patGroup !== null &&
    minority !== null &&
    (minority !== 0 || assoc)
  )
    check(
      res,
      "patgroup_eq_pat_minus_minority_plus_assoc",
      patGroup,
      pat - minority + (assoc ?? 0),
      "Group PAT ≠ PAT − minority + associates",
    );

  // HDFC Bank pattern: minority interest booked as a negative exceptional item above PBT.
  if (
    basis === "consolidated" &&
    exceptional !== null &&
    exceptional < 0 &&
    segmentPbt !== null &&
    pbt !== null &&
    withinTolerance(segmentPbt - pbt, -exceptional)
  ) {
    res.warnings.push(
      `minority interest (${(-exceptional / 1e7).toFixed(2)} cr) appears to be booked as a negative exceptional item above PBT; PBT before minority = ${(segmentPbt / 1e7).toFixed(2)} cr (SegmentProfitBeforeTax)`,
    );
    checks.pbtBeforeMinority = segmentPbt;
    checks.minorityAsExceptional = true;
  } else if (
    exceptional !== null &&
    exceptional !== 0 &&
    ppop !== null &&
    Math.abs(exceptional) > 0.05 * Math.abs(ppop)
  ) {
    res.warnings.push(
      `exceptional items ${(exceptional / 1e7).toFixed(2)} cr (>5 % of operating profit)`,
    );
  }

  checks.income = income ?? undefined;
  checks.interestIncome = interestEarned ?? undefined;
  checks.interestExpended = interestExpended ?? undefined;
  checks.opex = opex ?? undefined;
  checks.provisions = provisions ?? undefined;
  checks.patOwners = patGroup ?? undefined;
  checks.nci = minority ?? undefined;
  checks.assocShare = assoc ?? undefined;
  checks.epsDiluted = epsDiluted ?? undefined;
  if (interestEarned !== null && interestExpended !== null)
    checks.nii = interestEarned - interestExpended;
  if (ppop !== null) checks.ppop = ppop;
  // pure fractions → percent; a literal 0 at consolidated level means "not reported"
  if (gnpa !== null && gnpa !== 0)
    checks.gnpaPct = gnpa <= 1 ? gnpa * 100 : gnpa;
  if (nnpa !== null && nnpa !== 0)
    checks.nnpaPct = nnpa <= 1 ? nnpa * 100 : nnpa;

  return {
    ...base(q, basis, audited, ctx, checks),
    // bank slots: revenue = interest earned (top line), financeCosts = interest expended, dna not reported separately
    revenue: interestEarned,
    otherIncome,
    financeCosts: interestExpended,
    dna: null,
    pbeit: pbt !== null ? pbt - (exceptional ?? 0) : null,
    exceptional,
    pbt,
    tax,
    pat,
    patCont: patOrdinary,
    eps,
  };
}

function ytdSummary(
  p: XbrlPeriod,
  variant: ResultsVariant,
): NonNullable<ResultsQuarter["checks"]["ytd"]> {
  if (variant === "bank") {
    const ie = num(p, "InterestEarned");
    const ix = num(p, "InterestExpended");
    return {
      start: p.start,
      end: p.end,
      days: p.days,
      revenue: ie,
      income: num(p, "Income", "TotalIncome"),
      pbt: num(
        p,
        "ProfitLossFromOrdinaryActivitiesBeforeTax",
        "ProfitBeforeTax",
      ),
      pat: num(p, "ProfitLossForThePeriod", "ProfitLossForPeriod"),
      nii: ie !== null && ix !== null ? ie - ix : null,
      ppop: num(p, "OperatingProfitBeforeProvisionAndContingencies"),
    };
  }
  const ii = num(p, "InterestEarned", "InterestIncome");
  const fc = num(p, "FinanceCosts");
  return {
    start: p.start,
    end: p.end,
    days: p.days,
    revenue: num(p, "RevenueFromOperations", "Revenue"),
    income: num(p, "Income", "TotalIncome"),
    pbt: num(p, "ProfitBeforeTax"),
    pat: num(p, "ProfitLossForPeriod", "ProfitLossForThePeriod"),
    nii: variant === "nbfc" && ii !== null && fc !== null ? ii - fc : null,
    ppop: null,
  };
}

function sum(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a + b;
}

/** The ISIN fact of an instance (any context), for resolving unknown symbols. */
export function xbrlIsin(xml: string): string | null {
  const m = /<[\w-]+:ISIN\b[^>]*>\s*([A-Z]{2}[A-Z0-9]{9}\d)\s*<\//.exec(xml);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Fiscal labels (Indian FY: Apr–Mar; Q2 FY27 = Jul–Sep 2026)
// ---------------------------------------------------------------------------

export interface FiscalQuarter {
  /** 1..4 */
  q: 1 | 2 | 3 | 4;
  /** fiscal year as the ending calendar year, e.g. 2027 for FY27 */
  fy: number;
  /** "Q2 FY27" */
  label: string;
  /** "FY27" */
  fyLabel: string;
}

export function fiscalQuarter(periodEnd: string): FiscalQuarter {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodEnd);
  if (!m) throw new Error(`bad period end: ${periodEnd}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const q = (mo <= 3 ? 4 : mo <= 6 ? 1 : mo <= 9 ? 2 : 3) as 1 | 2 | 3 | 4;
  const fy = mo <= 3 ? y : y + 1;
  const fyLabel = `FY${String(fy % 100).padStart(2, "0")}`;
  return { q, fy, label: `Q${q} ${fyLabel}`, fyLabel };
}

/** 'YYYY-MM-DD' quarter end shifted by n quarters (negative = earlier). */
export function shiftQuarterEnd(periodEnd: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodEnd);
  if (!m) throw new Error(`bad period end: ${periodEnd}`);
  let y = Number(m[1]);
  let mo = Number(m[2]) + 3 * n;
  while (mo > 12) {
    mo -= 12;
    y += 1;
  }
  while (mo < 1) {
    mo += 12;
    y -= 1;
  }
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}
