import { formatIst } from "@/lib/time";

/**
 * The stitched rule that closes an edition, plus the honest footer line:
 * "You're done · 8 shown · 14 filed away" and when NSE was last checked.
 */
export function EndOfEdition({
  shown,
  filedAway,
  checkedAtMs,
  readTime,
}: {
  shown: number;
  filedAway: number;
  checkedAtMs: number | null;
  readTime: string;
}) {
  const parts = [
    shown ? `${shown} shown` : "nothing shown",
    filedAway ? `${filedAway} filed away` : shown ? "nothing filed away" : null,
    shown ? `${readTime} read` : null,
  ].filter(Boolean);
  return (
    <footer className="gutter mt-8 mb-2">
      <div className="rule-stitched" aria-hidden="true" />
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
        <span className="title text-ink">You’re done.</span>
        <span className="receipt">{parts.join(" · ")}</span>
      </p>
      {checkedAtMs ? (
        <p className="receipt mt-0.5">
          checked NSE {formatIst(checkedAtMs, "HH:mm")} IST ·{" "}
          {formatIst(checkedAtMs, "EEE d MMM")}
        </p>
      ) : null}
    </footer>
  );
}
