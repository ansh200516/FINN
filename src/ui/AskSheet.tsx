"use client";

import { useState } from "react";
import { Sheet } from "./Sheet";

export interface AskBudget {
  model: string;
  remaining: number;
  cap: number;
}

/**
 * The Ask field pinned above the bar on a company page. Opens a sheet; until
 * the Ask backend lands the field is disabled and the sheet explains the
 * budget and the grounding rules instead of pretending.
 */
export function AskSheet({
  symbol,
  budget,
  docCount,
}: {
  symbol: string;
  budget: AskBudget | null;
  docCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="fixed left-1/2 z-[calc(var(--z-bar)-1)] w-full max-w-[430px] -translate-x-1/2 px-4"
        style={{
          bottom: "calc(var(--bar-h) + env(safe-area-inset-bottom) + 8px)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hit flex w-full items-center justify-between rounded-[var(--r-pill)] border border-rule bg-surface px-4 shadow-[0_6px_18px_rgba(21,19,15,0.10)] text-left"
          aria-haspopup="dialog"
        >
          <span className="small text-ink-2 truncate">
            Ask {symbol} · from its filings only
          </span>
          <span className="receipt shrink-0 whitespace-nowrap">
            {budget ? `${budget.remaining}/${budget.cap} today` : "budgeted"}
          </span>
        </button>
      </div>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Ask ${symbol}`}
        ariaLabel="Ask"
      >
        <label className="block mt-3">
          <span className="eyebrow">Question</span>
          <textarea
            disabled
            rows={3}
            placeholder={`e.g. What did management promise on margins, and what did Q2 deliver?`}
            className="mt-1 block w-full resize-none rounded-[var(--r-chip)] border border-rule bg-bg px-3 py-2 text-[16px] text-ink placeholder:text-ink-3 disabled:opacity-70"
          />
        </label>
        <div className="mt-3 card px-3 py-3">
          <p className="small text-ink">
            Not connected yet — answers will come only from this company's
            documents.
          </p>
          <ul className="m-0 mt-2 p-0 list-none small text-ink-2">
            <li className="py-1 border-b border-rule">
              Grounding: {docCount} {docCount === 1 ? "document" : "documents"}{" "}
              on record for {symbol}; nothing from the web, no model memory.
            </li>
            <li className="py-1 border-b border-rule">
              Answer grammar: headline → numbers → why it matters → receipts,
              with a citation chip per claim.
            </li>
            <li className="py-1">
              Budget:{" "}
              {budget ? (
                <>
                  <span className="mono">{budget.model}</span> ·{" "}
                  {budget.remaining} of {budget.cap} reason-tier calls left
                  today
                </>
              ) : (
                "reason-tier Flash, about 16 calls a day shared across the app"
              )}
              . Outside the filings → “not in the filings”.
            </li>
          </ul>
        </div>
        <button
          type="button"
          disabled
          className="hit mt-3 w-full rounded-[var(--r-chip)] bg-ink text-bg font-medium opacity-50"
        >
          Ask (engine pending)
        </button>
      </Sheet>
    </>
  );
}
