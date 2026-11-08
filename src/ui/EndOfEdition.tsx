import { formatIst } from "@/lib/time";

/** The stitched rule that closes an edition, plus the honest footer line. */
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
  return (
    <footer className="gutter mt-8 mb-2">
      <div className="rule-stitched" aria-hidden="true" />
      <p className="mt-3 title text-ink">You're done</p>
      <p className="receipt mt-1">
        {shown} shown · {filedAway} filed away · {readTime} read
        {checkedAtMs
          ? ` · checked NSE ${formatIst(checkedAtMs, "HH:mm")} IST`
          : ""}
      </p>
    </footer>
  );
}
