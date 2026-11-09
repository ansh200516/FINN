"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  type AskChip,
  COMPANY_EMPTY,
  type CompanyReply,
  NO_RESULTS,
  parseCompanyTurn,
  presentAsk,
} from "@/lib/companyTurn";
import { ASK_WAIT_SLOW_MS, askFailureCopy, askWaitCopy } from "./ask/status";
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

type Shown =
  | { kind: "pending"; ask: boolean; slow: boolean }
  | { kind: "reply"; reply: CompanyReply }
  | { kind: "ask"; text: string; chips: AskChip[] }
  | { kind: "error"; message: string };

interface Turn {
  id: number;
  question: string;
  shown: Shown;
}

/**
 * The company thread. Nothing is on screen until it is asked for.
 * Scroll is instant, so reduced motion has no animation to cancel.
 */
export function CompanyConversation({
  symbol,
  name,
  onReply,
  onAsk,
}: {
  symbol: string;
  name: string;
  onReply: (text: string) => Promise<CompanyReply>;
  onAsk: (question: string) => Promise<AskResult>;
}) {
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const slowTimer = useRef<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  useEffect(() => {
    return () => {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!turns.length) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [turns]);

  function patch(id: number, shown: Shown) {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, shown } : t)));
  }

  async function submit(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const id = ++seq.current;
    const intent = parseCompanyTurn(question);
    const asking = intent.kind === "ask";
    setDraft("");
    setBusy(true);
    setTurns((prev) => [
      ...prev,
      { id, question, shown: { kind: "pending", ask: asking, slow: false } },
    ]);
    if (asking) {
      slowTimer.current = window.setTimeout(() => {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id && t.shown.kind === "pending"
              ? { ...t, shown: { kind: "pending", ask: true, slow: true } }
              : t,
          ),
        );
      }, ASK_WAIT_SLOW_MS);
    }
    try {
      if (intent.kind === "rejected") {
        patch(id, {
          kind: "reply",
          reply: { kind: "rejected", sentence: intent.sentence },
        });
        return;
      }
      if (asking) {
        await landAsk(id, question);
        return;
      }
      const reply = await onReply(question);
      if (reply.kind === "ask") {
        await landAsk(id, question);
        return;
      }
      patch(id, { kind: "reply", reply });
    } catch (e) {
      patch(id, {
        kind: "error",
        message: askFailureCopy({
          error: e instanceof Error ? e.message : null,
        }),
      });
    } finally {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
      setBusy(false);
    }
  }

  async function landAsk(id: number, question: string) {
    const res = await onAsk(question);
    if (!res.ok) {
      patch(id, {
        kind: "error",
        message: askFailureCopy({
          status: res.status,
          error: res.error,
        }),
      });
      return;
    }
    const view = presentAsk({
      answer: res.answer ?? "",
      notInFilings: Boolean(res.notInFilings),
      citations: res.citations ?? [],
    });
    patch(id, { kind: "ask", text: view.text, chips: view.chips });
  }

  return (
    <main className="flex flex-1 flex-col pb-10">
      <header className="gutter pt-3 pb-3 border-b border-rule">
        <Link
          href="/c"
          className="hit inline-flex items-center gap-1 receipt text-accent -ml-1 pl-1"
        >
          ← Companies
        </Link>
        <p className="eyebrow mt-2">{symbol}</p>
        <h1 className="headline text-ink mt-1">{name}</h1>
      </header>

      <div
        className="gutter flex-1 pt-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={busy}
      >
        {turns.length === 0 ? (
          <p className="quote text-ink-2">{COMPANY_EMPTY}</p>
        ) : (
          <ol className="m-0 p-0 list-none">
            {turns.map((turn) => (
              <li
                key={turn.id}
                className="border-t border-ink py-4 first:border-t-0 first:pt-0"
              >
                <p className="quote text-ink">{turn.question}</p>
                <div className="mt-3">
                  <TurnBody turn={turn} symbol={symbol} />
                </div>
              </li>
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <form
        data-composer=""
        className="fixed left-1/2 z-[29] flex w-full max-w-[430px] -translate-x-1/2 items-center border-t border-rule bg-bg"
        style={{
          bottom: "calc(var(--bar-h) + env(safe-area-inset-bottom))",
          height: 44,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          Ask {symbol}
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask"
          maxLength={500}
          enterKeyHint="send"
          autoComplete="off"
          disabled={busy}
          className="h-[44px] min-w-0 flex-1 bg-transparent px-4 text-[16px] text-ink outline-none placeholder:text-ink-3 disabled:opacity-70"
          style={{ height: 44 }}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="h-[44px] px-4 eyebrow text-accent disabled:text-ink-3"
          style={{ height: 44 }}
        >
          Send
        </button>
      </form>
    </main>
  );
}

function TurnBody({ turn, symbol }: { turn: Turn; symbol: string }) {
  const shown = turn.shown;
  if (shown.kind === "pending") {
    return (
      <p className="receipt">
        {shown.ask
          ? askWaitCopy(symbol, shown.slow ? ASK_WAIT_SLOW_MS : 0)
          : "Looking."}
      </p>
    );
  }
  if (shown.kind === "error")
    return <p className="small text-ink">{shown.message}</p>;
  if (shown.kind === "ask")
    return <AskAnswer text={shown.text} chips={shown.chips} />;
  return <ReplyBody reply={shown.reply} symbol={symbol} />;
}

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
      return <p className="quote text-ink">{reply.sentence}</p>;
    case "error":
      return <p className="small text-ink">{reply.message}</p>;
    case "nse":
      return (
        <div className="border border-rule px-3 py-2" data-source="NSE">
          <p className="small text-ink">{reply.headline}</p>
          <p className="receipt mt-1">{reply.note}</p>
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
      {text ? <p className="small text-ink">{text}</p> : null}
      {chips.length ? (
        <ul className="m-0 mt-2 flex flex-wrap gap-2 p-0 list-none">
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
