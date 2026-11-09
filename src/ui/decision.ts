/**
 * One decision per filing. The chip answers "do I need to do anything?"
 * The sentence is built from the category, the one-liner, the results
 * headline deltas, and the ledger counts. No model call.
 *
 *   Act    — a missed or cut promise, a management change, or a price /
 *            volume rule the investor set
 *   Watch  — results filed, open promises, or a large move under that rule
 *   Nothing — neither. Tier 3 stays a count in the fold, not a card.
 */
import type { ResultsCard } from "@/engine/types";
import { formatRatio } from "@/lib/format";
import {
  EMPTY_LEDGER,
  type LedgerCounts,
  tallyLedger,
} from "@/lib/ledger-counts";
import type { EventCard, ManagementChangeCard } from "./model";
import { type PersonChange, peopleOf } from "./people";
import { gridRows } from "./ResultsGrid";

export type Decision = "act" | "watch" | "nothing";

export type { LedgerCounts };
export { EMPTY_LEDGER, tallyLedger };

export const DECISION_WORD: Record<Decision, string> = {
  act: "Act",
  watch: "Watch",
  nothing: "Nothing",
};

const COUNT_WORD = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
];

/** A move that is real but has not crossed the investor's own line. */
const LARGE_PCT = 3;
const LARGE_VOL = 1.5;

export interface MoveFact {
  pct: number | null;
  volumeRatio: number | null;
  /** true when price or volume crossed the investor's rule */
  ruleHit: boolean;
}

export interface Judgement {
  decision: Decision;
  sentence: string;
}

export function decisionRank(d: Decision): number {
  if (d === "act") return 0;
  if (d === "watch") return 1;
  return 2;
}

export function editionHeadline(n: number): string {
  if (n <= 0) return "Nothing to decide.";
  return `${n} ${n === 1 ? "decision" : "decisions"}.`;
}

export function tallyByIsin(
  rows: Array<{
    isin: string;
    verdict: string | null;
    status: string;
    n: number;
  }>,
): Map<string, LedgerCounts> {
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = grouped.get(r.isin) ?? [];
    list.push(r);
    grouped.set(r.isin, list);
  }
  const out = new Map<string, LedgerCounts>();
  for (const [isin, list] of grouped) out.set(isin, tallyLedger(list));
  return out;
}

/** "28.6" → "29" once the move is in double digits; "9.84" → "9.8". */
export function spokenPct(pct: number): string {
  const n = Math.abs(pct);
  const rounded = n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function countWord(n: number): string {
  return COUNT_WORD[n] ?? String(n);
}

const TRAIL = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "for",
  "and",
  "or",
  "in",
  "on",
  "with",
  "by",
  "its",
]);

function finish(words: string[]): string {
  const out = [...words];
  while (
    out.length > 4 &&
    TRAIL.has((out[out.length - 1] ?? "").toLowerCase().replace(/[^a-z]/g, ""))
  ) {
    out.pop();
  }
  return `${out.join(" ")}.`;
}

/**
 * First sentence. Initials ("J.P.") and "Rs." are not a sentence end.
 * Past 20 words, drop a trailing "for / with / including …" clause.
 */
export function oneFact(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return "A filing.";
  t = t
    .replace(
      /^in furtherance to (?:our |the )?earlier intimation dated [^,.]+[,.]?\s*/i,
      "",
    )
    .replace(/^(?:and )?pursuant to (?:regulation|reg\.?)[^,.]+[,.]?\s*/i, "")
    .replace(/\b(Private|Pvt\.?)\s+Limited\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!t || t.split(" ").length < 4) return "Follow-up on an earlier filing.";
  const dot = "‹dot›";
  const masked = t
    .replace(/\b([A-Z])\./g, `$1${dot}`)
    .replace(/\b(Rs|Mr|Ms|Mrs|Dr|Sr|Jr|No|Ltd|Pvt|Inc|vs)\./gi, `$1${dot}`);
  const first = (masked.split(/(?<=[.!?])\s+/)[0] ?? masked)
    .replaceAll(dot, ".")
    .replace(/[.!?]+$/, "")
    .trim();
  const words = first.split(" ").filter(Boolean);
  if (words.length <= 20) return finish(words);
  const breakAt = first.search(
    /\s+(for|with|including|pursuant|effective|w\.e\.f\.?)\s+/i,
  );
  if (breakAt >= 24) {
    const left = first.slice(0, breakAt).split(" ").filter(Boolean);
    if (left.length >= 6) return finish(left);
  }
  return finish(words.slice(0, 16));
}

