/**
 * A book snapshot kept for tests of the token cap. Chat does not send it.
 * A turn asks the model for tools, then answers from the JSON those tools
 * return.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { parseJsonColumn, StringArray } from "@/db/json";
import { guidance, prices } from "@/db/schema";
import { barMetrics } from "@/engine/analyse/anomalies";
import type { PriceBar, ResultsCard } from "@/engine/types";
import { estimateTokens } from "@/lib/ask";
import { getBriefView } from "@/lib/brief";
import { scoredPromises } from "@/lib/companyTurn";
import {
  type AnomalyThresholds,
  companiesByIsin,
  DEFAULT_THRESHOLDS,
  getCompanyBySymbol,
  getCompanyResultsCard,
  getDemoUser,
  getLedger,
  getResultsCardsByIsin,
  getTripwires,
  guidanceVerdictGroups,
} from "@/lib/queries";
import {
  judgeEvent,
  judgeMove,
  showAsMoveCard,
  tallyByIsin,
} from "@/ui/decision";

const TOKEN_CAP = 12_000;
const MISSED_CAP = 15;
const MOVER_CAP = 15;
const UPCOMING_CAP = 8;
const ACT_CAP = 30;
const HOLDING_CAP = 40;
const MOVE_PCT = 5;

const HEADLINE_METRICS = ["revenue", "nii", "total_income"] as const;

const SCORED_KEYS = [
  "missed",
  "cut",
  "withdrawn",
  "not_addressed",
  "kept",
  "beat",
  "raised",
] as const;

type ScoredKey = (typeof SCORED_KEYS)[number];

export interface ChatName {
  symbol: string;
  name: string;
  aliases: string[];
}

export interface PromiseCounts {
  kept: number;
  missed: number;
  open: number;
}

/** One line from the results card: revenue, or NII when that is the top line. */
export interface HoldingResults {
  period: string | null;
  label: string;
  crore: number | null;
  yoyPct: number | null;
}

export interface HoldingLine {
  symbol: string;
  name: string;
  href: string;
  movePct: number | null;
  results: HoldingResults | null;
  promises: PromiseCounts;
}

export interface ActLine {
  symbol: string;
  sentence: string;
  href: string;
}

export interface MissedPromise {
  symbol: string;
  metric: string;
  clause: string;
  href: string;
}

export interface Mover {
  symbol: string;
  pct: number;
}

export interface UpcomingItem {
  symbol: string;
  what: string;
  date: string;
}

export interface ResultsHeadline {
  period: string | null;
  lines: Array<{
    label: string;
    crore: number | null;
    yoyPct: number | null;
  }>;
}

export type ScoredCounts = Record<ScoredKey, number>;

export interface CompanyFocus {
  symbol: string;
  results: ResultsHeadline | null;
  scoredPromises: ScoredCounts;
}

export interface ChatContext {
  brief: {
    act: ActLine[];
    watch: number;
    filedAway: number;
  };
  missed: MissedPromise[];
  movers: Mover[];
  upcoming: UpcomingItem[];
  company: CompanyFocus | null;
  portfolio: HoldingLine[];
}

export interface ChatPack {
  /** What the model sees, capped. */
  context: ChatContext;
  /** Full book for the holdings card. Not trimmed. */
  names: ChatName[];
  /** Act rows for a brief card. Not trimmed. */
  act: ActLine[];
}

