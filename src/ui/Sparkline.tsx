/**
 * Word-sized inline SVG sparkline (Tufte): no axes, 1.25 px stroke in ink-2,
 * last point as a dot, optional volume bars below with one bar highlighted.
 * Pure SVG — renders in server components with zero client JS.
 */
export function Sparkline({
  values,
  width = 56,
  height = 14,
  volumes,
  highlightIndex,
  highlightTone = "warn",
  ariaLabel,
  className,
  endDot = true,
}: {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  /** optional volume bars drawn under the line (adds ~40% height) */
  volumes?: Array<number | null | undefined>;
  /** index of a bar to colour (today / the anomaly) */
  highlightIndex?: number;
  highlightTone?: "warn" | "up" | "down";
  ariaLabel?: string;
  className?: string;
  endDot?: boolean;
}) {
  const pts = values
    .map((v, i) => ({ i, v }))
    .filter(
      (p): p is { i: number; v: number } =>
        typeof p.v === "number" && Number.isFinite(p.v),
    );
  if (pts.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-label={ariaLabel ?? "no price history"}
        role="img"
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--rule)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }
  const n = values.length;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const barH = volumes ? Math.round(height * 0.42) : 0;
  const lineH = height - barH - (volumes ? 2 : 0);
  const pad = 1.5;
  const x = (i: number) =>
    n === 1 ? width / 2 : (i / (n - 1)) * (width - 2 * pad) + pad;
  const y = (v: number) => pad + (1 - (v - min) / span) * (lineH - 2 * pad);
  const d = pts
    .map(
      (p, k) =>
        `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`,
    )
    .join(" ");
  const last = pts.at(-1) as { i: number; v: number };
  const vols = volumes
    ? volumes.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0))
    : null;
  const vmax = vols ? Math.max(1, ...vols) : 1;
  const barW = Math.max(1, (width - 2 * pad) / n - 0.8);
  const toneVar =
    highlightTone === "up"
      ? "var(--up)"
      : highlightTone === "down"
        ? "var(--down)"
        : "var(--warn)";
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <path
        d={d}
        fill="none"
        stroke="var(--ink-2)"
        strokeWidth="var(--spark-stroke)"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {endDot ? (
        <circle cx={x(last.i)} cy={y(last.v)} r={1.75} fill="var(--ink)" />
      ) : null}
      {vols
        ? vols.map((v, i) => {
            const h = Math.max(0.5, (v / vmax) * barH);
            const key = `${i}`;
            return (
              <rect
                key={key}
                x={x(i) - barW / 2}
                y={height - h}
                width={barW}
                height={h}
                fill={i === highlightIndex ? toneVar : "var(--rule)"}
              />
            );
          })
        : null}
    </svg>
  );
}
