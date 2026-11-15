/**
 * Finnie's tools. Each one calls code the app already has.
 * The model chooses the tool. It does not write the figures.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { parseJsonColumn, StringArray } from "@/db/json";
import { alerts, events, prices } from "@/db/schema";
import { barMetrics } from "@/engine/analyse/anomalies";
import { buildResultsCard } from "@/engine/analyse/results";
import { resolveNseSymbol } from "@/engine/jobs/resolve";
import {
  answerNse,
  dateKeyLabel,
  NSE_FEED_FAILED,
  NseFeedError,
} from "@/engine/sources/nse-mcp";
import {
  CATEGORIES,
  type Category,
  type PriceBar,
  type ResultsCard,
  type ResultsQuarter,
  type Tripwire,
} from "@/engine/types";
import { confirmExpiry, sealBookConfirm } from "@/lib/bookConfirm";
import { getBriefView } from "@/lib/brief";
import { type CompanyReply, confirmRule } from "@/lib/companyTurn";
import type {
  ChatQuarter,
  ChatQuarterMetric,
  FinnieLine,
  FinniePerson,
  FinnieTool,
  ToolArgs,
  ToolOutcome,
} from "@/lib/finnieTypes";
import { categoryLabel, dayLabel } from "@/lib/format";
import { PULL_TITLES, type PullTitle } from "@/lib/pull";
import { loadPullMenu } from "@/lib/pullRead";
import {
  type AnomalyThresholds,
  adaptCardPayload,
  companiesByIsin,
  DEFAULT_THRESHOLDS,
  DEMO_USER_ID,
  getCompanyBySymbol,
  getCompanyResultsCard,
  getDemoUser,
  getEngineQuarters,
  getInbox,
  getLedger,
  getQuarters,
  getTripwires,
  guidanceVerdictGroups,
} from "@/lib/queries";
import {
  chooseSessionClose,
  lookupEquityClose,
  noSessionClose,
  type SessionPrint,
  sessionCloseSentence,
  storedCoversSession,
} from "@/lib/sessionClose";
import { cardHref, cardLinkLabel } from "@/ui/cardHref";
import {
  attentionRank,
  isRoutineDirectorAppointment,
  judgeEvent,
  judgeMove,
  showAsMoveCard,
  spokenPct,
  tallyByIsin,
} from "@/ui/decision";
import { promised } from "@/ui/LedgerList";
import type { LedgerRowView, ManagementChangeCard } from "@/ui/model";
import { peopleOf } from "@/ui/people";

/** One chat request may advance research, not run the whole pipeline. */
const RESEARCH_STEPS = [
  "Resolve company · ISIN and aliases",
  "Fetch announcements",
  "Fetch prices",
  "Fetch results",
  "Discover documents",
  "Settle the ledger",
];

function confirmCard(
  symbol: string,
  sentence: string,
  label: string,
  token: string,
  steps: string[],
  status: string,
): ToolOutcome {
  const reply: CompanyReply = {
    kind: "confirm",
    token,
    sentence,
    label,
    steps,
  };
  return {
    fact: { status, symbol, sentence },
    card: { kind: "reply", symbol, reply },
    symbol,
    href: null,
    link: null,
    book: null,
  };
}

const READING: Record<string, PullTitle> = {
  "business snapshot": "Business snapshot",
  business: "Business snapshot",
  "financial snapshot": "Financial snapshot",
  financial: "Financial snapshot",
  financials: "Financial snapshot",
  trajectory: "Trajectory",
  "balance sheet": "Balance sheet",
  balance: "Balance sheet",
  "cash quality": "Cash quality",
  cash: "Cash quality",
  "cash flow": "Cash quality",
  "narrative vs. numbers": "Narrative vs. numbers",
  "narrative vs numbers": "Narrative vs. numbers",
  narrative: "Narrative vs. numbers",
  guidance: "Guidance",
  "bull vs. bear": "Bull vs. bear",
  "bull vs bear": "Bull vs. bear",
  "bull bear": "Bull vs. bear",
};

const INDEX: Record<string, string> = {
  nifty: "NIFTY 50",
  nifty50: "NIFTY 50",
  "nifty 50": "NIFTY 50",
  "bank nifty": "NIFTY BANK",
  "nifty bank": "NIFTY BANK",
  "nifty it": "NIFTY IT",
  "india vix": "INDIA VIX",
};

export async function executeTool(
  tool: FinnieTool,
  args: ToolArgs,
  focus: string | null,
  carry = false,
): Promise<ToolOutcome> {
  switch (tool) {
    case "list_portfolio":
      return listPortfolio();
    case "add_to_portfolio":
      return addToPortfolio(args.symbol, focus);
    case "remove_from_portfolio":
      return removeName(args.symbol, focus, carry);
    case "get_results":
      return resultsFor(args, focus);
    case "get_promises":
      return promisesFor(args.symbol, focus);
    case "get_reading":
      return readingFor(args.symbol, args.which, focus);
    case "get_quote":
      return quoteFor(args.symbol, focus);
    case "get_index":
      return indexFor(args.name);
    case "get_corporate_actions":
      return actionsFor(args.symbol, focus);
    case "set_alert":
      return setAlert(args, focus);
    case "disable_alert":
      return disableAlert(args, focus);
    case "open_company":
      return openCompany(args.symbol, focus);
    case "get_brief":
      return briefFor(args.window, args.symbol);
    case "list_unread":
      return listUnread();
    case "mark_read":
      return markRead();
    case "get_upcoming":
      return upcomingFor();
    case "missed_promises":
      return missedPromises();
    case "movers":
      return moversFor(args);
    case "get_management":
      return managementFor(args.symbol, focus);
    case "compare":
      return compareFor(args, focus);
    default:
      return bare({ error: "That tool is not available." });
  }
}

