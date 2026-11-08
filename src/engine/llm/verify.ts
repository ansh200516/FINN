/**
 * Code gates for LLM output. Pure functions, no I/O.
 *
 * - verifyQuote: a quote must be an exact substring of the source after
 *   whitespace / quote / dash normalisation. Returns the offset in the
 *   normalised source (see normalizeForMatch) or null.
 * - groundNumbers: every number token in `text` must also occur in
 *   `sourceText`. Returns the tokens that do not.
 */

const QUOTE_MAP: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\u2032": "'",
  "\u2033": '"',
  "\u00AB": '"',
  "\u00BB": '"',
};
const DASH_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]/g;
const QUOTE_RE =
  /[\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\u2032\u2033\u00AB\u00BB]/g;
const SPACE_RE = /[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/g;

/** Normalise for matching: NFKC, straight quotes, ASCII hyphen, single spaces, trimmed. Case is preserved. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(QUOTE_RE, (c) => QUOTE_MAP[c] ?? c)
    .replace(DASH_RE, "-")
    .replace(/\u2026/g, "...")
    .replace(SPACE_RE, " ")
    .trim();
}

/**
 * Exact-substring gate. Returns the character offset of `quote` inside the
 * normalised `sourceText`, or null. Leading/trailing quote marks and a trailing
 * full stop on the quote are tolerated (models often add them).
 */
export function verifyQuote(quote: string, sourceText: string): number | null {
  const src = normalizeForMatch(sourceText);
  let q = normalizeForMatch(quote);
  if (!q) return null;
  q = q.replace(/^["']+|["']+$/g, "").trim();
  if (!q) return null;
  let i = src.indexOf(q);
  if (i < 0 && /[.…]$/.test(q)) i = src.indexOf(q.replace(/[.…]+$/, "").trim());
  if (i < 0 && q.startsWith("...")) i = src.indexOf(q.slice(3).trim());
  return i >= 0 ? i : null;
}

/**
 * Number token regex:
 *   optional "(" for negatives, optional sign, digits with optional
 *   Indian (1,23,456) or Western (123,456) grouping, optional decimals,
 *   optional ")" and optional "%". Must not be glued to a letter on the left
 *   (so Q2, FY26, H1, A1 are skipped) and not followed by a letter/digit.
 */
const NUMBER_RE =
  /(?<![A-Za-z0-9.])\(?[-+\u2212]?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?\)?%?(?![A-Za-z0-9])/g;

export interface NumberToken {
  /** as it appeared */
  raw: string;
  /** canonical numeric value (negatives from parentheses or sign) */
  value: number;
  /** true when the token carried a % sign */
  percent: boolean;
}

export function extractNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const t = normalizeForMatch(text);
  for (const m of t.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const percent = raw.endsWith("%");
    const neg =
      raw.startsWith("(") || /^[-\u2212]/.test(raw.replace(/^\(/, ""));
    const digits = raw.replace(/[()%+\-\u2212,]/g, "");
    if (!digits) continue;
    const value = Number(digits) * (neg ? -1 : 1);
    if (!Number.isFinite(value)) continue;
    out.push({ raw, value, percent });
  }
  return out;
}

/**
 * Returns the number tokens in `text` whose value does not occur anywhere in
 * `sourceText` (grouping-insensitive, sign-aware, exact value match).
 * An empty array means every number is grounded.
 */
export function groundNumbers(text: string, sourceText: string): string[] {
  const have = new Set<number>();
  for (const n of extractNumbers(sourceText)) {
    have.add(n.value);
    // a source "(1,234)" also grounds a text "-1,234" and vice-versa; absolute values are
    // deliberately NOT cross-grounded (sign errors are real errors)
  }
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const n of extractNumbers(text)) {
    if (have.has(n.value)) continue;
    if (seen.has(n.raw)) continue;
    seen.add(n.raw);
    missing.push(n.raw);
  }
  return missing;
}
