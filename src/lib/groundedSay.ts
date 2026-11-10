/**
 * Numbers in a bubble have to appear in the tool JSON or the question.
 * Array length is not a count field. A sum of two fields is not a field.
 */

interface NumberToken {
  raw: string;
  value: number;
  decimals: number;
  pct: boolean;
}

export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const re = /(?<![A-Za-z])(\d[\d,]*)(\.\d+)?%?/g;
  for (const match of text.matchAll(re)) {
    const whole = (match[1] ?? "").replace(/,/g, "");
    const frac = match[2] ?? "";
    if (!/^\d+$/.test(whole)) continue;
    const value = Number(whole + frac);
    if (!Number.isFinite(value)) continue;
    out.push({
      raw: match[0] ?? "",
      value,
      decimals: frac.startsWith(".") ? frac.length - 1 : 0,
      pct: (match[0] ?? "").endsWith("%"),
    });
  }
  return out;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Numeric fields and numbers written inside strings. Not array lengths. */
function walkFields(value: unknown, into: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.push(value);
    return;
  }
  if (typeof value === "string") {
    for (const token of numberTokens(value)) into.push(token.value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkFields(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) walkFields(item, into);
  }
}

function matches(token: NumberToken, value: number): boolean {
  if (value === token.value) return true;
  const rounded = roundTo(value, token.decimals);
  if (rounded !== token.value) return false;
  return token.decimals > 0 || token.pct || Math.abs(token.value) >= 50;
}

/**
 * The say tokenizer drops a leading minus, so −15.25 in the JSON grounds
 * the token 15.25. The grader sees that minus in the stringified payload.
 */
function numberIsGrounded(token: NumberToken, pool: number[]): boolean {
  for (const value of pool) {
    if (matches(token, value) || matches(token, -value)) return true;
  }
  return false;
}

function poolFor(question: string, facts: unknown): number[] {
  const pool: number[] = [];
  walkFields(facts, pool);
  for (const token of numberTokens(question)) pool.push(token.value);
  return pool;
}

export function ungroundedNumbers(
  say: string,
  question: string,
  facts: unknown,
): string[] {
  const pool = poolFor(question, facts);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of numberTokens(say)) {
    if (numberIsGrounded(token, pool) || seen.has(token.raw)) continue;
    seen.add(token.raw);
    out.push(token.raw);
  }
  return out;
}

function sentences(say: string): string[] {
  return say
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Drop each sentence that still states a number the tool JSON did not return. */
export function dropUngroundedSentences(
  say: string,
  question: string,
  facts: unknown,
): string {
  const pool = poolFor(question, facts);
  const kept = sentences(say).filter((sentence) =>
    numberTokens(sentence).every((token) => numberIsGrounded(token, pool)),
  );
  return kept.join(" ").replace(/\s+/g, " ").trim();
}
