import { resultsVerified } from "@/engine/analyse/results";
import type { ResultsCard, ResultsVerification } from "@/engine/types";
import { formatCrore, groupIndian, quarterLabel } from "@/lib/format";
import { DeltaChip } from "./DeltaChip";
import { FormulaPopover } from "./FormulaPopover";
import { Sparkline } from "./Sparkline";

const LABEL: Record<string, string> = {
  revenue: "Revenue",
  ebitda: "EBITDA",
  pbt: "PBT",
  pat: "PAT",
  nii: "NII",
  ppop: "PPOP",
  total_income: "Total income",
};

export interface GridRow {
  metric: string;
  label: string;
  /** ₹ crore */
  valueCr: number | null;
  qoqPct: number | null;
  yoyPct: number | null;
  /** rupees, oldest first */
  spark: Array<number | null>;
}

/** Normalise either the render-ready `headline` rows (₹ cr) or the raw `rows` (rupees). */
export function gridRows(card: ResultsCard): GridRow[] {
  const sparkBy = new Map(card.rows.map((r) => [r.metric as string, r.spark]));
  if (card.headline?.length) {
    return card.headline.map((h) => ({
      metric: h.metric,
      label: h.label || LABEL[h.metric] || h.metric,
      valueCr: h.currentCr,
      qoqPct: h.qoqPct,
      yoyPct: h.yoyPct,
      spark: sparkBy.get(h.metric) ?? [],
    }));
  }
  return card.rows.map((r) => ({
    metric: r.metric,
    label: LABEL[r.metric] ?? r.metric,
    valueCr: r.value == null ? null : r.value / 1e7,
    qoqPct: r.qoqPct,
    yoyPct: r.yoyPct,
    spark: r.spark,
  }));
}

export function periodLabelOf(
  card: ResultsCard,
  fallbackPeriodEnd?: string | null,
): string {
  if (card.fiscalLabel) return card.fiscalLabel;
  const pe = card.periodEnd ?? fallbackPeriodEnd;
  return pe ? quarterLabel(pe) : "Quarter";
}

function fmtCr(v: number | null): string {
  if (v == null) return "—";
  return groupIndian(v, Math.abs(v) < 100 ? 1 : 0);
}

/**
 * 4 rows × [value, QoQ, YoY] with tabular numerals and an optional
 * five-quarter sparkline; the unit "₹ cr" is said once in the header.
 */
type VerifyCard = {
  checksum: "exchange_xbrl" | "preliminary";
  verification?: ResultsVerification;
};

/**
 * The one line a failed check already has a place for: the half-year or
 * identity note. Null when the card is verified or merely preliminary.
 */
export function checkFailureLine(card: VerifyCard): string | null {
  if (resultsVerified(card)) return null;
  const notes = card.verification?.notes ?? [];
  if (card.verification?.h1Check === false)
    return (
      notes.find((n) => /check failed/i.test(n)) ?? "half-year check failed"
    );
  if (card.verification?.identitiesPassed === false)
    return (
      notes.find((n) => /identity checks failed/i.test(n)) ??
      "identity checks failed"
    );
  return null;
}

/**
 * Company snapshot chip. Same gate as the results card: verified only when
 * identities pass and the half-year check passes, or there is no half-year
 * to check. A failure is that one note, not "XBRL verified".
 */
export function snapshotChip(snapshot: {
  checksum: "exchange_xbrl" | "preliminary" | null;
  verification?: ResultsVerification | null;
}): { label: string; tone: "up" | "warn"; title: string | null } {
  if (snapshot.checksum !== "exchange_xbrl")
    return { label: "Preliminary", tone: "warn", title: null };
  const card: VerifyCard = {
    checksum: "exchange_xbrl",
    verification: snapshot.verification ?? undefined,
  };
  if (resultsVerified(card))
    return { label: "XBRL verified", tone: "up", title: null };
  const failed = checkFailureLine(card);
  if (!failed) return { label: "Preliminary", tone: "warn", title: null };
  // The note carries the rupee gap. The chip only has room for the failure.
  const short = failed.split(/ on |:| — /)[0]?.trim() || failed;
  return {
    label: short,
    tone: "warn",
    title: failed === short ? null : failed,
  };
}

/** One-line receipt for the brief card: "Consolidated · ₹ cr · XBRL ✓ · bank format". */
export function compactMetaLine(card: ResultsCard): string {
  const basisWord = card.basis === "standalone" ? "Standalone" : "Consolidated";
  const parts = [basisWord, "₹ cr"];
  const failed = checkFailureLine(card);
  parts.push(
    failed ?? (card.checksum === "exchange_xbrl" ? "XBRL ✓" : "preliminary ◐"),
  );
  if (card.variant === "bank") parts.push("bank format");
  else if (card.variant === "nbfc") parts.push("NBFC format");
  const exc = card.exceptional?.currentCr ?? null;
  if (exc != null && exc !== 0)
    parts.push(`exceptional ${formatCrore(exc * 1e7)} cr`);
  return parts.join(" · ");
}

