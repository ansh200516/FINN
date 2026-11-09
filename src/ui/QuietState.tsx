import { formatIst } from "@/lib/time";
import { ComingUp } from "./ComingUp";
import type { UpcomingItem } from "./model";

/**
 * A window with nothing to decide. One line of reason, one line of evidence,
 * then coming up as one line per event.
 */
export function QuietState({
  reason,
  companiesChecked,
  checkedAtMs,
  upcoming,
}: {
  reason: string;
  companiesChecked: number;
  checkedAtMs: number | null;
  upcoming: UpcomingItem[];
}) {
  return (
    <section className="mt-6" aria-label="Quiet window">
      <div className="gutter">
        <p className="small text-ink-2">{reason}</p>
        <p className="receipt mt-1">
          {companiesChecked} {companiesChecked === 1 ? "company" : "companies"}{" "}
          checked
          {checkedAtMs ? ` · ${formatIst(checkedAtMs, "HH:mm")} IST` : ""}
        </p>
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
