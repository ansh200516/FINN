/**
 * NSE's own MCP, called with fetch. No SDK and no API key.
 *
 * The exchange documents both servers at https://www.nseindia.com/nse-mcp :
 *   bhavcopy  https://mcp.nseindia.in/bhavcopy/cm/mcp   (end of day)
 *   cm-market https://mcp.nseindia.in/cmmkt/mcp         (1–3 min delay)
 *
 * Live cards use cm-market. Tool names are the ones that server lists:
 * cm_get_stock_quote, cm_get_index_quote, cm_get_data_status.
 * That server does not publish an open/closed flag or announcements.
 * Quotes are not cached. A text body that is not JSON is refused.
 */
import { formatInr, groupIndian } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { LiveAsk } from "@/lib/nseLive";
import { formatIst } from "@/lib/time";

export const NSE_MCP_PAGE = "https://www.nseindia.com/nse-mcp";
export const NSE_LIVE_URL = "https://mcp.nseindia.in/cmmkt/mcp";
export const NSE_FEED_FAILED = "NSE's live feed did not answer.";

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
  constructor() {
    super(NSE_FEED_FAILED);
    this.name = "NseFeedError";
  }
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

export async function answerNse(
  ask: ResolvedLive,
  fetchImpl: FetchLike = fetch,
): Promise<NseCard> {
  if (ask.kind === "quote") return quoteFrom(ask.symbol, fetchImpl);
  if (ask.kind === "index") return indexFrom(ask.indexName, fetchImpl);
  return statusFrom(fetchImpl);
}

async function quoteFrom(
  symbol: string,
  fetchImpl: FetchLike,
): Promise<NseCard> {
  const body = await callTool("cm_get_stock_quote", { symbol }, fetchImpl);
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
  const body = await callTool("cm_get_index_quote", { indexName }, fetchImpl);
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
  const body = await callTool("cm_get_data_status", {}, fetchImpl);
  const indices = record(body.indices);
  const gainers = record(indices?.gainers);
  const lastCrawled =
    typeof gainers?.lastCrawled === "string" ? gainers.lastCrawled : null;
  return statusCard({ open: readOpen(body), lastCrawled });
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<Record<string, unknown>> {
  const session = await openSession(fetchImpl);
  const message = await post(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    session,
    fetchImpl,
  );
  const rpc = parseRpc(message.text);
  const text = rpc?.result?.content?.find((part) => part.type === "text")?.text;
  if (!rpc || rpc.error || rpc.result?.isError || typeof text !== "string") {
    log.warn({ tool: name, status: message.status }, "nse live call failed");
    throw new NseFeedError();
  }
  const parsed = parseObject(text);
  if (!parsed) {
    log.warn({ tool: name, status: message.status }, "nse live call failed");
    throw new NseFeedError();
  }
  return parsed;
}

async function openSession(fetchImpl: FetchLike): Promise<string> {
  const opened = await post(
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
  );
  const session = opened.session;
  const rpc = parseRpc(opened.text);
  if (!session || !rpc || rpc.error) throw new NseFeedError();
  await post(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    session,
    fetchImpl,
  ).catch(() => undefined);
  return session;
}

async function post(
  body: unknown,
  session: string | null,
  fetchImpl: FetchLike,
): Promise<{ status: number; session: string | null; text: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (session) headers["Mcp-Session-Id"] = session;
  let res: Response;
  try {
    res = await fetchImpl(NSE_LIVE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NseFeedError();
  }
  const text = await res.text();
  if (res.status >= 400) throw new NseFeedError();
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

export function crawlLabel(raw: string | null): string | null {
  if (!raw) return null;
  const ms = raw.replace(/(\.\d{3})\d+Z$/, "$1Z");
  const t = Date.parse(ms);
  if (!Number.isFinite(t)) return null;
  return `${formatIst(t)} IST`;
}
