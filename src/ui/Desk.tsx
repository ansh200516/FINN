"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  type AskChip,
  COMPANY_EMPTY,
  type CompanyReply,
  presentAsk,
} from "@/lib/companyTurn";
import {
  type AssumptionWhy,
  assumptionLine,
  contextLine,
  type DeskCompany,
  type DeskLine,
  type DeskParse,
  formatLines,
  NAME_THE_COMPANY,
  nothingOnFile,
  parseDeskTurn,
} from "@/lib/deskTurn";
import { ASK_WAIT_SLOW_MS, askFailureCopy, askWaitCopy } from "./ask/status";
import { askFiling } from "./askClient";
import { AskAnswer, ReplyBody } from "./CompanyConversation";
import { cardHref, cardLead, cardLinkLabel } from "./cardHref";

type Shown =
  | { kind: "pending"; ask: boolean; slow: boolean }
  | { kind: "line"; text: string; href: string | null; link: string | null }
  | {
      kind: "reply";
      reply: CompanyReply;
      symbol: string;
      lead: string | null;
      href: string | null;
      link: string | null;
    }
  | {
      kind: "ask";
      text: string;
      chips: AskChip[];
      href: string | null;
      link: string | null;
    }
  | { kind: "error"; message: string };

interface Turn {
  id: number;
  question: string;
  symbol: string | null;
  shown: Shown;
}

/**
 * Chat only. The brief and the company page are not this thread.
 * A sentence returns one card in the thread, then a link to the full page.
 */