async function listPortfolio(): Promise<ToolOutcome> {
  const user = await getDemoUser();
  const byIsin = await companiesByIsin(user.portfolioIsins);
  const names = user.portfolioIsins
    .map((isin) => byIsin.get(isin))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      symbol: row.nseSymbol.trim().toUpperCase(),
      name: row.name.trim(),
      aliases: parseJsonColumn(StringArray, row.aliasesJson, [])
        .map((alias) => alias.trim())
        .filter(Boolean),
    }))
    .filter((row) => row.symbol)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    fact: {
      status: "listed",
      count: names.length,
      names: names.map((row) => ({ symbol: row.symbol, name: row.name })),
    },
    card: { kind: "portfolio", names },
    symbol: null,
    href: null,
    link: null,
    book: null,
  };
}

async function addToPortfolio(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, false);
  if (!found.ok) return bare({ error: found.error });
  if (await inBook(found.isin)) {
    return {
      fact: {
        status: "already_in",
        symbol: found.symbol,
        name: found.name,
      },
      card: null,
      symbol: found.symbol,
      href: `/c/${encodeURIComponent(found.symbol)}`,
      link: `Open ${found.symbol}`,
      book: "already_in",
    };
  }
  const token = sealBookConfirm({
    op: "add",
    symbol: found.symbol,
    exp: confirmExpiry(),
  });
  return confirmCard(
    found.symbol,
    `Add ${found.symbol} to the book? Research starts after you confirm.`,
    `Add ${found.symbol}`,
    token,
    RESEARCH_STEPS,
    "confirm_add",
  );
}

async function removeName(
  raw: string | undefined,
  focus: string | null,
  carry: boolean,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, carry);
  if (!found.ok) return bare({ error: found.error });
  const href = `/c/${encodeURIComponent(found.symbol)}`;
  const link = `Open ${found.symbol}`;
  if (!(await inBook(found.isin))) {
    return {
      fact: { status: "not_in", symbol: found.symbol, name: found.name },
      card: null,
      symbol: found.symbol,
      href,
      link,
      book: null,
    };
  }
  const token = sealBookConfirm({
    op: "remove",
    symbol: found.symbol,
    exp: confirmExpiry(),
  });
  return confirmCard(
    found.symbol,
    `Remove ${found.symbol} from the book? Nothing changes until you confirm.`,
    `Remove ${found.symbol}`,
    token,
    [],
    "confirm_remove",
  );
}

async function resultsFor(
  args: ToolArgs,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(args.symbol, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const href = companyPage(found.symbol);
  const engine = await getEngineQuarters(found.isin);
  const history = quarterHistory(engine, quarterCount(args.quarters));
  const quarters = history.quarters;
  const card = history.cards.at(-1) ?? buildResultsCard(engine);
  if (!card && !quarters.length) {
    return {
      fact: { status: "none", symbol: found.symbol, quarters: [] },
      card: null,
      symbol: found.symbol,
      href,
      link: "Full page",
      book: null,
    };
  }
  const reply: CompanyReply = { kind: "results", card };
  return {
    fact: { status: "results", symbol: found.symbol, quarters },
    card: {
      kind: "reply",
      symbol: found.symbol,
      reply,
      quarters,
      ...(history.cards.length ? { periodCards: history.cards } : {}),
    },
    symbol: found.symbol,
    href,
    link: "Full page",
    book: null,
  };
}

async function promisesFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const href = companyPage(found.symbol);
  const rows = (await getLedger(found.isin))
    .filter((row) => row.status !== "superseded")
    .slice(0, PROMISE_CAP);
  if (!rows.length) {
    return {
      fact: { status: "none", symbol: found.symbol, rows: [] },
      card: null,
      symbol: found.symbol,
      href,
      link: "Full page",
      book: null,
    };
  }
  const reply: CompanyReply = { kind: "promises", rows };
  return {
    fact: {
      status: "promises",
      symbol: found.symbol,
      rows: rows.map(promiseFact),
    },
    card: { kind: "reply", symbol: found.symbol, reply },
    symbol: found.symbol,
    href,
    link: "Full page",
    book: null,
  };
}

async function readingFor(
  raw: string | undefined,
  which: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const title = readingTitle(which);
  if (!title) return bare({ error: "That reading is not one of the eight." });
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const row = await getCompanyBySymbol(found.symbol);
  const isBank = row ? await bankOf(row) : false;
  const blocks = await loadPullMenu({ isin: found.isin, isBank });
  const block = blocks.find((item) => item.title === title);
  if (!block) return bare({ error: "That reading is not on file." });
  const reply: CompanyReply = { kind: "reading", block };
  return {
    fact: {
      status: "reading",
      symbol: found.symbol,
      ...readingPayload(block),
    },
    card: { kind: "reply", symbol: found.symbol, reply },
    symbol: found.symbol,
    ...linkFor(reply, found.symbol),
    book: null,
  };
}

function readingPayload(block: {
  title: string;
  verdict: string;
  lines: string[];
  table?: { headers: string[]; rows: string[][] };
}): Record<string, unknown> {
  return {
    which: block.title,
    verdict: block.verdict,
    lines: block.lines.slice(0, 6).map((line) => clipWords(line, 80)),
    table: block.table
      ? {
          headers: block.table.headers,
          rows: block.table.rows.slice(0, 8),
        }
      : null,
  };
}

async function quoteFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const live = await nseCard(
    () => answerNse({ kind: "quote", symbol: found.symbol }),
    found.symbol,
    "quote",
  );
  if (typeof live.fact.error !== "string") return live;
  const stored = await latestStoredBar(found.isin);
  let printed: SessionPrint | null = null;
  if (!stored || !storedCoversSession(stored.date)) {
    let lookup: Awaited<ReturnType<typeof lookupEquityClose>> = {
      status: "unread",
    };
    try {
      lookup = await lookupEquityClose(found.symbol);
    } catch {
      lookup = { status: "unread" };
    }
    if (lookup.status === "hit") printed = lookup.print;
    if (
      stored &&
      !storedCoversSession(stored.date) &&
      !printed &&
      lookup.status !== "none"
    ) {
      return missingClose(found.symbol);
    }
  }
  const chosen = chooseSessionClose(stored, printed);
  if (!chosen) return missingClose(found.symbol);
  return closeQuote(
    found.symbol,
    {
      close: chosen.print.close,
      date: chosen.print.date,
      changePct: changePct(chosen.print.close, chosen.print.prevClose),
    },
    chosen.source,
  );
}