export function ResultsGrid({
  card,
  periodEnd,
  withSpark = true,
  showMeta = true,
  compactMeta = false,
  components,
}: {
  card: ResultsCard;
  periodEnd?: string | null;
  withSpark?: boolean;
  /** basis chips, verification badge, formula popover */
  showMeta?: boolean;
  /** when `showMeta` is off: a single receipt line instead of chips */
  compactMeta?: boolean;
  /** ₹ cr components for the EBITDA popover, when known */
  components?: {
    pbt?: number | null;
    fin?: number | null;
    dna?: number | null;
    oi?: number | null;
  };
}) {
  const rows = gridRows(card);
  const period = periodLabelOf(card, periodEnd);
  const isBank =
    card.variant === "bank" ||
    card.variant === "nbfc" ||
    !rows.some((r) => r.metric === "ebitda");
  const formatWord = card.variant === "nbfc" ? "NBFC" : "Bank";
  const basis =
    card.basisLabel ??
    `${card.basis === "standalone" ? "Standalone" : "Consolidated"} · ₹ cr`;
  const verified = resultsVerified(card);
  const failedCheck = checkFailureLine(card);
  const h1 = card.verification?.h1Check;
  const exceptionalCr = card.exceptional?.currentCr ?? null;
  const hasExceptional = exceptionalCr != null && exceptionalCr !== 0;
  const exOther = card.ebitdaFormula !== "pbt+fin+dna";
  const formula = exOther
    ? "EBITDA = PBT + finance costs + D&A − other income"
    : "EBITDA = PBT + finance costs + D&A";
  const ebitdaRow = rows.find((r) => r.metric === "ebitda");
  const lines: string[] = [];
  if (components?.pbt != null) lines.push(`PBT ${formatCrore(components.pbt)}`);
  if (components?.fin != null)
    lines.push(`+ finance costs ${formatCrore(components.fin)}`);
  if (components?.dna != null)
    lines.push(`+ D&A ${formatCrore(components.dna)}`);
  if (components?.oi != null && exOther)
    lines.push(`− other income ${formatCrore(components.oi)}`);
  if (ebitdaRow?.valueCr != null)
    lines.push(
      `= ${groupIndian(ebitdaRow.valueCr, 0)} cr${exOther ? " ex other income" : ""}`,
    );
  // the other convention, so a reader comparing with a broker note sees both
  if (exOther && card.ebitdaInclOtherIncomeCr != null)
    lines.push(
      `incl. other income: ${groupIndian(card.ebitdaInclOtherIncomeCr, 0)} cr`,
    );
  else if (!exOther && components?.oi != null && ebitdaRow?.valueCr != null)
    lines.push(
      `ex other income: ${groupIndian(ebitdaRow.valueCr - components.oi / 1e7, 0)} cr`,
    );
  if (hasExceptional)
    lines.push(
      `exceptional items ${formatCrore((exceptionalCr ?? 0) * 1e7)} cr sit inside PBT and PAT`,
    );

  return (
    <div>
      <table className="rtable" aria-label={`${period} results, ₹ crore`}>
        <colgroup>
          <col />
          <col style={{ width: 80 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 60 }} />
          {withSpark ? <col style={{ width: 56 }} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="hd">
              ₹ cr
            </th>
            <th scope="col" className="hd r">
              {period}
            </th>
            <th scope="col" className="hd r">
              QoQ
            </th>
            <th scope="col" className="hd r">
              YoY
            </th>
            {withSpark ? (
              <th scope="col" className="hd r" title="last five quarters">
                5-qtr
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sparkValues =
              r.spark.filter((v) => v != null).length >= 2 ? r.spark : [];
            return (
              <tr key={r.metric}>
                <th scope="row" className="cell small text-ink-2">
                  {r.label}
                </th>
                <td className="cell r num font-medium">{fmtCr(r.valueCr)}</td>
                <td className="cell r small">
                  <DeltaChip value={r.qoqPct} />
                </td>
                <td className="cell r small">
                  <DeltaChip value={r.yoyPct} />
                </td>
                {withSpark ? (
                  <td className="cell r">
                    {r.spark.length ? (
                      <Sparkline
                        values={sparkValues}
                        width={52}
                        height={14}
                        ariaLabel={
                          sparkValues.length
                            ? `${r.label}, five quarters, latest ${fmtCr(r.valueCr)} crore`
                            : `${r.label}: fewer than two quarters on record`
                        }
                      />
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {showMeta ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0">
          <span className="chip">
            <span>{basis}</span>
          </span>
          {verified ? (
            <span
              className="chip chip-up"
              title="Every line item matched the exchange XBRL"
            >
              <span aria-hidden="true">✓</span>
              <span>Exchange XBRL verified</span>
            </span>
          ) : failedCheck ? (
            <span className="chip chip-warn" title={failedCheck}>
              <span aria-hidden="true">!</span>
              <span>{failedCheck}</span>
            </span>
          ) : (
            <span
              className="chip chip-warn"
              title="Read from the filing PDF; XBRL reconciliation pending"
            >
              <span aria-hidden="true">◐</span>
              <span>Preliminary — from filing</span>
            </span>
          )}
          {h1 ? (
            <span className="chip chip-up">
              <span>Q1 + Q2 = H1 ✓</span>
            </span>
          ) : null}
          {!isBank ? (
            <FormulaPopover
              label="EBITDA formula"
              formula={formula}
              lines={lines}
            />
          ) : (
            <span
              className="chip"
              title={`${formatWord} format: NII, PPOP, PBT, PAT — no revenue or EBITDA line`}
            >
              <span>{formatWord} format · no EBITDA</span>
            </span>
          )}
          {hasExceptional ? (
            <span
              className="chip chip-warn"
              title={
                card.exceptional?.note ??
                "Exceptional items are inside PBT and PAT"
              }
            >
              <span>
                Exceptional {formatCrore((exceptionalCr ?? 0) * 1e7)} cr
              </span>
            </span>
          ) : null}
          {card.basisNote ? (
            <span className="receipt">{card.basisNote}</span>
          ) : null}
        </div>
      ) : compactMeta ? (
        <p className="receipt mt-1.5">{compactMetaLine(card)}</p>
      ) : null}
    </div>
  );
}