function promiseClause(L: LedgerCounts): string {
  if (L.missed > 0 || L.cut > 0) {
    const missed =
      L.missed === 1
        ? "A promise was missed"
        : L.missed > 1
          ? `${countWord(L.missed)} promises missed`
          : "";
    const cut =
      L.cut === 1
        ? "a promise was cut"
        : L.cut > 1
          ? `${countWord(L.cut).toLowerCase()} promises cut`
          : "";
    if (missed && cut) {
      const tail = L.cut === 1 ? "one was cut" : cut;
      return `${missed} and ${tail}.`;
    }
    if (missed) return `${missed}.`;
    return `${cut.charAt(0).toUpperCase()}${cut.slice(1)}.`;
  }
  if (L.rows === 0) return "No promise on the ledger.";
  return "No promise broken.";
}

function isResults(c: unknown): c is ResultsCard {
  return Boolean(
    c &&
      typeof c === "object" &&
      (Array.isArray((c as ResultsCard).rows) ||
        Array.isArray((c as ResultsCard).headline)),
  );
}

const PREFER = [
  "revenue",
  "total_income",
  "nii",
  "ebitda",
  "ppop",
  "pbt",
  "pat",
];

function resultsFact(event: EventCard): string {
  if (!isResults(event.card)) return "Results are in.";
  const rows = gridRows(event.card);
  const row =
    PREFER.map((m) =>
      rows.find((r) => r.metric === m && r.yoyPct != null),
    ).find((r) => r) ??
    rows.find((r) => r.yoyPct != null) ??
    rows.find((r) => r.qoqPct != null);
  if (!row) return "Results are in.";
  if (row.yoyPct != null && Math.abs(row.yoyPct) >= 0.05) {
    const dir = row.yoyPct < 0 ? "down" : "up";
    return `${row.label} ${dir} ${spokenPct(row.yoyPct)}% year on year.`;
  }
  if (row.yoyPct != null) return `${row.label} was flat year on year.`;
  if (row.qoqPct != null && Math.abs(row.qoqPct) >= 0.05) {
    const dir = row.qoqPct < 0 ? "down" : "up";
    return `${row.label} ${dir} ${spokenPct(row.qoqPct)}% on the quarter.`;
  }
  return "Results are in.";
}

function plainName(person: string): string {
  return person
    .replace(/^(Mr|Ms|Mrs|Miss|Dr|Shri|Smt|Prof|CA)\.?\s+/i, "")
    .trim();
}

function usableName(person: string): boolean {
  const n = plainName(person);
  if (n.length < 2) return false;
  return !/not extracted|unknown|^[—–-]+$/i.test(n);
}

