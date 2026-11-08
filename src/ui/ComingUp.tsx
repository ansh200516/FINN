import Link from "next/link";
import type { UpcomingItem } from "./model";

/**
 * "Coming up" — board meetings, calls and record dates ahead of the window,
 * grouped by day so a results week reads as a calendar: the date once on
 * the left, the companies stacked beside it. Used by the quiet state and the
 * brief's tail.
 */
export function ComingUp({
  items,
  limit = 6,
  gutter = true,
}: {
  items: UpcomingItem[];
  limit?: number;
  /** apply the page gutter to each row (false inside an already-padded parent) */
  gutter?: boolean;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, limit);
  const byDay = new Map<string, UpcomingItem[]>();
  for (const u of shown) {
    const l = byDay.get(u.dateKey) ?? [];
    l.push(u);
    byDay.set(u.dateKey, l);
  }
  const rest = items.length - shown.length;
  return (
    <div>
      <ul className="m-0 p-0 list-none border-t border-rule">
        {[...byDay.entries()].map(([dateKey, list]) => (
          <li
            key={dateKey}
            className={`border-b border-rule flex items-start gap-3 py-2 ${gutter ? "gutter" : ""}`}
          >
            <span className="receipt w-[84px] shrink-0 pt-[3px]">
              {list[0]?.dateIst}
            </span>
            <ul className="m-0 p-0 list-none flex-1 min-w-0">
              {list.map((u) => (
                <li key={`${u.isin}-${u.what}`} className="min-w-0">
                  <Link
                    href={`/c/${encodeURIComponent(u.symbol)}`}
                    className="flex items-baseline gap-2 min-w-0 py-0.5 no-callout"
                  >
                    <span className="symbol small text-ink shrink-0">
                      {u.symbol}
                    </span>
                    <span className="small text-ink-2 min-w-0 truncate">
                      {u.what}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className={`receipt mt-1 ${gutter ? "gutter" : ""}`}>
          +{rest} more in the calendar
        </p>
      ) : null}
    </div>
  );
}
