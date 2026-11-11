import Link from "next/link";
import type { ChatQuarter, ChatQuarterMetric } from "@/lib/finnieTypes";
import { EM_DASH, groupIndian } from "@/lib/format";
import type { ComparisonRow } from "@/lib/promiseCompare";
import { DeltaChip } from "./DeltaChip";
import { VerdictBadge } from "./VerdictBadge";

function fmtCr(value: number | null): string {
  if (value == null) return EM_DASH;
  return groupIndian(value, Math.abs(value) < 100 ? 1 : 0);
}

function rowLabel(
  quarters: ChatQuarter[],
  key: "revenue" | "ebitda" | "pbt" | "pat",
  bank: boolean,
): string {
  const sample = quarters.find((quarter) => quarter[key]?.label)?.[key]?.label;
  if (sample) return sample;
  if (key === "revenue") return bank ? "NII" : "Revenue";
  if (key === "ebitda") return bank ? "PPOP" : "EBITDA";
  if (key === "pbt") return "PBT";
  return "PAT";
}

function Figure({ metric }: { metric: ChatQuarterMetric | null }) {
  if (!metric || (metric.crore == null && metric.yoyPct == null)) {
    return <span className="num">{EM_DASH}</span>;
  }
  return (
    <span className="inline-flex flex-col items-end">
      <span className="num font-medium">{fmtCr(metric.crore)}</span>
      {metric.yoyPct != null ? (
        <span className="small">
          <DeltaChip value={metric.yoyPct} />
          <span className="text-ink-3"> YoY</span>
        </span>
      ) : null}
    </span>
  );
}

/** One table. Periods are the columns. YoY sits on the cell. */
export function QuarterBoard({
  quarters,
  symbol = "",
}: {
  quarters: ChatQuarter[];
  symbol?: string;
}) {
  const shown = quarters.slice(0, 8);
  const bank = shown.some(
    (quarter) =>
      quarter.revenue?.label === "NII" || quarter.ebitda?.label === "PPOP",
  );
  const keys = bank
    ? (["revenue", "ebitda", "pat"] as const)
    : (["revenue", "ebitda", "pbt", "pat"] as const);
  const name = symbol.trim() || "Company";
  return (
    <div className="qboard-wrap">
      <table
        className="rtable qboard"
        aria-label={`${name} four quarters`}
        data-quarters=""
      >
        <thead>
          <tr>
            <th scope="col" className="hd">
              ₹ cr
            </th>
            {shown.map((quarter) => (
              <th key={quarter.period} scope="col" className="hd r">
                {quarter.period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row" className="cell small text-ink-2">
                {rowLabel(shown, key, bank)}
              </th>
              {shown.map((quarter) => (
                <td key={`${key}-${quarter.period}`} className="cell r qcell">
                  <Figure metric={quarter[key]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeliveredText({ text }: { text: string }) {
  const cut = text.indexOf(" is ");
  if (cut > 0 && /^[+\-−\d]/.test(text)) {
    return (
      <>
        <span className="num text-ink">{text.slice(0, cut)}</span>
        <span className="text-ink">{text.slice(cut)}</span>
      </>
    );
  }
  return (
    <span className={/^[+\-−\d]/.test(text) ? "num text-ink" : "text-ink"}>
      {text}
    </span>
  );
}

/** One pair: the quote, what was promised, what was delivered, one chip. */
export function ComparisonList({
  rows,
  symbol,
}: {
  rows: ComparisonRow[];
  symbol: string;
}) {
  const page = symbol.trim() ? `/c/${encodeURIComponent(symbol.trim())}` : null;
  if (!rows.length && !page) return null;
  return (
    <div>
      {rows.length ? (
        <ul
          className="pair-list"
          aria-label="Promised versus delivered"
          data-promised=""
        >
          {rows.map((row, index) => (
            <li key={`${row.period}-${row.quote}-${index}`} className="pair">
              <div className="pair-top">
                <VerdictBadge verdict={row.verdict} className="small" />
                <span className="receipt">{row.period}</span>
              </div>
              {row.quote ? <p className="pair-quote">{row.quote}</p> : null}
              <p className="pair-row">
                <span className="pair-k">Promised</span>
                <span className="num text-ink">{row.promised}</span>
              </p>
              <p className="pair-row">
                <span className="pair-k">Delivered</span>
                <DeliveredText
                  text={row.delivered ?? "not the consolidated line"}
                />
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {page ? (
        <Link href={page} className="thread-link mt-2">
          more on the company page
        </Link>
      ) : null}
    </div>
  );
}