/** Newest stored bar by session date. An earlier row is not the last close. */
async function latestStoredBar(isin: string): Promise<SessionPrint | null> {
  if (!isin) return null;
  const rows = await db
    .select({
      close: prices.close,
      prevClose: prices.prevClose,
      date: prices.date,
    })
    .from(prices)
    .where(eq(prices.isin, isin))
    .orderBy(desc(prices.date))
    .limit(4);
  for (const row of rows) {
    if (row.close == null || !Number.isFinite(row.close)) continue;
    return {
      close: row.close,
      prevClose:
        row.prevClose != null && Number.isFinite(row.prevClose)
          ? row.prevClose
          : null,
      date: row.date,
    };
  }
  return null;
}

function changePct(close: number, prev: number | null): number | null {
  if (prev == null || !Number.isFinite(prev) || prev === 0) return null;
  return ((close - prev) / prev) * 100;
}

function closeQuote(
  symbol: string,
  session: { close: number; date: string; changePct: number | null },
  source: "stored" | "bhavcopy",
): ToolOutcome {
  const headline = sessionCloseSentence(
    symbol,
    session.close,
    session.date,
    session.changePct,
  );
  const when = dateKeyLabel(session.date);
  const note = when ? `Session close · ${when}` : "Session close";
  const reply: CompanyReply = { kind: "nse", headline, note };
  return {
    fact: {
      status: "quote",
      symbol,
      headline,
      note,
      source,
      close: session.close,
      date: session.date,
    },
    card: { kind: "reply", symbol, reply },
    symbol,
    ...linkFor(reply, symbol),
    book: null,
  };
}

function missingClose(symbol: string): ToolOutcome {
  const sentence = noSessionClose(symbol);
  return {
    fact: { status: "no_close", symbol, sentence },
    card: null,
    symbol,
    href: `/c/${encodeURIComponent(symbol)}`,
    link: "Full page",
    book: null,
  };
}

async function indexFor(raw: string | undefined): Promise<ToolOutcome> {
  const name = indexName(raw);
  if (!name) return bare({ error: "Name an index." });
  return nseCard(
    () => answerNse({ kind: "index", indexName: name }),
    null,
    "index",
  );
}

async function actionsFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  return nseCard(
    () => answerNse({ kind: "actions", symbol: found.symbol, scope: "all" }),
    found.symbol,
    "actions",
  );
}

async function openCompany(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const href = `/c/${encodeURIComponent(found.symbol)}`;
  return {
    fact: {
      status: "link",
      symbol: found.symbol,
      name: found.name,
      href,
    },
    card: null,
    symbol: found.symbol,
    href,
    link: `Open ${found.symbol}`,
    book: null,
  };
}

async function setAlert(
  args: ToolArgs,
  focus: string | null,
): Promise<ToolOutcome> {
  if (args.enabled === false) return disableAlert(args, focus);
  const target = alertTarget(args, focus);
  if ("error" in target) return bare({ error: target.error });
  const built = buildRule(args.kind, args.params);
  if ("error" in built) return bare({ error: built.error });
  let isin: string | null = null;
  let label = "the book";
  let symbol: string | null = null;
  if (!target.book) {
    const found = await findSymbol(target.symbol, null, false);
    if (!found.ok) return bare({ error: found.error });
    const row = await getCompanyBySymbol(found.symbol);
    if (!row) return bare({ error: "That symbol is not on file." });
    isin = row.isin;
    label = row.nseSymbol;
    symbol = row.nseSymbol;
  }
  const scope: "symbol" | "book" = target.book ? "book" : "symbol";
  const sentence = `${confirmRule(label, scope, built.rule)} Nothing is saved until you confirm.`;
  const token = sealBookConfirm({
    op: "alert",
    scope,
    symbol,
    isin,
    rule: built.rule,
    exp: confirmExpiry(),
  });
  return confirmCard(
    symbol ?? "book",
    sentence,
    "Save alert",
    token,
    [],
    "confirm_alert",
  );
}

function alertTarget(
  args: ToolArgs,
  focus: string | null,
): { book: true } | { book: false; symbol: string } | { error: string } {
  const scope = (args.scope ?? "").trim().toLowerCase();
  if (
    scope === "book" ||
    scope === "portfolio" ||
    scope === "the book" ||
    scope === "the portfolio" ||
    scope === "my portfolio"
  )
    return { book: true };
  const symbol =
    ticker(args.symbol) ??
    (scope && scope !== "symbol" ? ticker(scope) : null) ??
    ticker(focus ?? undefined);
  if (!symbol) return { error: "Name a company, or say the book." };
  return { book: false, symbol };
}

