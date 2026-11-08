import Link from "next/link";
import { dayLabel, formatPct, formatRatio, groupIndian } from "@/lib/format";
import { DeltaChip } from "./DeltaChip";
import type { AnomalyWithSymbol } from "./model";

function Row({ a }: { a: AnomalyWithSymbol }) {
  return (
    <li className="border-b border-rule last:border-b-0">
      <Link
        href={`/c/${encodeURIComponent(a.symbol)}`}
        className="row-touch flex items-center gap-3 gutter py-2 no-callout"
        aria-label={a.summary}
      >
        <span className="w-[88px] shrink-0 symbol small text-ink truncate">
          {a.symbol}
        </span>
        <span className="flex-1 min-w-0 flex items-baseline gap-3">
          <DeltaChip value={a.pctMove} className="small font-medium" />
          <span
            className={`small num ${a.kind === "volume_ratio" ? "delta-warn" : "text-ink-2"}`}
          >
            {formatRatio(a.volumeRatio)} vol
          </span>
          {a.close != null ? (
            <span className="meta text-ink-3 num hidden min-[400px]:inline">
              ₹ {groupIndian(a.close, 2)}
            </span>
          ) : null}
        </span>
        <span className="receipt shrink-0">{dayLabel(a.date)}</span>
      </Link>
    </li>
  );
}

/**
 * EOD anomalies inside the window: one 48 px row each —
 * symbol · ▲ +11.6% · 5.8× volume · day. Colour only on the delta. The
 * strongest `limit` rows stay visible; the rest fold behind a count.
 */
export function AnomalyStrip({
  anomalies,
  limit = 6,
}: {
  anomalies: AnomalyWithSymbol[];
  limit?: number;
}) {
  if (!anomalies.length) return null;
  const strength = (a: AnomalyWithSymbol) =>
    Math.max(Math.abs(a.pctMove ?? 0) / 5, (a.volumeRatio ?? 0) / 2);
  const ranked = [...anomalies].sort((a, b) => strength(b) - strength(a));
  const head = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  return (
    <div className="border-t border-rule">
      <ul className="m-0 p-0 list-none">
        {head.map((a) => (
          <Row key={`${a.isin}-${a.date}-${a.kind}`} a={a} />
        ))}
      </ul>
      {rest.length ? (
        <details>
          <summary className="row-touch gutter flex items-center gap-2 receipt no-callout border-b border-rule">
            <span className="chev" aria-hidden="true">
              ▸
            </span>
            {rest.length} more inside the window
          </summary>
          <ul className="m-0 p-0 list-none">
            {rest.map((a) => (
              <Row key={`${a.isin}-${a.date}-${a.kind}`} a={a} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function anomalySentence(a: AnomalyWithSymbol): string {
  return `${a.symbol} ${formatPct(a.pctMove)} on ${formatRatio(a.volumeRatio)} volume · ${dayLabel(a.date)}`;
}
