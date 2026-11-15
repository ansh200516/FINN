"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ResultsCard, ResultsHeadlineRow } from "@/engine/types";
import {
  type ChatLogTurn,
  chainFromLog,
  clearChatLog,
  loadChatLog,
  saveChatLog,
} from "@/lib/chatLog";
import { type ChatStreamEvent, readChatEvents } from "@/lib/chatStream";
import { NO_PROMISES, NO_RESULTS } from "@/lib/companyTurn";
import {
  clipQuarterWall,
  dropCallWords,
  isNumberWall,
  stripDecision,
} from "@/lib/finnieSay";
import { reduceTrace, type TraceItem } from "@/lib/finnieTrace";
import {
  type ChatQuarter,
  type ChatQuarterMetric,
  FINNIE_LOG_CAP,
  FINNIE_MODEL_DOWN,
  type FinnieCard,
  type FinnieLine,
  type FinnieMemory,
  type FinnieTurnResult,
} from "@/lib/finnieTypes";
import { repairPdfWords } from "@/lib/pdfWords";
import { type ComparisonRow, comparisonsFor } from "@/lib/promiseCompare";
import { composerBoxHeight, FINNIE_GREETING } from "@/ui/composer";
import type { LedgerRowView } from "@/ui/model";
import { useTypingExample } from "@/ui/typingExample";
import { ReplyBody } from "./CompanyConversation";
import { ComparisonList, QuarterBoard } from "./PromiseCompareCard";
import { ResultsGrid } from "./ResultsGrid";
import { ThoughtRow } from "./ThoughtRow";
import { VerdictBadge } from "./VerdictBadge";

