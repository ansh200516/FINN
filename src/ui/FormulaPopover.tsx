"use client";

import { useId, useState } from "react";

/**
 * Tap (not hover) to reveal how a derived number was computed. Renders an
 * inline panel under the chip; closes on a second tap or Escape.
 */
export function FormulaPopover({
  label,
  formula,
  lines,
}: {
  label: string;
  formula: string;
  /** optional component rows, e.g. ["PBT 38,613", "+ finance costs 8,481"] */
  lines?: string[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="inline-block max-w-full align-middle">
      <button
        type="button"
        className="chip-tap"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <span className={`chip ${open ? "chip-ink" : ""}`}>
          <span>{label}</span>
          <span aria-hidden="true" className="opacity-70">
            {open ? "–" : "+"}
          </span>
        </span>
      </button>
      {open ? (
        <span
          id={id}
          role="note"
          className="mt-1 block rounded-[var(--r-chip)] border border-rule bg-surface px-3 py-2 small text-ink-2"
        >
          <span className="mono text-ink block">{formula}</span>
          {lines?.length ? (
            <span className="mt-1 block">
              {lines.map((l) => (
                <span key={l} className="num block">
                  {l}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
