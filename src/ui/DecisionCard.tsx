import Link from "next/link";
import type { ReactNode } from "react";
import { DECISION_WORD, type Decision } from "./decision";
import { SymbolChip } from "./SymbolChip";

const CHIP: Record<Decision, string> = {
  act: "chip chip-ink",
  watch: "chip chip-warn",
  nothing: "chip",
};

/**
 * One filing, one question: do I need to do anything?
 * Company, time, and a single chip. The sentence is the decision.
 * The grid, the quotes, and the bios stay behind "The figures".
 * The filing is the other control, not the sentence.
 */
export function DecisionCard({
  symbol,
  time,
  decision,
  sentence,
  href,
  action = "Filing",
  figures = null,
  index = 0,
}: {
  symbol: string;
  time: string;
  decision: Decision;
  sentence: string;
  href: string;
  /** "Filing" for a filing, "The close" for a price rule */
  action?: string;
  /** closed by default: results grid, quotes, bios */
  figures?: ReactNode;
  index?: number;
}) {
  const word = DECISION_WORD[decision];
  return (
    <article
      className={`card mx-4 px-4 pt-3 pb-1 reveal ${decision === "act" ? "card-material" : ""}`}
      style={{ animationDelay: `${80 + Math.min(index, 12) * 40}ms` }}
      data-decision={decision}
    >
      <div className="flex items-center gap-2">
        <SymbolChip symbol={symbol} plain className="shrink-0" />
        <span className="receipt ml-auto shrink-0 text-ink-3">{time}</span>
        <span className={`${CHIP[decision]} shrink-0`}>{word}</span>
      </div>
      <p className="decision mt-3 text-ink">{sentence}</p>
      <div className="mt-1 flex items-start justify-between gap-2">
        {figures ? (
          <details className="min-w-0">
            <summary className="hit -ml-1 inline-flex items-center gap-2 pl-1 receipt text-ink no-callout">
              <span className="chev text-ink-3" aria-hidden="true">
                ▸
              </span>
              The figures
            </summary>
            <div className="pb-3">{figures}</div>
          </details>
        ) : (
          <span />
        )}
        <Link
          href={href}
          className="hit -mr-1 inline-flex shrink-0 items-center gap-1 px-2 receipt text-accent no-callout"
          aria-label={`${action} · ${symbol}`}
        >
          {action}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
