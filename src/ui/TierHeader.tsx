import type { ReactNode } from "react";

/** Mono-caps eyebrow with a trailing hairline: "WORTH KNOWING", "FILED AWAY". */
export function TierHeader({
  children,
  count,
  className = "",
  id,
}: {
  children: ReactNode;
  count?: number | string;
  className?: string;
  id?: string;
}) {
  return (
    <div className={`gutter flex items-center gap-3 ${className}`} id={id}>
      <h2 className="eyebrow whitespace-nowrap">
        {children}
        {count !== undefined ? (
          <span className="ml-2 text-ink-2">{count}</span>
        ) : null}
      </h2>
      <span className="rule flex-1" aria-hidden="true" />
    </div>
  );
}
