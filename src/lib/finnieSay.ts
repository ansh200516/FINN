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

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function quarterSentence(quarter: Record<string, unknown>): string {
  const period = typeof quarter.period === "string" ? quarter.period : "";
  if (!period) return "";
  const bits = [period];
  for (const key of ["revenue", "ebitda", "pbt", "pat"]) {
    const metric = record(quarter[key]);
    if (!metric) continue;
    const label = typeof metric.label === "string" ? metric.label : key;
    const parts = [label];
    if (typeof metric.crore === "number") parts.push(String(metric.crore));
    if (typeof metric.qoqPct === "number") parts.push(`qoq ${metric.qoqPct}`);
    if (typeof metric.yoyPct === "number") parts.push(`yoy ${metric.yoyPct}`);
    if (parts.length > 1) bits.push(parts.join(" "));
  }
  return `${bits.join(", ")}.`;
}

/** Every period in the results payload, not only the latest the model named. */
export function coverQuarters(say: string, facts: Fact[]): string {
  const quarters = quartersOf(facts);
  if (quarters.length < 2) return say;
  const folded = norm(say);
  const missing = quarters
    .filter((quarter) => {
      const period = quarter.period;
      return typeof period === "string" && !folded.includes(norm(period));
    })
    .map(quarterSentence)
    .filter(Boolean);
  if (!missing.length) return say;
  return `${say} ${missing.join(" ")}`.replace(/\s+/g, " ").trim();
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
  const next = coverQuarters(
    stateFilingSurface(dropListedDenial(say, facts), facts),
    facts,
  );
  if (next.trim()) return next.replace(/\s+/g, " ").trim();
  return groundedBrief(facts);
}
