"use client";

import { useState } from "react";
import { Sheet } from "./Sheet";

export interface AskBudget {
  model: string;
  remaining: number;
  cap: number;
}

interface AskCitation {
  kind: "results" | "guidance" | "page";
  ref: string;
  quote?: string;
}

interface AskOk {
  ok: true;
  answer: string;
  citations: AskCitation[];
  notInFilings: boolean;
  model: string;
  cached: boolean;
  asksRemaining: number;
  budget: Array<AskBudget & { tier?: string }>;
}

interface AskErr {
  ok: false;
  error: string;
  asksRemaining?: number;
  budget?: Array<AskBudget & { tier?: string }>;
}

function pickReason(
  rows: Array<AskBudget & { tier?: string }> | undefined,
): AskBudget | null {
  if (!rows?.length) return null;
  const reason = rows.some((b) => b.tier)
    ? rows.filter((b) => b.tier === "reason")
    : rows;
  const pick = reason.find((b) => b.remaining > 0) ?? reason[0];
  return pick
    ? { model: pick.model, remaining: pick.remaining, cap: pick.cap }
    : null;
}

/**
 * The Ask field pinned above the bar on a company page. Posts to /api/ask;
 * the answer is grounded in that company's filings only.
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
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [liveBudget, setLiveBudget] = useState<AskBudget | null>(budget);
  const [result, setResult] = useState<AskOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = liveBudget ?? budget;
  const canSubmit = question.trim().length > 0 && !busy;

  async function onAsk() {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, question: q }),
      });
      const body = (await r.json()) as AskOk | AskErr;
      const next = pickReason(body.budget);
      if (next) setLiveBudget(next);
      if (!body.ok) {
        setResult(null);
        setError(body.error);
        return;
      }
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setBusy(false);
    }
  }

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
            {shown ? `${shown.remaining}/${shown.cap} today` : "budgeted"}
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
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`e.g. What did management promise on margins, and what did Q2 deliver?`}
            className="mt-1 block w-full resize-none rounded-[var(--r-chip)] border border-rule bg-bg px-3 py-2 text-[16px] text-ink placeholder:text-ink-3 disabled:opacity-70"
          />
        </label>
        {result ? (
          <div className="mt-3 card px-3 py-3">
            <p className="small text-ink">{result.answer}</p>
            {result.notInFilings ? (
              <p className="small text-ink-2 mt-2">Not in the filings.</p>
            ) : null}
            {result.citations.length ? (
              <ul className="m-0 mt-2 p-0 list-none small text-ink-2">
                {result.citations.map((c) => (
                  <li
                    key={`${c.kind}:${c.ref}`}
                    className="py-1 border-b border-rule"
                  >
                    <span className="receipt">
                      {c.kind} · {c.ref}
                    </span>
                    {c.quote ? (
                      <span className="block text-ink">“{c.quote}”</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="receipt mt-2">
              {result.model}
              {result.cached ? " · cached" : ""} · {result.asksRemaining} asks
              left today
            </p>
          </div>
        ) : null}
        {error ? <p className="small text-ink-2 mt-2">{error}</p> : null}
        <div className="mt-3 card px-3 py-3">
          <p className="small text-ink">
            Answers come only from this company's documents.
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
              {shown ? (
                <>
                  <span className="mono">{shown.model}</span> ·{" "}
                  {shown.remaining} of {shown.cap} reason-tier calls left today
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
          disabled={!canSubmit}
          onClick={() => void onAsk()}
          className={`hit mt-3 w-full rounded-[var(--r-chip)] bg-ink text-bg font-medium${canSubmit ? "" : " opacity-50"}`}
        >
          {busy ? "Asking…" : "Ask"}
        </button>
      </Sheet>
    </>
  );
}
