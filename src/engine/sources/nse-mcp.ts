/**
 * NSE's own MCP, called with fetch. No SDK and no API key.
 *
 * https://www.nseindia.com/nse-mcp publishes two servers and no others:
 *   bhavcopy  https://mcp.nseindia.in/bhavcopy/cm/mcp   (end of day)
 *   cm-market https://mcp.nseindia.in/cmmkt/mcp         (1–3 min delay)
 *
 * tools/list on 10 Nov 2026: 21 end-of-day tools, 15 delayed-market tools.
 * Wired here: live quote, live index, data status, corporate actions,
 * and one index close on a date. Index P/E, P/B, and dividend yield are
 * not printed. Equity OHLCV stays in the bhavcopy store. A text body
 * that is not JSON is refused. Quotes are not cached.
 */
import { formatInr, groupIndian } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { LiveAsk } from "@/lib/nseLive";
import { formatIst, istDateKey } from "@/lib/time";

export const NSE_MCP_PAGE = "https://www.nseindia.com/nse-mcp";
export const NSE_LIVE_URL = "https://mcp.nseindia.in/cmmkt/mcp";
export const NSE_EOD_URL = "https://mcp.nseindia.in/bhavcopy/cm/mcp";
export const NSE_FEED_FAILED = "NSE's live feed did not answer.";
export const NSE_EOD_FAILED = "NSE did not answer.";
export const NSE_INDEX_MISSING = "NSE did not list that index for that date.";

const PROTOCOL = "2025-06-18";
const TIMEOUT_MS = 4_000;

const log = logger.child({ mod: "engine/sources/nse-mcp" });

export type ResolvedLive = Exclude<LiveAsk, { kind: "needs-symbol" }>;

