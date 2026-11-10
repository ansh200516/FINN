/**
 * The chat the user can still see after a refresh or a trip to Brief.
 * One demo user, so one localStorage key. The greeting is not stored.
 * finn-chat-v2 starts empty: finnie.chat.v1 is never read.
 */
import type { ResultsCard } from "@/engine/types";
import type { CompanyReply } from "@/lib/companyTurn";
import { clipQuarterWall } from "@/lib/finnieSay";
import {
  type ChatQuarter,
  type ChatQuarterMetric,
  FINNIE_CHAIN_CAP,
  FINNIE_LOG_CAP,
  type FinnieCard,
  type FinnieLine,
  type FinnieMemory,
  type FinniePerson,
} from "@/lib/finnieTypes";

export const CHAT_LOG_KEY = "finn-chat-v2";

const QUESTION_CAP = 500;
const SAY_CAP = 4_000;

export interface ChatLogTurn {
  id: number;
  question: string;
  say: string;
  cards: FinnieCard[];
  pages: Array<string | null>;
  links: Array<{ href: string; label: string }>;
  href: string | null;
  link: string | null;
  sayAfter: boolean;
}

export function loadChatLog(storage: Pick<Storage, "getItem">): ChatLogTurn[] {
  try {
    const raw = storage.getItem(CHAT_LOG_KEY);
    if (!raw) return [];
    return capLog(parseTurns(JSON.parse(raw)));
  } catch {
    return [];
  }
}

export function saveChatLog(
  storage: Pick<Storage, "setItem">,
  turns: ChatLogTurn[],
): void {
  try {
    storage.setItem(CHAT_LOG_KEY, JSON.stringify({ turns: capLog(turns) }));
  } catch {
    // a full disk should not drop the reply already on screen
  }
}

export function clearChatLog(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(CHAT_LOG_KEY);
  } catch {
    // clearing is local; the greeting is already on screen
  }
}

/** Last eight turns for the model. Older results cards still count. */
export function chainFromLog(turns: ChatLogTurn[]): FinnieMemory[] {
  const older = turns
    .slice(0, Math.max(0, turns.length - FINNIE_CHAIN_CAP))
    .flatMap((turn) => resultsShown(turn.cards));
  const recent = turns.slice(-FINNIE_CHAIN_CAP);
  const chain: FinnieMemory[] = [];
  recent.forEach((turn, index) => {
    const own = resultsShown(turn.cards);
    const results =
      index === recent.length - 1 ? unique(own.concat(older)) : own;
    const user = clip(turn.question, QUESTION_CAP);
    const say = clip(clipQuarterWall(turn.say), 800);
    if (!user && !say) return;
    chain.push({ user, say, results });
  });
  return chain;
}

export function resultsShown(cards: FinnieCard[]): string[] {
  const out: string[] = [];
  for (const card of cards) {
    if (card.kind !== "reply" || card.reply.kind !== "results") continue;
    const symbol = card.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)) continue;
    if (!out.includes(symbol)) out.push(symbol);
  }
  return out;
}

function capLog(turns: ChatLogTurn[]): ChatLogTurn[] {
  return turns.slice(-FINNIE_LOG_CAP);
}

function parseTurns(value: unknown): ChatLogTurn[] {
  const list = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { turns?: unknown }).turns)
      ? (value as { turns: unknown[] }).turns
      : [];
  const out: ChatLogTurn[] = [];
  for (const item of list) {
    const turn = parseTurn(item);
    if (turn) out.push(turn);
  }
  return out;
}

function parseTurn(value: unknown): ChatLogTurn | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "number" || !Number.isInteger(rec.id) || rec.id < 1)
    return null;
  if (typeof rec.question !== "string" || !rec.question.trim()) return null;
  if (typeof rec.say !== "string") return null;
  const { cards, pages } = parseCards(rec.cards, rec.pages);
  return {
    id: rec.id,
    question: clip(rec.question, QUESTION_CAP),
    say: clip(clipQuarterWall(rec.say), SAY_CAP),
    cards,
    pages,
    links: parseLinks(rec.links),
    href: pageOrNull(rec.href),
    link: typeof rec.link === "string" ? rec.link.slice(0, 80) : null,
    sayAfter: rec.sayAfter === true,
  };
}

function parseCards(
  cardsValue: unknown,
  pagesValue: unknown,
): { cards: FinnieCard[]; pages: Array<string | null> } {
  if (!Array.isArray(cardsValue)) return { cards: [], pages: [] };
  const pagesIn = Array.isArray(pagesValue) ? pagesValue : [];
  const cards: FinnieCard[] = [];
  const pages: Array<string | null> = [];
  for (let i = 0; i < cardsValue.length && cards.length < 8; i++) {
    const card = parseCard(cardsValue[i]);
    if (!card) continue;
    cards.push(card);
    pages.push(pageOrNull(pagesIn[i]));
  }
  return { cards, pages };
}

