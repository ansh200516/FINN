"use client";

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
      return (
        <p className="text-sm font-light leading-relaxed tracking-wide text-zinc-100">
          {reply.sentence}
        </p>
      );
    case "error":
      return <p className="text-sm font-light text-red-300">{reply.message}</p>;
    case "nse":
      return (
        <div
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3"
          data-source="NSE"
        >
          <p className="text-sm font-light leading-relaxed text-zinc-100">
            {reply.headline}
          </p>
          <p className="mt-1 font-mono text-[11px] tracking-wide text-zinc-500">
            {reply.note}
          </p>
        </div>
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
      {text ? (
        <p className="text-sm font-light leading-relaxed text-zinc-100">
          {text}
        </p>
      ) : null}
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
