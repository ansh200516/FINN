/**
 * Fixed glyph vocabulary for the 17 categories — hand-drawn 12 px strokes in
 * currentColor, no emoji. Used in the fold line, tier rows and chips.
 */
import type { Category } from "@/engine/types";

const PATHS: Record<Category, string> = {
  results: "M2 10h2V5H2zM5.5 10h2V2h-2zM9 10h2V7H9z",
  management_change:
    "M6 1.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6zM1.5 11c0-2.6 2-4 4.5-4s4.5 1.4 4.5 4z",
  dividend:
    "M6 1.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6zM4 4h4M4 5.8h4M4.6 5.8 7.5 9",
  credit_rating: "M1.5 1.5h9v9h-9zM3.7 9 6 3l2.3 6M4.5 7h3",
  m_and_a: "M1.5 1.5h6v6h-6zM4.5 4.5h6v6h-6z",
  fund_raise: "M6 10.5V2M3 5l3-3 3 3M2 10.5h8",
  pledging: "M3 5.5V4a3 3 0 0 1 6 0v1.5M2.2 5.5h7.6v5H2.2z",
  insider_trading: "M1.5 4h7l-2-2M10.5 8h-7l2 2",
  capex: "M1.5 10.5V5l3 2V5l3 2V2h3v8.5z",
  litigation:
    "M6 1.5v9M2 10.5h8M2 4.5h8M2.8 4.5 1.5 7.5h2.6zM9.2 4.5l-1.3 3h2.6z",
  earnings_call: "M2.5 6.5a3.5 3.5 0 0 1 7 0M2.5 6.5v3h1.5v-3zM9.5 6.5v3H8v-3z",
  investor_meetings: "M1.5 2.5h9v8h-9zM1.5 5h9M4 1v2.5M8 1v2.5",
  press_release: "M2 1.5h8v9H2zM3.8 4h4.4M3.8 6h4.4M3.8 8h2.8",
  postal_ballot: "M1.5 3h9v6.5h-9zM1.5 3l4.5 3.6L10.5 3",
  agm_egm:
    "M4 2a1.7 1.7 0 1 1 0 3.4A1.7 1.7 0 0 1 4 2zM8 2.6a1.5 1.5 0 1 1 0 3A1.5 1.5 0 0 1 8 2.6zM1.2 10c0-2 1.3-3.2 2.8-3.2S6.8 8 6.8 10zM6.4 10c.2-1.6 1-2.6 2.2-2.6 1.1 0 2.2 1 2.2 2.6z",
  bonus_split: "M1.5 1.5h9v9h-9zM10.5 1.5l-9 9",
  unclassified:
    "M3 3h.01M6 3h.01M9 3h.01M3 6h.01M6 6h.01M9 6h.01M3 9h.01M6 9h.01M9 9h.01",
};

export function CategoryGlyph({
  category,
  size = 12,
  className,
  title,
}: {
  category: Category | string;
  size?: number;
  className?: string;
  /** when given, the glyph is announced with this label */
  title?: string;
}) {
  const d =
    PATHS[
      (category as Category) in PATHS ? (category as Category) : "unclassified"
    ];
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
  if (!title) return svg;
  return (
    <span role="img" aria-label={title} className="inline-flex">
      {svg}
    </span>
  );
}
