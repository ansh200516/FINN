import { groupIndian } from "@/lib/format";
import { CitationChip } from "./CitationChip";
import type { LedgerRowView } from "./model";
import { VERDICT_LEGEND, VerdictBadge } from "./VerdictBadge";

function unitLabel(unit: string | null): string {
  switch (unit) {
    case "%":
      return "%";
    case "bp":
      return " bp";
    case "INR_cr":
      return " cr";
    case "INR":
      return "";
    case "x":
      return "×";
    default:
      return unit ? ` ${unit}` : "";
  }
}

/** Absolute-rupee amounts (unit "INR") are shown in crore / lakh; "INR_cr" is already crore. */
function money(
  v: number,
  unit: string | null,
): { text: string; suffix: string } {
  if (unit === "INR") {
    const a = Math.abs(v);
    if (a >= 1e7)
      return {
        text: groupIndian(v / 1e7, a / 1e7 < 100 ? 1 : 0),
        suffix: " cr",
      };
    if (a >= 1e5)
      return {
        text: groupIndian(v / 1e5, a / 1e5 < 100 ? 1 : 0),
        suffix: " L",
      };
    return { text: groupIndian(v, 0), suffix: "" };
  }
  return {
    text: groupIndian(v, Number.isInteger(v) ? 0 : 1),
    suffix: unitLabel(unit),
  };
}

function isMoney(unit: string | null): boolean {
  return unit === "INR" || unit === "INR_cr";
}

function fmtValue(v: number, unit: string | null): string {
  const m = money(v, unit);
  return `${isMoney(unit) ? "₹ " : ""}${m.text}${m.suffix}`;
}

function fmtRange(low: number, high: number, unit: string | null): string {
  const a = money(low, unit);
  const b = money(high, unit);
  const suffix = a.suffix === b.suffix ? b.suffix : `${a.suffix}–${b.suffix}`;
  if (a.suffix === b.suffix)
    return `${isMoney(unit) ? "₹ " : ""}${a.text}–${b.text}${suffix}`;
  return `${fmtValue(low, unit)} – ${fmtValue(high, unit)}`;
}

function promised(r: LedgerRowView): string {
  if (r.low != null && r.high != null && r.low !== r.high)
    return fmtRange(r.low, r.high, r.unit);
  const v = r.low ?? r.high;
  if (v != null) {
    const approx = r.direction === "absolute" ? "~" : "";
    return `${approx}${fmtValue(v, r.unit)}`;
  }
  switch (r.direction) {
    case "up":
      return "higher";
    case "down":
      return "lower";
    case "flat":
      return "flat";
    default:
      return "qualitative";
  }
}

function delivered(r: LedgerRowView): string {
  const d = r.delivered;
  if (!d || d.value == null) return r.status === "open" ? "not yet due" : "—";
  return fmtValue(d.value, d.unit ?? r.unit);
}

/** Delivered-source text: URLs collapse to a short label; prose passes through. */
function sourceLabel(src: string): { text: string; href: string | null } {
  if (/^https?:\/\//i.test(src)) {
    const text = /xbrl/i.test(src)
      ? "exchange XBRL"
      : /\.pdf(\?|$)/i.test(src)
        ? "filing PDF"
        : "source";
    return { text, href: src };
  }
  return { text: src, href: null };
}

function metricLabel(m: string): string {
  const s = m.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Promise Ledger as a table-as-list: each row = quote · speaker · date ·
 * page · promised · delivered · verdict, with the quote one tap away.
 */
export function LedgerList({
  rows,
  symbol,
}: {
  rows: LedgerRowView[];
  symbol: string;
}) {
  if (!rows.length) return null;
  return (
    <ul className="m-0 p-0 list-none">
      {rows.map((r) => {
        const docLabel =
          r.docKind === "transcript"
            ? `${r.docPeriod ?? ""} call`.trim()
            : r.docKind === "annual_report"
              ? `AR ${r.docPeriod ?? ""}`.trim()
              : (r.docPeriod ?? "filing");
        const chipLabel = r.page ? `${docLabel} p.${r.page}` : docLabel;
        return (
          <li key={r.id} className="border-b border-rule last:border-b-0 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="rowtitle text-ink">
                {metricLabel(r.metric)}
                {r.horizon ? (
                  <span className="ml-2 font-normal text-ink-3 meta">
                    {r.horizon.replace(/_/g, " ")}
                  </span>
                ) : null}
              </span>
              <VerdictBadge
                verdict={
                  r.verdict ?? (r.status === "open" ? "open" : "unverifiable")
                }
                className="small"
              />
            </div>
            <p className="quote text-ink-2 mt-1">“{r.quote}”</p>
            <p className="receipt mt-1">
              {[r.speaker, r.role].filter(Boolean).join(", ") || "Management"} ·{" "}
              {r.statedOnIst ?? docLabel}
            </p>
            <div className="mt-2 grid grid-cols-[1fr_1fr] gap-x-4">
              <div>
                <p className="eyebrow">Promised</p>
                <p className="num small text-ink mt-0.5">{promised(r)}</p>
              </div>
              <div>
                <p className="eyebrow">Delivered</p>
                <p className="num small text-ink mt-0.5">
                  {delivered(r)}
                  {r.delivered?.source ? (
                    (() => {
                      const s = sourceLabel(r.delivered.source);
                      return s.href ? (
                        <a
                          href={s.href}
                          target="_blank"
                          rel="noreferrer"
                          className="block meta text-accent font-normal truncate"
                        >
                          {s.text}
                          {r.settledByQuarter ? ` · ${r.settledByQuarter}` : ""}{" "}
                          ↗
                        </a>
                      ) : (
                        <span className="block meta text-ink-3 font-normal">
                          {s.text}
                        </span>
                      );
                    })()
                  ) : r.settledByQuarter ? (
                    <span className="block meta text-ink-3 font-normal">
                      settled {r.settledByQuarter}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            <div className="mt-1 -mb-2">
              <CitationChip
                citation={{
                  label: chipLabel,
                  quote: r.quote,
                  speaker: r.speaker,
                  role: r.role,
                  docTitle: `${symbol} ${docLabel}`,
                  page: r.page,
                  url: r.docUrl,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function VerdictLegend() {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 meta">
      {VERDICT_LEGEND.map((v) => (
        <VerdictBadge key={v} verdict={v} />
      ))}
    </p>
  );
}
