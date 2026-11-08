import { formatIst } from "@/lib/time";
import { ComingUp } from "./ComingUp";
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
    <section className="mt-6" aria-label="Quiet window">
      <div className="gutter">
        <div className="card px-4 py-4">
          <p className="title text-ink">
            {reason === "Nothing needs you"
              ? "No filings in this window."
              : reason}
          </p>
          <p className="small text-ink-2 mt-1">
            {companiesChecked}{" "}
            {companiesChecked === 1 ? "company" : "companies"} checked
            {checkedAtMs ? ` · ${formatIst(checkedAtMs, "HH:mm")} IST` : ""}
            {holidayLine ? ` · ${holidayLine}` : ""}
          </p>
          <p className="receipt mt-2">
            nothing material, nothing routine · widen the window or wait for the
            next edition after the close
          </p>
        </div>
      </div>
      {upcoming.length ? (
        <div className="mt-6">
          <p className="eyebrow gutter">Coming up</p>
          <div className="mt-1">
            <ComingUp items={upcoming} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
