import { istDateKey } from "@/lib/time";
import type { BriefWindow, WindowPreset } from "./model";

const PRESETS: Array<{ key: WindowPreset; label: string }> = [
  { key: "24h", label: "24 h" },
  { key: "48h", label: "48 h" },
  { key: "7d", label: "7 d" },
  { key: "30d", label: "30 d" },
];

/**
 * Segmented control of window presets (plain links → no JS) plus a native
 * `<details>` custom range with two date inputs submitting as GET.
 */
export function WindowScrubber({
  window,
  now,
}: {
  window: BriefWindow;
  now: number;
}) {
  const active = window.preset === "close" ? null : window.preset;
  const today = istDateKey(now);
  const fromKey = istDateKey(window.fromMs);
  return (
    <nav className="gutter mt-4" aria-label="For you">
      <div className="segmented">
        {PRESETS.map((p) => (
          <a
            key={p.key}
            href={`/brief?w=${p.key}`}
            aria-current={active === p.key ? "true" : undefined}
            className="no-callout"
          >
            {p.label}
          </a>
        ))}
        <a
          href="/brief?w=close"
          aria-current={window.preset === "close" ? "true" : undefined}
          className="no-callout"
        >
          Since close
        </a>
      </div>
      {window.widened ? (
        <p className="receipt mt-2 text-ink-2">{window.widened}</p>
      ) : null}
      <details className="mt-2 group">
        <summary className="hit inline-flex items-center gap-2 receipt text-ink-2 -ml-1 pl-1 select-none">
          <span className="chev" aria-hidden="true">
            ▸
          </span>
          {window.preset === "custom"
            ? `Custom · ${window.label}`
            : "Custom range"}
        </summary>
        <form
          action="/brief"
          method="get"
          className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2 items-end"
        >
          <label className="meta text-ink-3">
            From
            <input
              type="date"
              name="from"
              defaultValue={fromKey}
              max={today}
              className="mt-1 block w-full hit rounded-[var(--r-chip)] border border-rule bg-surface px-2 text-[16px] text-ink"
            />
          </label>
          <label className="meta text-ink-3">
            To
            <input
              type="date"
              name="to"
              defaultValue={today}
              max={today}
              className="mt-1 block w-full hit rounded-[var(--r-chip)] border border-rule bg-surface px-2 text-[16px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="hit rounded-[var(--r-chip)] bg-ink px-4 text-bg font-medium"
          >
            Show
          </button>
        </form>
      </details>
    </nav>
  );
}