/** Height of wrapped placeholder text, so a long example stays readable. */
function measureWrapped(el: HTMLTextAreaElement, text: string): number {
  const width = el.clientWidth;
  if (!width || typeof document === "undefined") return 0;
  const style = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.left = "0";
  mirror.style.top = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${width}px`;
  mirror.style.padding = style.padding;
  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "anywhere";
  mirror.style.wordBreak = "break-word";
  mirror.textContent = text;
  document.body.appendChild(mirror);
  const height = mirror.offsetHeight;
  mirror.remove();
  return height;
}

/** Grow with the draft. An empty field grows with the example, up to six lines. */
function fitComposerField(
  el: HTMLTextAreaElement,
  text = el.value,
  hint = el.placeholder,
) {
  const shown = text.length === 0 ? hint : "";
  if (text.length === 0 && !shown) {
    el.style.height = "";
    el.style.overflowY = "hidden";
    return;
  }
  if (text.length === 0) {
    const full = measureWrapped(el, shown);
    if (!full) {
      el.style.height = "";
      el.style.overflowY = "hidden";
      return;
    }
    const box = composerBoxHeight(full, true);
    el.style.height = `${box.height}px`;
    el.style.overflowY = box.scroll ? "auto" : "hidden";
    return;
  }
  el.style.overflowY = "hidden";
  el.style.maxHeight = "none";
  el.style.height = "auto";
  const box = composerBoxHeight(el.scrollHeight, true);
  el.style.maxHeight = "";
  el.style.height = `${box.height}px`;
  el.style.overflowY = box.scroll ? "auto" : "hidden";
}

type Shown =
  | { kind: "pending"; thoughts: TraceItem[]; open: boolean }
  | {
      kind: "finnie";
      say: string;
      cards: FinnieCard[];
      pages: Array<string | null>;
      links: Array<{ href: string; label: string }>;
      href: string | null;
      link: string | null;
      sayAfter: boolean;
      thoughts: TraceItem[];
      thoughtsOpen: boolean;
    };

interface Turn {
  id: number;
  question: string;
  shown: Shown;
}

/**
 * Chat only. The greeting stays first. The turns under it are stored on
 * this device and sent with the next sentence. New chat drops that thread.
 */
export function Desk({
  initialSymbol = null,
  initialName = null,
  onTurn,
}: {
  initialSymbol?: string | null;
  initialName?: string | null;
  /** Tests pass a turn. The chat page streams /api/chat instead. */
  onTurn?: (
    sentence: string,
    focus: string | null,
    prior?: FinnieMemory[] | null,
  ) => Promise<FinnieTurnResult>;
}) {
  const inputId = useId();
  const endRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldWidth = useRef(0);
  const seq = useRef(0);
  const epoch = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const [symbol, setSymbol] = useState<string | null>(initialSymbol);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const hint = useTypingExample(draft.length > 0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const named = symbol && symbol === initialSymbol ? initialName : null;
  turnsRef.current = turns;

  useEffect(() => {
    const loaded = loadChatLog(window.localStorage);
    const maxLoaded = loaded.reduce((max, turn) => Math.max(max, turn.id), 0);
    if (maxLoaded > seq.current) seq.current = maxLoaded;
    setTurns((current) => {
      const known = new Set(loaded.map((turn) => turn.id));
      const fresh = current.filter((turn) => !known.has(turn.id));
      return capTurns([...loaded.map(revive), ...fresh]);
    });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const done = storedTurns(turns);
    if (done.length === 0 && loadChatLog(window.localStorage).length > 0)
      return;
    saveChatLog(window.localStorage, done);
  }, [ready, turns]);

  useEffect(() => {
    if (!turns.length) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [turns]);

  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (el) fitComposerField(el, draft, hint.placeholder);
  }, [draft, hint.placeholder]);

  useEffect(() => {
    const el = fieldRef.current;
    const wrap = el?.parentElement;
    if (!el || !wrap || typeof ResizeObserver === "undefined") return;
    fieldWidth.current = wrap.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = wrap.clientWidth;
      if (next === fieldWidth.current) return;
      fieldWidth.current = next;
      fitComposerField(el);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  function onFieldKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.repeat) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit(draft);
  }

  function patch(id: number, next: Shown) {
    setTurns((prev) =>
      prev.map((turn) => (turn.id === id ? { ...turn, shown: next } : turn)),
    );
  }

  function toggleThoughts(id: number) {
    setTurns((prev) =>
      prev.map((turn) => {
        if (turn.id !== id) return turn;
        if (turn.shown.kind === "pending") {
          return { ...turn, shown: { ...turn.shown, open: !turn.shown.open } };
        }
        return {
          ...turn,
          shown: {
            ...turn.shown,
            thoughtsOpen: !turn.shown.thoughtsOpen,
          },
        };
      }),
    );
  }

  function newChat() {
    epoch.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearChatLog(window.localStorage);
    seq.current = 0;
    setSymbol(initialSymbol);
    setDraft("");
    setBusy(false);
    setTurns([]);
  }

  async function submit(text: string) {
    const question = text.trim() || hint.submit;
    if (!question || busy || !ready) return;
    const memory = chainFromLog(storedTurns(turnsRef.current));
    const ticket = epoch.current;
    setDraft("");
    const id = ++seq.current;
    setTurns((prev) =>
      capTurns([
        ...prev,
        {
          id,
          question,
          shown: { kind: "pending", thoughts: [], open: false },
        },
      ]),
    );
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const finish = (res: FinnieTurnResult, thoughts: TraceItem[]) => {
      if (ticket !== epoch.current) return;
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
        thoughts,
        thoughtsOpen: false,
      });
    };
    const fail = (thoughts: TraceItem[]) => {
      if (ticket !== epoch.current) return;
      patch(id, {
        kind: "finnie",
        say: FINNIE_MODEL_DOWN,
        cards: [],
        pages: [],
        links: [],
        href: null,
        link: null,
        sayAfter: false,
        thoughts,
        thoughtsOpen: false,
      });
    };
    try {
      if (onTurn) {
        try {
          let res: FinnieTurnResult;
          try {
            res = await onTurn(question, symbol, memory);
          } catch {
            // A dropped action is not proof the model is down. Ask once more.
            if (ticket !== epoch.current) return;
            res = await onTurn(question, symbol, memory);
          }
          finish(res, []);
        } catch {
          fail([]);
        }
        return;
      }
      let thoughts: TraceItem[] = [];
      const apply = (event: ChatStreamEvent) => {
        if (ticket !== epoch.current) return;
        if (event.type !== "step" && event.type !== "thought") return;
        thoughts = reduceTrace(thoughts, event);
        const next = thoughts;
        setTurns((prev) =>
          prev.map((turn) => {
            if (turn.id !== id || turn.shown.kind !== "pending") return turn;
            return {
              ...turn,
              shown: {
                kind: "pending",
                thoughts: next,
                open: turn.shown.open,
              },
            };
          }),
        );
      };
      let outcome = await streamTurn(
        question,
        symbol,
        memory,
        controller.signal,
        apply,
      );
      if (
        !outcome.result &&
        outcome.retry &&
        ticket === epoch.current &&
        !controller.signal.aborted
      ) {
        thoughts = [];
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === id
              ? {
                  ...turn,
                  shown: { kind: "pending", thoughts: [], open: false },
                }
              : turn,
          ),
        );
        outcome = await streamTurn(
          question,
          symbol,
          memory,
          controller.signal,
          apply,
        );
      }
      if (ticket !== epoch.current || controller.signal.aborted) return;
      if (!outcome.result) fail(thoughts);
      else finish(outcome.result, thoughts);
    } finally {
      if (ticket === epoch.current) setBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <>
      <header className="gutter pt-4">
        <div className="flex items-center gap-3">
          <span className="live-dot" aria-hidden="true" />
          <p className="eyebrow text-ink">Chat</p>
          <button type="button" className="new-chat" onClick={newChat}>
            New chat
          </button>
        </div>
      </header>
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
                <TurnBody turn={turn} onToggle={toggleThoughts} />
              </li>
            ))}
          </ol>
          <div ref={endRef} />
        </div>
      </section>

      <form
        data-composer=""
        data-tour="chat"
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
              <textarea
                ref={fieldRef}
                id={inputId}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onFieldKeyDown}
                placeholder={hint.placeholder}
                maxLength={500}
                enterKeyHint="send"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                disabled={busy || !ready}
                className="composer-input w-full bg-transparent text-[16px] leading-[22px] font-normal text-ink outline-none placeholder:text-ink-3 disabled:opacity-70"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !ready}
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

function TurnBody({
  turn,
  onToggle,
}: {
  turn: Turn;
  onToggle: (id: number) => void;
}) {
  const shown = turn.shown;
  if (shown.kind === "pending") {
    const title = shown.thoughts.at(-1)?.title ?? "";
    if (!title) {
      return (
        <p className="agent-status">
          <span className="live-dot" aria-hidden="true" />
        </p>
      );
    }
    return (
      <ThoughtRow
        title={title}
        items={shown.thoughts}
        open={shown.open}
        running
        onToggle={() => onToggle(turn.id)}
      />
    );
  }
  const title = shown.thoughts.at(-1)?.title ?? "";
  return (
    <>
      {title ? (
        <ThoughtRow
          title={title}
          items={shown.thoughts}
          open={shown.thoughtsOpen}
          running={false}
          onToggle={() => onToggle(turn.id)}
        />
      ) : null}
      <FinnieAnswer
        say={shown.say}
        cards={shown.cards}
        pages={shown.pages}
        links={shown.links}
        href={shown.href}
        link={shown.link}
        sayAfter={shown.sayAfter}
      />
    </>
  );
}

async function streamTurn(
  sentence: string,
  focus: string | null,
  prior: FinnieMemory[],
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<{ result: FinnieTurnResult | null; retry: boolean }> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify({ sentence, focus, prior }),
      signal,
      cache: "no-store",
    });
  } catch {
    return { result: null, retry: !signal.aborted };
  }
  if (signal.aborted) return { result: null, retry: false };
  if (response.status >= 400 && response.status < 500) {
    return { result: null, retry: false };
  }
  if (!response.ok || !response.body) return { result: null, retry: true };
  let result: FinnieTurnResult | null = null;
  let failed = false;
  try {
    await readChatEvents(response.body, (event) => {
      if (event.type === "result") result = event.result;
      else if (event.type === "error") failed = true;
      else if (event.type !== "ping") onEvent(event);
    });
  } catch {
    return { result, retry: !result && !signal.aborted };
  }
  if (result) return { result, retry: false };
  return { result: null, retry: failed || !signal.aborted };
}

const GUIDANCE_CAP = 6;
const QUOTE_WORDS = 22;

function cardNode(
  card: FinnieCard | null,
  view: { board: boolean; compared: ComparisonRow[] | null },
): ReactNode {
  if (!card) return null;
  if (card.kind === "portfolio")
    return card.names.length ? <BookNames names={card.names} /> : null;
  if (card.kind === "lines")
    return card.lines.length ? <FactLines lines={card.lines} /> : null;
  if (card.kind === "compare") return <CompareCard card={card} />;
  if (card.kind === "management") return <ManagementCard card={card} />;
  if (card.reply.kind === "promises") {
    return <PromiseRows rows={card.reply.rows} symbol={card.symbol} />;
  }
  if (card.reply.kind === "results") {
    const quarters = multiQuarters(card);
    if (view.compared && quarters.length >= 2) {
      return (
        <>
          <QuarterBoard quarters={quarters} symbol={card.symbol} />
          <ComparisonList rows={view.compared} symbol={card.symbol} />
        </>
      );
    }
    if (view.board && quarters.length >= 2) {
      return <QuarterBoard quarters={quarters} symbol={card.symbol} />;
    }
    return <QuarterGrids card={card} />;
  }
  return <ReplyBody reply={card.reply} symbol={card.symbol} />;
}

function multiQuarters(card: FinnieCard): ChatQuarter[] {
  if (card.kind !== "reply" || card.reply.kind !== "results") return [];
  const quarters = card.quarters ?? [];
  if (quarters.length >= 2) return quarters.slice(0, 8);
  const periodCards = card.periodCards ?? [];
  if (periodCards.length >= 2) {
    return periodCards.slice(0, 8).flatMap((item) => {
      const quarter = quarterFromResults(item);
      return quarter ? [quarter] : [];
    });
  }
  return [];
}

function quarterFromResults(card: ResultsCard): ChatQuarter | null {
  const period = card.fiscalLabel ?? card.periodEnd ?? "";
  if (!period) return null;
  const line = (keys: string[]): ChatQuarterMetric | null => {
    const row = card.headline?.find((item) => keys.includes(item.metric));
    if (!row) return null;
    if (row.currentCr == null && row.qoqPct == null && row.yoyPct == null)
      return null;
    return {
      label: row.label,
      crore: row.currentCr,
      qoqPct: row.qoqPct,
      yoyPct: row.yoyPct,
    };
  };
  return {
    period,
    revenue: line(["revenue", "nii", "total_income"]),
    ebitda: line(["ebitda", "ppop"]),
    pbt: line(["pbt"]),
    pat: line(["pat"]),
  };
}

function PromiseRows({
  rows,
  symbol,
}: {
  rows: LedgerRowView[];
  symbol: string;
}) {
  const shown = rows
    .filter((row) => row.status !== "superseded")
    .slice(0, GUIDANCE_CAP);
  if (!shown.length) return <p className="small text-ink">{NO_PROMISES}</p>;
  const page = symbol.trim() ? `/c/${encodeURIComponent(symbol.trim())}` : null;
  return (
    <div>
      <ul className="m-0 list-none p-0" aria-label={`${symbol} guidance`}>
        {shown.map((row) => {
          const quote = clipWords(row.quote, QUOTE_WORDS);
          return (
            <li
              key={row.id}
              className="border-b border-rule py-2 last:border-b-0"
            >
              <VerdictBadge verdict={row.verdict ?? "open"} className="small" />
              {quote ? <p className="small mt-1 text-ink">{quote}</p> : null}
            </li>
          );
        })}
      </ul>
      {page ? (
        <Link href={page} className="thread-link mt-2">
          more on the company page
        </Link>
      ) : null}
    </div>
  );
}

function QuarterGrids({
  card,
}: {
  card: Extract<FinnieCard, { kind: "reply" }>;
}) {
  const grids = gridsFor(card);
  if (!grids.length) return <p className="small text-ink">{NO_RESULTS}</p>;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {grids.map((item, index) => (
        <div
          key={`${item.periodEnd ?? item.fiscalLabel ?? "quarter"}-${index}`}
          className={index ? "border-t border-rule pt-3" : undefined}
        >
          <ResultsGrid card={item} showMeta={false} withSpark />
        </div>
      ))}
    </div>
  );
}

function gridsFor(card: Extract<FinnieCard, { kind: "reply" }>): ResultsCard[] {
  if (card.reply.kind !== "results") return [];
  if (card.periodCards?.length) return card.periodCards.slice(0, 8);
  if (card.quarters?.length) return cardsFromQuarters(card.quarters);
  return card.reply.card ? [card.reply.card] : [];
}

function cardsFromQuarters(quarters: ChatQuarter[]): ResultsCard[] {
  const keys = ["revenue", "ebitda", "pbt", "pat"] as const;
  return quarters.map((quarter, index) => {
    const history = quarters.slice(0, index + 1);
    const headline = keys.flatMap((key) => {
      const metric = quarter[key];
      if (!metric) return [];
      return [
        {
          metric: headlineMetric(key, metric.label),
          label: metric.label,
          currentCr: metric.crore,
          prevQuarterCr: null,
          yoyQuarterCr: null,
          qoqDeltaCr: null,
          qoqPct: metric.qoqPct,
          yoyDeltaCr: null,
          yoyPct: metric.yoyPct,
          marginPct: null,
          prevMarginPct: null,
          yoyMarginPct: null,
        },
      ];
    });
    const rows = headline.map((line) => {
      const key = sourceKey(line.metric);
      const spark = history.map((item) => {
        const value = item[key]?.crore;
        return value == null ? null : value * 1e7;
      });
      const points = spark.filter((value) => value != null).length;
      return {
        metric: line.metric,
        value: line.currentCr == null ? null : line.currentCr * 1e7,
        qoqPct: line.qoqPct,
        yoyPct: line.yoyPct,
        spark: points >= 2 ? spark : [],
      };
    });
    const bank = headline.some(
      (line) => line.metric === "nii" || line.metric === "ppop",
    );
    return {
      isin: "",
      basis: "consolidated",
      checksum: "preliminary",
      rows: rows as ResultsCard["rows"],
      ebitdaFormula: "pbt+fin+dna-oi",
      sourceUrl: null,
      fiscalLabel: quarter.period,
      headline,
      variant: bank ? "bank" : "corporate",
    };
  });
}

function headlineMetric(
  key: "revenue" | "ebitda" | "pbt" | "pat",
  label: string,
): ResultsHeadlineRow["metric"] {
  if (label === "NII") return "nii";
  if (label === "PPOP") return "ppop";
  if (label === "Total income") return "total_income";
  if (key === "ebitda") return "ebitda";
  if (key === "pbt") return "pbt";
  if (key === "pat") return "pat";
  return "revenue";
}

function sourceKey(
  metric: ResultsHeadlineRow["metric"],
): "revenue" | "ebitda" | "pbt" | "pat" {
  if (metric === "pbt") return "pbt";
  if (metric === "pat") return "pat";
  if (metric === "ebitda" || metric === "ppop") return "ebitda";
  return "revenue";
}

function clipWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
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
            <p className="small mt-1 text-ink-2">
              {repairPdfWords(person.excerpt)}
            </p>
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
  const resultsIndex = cards.findIndex(
    (card) => multiQuarters(card).length >= 2,
  );
  const promisesIndex = cards.findIndex(
    (card) => card.kind === "reply" && card.reply.kind === "promises",
  );
  const paired = resultsIndex >= 0 && promisesIndex >= 0;
  const resultsCard = paired ? cards[resultsIndex] : null;
  const promiseCard = paired ? cards[promisesIndex] : null;
  const promiseRows =
    paired &&
    promiseCard?.kind === "reply" &&
    promiseCard.reply.kind === "promises"
      ? promiseCard.reply.rows
      : [];
  const compared =
    paired &&
    resultsCard?.kind === "reply" &&
    promiseCard?.kind === "reply" &&
    promiseCard.reply.kind === "promises"
      ? comparisonsFor(
          multiQuarters(resultsCard),
          promiseRows,
          resultsCard.periodCards,
        )
      : [];
  const wall =
    isNumberWall(say) && cards.some((card) => multiQuarters(card).length >= 2);
  const clean = dropCallWords(stripDecision(say));
  const blocks = cards.map((card, index) => {
    if (paired && index === promisesIndex) return null;
    const node = cardNode(card, {
      board: wall,
      compared: paired && index === resultsIndex ? compared : null,
    });
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
  // The bubble is the model's sentence. The pairs under it are the rows.
  const spoken = wall && !paired ? "" : clipQuarterWall(clean);
  const bubble = spoken ? <div className="bubble-agent">{spoken}</div> : null;
  const jump = <CardLink href={href ?? null} label={link ?? null} />;
  const decisionLast = sayAfter && !paired;
  return (
    <div className="flex min-w-0 flex-col items-start gap-2" data-answer="">
      {decisionLast ? (
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

function capTurns(turns: Turn[]): Turn[] {
  return turns.slice(-FINNIE_LOG_CAP);
}

function storedTurns(turns: Turn[]): ChatLogTurn[] {
  const out: ChatLogTurn[] = [];
  for (const turn of turns) {
    if (turn.shown.kind !== "finnie") continue;
    out.push({
      id: turn.id,
      question: turn.question,
      say: turn.shown.say,
      cards: turn.shown.cards,
      pages: turn.shown.pages,
      links: turn.shown.links,
      href: turn.shown.href,
      link: turn.shown.link,
      sayAfter: turn.shown.sayAfter,
    });
  }
  return out;
}

function revive(row: ChatLogTurn): Turn {
  return {
    id: row.id,
    question: row.question,
    shown: {
      kind: "finnie",
      say: row.say,
      cards: row.cards,
      pages: row.pages,
      links: row.links,
      href: row.href,
      link: row.link,
      sayAfter: row.sayAfter,
      thoughts: [],
      thoughtsOpen: false,
    },
  };
}
