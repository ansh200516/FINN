import Link from "next/link";
import { dayLabel, formatPct, formatRatio, groupIndian } from "@/lib/format";
import { istDateKey, NSE_SPECIAL_SESSIONS } from "@/lib/time";
import { DeltaChip } from "./DeltaChip";
import type { AnomalyWithSymbol } from "./model";

/**
 * Special sessions (Muhurat) whose date falls inside the range the strip
 * covers. The engine skips them when scoring, so the strip says so. Pass
 * `window` for an exact answer; otherwise the range runs from the earliest
 * anomaly shown to today.
 */
export function excludedSpecialSessions(
  anomalies: AnomalyWithSymbol[],
  window?: { fromMs: number; toMs: number },
  now: number = Date.now(),
): Array<{ dateKey: string; name: string }> {
  const from = window
    ? istDateKey(window.fromMs)
    : anomalies.map((a) => a.date).sort()[0];
  const to = window ? istDateKey(window.toMs - 1) : istDateKey(now);
  if (!from) return [];
  return Object.entries(NSE_SPECIAL_SESSIONS)
    .filter(([key]) => key >= from && key <= to)
    .map(([dateKey, s]) => ({ dateKey, name: s.name }));
}

function Row({ a }: { a: AnomalyWithSymbol }) {
  return (
    <li className="border-b border-rule last:border-b-0">
      <Link
        href={`/c/${encodeURIComponent(a.symbol)}`}
        className="row-touch flex items-center gap-3 gutter py-2 no-callout"
        aria-label={a.summary}
      >
        <span className="w-[88px] shrink-0 symbol small truncate">
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
  window,
}: {
  anomalies: AnomalyWithSymbol[];
  limit?: number;
  /** the brief window, for an exact "special session excluded" note */
  window?: { fromMs: number; toMs: number };
}) {
  if (!anomalies.length) return null;
  const strength = (a: AnomalyWithSymbol) =>
    Math.max(Math.abs(a.pctMove ?? 0) / 5, (a.volumeRatio ?? 0) / 2);
  const ranked = [...anomalies].sort((a, b) => strength(b) - strength(a));
  const head = ranked.slice(0, limit);
  const rest = ranked.slice(limit);
  const excluded = excludedSpecialSessions(anomalies, window);
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
      {excluded.length ? (
        <p className="gutter mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {excluded.map((s) => (
            <span
              key={s.dateKey}
              className="chip"
              title={`${s.name}: a special session is not comparable with normal sessions, so its bar is not scored`}
            >
              <span aria-hidden="true">◌</span>
              <span>
                {/muhurat/i.test(s.name) ? "Muhurat" : "special"} session{" "}
                {dayLabel(s.dateKey)} excluded
              </span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export function anomalySentence(a: AnomalyWithSymbol): string {
  return `${a.symbol} ${formatPct(a.pctMove)} on ${formatRatio(a.volumeRatio)} volume · ${dayLabel(a.date)}`;
}
