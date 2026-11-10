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

function significantWords(name: string): string[] {
  return name
    .split(" ")
    .filter((word) => word.length >= 5 && !GENERIC.has(word));
}

/** The first two distinctive words of a name or alias. A later word is not the company. */
function identityWords(row: CompanyName): string[] {
  const out: string[] = [];
  const add = (name: string) => {
    for (const word of significantWords(name).slice(0, 2)) {
      if (!out.includes(word)) out.push(word);
    }
  };
  add(normalizeCompanyName(row.name));
  for (const alias of row.aliases) add(normalizeCompanyName(alias));
  return out;
}

function nameWords(row: CompanyName): string[] {
  return [
    ...normalizeCompanyName(row.name).split(" "),
    ...row.aliases.flatMap((alias) => normalizeCompanyName(alias).split(" ")),
  ].filter(Boolean);
}

function marksSymbol(word: string, symbol: string): boolean {
  const sym = normalizeCompanyName(symbol).replace(/ /g, "");
  if (word.length < 4 || sym.length < 2) return false;
  return sym.startsWith(word) || word.startsWith(sym);
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
    for (const word of identityWords(row)) {
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
    for (const word of identityWords(row)) {
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
      if (!symbol) continue;
      if (!nameWords(row).some((word) => word.startsWith(token))) continue;
      const named = identityWords(row).some((word) => word.startsWith(token));
      if (named || marksSymbol(token, symbol)) hits.add(symbol);
    }
    if (hits.size === 1) {
      const symbol = [...hits][0];
      if (symbol) remember(symbol, token.length);
    }
  }

  return [...scores.keys()];
}

function sentencesOf(say: string): string[] {
  return say
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function rowBySymbol(
  rows: CompanyName[],
  symbol: string,
): CompanyName | undefined {
  const key = symbol.trim().toUpperCase();
  return rows.find((row) => row.symbol.trim().toUpperCase() === key);
}

function exciseCompany(text: string, row: CompanyName): string {
  const brand = significantWords(normalizeCompanyName(row.name))[0] ?? "";
  const phrases = [row.symbol, row.name, brand, ...row.aliases];
  let next = text;
  for (const phrase of phrases) {
    const token = phrase.trim();
    if (token.length < 2) continue;
    next = next.replace(
      new RegExp(`(^|[^A-Za-z0-9])${escapeReg(token)}(?=$|[^A-Za-z0-9])`, "gi"),
      "$1",
    );
  }
  return next.replace(/\s+/g, " ").trim();
}

/** Drop a company the tool JSON does not contain. Keep a sentence that also names one it does. */
export function omitCompaniesAbsentFrom(
  say: string,
  facts: unknown,
  rows: CompanyName[],
): string {
  const blob = JSON.stringify(facts ?? null).toUpperCase();
  const kept: string[] = [];
  for (const part of sentencesOf(say)) {
    const hits = companiesMentioned(part, rows);
    const stray = hits.filter((symbol) => !blob.includes(symbol));
    if (!stray.length) {
      kept.push(part);
      continue;
    }
    if (!hits.some((symbol) => blob.includes(symbol))) continue;
    let next = part;
    for (const symbol of stray) {
      const row = rowBySymbol(rows, symbol);
      if (row) next = exciseCompany(next, row);
    }
    if (next) kept.push(next);
  }
  return kept.join(" ").replace(/\s+/g, " ").trim();
}
