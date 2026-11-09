import { NO_PROMISES, scoredPromises } from "@/lib/companyTurn";
import { promised } from "./LedgerList";
import type { LedgerRowView } from "./model";
import { VerdictBadge } from "./VerdictBadge";

function metricLabel(metric: string): string {
  const s = metric.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clause(r: LedgerRowView): string {
  const figure = promised(r);
  const horizon = r.horizon ? r.horizon.replace(/_/g, " ") : null;
  return horizon
    ? `${metricLabel(r.metric)} ${figure}, ${horizon}`
    : `${metricLabel(r.metric)} ${figure}`;
}

function docLabel(r: LedgerRowView): string {
  if (r.docKind === "transcript") return `${r.docPeriod ?? ""} call`.trim();
  if (r.docKind === "annual_report") return `AR ${r.docPeriod ?? ""}`.trim();
  return r.docPeriod ?? "filing";
}

/**
 * Scored promises only. The verdict and one clause are the row; the quote
 * stays inside the disclosure until it is opened.
 */
export function ScoredPromises({
  rows,
  symbol,
}: {
  rows: LedgerRowView[];
  symbol: string;
}) {
  const scored = scoredPromises(rows);
  if (!scored.length) return <p className="small text-ink">{NO_PROMISES}</p>;
  return (
    <ul className="m-0 p-0 list-none" aria-label={`${symbol} scored promises`}>
      {scored.map((r) => (
        <li key={r.id} className="border-b border-rule last:border-b-0">
          <details>
            <summary className="row-touch flex items-baseline gap-3 py-2 no-callout">
              <VerdictBadge verdict={r.verdict} className="small shrink-0" />
              <span className="small text-ink flex-1 min-w-0">{clause(r)}</span>
              <span className="chev text-ink-3 shrink-0" aria-hidden="true">
                ▸
              </span>
            </summary>
            <blockquote className="quote text-ink-2 border-l-2 border-accent pl-3 mt-1 mb-2">
              “{r.quote}”
            </blockquote>
            <p className="receipt mb-2">
              {[r.speaker, r.role].filter(Boolean).join(", ") || "Management"}
              {" · "}
              {r.statedOnIst ?? docLabel(r)}
              {r.page ? ` · p.${r.page}` : ""}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
