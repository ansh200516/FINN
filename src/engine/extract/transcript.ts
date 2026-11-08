/**
 * Concall transcript structure (owner: Builder C). Pure — no I/O, no LLM.
 *
 * 1. Fiscal-period helpers (Indian FY: Apr–Mar; `Q2FY27` = Jul–Sep 2026).
 *    Shared by discovery, guidance horizon parsing and the ledger.
 * 2. Deterministic speaker-turn parser for the common vendor layouts:
 *      A  "Moderator:", "Name: text", roster page "MANAGEMENT: MR. X – ROLE – CO"
 *      B  speaker name on its own line (Infosys), roster "CORPORATE PARTICIPANTS"
 *      C  Reliance-style "Company Speaker (Sh Name)" / "Questioner (Name – Firm)"
 *    Roles come from the roster when present, heuristics otherwise; the
 *    opening-remarks / Q&A split uses the moderator's hand-over line; every
 *    turn keeps the 1-indexed PDF page it starts on.
 */

import { istDateKey } from "@/lib/time";
import type { DocumentText, SpeakerRole, TranscriptTurn } from "../types";

// ---------------------------------------------------------------------------
// Fiscal periods
// ---------------------------------------------------------------------------

export type FiscalKind = "quarter" | "half" | "year";

export interface FiscalPeriod {
  /** 'Q2FY27' | 'H2FY27' | 'FY27' */
  label: string;
  kind: FiscalKind;
  /** full fiscal year of the period's end, e.g. 2027 for FY27 */
  fy: number;
  /** 1..4 for quarters, 1..2 for halves */
  n: number | null;
  /** 'YYYY-MM-DD' inclusive */
  start: string;
  end: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDay(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function ymd(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

/** Build a period from (kind, full FY, n). */
export function makePeriod(
  kind: FiscalKind,
  fy: number,
  n: number | null,
): FiscalPeriod {
  const fy2 = String(fy).slice(-2);
  if (kind === "year") {
    return {
      label: `FY${fy2}`,
      kind,
      fy,
      n: null,
      start: ymd(fy - 1, 3, 1),
      end: ymd(fy, 2, 31),
    };
  }
  if (kind === "half") {
    const h = n === 2 ? 2 : 1;
    const startM0 = h === 1 ? 3 : 9; // Apr | Oct
    const sy = h === 1 ? fy - 1 : fy - 1;
    const ey = h === 1 ? fy - 1 : fy;
    const endM0 = h === 1 ? 8 : 2; // Sep | Mar
    return {
      label: `H${h}FY${fy2}`,
      kind,
      fy,
      n: h,
      start: ymd(sy, startM0, 1),
      end: ymd(ey, endM0, lastDay(ey, endM0)),
    };
  }
  const q = Math.min(4, Math.max(1, n ?? 1));
  // Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec (fy-1), Q4 Jan–Mar (fy)
  const startM0 = [3, 6, 9, 0][q - 1] as number;
  const y = q === 4 ? fy : fy - 1;
  const endM0 = startM0 + 2;
  return {
    label: `Q${q}FY${fy2}`,
    kind,
    fy,
    n: q,
    start: ymd(y, startM0, 1),
    end: ymd(y, endM0, lastDay(y, endM0)),
  };
}

/** Full FY for a two-digit suffix ("27" → 2027; "2027" → 2027; "2026-27" → 2027). */
function fyFromToken(tok: string): number | null {
  const t = tok.replace(/\s+/g, "");
  let m = /^(\d{4})[-/–](\d{2,4})$/.exec(t);
  if (m) {
    const second = m[2] as string;
    return second.length === 4
      ? Number(second)
      : Number(`${(m[1] as string).slice(0, 2)}${second}`);
  }
  m = /^(\d{2})[-/–](\d{2})$/.exec(t);
  if (m) return 2000 + Number(m[2]);
  if (/^\d{4}$/.test(t)) return Number(t);
  if (/^\d{2}$/.test(t)) return 2000 + Number(t);
  return null;
}

/**
 * Parse 'Q2FY27', 'Q2 FY27', 'Q2 FY 2027', "Q2 FY '27", 'Q2FY2026-27', '2QFY27',
 * 'FY27', 'FY 2026-27', 'FY2027', 'H2FY27', 'H2 FY27', '1HFY27'. Null otherwise.
 */
export function parsePeriodLabel(s: string): FiscalPeriod | null {
  const t = s.trim().replace(/[’']/g, "").replace(/\s+/g, " ");
  let m =
    /^(?:Q\s?([1-4])|([1-4])\s?Q)\s*,?\s*FY\s?((?:\d{4}[-/–]\d{2,4})|(?:\d{2}[-/–]\d{2})|\d{4}|\d{2})$/i.exec(
      t,
    );
  if (m) {
    const fy = fyFromToken(m[3] as string);
    if (fy) return makePeriod("quarter", fy, Number(m[1] ?? m[2]));
  }
  m =
    /^(?:H\s?([12])|([12])\s?H)\s*,?\s*FY\s?((?:\d{4}[-/–]\d{2,4})|(?:\d{2}[-/–]\d{2})|\d{4}|\d{2})$/i.exec(
      t,
    );
  if (m) {
    const fy = fyFromToken(m[3] as string);
    if (fy) return makePeriod("half", fy, Number(m[1] ?? m[2]));
  }
  m = /^FY\s?((?:\d{4}[-/–]\d{2,4})|(?:\d{2}[-/–]\d{2})|\d{4}|\d{2})$/i.exec(t);
  if (m) {
    const fy = fyFromToken(m[1] as string);
    if (fy) return makePeriod("year", fy, null);
  }
  return null;
}

/** Fiscal quarter (1..4) and full FY for a calendar year/month (0-based). */
export function fiscalQuarterOf(
  year: number,
  month0: number,
): { fy: number; q: number } {
  if (month0 >= 3) return { fy: year + 1, q: Math.floor((month0 - 3) / 3) + 1 };
  return { fy: year, q: 4 };
}

/** '2026-09-30' (a quarter end) → 'Q2FY27'. Any date inside the quarter works. */
export function periodForQuarterEnd(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number) as [number, number];
  const { fy, q } = fiscalQuarterOf(y, m - 1);
  return makePeriod("quarter", fy, q).label;
}

/**
 * A transcript filed at `ms` discusses the quarter that ended most recently
 * before the filing: Oct–Dec filings → Q2, Jan–Mar → Q3, Apr–Jun → Q4, Jul–Sep → Q1.
 */
export function periodForTranscriptDate(ms: number): string {
  const key = istDateKey(ms);
  const [y, m] = key.split("-").map(Number) as [number, number];
  const cur = fiscalQuarterOf(y, m - 1);
  const prevQ = cur.q === 1 ? 4 : cur.q - 1;
  const prevFy = cur.q === 1 ? cur.fy - 1 : cur.fy;
  return makePeriod("quarter", prevFy, prevQ).label;
}

/** Sort key for period labels: the period's end date ('' when unparseable). */
export function periodSortKey(label: string | null | undefined): string {
  if (!label) return "";
  return parsePeriodLabel(label)?.end ?? "";
}

/** Quarter-end date keys ('YYYY-MM-DD') covering a period, oldest first. */
export function quarterEndsOf(p: FiscalPeriod): string[] {
  const qs =
    p.kind === "quarter"
      ? [p.n as number]
      : p.kind === "half"
        ? p.n === 2
          ? [3, 4]
          : [1, 2]
        : [1, 2, 3, 4];
  return qs.map((q) => makePeriod("quarter", p.fy, q).end);
}

/** The same period one fiscal year earlier (for YoY). */
export function previousYearPeriod(p: FiscalPeriod): FiscalPeriod {
  return makePeriod(p.kind, p.fy - 1, p.n);
}

/** The immediately preceding quarter (for QoQ); only meaningful for quarters. */
export function previousQuarter(p: FiscalPeriod): FiscalPeriod {
  const q = p.n ?? 1;
  return q === 1
    ? makePeriod("quarter", p.fy - 1, 4)
    : makePeriod("quarter", p.fy, q - 1);
}

const MONTH_NAMES: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/** Parse "October 26, 2026" | "26th October 2026" | "26 Oct 2026" → 'YYYY-MM-DD'. */
export function parseLongDate(s: string): string | null {
  let m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s);
  if (m) {
    const mo = MONTH_NAMES[(m[1] as string).toLowerCase()];
    if (mo !== undefined) return ymd(Number(m[3]), mo, Number(m[2]));
  }
  m =
    /(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(
      s,
    );
  if (m) {
    const mo = MONTH_NAMES[(m[2] as string).toLowerCase()];
    if (mo !== undefined) return ymd(Number(m[3]), mo, Number(m[1]));
  }
  return null;
}

/**
 * Find the call's period in cover text: "Q2 FY27 Earnings Conference Call",
 * "Q2 FY '27", "quarter ended September 30, 2026", "quarter and half year ended
 * 30th September 2026", "Second Quarter FY27".
 */
export function inferPeriodFromText(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  let m =
    /\b(?:Q\s?([1-4])|([1-4])\s?Q)\s*[,-]?\s*(?:of\s+)?FY\s?[’']?((?:\d{4}[-/–]\d{2,4})|(?:\d{2}[-/–]\d{2})|\d{4}|\d{2})\b/i.exec(
      t,
    );
  if (m) {
    const fy = fyFromToken(m[3] as string);
    if (fy) return makePeriod("quarter", fy, Number(m[1] ?? m[2])).label;
  }
  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
  };
  m =
    /\b(first|second|third|fourth)\s+quarter\b[^.]{0,40}?\bFY\s?[’']?((?:\d{4}[-/–]\d{2,4})|\d{4}|\d{2})\b/i.exec(
      t,
    );
  if (m) {
    const fy = fyFromToken(m[2] as string);
    if (fy)
      return makePeriod(
        "quarter",
        fy,
        ordinals[(m[1] as string).toLowerCase()] ?? 1,
      ).label;
  }
  m =
    /quarter(?:\s+and\s+(?:half|nine|six)[- ]?(?:year|months?))?\s+ended\s+(?:on\s+)?([^,.;]{4,40}?\d{4})/i.exec(
      t,
    );
  if (m) {
    const d = parseLongDate(m[1] as string);
    if (d) return periodForQuarterEnd(d);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

export interface Participant {
  name: string;
  role: SpeakerRole;
  title: string | null;
  firm: string | null;
  /** the broker analyst named under "MODERATOR:" who hosts the call */
  host?: boolean;
}

export type TranscriptLayout = "inline" | "line" | "unknown";

export interface ParsedTranscript {
  turns: TranscriptTurn[];
  roster: Participant[];
  layout: TranscriptLayout;
  /** first PDF page of the call body (after cover letter / roster) */
  bodyStartPage: number;
  callDate: string | null;
  period: string | null;
  stats: {
    pages: number;
    turns: number;
    management: number;
    analyst: number;
    moderator: number;
    unknown: number;
    openingTurns: number;
    qaTurns: number;
    managementWords: number;
  };
}

interface Line {
  page: number;
  text: string;
}

const HONORIFIC_RE = /^(?:MR|MS|MRS|DR|SHRI|SH|SMT|PROF|CA|ER)\.?\s+/i;
const LABEL_BLOCKLIST = new Set(
  [
    "sub",
    "subject",
    "ref",
    "re",
    "note",
    "notes",
    "date",
    "code",
    "scrip code",
    "scrip id",
    "symbol",
    "series",
    "cin",
    "email",
    "e-mail",
    "tel",
    "fax",
    "website",
    "web",
    "encl",
    "kind attn",
    "to",
    "from",
    "attn",
    "dear sir",
    "dear sirs",
    "disclaimer",
    "regd office",
    "registered office",
    "corporate office",
    "phone",
    "total",
    "revenue",
    "ebitda",
    "pat",
    "margin",
    "guidance",
    "outlook",
    "summary",
    "page",
    "time",
    "duration",
    "participants",
    "management",
    "analysts",
    "analyst",
    "corporate participants",
    "journalists",
    "isin",
    "address",
    "place",
    "signed",
    "for",
    "cc",
    "remarks",
    "q&a",
    "question",
    "answer",
    "safe harbor",
    "safe harbour",
    "forward-looking statements",
    "contact",
    "investor relations",
    "source",
    "year",
    "quarter",
    "company",
    "name",
    "designation",
    "title",
    "http",
    "https",
    "www",
    "nse",
    "bse",
  ].map((s) => s.toLowerCase()),
);

const MODERATOR_RE = /^(moderator|operator|host)$/i;
const QA_START_RE =
  /(first question|we will now begin|begin (with )?(the |our )?question[- ]and[- ]answer session|open the floor for questions|take the first question|we (will|shall) now (take|open|start) (the )?questions?|questions? from the line of)/i;
/** an IR host (management) handing over to questions: the Q&A starts with the next turn */
const MGMT_OPENS_QA_RE =
  /(open (the floor|it up|the lines|the session) for questions|(take|start with) (the )?(first )?questions?|we will now (take|open|start) (the |your )?questions?|happy to take (your )?questions)/i;
/** the moderator's welcome boilerplate also mentions Q&A — never start the Q&A on it */
const INTRO_BOILERPLATE_RE =
  /^(ladies and gentlemen|good (morning|afternoon|evening|day))[^.]{0,80}welcome to/i;
const NEXT_QUESTION_RE = /next question (is|comes) from/i;

/** canonical name key: lower-case, honorific/dots/spaces removed */
export function nameKey(s: string): string {
  return s
    .replace(HONORIFIC_RE, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /(^|[\s.\-'])([a-z])/g,
      (_m, p: string, c: string) => p + c.toUpperCase(),
    )
    .replace(/\s+/g, " ")
    .trim();
}

const NOT_A_NAME_TAIL_RE =
  /\b(Limited|Ltd|Inc|Corporation|Corp|Bank|Call|Transcript|Conference|Results|Quarter|Industries|Technologies|Labs|Capital|Securities|Markets|Research|Partners|Advisors|Group|Company|Document)\.?$/i;

function isTitleCaseName(s: string): boolean {
  const t = s.trim();
  if (t.length < 3 || t.length > 45) return false;
  if (/[0-9:;,"()?!]/.test(t)) return false;
  if (/\.$/.test(t) && !/\b[A-Z]\.$/.test(t)) return false;
  if (NOT_A_NAME_TAIL_RE.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  let caps = 0;
  for (const w of words) {
    if (!/^[A-Z][A-Za-z.'’-]*$/.test(w)) return false;
    if (w.length > 1 && w === w.toUpperCase() && /[A-Z]{3,}/.test(w)) caps++;
  }
  // all-caps short lines are headings, not names
  if (caps === words.length && words.length > 1) return false;
  return true;
}

interface LinesResult {
  lines: Line[];
  /** distinct running header/footer lines that were removed (one sample each) */
  headers: string[];
}

/** A line can be a running header/footer only if it is not prose and not a speaker name. */
function boilerCandidate(t: string): boolean {
  if (t.length < 3 || t.length > 140) return false;
  if (/[.?!]$/.test(t) && !/\d/.test(t) && !/©/.test(t)) return false; // sentences
  const colon =
    /^([A-Z][A-Za-z.'’-]*(?:\s+[A-Za-z][A-Za-z.'’-]*){0,5}):\s*(\S.*)$/.exec(t);
  if (colon) {
    // "Name: text" is a speaker line unless it looks like a stamp:
    // "Marico Information classification: Official", "Regd. Off: 7th Floor … 400098"
    const label = colon[1] as string;
    const rest = colon[2] as string;
    const stamp =
      /\s[a-z]/.test(label) ||
      rest.split(/\s+/).length <= 1 ||
      /\d{3,}/.test(rest);
    if (!stamp) return false;
  }
  if (isTitleCaseName(t)) return false;
  return true;
}

/** Split page texts into lines with page numbers, dropping running headers/footers. */
function toLines(doc: DocumentText): LinesResult {
  const perPage = doc.pages.map((p) =>
    p.text.split(/\r?\n/).map((l) => l.replace(/\s+$/g, "")),
  );
  // candidate header/footer keys: first 8 / last 5 lines of each page, digits masked
  const counts = new Map<string, number>();
  const exact = new Map<string, Map<string, number>>();
  for (const lines of perPage) {
    const edge = [...lines.slice(0, 8), ...lines.slice(-5)];
    const seen = new Set<string>();
    for (const l of edge) {
      const t = l.trim();
      if (!boilerCandidate(t)) continue;
      const key = t.replace(/\d+/g, "#");
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const ex = exact.get(key) ?? new Map<string, number>();
      ex.set(t, (ex.get(t) ?? 0) + 1);
      exact.set(key, ex);
    }
  }
  const threshold = Math.max(3, Math.ceil(perPage.length * 0.4));
  const headers: string[] = [];
  for (const [key, n] of counts) {
    if (n < threshold || perPage.length < 4) continue;
    // the most frequent exact spelling (the letter's "November 6" vs the header's "November 02")
    const ex = exact.get(key) ?? new Map<string, number>();
    const top = [...ex.entries()].sort((a, b) => b[1] - a[1])[0];
    headers.push(top ? top[0] : key);
  }
  const isBoiler = (l: string): boolean => {
    const t = l.trim();
    if (!t) return false;
    if (/^page\s+\d+\s+(of|\/)\s+\d+$/i.test(t)) return true;
    if (/^\d{1,3}$/.test(t)) return true;
    if (!boilerCandidate(t)) return false;
    const key = t.replace(/\d+/g, "#");
    return (counts.get(key) ?? 0) >= threshold && perPage.length >= 4;
  };
  const out: Line[] = [];
  perPage.forEach((lines, i) => {
    const page = doc.pages[i]?.page ?? i + 1;
    for (const l of lines) {
      if (isBoiler(l)) continue;
      out.push({ page, text: l });
    }
  });
  return { lines: out, headers };
}

// --- roster ------------------------------------------------------------------

// roster headings are ALL CAPS in every vendor layout seen; body speaker labels ("Moderator:") are not
const ROSTER_MGMT_HEAD =
  /^\s*(MANAGEMENT|CORPORATE PARTICIPANTS|COMPANY PARTICIPANTS|PARTICIPANTS FROM (THE )?(MANAGEMENT|COMPANY)|MANAGEMENT TEAM|FROM (THE )?MANAGEMENT|COMPANY REPRESENTATIVES?|MANAGEMENT PARTICIPANTS)\s*:?\s*(.*)$/;
const ROSTER_OTHER_HEAD =
  /^\s*(MODERATOR|ANALYSTS?|HOST|PARTICIPANTS|JOURNALISTS|INVESTORS?|ANALYSTS?\s*\/\s*INVESTORS?|CONFERENCE CALL PARTICIPANTS|OTHER PARTICIPANTS)\s*:?\s*(.*)$/;
const TITLE_WORD_RE =
  /\b(officer|director|president|head|chief|cfo|ceo|md|managing|vice|vp|manager|investor relations|secretary|founder|chairman|chairperson|executive|group|treasurer|controller|strategy|finance|operations|business|coo|cto|cmo|promoter|whole[- ]time)\b/i;

function splitRosterEntries(text: string): string[] {
  // "MR. A – ROLE – CO MR. B – ROLE – CO" → split before each honorific
  const parts = text.split(
    /\s+(?=(?:MR|MS|MRS|DR|SHRI|SH|SMT|PROF|CA)\.?\s+[A-Z])/i,
  );
  return parts.map((p) => p.trim()).filter((p) => p.length > 2);
}

function participantFromEntry(
  entry: string,
  role: SpeakerRole,
): Participant | null {
  const segs = entry
    .split(/\s+[–—-]\s+|\s*[–—]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!segs.length) return null;
  const rawName = (segs[0] as string)
    .replace(HONORIFIC_RE, "")
    .replace(/[,.]+$/, "")
    .trim();
  if (!rawName || rawName.length > 45) return null;
  const name = /[a-z]/.test(rawName) ? rawName : titleCase(rawName);
  if (!/^[A-Za-z]/.test(name)) return null;
  return {
    name,
    role,
    title: segs[1] ? titleCase(segs[1]) : null,
    firm: segs[2]
      ? titleCase(segs[2])
      : role === "analyst" && segs[1]
        ? titleCase(segs[1])
        : null,
  };
}

export interface RosterResult {
  roster: Participant[];
  /** indices (into `lines`) consumed by roster headings/entries — never body text */
  consumed: Set<number>;
}

/**
 * Extract the participant roster from roster blocks ("MANAGEMENT:", "CORPORATE
 * PARTICIPANTS", "MODERATOR:", "ANALYSTS"). Blocks can recur (Infosys files the
 * press conference and the analyst call in one PDF), so the whole document is
 * scanned, but only ALL-CAPS headings count.
 */
export function extractRoster(lines: Line[]): RosterResult {
  const roster: Participant[] = [];
  const consumed = new Set<number>();
  const seen = new Set<string>();
  const push = (p: Participant | null) => {
    if (!p) return;
    if (MODERATOR_RE.test(p.name)) return;
    const k = nameKey(p.name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    roster.push(p);
  };

  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] as Line).text.trim();
    const mgmt = ROSTER_MGMT_HEAD.exec(t);
    let other = mgmt ? null : ROSTER_OTHER_HEAD.exec(t);
    if (!mgmt && !other && roster.length) {
      // an unlisted ALL-CAPS heading right after a roster block ("JOUNALISTS" [sic]) that is
      // followed by a name line is another participants block
      if (/^[A-Z][A-Z\s/&-]{3,40}:?$/.test(t) && t.split(/\s+/).length <= 3) {
        let k = i + 1;
        while (k < lines.length && !(lines[k] as Line).text.trim()) k++;
        const nxt = (lines[k]?.text ?? "").trim();
        if (isTitleCaseName(nxt) || HONORIFIC_RE.test(nxt))
          other = [t, t.replace(/:$/, ""), ""] as unknown as RegExpExecArray;
      }
    }
    if (!mgmt && !other) continue;
    const headRole: SpeakerRole = mgmt ? "management" : "analyst";
    const isModeratorHead =
      !mgmt &&
      /^(MODERATOR|HOST)/.test((other as RegExpExecArray)[1] as string);
    const rest =
      (mgmt ? mgmt[mgmt.length - 1] : (other as RegExpExecArray)[2]) ?? "";
    // a heading whose remainder is prose ("MODERATOR: Ladies and gentlemen…") is body text
    if (
      rest.trim() &&
      !HONORIFIC_RE.test(rest.trim()) &&
      !/^[A-Z][A-Z\s.&'’,()-]+$/.test(rest.trim())
    )
      continue;
    consumed.add(i);

    const block: string[] = [];
    if (rest.trim()) block.push(rest.trim());
    let j = i + 1;
    for (; j < lines.length; j++) {
      const s = (lines[j] as Line).text.trim();
      if (!s) continue;
      if (ROSTER_MGMT_HEAD.test(s) || ROSTER_OTHER_HEAD.test(s)) break;
      // any other short ALL-CAPS heading ("JOUNALISTS" [sic]) ends a layout-B block
      // (layout-A entries wrap onto ALL-CAPS continuation lines, so only when no honorific was seen)
      if (
        block.length &&
        !block.some((b) => HONORIFIC_RE.test(b)) &&
        /^[A-Z][A-Z\s/&-]{3,40}:?$/.test(s) &&
        s.split(/\s+/).length <= 3
      )
        break;
      // body started: "Moderator: Ladies…", "Name: text", or a sentence
      if (
        /^[A-Z][A-Za-z.'’-]*(?:\s+[A-Z][A-Za-z.'’-]*){0,5}:\s+\S/.test(s) &&
        !HONORIFIC_RE.test(s)
      )
        break;
      if (
        /^(ladies and gentlemen|good (morning|afternoon|evening)|thank you)/i.test(
          s,
        )
      )
        break;
      if (/[.?!]\s*$/.test(s) && s.split(/\s+/).length > 8) break;
      if (block.length > 60) break;
      // a name followed by a sentence is the first speaker of the body, not a roster entry
      if (isTitleCaseName(s)) {
        let k = j + 1;
        while (k < lines.length && !(lines[k] as Line).text.trim()) k++;
        const nxt = (lines[k]?.text ?? "").trim();
        if (nxt.split(/\s+/).length > 8 && !TITLE_WORD_RE.test(nxt)) break;
      }
      block.push(s);
      consumed.add(j);
    }

    const joined = block.join(" ").replace(/\s+/g, " ").trim();
    if (
      HONORIFIC_RE.test(joined) ||
      /\s(?:MR|MS|MRS|DR|SHRI|SMT)\.?\s/i.test(` ${joined} `)
    ) {
      // layout A: "MR. X – ROLE – COMPANY MR. Y – …"
      for (const e of splitRosterEntries(joined)) {
        const p = participantFromEntry(e, headRole);
        if (p && isModeratorHead) {
          p.host = true;
          p.firm = p.firm ?? p.title;
          p.title = null;
        }
        push(p);
      }
    } else {
      // layout B: name / title(firm) line pairs. When the block is strictly paired
      // (every even line a name) consume pairs blindly so "ET Now" / "Mint" are firms, not names.
      const isName = (s: string) =>
        isTitleCaseName(s) && !TITLE_WORD_RE.test(s);
      const evenNames = block
        .filter((_s, idx) => idx % 2 === 0)
        .filter(isName).length;
      const strictPairs =
        block.length >= 2 &&
        block.length % 2 === 0 &&
        evenNames >= Math.ceil(block.length / 2) * 0.6;
      let k = 0;
      while (k < block.length) {
        const nameLine = block[k] as string;
        const next = block[k + 1] ?? "";
        if (isName(nameLine)) {
          const looksTitle = strictPairs ? !!next : !!next && !isName(next);
          // a management block entry whose "title" has no role word is a journalist/analyst + firm
          const role: SpeakerRole =
            headRole === "management" && looksTitle && !TITLE_WORD_RE.test(next)
              ? "analyst"
              : headRole;
          push({
            name: nameLine,
            role,
            title: role === "management" && looksTitle ? next : null,
            firm: role === "analyst" && looksTitle ? next : null,
            host: isModeratorHead || undefined,
          });
          k += looksTitle ? 2 : 1;
        } else k++;
      }
    }
    i = j - 1;
  }
  return { roster, consumed };
}

// --- speaker lines -------------------------------------------------------------

interface SpeakerHit {
  label: string;
  rest: string;
  /** when the label stands alone on its line: the following line (the turn's text) */
  nextText?: string;
}

const INLINE_RE =
  /^([A-Z][A-Za-z.'’-]*(?:\s+[A-Za-z][A-Za-z.'’-]*){0,5}?)\s*:\s*(.*)$/;
const RELIANCE_SPEAKER_RE =
  /^(?:Company Speaker\s*\((?:Sh\.?|Shri|Smt\.?|Mr\.?|Ms\.?|Dr\.?)?\s*([^)]+)\)|Questioner\s*\(([^)]+)\)|(?:Sh\.?|Shri|Smt\.?)\s+([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})\s+\d{2}:\d{2}:\d{2})/;

function inlineHit(text: string): SpeakerHit | null {
  const t = text.trim();
  const r = RELIANCE_SPEAKER_RE.exec(t);
  if (r) {
    const label = (r[1] ?? r[2] ?? r[3] ?? "").trim();
    if (label)
      return { label: r[2] ? `Questioner (${label})` : label, rest: "" };
  }
  const m = INLINE_RE.exec(t);
  if (!m) return null;
  const label = (m[1] as string).trim();
  if (label.length > 45 || /\d/.test(label)) return null;
  const rest = (m[2] ?? "").trim();
  // "MODERATOR: MR. X – FIRM" is a roster line, not a turn
  if (label === label.toUpperCase() && HONORIFIC_RE.test(rest)) return null;
  const words = label.split(/\s+/);
  if (words.length > 6) return null;
  // every word capitalised (allow "van", "de", initials) — reject sentence fragments like "So:"
  const capWords = words.filter((w) => /^[A-Z]/.test(w)).length;
  if (capWords < Math.max(1, words.length - 1)) return null;
  if (LABEL_BLOCKLIST.has(label.toLowerCase())) return null;
  if (words.length === 1 && !MODERATOR_RE.test(label) && label.length < 3)
    return null;
  return { label, rest: (m[2] ?? "").trim() };
}

export interface ParseOptions {
  /** roster override (tests) */
  roster?: Participant[];
}

/** Resolve a speaker label to a roster participant (exact key, initials-insensitive, surname). */
export function matchRoster(
  label: string,
  roster: Participant[],
): Participant | null {
  const key = nameKey(label);
  if (!key) return null;
  for (const p of roster) if (nameKey(p.name) === key) return p;
  // initials-insensitive: compare without single-letter tokens
  const strip = (s: string) =>
    s
      .replace(HONORIFIC_RE, "")
      .split(/[\s.]+/)
      .filter((w) => w.length > 1)
      .join("")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  const ls = strip(label);
  if (ls.length >= 4)
    for (const p of roster) if (strip(p.name) === ls) return p;
  const toks = label
    .replace(HONORIFIC_RE, "")
    .toLowerCase()
    .split(/[\s.]+/)
    .map((w) => w.replace(/[^a-z]/g, ""))
    .filter(Boolean);
  const rosterToks = (p: Participant) =>
    p.name
      .toLowerCase()
      .split(/[\s.]+/)
      .map((w) => w.replace(/[^a-z]/g, ""))
      .filter(Boolean);
  // first + last name ("Krishna Chava" ↔ "Krishna Chaitanya Chava"), unique
  if (toks.length >= 2) {
    const first = toks[0] as string;
    const last = toks[toks.length - 1] as string;
    if (first.length >= 3 && last.length >= 3) {
      const hits = roster.filter((p) => {
        const rt = rosterToks(p);
        return rt.includes(first) && rt.includes(last);
      });
      if (hits.length === 1) return hits[0] as Participant;
    }
  }
  // surname match (last token ≥ 4 chars, unique)
  const lastTok = toks[toks.length - 1] ?? "";
  if (lastTok.length >= 4) {
    const hits = roster.filter((p) => rosterToks(p).includes(lastTok));
    if (hits.length === 1) return hits[0] as Participant;
  }
  return null;
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Parse a transcript into speaker turns with roles, sections and pages. */
export function parseTranscript(
  doc: DocumentText,
  opts: ParseOptions = {},
): ParsedTranscript {
  const { lines, headers } = toLines(doc);
  const rosterRes = extractRoster(lines);
  const roster = opts.roster ?? rosterRes.roster;
  const consumed = rosterRes.consumed;
  const rosterKeys = new Map(roster.map((p) => [nameKey(p.name), p]));
  const rosterTitles = new Set(
    roster
      .flatMap((p) => [p.title, p.firm])
      .filter((s): s is string => !!s)
      .map((s) => s.toLowerCase()),
  );

  // --- classify every line as inline / line-layout speaker hit ---------------
  const inlineHits: Array<SpeakerHit | null> = lines.map((l, i) => {
    if (consumed.has(i)) return null;
    const h = inlineHit(l.text);
    if (h && !h.rest) {
      let k = i + 1;
      while (k < lines.length && !(lines[k] as Line).text.trim()) k++;
      h.nextText = (lines[k]?.text ?? "").trim();
    }
    return h;
  });
  const lineHits: Array<string | null> = lines.map((l, i) => {
    if (consumed.has(i)) return null;
    const t = l.text.trim();
    if (!t) return null;
    if (MODERATOR_RE.test(t)) return t;
    if (!isTitleCaseName(t)) return null;
    if (rosterKeys.has(nameKey(t))) return t;
    if (matchRoster(t, roster)) return t;
    // unknown name line: accept when the previous line ended a sentence
    const prev = lines[i - 1]?.text.trim() ?? "";
    if (TITLE_WORD_RE.test(t)) return null;
    if (/[.?!”"]$/.test(prev) || prev === "") return t;
    return null;
  });

  // label frequency for inline candidates (single-use odd labels are rejected)
  const inlineFreq = new Map<string, number>();
  for (const h of inlineHits)
    if (h)
      inlineFreq.set(
        nameKey(h.label),
        (inlineFreq.get(nameKey(h.label)) ?? 0) + 1,
      );
  const inlineOk = (h: SpeakerHit): boolean => {
    if (
      MODERATOR_RE.test(h.label) ||
      /^(Questioner|Company Speaker)/.test(h.label)
    )
      return true;
    if (rosterKeys.has(nameKey(h.label)) || matchRoster(h.label, roster))
      return true;
    if ((inlineFreq.get(nameKey(h.label)) ?? 0) >= 2) return true;
    // single occurrence: accept 2–4 word proper names followed by real text (same line or the next)
    const words = h.label.split(/\s+/);
    const text = h.rest || h.nextText || "";
    return (
      words.length >= 2 && words.length <= 4 && text.split(/\s+/).length >= 4
    );
  };

  const inlineCount = inlineHits.filter((h) => h && inlineOk(h)).length;
  const lineCount = lineHits.filter(
    (h) =>
      h &&
      (MODERATOR_RE.test(h) ||
        rosterKeys.has(nameKey(h)) ||
        matchRoster(h, roster)),
  ).length;
  let layout: TranscriptLayout = "unknown";
  if (inlineCount >= 5 && inlineCount >= lineCount) layout = "inline";
  else if (lineCount >= 5) layout = "line";
  else if (inlineCount >= 3) layout = "inline";
  else if (lineHits.filter(Boolean).length >= 8) layout = "line";

  // --- body start: first moderator / roster speaker hit -------------------------
  const speakerAt = (i: number): SpeakerHit | null => {
    if (layout === "inline") {
      const h = inlineHits[i];
      return h && inlineOk(h) ? h : null;
    }
    if (layout === "line") {
      const h = lineHits[i];
      return h ? { label: h, rest: "" } : null;
    }
    return null;
  };

  // body = first speaker hit that is the moderator, a roster name, or a label used ≥ 2 times
  // (cover-letter labels such as "Scrip Code:" occur once and are blocklisted anyway)
  let bodyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = speakerAt(i);
    if (!h) continue;
    if (
      MODERATOR_RE.test(h.label) ||
      rosterKeys.has(nameKey(h.label)) ||
      matchRoster(h.label, roster) ||
      (inlineFreq.get(nameKey(h.label)) ?? 0) >= 2 ||
      (!h.rest &&
        (h.nextText ?? "").split(/\s+/).length >= 8 &&
        h.label.split(/\s+/).length >= 2)
    ) {
      bodyStart = i;
      break;
    }
  }
  if (bodyStart < 0)
    for (let i = 0; i < lines.length; i++)
      if (speakerAt(i)) {
        bodyStart = i;
        break;
      }

  // --- cover metadata (lines before the body) -----------------------------------
  const coverLines = lines.slice(
    0,
    bodyStart < 0 ? Math.min(lines.length, 80) : bodyStart,
  );
  let period = inferPeriodFromText(
    [...headers, ...coverLines.map((l) => l.text)].join("\n"),
  );
  let callDate: string | null = null;
  // prefer: the running header's date (vendor layouts stamp the call date on every page)
  //   > a standalone date line on the cover > "call held on <date>" > any date
  const STANDALONE_DATE_RE =
    /^(?:[A-Z][a-z]+\.? \d{1,2},? \d{4}|\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+,? \d{4})$/;
  for (const h of headers) {
    if (STANDALONE_DATE_RE.test(h.trim())) {
      const d = parseLongDate(h);
      if (d) callDate = d;
    }
  }
  if (!callDate) {
    for (const l of coverLines) {
      const t = l.text.trim();
      if (STANDALONE_DATE_RE.test(t)) {
        const d = parseLongDate(t);
        if (d) callDate = d; // last standalone date before the body wins (roster page, not the letter)
      }
    }
  }
  if (!callDate) {
    for (const l of coverLines) {
      if (/\b(held|conducted|hosted) on\b/i.test(l.text)) {
        const d = parseLongDate(
          l.text.replace(/^.*\b(held|conducted|hosted) on\b/i, ""),
        );
        if (d) {
          callDate = d;
          break;
        }
      }
    }
  }
  if (!callDate) {
    for (const l of coverLines) {
      const d = parseLongDate(l.text);
      if (d) {
        callDate = d;
        break;
      }
    }
  }
  if (!period && callDate) {
    const [y, m, d] = callDate.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    period = periodForTranscriptDate(Date.UTC(y, m - 1, d, 12));
  }

  // --- turns ------------------------------------------------------------------------
  const turns: TranscriptTurn[] = [];
  if (bodyStart >= 0) {
    let cur: { speaker: string; page: number; parts: string[] } | null = null;
    const flush = () => {
      if (!cur) return;
      const text = cur.parts.join(" ").replace(/\s+/g, " ").trim();
      if (text) {
        turns.push({
          index: turns.length,
          speaker: cur.speaker,
          role: "unknown",
          section: "opening",
          page: cur.page,
          text,
        });
      }
      cur = null;
    };
    for (let i = bodyStart; i < lines.length; i++) {
      const l = lines[i] as Line;
      if (consumed.has(i)) continue; // a second roster block mid-document (Infosys)
      const h = speakerAt(i);
      if (h) {
        flush();
        cur = { speaker: h.label, page: l.page, parts: h.rest ? [h.rest] : [] };
        continue;
      }
      const t = l.text.trim();
      if (!t) continue;
      if (rosterTitles.has(t.toLowerCase())) continue;
      if (cur) cur.parts.push(t);
    }
    flush();
  }

  // --- roles + sections -------------------------------------------------------------
  const hosts = roster.filter((p) => p.host);
  // roster-less heuristics: who did the moderator introduce, and who mostly asks questions?
  const introduced = new Set<string>();
  const perSpeaker = new Map<
    string,
    { turns: number; questions: number; spokeInOpening: boolean }
  >();
  {
    const INTRO_RE =
      /(?:from the line of|question (?:is|comes) from|questions? from|begin with you|over to you|next (?:question|participant) (?:is )?from)\s+(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s*([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})/g;
    let qa = false;
    let qaNext = false;
    for (const t of turns) {
      if (qaNext) {
        qa = true;
        qaNext = false;
      }
      if (MODERATOR_RE.test(t.speaker ?? "")) {
        if (
          !INTRO_BOILERPLATE_RE.test(t.text) &&
          (QA_START_RE.test(t.text) || NEXT_QUESTION_RE.test(t.text))
        )
          qa = true;
        for (const m of t.text.matchAll(INTRO_RE))
          introduced.add(nameKey(m[1] as string));
        continue;
      }
      // an IR host introducing questioners ("The next question is from Uma Kannan from the Deccan Herald")
      for (const m of t.text.matchAll(INTRO_RE))
        introduced.add(nameKey(m[1] as string));
      if (!qa && MGMT_OPENS_QA_RE.test(t.text)) qaNext = true;
      const k = nameKey(t.speaker ?? "");
      const s = perSpeaker.get(k) ?? {
        turns: 0,
        questions: 0,
        spokeInOpening: false,
      };
      s.turns++;
      if (/\?\s*$/.test(t.text) || (t.text.match(/\?/g)?.length ?? 0) >= 2)
        s.questions++;
      if (!qa) s.spokeInOpening = true;
      perSpeaker.set(k, s);
    }
  }
  const guessRole = (label: string, qaStarted: boolean): SpeakerRole => {
    const k = nameKey(label);
    const s = perSpeaker.get(k);
    if (!qaStarted) return "management";
    if (introduced.has(k)) return "analyst";
    if (s && s.turns >= 2 && s.questions / s.turns >= 0.34) return "analyst";
    if (s?.spokeInOpening) return "management";
    // surname-only introductions ("from the line of Shah")
    const last = k.length ? (label.trim().split(/\s+/).pop() ?? "") : "";
    if (last && [...introduced].some((n) => n.endsWith(nameKey(last))))
      return "analyst";
    return s && s.turns >= 3 && s.questions === 0 ? "management" : "analyst";
  };

  let qaStarted = false;
  let qaAfterThis = false;
  let mgmtSpoke = false;
  let mgmtWords = 0;
  const counts = {
    management: 0,
    analyst: 0,
    moderator: 0,
    unknown: 0,
    opening: 0,
    qa: 0,
  };
  for (const t of turns) {
    const label = t.speaker ?? "";
    let role: SpeakerRole = "unknown";
    const rosterHit = matchRoster(label, roster);
    if (MODERATOR_RE.test(label)) role = "moderator";
    else if (/^Questioner/.test(label)) role = "analyst";
    else if (/^Company Speaker/.test(label)) role = "management";
    else if (rosterHit) role = rosterHit.role;
    else if (/^(Management|Company Management|Management Team)$/i.test(label))
      role = "management";
    else role = guessRole(label, qaStarted);

    const isHost =
      role === "analyst" &&
      !!rosterHit &&
      (hosts.includes(rosterHit) || !!rosterHit.host);
    if (qaAfterThis) {
      qaStarted = true;
      qaAfterThis = false;
    }
    if (!qaStarted) {
      if (
        role === "moderator" &&
        !INTRO_BOILERPLATE_RE.test(t.text) &&
        (QA_START_RE.test(t.text) || NEXT_QUESTION_RE.test(t.text))
      )
        qaStarted = true;
      else if (role === "analyst" && !isHost && mgmtSpoke) qaStarted = true;
      else if (
        role === "analyst" &&
        isHost &&
        mgmtSpoke &&
        /\b(question|questions)\b/i.test(t.text) &&
        !/open (it|the floor|it up)/i.test(t.text)
      )
        qaStarted = true;
      else if (role === "management" && MGMT_OPENS_QA_RE.test(t.text))
        qaAfterThis = true; // IR host: "we will now open the floor for questions"
    }
    t.section = qaStarted ? "qa" : "opening";
    if (role === "management") mgmtSpoke = true;
    t.role = role;
    counts[role]++;
    if (t.section === "qa") counts.qa++;
    else counts.opening++;
    if (role === "management") mgmtWords += countWords(t.text);
  }

  // speakers normalised to the roster spelling
  for (const t of turns) {
    if (!t.speaker) continue;
    const p = matchRoster(t.speaker, roster);
    if (p) t.speaker = p.name;
    else if (MODERATOR_RE.test(t.speaker)) t.speaker = "Moderator";
  }

  return {
    turns,
    roster,
    layout,
    bodyStartPage: bodyStart >= 0 ? (lines[bodyStart] as Line).page : 1,
    callDate,
    period,
    stats: {
      pages: doc.pages.length,
      turns: turns.length,
      management: counts.management,
      analyst: counts.analyst,
      moderator: counts.moderator,
      unknown: counts.unknown,
      openingTurns: counts.opening,
      qaTurns: counts.qa,
      managementWords: mgmtWords,
    },
  };
}

/** Contract from extract/index.ts: speaker turns for chunked extraction. */
export function splitSpeakerTurns(
  doc: DocumentText,
): Array<{ speaker: string | null; page: number; text: string }> {
  return parseTranscript(doc).turns.map((t) => ({
    speaker: t.speaker,
    page: t.page,
    text: t.text,
  }));
}

/** Management turns only (what the guidance extractor reads). */
export function managementTurns(
  parsed: ParsedTranscript,
  minWords = 8,
): TranscriptTurn[] {
  return parsed.turns.filter(
    (t) => t.role === "management" && countWords(t.text) >= minWords,
  );
}

export { countWords };
