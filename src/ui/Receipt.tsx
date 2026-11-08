/**
 * The "working receipt": loading and progress rendered as a list of named
 * pipeline steps, never as a skeleton or spinner. Nothing animates or pulses.
 */
export type ReceiptState = "done" | "working" | "queued" | "failed" | "skipped";

export interface ReceiptStep {
  label: string;
  state: ReceiptState;
  /** mono detail on the right or under the label, e.g. "458 rows · 1.4 s" */
  detail?: string;
}

const MARK: Record<ReceiptState, string> = {
  done: "✓",
  working: "●",
  queued: "○",
  failed: "✕",
  skipped: "–",
};

export function Receipt({
  steps,
  title,
  className = "",
}: {
  steps: ReceiptStep[];
  title?: string;
  className?: string;
}) {
  return (
    <section
      className={`card px-4 py-3 ${className}`}
      aria-label={title ?? "Progress"}
    >
      {title ? <p className="eyebrow mb-2">{title}</p> : null}
      <ol className="m-0 p-0 list-none">
        {steps.map((s) => (
          <li
            key={s.label}
            className={`flex items-baseline gap-3 py-1.5 border-b border-rule last:border-b-0 ${
              s.state === "queued" || s.state === "skipped"
                ? "text-ink-3"
                : "text-ink"
            }`}
          >
            <span
              className={`mono w-4 shrink-0 text-center ${
                s.state === "done"
                  ? "delta-up"
                  : s.state === "failed"
                    ? "delta-down"
                    : s.state === "working"
                      ? "text-accent"
                      : ""
              }`}
              aria-hidden="true"
            >
              {MARK[s.state]}
            </span>
            <span className="small flex-1">
              {s.label}
              {s.state === "working" ? (
                <span className="receipt ml-2">working</span>
              ) : null}
            </span>
            {s.detail ? (
              <span className="receipt text-right shrink-0 max-w-[45%] truncate">
                {s.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
