import Link from "next/link";
import { categoryLabel, filedLabel } from "@/lib/format";
import { CardBody } from "./CardBody";
import { CategoryGlyph } from "./CategoryGlyph";
import type { EventCard } from "./model";
import { SourceChips } from "./SourceChips";
import { SymbolChip } from "./SymbolChip";

/** "17:21 IST · after close" or just the day when the source stamped no time. */
export function filedStamp(
  card: EventCard,
  now: number,
): { line: string; short: string } {
  const dateOnly = !/\d{1,2}:\d{2}/.test(card.filedAtIst);
  const f = filedLabel(card.filedAtMs, now);
  if (dateOnly) return { line: f.day, short: f.day };
  return {
    line: `${f.day} · ${f.time} · ${f.phase}`,
    short: `${f.time} · ${f.phase}`,
  };
}

/**
 * Full filing card. The edition list does not render this — it renders
 * DecisionCard, one sentence and a chip. The detail page still uses CardBody.
 * `filedStamp` stays here because the fold and the company page share it.
 */
export function FilingCard({
  event,
  now,
  index = 0,
  periodEnd,
}: {
  event: EventCard;
  now: number;
  index?: number;
  periodEnd?: string | null;
}) {
  const stamp = filedStamp(event, now);
  const href = `/e/${encodeURIComponent(event.eventKey)}`;
  return (
    <article
      className="card card-material mx-4 px-4 py-3 reveal"
      style={{ animationDelay: `${180 + index * 60}ms` }}
      aria-labelledby={`t-${event.eventKey}`}
    >
      <div className="flex items-center justify-between gap-3 meta">
        <div className="flex items-center gap-2 min-w-0">
          <SymbolChip symbol={event.symbol} className="text-ink" />
          <span className="text-ink-3 inline-flex items-center gap-1 truncate">
            <CategoryGlyph category={event.category} />
            {categoryLabel(event.category)}
          </span>
        </div>
        <span className="receipt whitespace-nowrap">{stamp.short}</span>
      </div>
      <Link href={href} className="block mt-1.5 no-callout">
        <h3 id={`t-${event.eventKey}`} className="title text-ink">
          {event.title}
        </h3>
        {event.oneLiner ? (
          <p className="small text-ink-2 mt-1">{event.oneLiner}</p>
        ) : null}
      </Link>
      <CardBody event={event} compact periodEnd={periodEnd} />
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <SourceChips sources={event.sources.slice(0, 2)} />
          {event.sources.length > 2 || event.followUps ? (
            <span className="receipt">
              {[
                event.sources.length > 2
                  ? `+${event.sources.length - 2} sources`
                  : null,
                event.followUps
                  ? `+${event.followUps} follow-up${event.followUps === 1 ? "" : "s"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </div>
        <Link
          href={href}
          className="chip-tap shrink-0"
          aria-label={`Open ${event.symbol} card`}
        >
          <span className="chip chip-ink">
            <span>Open</span>
            <span aria-hidden="true">→</span>
          </span>
        </Link>
      </div>
    </article>
  );
}

/** Tier-2 one-liner: a 48 px row — symbol · title · time. */
export function OneLinerRow({ event, now }: { event: EventCard; now: number }) {
  const stamp = filedStamp(event, now);
  return (
    <li className="border-b border-rule last:border-b-0">
      <Link
        href={`/e/${encodeURIComponent(event.eventKey)}`}
        className="row-touch flex items-center gap-3 gutter py-2 no-callout active:bg-surface"
      >
        <span className="w-[88px] shrink-0 symbol small truncate">
          {event.symbol}
        </span>
        <span className="flex-1 min-w-0">
          <span className="small text-ink block truncate">{event.title}</span>
          <span className="meta text-ink-3 inline-flex items-center gap-1">
            <CategoryGlyph category={event.category} size={10} />
            {categoryLabel(event.category)}
            {event.followUps ? ` · +${event.followUps}` : ""}
          </span>
        </span>
        <span className="receipt shrink-0 text-right">
          {stamp.short.split(" · ")[0]}
        </span>
      </Link>
    </li>
  );
}