export function Desk({
  companies,
  act = [],
  watch = [],
  filedAway = 0,
  checked = null,
  initialSymbol = null,
  initialName = null,
  onTurn,
}: {
  companies: DeskCompany[];
  act?: DeskLine[];
  watch?: DeskLine[];
  filedAway?: number;
  checked?: string | null;
  initialSymbol?: string | null;
  initialName?: string | null;
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
  const [symbol, setSymbol] = useState<string | null>(initialSymbol);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const named =
    companies.find((c) => c.symbol === symbol)?.name ??
    (symbol && symbol === initialSymbol ? initialName : null);

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
    const href = name ? `/c/${encodeURIComponent(name)}` : null;
    patch(id, {
      kind: "ask",
      text: view.text,
      chips: view.chips,
      href,
      link: href && name ? `Open ${name}` : null,
    });
  }

  async function answerVague(
    question: string,
    parsed: Extract<DeskParse, { kind: "vague" }>,
  ) {
    const picked = parsed.symbol ?? act[0]?.symbol ?? watch[0]?.symbol ?? null;
    const why: AssumptionWhy = parsed.named
      ? "named"
      : parsed.symbol
        ? "open"
        : "brief";
    if (!picked) {
      push(
        question,
        {
          kind: "line",
          text: "Name a company. Nothing specific is on the brief.",
          href: "/",
          link: "The brief",
        },
        symbol,
      );
      return;
    }
    setSymbol(picked);
    const id = push(
      question,
      { kind: "pending", ask: false, slow: false },
      picked,
    );
    setBusy(true);
    try {
      const results = await onTurn(picked, "results", null);
      if (results.kind === "results" && results.card) {
        patch(
          id,
          replyShown(results, picked, assumptionLine(picked, why, "results")),
        );
        return;
      }
      if (results.kind !== "results") {
        patch(id, replyShown(results, picked, null));
        return;
      }
      const promises = await onTurn(picked, "promises", null);
      if (promises.kind === "promises" && promises.rows.length) {
        patch(
          id,
          replyShown(promises, picked, assumptionLine(picked, why, "promises")),
        );
        return;
      }
      patch(id, {
        kind: "line",
        text: nothingOnFile(picked, why),
        href: `/c/${encodeURIComponent(picked)}`,
        link: `Open ${picked}`,
      });
    } catch (e) {
      patch(id, {
        kind: "error",
        message: askFailureCopy({
          error: e instanceof Error ? e.message : null,
        }),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submit(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const parsed = parseDeskTurn(question, companies, symbol);
    if (parsed.kind === "empty") return;
    setDraft("");
    const next = nextSymbol(parsed, symbol);
    if (next !== undefined) setSymbol(next);

    if (parsed.kind === "vague") {
      await answerVague(question, parsed);
      return;
    }

    if (
      parsed.kind === "context" ||
      parsed.kind === "brief" ||
      parsed.kind === "watch" ||
      parsed.kind === "need-company" ||
      parsed.kind === "rejected"
    ) {
      const jump = lineHref(parsed);
      push(
        question,
        {
          kind: "line",
          text: localLine(parsed, act, watch, filedAway, checked),
          href: jump?.href ?? null,
          link: jump?.label ?? null,
        },
        next ?? symbol,
      );
      return;
    }

    const asking = parsed.kind === "ask";
    const focus =
      "symbol" in parsed && parsed.symbol ? parsed.symbol : (next ?? symbol);
    const id = push(
      question,
      { kind: "pending", ask: asking, slow: false },
      focus,
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
      const scope = parsed.kind === "rule" ? parsed.scope : null;
      const target = parsed.kind === "rule" ? parsed.symbol : parsed.symbol;
      const reply = await onTurn(target, parsed.text, scope);
      if (reply.kind === "ask") {
        await landAsk(id, target ?? "", question);
        return;
      }
      patch(id, replyShown(reply, target ?? symbol ?? "", cardLead(reply)));
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
      <section className="pb-8" aria-label="Chat">
        <div
          className="gutter mt-4 pb-4"
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
          ) : (
            <div>
              <p className="quote text-ink">{COMPANY_EMPTY}</p>
              {named ? <p className="receipt mt-2">{named}</p> : null}
            </div>
          )}
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
          style={{ height: 44, minWidth: 44 }}
        >
          Send
        </button>
      </form>
    </>
  );
}

function replyShown(
  reply: CompanyReply,
  symbol: string,
  lead: string | null,
): Shown {
  const href = cardHref(reply, symbol);
  return {
    kind: "reply",
    reply,
    symbol,
    lead,
    href,
    link: href ? cardLinkLabel(href, symbol) : null,
  };
}

function nextSymbol(
  parsed: DeskParse,
  current: string | null,
): string | null | undefined {
  if (parsed.kind === "vague") return parsed.symbol ?? current;
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

function lineHref(parsed: DeskParse): { href: string; label: string } | null {
  if (parsed.kind === "context") {
    return {
      href: `/c/${encodeURIComponent(parsed.symbol)}`,
      label: `Open ${parsed.symbol}`,
    };
  }
  if (parsed.kind === "brief" || parsed.kind === "watch")
    return { href: "/", label: "The brief" };
  return null;
}

function localLine(
  parsed: DeskParse,
  act: DeskLine[],
  watch: DeskLine[],
  filedAway: number,
  checked: string | null,
): string {
  if (parsed.kind === "context") return contextLine(parsed.symbol);
  if (parsed.kind === "need-company") return NAME_THE_COMPANY;
  if (parsed.kind === "rejected") return parsed.sentence;
  if (parsed.kind === "brief") {
    const body = formatLines(
      (n) => `${n} to act on.`,
      "Nothing to act on.",
      act,
    );
    const extra = [filedAway ? `${filedAway} filed away` : null, checked]
      .filter(Boolean)
      .join(" · ");
    return extra ? `${body} ${extra}` : body;
  }
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
  if (shown.kind === "line") {
    return (
      <div>
        <p className="small text-ink">{shown.text}</p>
        <CardLink href={shown.href} label={shown.link} />
      </div>
    );
  }
  if (shown.kind === "ask") {
    return (
      <div>
        <AskAnswer text={shown.text} chips={shown.chips} />
        <CardLink href={shown.href} label={shown.link} />
      </div>
    );
  }
  if (shown.kind === "reply") {
    return (
      <div>
        {shown.lead ? <p className="small text-ink">{shown.lead}</p> : null}
        <div className={shown.lead ? "mt-3" : undefined}>
          <ReplyBody reply={shown.reply} symbol={shown.symbol} />
        </div>
        <CardLink href={shown.href} label={shown.link} />
      </div>
    );
  }
  return null;
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
    <Link
      href={href}
      className="hit mt-1 inline-flex items-center receipt text-accent"
    >
      {label}
      <span aria-hidden="true"> →</span>
    </Link>
  );
}