export interface NseCard {
  headline: string;
  note: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export class NseFeedError extends Error {
  constructor(message = NSE_FEED_FAILED) {
    super(message);
    this.name = "NseFeedError";
  }
}

interface ActionRow {
  exDate: string;
  actionType: string;
  purpose: string;
}

type FetchLike = typeof fetch;

interface RpcMessage {
  error?: unknown;
  result?: {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
}

export function quoteCard(input: {
  symbol: string;
  last: number;
  changePct: number;
  asOf: string | null;
}): NseCard {
  return {
    headline: `${input.symbol} ${formatInr(input.last, { decimals: 2 })}, ${move(input.changePct)}.`,
    note: sourceNote(stampLabel(input.asOf)),
  };
}

export function indexCard(input: {
  indexName: string;
  last: number;
  changePct: number;
  asOf: string | null;
}): NseCard {
  return {
    headline: `${input.indexName} ${groupIndian(input.last, 2)}, ${move(input.changePct)}.`,
    note: sourceNote(stampLabel(input.asOf)),
  };
}

export function statusCard(input: {
  open: "open" | "closed" | null;
  lastCrawled: string | null;
}): NseCard {
  const headline =
    input.open === "open"
      ? "NSE says the market is open."
      : input.open === "closed"
        ? "NSE says the market is closed."
        : "NSE does not publish whether the market is open.";
  const crawled = crawlLabel(input.lastCrawled);
  return {
    headline,
    note: crawled ? `NSE · last crawl ${crawled}` : "NSE",
  };
}

export function actionWindow(now: Date = new Date()): {
  fromDate: string;
  toDate: string;
} {
  const toDate = istDateKey(now);
  return { fromDate: shiftYears(toDate, -5), toDate };
}

export function indexCloseCard(input: {
  indexName: string;
  last: number;
  changePct: number;
  date: string;
}): NseCard {
  const when = dateKeyLabel(input.date);
  return {
    headline: `${input.indexName} ${groupIndian(input.last, 2)}, ${move(input.changePct)}.`,
    note: when ? `NSE · ${when}` : "NSE",
  };
}

export function corporateActionCard(input: {
  symbol: string;
  scope: "all" | "capital";
  from: string;
  to: string;
  count: number;
  actions: ActionRow[];
  incomplete: boolean;
}): NseCard {
  const picked = pickActions(input.actions, input.scope);
  if (!picked.length) {
    const span = rangeLabel(input.from, input.to);
    const what =
      input.scope === "capital" ? "split or bonus" : "corporate action";
    const where = span ? ` from ${span}` : "";
    return {
      headline: `No NSE ${what} for ${input.symbol}${where}.`,
      note: actionNote(0, input.incomplete, input.scope),
    };
  }
  const clauses = picked.map((row, i) => {
    const text = actionClause(row, i > 0);
    return i === 0 ? `${input.symbol} ${text}` : text;
  });
  return {
    headline: `${clauses.join(". ")}.`,
    note: actionNote(input.count, input.incomplete, input.scope),
  };
}

export async function answerNse(
  ask: ResolvedLive,
  fetchImpl: FetchLike = fetch,
): Promise<NseCard> {
  if (ask.kind === "quote") return quoteFrom(ask.symbol, fetchImpl);
  if (ask.kind === "index") return indexFrom(ask.indexName, fetchImpl);
  if (ask.kind === "index-close")
    return indexCloseFrom(ask.indexName, ask.date, fetchImpl);
  if (ask.kind === "actions")
    return actionsFrom(ask.symbol, ask.scope, fetchImpl);
  return statusFrom(fetchImpl);
}

async function quoteFrom(
  symbol: string,
  fetchImpl: FetchLike,
): Promise<NseCard> {
  const body = await callTool(
    NSE_LIVE_URL,
    "cm_get_stock_quote",
    { symbol },
    fetchImpl,
  );
  const stock = record(body.stock);
  const last = num(stock?.lastTradedPrice);
  const changePct = num(stock?.perChange);
  const printed = ticker(stock?.symbol) ?? symbol;
  if (last == null || changePct == null) throw new NseFeedError();
  return quoteCard({
    symbol: printed,
    last,
    changePct,
    asOf:
      typeof stock?.latestTimestamp === "string" ? stock.latestTimestamp : null,
  });
}

async function indexFrom(
  indexName: string,
  fetchImpl: FetchLike,
): Promise<NseCard> {
  const body = await callTool(
    NSE_LIVE_URL,
    "cm_get_index_quote",
    { indexName },
    fetchImpl,
  );
  const index = record(body.index);
  const last = num(index?.last);
  const changePct = num(index?.percChange);
  if (last == null || changePct == null) throw new NseFeedError();
  const asOf =
    typeof body.nseTimestamp === "string"
      ? body.nseTimestamp
      : typeof index?.timeVal === "string"
        ? index.timeVal
        : null;
  return indexCard({ indexName, last, changePct, asOf });
}

async function statusFrom(fetchImpl: FetchLike): Promise<NseCard> {
  const body = await callTool(
    NSE_LIVE_URL,
    "cm_get_data_status",
    {},
    fetchImpl,
  );
  const indices = record(body.indices);
  const gainers = record(indices?.gainers);
  const lastCrawled =
    typeof gainers?.lastCrawled === "string" ? gainers.lastCrawled : null;
  return statusCard({ open: readOpen(body), lastCrawled });
}

async function indexCloseFrom(
  indexName: string,
  date: string,
  fetchImpl: FetchLike,
): Promise<NseCard> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new NseFeedError(NSE_EOD_FAILED);
  const body = await callTool(
    NSE_EOD_URL,
    "get_index_snapshot",
    { date, filter: indexName },
    fetchImpl,
    NSE_EOD_FAILED,
  );
  const indices = Array.isArray(body.indices) ? body.indices : null;
  if (!indices) throw new NseFeedError(NSE_EOD_FAILED);
  const hits = indices
    .map((item) => record(item))
    .filter((row): row is Record<string, unknown> => row != null)
    .filter((row) => sameIndex(str(row.indexName), indexName));
  const row = hits.find((item) => str(item.date) === str(body.date)) ?? hits[0];
  if (!row) throw new NseFeedError(NSE_INDEX_MISSING);
  const last = num(row.close);
  const changePct = num(row.pctChange);
  const asOf = str(row.date) ?? str(body.date);
  if (last == null || changePct == null || !asOf)
    throw new NseFeedError(NSE_EOD_FAILED);
  return indexCloseCard({ indexName, last, changePct, date: asOf });
}

async function actionsFrom(
  symbol: string,
  scope: "all" | "capital",
  fetchImpl: FetchLike,
): Promise<NseCard> {
  const printed = ticker(symbol);
  if (!printed) throw new NseFeedError(NSE_EOD_FAILED);
  const span = actionWindow();
  const body = await callTool(
    NSE_EOD_URL,
    "get_corporate_actions",
    { symbol: printed, ...span },
    fetchImpl,
    NSE_EOD_FAILED,
  );
  if (typeof body.error === "string" && body.error.trim())
    throw new NseFeedError(NSE_EOD_FAILED);
  const actions = readActions(body.actions);
  if (!actions) throw new NseFeedError(NSE_EOD_FAILED);
  const reported = num(body.count);
  if (actions.length === 0 && reported != null && reported > 0)
    throw new NseFeedError(NSE_EOD_FAILED);
  const from = str(body.from) ?? span.fromDate;
  const to = str(body.to) ?? span.toDate;
  return corporateActionCard({
    symbol: ticker(body.symbol) ?? printed,
    scope,
    from,
    to,
    count: reported ?? actions.length,
    actions,
    incomplete:
      (typeof body.warning === "string" && body.warning.trim().length > 0) ||
      (reported != null && reported > actions.length),
  });
}

async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: FetchLike,
  failure = NSE_FEED_FAILED,
): Promise<Record<string, unknown>> {
  const session = await openSession(url, fetchImpl, failure);
  const message = await post(
    url,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    session,
    fetchImpl,
    failure,
  );
  const rpc = parseRpc(message.text);
  const text = rpc?.result?.content?.find((part) => part.type === "text")?.text;
  if (!rpc || rpc.error || rpc.result?.isError || typeof text !== "string") {
    log.warn({ tool: name, status: message.status }, "nse mcp call failed");
    throw new NseFeedError(failure);
  }
  const parsed = parseObject(text);
  if (!parsed) {
    log.warn({ tool: name, status: message.status }, "nse mcp call failed");
    throw new NseFeedError(failure);
  }
  return parsed;
}