function buildRule(
  kind: string | undefined,
  params: ToolArgs["params"],
): { rule: Tripwire } | { error: string } {
  const name = (kind ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (name === "price" || name === "price_move" || name === "price_alert") {
    const pct = num(params?.pct);
    if (pct == null) return { error: "Name the price move." };
    if (pct < 0.5 || pct > 30)
      return { error: "Price alerts run from 0.5% to 30%." };
    return { rule: { kind: "price_move", params: { pct } } };
  }
  if (name === "volume" || name === "volume_ratio" || name === "volume_alert") {
    const ratio = num(params?.ratio);
    if (ratio == null) return { error: "Name the volume multiple." };
    if (ratio < 1 || ratio > 10)
      return { error: "Volume alerts run from 1× to 10×." };
    const days = num(params?.lookbackDays) ?? 20;
    if (!Number.isInteger(days) || days < 5 || days > 60)
      return { error: "The volume average runs from 5 to 60 days." };
    return {
      rule: { kind: "volume_ratio", params: { ratio, lookbackDays: days } },
    };
  }
  if (name === "category" || name === "categories") {
    const categories = (params?.categories ?? []).filter(isCategory);
    if (!categories.length) return { error: "Name a filing category." };
    return { rule: { kind: "category", params: { categories } } };
  }
  if (name === "text" || name === "keyword") {
    const pattern = (params?.pattern ?? "").trim();
    if (!pattern) return { error: "Name the text to watch." };
    const flags = params?.flags;
    const safe = flags && /^[gimsuy]*$/.test(flags) ? flags : undefined;
    return {
      rule: {
        kind: "text",
        params: safe ? { pattern, flags: safe } : { pattern },
      },
    };
  }
  return { error: "Name a price, volume, category, or text alert." };
}

async function nseCard(
  load: () => Promise<{ headline: string; note: string }>,
  symbol: string | null,
  topic: string,
): Promise<ToolOutcome> {
  try {
    const live = await load();
    const reply: CompanyReply = {
      kind: "nse",
      headline: live.headline,
      note: live.note,
    };
    return {
      fact: {
        status: topic,
        symbol,
        headline: live.headline,
        note: live.note,
      },
      card: { kind: "reply", symbol: symbol ?? "", reply },
      symbol,
      ...linkFor(reply, symbol ?? ""),
      book: null,
    };
  } catch (err) {
    const message = err instanceof NseFeedError ? err.message : NSE_FEED_FAILED;
    return bare({ error: message, symbol });
  }
}

function linkFor(
  reply: CompanyReply,
  symbol: string,
): { href: string | null; link: string | null } {
  const href = cardHref(reply, symbol);
  return { href, link: href ? cardLinkLabel(href, symbol) : null };
}

async function findSymbol(
  raw: string | undefined,
  focus: string | null,
  useFocus: boolean,
): Promise<
  | { ok: true; symbol: string; isin: string; name: string }
  | { ok: false; error: string }
> {
  const typed = (raw ?? "").trim();
  if (typed) {
    const found = await resolveNseSymbol(typed);
    if (found) {
      return {
        ok: true,
        symbol: found.symbol,
        isin: found.isin,
        name: found.name,
      };
    }
    const asTicker = ticker(typed);
    if (asTicker) {
      return {
        ok: false,
        error: `${asTicker} is not an NSE-listed equity symbol.`,
      };
    }
  }
  if (useFocus) {
    const fallback = ticker(focus ?? undefined);
    if (fallback) {
      const found = await resolveNseSymbol(fallback);
      if (found) {
        return {
          ok: true,
          symbol: found.symbol,
          isin: found.isin,
          name: found.name,
        };
      }
    }
  }
  return {
    ok: false,
    error: typed
      ? `${typed} is not an NSE-listed equity symbol.`
      : "Name a company.",
  };
}

async function inBook(isin: string): Promise<boolean> {
  const user = await getDemoUser();
  return user.portfolioIsins.includes(isin);
}

async function bankOf(row: {
  isin: string;
  industry: string | null;
  sector: string | null;
}): Promise<boolean> {
  const quarters = await getQuarters(row.isin);
  const consolidated = quarters.filter((q) => q.basis === "consolidated");
  const latest = (consolidated.length ? consolidated : quarters).at(-1);
  return (
    (latest?.nii != null && latest.ppop != null) ||
    /bank/i.test(row.industry ?? "") ||
    /bank/i.test(row.sector ?? "")
  );
}

function readingTitle(raw: string | undefined): PullTitle | null {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  return (
    READING[key] ??
    PULL_TITLES.find((title) => title.toLowerCase() === key) ??
    null
  );
}

function indexName(raw: string | undefined): string | null {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  return INDEX[key] ?? raw?.trim() ?? null;
}

const PROMISE_CAP = 12;
const QUOTE_WORDS = 40;
const TOP_METRICS = ["revenue", "total_income", "nii"] as const;
const MID_METRICS = ["ebitda", "ppop"] as const;
const PBT_METRICS = ["pbt"] as const;

function companyPage(symbol: string): string {
  return `/c/${encodeURIComponent(symbol)}`;
}

function quarterCount(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 4;
  const n = Math.trunc(value);
  if (n < 1) return 1;
  if (n > 8) return 8;
  return n;
}

function quarterHistory(
  quarters: ResultsQuarter[],
  count: number,
): { quarters: ChatQuarter[]; cards: ResultsCard[] } {
  if (!quarters.length) return { quarters: [], cards: [] };
  try {
    const full = buildResultsCard(quarters);
    if (!full) return { quarters: [], cards: [] };
    const series = quarters
      .filter((row) => row.basis === full.basis)
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const out: ChatQuarter[] = [];
    const cards: ResultsCard[] = [];
    for (const end of series.slice(-count)) {
      const upTo = series.filter((row) => row.periodEnd <= end.periodEnd);
      const card = buildResultsCard(upTo, full.basis);
      if (!card) continue;
      cards.push(card);
      out.push({
        period: card.fiscalLabel ?? card.periodEnd ?? end.periodEnd,
        revenue: metricOf(card, TOP_METRICS),
        ebitda: metricOf(card, MID_METRICS),
        pbt: metricOf(card, PBT_METRICS),
        pat: metricOf(card, ["pat"]),
      });
    }
    return { quarters: out, cards };
  } catch {
    return { quarters: [], cards: [] };
  }
}

function metricOf(
  card: ResultsCard,
  keys: readonly string[],
): ChatQuarterMetric | null {
  const lines = card.headline ?? [];
  for (const key of keys) {
    const row = lines.find((line) => line.metric === key);
    if (!row) continue;
    if (row.currentCr == null && row.qoqPct == null && row.yoyPct == null)
      continue;
    return {
      label: row.label,
      crore: row.currentCr,
      qoqPct: row.qoqPct,
      yoyPct: row.yoyPct,
    };
  }
  return null;
}

function promiseFact(row: LedgerRowView): {
  quote: string;
  metric: string;
  horizon: string | null;
  promised: string;
  verdict: string;
  delivered: string | null;
} {
  return {
    quote: clipWords(row.quote, QUOTE_WORDS),
    metric: row.metric.replace(/_/g, " "),
    horizon: row.horizon ? row.horizon.replace(/_/g, " ") : null,
    promised: promised(row),
    verdict: row.verdict ?? (row.status === "open" ? "open" : row.status),
    delivered: deliveredValue(row),
  };
}

function deliveredValue(row: LedgerRowView): string | null {
  const value = row.delivered?.value;
  if (value == null || !Number.isFinite(value)) return null;
  const unit = row.delivered?.unit ?? row.unit;
  if (unit === "INR" && Math.abs(value) >= 1e7)
    return `${trimNum(value / 1e7)} cr`;
  if (unit === "%") return `${trimNum(value)}%`;
  if (unit === "bp") return `${trimNum(value)} bp`;
  if (unit === "INR_cr") return `${trimNum(value)} cr`;
  if (unit === "x") return `${trimNum(value)}×`;
  return trimNum(value);
}

function trimNum(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function clipWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
}

function ticker(raw: string | undefined): string | null {
  const symbol = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

const WINDOWS: Record<string, "24h" | "48h" | "7d" | "30d" | "close"> = {
  "24h": "24h",
  "24 h": "24h",
  "24 hours": "24h",
  "last 24h": "24h",
  "last 24 hours": "24h",
  "48h": "48h",
  "48 h": "48h",
  "48 hours": "48h",
  "last 48h": "48h",
  "last 48 hours": "48h",
  "7d": "7d",
  "7 days": "7d",
  "last 7 days": "7d",
  week: "7d",
  "this week": "7d",
  "30d": "30d",
  "30 days": "30d",
  "last 30 days": "30d",
  month: "30d",
  close: "close",
  "since close": "close",
  since_close: "close",
};

function attentionFilings(
  view: Awaited<ReturnType<typeof getBriefView>>["view"],
  symbol: string,
  ledgers: ReturnType<typeof tallyByIsin>,
): Array<{
  symbol: string;
  category: string;
  tier: number;
  surface: "card" | "line";
  title: string;
  sentence: string;
  href: string;
}> {
  const events = [
    ...view.tier1,
    ...view.tier2,
    ...view.tier3.flatMap((group) => group.items),
  ]
    .filter((event) => event.symbol.toUpperCase() === symbol)
    .sort((a, b) => b.filedAtMs - a.filedAtMs);
  return events.slice(0, 8).map((event) => {
    const judged = judgeEvent(event, ledgers.get(event.isin) ?? null);
    return {
      symbol: event.symbol,
      category: event.category,
      tier: event.tier,
      surface: judged.decision === "act" ? "card" : "line",
      title: event.title,
      sentence: judged.sentence,
      href: `/e/${encodeURIComponent(event.eventKey)}`,
    };
  });
}

async function loadBrief(
  preset: "auto" | "24h" | "48h" | "7d" | "30d" | "close",
  isins: string[],
  thresholds: AnomalyThresholds,
  now: number,
): Promise<Awaited<ReturnType<typeof getBriefView>>["view"]> {
  const { view } = await getBriefView({
    now,
    query: preset === "auto" ? {} : { w: preset },
    isins,
    thresholds,
  });
  return view;
}

async function briefFor(
  raw: string | undefined,
  symbol?: string,
): Promise<ToolOutcome> {
  const window = briefWindow(raw);
  if ("error" in window) return bare({ error: window.error });
  let only = "";
  if (symbol?.trim()) {
    const found = await findSymbol(symbol, null, false);
    if (!found.ok) return bare({ error: found.error });
    only = found.symbol;
  }
  const now = Date.now();
  const user = await getDemoUser();
  const rules = await getTripwires(user.id);
  const thresholds = thresholdsFrom(rules);
  let isins = user.portfolioIsins;
  if (only) {
    const company = await getCompanyBySymbol(only);
    if (company && !isins.includes(company.isin))
      isins = [...isins, company.isin];
  }
  const preset = window.preset;
  const view = await loadBrief(preset, isins, thresholds, now);
  const filingIsinsOf = (
    current: Awaited<ReturnType<typeof getBriefView>>["view"],
  ) => [
    ...new Set(
      [
        ...current.tier1,
        ...current.tier2,
        ...current.tier3.flatMap((group) => group.items),
      ].map((event) => event.isin),
    ),
  ];
  const ledgers = tallyByIsin(await guidanceVerdictGroups(filingIsinsOf(view)));
  let filings = only ? attentionFilings(view, only, ledgers) : [];
  let windowPreset = view.window.preset;
  let windowLabel = view.window.label;
  // A named company with nothing in the asked window still has the filing.
  // The book can be busy in 24h while that company's board notice is older.
  if (only && (preset === "auto" || filings.length === 0) && preset !== "30d") {
    const wider = await loadBrief("30d", isins, thresholds, now);
    const wideLedgers = tallyByIsin(
      await guidanceVerdictGroups(filingIsinsOf(wider)),
    );
    const wideFilings = attentionFilings(wider, only, wideLedgers);
    if (wideFilings.length > filings.length) {
      filings = wideFilings;
      windowPreset = wider.window.preset;
      windowLabel = wider.window.label;
    }
  }
  const ranked: Array<{
    line: FinnieLine;
    decision: "act" | "watch";
    rank: number;
  }> = [];
  for (const event of [...view.tier1, ...view.tier2]) {
    if (only && event.symbol.toUpperCase() !== only) continue;
    const ledger = ledgers.get(event.isin) ?? null;
    const judged = judgeEvent(event, ledger);
    if (judged.decision === "nothing") continue;
    const broken = (ledger?.missed ?? 0) > 0 || (ledger?.cut ?? 0) > 0;
    ranked.push({
      line: {
        symbol: event.symbol,
        text: judged.sentence,
        href: `/e/${encodeURIComponent(event.eventKey)}`,
      },
      decision: judged.decision,
      rank: attentionRank({
        decision: judged.decision,
        category: event.category,
        broken,
        routineDirector: isRoutineDirectorAppointment(event),
        priority: event.priority,
        at: event.filedAtMs,
      }),
    });
  }
  for (const anomaly of view.anomalies) {
    if (only && anomaly.symbol.toUpperCase() !== only) continue;
    const move = {
      pct: anomaly.pctMove,
      volumeRatio: anomaly.volumeRatio,
      ruleHit: true,
    };
    if (!showAsMoveCard(move, thresholds.pricePct)) continue;
    const judged = judgeMove(move);
    if (judged.decision === "nothing") continue;
    ranked.push({
      line: {
        symbol: anomaly.symbol,
        text: judged.sentence,
        href: "/",
      },
      decision: judged.decision,
      rank: attentionRank({
        decision: judged.decision,
        priceRule: true,
        priority: Math.round(
          Math.abs(anomaly.pctMove ?? anomaly.volumeRatio ?? 0) * 5,
        ),
        at: Date.parse(`${anomaly.date}T00:00:00Z`),
      }),
    });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  const act = ranked
    .filter((row) => row.decision === "act")
    .map((row) => row.line);
  const watchLines = ranked
    .filter((row) => row.decision === "watch")
    .map((row) => row.line);
  const watch = watchLines.length;
  const stacks = [...act, ...watchLines];
  if (!only && view.counts.filedAway > 0) {
    stacks.push({
      symbol: "Book",
      text: `${view.counts.filedAway} filed away`,
      href: "/brief",
    });
  }
  const outcome = linesOutcome(
    {
      status: "brief",
      window: windowPreset,
      label: windowLabel,
      ...(only ? { symbol: only, filings } : {}),
      act: act.map((line) => ({
        symbol: line.symbol,
        sentence: line.text,
        href: line.href,
      })),
      watch,
      watchLines: watchLines.map((line) => ({
        symbol: line.symbol,
        sentence: line.text,
        href: line.href,
      })),
      filedAway: only
        ? filings.filter((filing) => filing.tier === 3).length
        : view.counts.filedAway,
    },
    stacks,
  );
  if (!only) return outcome;
  return {
    ...outcome,
    symbol: only,
    href: `/c/${encodeURIComponent(only)}`,
    link: `Open ${only}`,
  };
}

async function listUnread(): Promise<ToolOutcome> {
  const rows = await getInbox(DEMO_USER_ID, 100, { unread: true });
  const lines: FinnieLine[] = rows.map((row) => ({
    symbol: row.symbol ?? "Inbox",
    text: row.title,
    href: row.href ?? "/inbox",
  }));
  return linesOutcome(
    {
      status: rows.length ? "unread" : "none",
      topic: "unread",
      count: rows.length,
      rows: lines.map((line) => ({
        symbol: line.symbol,
        title: line.text,
        href: line.href,
      })),
    },
    lines,
  );
}

async function markRead(): Promise<ToolOutcome> {
  const pending = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.userId, DEMO_USER_ID), isNull(alerts.readAt)));
  const count = pending.length;
  if (count) {
    const now = Date.now();
    await db
      .update(alerts)
      .set({ readAt: now })
      .where(and(eq(alerts.userId, DEMO_USER_ID), isNull(alerts.readAt)));
    try {
      revalidatePath("/inbox");
    } catch {
      // The rows are marked. The inbox page reads them on the next request.
    }
  }
  return bare({ status: "marked", count });
}