export function shortRole(role: string): string {
  const r = role.replace(/\s+/g, " ").trim();
  if (
    (/managing director/i.test(r) || /\bmd\b/i.test(r)) &&
    (/chief executive/i.test(r) || /\bceo\b/i.test(r))
  )
    return "MD";
  if (/managing director/i.test(r) || /\bmd\b/i.test(r)) return "MD";
  if (/chief executive/i.test(r) || /\bceo\b/i.test(r)) return "CEO";
  if (/chief financial/i.test(r) || /\bcfo\b/i.test(r)) return "CFO";
  if (/chief operating/i.test(r) || /\bcoo\b/i.test(r)) return "COO";
  if (/information security|\bciso\b/i.test(r)) return "CISO";
  if (/company secretary/i.test(r)) return "company secretary";
  if (/chair/i.test(r)) return "chair";
  if (/auditor/i.test(r)) return "auditor";
  if (/independent director/i.test(r)) return "independent director";
  if (/whole[- ]time/i.test(r)) return "whole-time director";
  if (/director/i.test(r)) return "director";
  const words = r.split(" ");
  return words.length > 3 ? words.slice(0, 3).join(" ") : r;
}

function isDeparture(action: string | null): boolean {
  return /resign|retir|ceas|demise|vacat/.test(action ?? "");
}

function isArrival(action: string | null): boolean {
  return /appoint|redesignat|elevat/.test(action ?? "");
}

function beat(p: PersonChange): string {
  const name = plainName(p.person);
  const role = p.role ? shortRole(p.role) : null;
  const action = (p.action ?? "").toLowerCase();
  if (/re-?appoint/.test(action))
    return role ? `${name} returns as ${role}.` : `${name} returns.`;
  if (isDeparture(action))
    return role ? `${name} leaves as ${role}.` : `${name} is leaving.`;
  if (isArrival(action))
    return role ? `${name} becomes ${role}.` : `${name} joins.`;
  return role ? `${name}, ${role}.` : `${name} is named.`;
}

function profileClause(p: PersonChange): string {
  if (!p.excerpt || p.excerpt.trim().length < 40)
    return "The filing names the role.";
  if (/^(mrs|ms|smt|miss)\.?\s/i.test(p.person))
    return "The filing has her profile.";
  if (/^(mr|shri)\.?\s/i.test(p.person)) return "The filing has his profile.";
  return "The filing has the profile.";
}

function asMgmt(c: unknown): ManagementChangeCard | null {
  if (!c || typeof c !== "object") return null;
  const o = c as ManagementChangeCard & {
    changes?: unknown;
    people?: unknown;
  };
  if (typeof o.person === "string") return o;
  if (Array.isArray(o.changes) || Array.isArray(o.people)) {
    return {
      ...o,
      person: typeof o.person === "string" ? o.person : "",
      role: typeof o.role === "string" ? o.role : "",
      action: typeof o.action === "string" ? o.action : "",
      effective_date: o.effective_date ?? null,
      reason: o.reason ?? null,
      brief_profile_excerpt: o.brief_profile_excerpt ?? null,
      prior_roles: o.prior_roles ?? [],
      confidence: o.confidence ?? "low",
    };
  }
  return null;
}

function weight(p: PersonChange): number {
  const role = (p.role ?? "").toLowerCase();
  let s = 0;
  if (/chair|managing director|\bmd\b|chief executive|\bceo\b/.test(role))
    s += 4;
  if (/chief financial|\bcfo\b|chief operating|\bcoo\b/.test(role)) s += 3;
  if (isDeparture(p.action)) s += 2;
  if (isArrival(p.action)) s += 1;
  return s;
}

function managementSentence(event: EventCard): string {
  const card = asMgmt(event.card);
  const people = card ? peopleOf(card).filter((p) => usableName(p.person)) : [];
  if (!people.length) {
    const fact = oneFact(event.oneLiner || event.title);
    if (/not extracted/i.test(fact))
      return "A management change. The filing has the names.";
    return `${fact} The filing has the names.`;
  }
  const leaving = people.filter((p) => isDeparture(p.action));
  const arriving = people.filter(
    (p) => isArrival(p.action) && !isDeparture(p.action),
  );
  if (people.length === 2 && leaving.length === 1 && arriving.length === 1) {
    const left = leaving[0];
    const right = arriving[0];
    if (left && right) return `${beat(left)} ${beat(right)}`;
  }
  let main = people[0] as PersonChange;
  let best = weight(main);
  for (const p of people.slice(1)) {
    const w = weight(p);
    if (w > best) {
      main = p;
      best = w;
    }
  }
  if ((main.excerpt?.trim().length ?? 0) >= 40)
    return `${beat(main)} ${profileClause(main)}`;
  if (people.length > 1) return `${beat(main)} The filing has the rest.`;
  return `${beat(main)} ${profileClause(main)}`;
}

