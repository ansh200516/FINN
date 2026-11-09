import type { ReactNode } from "react";

/**
 * One line under the Act cards. The watch cards stay closed until the tap,
 * the same way routine filings stay a filed-away count.
 */
export function WatchLine({
  count,
  children,
  className = "",
}: {
  count: number;
  className?: string;
  children?: ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <details className={`mx-4 border-t border-rule ${className}`.trim()}>
      <summary className="row-touch flex items-center gap-3 py-2 no-callout">
        <span className="chev text-ink-3" aria-hidden="true">
          ▸
        </span>
        <span className="rowtitle text-ink">{count} to watch</span>
      </summary>
      <div className="-mx-4 flex flex-col gap-3 pt-3 pb-2">{children}</div>
    </details>
  );
}