export async function loadChatPack(focus: string | null): Promise<ChatPack> {
  const user = await getDemoUser();
  const isins = user.portfolioIsins;
  const byIsin = await companiesByIsin(isins);
  const names = bookNames(isins, byIsin);
  const thresholds = thresholdsFrom(await getTripwires(user.id));
  const symbol = focusSymbol(focus);
  const [brief, missed, movePcts, resultCards, tallies, company] =
    await Promise.all([
      loadBrief(isins, thresholds),
      loadMissed(isins, byIsin),
      loadMovePcts(isins, byIsin),
      getResultsCardsByIsin(isins),
      loadTallies(isins),
      loadCompany(symbol),
    ]);
  const isinOf = new Map<string, string>();
  for (const [isin, row] of byIsin) {
    const symbolOf = row.nseSymbol.trim().toUpperCase();
    if (symbolOf) isinOf.set(symbolOf, isin);
  }
  return {
    context: fitChatContext({
      brief: {
        act: brief.act,
        watch: brief.watch,
        filedAway: brief.filedAway,
      },
      missed,
      movers: moversFrom(movePcts),
      upcoming: brief.upcoming,
      company,
      portfolio: names.map((row) => {
        const isin = isinOf.get(row.symbol) ?? "";
        const tally = tallies.get(isin);
        const card = isin ? resultCards.get(isin) : undefined;
        return {
          symbol: row.symbol,
          name: row.name,
          href: `/c/${encodeURIComponent(row.symbol)}`,
          movePct: movePcts.get(row.symbol) ?? null,
          results: card ? headlineOf(card) : null,
          promises: {
            kept: tally?.kept ?? 0,
            missed: tally?.missed ?? 0,
            open: tally?.open ?? 0,
          },
        };
      }),
    }),
    names,
    act: brief.act,
  };
}

/** Caps list lengths, then drops the tail until the JSON is under the token cap. */
export function fitChatContext(
  input: ChatContext,
  tokenCap = TOKEN_CAP,
): ChatContext {
  const context: ChatContext = {
    brief: {
      watch: input.brief.watch,
      filedAway: input.brief.filedAway,
      act: input.brief.act.slice(0, ACT_CAP).map((row) => ({
        symbol: row.symbol,
        sentence: clip(row.sentence, 240),
        href: row.href,
      })),
    },
    missed: input.missed.slice(0, MISSED_CAP).map((row) => ({
      symbol: row.symbol,
      metric: clip(row.metric, 80),
      clause: clip(row.clause, 160),
      href: row.href,
    })),
    movers: input.movers.slice(0, MOVER_CAP).map((row) => ({ ...row })),
    upcoming: input.upcoming.slice(0, UPCOMING_CAP).map((row) => ({
      symbol: row.symbol,
      what: clip(row.what, 120),
      date: row.date,
    })),
    company: copyCompany(input.company),
    portfolio: input.portfolio.slice(0, HOLDING_CAP).map(copyHolding),
  };
  let guard = 0;
  while (estimateTokens(JSON.stringify(context)) > tokenCap && guard < 500) {
    guard += 1;
    if (context.upcoming.length) {
      context.upcoming.pop();
      continue;
    }
    if (context.movers.length) {
      context.movers.pop();
      continue;
    }
    if (context.missed.length) {
      context.missed.pop();
      continue;
    }
    if (context.brief.act.length) {
      context.brief.act.pop();
      continue;
    }
    const lines = context.company?.results?.lines;
    if (lines?.length) {
      lines.pop();
      continue;
    }
    if (context.company) {
      context.company = null;
      continue;
    }
    if (context.portfolio.length) {
      context.portfolio.pop();
      continue;
    }
    break;
  }
  return context;
}