async function openSession(
  url: string,
  fetchImpl: FetchLike,
  failure: string,
): Promise<string> {
  const opened = await post(
    url,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "finn", version: "0.1.0" },
      },
    },
    null,
    fetchImpl,
    failure,
  );
  const session = opened.session;
  const rpc = parseRpc(opened.text);
  if (!session || !rpc || rpc.error) throw new NseFeedError(failure);
  await post(
    url,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    session,
    fetchImpl,
    failure,
  ).catch(() => undefined);
  return session;
}

async function post(
  url: string,
  body: unknown,
  session: string | null,
  fetchImpl: FetchLike,
  failure: string,
): Promise<{ status: number; session: string | null; text: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (session) headers["Mcp-Session-Id"] = session;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NseFeedError(failure);
  }
  const text = await res.text();
  if (res.status >= 400) throw new NseFeedError(failure);
  return {
    status: res.status,
    session: res.headers.get("mcp-session-id") ?? session,
    text,
  };
}

function parseRpc(text: string): RpcMessage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .at(-1);
  if (!jsonText) return null;
  try {
    const value = JSON.parse(jsonText) as RpcMessage;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return record(value);
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function ticker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9&.-]{1,20}$/.test(symbol) ? symbol : null;
}

/** Only an explicit boolean or the words Open/Closed. No other prose. */
function readOpen(body: Record<string, unknown>): "open" | "closed" | null {
  for (const key of ["marketOpen", "isMarketOpen", "isOpen"]) {
    if (typeof body[key] === "boolean") return body[key] ? "open" : "closed";
  }
  if (body.marketStatus === "Open" || body.marketStatus === "open")
    return "open";
  if (body.marketStatus === "Closed" || body.marketStatus === "closed")
    return "closed";
  return null;
}

function move(pct: number): string {
  const body = groupIndian(Math.abs(pct), 2);
  if (pct > 0) return `up ${body}%`;
  if (pct < 0) return `down ${body}%`;
  return "unchanged";
}

function sourceNote(when: string | null): string {
  return when ? `NSE · ${when}` : "NSE";
}

export function dateKeyLabel(raw: string | null): string | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!iso) return null;
  const month = MONTHS[Number(iso[2]) - 1];
  if (!month) return null;
  return `${iso[3]} ${month} ${iso[1]}`;
}

