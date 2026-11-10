/**
 * Repairs a bubble from the tool JSON. The model still writes the sentence.
 * These steps only put back periods, surfaces, and counts the payload already has.
 */

interface Fact {
  tool: string;
  data: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function quartersOf(facts: Fact[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const fact of facts) {
    if (fact.tool !== "get_results") continue;
    const data = record(fact.data);
    const quarters = data?.quarters;
    if (!Array.isArray(quarters)) continue;
    for (const quarter of quarters) {
      const row = record(quarter);
      if (row && typeof row.period === "string" && row.period) out.push(row);
    }
  }
  return out;
}

function filingsOf(facts: Fact[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const fact of facts) {
    if (fact.tool !== "get_brief") continue;
    const data = record(fact.data);
    const filings = data?.filings;
    if (!Array.isArray(filings)) continue;
    for (const filing of filings) {
      const row = record(filing);
      if (row) out.push(row);
    }
  }
  return out;
}

function briefSymbol(facts: Fact[]): string | null {
  for (const fact of facts) {
    if (fact.tool !== "get_brief") continue;
    const data = record(fact.data);
    const symbol = data?.symbol;
    if (typeof symbol === "string" && symbol.trim()) return symbol.trim();
  }
  return null;
}

const DECISION = "The decision is yours.";

function sentenceParts(say: string): string[] {
  const clean = say.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length > 1) return sentences;
  const marked = clean.replace(
    /([^.!?])\s+(?=For\s+Q[1-4]\s*FY\s*\d{2}\b)/gi,
    "$1. ",
  );
  return marked
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Several quarters, each with the headline lines, written out as prose. */
export function isQuarterWall(say: string): boolean {
  const periods = say.match(/\bQ[1-4]\s*FY\s*\d{2}\b/gi) ?? [];
  const metrics = say.match(/\b(revenue|ebitda|pbt|pat|nii|ppop)\b/gi) ?? [];
  return periods.length >= 2 && metrics.length >= 4;
}

/**
 * The model listed the quarter figures. The table built from the tool JSON
 * is the answer, so the recital is not shown.
 */
export function isNumberWall(say: string): boolean {
  if (!isQuarterWall(say)) return false;
  const sentences = say
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length >= 3) return true;
  const figures = say.match(/\d[\d,.]*/g) ?? [];
  return figures.length >= 12;
}

/**
 * A quarter-by-quarter recital is two sentences on screen.
 * The figures stay in the results table, which is built from the tool JSON.
 */
export function clipQuarterWall(say: string): string {
  const clean = say.replace(/\s+/g, " ").trim();
  if (!clean || !isQuarterWall(clean)) return clean;
  const parts = sentenceParts(clean);
  if (parts.length <= 2) return parts.join(" ");
  const decision = parts.find((part) => part.includes(DECISION));
  if (!decision) return parts.slice(0, 2).join(" ");
  const lead = parts.find((part) => !part.includes(DECISION));
  return [lead, decision].filter(Boolean).join(" ");
}

function judgmentSentence(filing: Record<string, unknown>): string {
  const symbol = typeof filing.symbol === "string" ? filing.symbol : "";
  const sentence =
    typeof filing.sentence === "string"
      ? filing.sentence.replace(/\s+/g, " ").trim().replace(/[.]+$/g, "")
      : "";
  const surface = filing.surface === "card" ? "a card" : "one line";
  const who = symbol && sentence ? `${symbol} ${sentence}` : symbol || sentence;
  return `${who} earns ${surface}.`.replace(/\s+/g, " ").trim();
}

/**
 * A card-or-line question has to say which. An empty filings array names the
 * company. A short "no filing" is replaced when the payload has a surface.
 */
export function stateFilingSurface(say: string, facts: Fact[]): string {
  const filings = filingsOf(facts);
  const symbol = briefSymbol(facts);
  const thin = say.trim().length < 40;
  const denies = /no filing/i.test(say);
  if (filings.length && (denies || thin)) {
    return judgmentSentence(filings[0] ?? {});
  }
  if (!filings.length && symbol && thin) {
    return `${symbol} has no filing in the window, so there is no card or one line.`;
  }
  return say;
}

function dropListedDenial(say: string, facts: Fact[]): string {
  if (!quartersOf(facts).length) return say;
  const kept = say
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !/is not an NSE-listed/i.test(part));
  return kept.join(" ");
}

/** Counts and sentences already on the brief, with no invented total. */
export function groundedBrief(facts: Fact[]): string {
  const parts: string[] = [];
  for (const fact of facts) {
    const data = record(fact.data);
    if (!data) continue;
    const act = Array.isArray(data.act) ? data.act : [];
    for (const item of act) {
      const row = record(item);
      if (!row) continue;
      const symbol = typeof row.symbol === "string" ? row.symbol : "";
      const sentence = typeof row.sentence === "string" ? row.sentence : "";
      if (symbol && sentence) parts.push(`${symbol} ${sentence}`.trim());
    }
    if (typeof data.filedAway === "number") {
      parts.push(`${data.filedAway} filed away.`);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function repairSay(say: string, facts: Fact[]): string {
  const next = clipQuarterWall(
    stateFilingSurface(dropListedDenial(say, facts), facts),
  );
  if (next.trim()) return next.replace(/\s+/g, " ").trim();
  if (quartersOf(facts).length) return "The quarters are in the table.";
  return groundedBrief(facts);
}
