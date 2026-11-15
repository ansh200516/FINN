/**
 * Pair a results filing's title with the quarter the XBRL grid actually is.
 * A September filing must not wear a June grid's "Exchange XBRL verified" badge.
 * No quarter is invented when that period is not stored.
 */
import {
  fiscalQuarterOf,
  makePeriod,
  parsePeriodLabel,
} from "@/engine/extract/transcript";
import type { ResultsCard } from "@/engine/types";
import { quarterLabel } from "@/lib/format";

const MONTH: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function quarterEnd(year: number, month: number): string | null {
  if (month < 1 || month > 12 || year < 1990 || year > 2100) return null;
  const { fy, q } = fiscalQuarterOf(year, month - 1);
  return makePeriod("quarter", fy, q).end;
}

function fromParts(day: number, month: number, year: number): string | null {
  if (day < 1 || day > 31) return null;
  return quarterEnd(year, month);
}

/**
 * Quarter-end ('YYYY-MM-DD') named by a filing title, or null when the title
 * does not name a quarter. "Q2 FY27 results filed" and "quarter ended 30 Sep
 * 2026" both resolve to 2026-09-30.
 */
export function quotedPeriodEnd(text: string): string | null {
  const flat = text.replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const label = flat.match(
    /\b((?:Q\s*[1-4]|[1-4]\s*Q)\s*,?\s*(?:FY|F\.Y\.)\s*(?:\d{4}(?:\s*[-/–—]\s*\d{2,4})?|\d{2}(?:\s*[-/–—]\s*\d{2})?|\d{2}))\b/i,
  );
  if (label?.[1]) {
    const parsed = parsePeriodLabel(label[1].replace(/\s+/g, " ").trim());
    if (parsed?.kind === "quarter") return parsed.end;
  }
  const dmy = flat.match(
    /\b(?:quarter|period)\b[^.]{0,48}?\bended\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/i,
  );
  if (dmy) {
    const month = MONTH[(dmy[2] ?? "").toLowerCase()];
    if (month) return fromParts(Number(dmy[1]), month, Number(dmy[3]));
  }
  const mdy = flat.match(
    /\b(?:quarter|period)\b[^.]{0,48}?\bended\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (mdy) {
    const month = MONTH[(mdy[1] ?? "").toLowerCase()];
    if (month) return fromParts(Number(mdy[2]), month, Number(mdy[3]));
  }
  const numeric = flat.match(
    /\b(?:quarter|period)\b[^.]{0,48}?\bended\s+(\d{1,2})[-./](\d{1,2})[-./](\d{4})\b/,
  );
  if (numeric)
    return fromParts(
      Number(numeric[1]),
      Number(numeric[2]),
      Number(numeric[3]),
    );
  if (/result/i.test(flat)) {
    const looseDmy = flat.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b/,
    );
    if (looseDmy) {
      const month = MONTH[(looseDmy[2] ?? "").toLowerCase()];
      if (month)
        return fromParts(Number(looseDmy[1]), month, Number(looseDmy[3]));
    }
    const looseMdy = flat.match(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
    if (looseMdy) {
      const month = MONTH[(looseMdy[1] ?? "").toLowerCase()];
      if (month)
        return fromParts(Number(looseMdy[2]), month, Number(looseMdy[3]));
    }
  }
  return null;
}

/** True when the grid is the quarter the filing title names, or the title names none. */
export function gridMatchesFiling(
  card: Pick<ResultsCard, "periodEnd" | "fiscalLabel">,
  filingTitle?: string | null,
): boolean {
  if (!filingTitle?.trim()) return true;
  const end = quotedPeriodEnd(filingTitle);
  if (!end) return true;
  if (card.periodEnd?.slice(0, 10) === end) return true;
  const compact = (card.fiscalLabel ?? "").replace(/\s+/g, "").toLowerCase();
  if (!compact) return false;
  return compact === quarterLabel(end).replace(/\s+/g, "").toLowerCase();
}

/**
 * Quarters to build a card from. Null when the title names a quarter that is
 * not in the stored rows — the caller must not draw a different quarter.
 */
export function quartersUpToFiling<T extends { periodEnd: string }>(
  quarters: T[],
  title: string,
): T[] | null {
  const end = quotedPeriodEnd(title);
  if (!end) return quarters;
  if (!quarters.some((q) => q.periodEnd.slice(0, 10) === end)) return null;
  return quarters.filter((q) => q.periodEnd.slice(0, 10) <= end);
}
