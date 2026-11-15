/**
 * Brief window resolution — pure. The URL carries `?w=24h|48h|7d|30d|close`
 * or `?from=YYYY-MM-DD&to=YYYY-MM-DD`; nothing in the URL means "auto"
 * (24 h, widened by the page when the window is empty).
 */
import {
  addDaysKey,
  formatIst,
  istDateKey,
  istTimeOn,
  lastMarketClose,
  NSE_HOLIDAYS_2026,
  nonTradingReason,
  sessionType,
} from "@/lib/time";
import type { BriefWindow, WindowPreset } from "./model";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface WindowQuery {
  w?: string;
  from?: string;
  to?: string;
}

export interface ResolvedWindow extends BriefWindow {
  /** true when nothing was asked for and the page may widen an empty window */
  auto: boolean;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day. `9999-99-99` matches the shape and must not be used. */
function calendarKey(key: string): boolean {
  if (!DATE_KEY.test(key)) return false;
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isPreset(w: string): w is Exclude<WindowPreset, "custom"> {
  return (
    w === "24h" || w === "48h" || w === "7d" || w === "30d" || w === "close"
  );
}

export function presetWindow(now: number, preset: WindowPreset): BriefWindow {
  switch (preset) {
    case "48h":
      return { fromMs: now - 48 * HOUR, toMs: now, label: "Last 48 h", preset };
    case "7d":
      return { fromMs: now - 7 * DAY, toMs: now, label: "Last 7 days", preset };
    case "30d":
      return {
        fromMs: now - 30 * DAY,
        toMs: now,
        label: "Last 30 days",
        preset,
      };
    case "close": {
      const c = lastMarketClose(now);
      return {
        fromMs: c.ms,
        toMs: now,
        label: `Since ${formatIst(c.ms, "EEE")} close`,
        preset,
      };
    }
    default:
      return {
        fromMs: now - 24 * HOUR,
        toMs: now,
        label: "Last 24 h",
        preset: "24h",
      };
  }
}

export function resolveWindow(now: number, q: WindowQuery): ResolvedWindow {
  const fromOk = q.from && calendarKey(q.from) ? q.from : null;
  const toOk = q.to && calendarKey(q.to) ? q.to : null;
  if (fromOk) {
    let start = fromOk;
    let end = toOk ?? istDateKey(now);
    if (start > end) {
      const swap = start;
      start = end;
      end = swap;
    }
    const fromMs = istTimeOn(start, "00:00");
    const toMs = Math.min(now, istTimeOn(addDaysKey(end, 1), "00:00"));
    const sameMonth = start.slice(0, 7) === end.slice(0, 7);
    const label = sameMonth
      ? `${formatIst(start, "d")}–${formatIst(end, "d MMM")}`
      : `${formatIst(start, "d MMM")} – ${formatIst(end, "d MMM")}`;
    return { fromMs, toMs, label, preset: "custom", auto: false };
  }
  // A date was supplied and it is not a calendar day. Stay on 24h; do not throw
  // and do not let the empty window widen into 7d or 30d.
  if (q.from || q.to) return { ...presetWindow(now, "24h"), auto: false };
  const w = q.w;
  if (w && isPreset(w)) return { ...presetWindow(now, w), auto: false };
  // An unknown preset is not a request to widen. Only a bare visit is auto.
  if (w) return { ...presetWindow(now, "24h"), auto: false };
  return { ...presetWindow(now, "24h"), auto: true };
}

/** The order in which an empty auto window widens. */
export function widenSequence(now: number): WindowPreset[] {
  const seq: WindowPreset[] = [];
  const c = lastMarketClose(now);
  // "since close" is only a widening if it reaches further back than 24 h
  if (c.ms < now - 24 * HOUR) seq.push("close");
  seq.push("7d", "30d");
  return seq;
}

/**
 * The window as it reads inside a sentence — never `label.toLowerCase()`,
 * which would turn "Since Fri close" into "since fri close" and "1–8 Nov"
 * into "1–8 nov".
 *   24h → "the last 24 h" · close → "since Friday's close" · custom → "1–8 Nov"
 */
export function windowLabelInSentence(w: BriefWindow): string {
  switch (w.preset) {
    case "24h":
      return "the last 24 h";
    case "48h":
      return "the last 48 h";
    case "7d":
      return "the last 7 days";
    case "30d":
      return "the last 30 days";
    case "close":
      return `since ${formatIst(w.fromMs, "EEEE")}’s close`;
    default:
      return w.label;
  }
}

/** One sentence explaining an auto-widened window, with the calendar reason. */
export function widenedSentence(now: number, to: BriefWindow): string {
  const todayKey = istDateKey(now);
  const todayKind = sessionType(todayKey);
  const tomorrowKey = addDaysKey(todayKey, 1);
  const reasons: string[] = [];
  const todayReason = nonTradingReason(todayKey);
  if (todayKind === "weekend") reasons.push("quiet weekend");
  else if (todayKind === "special")
    reasons.push("Muhurat session only — no regular trading today");
  else if (todayReason) reasons.push(todayReason.toLowerCase());
  if (NSE_HOLIDAYS_2026[tomorrowKey])
    reasons.push(
      `market closed ${formatIst(tomorrowKey, "EEE d MMM")} (${NSE_HOLIDAYS_2026[tomorrowKey]})`,
    );
  const why = reasons.length ? ` · ${reasons.join(" · ")}` : "";
  return `Nothing filed in the last 24 h — showing ${windowLabelInSentence(to)}${why}`;
}