const HIDDEN_KEY = /^_|^(verbatim|currency|unit|version)$/;

/** True when the card has a grid, a quote, a bio, or a figure worth opening. */
export function hasFigures(event: EventCard): boolean {
  const c = event.card;
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  const o = c as Record<string, unknown>;
  if (Array.isArray(o.rows) || Array.isArray(o.headline)) return true;
  if (
    typeof o.person === "string" ||
    Array.isArray(o.changes) ||
    Array.isArray(o.people)
  )
    return true;
  return Object.entries(o).some(([k, v]) => {
    if (HIDDEN_KEY.test(k)) return false;
    if (v == null || v === "") return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
}

function openClause(L: LedgerCounts): string {
  return L.open === 1 ? "One promise still open." : "Promises still open.";
}

/**
 * Chip and sentence for a filing. A missed or cut promise counts only on
 * the results that settle it. Open promises lift any other filing to Watch.
 */
export function judgeEvent(
  event: EventCard,
  ledger?: LedgerCounts | null,
): Judgement {
  const L = ledger ?? EMPTY_LEDGER;
  const broken = L.missed > 0 || L.cut > 0;
  let decision: Decision;
  if (event.category === "results" && broken) decision = "act";
  else if (event.category === "management_change") decision = "act";
  else if (event.category === "results" || L.open > 0) decision = "watch";
  else decision = "nothing";

  let sentence: string;
  if (event.category === "results")
    sentence = `${resultsFact(event)} ${promiseClause(L)}`;
  else if (event.category === "management_change")
    sentence = managementSentence(event);
  else if (decision === "watch" && L.open > 0)
    sentence = `${oneFact(event.oneLiner || event.title)} ${openClause(L)}`;
  else sentence = oneFact(event.oneLiner || event.title);

  return { decision, sentence };
}

function moveBeat(m: MoveFact): string {
  const volOk = m.volumeRatio != null && m.volumeRatio >= 1.05;
  if (m.pct != null && Math.abs(m.pct) >= 0.05) {
    const dir = m.pct < 0 ? "Down" : "Up";
    const on = volOk ? ` on ${formatRatio(m.volumeRatio)} volume` : "";
    return `${dir} ${spokenPct(m.pct)}%${on}.`;
  }
  if (volOk) return `Volume ${formatRatio(m.volumeRatio)} the usual.`;
  return "A price rule fired.";
}

function isLarge(m: MoveFact): boolean {
  if (m.pct != null && Math.abs(m.pct) >= LARGE_PCT) return true;
  return m.volumeRatio != null && m.volumeRatio >= LARGE_VOL;
}

/**
 * A rule hit becomes its own card when price crossed the investor's line,
 * or volume is unmistakable (5×). A graze stays a count, not a card.
 */
export function showAsMoveCard(m: MoveFact, pricePct: number): boolean {
  if (!m.ruleHit) return isLarge(m);
  if (Math.abs(m.pct ?? 0) >= pricePct) return true;
  return (m.volumeRatio ?? 0) >= 5;
}

/** A session move. A rule hit is Act. A large move under the line is Watch. */
export function judgeMove(m: MoveFact): Judgement {
  const beatText = moveBeat(m);
  if (m.ruleHit)
    return { decision: "act", sentence: `${beatText} You asked to be told.` };
  if (isLarge(m))
    return { decision: "watch", sentence: `${beatText} Under your line.` };
  return { decision: "nothing", sentence: beatText };
}
