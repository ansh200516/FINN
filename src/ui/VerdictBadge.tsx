import type { Verdict } from "@/engine/types";

export type VerdictLike = Verdict | "open" | "pending" | "superseded";

/* Colours are the delta tokens (≥ 4.7:1 on paper, ≥ 6.9:1 on ink); neutral
   verdicts use ink-2 (8:1) rather than ink-3 so the word stays legible at 13 px. */
const STYLE: Record<
  VerdictLike,
  { glyph: string; label: string; cls: string }
> = {
  kept: { glyph: "●", label: "Kept", cls: "delta-up" },
  beat: { glyph: "●", label: "Beat", cls: "delta-up" },
  raised: { glyph: "▲", label: "Raised", cls: "delta-up" },
  missed: { glyph: "✕", label: "Missed", cls: "delta-down" },
  cut: { glyph: "▼", label: "Cut", cls: "delta-down" },
  withdrawn: { glyph: "⊘", label: "Withdrawn", cls: "delta-warn" },
  not_addressed: { glyph: "◌", label: "Not addressed", cls: "delta-warn" },
  unverifiable: { glyph: "–", label: "Unverifiable", cls: "text-ink-2" },
  open: { glyph: "◐", label: "Open", cls: "text-ink-2" },
  pending: { glyph: "◐", label: "Pending", cls: "text-ink-2" },
  superseded: { glyph: "↻", label: "Revised", cls: "text-ink-2" },
};

/** Verdict with a glyph, a word and a colour — never colour alone. */
export function VerdictBadge({
  verdict,
  className = "",
  compact = false,
}: {
  verdict: VerdictLike | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  const v = verdict && verdict in STYLE ? STYLE[verdict] : STYLE.open;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap num ${v.cls} ${className}`}
      title={`verdict: ${v.label}`}
    >
      <span className="text-[0.85em]" aria-hidden="true">
        {v.glyph}
      </span>
      {compact ? null : <span className="font-medium">{v.label}</span>}
    </span>
  );
}

export const VERDICT_LEGEND: VerdictLike[] = [
  "kept",
  "beat",
  "missed",
  "cut",
  "raised",
  "withdrawn",
  "not_addressed",
  "unverifiable",
];
