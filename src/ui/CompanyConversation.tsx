"use client";

import { applyBookConfirm } from "@/app/chat/actions";
import { type AskChip, type CompanyReply, NO_RESULTS } from "@/lib/companyTurn";
import { CitationChip } from "./CitationChip";
import { PullReading } from "./PullMenu";
import { ResultsGrid } from "./ResultsGrid";
import { ScoredPromises } from "./ScoredPromises";

export interface AskResult {
  ok: boolean;
  answer?: string;
  citations?: Array<{ ref: string; quote?: string | null }>;
  notInFilings?: boolean;
  error?: string;
  status?: number;
}

/** The one card the desk slot renders. Renderers stay as they are. */
export function ReplyBody({
  reply,
  symbol,
}: {
  reply: CompanyReply;
  symbol: string;
}) {
  switch (reply.kind) {
    case "results":
      return reply.card ? (
        <ResultsGrid card={reply.card} showMeta={false} compactMeta withSpark />
      ) : (
        <p className="small text-ink">{NO_RESULTS}</p>
      );
    case "promises":
      return <ScoredPromises rows={reply.rows} symbol={symbol} />;
    case "reading":
      return <PullReading block={reply.block} />;
    case "rule":
    case "rejected":
      return <p className="small text-ink">{reply.sentence}</p>;
    case "error":
      return <p className="small text-down">{reply.message}</p>;
    case "nse":
      return (
        <div className="card px-3 py-3" data-source="NSE">
          <p className="small text-ink">{reply.headline}</p>
          <p className="receipt mt-1">{reply.note}</p>
        </div>
      );
    case "confirm":
      return (
        <form action={applyBookConfirm} className="card px-3 py-3">
          <p className="small text-ink">{reply.sentence}</p>
          {reply.steps.length ? (
            <ol className="m-0 mt-2 list-decimal pl-5 receipt">
              {reply.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : null}
          <input type="hidden" name="token" value={reply.token} />
          <button
            type="submit"
            className="hit mt-3 inline-flex items-center rounded-[var(--r-chip)] bg-ink px-4 text-bg font-medium"
          >
            {reply.label}
          </button>
        </form>
      );
    case "ask":
      return null;
    default:
      return null;
  }
}

export function AskAnswer({ text, chips }: { text: string; chips: AskChip[] }) {
  return (
    <div>
      {text ? <p className="small text-ink">{text}</p> : null}
      {chips.length ? (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
          {chips.map((c, i) => (
            <li key={`${c.label}-${i}`}>
              {c.quote ? (
                <CitationChip citation={{ label: c.label, quote: c.quote }} />
              ) : (
                <span className="chip">
                  <span>{c.label}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
