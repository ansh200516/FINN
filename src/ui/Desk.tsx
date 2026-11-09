"use client";

import {
  BarChart3,
  Lightbulb,
  Loader2,
  Plus,
  Scale,
  Search,
  Send,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
  type AskChip,
  COMPANY_EMPTY,
  type CompanyReply,
  presentAsk,
} from "@/lib/companyTurn";
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

type CommandMode = "search" | "analyze" | "reason" | "chart";

const COMMANDS: Array<{
  id: CommandMode;
  icon: typeof Search;
  label: string;
  shortcut: string;
  description: string;
}> = [
  {
    id: "search",
    icon: Search,
    label: "Search",
    shortcut: "/s",
    description: "Companies and filings",
  },
  {
    id: "analyze",
    icon: TrendingUp,
    label: "Analyze",
    shortcut: "/a",
    description: "Results or one reading",
  },
  {
    id: "reason",
    icon: Lightbulb,
    label: "Reason",
    shortcut: "/r",
    description: "Promises against delivery",
  },
  {
    id: "chart",
    icon: BarChart3,
    label: "Chart",
    shortcut: "/c",
    description: "Price or a corporate action",
  },
];

const FOCUS = [
  { id: "market", label: "Name", icon: Scale },
  { id: "portfolio", label: "Book", icon: Sparkles },
] as const;

const TIPS: Record<CommandMode, string[]> = {
  search: [
    "Ask for the results, the promises, or a rule.",
    "Reliance filings",
    "What did TCS say about margins",
    "always tell me about results",
    "Type / for commands",
  ],
  analyze: [
    "ITC results",
    "Reliance guidance",
    "Balance sheet",
    "Cash quality",
    "Latest numbers",
  ],
  reason: [
    "What did they promise",
    "Promises vs delivered",
    "HDFC Bank promises",
    "What did management say",
  ],
  chart: ["Reliance price", "Nifty", "Corporate actions", "Is the market open"],
};

type Slot =
  | { kind: "empty" }
  | { kind: "pending"; ask: boolean; slow: boolean; symbol: string | null }
  | { kind: "line"; text: string }
  | { kind: "reply"; reply: CompanyReply; symbol: string }
  | { kind: "ask"; text: string; chips: AskChip[] }
  | { kind: "error"; message: string };

interface Bubble {
  id: number;
  text: string;
}

