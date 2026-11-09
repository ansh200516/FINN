"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type AskChip, type CompanyReply, presentAsk } from "@/lib/companyTurn";
import {
  contextLine,
  type DeskCompany,
  type DeskLine,
  type DeskParse,
  formatLines,
  NAME_THE_COMPANY,
  parseDeskTurn,
} from "@/lib/deskTurn";
import { ASK_WAIT_SLOW_MS, askFailureCopy, askWaitCopy } from "./ask/status";
import { askFiling } from "./askClient";
import { AskAnswer, ReplyBody } from "./CompanyConversation";

/** How many decisions sit on the first screen. The rest are a sentence away. */
export const PUSH_SHOWN = 3;

export interface PushLine extends DeskLine {
  key: string;
  time: string;
  href: string;
  action: string;
}

type Shown =
  | { kind: "pending"; ask: boolean; slow: boolean }
  | { kind: "line"; text: string }
  | { kind: "reply"; reply: CompanyReply }
  | { kind: "ask"; text: string; chips: AskChip[] }
  | { kind: "error"; message: string };

interface Turn {
  id: number;
  question: string;
  symbol: string | null;
  shown: Shown;
}

/**
 * Push is a short tape. The composer is the control: one sentence in,
 * one card or one saved rule out. Nothing else is on the thread.
 */