async function loadBrief(
  isins: string[],
  thresholds: AnomalyThresholds,
): Promise<{
  act: ActLine[];
  watch: number;
  filedAway: number;
  upcoming: UpcomingItem[];
}> {
  const { view } = await getBriefView({
    now: Date.now(),
    query: {},
    isins,
    thresholds,
  });
  const filingIsins = [
    ...new Set([...view.tier1, ...view.tier2].map((event) => event.isin)),
  ];
  const ledgers = tallyByIsin(await guidanceVerdictGroups(filingIsins));
  const act: ActLine[] = [];
  let watch = 0;
  for (const event of [...view.tier1, ...view.tier2]) {
    const judged = judgeEvent(event, ledgers.get(event.isin) ?? null);
    if (judged.decision === "watch") watch += 1;
    if (judged.decision !== "act") continue;
    act.push({
      symbol: event.symbol,
      sentence: judged.sentence,
      href: `/e/${encodeURIComponent(event.eventKey)}`,
    });
  }
  for (const anomaly of view.anomalies) {
    const move = {
      pct: anomaly.pctMove,
      volumeRatio: anomaly.volumeRatio,
      ruleHit: true,
    };
    if (!showAsMoveCard(move, thresholds.pricePct)) continue;
    const judged = judgeMove(move);
    if (judged.decision === "watch") watch += 1;
    if (judged.decision !== "act") continue;
    act.push({
      symbol: anomaly.symbol,
      sentence: judged.sentence,
      href: `/c/${encodeURIComponent(anomaly.symbol)}`,
    });
  }
  const upcoming = (view.upcoming ?? []).map((item) => ({
    symbol: item.symbol,
    what: item.what,
    date: item.dateIst,
  }));
  return {
    act,
    watch,
    filedAway: view.counts.filedAway,
    upcoming,
  };
}