/**
 * The dashboard home, one column. Thread, one card, thumb composer.
 * Nothing from the brief is painted until a sentence asks for it.
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
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);
  const slowTimer = useRef<number | null>(null);
  const [symbol, setSymbol] = useState<string | null>(initialSymbol);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [slot, setSlot] = useState<Slot>({ kind: "empty" });
  const [mode, setMode] = useState<CommandMode>("search");
  const [focus, setFocus] = useState<(typeof FOCUS)[number]["id"]>("market");
  const [palette, setPalette] = useState(false);
  const [picked, setPicked] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [tip, setTip] = useState(TIPS.search[0] ?? "");
  const [typing, setTyping] = useState(true);

  const named =
    companies.find((c) => c.symbol === symbol)?.name ??
    (symbol && symbol === initialSymbol ? initialName : null);
  const tips = TIPS[mode];
  const commands = draft.startsWith("/")
    ? COMMANDS.filter((cmd) =>
        cmd.label.toLowerCase().startsWith(draft.slice(1).toLowerCase()),
      )
    : COMMANDS;

  useEffect(() => {
    return () => {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
    };
  }, []);

  useEffect(() => {
    if (bubbles.length === 0 && !busy) return;
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [bubbles, busy]);

  useEffect(() => {
    setTipIndex(0);
    setTip(TIPS[mode][0] ?? "");
    setTyping(true);
  }, [mode]);

  useEffect(() => {
    const target = tips[tipIndex] ?? "";
    let timeout: number;
    if (typing) {
      if (tip.length < target.length) {
        timeout = window.setTimeout(
          () => setTip(target.slice(0, tip.length + 1)),
          50,
        );
      } else {
        timeout = window.setTimeout(() => setTyping(false), 3000);
      }
    } else if (tip.length > 0) {
      timeout = window.setTimeout(() => setTip(tip.slice(0, -1)), 30);
    } else {
      timeout = window.setTimeout(() => {
        setTipIndex((n) => (n + 1) % tips.length);
        setTyping(true);
      }, 30);
    }
    return () => window.clearTimeout(timeout);
  }, [tip, typing, tipIndex, tips]);

  function clearChat() {
    setBubbles([]);
    setSlot({ kind: "empty" });
    setDraft("");
    setBusy(false);
  }

  function onDraft(next: string) {
    setDraft(next);
    setPicked(0);
    if (!next.startsWith("/")) {
      setPalette(false);
      return;
    }
    setPalette(true);
    const cmd = next.toLowerCase();
    const hit = COMMANDS.find(
      (c) => cmd === `${c.shortcut} ` || cmd === `/${c.id} `,
    );
    if (hit) {
      setMode(hit.id);
      setDraft("");
      setPalette(false);
    }
  }

  function grow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  async function submit(raw: string) {
    const question = raw.trim();
    if (!question || busy) return;
    const steered = steer(question, mode, symbol, companies);
    const parsed = parseDeskTurn(steered, companies, symbol);
    if (parsed.kind === "empty") return;
    setDraft("");
    setPalette(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const next = nextSymbol(parsed, symbol);
    if (next !== undefined) setSymbol(next);
    const id = ++seq.current;
    setBubbles((prev) => [...prev, { id, text: question }]);

    if (
      parsed.kind === "context" ||
      parsed.kind === "brief" ||
      parsed.kind === "watch" ||
      parsed.kind === "need-company" ||
      parsed.kind === "rejected"
    ) {
      setSlot({
        kind: "line",
        text: localLine(parsed, act, watch, filedAway, checked),
      });
      return;
    }

    const asking = parsed.kind === "ask";
    const focusSymbol = "symbol" in parsed ? parsed.symbol : null;
    setSlot({ kind: "pending", ask: asking, slow: false, symbol: focusSymbol });
    setBusy(true);
    if (asking) {
      slowTimer.current = window.setTimeout(() => {
        setSlot((cur) =>
          cur.kind === "pending" ? { ...cur, slow: true } : cur,
        );
      }, ASK_WAIT_SLOW_MS);
    }
    try {
      if (parsed.kind === "ask") {
        await landAsk(parsed.symbol, parsed.question);
        return;
      }
      if (parsed.kind === "rule") {
        const bare = parseDeskTurn(steered, companies, null);
        const book =
          focus === "portfolio" &&
          bare.kind === "rule" &&
          bare.scope === "book";
        const scope = book ? "book" : parsed.scope;
        const ruleSymbol = book ? null : parsed.symbol;
        if (ruleSymbol) setSymbol(ruleSymbol);
        const reply = await onTurn(ruleSymbol, parsed.text, scope);
        if (reply.kind === "ask") {
          await landAsk(ruleSymbol ?? "", question);
          return;
        }
        setSlot({ kind: "reply", reply, symbol: ruleSymbol ?? symbol ?? "" });
        return;
      }
      const reply = await onTurn(parsed.symbol, parsed.text, null);
      if (reply.kind === "ask") {
        await landAsk(parsed.symbol ?? "", question);
        return;
      }
      setSlot({
        kind: "reply",
        reply,
        symbol: parsed.symbol ?? symbol ?? "",
      });
    } catch (e) {
      setSlot({
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

  async function landAsk(name: string, question: string) {
    const res = await askFiling(name, question);
    if (!res.ok) {
      setSlot({
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
    setSlot({ kind: "ask", text: view.text, chips: view.chips });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      setPalette(false);
      return;
    }
    if (e.key === "ArrowDown" && palette && commands.length) {
      e.preventDefault();
      setPicked((n) => (n + 1) % commands.length);
      return;
    }
    if (e.key === "ArrowUp" && palette && commands.length) {
      e.preventDefault();
      setPicked((n) => (n - 1 + commands.length) % commands.length);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (palette && commands.length) {
        const cmd = commands[picked];
        if (cmd) {
          setMode(cmd.id);
          setDraft("");
          setPalette(false);
        }
        return;
      }
      void submit(draft);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <section className="flex min-h-0 flex-[1.15] flex-col overflow-hidden rounded-xl border border-white/5 bg-black/20 backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                <span className="absolute h-full w-full animate-ping rounded-full bg-cyan-500/20" />
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(165,243,252,0.8)]" />
              </span>
              <span className="text-xs font-light tracking-widest text-zinc-100 uppercase">
                FINN
              </span>
              {symbol ? (
                <span className="truncate rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                  {symbol}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={clearChat}
              title="New chat"
              className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">New chat</span>
            </button>
          </div>
          <div
            ref={threadRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={busy}
          >
            {bubbles.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="self-start text-sm font-light leading-relaxed tracking-wide text-zinc-300">
                  {COMPANY_EMPTY}
                </p>
                {named ? (
                  <p className="text-sm font-light text-zinc-400">{named}</p>
                ) : null}
              </div>
            ) : (
              bubbles.map((b) => (
                <div key={b.id} className="flex flex-col items-end gap-1">
                  <div className="max-w-[85%] rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm font-light leading-relaxed text-cyan-50">
                    {b.text}
                  </div>
                </div>
              ))
            )}
            {slot.kind === "pending" ? (
              <div className="flex items-center gap-2 px-1 text-xs text-cyan-400/80">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span>
                  {slot.ask
                    ? askWaitCopy(
                        slot.symbol ?? symbol ?? "the company",
                        slot.slow ? ASK_WAIT_SLOW_MS : 0,
                      )
                    : "Looking."}
                </span>
              </div>
            ) : null}
          </div>
        </section>

        <section
          data-card=""
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/5 bg-black/20 backdrop-blur-md"
          aria-live="polite"
        >
          <div className="flex items-center border-b border-white/5 bg-white/[0.01] px-4 py-2.5">
            <span className="text-sm font-semibold whitespace-nowrap text-cyan-300">
              {cardLabel(slot)}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto p-4">
            <CardBody slot={slot} symbol={symbol} />
          </div>
        </section>
      </div>

      <form
        data-composer=""
        className="relative shrink-0 px-3 pb-[max(12px,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        {palette ? (
          <div className="absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-lg border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-white/5 px-3 py-2">
              <span className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
                Commands
              </span>
            </div>
            <div className="p-1">
              {commands.map((cmd, index) => {
                const Icon = cmd.icon;
                const on = mode === cmd.id;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    onClick={() => {
                      setMode(cmd.id);
                      setDraft("");
                      setPalette(false);
                      textareaRef.current?.focus();
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left ${
                      on
                        ? "bg-cyan-500/10 text-cyan-200"
                        : index === picked
                          ? "bg-white/10 text-zinc-200"
                          : "text-zinc-400"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium">{cmd.label}</span>
                        <span className="font-mono text-[10px] text-zinc-600">
                          {cmd.shortcut}
                        </span>
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {cmd.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-white/5 bg-white/[0.03] focus-within:border-white/10 focus-within:bg-white/[0.05]">
          <label className="sr-only" htmlFor={inputId}>
            {symbol ? `Ask ${symbol}` : "Ask"}
          </label>
          <textarea
            id={inputId}
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              onDraft(event.target.value);
              grow();
            }}
            onKeyDown={onKeyDown}
            placeholder={tip}
            rows={1}
            maxLength={500}
            enterKeyHint="send"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            disabled={busy}
            className="scrollbar-hide w-full resize-none bg-transparent py-3 pr-3 pl-4 text-base font-light text-zinc-200 placeholder:text-zinc-600 focus:outline-none disabled:opacity-70"
            style={{ minHeight: 52, maxHeight: 120 }}
          />
          <div className="flex items-center gap-1 px-3 pt-0 pb-3">
            <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.03] p-0.5">
              {COMMANDS.map((cmd) => {
                const Icon = cmd.icon;
                const on = mode === cmd.id;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    title={`${cmd.label} (${cmd.shortcut})`}
                    onClick={() => setMode(cmd.id)}
                    className={`relative rounded-md p-2 ${
                      on
                        ? "bg-cyan-500/15 text-cyan-300"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{cmd.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mx-1 h-4 w-px bg-white/10" />
            {FOCUS.map((option) => {
              const Icon = option.icon;
              const on = focus === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={option.label}
                  onClick={() => setFocus(option.id)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${
                    on
                      ? "bg-white/10 text-zinc-200"
                      : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                  }`}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              );
            })}
            <div className="min-w-2 flex-1" />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                draft.trim() && !busy
                  ? "bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                  : "bg-white/[0.03] text-zinc-600"
              }`}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Send</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function CardBody({ slot, symbol }: { slot: Slot; symbol: string | null }) {
  if (slot.kind === "empty") return <div className="min-h-16" />;
  if (slot.kind === "pending") {
    return (
      <div className="flex h-full flex-col items-center justify-center py-8">
        <Loader2
          className="mb-3 h-8 w-8 animate-spin text-cyan-400"
          aria-hidden="true"
        />
        <span className="text-sm text-zinc-500">
          {slot.ask ? "Reading the filings." : "Looking."}
        </span>
      </div>
    );
  }
  if (slot.kind === "error")
    return <p className="text-sm font-light text-red-300">{slot.message}</p>;
  if (slot.kind === "line")
    return (
      <p className="text-sm font-light leading-relaxed tracking-wide text-zinc-100">
        {slot.text}
      </p>
    );
  if (slot.kind === "ask")
    return <AskAnswer text={slot.text} chips={slot.chips} />;
  if (slot.kind === "reply")
    return (
      <ReplyBody reply={slot.reply} symbol={slot.symbol || symbol || ""} />
    );
  return null;
}

function cardLabel(slot: Slot): string {
  if (slot.kind === "reply") {
    if (slot.reply.kind === "results") return "Results";
    if (slot.reply.kind === "promises") return "Promises";
    if (slot.reply.kind === "reading") return slot.reply.block.title;
    if (slot.reply.kind === "rule") return "Alert";
    if (slot.reply.kind === "nse") return "NSE";
  }
  if (slot.kind === "ask") return "Filing";
  if (slot.kind === "line") return "Brief";
  if (slot.kind === "pending") return "Looking";
  return "Card";
}

function steer(
  raw: string,
  mode: CommandMode,
  active: string | null,
  companies: DeskCompany[],
): string {
  const parsed = parseDeskTurn(raw, companies, active);
  if (parsed.kind !== "context") return raw;
  if (mode === "analyze") return `${parsed.symbol} results`;
  if (mode === "reason") return `${parsed.symbol} promises`;
  if (mode === "chart") return `${parsed.symbol} price`;
  return raw;
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
