import Link from "next/link";
import type { UpcomingItem } from "./model";

/**
 * Coming up — one line per event. Date, symbol, what. No grouped essay.
 */
export function ComingUp({
  items,
  limit = 5,
  gutter = true,
}: {
  items: UpcomingItem[];
  limit?: number;
  /** apply the page gutter to each row (false inside an already-padded parent) */
  gutter?: boolean;
}) {
  if (!items.length) return null;
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return (
    <div>
      <ul className="m-0 list-none p-0">
        {shown.map((u) => (
          <li
            key={`${u.isin}-${u.dateKey}-${u.what}`}
            className="border-b border-rule last:border-b-0"
          >
            <Link
              href={`/c/${encodeURIComponent(u.symbol)}`}
              className={`row-touch flex items-center gap-3 no-callout ${gutter ? "gutter" : ""}`}
            >
              <span className="receipt w-[84px] shrink-0">{u.dateIst}</span>
              <span className="symbol small w-[88px] shrink-0 truncate">
                {u.symbol}
              </span>
              <span className="small min-w-0 flex-1 truncate text-ink-2">
                {u.what}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className={`receipt mt-1 ${gutter ? "gutter" : ""}`}>
          +{rest} later
        </p>
      ) : null}
    </div>
  );
}