async function loadMissed(
  isins: string[],
  byIsin: Awaited<ReturnType<typeof companiesByIsin>>,
): Promise<MissedPromise[]> {
  if (!isins.length) return [];
  const rows = await db
    .select({
      isin: guidance.isin,
      metric: guidance.metric,
      low: guidance.low,
      high: guidance.high,
      unit: guidance.unit,
      horizon: guidance.horizon,
      direction: guidance.direction,
      verdict: guidance.verdict,
    })
    .from(guidance)
    .where(
      and(
        inArray(guidance.isin, isins),
        inArray(guidance.verdict, ["missed", "cut"]),
        ne(guidance.status, "superseded"),
      ),
    );
  const lines: MissedPromise[] = [];
  for (const row of rows) {
    const company = byIsin.get(row.isin);
    const symbol = company?.nseSymbol.trim().toUpperCase();
    const verdict = row.verdict;
    if (!symbol || (verdict !== "missed" && verdict !== "cut")) continue;
    lines.push({
      symbol,
      metric: row.metric.replace(/_/g, " "),
      clause: promiseClause({
        metric: row.metric,
        low: row.low,
        high: row.high,
        unit: row.unit,
        horizon: row.horizon,
        direction: row.direction,
        verdict,
      }),
      href: `/c/${encodeURIComponent(symbol)}`,
    });
  }
  lines.sort(
    (a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      a.metric.localeCompare(b.metric) ||
      a.clause.localeCompare(b.clause),
  );
  return lines;
}

async function loadMovePcts(
  isins: string[],
  byIsin: Awaited<ReturnType<typeof companiesByIsin>>,
): Promise<Map<string, number>> {
  const moves = await Promise.all(
    isins.map(async (isin) => {
      const company = byIsin.get(isin);
      const symbol = company?.nseSymbol.trim().toUpperCase();
      if (!symbol) return null;
      const move = await latestStoredMove(isin);
      if (!move) return null;
      return { symbol, pct: Number(move.pct.toFixed(2)) };
    }),
  );
  return new Map(
    moves
      .filter((row): row is { symbol: string; pct: number } => row != null)
      .map((row) => [row.symbol, row.pct]),
  );
}

function moversFrom(pcts: Map<string, number>): Mover[] {
  return [...pcts.entries()]
    .filter(([, pct]) => Math.abs(pct) >= MOVE_PCT)
    .map(([symbol, pct]) => ({ symbol, pct }))
    .sort(
      (a, b) =>
        Math.abs(b.pct) - Math.abs(a.pct) || a.symbol.localeCompare(b.symbol),
    );
}

async function loadTallies(isins: string[]) {
  return tallyByIsin(await guidanceVerdictGroups(isins));
}

function headlineOf(card: ResultsCard): HoldingResults | null {
  const rows = card.headline ?? [];
  for (const metric of HEADLINE_METRICS) {
    const row = rows.find((line) => line.metric === metric);
    if (!row) continue;
    if (row.currentCr == null && row.yoyPct == null) continue;
    return {
      period: card.fiscalLabel ?? card.periodEnd ?? null,
      label: row.label,
      crore: row.currentCr,
      yoyPct: row.yoyPct,
    };
  }
  return null;
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

async function loadCompany(
  symbol: string | null,
): Promise<CompanyFocus | null> {
  if (!symbol) return null;
  const company = await getCompanyBySymbol(symbol);
  if (!company) return null;
  const [card, ledger] = await Promise.all([
    getCompanyResultsCard(company.isin),
    getLedger(company.isin),
  ]);
  const scored = emptyCounts();
  for (const row of scoredPromises(ledger)) {
    const verdict = row.verdict;
    if (verdict && isScored(verdict)) scored[verdict] += 1;
  }
  return {
    symbol: company.nseSymbol.trim().toUpperCase(),
    results: card
      ? {
          period: card.fiscalLabel ?? card.periodEnd ?? null,
          lines: (card.headline ?? []).map((line) => ({
            label: line.label,
            crore: line.currentCr,
            yoyPct: line.yoyPct,
          })),
        }
      : null,
    scoredPromises: scored,
  };
}

function bookNames(
  isins: string[],
  byIsin: Awaited<ReturnType<typeof companiesByIsin>>,
): ChatName[] {
  return isins
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

function promiseClause(row: {
  metric: string;
  low: number | null;
  high: number | null;
  unit: string | null;
  horizon: string | null;
  direction: string | null;
  verdict: string;
}): string {
  const metric = row.metric.replace(/_/g, " ");
  const figure = figureOf(row);
  const horizon = row.horizon?.replace(/_/g, " ");
  const body = horizon
    ? `${metric} ${figure}, ${horizon}`
    : `${metric} ${figure}`;
  return `${body}, ${row.verdict.replace(/_/g, " ")}`;
}

function figureOf(row: {
  low: number | null;
  high: number | null;
  unit: string | null;
  direction: string | null;
}): string {
  const suffix = unitSuffix(row.unit);
  if (row.low != null && row.high != null && row.low !== row.high)
    return `${trimNum(row.low)}–${trimNum(row.high)}${suffix}`;
  const value = row.low ?? row.high;
  if (value != null) return `${trimNum(value)}${suffix}`;
  if (row.direction === "up") return "higher";
  if (row.direction === "down") return "lower";
  if (row.direction === "flat") return "flat";
  return "qualitative";
}

function unitSuffix(unit: string | null): string {
  if (unit === "%") return "%";
  if (unit === "bp") return " bp";
  if (unit === "INR_cr") return " cr";
  if (unit === "x") return "×";
  return "";
}

function trimNum(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function emptyCounts(): ScoredCounts {
  return {
    missed: 0,
    cut: 0,
    withdrawn: 0,
    not_addressed: 0,
    kept: 0,
    beat: 0,
    raised: 0,
  };
}

function isScored(verdict: string): verdict is ScoredKey {
  return (SCORED_KEYS as readonly string[]).includes(verdict);
}

function copyHolding(row: HoldingLine): HoldingLine {
  return {
    symbol: row.symbol,
    name: row.name,
    href: row.href,
    movePct: row.movePct,
    results: row.results
      ? {
          period: row.results.period,
          label: clip(row.results.label, 40),
          crore: row.results.crore,
          yoyPct: row.results.yoyPct,
        }
      : null,
    promises: { ...row.promises },
  };
}

function copyCompany(company: CompanyFocus | null): CompanyFocus | null {
  if (!company) return null;
  return {
    symbol: company.symbol,
    results: company.results
      ? {
          period: company.results.period,
          lines: company.results.lines.slice(0, 8).map((line) => ({
            label: clip(line.label, 40),
            crore: line.crore,
            yoyPct: line.yoyPct,
          })),
        }
      : null,
    scoredPromises: { ...company.scoredPromises },
  };
}

function focusSymbol(focus: string | null): string | null {
  if (!focus) return null;
  const symbol = focus.trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
