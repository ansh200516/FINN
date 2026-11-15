import { groupIndian } from "@/lib/format";
import { formatIst } from "@/lib/time";
import { CitationChip } from "./CitationChip";
import {
  groupLedger,
  horizonEndOf,
  interimOf,
  type LedgerGroup,
  noteOf,
  revisedLabel,
  statedPeriodOf,
} from "./ledger";
import type { LedgerRowView } from "./model";
import { VERDICT_LEGEND, VerdictBadge, type VerdictLike } from "./VerdictBadge";

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
    case "units":
      return "";
    default:
      return unit ? ` ${unit}` : "";
  }
}

/** Absolute-rupee amounts (unit "INR") are shown in crore / lakh; "INR_cr" is already crore. */
function money(
  v: number,
  unit: string | null,
): { text: string; suffix: string } {
  // foreign currency in absolute units → mn / bn (ledger quotes say "USD 150 million")
  if (unit && /^(USD|EUR|GBP|JPY|AED|SGD)$/i.test(unit)) {
    const a = Math.abs(v);
    const cur = unit.toUpperCase();
    if (a >= 1e9)
      return {
        text: `${cur} ${groupIndian(v / 1e9, a / 1e9 < 10 ? 1 : 0)}`,
        suffix: " bn",
      };
    if (a >= 1e6)
      return {
        text: `${cur} ${groupIndian(v / 1e6, a / 1e6 < 10 ? 1 : 0)}`,
        suffix: " mn",
      };
    return { text: `${cur} ${groupIndian(v, 0)}`, suffix: "" };
  }
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

/** Absolute-rupee edges in a stored rule read as crore. */
function readableRule(rule: string): string {
  return rule.replace(/\d{8,}/g, (digits) => {
    const n = Number(digits);
    if (!Number.isFinite(n) || Math.abs(n) < 1e7) return digits;
    const cr = n / 1e7;
    return `${groupIndian(cr, Math.abs(cr) < 100 ? 1 : 0)} cr`;
  });
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
  if (a.suffix === b.suffix)
    return `${isMoney(unit) ? "₹ " : ""}${a.text}–${b.text}${a.suffix}`;
  return `${fmtValue(low, unit)} – ${fmtValue(high, unit)}`;
}

export function promised(r: LedgerRowView): string {
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
  if (!d || d.value == null) {
    if (r.status === "open") return "not yet due";
    if (r.verdict === "unverifiable") return "not derivable";
    if (r.verdict === "not_addressed") return "not addressed";
    return "—";
  }
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

function docLabelOf(r: LedgerRowView): string {
  return r.docKind === "transcript"
    ? `${r.docPeriod ?? ""} call`.trim()
    : r.docKind === "annual_report"
      ? `AR ${r.docPeriod ?? ""}`.trim()
      : (r.docPeriod ?? "filing");
}

function verdictOf(r: LedgerRowView): VerdictLike {
  if (r.verdict) return r.verdict;
  if (r.status === "open") return "open";
  if (r.status === "superseded") return "superseded";
  if (r.status === "withdrawn") return "withdrawn";
  return "unverifiable";
}

const REVISION_WORD: Record<string, string> = {
  new: "first stated",
  maintained: "reiterated",
  raised: "raised",
  cut: "cut",
  withdrawn: "withdrawn",
};

/** One earlier version inside the "revised n×" disclosure. */
function RevisionRow({
  r,
  symbol,
  headMetric,
}: {
  r: LedgerRowView;
  symbol: string;
  headMetric: string;
}) {
  const rev =
    typeof r.evidence?.revision === "string"
      ? REVISION_WORD[r.evidence.revision]
      : undefined;
  const docLabel = docLabelOf(r);
  const when = statedPeriodOf(r) ?? r.statedOnIst ?? docLabel;
  return (
    <li className="py-2 border-b border-rule last:border-b-0">
      <p className="small text-ink-2">
        <span className="num text-ink font-medium">{promised(r)}</span>
        {rev ? <span className="text-ink-3"> · {rev}</span> : null}
        {r.metric !== headMetric ? (
          <span className="text-ink-3">
            {" "}
            · as {metricLabel(r.metric).toLowerCase()}
          </span>
        ) : null}
        {r.verdict === "cut" || r.verdict === "raised" ? (
          <VerdictBadge verdict={r.verdict} className="ml-2 meta" />
        ) : null}
      </p>
      <p className="quote text-ink-2 mt-0.5 line-clamp-2 text-[14px] leading-[20px]">
        “{r.quote}”
      </p>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3">
        <p className="receipt">
          {[r.speaker, r.role].filter(Boolean).join(", ") || "Management"} ·{" "}
          {when}
        </p>
        <CitationChip
          citation={{
            label: r.page ? `${docLabel} p.${r.page}` : docLabel,
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
}

function PromiseRow({ g, symbol }: { g: LedgerGroup; symbol: string }) {
  const r = g.head;
  const docLabel = docLabelOf(r);
  const chipLabel = r.page ? `${docLabel} p.${r.page}` : docLabel;
  const verdict = verdictOf(r);
  const note = noteOf(r);
  const interim = r.status === "open" ? interimOf(r) : null;
  const horizonEnd = horizonEndOf(r);
  // the note explains an outcome; for open rows the due date says it better
  const why =
    r.status !== "open" && note && !/^due after/i.test(note) ? note : null;
  // unverifiable is a claim the reader cannot check — the reason stays in
  // the row, not behind the "?" disclosure
  const inlineWhy = verdict === "unverifiable" && !!why;
  const due =
    r.status === "open" && horizonEnd
      ? `due after ${formatIst(horizonEnd, "d MMM yyyy")}`
      : r.status === "open" && note && /^open-ended/i.test(note)
        ? "open-ended horizon"
        : null;
  const src = r.delivered?.source ? sourceLabel(r.delivered.source) : null;
  const basis = typeof r.evidence?.basis === "string" ? r.evidence.basis : null;
  const rule = typeof r.evidence?.rule === "string" ? r.evidence.rule : null;
  const scored =
    verdict === "kept" ||
    verdict === "missed" ||
    verdict === "beat" ||
    verdict === "cut";
  const scoreWhy = scored
    ? [
        basis,
        r.horizon?.replace(/_/g, " ") ?? null,
        rule ? readableRule(rule) : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";
  const header = (
    <>
      <span className="rowtitle text-ink min-w-0">
        {metricLabel(r.metric)}
        {r.horizon ? (
          <span className="ml-2 font-normal text-ink-3 meta">
            {r.horizon.replace(/_/g, " ")}
          </span>
        ) : null}
      </span>
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <VerdictBadge verdict={verdict} className="small" />
        {why && !inlineWhy ? (
          <span className="why-mark" aria-hidden="true">
            ?
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <li
      className={`border-b border-rule last:border-b-0 py-3 ${g.orphanChain ? "opacity-80" : ""}`}
    >
      {why && !inlineWhy ? (
        <details className="why">
          <summary
            className="no-callout row"
            aria-label={`${metricLabel(r.metric)} — ${verdict.replace(/_/g, " ")}; tap for why`}
          >
            {header}
          </summary>
          <p className="small text-ink-2 mt-1 border-l-2 border-rule pl-3">
            {why}
          </p>
        </details>
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          {header}
        </div>
      )}
      {inlineWhy ? (
        <p className="small text-ink-2 mt-1 border-l-2 border-rule pl-3">
          {why}
        </p>
      ) : null}
      <p className="quote text-ink-2 mt-1">“{r.quote}”</p>
      {scoreWhy ? <p className="receipt mt-1">{scoreWhy}</p> : null}
      <p className="receipt mt-1">
        {[r.speaker, r.role].filter(Boolean).join(", ") || "Management"} ·{" "}
        {r.statedOnIst ?? docLabel}
        {due ? ` · ${due}` : ""}
      </p>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-2 rounded-[var(--r-chip)] border border-rule bg-surface px-3 py-1.5">
        <div className="min-w-0">
          <p className="eyebrow">Promised</p>
          <p className="num small text-ink mt-0.5 break-words">{promised(r)}</p>
        </div>
        <span className="text-ink-3 self-center" aria-hidden="true">
          →
        </span>
        <div className="min-w-0">
          <p className="eyebrow">Delivered</p>
          <p className="num small text-ink mt-0.5 break-words">
            {delivered(r)}
          </p>
          {src ? (
            src.href ? (
              <a
                href={src.href}
                target="_blank"
                rel="noreferrer"
                className="block meta text-accent truncate"
              >
                {src.text}
                {r.settledByQuarter ? ` · ${r.settledByQuarter}` : ""} ↗
              </a>
            ) : (
              <span className="block meta text-ink-3 truncate">{src.text}</span>
            )
          ) : r.settledByQuarter ? (
            <span className="block meta text-ink-3">
              settled {r.settledByQuarter}
            </span>
          ) : interim ? (
            <span className="block meta text-ink-3">
              so far{" "}
              <span className="num text-ink-2">
                {fmtValue(interim.value, interim.unit ?? r.unit)}
              </span>
              {interim.note ? ` · ${interim.note.split(":")[0]}` : ""}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 -mb-2 flex flex-wrap items-center gap-x-2">
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
        {g.orphanChain ? (
          <span className="receipt">
            superseded · no later version on record
          </span>
        ) : null}
      </div>
      {g.revisions.length ? (
        <details className="mt-1">
          <summary className="row flex items-center gap-2 receipt no-callout -ml-1 pl-1">
            <span className="chev" aria-hidden="true">
              ▸
            </span>
            {revisedLabel(g.revisions.length)} · earlier versions
          </summary>
          <ul className="m-0 mt-1 p-0 list-none border-l-2 border-rule pl-3">
            {g.revisions.map((v) => (
              <RevisionRow
                key={v.id}
                r={v}
                symbol={symbol}
                headMetric={r.metric}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Promise Ledger as a table-as-list: each row = quote · speaker · date ·
 * promised → delivered · verdict, with the quote one tap away. Superseded
 * versions fold under their latest restatement ("revised 2×").
 */
export function LedgerList({
  rows,
  symbol,
}: {
  rows: LedgerRowView[];
  symbol: string;
}) {
  if (!rows.length) return null;
  const groups = groupLedger(rows);
  return (
    <ul className="m-0 p-0 list-none">
      {groups.map((g) => (
        <PromiseRow key={g.head.id} g={g} symbol={symbol} />
      ))}
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