async function upcomingFor(): Promise<ToolOutcome> {
  const now = Date.now();
  const user = await getDemoUser();
  const rules = await getTripwires(user.id);
  const { view } = await getBriefView({
    now,
    query: {},
    isins: user.portfolioIsins,
    thresholds: thresholdsFrom(rules),
  });
  const lines: FinnieLine[] = (view.upcoming ?? []).map((item) => ({
    symbol: item.symbol,
    text: `${item.dateIst} · ${item.what}`,
    href: `/c/${encodeURIComponent(item.symbol)}`,
  }));
  return linesOutcome(
    {
      status: lines.length ? "upcoming" : "none",
      topic: "upcoming",
      count: lines.length,
      lines: lines.map((line) => ({
        symbol: line.symbol,
        sentence: line.text,
        href: line.href,
      })),
    },
    lines,
  );
}

async function missedPromises(): Promise<ToolOutcome> {
  const user = await getDemoUser();
  const byIsin = await companiesByIsin(user.portfolioIsins);
  const lines: FinnieLine[] = [];
  for (const isin of user.portfolioIsins) {
    const company = byIsin.get(isin);
    if (!company) continue;
    const symbol = company.nseSymbol.trim().toUpperCase();
    if (!symbol) continue;
    const rows = await getLedger(isin);
    for (const row of rows) {
      if (row.status === "superseded") continue;
      if (row.verdict !== "missed" && row.verdict !== "cut") continue;
      lines.push({
        symbol,
        text: promiseClause(row),
        href: `/c/${encodeURIComponent(symbol)}`,
      });
    }
  }
  lines.sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || a.text.localeCompare(b.text),
  );
  return linesOutcome(
    {
      status: lines.length ? "missed" : "none",
      topic: "missed",
      count: lines.length,
      lines: lines.map((line) => ({
        symbol: line.symbol,
        clause: line.text,
        href: line.href,
      })),
    },
    lines,
  );
}

