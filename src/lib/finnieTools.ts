/**
 * Finnie's tools. Each one calls code the app already has.
 * The model chooses the tool. It does not write the figures.
 */
import { revalidatePath } from "next/cache";
import { removeFromPortfolio } from "@/app/add/actions";
import { parseJsonColumn, StringArray } from "@/db/json";
import { ensureCompany, resolveNseSymbol } from "@/engine/jobs/resolve";
import {
  answerNse,
  NSE_FEED_FAILED,
  NseFeedError,
} from "@/engine/sources/nse-mcp";
import { CATEGORIES, type Category, type Tripwire } from "@/engine/types";
import { invalidateBrief } from "@/lib/brief";
import {
  type CompanyReply,
  confirmRule,
  scoredPromises,
} from "@/lib/companyTurn";
import type { FinnieTool, ToolArgs, ToolOutcome } from "@/lib/finnieTypes";
import { continueJob, startResearch } from "@/lib/jobs";
import { PULL_TITLES, type PullTitle } from "@/lib/pull";
import { loadPullMenu } from "@/lib/pullRead";
import {
  companiesByIsin,
  getCompanyBySymbol,
  getCompanyResultsCard,
  getDemoUser,
  getLedger,
  getQuarters,
} from "@/lib/queries";
import { writeTripwire } from "@/lib/tripwireWrite";
import { cardHref, cardLinkLabel } from "@/ui/cardHref";

/** One chat request may advance research, not run the whole pipeline. */
const RESEARCH_BUDGET_MS = 8_000;

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
): Promise<ToolOutcome> {
  switch (tool) {
    case "list_portfolio":
      return listPortfolio();
    case "add_to_portfolio":
      return addToPortfolio(args.symbol, focus);
    case "remove_from_portfolio":
      return removeName(args.symbol, focus);
    case "get_results":
      return resultsFor(args.symbol, focus);
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
    case "open_company":
      return openCompany(args.symbol, focus);
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
  await ensureCompany(
    {
      symbol: found.symbol,
      isin: found.isin,
      name: found.name,
      series: null,
      via: "db",
    },
    { portfolio: true },
  );
  const card = await getCompanyResultsCard(found.isin);
  let research: "started" | "has_results" | "not_started" = card
    ? "has_results"
    : "not_started";
  if (!card) {
    const job = await startResearch(found.symbol, { portfolio: true });
    if (job.ok) {
      research = "started";
      try {
        await continueJob(job.jobId, { deadlineMs: RESEARCH_BUDGET_MS });
      } catch {
        // The job is queued. This request could not finish it.
      }
    }
  }
  await refreshBook();
  return {
    fact: {
      status: "added",
      symbol: found.symbol,
      name: found.name,
      research,
    },
    card: null,
    symbol: found.symbol,
    href: `/c/${encodeURIComponent(found.symbol)}`,
    link: `Open ${found.symbol}`,
    book: "added",
  };
}

async function removeName(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, false);
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
  try {
    await removeFromPortfolio(found.isin);
  } catch {
    // A cache refresh can throw after the row is gone.
  }
  if (await inBook(found.isin)) {
    return bare({
      error: "The portfolio did not change.",
      symbol: found.symbol,
    });
  }
  await refreshBook();
  return {
    fact: { status: "removed", symbol: found.symbol, name: found.name },
    card: null,
    symbol: found.symbol,
    href,
    link,
    book: "removed",
  };
}

async function resultsFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const card = await getCompanyResultsCard(found.isin);
  const reply: CompanyReply = { kind: "results", card };
  const linked = linkFor(reply, found.symbol);
  if (!card) {
    return {
      fact: { status: "none", topic: "results", symbol: found.symbol },
      card: null,
      symbol: found.symbol,
      ...linked,
      book: null,
    };
  }
  const lines = (card.headline ?? []).map((row) => ({
    label: row.label,
    crore: row.currentCr,
    yoyPct: row.yoyPct,
  }));
  return {
    fact: {
      status: "results",
      symbol: found.symbol,
      period: card.fiscalLabel ?? card.periodEnd ?? null,
      lines,
    },
    card: { kind: "reply", symbol: found.symbol, reply },
    symbol: found.symbol,
    ...linked,
    book: null,
  };
}

async function promisesFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  const rows = scoredPromises(await getLedger(found.isin));
  const reply: CompanyReply = { kind: "promises", rows };
  const linked = linkFor(reply, found.symbol);
  if (!rows.length) {
    return {
      fact: { status: "none", topic: "promises", symbol: found.symbol },
      card: null,
      symbol: found.symbol,
      ...linked,
      book: null,
    };
  }
  return {
    fact: {
      status: "promises",
      symbol: found.symbol,
      count: rows.length,
      lines: rows.slice(0, 8).map((row) => ({
        metric: row.metric,
        verdict: row.verdict,
        horizon: row.horizon,
      })),
    },
    card: { kind: "reply", symbol: found.symbol, reply },
    symbol: found.symbol,
    ...linked,
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
      which: block.title,
      verdict: block.verdict,
    },
    card: { kind: "reply", symbol: found.symbol, reply },
    symbol: found.symbol,
    ...linkFor(reply, found.symbol),
    book: null,
  };
}

async function quoteFor(
  raw: string | undefined,
  focus: string | null,
): Promise<ToolOutcome> {
  const found = await findSymbol(raw, focus, true);
  if (!found.ok) return bare({ error: found.error });
  return nseCard(
    () => answerNse({ kind: "quote", symbol: found.symbol }),
    found.symbol,
    "quote",
  );
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
  const saved = await writeTripwire(
    target.book ? null : isin,
    built.rule,
    scope,
    isin ?? "book",
  );
  if (!saved) return bare({ error: "The rule did not save." });
  const sentence = confirmRule(label, scope, built.rule);
  const reply: CompanyReply = { kind: "rule", sentence };
  return {
    fact: { status: "alert", scope, symbol, sentence },
    card: { kind: "reply", symbol: symbol ?? "", reply },
    symbol,
    ...linkFor(reply, symbol ?? ""),
    book: null,
  };
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
  const symbol = ticker(raw) ?? (useFocus ? ticker(focus ?? undefined) : null);
  if (!symbol) return { ok: false, error: "Name a company." };
  const found = await resolveNseSymbol(symbol);
  if (!found)
    return {
      ok: false,
      error: `${symbol} is not an NSE-listed equity symbol.`,
    };
  return { ok: true, symbol: found.symbol, isin: found.isin, name: found.name };
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

async function refreshBook(): Promise<void> {
  try {
    revalidatePath("/");
    revalidatePath("/brief");
    revalidatePath("/c");
    await invalidateBrief();
  } catch {
    // The row is saved. The brief cache expires on its own.
  }
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
