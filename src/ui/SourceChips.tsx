import type { SourceRef } from "./model";

const KIND_GLYPH: Record<string, string> = {
  pdf: "⌕",
  filing: "⌕",
  xbrl: "⟨/⟩",
  transcript: "❝",
  presentation: "▣",
  press_release: "¶",
  annual_report: "▤",
  other: "⌕",
};

/** Receipts line: one chip per source, opening the document in a new tab. */
export function SourceChips({
  sources,
  followUps = 0,
  className = "",
}: {
  sources: SourceRef[];
  followUps?: number;
  className?: string;
}) {
  if (!sources.length && !followUps) return null;
  // one chip per label: re-posts of the same filing share a label
  const seen = new Set<string>();
  const unique = sources.filter((s) => {
    const k = s.label.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0 ${className}`}>
      {unique.map((s) => (
        <a
          key={s.url + s.label}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="chip-tap min-w-0 max-w-full"
          title={s.url}
        >
          <span className="chip chip-accent max-w-[168px]">
            <span aria-hidden="true" className="opacity-80">
              {KIND_GLYPH[s.kind] ?? "⌕"}
            </span>
            <span>{s.label}</span>
          </span>
        </a>
      ))}
      {followUps > 0 ? (
        <span className="receipt">
          +{followUps} follow-up{followUps === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
