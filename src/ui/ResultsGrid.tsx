import type { ResultsCard } from "@/engine/types";
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
export function ResultsGrid({
  card,
  periodEnd,
  withSpark = true,
  showMeta = true,
  components,
}: {
  card: ResultsCard;
  periodEnd?: string | null;
  withSpark?: boolean;
  /** basis chips, verification badge, formula popover */
  showMeta?: boolean;
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
  const basis =
    card.basisLabel ??
    `${card.basis === "standalone" ? "Standalone" : "Consolidated"} · ₹ cr`;
  const verified = card.checksum === "exchange_xbrl";
  const h1 = card.verification?.h1Check;
  const exceptionalCr = card.exceptional?.currentCr ?? null;
  const formula =
    card.ebitdaFormula === "pbt+fin+dna"
      ? "EBITDA = PBT + finance costs + D&A"
      : "EBITDA = PBT + finance costs + D&A − other income";
  const lines: string[] = [];
  if (components?.pbt != null) lines.push(`PBT ${formatCrore(components.pbt)}`);
  if (components?.fin != null)
    lines.push(`+ finance costs ${formatCrore(components.fin)}`);
  if (components?.dna != null)
    lines.push(`+ D&A ${formatCrore(components.dna)}`);
  if (components?.oi != null && card.ebitdaFormula !== "pbt+fin+dna")
    lines.push(`− other income ${formatCrore(components.oi)}`);

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
              <th scope="col" className="hd r">
                5 q
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
            <span className="chip">
              <span>Bank format · no EBITDA</span>
            </span>
          )}
          {exceptionalCr != null && exceptionalCr !== 0 ? (
            <span className="chip chip-warn">
              <span>Exceptional {formatCrore(exceptionalCr * 1e7)} cr</span>
            </span>
          ) : null}
          {card.basisNote ? (
            <span className="receipt">{card.basisNote}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