async function moversFor(args: ToolArgs): Promise<ToolOutcome> {
  const threshold = moveThreshold(args);
  if (typeof threshold !== "number") return bare({ error: threshold.error });
  const user = await getDemoUser();
  const byIsin = await companiesByIsin(user.portfolioIsins);
  const lines: FinnieLine[] = [];
  const moves: Array<{
    symbol: string;
    pct: number;
    date: string;
    href: string;
  }> = [];
  for (const isin of user.portfolioIsins) {
    const company = byIsin.get(isin);
    if (!company) continue;
    const symbol = company.nseSymbol.trim().toUpperCase();
    if (!symbol) continue;
    const move = await latestStoredMove(isin);
    if (!move || Math.abs(move.pct) < threshold) continue;
    const href = `/c/${encodeURIComponent(symbol)}`;
    const dir = move.pct < 0 ? "down" : "up";
    let when = move.date;
    try {
      when = dayLabel(move.date);
    } catch {
      when = move.date;
    }
    lines.push({
      symbol,
      text: `${dir} ${spokenPct(move.pct)}% · ${when}`,
      href,
    });
    moves.push({
      symbol,
      pct: Number(move.pct.toFixed(2)),
      date: move.date,
      href,
    });
  }
  lines.sort((a, b) => a.symbol.localeCompare(b.symbol));
  moves.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return linesOutcome(
    {
      status: lines.length ? "movers" : "none",
      topic: "movers",
      pct: threshold,
      count: lines.length,
      moves,
    },
    lines,
  );
}

