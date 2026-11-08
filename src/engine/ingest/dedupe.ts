/**
 * Dedupe & event grouping (pure helpers; the DB side lives in announcements.ts).
 *
 * L0 — exact re-posts: same ISIN and (same attachment URL) or (same normalised
 *      subject + same attachment size within 24 h). Measured at 10.7 % of the
 *      NSE firehose (docs/research/14 §5).
 * L1 — events: same ISIN + category within 48 h of the event's first filing →
 *      one event_key `isin|category|YYYY-MM-DD` (IST day of the first filing).
 *      Results follow-ups (deck, press release, newspaper ad, auditor report,
 *      concall schedule/recording/transcript) fold into the results event when
 *      one exists within RESULTS_FOLLOWUP_WINDOW_MS.
 */
import { istDateKey, parseNseDateTime } from "@/lib/time";
import { parseFileSize } from "../sources/nse-announcements";
import type { AnnouncementRaw, Category, Classification } from "../types";

export const EVENT_WINDOW_MS = 48 * 3_600_000;
export const RESULTS_FOLLOWUP_WINDOW_MS = 10 * 24 * 3_600_000;
export const L0_WINDOW_MS = 24 * 3_600_000;

export function filedAtMs(raw: AnnouncementRaw): number {
  try {
    return parseNseDateTime(raw.an_dt);
  } catch {
    return parseNseDateTime(raw.sort_date);
  }
}

/** Lower-case, strip the "X has informed the Exchange about/regarding" boilerplate, collapse whitespace/punctuation. */
export function normaliseSubject(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /^.{0,80}?has (informed|submitted)( to)? the exchange( about| regarding| that|,)?/i,
      "",
    )
    .replace(/[^a-z0-9%./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pure: build the dedupe key (isin | category | IST date bucket of this filing). */
export function eventKeyFor(raw: AnnouncementRaw, category: string): string {
  const isin = raw.sm_isin || raw.symbol;
  return `${isin}|${category}|${istDateKey(filedAtMs(raw))}`;
}

export function eventKeyAt(
  isin: string,
  category: Category,
  firstAtMs: number,
): string {
  return `${isin}|${category}|${istDateKey(firstAtMs)}`;
}

/** Announcement ids that are exact re-posts of an earlier item in the same list (L0). Keeps the earliest. */
export function findExactReposts(raws: AnnouncementRaw[]): Set<string> {
  const sorted = [...raws].sort(
    (a, b) => filedAtMs(a) - filedAtMs(b) || a.seq_id.localeCompare(b.seq_id),
  );
  const dups = new Set<string>();
  const seen: Array<{
    raw: AnnouncementRaw;
    at: number;
    url: string;
    subj: string;
    size: number | null;
    desc: string;
  }> = [];
  for (const raw of sorted) {
    const at = filedAtMs(raw);
    const url = raw.attchmntFile?.trim() ?? "";
    const subj = normaliseSubject(raw.attchmntText);
    const size = parseFileSize(raw.attFileSize ?? raw.fileSize);
    const desc = raw.desc.toLowerCase();
    const isin = raw.sm_isin || raw.symbol;
    const dup = seen.find((s) => {
      if ((s.raw.sm_isin || s.raw.symbol) !== isin) return false;
      if (at - s.at > L0_WINDOW_MS) return false;
      // same PDF under the same subject category → re-post
      if (url && s.url === url && s.desc === desc) return true;
      // same subject text + same size within 24 h → re-post
      if (subj && s.subj === subj && size !== null && s.size === size)
        return true;
      return false;
    });
    if (dup) dups.add(raw.seq_id);
    else seen.push({ raw, at, url, subj, size, desc });
  }
  return dups;
}

/** Results-related categories/subcategories that attach to a results event instead of forming their own. */
export function isResultsFollowUp(
  cls: Pick<Classification, "category" | "subcategory">,
): boolean {
  if (cls.category === "results")
    return cls.subcategory !== "outcome" && cls.subcategory !== undefined;
  if (cls.category === "earnings_call") return true;
  return false;
}

export interface GroupInput {
  id: string;
  isin: string;
  category: Category;
  subcategory?: string;
  filedAt: number;
}

export interface GroupedEvent {
  eventKey: string;
  isin: string;
  category: Category;
  firstAt: number;
  lastAt: number;
  ids: string[];
}

export interface ExistingEvent {
  eventKey: string;
  isin: string;
  category: Category;
  firstAt: number;
  lastAt: number;
}

/**
 * Pure L1 grouping. `existing` are events already in the DB for these ISINs
 * (recent ones), so incremental runs attach to them instead of creating new
 * keys. Returns one GroupedEvent per key (existing keys are reused).
 */
export function groupIntoEvents(
  items: GroupInput[],
  existing: ExistingEvent[] = [],
): GroupedEvent[] {
  const groups = new Map<string, GroupedEvent>();
  for (const e of existing) {
    groups.set(e.eventKey, {
      eventKey: e.eventKey,
      isin: e.isin,
      category: e.category,
      firstAt: e.firstAt,
      lastAt: e.lastAt,
      ids: [],
    });
  }
  const sorted = [...items].sort(
    (a, b) => a.filedAt - b.filedAt || a.id.localeCompare(b.id),
  );

  const findOpen = (
    isin: string,
    category: Category,
    at: number,
    windowMs: number,
  ): GroupedEvent | undefined => {
    let best: GroupedEvent | undefined;
    for (const g of groups.values()) {
      if (g.isin !== isin || g.category !== category) continue;
      if (at >= g.firstAt - 60_000 && at - g.firstAt <= windowMs) {
        if (!best || g.firstAt > best.firstAt) best = g;
      }
    }
    return best;
  };

  for (const it of sorted) {
    let target: GroupedEvent | undefined;
    if (isResultsFollowUp(it)) {
      target = findOpen(
        it.isin,
        "results",
        it.filedAt,
        RESULTS_FOLLOWUP_WINDOW_MS,
      );
    }
    if (!target)
      target = findOpen(it.isin, it.category, it.filedAt, EVENT_WINDOW_MS);
    if (!target) {
      const key = eventKeyAt(it.isin, it.category, it.filedAt);
      target = groups.get(key) ?? {
        eventKey: key,
        isin: it.isin,
        category: it.category,
        firstAt: it.filedAt,
        lastAt: it.filedAt,
        ids: [],
      };
      groups.set(key, target);
    }
    target.ids.push(it.id);
    target.firstAt = Math.min(target.firstAt, it.filedAt);
    target.lastAt = Math.max(target.lastAt, it.filedAt);
  }
  return [...groups.values()].filter((g) => g.ids.length > 0);
}
