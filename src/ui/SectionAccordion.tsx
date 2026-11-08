import type { ReactNode } from "react";

/**
 * Accordion row = title + ≤12-word verdict while collapsed; native <details>
 * so the collapsed list is itself a one-screen summary and needs no JS.
 */
export function SectionAccordion({
  title,
  verdict,
  children,
  defaultOpen = false,
  count,
}: {
  title: string;
  verdict?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  count?: number | string;
}) {
  return (
    <details className="border-b border-rule" open={defaultOpen}>
      <summary className="row-touch gutter flex items-center gap-3 py-2 no-callout">
        <span className="chev text-ink-3" aria-hidden="true">
          ▸
        </span>
        <span className="flex-1 min-w-0">
          <span className="rowtitle text-ink block">
            {title}
            {count !== undefined ? (
              <span className="ml-2 font-normal text-ink-3 num">{count}</span>
            ) : null}
          </span>
          {verdict ? (
            <span className="small text-ink-2 block truncate">{verdict}</span>
          ) : null}
        </span>
      </summary>
      <div className="gutter pb-4">{children}</div>
    </details>
  );
}
