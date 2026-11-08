import type { ReactNode } from "react";

/** A designed empty state: a verdict, the reason, and what will fill it. */
export function Empty({
  title,
  reason,
  children,
  className = "",
}: {
  title: string;
  reason?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card px-4 py-4 ${className}`}>
      <p className="title text-ink">{title}</p>
      {reason ? <p className="small text-ink-2 mt-1">{reason}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
