/**
 * IST + NSE trading-calendar helpers. Pure; no I/O.
 *
 * Conventions: epoch ms UTC everywhere internally; 'YYYY-MM-DD' strings are
 * IST calendar days ("date keys"). The market closes 15:30 IST.
 */
import { addDays, parse } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const IST = "Asia/Kolkata";
export const PT = "America/Los_Angeles";

export type DateInput = number | Date | string;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const NSE_DT_RE =
  /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO_LIKE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parse an NSE IST timestamp to epoch ms UTC.
 * Accepts "08-Nov-2026 17:32:09", "08-Nov-2026", "30-SEP-2026",
 * "2026-11-08 17:32:09" (sort_date) and "2026-11-08". Throws on anything else.
 */
export function parseNseDateTime(s: string): number {
  const t = s.trim();
  let y: number;
  let mo: number;
  let d: number;
  let hh = 0;
  let mm = 0;
  let ss = 0;
  let m = NSE_DT_RE.exec(t);
  if (m) {
    d = Number(m[1]);
    const mon = MONTHS[(m[2] ?? "").toLowerCase()];
    if (mon === undefined) throw new Error(`bad month in NSE date: ${s}`);
    mo = mon;
    y = Number(m[3]);
    hh = Number(m[4] ?? 0);
    mm = Number(m[5] ?? 0);
    ss = Number(m[6] ?? 0);
  } else {
    m = ISO_LIKE_RE.exec(t);
    if (!m) throw new Error(`unrecognised NSE date: ${s}`);
    y = Number(m[1]);
    mo = Number(m[2]) - 1;
    d = Number(m[3]);
    hh = Number(m[4] ?? 0);
    mm = Number(m[5] ?? 0);
    ss = Number(m[6] ?? 0);
  }
  return fromZonedTime(new Date(y, mo, d, hh, mm, ss), IST).getTime();
}

/** "30-SEP-2026" | "30-Sep-2026" | "2026-09-30" → "2026-09-30" */
export function parseNseDate(s: string): string {
  return istDateKey(parseNseDateTime(s.trim().split(/[ T]/)[0] ?? s));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function toMs(x: DateInput): number {
  if (typeof x === "number") return x;
  if (x instanceof Date) return x.getTime();
  // date key 'YYYY-MM-DD' → IST midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(x))
    return fromZonedTime(
      parse(x, "yyyy-MM-dd", new Date(2000, 0, 1)),
      IST,
    ).getTime();
  return parseNseDateTime(x);
}

/** IST calendar day 'YYYY-MM-DD' for an instant. */
export function istDateKey(x: DateInput): string {
  return formatInTimeZone(toMs(x), IST, "yyyy-MM-dd");
}

/** Format an instant in IST with a date-fns pattern (default "dd MMM yyyy HH:mm"). */
export function formatIst(x: DateInput, pattern = "dd MMM yyyy HH:mm"): string {
  return formatInTimeZone(toMs(x), IST, pattern);
}

/** "18:42 IST" style time for timestamps in the UI. */
export function formatIstTime(x: DateInput): string {
  return `${formatInTimeZone(toMs(x), IST, "HH:mm")} IST`;
}

/** Day of week in IST, 0 = Sunday. */
export function istWeekday(x: DateInput): number {
  return toZonedTime(toMs(x), IST).getDay();
}

/** Epoch ms of a wall-clock time (HH:mm) on an IST date key. */
export function istTimeOn(dateKey: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const base = toZonedTime(toMs(dateKey), IST);
  return fromZonedTime(
    new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      h ?? 0,
      m ?? 0,
      0,
    ),
    IST,
  ).getTime();
}

