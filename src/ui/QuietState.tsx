import Link from "next/link";
import { formatIst } from "@/lib/time";
import type { UpcomingItem } from "./model";

/**
 * Quiet is a result: the verdict, the evidence (companies checked, when),
 * the calendar reason, and what is coming up.
 */
export function QuietState({
  reason,
  companiesChecked,
  checkedAtMs,
  upcoming,
  holidayLine,
}: {
  reason: string;
  companiesChecked: number;
  checkedAtMs: number | null;
  upcoming: UpcomingItem[];
  /** "market closed Tue 10 Nov (Diwali-Balipratipada)" */
  holidayLine?: string | null;
}) {
  return (
    <section className="gutter mt-6" aria-label="Quiet window">
      <div className="card px-4 py-4">
        <p className="title text-ink">
          {reason === "Nothing needs you"
            ? "No filings in this window."
            : reason}
        </p>
        <p className="small text-ink-2 mt-1">
          {companiesChecked} {companiesChecked === 1 ? "company" : "companies"}{" "}
          checked
          {checkedAtMs ? ` · ${formatIst(checkedAtMs, "HH:mm")} IST` : ""}
          {holidayLine ? ` · ${holidayLine}` : ""}
        </p>
        <p className="receipt mt-2">
          nothing material, nothing routine · widen the window or wait for the
          next edition after the close
        </p>
      </div>
      {upcoming.length ? (
        <div className="mt-6">
          <p className="eyebrow">Coming up</p>
          <ul className="m-0 mt-1 p-0 list-none">
            {upcoming.map((u) => (
              <li
                key={`${u.isin}-${u.dateKey}-${u.what}`}
                className="border-b border-rule last:border-b-0"
              >
                <Link
                  href={`/c/${encodeURIComponent(u.symbol)}`}
                  className="row-touch flex items-center gap-3 py-2 no-callout"
                >
                  <span className="receipt w-[84px] shrink-0">{u.dateIst}</span>
                  <span className="symbol small w-[96px] shrink-0 text-ink truncate">
                    {u.symbol}
                  </span>
                  <span className="small text-ink-2 flex-1 min-w-0 truncate">
                    {u.what}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
