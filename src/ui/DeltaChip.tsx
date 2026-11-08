import {
  deltaArrow,
  deltaSign,
  formatBp,
  formatPct,
  formatRatio,
} from "@/lib/format";

const COLOR: Record<string, string> = {
  up: "delta-up",
  down: "delta-down",
  flat: "text-ink-3",
  none: "text-ink-3",
};

/**
 * ▲ +9.8% / ▼ −2.3% / −150 bp — glyph + sign + colour, so colour is never
 * the only channel. Neutral grey below ±0.05.
 */
export function DeltaChip({
  value,
  unit = "pct",
  decimals = 1,
  className = "",
  arrow = true,
}: {
  value: number | null | undefined;
  unit?: "pct" | "bp" | "ratio";
  decimals?: number;
  className?: string;
  arrow?: boolean;
}) {
  const sign = deltaSign(value, unit === "bp" ? 5 : 0.05);
  const text =
    unit === "bp"
      ? formatBp(value)
      : unit === "ratio"
        ? formatRatio(value)
        : formatPct(value, { decimals });
  const glyph =
    unit === "ratio" ? "" : deltaArrow(value, unit === "bp" ? 5 : 0.05);
  return (
    <span className={`num whitespace-nowrap ${COLOR[sign]} ${className}`}>
      {arrow && glyph ? (
        <span className="text-[0.72em] align-[0.08em] mr-px">{glyph}</span>
      ) : null}
      {text}
    </span>
  );
}