async function managementFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.isin, found.isin),
        eq(events.category, "management_change"),
      ),
    )
    .orderBy(desc(events.lastAt))
    .limit(8);
  if (!rows.length) {
    return {
      fact: { status: "none", topic: "management", symbol: found.symbol },
      card: null,
      symbol: found.symbol,
      href: `/c/${encodeURIComponent(found.symbol)}`,
      link: `Open ${found.symbol}`,
      book: null,
    };
  }
  let event = rows[0];
  let people: FinniePerson[] = [];
  let oneLiner: string | null = null;
  for (const row of rows) {
    if (!event) event = row;
    try {
      const adapted = adaptManagement(JSON.parse(row.cardJson));
      if (!people.length && adapted.people.length) {
        event = row;
        people = adapted.people;
        oneLiner = adapted.oneLiner;
      } else if (!oneLiner) {
        oneLiner = adapted.oneLiner;
      }
    } catch {
      // A bad card is skipped. A later row may still name the person.
    }
  }
  if (!event) {
    return {
      fact: { status: "none", topic: "management", symbol: found.symbol },
      card: null,
      symbol: found.symbol,
      href: `/c/${encodeURIComponent(found.symbol)}`,
      link: `Open ${found.symbol}`,
      book: null,
    };
  }
  const href = `/e/${encodeURIComponent(event.eventKey)}`;
  return {
    fact: {
      status: "management",
      symbol: found.symbol,
      href,
      oneLiner,
      people,
    },
    card: { kind: "management", symbol: found.symbol, people },
    symbol: found.symbol,
    href,
    link: "The filing",
    book: null,
  };
}

async function compareFor(
  args: ToolArgs,
  focus: string | null,
): Promise<ToolOutcome> {
  const leftRaw = args.symbolA ?? args.symbol;
  const rightRaw = args.symbolB ?? args.name;
  const left = await findSymbol(leftRaw, focus, true);
  const right = await findSymbol(rightRaw, null, false);
  if (!left.ok)
    return bare({
      error: leftRaw || focus ? left.error : "Name two companies.",
    });
  if (!right.ok)
    return bare({ error: rightRaw ? right.error : "Name two companies." });
  if (left.symbol === right.symbol)
    return bare({ error: "Name two companies." });
  const [cardA, cardB] = await Promise.all([
    getCompanyResultsCard(left.isin),
    getCompanyResultsCard(right.isin),
  ]);
  const line = `${left.symbol} ${periodOf(cardA)} and ${right.symbol} ${periodOf(cardB)}.`;
  return {
    fact: {
      status: "compare",
      line,
      a: headlineFact(left.symbol, cardA),
      b: headlineFact(right.symbol, cardB),
    },
    card: {
      kind: "compare",
      a: { symbol: left.symbol, card: cardA },
      b: { symbol: right.symbol, card: cardB },
    },
    symbol: null,
    href: null,
    link: null,
    book: null,
  };
}

async function disableAlert(
  args: ToolArgs,
  focus: string | null,
): Promise<ToolOutcome> {
  const target = alertTarget(args, focus);
  if ("error" in target) return bare({ error: target.error });
  const parsed = alertKind(args.kind);
  if ("error" in parsed) return bare({ error: parsed.error });
  let isin = "book";
  let label = "the book";
  let symbol: string | null = null;
  if (!target.book) {
    const found = await findSymbol(target.symbol, null, false);
    if (!found.ok) return bare({ error: found.error });
    const row = await getCompanyBySymbol(found.symbol);
    if (!row) return bare({ error: "That symbol is not on file." });
    isin = row.isin;
    label = row.nseSymbol;
    symbol = row.nseSymbol;
  }
  const scope: "symbol" | "book" = target.book ? "book" : "symbol";
  const who = categoryName(parsed);
  const sentence = `Turn off the ${who} alert for ${label}? Nothing changes until you confirm.`;
  const token = sealBookConfirm({
    op: "alert_off",
    scope,
    symbol,
    isin,
    kind: parsed.kind,
    ...(parsed.drop ? { drop: parsed.drop } : {}),
    exp: confirmExpiry(),
  });
  return confirmCard(
    symbol ?? "book",
    sentence,
    "Turn alert off",
    token,
    [],
    "confirm_alert_off",
  );
}

async function latestStoredMove(
  isin: string,
): Promise<{ pct: number; date: string } | null> {
  const rows = await db
    .select()
    .from(prices)
    .where(eq(prices.isin, isin))
    .orderBy(desc(prices.date))
    .limit(15);
  if (!rows.length) return null;
  const bars: PriceBar[] = rows
    .slice()
    .reverse()
    .map((row) => ({
      isin: row.isin,
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      prevClose: row.prevClose,
      volume: row.volume,
      turnover: row.turnover,
      trades: row.trades,
      sessionType: row.sessionType === "special" ? "special" : "normal",
    }));
  const metrics = barMetrics(bars);
  const last = [...metrics]
    .reverse()
    .find((row) => row.sessionType === "normal" && row.pct != null);
  if (!last || last.pct == null) return null;
  return { pct: last.pct, date: last.date };
}