export function addDaysKey(dateKey: string, n: number): string {
  const d = toZonedTime(toMs(dateKey), IST);
  return formatInTimeZone(fromZonedTime(addDays(d, n), IST), IST, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export interface WindowBounds {
  /** inclusive, ms UTC */
  from: number;
  /** exclusive, ms UTC */
  to: number;
  hours: number;
  fromIst: string;
  toIst: string;
}

/** The brief's time window: [now − hours, now). */
export function windowBounds(now: DateInput, hours: number): WindowBounds {
  const to = toMs(now);
  const from = to - hours * 3_600_000;
  return { from, to, hours, fromIst: formatIst(from), toIst: formatIst(to) };
}

// ---------------------------------------------------------------------------
// Trading calendar — NSE 2026 (circular CMTR71775) + special sessions
// ---------------------------------------------------------------------------

/** NSE equity trading holidays 2026 (weekday holidays only; weekends are implicit). */
export const NSE_HOLIDAYS_2026: Readonly<Record<string, string>> = {
  "2026-01-26": "Republic Day",
  "2026-03-03": "Holi",
  "2026-03-26": "Shri Ram Navami",
  "2026-03-31": "Shri Mahavir Jayanti",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-28": "Bakri Id",
  "2026-06-26": "Muharram",
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-10": "Diwali-Balipratipada",
  "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
  "2026-12-25": "Christmas",
};

export interface SpecialSession {
  name: string;
  /** IST wall-clock */
  start: string;
  end: string;
}

/** Sessions outside normal hours (volume bars from these days are not comparable). */
export const NSE_SPECIAL_SESSIONS: Readonly<Record<string, SpecialSession>> = {
  "2026-11-08": {
    name: "Muhurat trading (Diwali Laxmi Pujan)",
    start: "14:20",
    end: "15:30",
  },
};

export const NORMAL_SESSION: SpecialSession = {
  name: "Normal",
  start: "09:15",
  end: "15:30",
};

export type SessionKind = "normal" | "special" | "holiday" | "weekend";

/** Classify an IST date. Special sessions win over weekends (Muhurat 2026 is a Sunday). */
export function sessionType(x: DateInput): SessionKind {
  const key = istDateKey(x);
  if (NSE_SPECIAL_SESSIONS[key]) return "special";
  if (NSE_HOLIDAYS_2026[key]) return "holiday";
  const wd = istWeekday(x);
  if (wd === 0 || wd === 6) return "weekend";
  return "normal";
}

export function isTradingDay(x: DateInput): boolean {
  const t = sessionType(x);
  return t === "normal" || t === "special";
}

/** Most recent trading day strictly before the given IST date. */
export function previousTradingDay(x: DateInput): string {
  let key = addDaysKey(istDateKey(x), -1);
  for (let i = 0; i < 30; i++) {
    if (isTradingDay(key)) return key;
    key = addDaysKey(key, -1);
  }
  throw new Error("no trading day found in the previous 30 days");
}

/** First trading day strictly after the given IST date. */
export function nextTradingDay(x: DateInput): string {
  let key = addDaysKey(istDateKey(x), 1);
  for (let i = 0; i < 30; i++) {
    if (isTradingDay(key)) return key;
    key = addDaysKey(key, 1);
  }
  throw new Error("no trading day found in the next 30 days");
}

/** Trading days in [fromKey, toKey], ascending. */
export function tradingDaysBetween(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let key = fromKey;
  for (let i = 0; i < 400 && key <= toKey; i++) {
    if (isTradingDay(key)) out.push(key);
    key = addDaysKey(key, 1);
  }
  return out;
}

/** Session close instant (ms UTC) for an IST date; normal 15:30, special per table. */
export function sessionCloseMs(dateKey: string): number {
  const s = NSE_SPECIAL_SESSIONS[dateKey] ?? NORMAL_SESSION;
  return istTimeOn(dateKey, s.end);
}

/**
 * The last completed market close at or before `now`: today's close if today
 * traded and the session has ended, else the previous trading day's close.
 */
export function lastMarketClose(now: DateInput): {
  dateKey: string;
  ms: number;
  kind: SessionKind;
} {
  const ms = toMs(now);
  const today = istDateKey(ms);
  if (isTradingDay(today) && ms >= sessionCloseMs(today))
    return {
      dateKey: today,
      ms: sessionCloseMs(today),
      kind: sessionType(today),
    };
  const prev = previousTradingDay(today);
  return { dateKey: prev, ms: sessionCloseMs(prev), kind: sessionType(prev) };
}

/** Human reason for a non-trading day, for the brief's deck line. */
export function nonTradingReason(x: DateInput): string | null {
  const key = istDateKey(x);
  const t = sessionType(key);
  if (t === "holiday") return `Market closed — ${NSE_HOLIDAYS_2026[key]}`;
  if (t === "weekend") return "Market closed — weekend";
  return null;
}