function parseCard(value: unknown): FinnieCard | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.kind === "portfolio" && Array.isArray(rec.names)) {
    const names = rec.names.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const name = row as {
        symbol?: unknown;
        name?: unknown;
        aliases?: unknown;
      };
      if (typeof name.symbol !== "string" || typeof name.name !== "string")
        return [];
      const aliases = Array.isArray(name.aliases)
        ? name.aliases.filter(
            (alias): alias is string => typeof alias === "string",
          )
        : [];
      return [{ symbol: name.symbol, name: name.name, aliases }];
    });
    return { kind: "portfolio", names };
  }
  if (rec.kind === "lines" && Array.isArray(rec.lines)) {
    const lines: FinnieLine[] = [];
    for (const row of rec.lines) {
      if (!row || typeof row !== "object") continue;
      const line = row as { symbol?: unknown; text?: unknown; href?: unknown };
      if (
        typeof line.symbol !== "string" ||
        typeof line.text !== "string" ||
        typeof line.href !== "string"
      )
        continue;
      lines.push({ symbol: line.symbol, text: line.text, href: line.href });
    }
    return { kind: "lines", lines };
  }
  if (
    rec.kind === "management" &&
    typeof rec.symbol === "string" &&
    Array.isArray(rec.people)
  ) {
    const people: FinniePerson[] = [];
    for (const row of rec.people) {
      if (!row || typeof row !== "object") continue;
      const person = row as {
        person?: unknown;
        role?: unknown;
        action?: unknown;
        excerpt?: unknown;
        priorRoles?: unknown;
      };
      if (typeof person.person !== "string") continue;
      const prior = person.priorRoles;
      people.push({
        person: person.person,
        role: typeof person.role === "string" ? person.role : null,
        action: typeof person.action === "string" ? person.action : null,
        excerpt: typeof person.excerpt === "string" ? person.excerpt : null,
        priorRoles: Array.isArray(prior)
          ? prior.filter((role): role is string => typeof role === "string")
          : [],
      });
    }
    return { kind: "management", symbol: rec.symbol, people };
  }
  if (rec.kind !== "reply" || typeof rec.symbol !== "string") return null;
  const card = parseReply(rec.symbol, rec.reply);
  if (!card || card.kind !== "reply") return card;
  const quarters = parseQuarters(rec.quarters);
  const periodCards = parsePeriodCards(rec.periodCards);
  if (!quarters.length && !periodCards.length) return card;
  return {
    ...card,
    ...(quarters.length ? { quarters } : {}),
    ...(periodCards.length ? { periodCards } : {}),
  };
}

function parsePeriodCards(value: unknown): ResultsCard[] {
  if (!Array.isArray(value)) return [];
  const out: ResultsCard[] = [];
  for (const item of value) {
    if (!isResultsCard(item)) continue;
    out.push(item);
    if (out.length >= 8) break;
  }
  return out;
}

function parseQuarters(value: unknown): ChatQuarter[] {
  if (!Array.isArray(value)) return [];
  const out: ChatQuarter[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as {
      period?: unknown;
      revenue?: unknown;
      ebitda?: unknown;
      pbt?: unknown;
      pat?: unknown;
    };
    if (typeof rec.period !== "string" || !rec.period.trim()) continue;
    out.push({
      period: rec.period.slice(0, 24),
      revenue: parseMetric(rec.revenue),
      ebitda: parseMetric(rec.ebitda),
      pbt: parseMetric(rec.pbt),
      pat: parseMetric(rec.pat),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function parseMetric(value: unknown): ChatQuarterMetric | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as {
    label?: unknown;
    crore?: unknown;
    qoqPct?: unknown;
    yoyPct?: unknown;
  };
  if (typeof rec.label !== "string") return null;
  return {
    label: rec.label.slice(0, 40),
    crore: typeof rec.crore === "number" ? rec.crore : null,
    qoqPct: typeof rec.qoqPct === "number" ? rec.qoqPct : null,
    yoyPct: typeof rec.yoyPct === "number" ? rec.yoyPct : null,
  };
}

function parseReply(symbol: string, value: unknown): FinnieCard | null {
  if (!value || typeof value !== "object") return null;
  const reply = value as { kind?: unknown; card?: unknown; rows?: unknown };
  if (reply.kind === "results") {
    if (reply.card == null)
      return { kind: "reply", symbol, reply: { kind: "results", card: null } };
    if (!isResultsCard(reply.card)) return null;
    return {
      kind: "reply",
      symbol,
      reply: { kind: "results", card: reply.card },
    };
  }
  if (reply.kind === "promises" && Array.isArray(reply.rows)) {
    const rows = reply.rows.filter((row) => row && typeof row === "object");
    return {
      kind: "reply",
      symbol,
      reply: { kind: "promises", rows } as CompanyReply & { kind: "promises" },
    };
  }
  return null;
}

function isResultsCard(value: unknown): value is ResultsCard {
  if (!value || typeof value !== "object") return false;
  const card = value as { rows?: unknown; basis?: unknown };
  return (
    Array.isArray(card.rows) &&
    (card.basis === "consolidated" || card.basis === "standalone")
  );
}

function parseLinks(value: unknown): Array<{ href: string; label: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ href: string; label: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { href?: unknown; label?: unknown };
    if (typeof rec.href !== "string" || typeof rec.label !== "string") continue;
    const href = pageOrNull(rec.href);
    if (!href) continue;
    out.push({ href, label: rec.label.slice(0, 80) });
    if (out.length >= 5) break;
  }
  return out;
}

function pageOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/")) return null;
  return value.slice(0, 240);
}

function unique(symbols: string[]): string[] {
  const out: string[] = [];
  for (const symbol of symbols) {
    if (!out.includes(symbol)) out.push(symbol);
  }
  return out;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max);
}