function adaptManagement(raw: unknown): {
  oneLiner: string | null;
  people: FinniePerson[];
} {
  const adapted = adaptCardPayload(raw);
  const card = managementCard(adapted.card);
  const people = card
    ? peopleOf(card)
        .filter((person) => person.person && person.person !== "—")
        .map((person) => ({
          person: person.person,
          role: person.role,
          action: person.action,
          excerpt: person.excerpt,
          priorRoles: person.priorRoles,
        }))
    : [];
  return { oneLiner: adapted.envelope.oneLiner ?? null, people };
}

function managementCard(card: unknown): ManagementChangeCard | null {
  if (!card || typeof card !== "object") return null;
  const row = card as ManagementChangeCard & {
    people?: unknown;
    changes?: unknown;
  };
  if (
    typeof row.person === "string" ||
    Array.isArray(row.people) ||
    Array.isArray(row.changes)
  ) {
    return {
      ...row,
      person: typeof row.person === "string" ? row.person : "",
      role: typeof row.role === "string" ? row.role : "",
      action: typeof row.action === "string" ? row.action : "",
      effective_date: row.effective_date ?? null,
      reason: row.reason ?? null,
      brief_profile_excerpt: row.brief_profile_excerpt ?? null,
      prior_roles: row.prior_roles ?? [],
      confidence: row.confidence ?? "low",
    };
  }
  return null;
}

function promiseClause(row: LedgerRowView): string {
  const metric = row.metric.replace(/_/g, " ");
  const figure = promised(row);
  const horizon = row.horizon ? row.horizon.replace(/_/g, " ") : null;
  const body = horizon
    ? `${metric} ${figure}, ${horizon}`
    : `${metric} ${figure}`;
  return `${body}, ${row.verdict}`;
}

function periodOf(card: ResultsCard | null): string {
  if (!card) return "no results on file";
  return card.fiscalLabel ?? card.periodEnd ?? "results";
}

function headlineFact(symbol: string, card: ResultsCard | null) {
  return {
    symbol,
    period: card ? (card.fiscalLabel ?? card.periodEnd ?? null) : null,
    lines: (card?.headline ?? []).map((row) => ({
      label: row.label,
      crore: row.currentCr,
      yoyPct: row.yoyPct,
    })),
  };
}

function briefWindow(
  raw: string | undefined,
):
  | { preset: "auto" | "24h" | "48h" | "7d" | "30d" | "close" }
  | { error: string } {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  // No period: the brief on screen. An empty day widens, same as the page.
  if (!key || key === "auto" || key === "now" || key === "right now")
    return { preset: "auto" };
  const preset = WINDOWS[key];
  if (!preset)
    return { error: "The window is 24h, 48h, 7d, 30d, or since close." };
  return { preset };
}

function thresholdsFrom(
  rules: Awaited<ReturnType<typeof getTripwires>>,
): AnomalyThresholds {
  const volume = rules.find(
    (rule) => rule.kind === "volume_ratio" && rule.enabled,
  );
  const price = rules.find(
    (rule) => rule.kind === "price_move" && rule.enabled,
  );
  return {
    volumeRatio:
      typeof volume?.params.ratio === "number"
        ? volume.params.ratio
        : DEFAULT_THRESHOLDS.volumeRatio,
    lookbackDays:
      typeof volume?.params.lookbackDays === "number"
        ? volume.params.lookbackDays
        : DEFAULT_THRESHOLDS.lookbackDays,
    pricePct:
      typeof price?.params.pct === "number"
        ? price.params.pct
        : DEFAULT_THRESHOLDS.pricePct,
  };
}

function moveThreshold(args: ToolArgs): number | { error: string } {
  const raw = args.pct ?? args.params?.pct;
  if (raw == null) return 5;
  const value = num(raw);
  if (value == null || value <= 0 || value > 100)
    return { error: "Name a percent." };
  return value;
}

function alertKind(kind: string | undefined):
  | {
      kind: "price_move" | "volume_ratio" | "category";
      drop?: Category;
    }
  | { error: string } {
  const name = (kind ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (name === "price" || name === "price_move" || name === "price_alert")
    return { kind: "price_move" };
  if (name === "volume" || name === "volume_ratio" || name === "volume_alert")
    return { kind: "volume_ratio" };
  if (
    name === "category" ||
    name === "categories" ||
    name === "announcement" ||
    name === "announcement_category" ||
    name === "filing" ||
    name === "filings"
  )
    return { kind: "category" };
  const category = namedCategory(kind ?? "");
  if (category) return { kind: "category", drop: category };
  return { error: "Name a price, volume, or filing-category alert." };
}

function namedCategory(raw: string): Category | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return null;
  const underscored = key.replace(/ /g, "_");
  if (isCategory(underscored)) return underscored;
  if (isCategory(key)) return key;
  if (key === "management" || key === "management changes")
    return "management_change";
  if (key === "dividends") return "dividend";
  if (key === "result" || key === "quarterly results") return "results";
  return null;
}

function categoryName(parsed: {
  kind: "price_move" | "volume_ratio" | "category";
  drop?: Category;
}): string {
  if (parsed.drop) return categoryLabel(parsed.drop).toLowerCase();
  if (parsed.kind === "price_move") return "price";
  if (parsed.kind === "volume_ratio") return "volume";
  return "category";
}

function linesOutcome(
  fact: Record<string, unknown>,
  lines: FinnieLine[],
): ToolOutcome {
  return {
    fact,
    card: lines.length ? { kind: "lines", lines } : null,
    symbol: null,
    href: null,
    link: null,
    book: null,
  };
}

function bare(fact: Record<string, unknown>): ToolOutcome {
  return {
    fact,
    card: null,
    symbol: typeof fact.symbol === "string" ? fact.symbol : null,
    href: null,
    link: null,
    book: null,
  };
}
