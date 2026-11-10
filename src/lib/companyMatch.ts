/**
 * Symbol, alias, and company-name matching. The chat turn uses this to
 * check a tool symbol. It does not choose a tool.
 */
export interface CompanyName {
  symbol: string;
  name: string;
  aliases: string[];
}

const LEGAL =
  /\b(?:ltd|limited|inc|incorporated|corp|corporation|co|plc|pvt|private|company)\b\.?/g;

/** Standalone words that show up in many names and do not identify one company. */
const GENERIC = new Set([
  "bank",
  "enterprises",
  "enterprise",
  "finance",
  "financial",
  "group",
  "holdings",
  "india",
  "indian",
  "industries",
  "industry",
  "international",
  "labs",
  "limited",
  "motors",
  "power",
  "services",
  "technologies",
  "technology",
]);

export function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(LEGAL, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ +/g, " ");
}

export function mentionsToken(utterance: string, raw: string): boolean {
  const token = normalizeCompanyName(raw);
  if (token.length < 2) return false;
  return ` ${normalizeCompanyName(utterance)} `.includes(` ${token} `);
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Alias, exact name, or a unique name-word prefix. Exact symbols win. */
export function matchCompanyName(
  query: string,
  rows: CompanyName[],
): CompanyName | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const symbol = trimmed.toUpperCase();
  const name = normalizeCompanyName(trimmed);
  const exact = rows.find((row) => row.symbol.trim().toUpperCase() === symbol);
  if (exact) return exact;

  const aliasHits = rows.filter((row) =>
    row.aliases.some((alias) => {
      const token = alias.trim();
      if (!token) return false;
      return (
        token.toUpperCase() === symbol || normalizeCompanyName(token) === name
      );
    }),
  );
  if (aliasHits.length === 1) return aliasHits[0] ?? null;

  if (!name) return null;
  const nameHits = rows.filter(
    (row) => normalizeCompanyName(row.name) === name,
  );
  if (nameHits.length === 1) return nameHits[0] ?? null;

  if (!name.includes(" ") && name.length >= 6) {
    const prefixHits = rows.filter((row) =>
      normalizeCompanyName(row.name)
        .split(" ")
        .some((word) => word.startsWith(name)),
    );
    if (prefixHits.length === 1) return prefixHits[0] ?? null;
    const bySymbol = prefixHits.filter((row) =>
      row.symbol.trim().toUpperCase().startsWith(symbol),
    );
    if (bySymbol.length === 1) return bySymbol[0] ?? null;
  }
  return null;
}

/** Companies whose symbol, alias, or name appears in the utterance. */
export function companiesMentioned(
  utterance: string,
  rows: CompanyName[],
): string[] {
  const folded = normalizeCompanyName(utterance);
  if (!folded) return [];
  const padded = ` ${folded} `;
  const scores = new Map<string, number>();
  const remember = (symbol: string, len: number) => {
    const key = symbol.trim().toUpperCase();
    if (!key || len < 2) return;
    scores.set(key, Math.max(scores.get(key) ?? 0, len));
  };

  const wordOwners = new Map<string, Set<string>>();
  for (const row of rows) {
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol) continue;
    for (const word of normalizeCompanyName(row.name).split(" ")) {
      if (word.length < 5 || GENERIC.has(word)) continue;
      const owners = wordOwners.get(word) ?? new Set<string>();
      owners.add(symbol);
      wordOwners.set(word, owners);
    }
  }

  for (const row of rows) {
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const phrases: string[] = [];
    const name = normalizeCompanyName(row.name);
    if (name.length >= 2) phrases.push(name);
    for (const alias of row.aliases) {
      const aliasName = normalizeCompanyName(alias);
      if (aliasName.length >= 2) phrases.push(aliasName);
    }
    for (const word of name.split(" ")) {
      const owners = wordOwners.get(word);
      if (owners?.size === 1 && owners.has(symbol)) phrases.push(word);
    }
    if (
      new RegExp(
        `(?:^|[^A-Za-z0-9])${escapeReg(symbol)}(?:$|[^A-Za-z0-9])`,
      ).test(utterance)
    ) {
      phrases.push(normalizeCompanyName(symbol));
    }
    for (const phrase of phrases) {
      if (phrase && padded.includes(` ${phrase} `)) {
        remember(symbol, phrase.length);
      }
    }
  }

  for (const token of folded.split(" ")) {
    if (token.length < 8) continue;
    const hits = new Set<string>();
    for (const row of rows) {
      const symbol = row.symbol.trim().toUpperCase();
      const words = [
        ...normalizeCompanyName(row.name).split(" "),
        ...row.aliases.flatMap((alias) =>
          normalizeCompanyName(alias).split(" "),
        ),
      ];
      if (words.some((word) => word.startsWith(token))) hits.add(symbol);
    }
    if (hits.size === 1) {
      const symbol = [...hits][0];
      if (symbol) remember(symbol, token.length);
    }
  }

  return [...scores.keys()];
}
