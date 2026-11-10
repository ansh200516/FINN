"use client";

import { Loader2, Send } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { NO_RESULTS } from "@/lib/companyTurn";
import {
  FINNIE_MODEL_DOWN,
  type FinnieCard,
  type FinnieLine,
  type FinniePrior,
  type FinnieTurnResult,
} from "@/lib/finnieTypes";
import { FINNIE_GREETING } from "@/ui/composer";
import { useTypingExample } from "@/ui/typingExample";
import { ReplyBody } from "./CompanyConversation";
import { ResultsGrid } from "./ResultsGrid";

type Shown =
  | { kind: "pending" }
  | {
      kind: "finnie";
      say: string;
      cards: FinnieCard[];
      pages: Array<string | null>;
      links: Array<{ href: string; label: string }>;
      href: string | null;
      link: string | null;
      sayAfter: boolean;
    };

interface Turn {
  id: number;
  question: string;
  shown: Shown;
}

/**
 * Chat only. A sentence goes to Finnie with the book already loaded.
 * The bubble is Finnie's answer. Cards are the ones the model chose.
 */
export function Desk({
  initialSymbol = null,
  initialName = null,
  onTurn,
}: {
  initialSymbol?: string | null;
  initialName?: string | null;
  onTurn: (
    sentence: string,
    focus: string | null,
    prior?: FinniePrior | null,
  ) => Promise<FinnieTurnResult>;
}) {
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const prior = useRef<FinniePrior | null>(null);
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
      const res = await onTurn(question, symbol, prior.current);
      prior.current = {
        sentence: question,
        tool: res.tools.at(-1) ?? null,
      };
      setSymbol(res.symbol);
      const cards = res.cards.length ? res.cards : res.card ? [res.card] : [];
      patch(id, {
        kind: "finnie",
        say: res.say,
        cards,
        pages: res.pages ?? [],
        links: res.links ?? [],
        href: res.href,
        link: res.link,
        sayAfter: res.sayAfter,
      });
    } catch {
      patch(id, {
        kind: "finnie",
        say: FINNIE_MODEL_DOWN,
        cards: [],
        pages: [],
        links: [],
        href: null,
        link: null,
        sayAfter: false,
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
    <FinnieAnswer
      say={shown.say}
      cards={shown.cards}
      pages={shown.pages}
      links={shown.links}
      href={shown.href}
      link={shown.link}
      sayAfter={shown.sayAfter}
    />
  );
}

function cardNode(card: FinnieCard | null): ReactNode {
  if (!card) return null;
  if (card.kind === "portfolio")
    return card.names.length ? <BookNames names={card.names} /> : null;
  if (card.kind === "lines")
    return card.lines.length ? <FactLines lines={card.lines} /> : null;
  if (card.kind === "compare") return <CompareCard card={card} />;
  if (card.kind === "management") return <ManagementCard card={card} />;
  return <ReplyBody reply={card.reply} symbol={card.symbol} />;
}

function FactLines({ lines }: { lines: FinnieLine[] }) {
  return (
    <ul className="book-names fact-lines" data-lines="">
      {lines.map((line, index) => (
        <li key={`${line.href}-${line.symbol}-${index}`}>
          <Link href={line.href} className="book-name">
            <span className="symbol">{line.symbol}</span>
            <span className="book-co">{line.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CompareCard({
  card,
}: {
  card: Extract<FinnieCard, { kind: "compare" }>;
}) {
  return (
    <div className="flex flex-col gap-4" data-compare="">
      <CompareSide symbol={card.a.symbol} results={card.a.card} />
      <CompareSide symbol={card.b.symbol} results={card.b.card} />
    </div>
  );
}

function CompareSide({
  symbol,
  results,
}: {
  symbol: string;
  results: Extract<FinnieCard, { kind: "compare" }>["a"]["card"];
}) {
  const period = results?.fiscalLabel ?? results?.periodEnd ?? null;
  return (
    <div>
      <Link
        href={`/c/${encodeURIComponent(symbol)}#results`}
        className="book-name"
      >
        <span className="symbol">{symbol}</span>
        {period ? <span className="book-co">{period}</span> : null}
      </Link>
      {results ? (
        <ResultsGrid card={results} showMeta={false} compactMeta withSpark />
      ) : (
        <p className="small text-ink">{NO_RESULTS}</p>
      )}
    </div>
  );
}

function ManagementCard({
  card,
}: {
  card: Extract<FinnieCard, { kind: "management" }>;
}) {
  if (!card.people.length) return null;
  return (
    <ul className="m-0 list-none p-0" data-management="">
      {card.people.map((person) => (
        <li
          key={`${person.person}-${person.role ?? ""}-${person.action ?? ""}`}
          className="border-b border-rule py-2 last:border-b-0"
        >
          <p className="small text-ink">{person.person}</p>
          <p className="receipt mt-0.5">
            {[person.action, person.role].filter(Boolean).join(" · ")}
          </p>
          {person.excerpt ? (
            <p className="small mt-1 text-ink-2">{person.excerpt}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function FinnieAnswer({
  say,
  cards,
  pages = [],
  links = [],
  href = null,
  link = null,
  sayAfter = false,
}: {
  say: string;
  cards: FinnieCard[];
  pages?: Array<string | null>;
  links?: Array<{ href: string; label: string }>;
  href?: string | null;
  link?: string | null;
  sayAfter?: boolean;
}) {
  const blocks = cards.map((card, index) => {
    const node = cardNode(card);
    const page = pages[index] ?? null;
    if (!node && !page) return null;
    return (
      <div
        className={node ? "thread-result" : undefined}
        key={`${card.kind}-${index}`}
      >
        {node}
        {page ? (
          <div className={node ? "mt-2" : undefined}>
            <CardLink href={page} label="Full page" />
          </div>
        ) : null}
      </div>
    );
  });
  const extras = links.map((item, index) => (
    <CardLink
      key={`${item.href}-${index}`}
      href={item.href}
      label={item.label}
    />
  ));
  const bubble = say ? <div className="bubble-agent">{say}</div> : null;
  const jump = <CardLink href={href ?? null} label={link ?? null} />;
  return (
    <div className="flex min-w-0 flex-col items-start gap-2" data-answer="">
      {sayAfter ? (
        <>
          {blocks}
          {extras}
          {jump}
          {bubble}
        </>
      ) : (
        <>
          {bubble}
          {blocks}
          {extras}
          {jump}
        </>
      )}
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