export function stampLabel(raw: string | null): string | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(raw);
  if (iso) {
    const month = MONTHS[Number(iso[2]) - 1];
    if (!month) return null;
    return `${iso[3]} ${month} ${iso[1]} ${iso[4]}:${iso[5]}`;
  }
  const dmy = /^(\d{2})-([A-Za-z]{3})-(\d{4})[ T](\d{2}):(\d{2})/.exec(raw);
  if (!dmy?.[2]) return null;
  const month =
    dmy[2].slice(0, 1).toUpperCase() + dmy[2].slice(1, 3).toLowerCase();
  if (!(MONTHS as readonly string[]).includes(month)) return null;
  return `${dmy[1]} ${month} ${dmy[3]} ${dmy[4]}:${dmy[5]}`;
}

function shiftYears(dateKey: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m?.[1] || !m[2] || !m[3]) return dateKey;
  const y = Number(m[1]) + years;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const d = Math.min(day, last);
  return `${String(y).padStart(4, "0")}-${m[2]}-${String(d).padStart(2, "0")}`;
}

function pickActions(
  actions: ActionRow[],
  scope: "all" | "capital",
): ActionRow[] {
  const sorted = [...actions].sort((a, b) => b.exDate.localeCompare(a.exDate));
  if (scope === "capital") {
    return sorted
      .filter((row) => row.actionType === "SPLIT" || row.actionType === "BONUS")
      .slice(0, 3);
  }
  const seen = new Set<string>();
  const picked: ActionRow[] = [];
  for (const row of sorted) {
    const key = row.actionType || "OTHER";
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(row);
    if (picked.length === 3) break;
  }
  return picked.sort((a, b) => b.exDate.localeCompare(a.exDate));
}

function actionClause(row: ActionRow, later: boolean): string {
  const when = dateKeyLabel(row.exDate) ?? row.exDate;
  let what = actionLabel(row);
  if (later) what = what.charAt(0).toUpperCase() + what.slice(1);
  return `${what}, ex-date ${when}`;
}

function actionLabel(row: ActionRow): string {
  if (row.actionType === "DIVIDEND") {
    const amount = dividendAmount(row.purpose);
    if (amount != null) {
      const decimals = Number.isInteger(amount) ? 0 : 2;
      return `dividend ${formatInr(amount, { decimals })} a share`;
    }
  }
  const purpose = row.purpose.trim().replace(/\s+/g, " ");
  if (purpose && purpose.length <= 48) return purpose;
  const type = row.actionType.trim().toLowerCase();
  if (type && type !== "other") return type;
  return "corporate action";
}

function dividendAmount(purpose: string): number | null {
  const m = /rs\.?\s*([0-9]+(?:\.[0-9]+)?)\s*per\s+share/i.exec(purpose);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function actionNote(
  count: number,
  incomplete: boolean,
  scope: "all" | "capital",
): string {
  if (scope === "capital")
    return incomplete ? "NSE · list may be incomplete" : "NSE";
  if (incomplete && count > 1)
    return `NSE · ${count} actions · list may be incomplete`;
  if (incomplete) return "NSE · list may be incomplete";
  if (count > 1) return `NSE · ${count} actions`;
  return "NSE";
}

function rangeLabel(from: string, to: string): string | null {
  const a = dateKeyLabel(from);
  const b = dateKeyLabel(to);
  if (!a || !b) return null;
  return `${a} to ${b}`;
}

function readActions(value: unknown): ActionRow[] | null {
  if (!Array.isArray(value)) return null;
  const out: ActionRow[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row) continue;
    const exDate = str(row.exDate);
    const actionType = (str(row.actionType) ?? "").toUpperCase();
    const purpose = str(row.purpose) ?? "";
    if (!exDate || !/^\d{4}-\d{2}-\d{2}$/.test(exDate)) continue;
    out.push({ exDate, actionType, purpose });
  }
  return out;
}

function sameIndex(a: string | null, b: string): boolean {
  if (!a) return false;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function crawlLabel(raw: string | null): string | null {
  if (!raw) return null;
  const ms = raw.replace(/(\.\d{3})\d+Z$/, "$1Z");
  const t = Date.parse(ms);
  if (!Number.isFinite(t)) return null;
  return `${formatIst(t)} IST`;
}
