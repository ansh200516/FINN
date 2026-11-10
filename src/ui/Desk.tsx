"use client";

import { Loader2, Send } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  FINNIE_MODEL_DOWN,
  type FinnieCard,
  type FinnieTurnResult,
} from "@/lib/finnieTypes";
import { FINNIE_GREETING } from "@/ui/composer";
import { useTypingExample } from "@/ui/typingExample";
import { ReplyBody } from "./CompanyConversation";

type Shown =
  | { kind: "pending" }
  | {
      kind: "finnie";
      say: string;
      card: FinnieCard | null;
      href: string | null;
      link: string | null;
    };

interface Turn {
  id: number;
  question: string;
  shown: Shown;
}

/**
 * Chat only. A sentence goes to Finnie. Finnie picks a tool.
 * The thread shows one line, then the card that tool returned.
 */
export function Desk({
  initialSymbol = null,
  initialName = null,
  onTurn,
}: {
  initialSymbol?: string | null;
  initialName?: string | null;
  onTurn: (sentence: string, focus: string | null) => Promise<FinnieTurnResult>;
}) {
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const [symbol, setSymbol] = useState<string | null>(initialSymbol);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const hint = useTypingExample(draft.length > 0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const named = symbol && symbol === initialSymbol ? initialName : null;

  useEffect(() => {
    if (!turns.length) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [turns]);

  function patch(id: number, next: Shown) {
    setTurns((prev) =>
      prev.map((turn) => (turn.id === id ? { ...turn, shown: next } : turn)),
    );
  }

  async function submit(text: string) {
    const question = text.trim() || hint.submit;
    if (!question || busy) return;
    setDraft("");
    const id = ++seq.current;
    setTurns((prev) => [...prev, { id, question, shown: { kind: "pending" } }]);
    setBusy(true);
    try {
      const res = await onTurn(question, symbol);
      if (res.symbol) setSymbol(res.symbol);
      patch(id, {
        kind: "finnie",
        say: res.say,
        card: res.card,
        href: res.href,
        link: res.link,
      });
    } catch {
      patch(id, {
        kind: "finnie",
        say: FINNIE_MODEL_DOWN,
        card: null,
        href: null,
        link: null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="pb-4" aria-label="Chat">
        <div
          className="chat-log gutter mt-4"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-busy={busy}
        >
          <ol className="m-0 flex list-none flex-col gap-6 p-0">
            <li className="flex flex-col items-start">
              <div className="bubble-agent">{FINNIE_GREETING}</div>
              {!turns.length && named ? (
                <p className="receipt mt-2">{named}</p>
              ) : null}
            </li>
            {turns.map((turn) => (
              <li key={turn.id} className="flex flex-col gap-3">
                <div className="flex flex-col items-end">
                  <div className="bubble-user">{turn.question}</div>
                </div>
                <TurnBody turn={turn} />
              </li>
            ))}
          </ol>
          <div ref={endRef} />
        </div>
      </section>

      <form
        data-composer=""
        className="composer-dock"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <div className="composer-box">
          <div className="composer-field">
            <label className="sr-only" htmlFor={inputId}>
              Ask Finnie
            </label>
            {symbol ? <span className="ticker-chip">{symbol}</span> : null}
            <div className="composer-input-wrap">
              <input
                id={inputId}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={hint.placeholder}
                maxLength={500}
                enterKeyHint="send"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                disabled={busy}
                className="composer-input h-11 w-full bg-transparent px-3 text-[16px] font-normal text-ink outline-none placeholder:text-ink-3 disabled:opacity-70"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="composer-send"
              aria-label="Send"
            >
              <Send size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function TurnBody({ turn }: { turn: Turn }) {
  const shown = turn.shown;
  if (shown.kind === "pending") {
    return (
      <p className="agent-status">
        <Loader2 className="animate-spin" size={14} aria-hidden="true" />
        <span>Looking.</span>
      </p>
    );
  }
  return (
    <AgentTurn
      text={shown.say}
      href={shown.href}
      link={shown.link}
      result={cardNode(shown.card)}
    />
  );
}

function cardNode(card: FinnieCard | null): ReactNode {
  if (!card) return null;
  if (card.kind === "portfolio")
    return card.names.length ? <BookNames names={card.names} /> : null;
  return <ReplyBody reply={card.reply} symbol={card.symbol} />;
}

function AgentTurn({
  text,
  result = null,
  href = null,
  link = null,
}: {
  text: string | null;
  result?: ReactNode;
  href?: string | null;
  link?: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      {text ? <div className="bubble-agent">{text}</div> : null}
      {result ? <div className="thread-result">{result}</div> : null}
      <CardLink href={href} label={link} />
    </div>
  );
}

export function BookNames({
  names,
}: {
  names: Array<{ symbol: string; name: string; aliases: string[] }>;
}) {
  return (
    <ul className="book-names" data-book="">
      {names.map((company) => (
        <li key={company.symbol}>
          <Link
            href={`/c/${encodeURIComponent(company.symbol)}`}
            className="book-name"
          >
            <span className="symbol">{company.symbol}</span>
            <span className="book-co">{company.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CardLink({
  href,
  label,
}: {
  href: string | null;
  label: string | null;
}) {
  if (!href || !label) return null;
  return (
    <Link href={href} className="thread-link">
      {label}
    </Link>
  );
}