export function Desk({
  act,
  watch,
  filedAway,
  quiet,
  checked,
  companies,
  onTurn,
}: {
  act: PushLine[];
  watch: DeskLine[];
  filedAway: number;
  quiet: string | null;
  checked: string | null;
  companies: DeskCompany[];
  onTurn: (
    symbol: string | null,
    text: string,
    scope: "symbol" | "book" | null,
  ) => Promise<CompanyReply>;
}) {
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const slowTimer = useRef<number | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const shown = act.slice(0, PUSH_SHOWN);
  const more = act.length - shown.length;
  const meta = [
    watch.length ? `${watch.length} to watch` : null,
    filedAway ? `${filedAway} filed away` : null,
    checked,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    return () => {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!turns.length) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [turns]);

  function patch(id: number, next: Shown) {
    setTurns((prev) =>
      prev.map((t) => (t.id === id ? { ...t, shown: next } : t)),
    );
  }

  function push(question: string, shownTurn: Shown, nextSymbol: string | null) {
    const id = ++seq.current;
    setTurns((prev) => [
      ...prev,
      { id, question, symbol: nextSymbol, shown: shownTurn },
    ]);
    return id;
  }

  async function landAsk(id: number, name: string, question: string) {
    const res = await askFiling(name, question);
    if (!res.ok) {
      patch(id, {
        kind: "error",
        message: askFailureCopy({ status: res.status, error: res.error }),
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

  async function submit(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const parsed = parseDeskTurn(question, companies, symbol);
    if (parsed.kind === "empty") return;
    setDraft("");
    const next = nextSymbol(parsed, symbol);
    if (next !== undefined) setSymbol(next);

    if (
      parsed.kind === "context" ||
      parsed.kind === "brief" ||
      parsed.kind === "watch" ||
      parsed.kind === "need-company" ||
      parsed.kind === "rejected"
    ) {
      push(
        question,
        { kind: "line", text: localLine(parsed, act, watch) },
        next ?? symbol,
      );
      return;
    }

    const asking = parsed.kind === "ask";
    const id = push(
      question,
      { kind: "pending", ask: asking, slow: false },
      "symbol" in parsed ? parsed.symbol : null,
    );
    setBusy(true);
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
      if (parsed.kind === "ask") {
        await landAsk(id, parsed.symbol, parsed.question);
        return;
      }
      const reply = await onTurn(
        parsed.symbol,
        parsed.text,
        parsed.kind === "rule" ? parsed.scope : null,
      );
      if (reply.kind === "ask") {
        await landAsk(id, parsed.symbol ?? "", question);
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

  return (
    <>
      <section data-desk="" aria-label="What needs a decision">
        {shown.length ? (
          <ul className="m-0 mt-4 list-none border-t border-rule p-0">
            {shown.map((line) => {
              const on = symbol === line.symbol;
              return (
                <li key={line.key} className="border-b border-rule">
                  <div className="gutter flex items-start gap-2">
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSymbol(line.symbol)}
                      className={`min-w-0 flex-1 py-3 text-left no-callout ${
                        on ? "border-l-2 border-l-ink pl-3" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="symbol small text-ink">
                          {line.symbol}
                        </span>
                        <span className="receipt ml-auto">{line.time}</span>
                        <span className="chip chip-ink shrink-0">Act</span>
                      </span>
                      <span className="decision mt-1 block text-ink">
                        {line.sentence}
                      </span>
                    </button>
                    <a
                      href={line.href}
                      className="receipt mt-3 shrink-0 text-accent"
                    >
                      {line.action}
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : quiet ? (
          <p className="gutter mt-4 small text-ink-2">{quiet}</p>
        ) : null}
        {more > 0 ? (
          <p className="gutter receipt mt-2">{more} more. Ask.</p>
        ) : null}
        {meta ? <p className="gutter receipt mt-2">{meta}</p> : null}

        <div
          className="gutter mt-6 pb-16"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-busy={busy}
        >
          {turns.length ? (
            <ol className="m-0 list-none p-0">
              {turns.map((turn) => (
                <li
                  key={turn.id}
                  className="border-t border-rule py-4 first:border-t-0 first:pt-0"
                >
                  <p className="quote text-ink-2 italic">{turn.question}</p>
                  <div className="mt-3">
                    <TurnBody turn={turn} />
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          <div ref={endRef} />
        </div>
      </section>

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
          {symbol ? `Ask ${symbol}` : "Ask"}
        </label>
        {symbol ? (
          <span className="eyebrow pl-4 text-ink">{symbol}</span>
        ) : null}
        <input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={symbol ? `Ask ${symbol}` : "Ask"}
          maxLength={500}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
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
    </>
  );
}

function nextSymbol(
  parsed: DeskParse,
  current: string | null,
): string | null | undefined {
  if (parsed.kind === "live") return parsed.symbol ?? current;
  if (
    parsed.kind === "context" ||
    parsed.kind === "card" ||
    parsed.kind === "ask"
  )
    return parsed.symbol;
  if (parsed.kind === "rule") return parsed.symbol ?? current;
  return undefined;
}

function localLine(
  parsed: DeskParse,
  act: DeskLine[],
  watch: DeskLine[],
): string {
  if (parsed.kind === "context") return contextLine(parsed.symbol);
  if (parsed.kind === "need-company") return NAME_THE_COMPANY;
  if (parsed.kind === "rejected") return parsed.sentence;
  if (parsed.kind === "brief")
    return formatLines((n) => `${n} to act on.`, "Nothing to act on.", act);
  if (parsed.kind === "watch")
    return formatLines((n) => `${n} to watch.`, "Nothing to watch.", watch);
  return NAME_THE_COMPANY;
}

function TurnBody({ turn }: { turn: Turn }) {
  const shown = turn.shown;
  if (shown.kind === "pending") {
    return (
      <p className="receipt">
        {shown.ask
          ? askWaitCopy(
              turn.symbol ?? "the company",
              shown.slow ? ASK_WAIT_SLOW_MS : 0,
            )
          : "Looking."}
      </p>
    );
  }
  if (shown.kind === "error")
    return <p className="small text-ink">{shown.message}</p>;
  if (shown.kind === "line")
    return <p className="quote text-ink">{shown.text}</p>;
  if (shown.kind === "ask")
    return <AskAnswer text={shown.text} chips={shown.chips} />;
  if (shown.kind === "reply")
    return <ReplyBody reply={shown.reply} symbol={turn.symbol ?? ""} />;
  return null;
}
