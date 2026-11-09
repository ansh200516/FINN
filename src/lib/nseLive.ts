/**
 * Exchange questions for the composer. Filings, promises, and readings
 * never match. A bare "price" or "corporate actions" uses the company
 * already in focus. A name the book has not resolved does not borrow
 * that company. A dated index close is one end-of-day level, not a
 * return series.
 */

export type LiveAsk =
  | { kind: "quote"; symbol: string }
  | { kind: "index"; indexName: string }
  | { kind: "index-close"; indexName: string; date: string }
  | { kind: "actions"; symbol: string; scope: "all" | "capital" }
  | { kind: "status" }
  | { kind: "needs-symbol"; bare: boolean };

const SYMBOL = /^[A-Z0-9&.-]{1,20}$/;

const NOT_A_TICKER = new Set([
  "a",
  "an",
  "the",
  "price",
  "share",
  "shares",
  "live",
  "current",
  "latest",
  "what",
  "whats",
  "what's",
  "where",
  "show",
  "me",
  "get",
  "please",
  "market",
  "nifty",
  "open",
  "closed",
  "nse",
  "stock",
  "index",
  "level",
  "quote",
  "ltp",
  "cmp",
  "now",
  "today",
  "right",
  "of",
  "is",
  "bank",
]);

/** Research, rules, and opinion. These stay on filings or the rule parser. */
const BLOCK =
  /\b(?:alert|notify|notifies|move|moves|moved|results?|promises?|guidance|filings?|balance|cash|debt|revenue|profit|margin|ebitda|transcript|annual|xbrl|verdict|outlook|capex|dividends?|announcements?|announced|versus|compare|compared|history|average|averages)\b|\bvs\b/;

const INDEXES: Array<[string, string]> = [
  ["bank nifty", "NIFTY BANK"],
  ["nifty bank", "NIFTY BANK"],
  ["nifty it", "NIFTY IT"],
  ["india vix", "INDIA VIX"],
  ["nifty 50", "NIFTY 50"],
  ["nifty50", "NIFTY 50"],
  ["nifty", "NIFTY 50"],
];

const ACTION_STOP = new Set([
  "a",
  "an",
  "the",
  "any",
  "check",
  "recent",
  "latest",
  "last",
  "corporate",
  "show",
  "list",
  "were",
  "there",
  "please",
  "for",
  "of",
  "on",
  "me",
  "what",
  "whats",
  "what's",
  "splits",
  "split",
  "bonus",
  "bonuses",
  "ex",
  "actions",
  "action",
  "date",
  "dates",
]);

const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const MONTH_NUM: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const ALL_TAIL =
  /^(?:please\s+)?(?:(?:what are|what's|whats|show(?:\s+me)?|list|were there(?:\s+any)?|any)\s+)?(?:the\s+)?(?:recent\s+|latest\s+)?(?:corporate actions?|splits?\s+bonuses?(?:\s+or\s+dividends?)?)(?:\s+(?:for|of|on)\s+([a-z0-9&.-]{1,20}))?$/;

const ALL_LEAD =
  /^(?:please\s+)?([a-z0-9&.-]{1,20})\s+(?:corporate actions?|splits?\s+bonuses?(?:\s+or\s+dividends?)?)$/;

const CAP_TAIL =
  /^(?:please\s+)?(?:(?:any|check(?:\s+for)?|were there(?:\s+any)?|show(?:\s+me)?)\s+)?(?:the\s+)?(?:splits?(?:\s+or\s+bonuses?)?|bonuses?(?:\s+or\s+splits?)?|splits?\s+and\s+bonuses?|ex-?dates?|ex\s+dates?)(?:\s+(?:for|of|on)\s+([a-z0-9&.-]{1,20}))?(?:\s+too)?$/;

const CAP_LEAD =
  /^(?:please\s+)?([a-z0-9&.-]{1,20})\s+(?:splits?(?:\s+or\s+bonuses?)?|bonuses?(?:\s+or\s+splits?)?|ex-?dates?|ex\s+dates?)$/;

const DATED_NOISE =
  /\b(?:history|average|averages|compare|compared|versus|results?|promises?|guidance|filings?|dividends?|announcements?|announced)\b|\bvs\b/;

const BARE =
  /^(?:please\s+)?(?:(?:what is|whats|what's|where is)\s+)?(?:the\s+)?(?:live\s+|current\s+|latest\s+)?(?:share\s+)?(?:price|ltp|cmp|quote)(?:\s+of)?(?:\s+now|\s+today|\s+right now)?$/;

const PRICE_OF =
  /^(?:please\s+)?(?:(?:what is|whats|what's)\s+)?(?:the\s+)?(?:live\s+|current\s+|latest\s+)?(?:share\s+)?(?:price|ltp|cmp|quote)\s+of\s+([a-z0-9&.-]{1,20})(?:\s+now|\s+today)?$/;

const TICKER_PRICE =
  /^(?:please\s+)?([a-z0-9&.-]{1,20})\s+(?:share\s+)?(?:price|ltp|cmp|quote)(?:\s+now|\s+today)?$/;

const NAMED_PRICE =
  /^(?:please\s+)?(?:[a-z0-9&.-]+\s+){1,4}(?:share\s+)?(?:price|ltp|cmp|quote)(?:\s+now|\s+today)?$/;

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(/[?!;:()[\]"]/g, " ")
    .replace(/[^a-z0-9%&.'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStatus(text: string): boolean {
  if (
    /^(?:is|are)\s+(?:the\s+)?(?:nse\s+|cash\s+|stock\s+)?market\s+(?:open|closed)(?:\s+now|\s+today|\s+right now)?$/.test(
      text,
    )
  )
    return true;
  if (
    /^(?:is|are)\s+(?:the\s+)?nse\s+(?:open|closed)(?:\s+now|\s+today)?$/.test(
      text,
    )
  )
    return true;
  const core = text
    .replace(/^(?:please\s+)+/, "")
    .replace(/^(?:what is|whats|what's)\s+/, "")
    .replace(/^(?:the\s+)+/, "")
    .trim();
  return /^(?:nse\s+)?market\s+(?:open|closed|status)$/.test(core);
}

function matchIndex(text: string): string | null {
  const core = text
    .replace(/^(?:please\s+)+/, "")
    .replace(
      /^(?:what is|whats|what's|where is|show me|show|get me|get)\s+/,
      "",
    )
    .replace(/^(?:the\s+)+/, "")
    .replace(/^(?:live|current|latest)\s+/, "")
    .replace(/\s+(?:price|level|quote|index|now|today|right now)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const [key, name] of INDEXES) if (core === key) return name;
  return null;
}

function matchActions(text: string, hint: string | null): LiveAsk | null {
  const allLead = ALL_LEAD.exec(text);
  if (allLead) return finishAction(allLead[1], hint, "all");
  const allTail = ALL_TAIL.exec(text);
  if (allTail) return finishAction(allTail[1], hint, "all");
  const capLead = CAP_LEAD.exec(text);
  if (capLead) return finishAction(capLead[1], hint, "capital");
  const capTail = CAP_TAIL.exec(text);
  if (capTail) return finishAction(capTail[1], hint, "capital");
  return null;
}

function finishAction(
  token: string | undefined,
  hint: string | null,
  scope: "all" | "capital",
): LiveAsk {
  const explicit = actionTicker(token);
  if (explicit) return { kind: "actions", symbol: explicit, scope };
  const hinted = asSymbol(hint?.toLowerCase());
  if (hinted) return { kind: "actions", symbol: hinted, scope };
  return { kind: "needs-symbol", bare: true };
}

function actionTicker(token: string | undefined): string | null {
  if (!token || ACTION_STOP.has(token)) return null;
  return asSymbol(token);
}

function indexOnDate(text: string): { indexName: string; date: string } | null {
  if (DATED_NOISE.test(text)) return null;
  const found = findDate(text);
  if (!found) return null;
  let core = `${text.slice(0, found.index)} ${text.slice(found.index + found.length)}`;
  core = core
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please\s+)+/, "")
    .replace(
      /^(?:what is|whats|what's|where is|where did|where was|what did|what was|how did|show me|show|get me|get)\s+/,
      "",
    )
    .replace(/^(?:the\s+)+/, "")
    .replace(/\s+(?:on|as of)\s*$/g, "")
    .replace(/\s+(?:close|level|price|value|index)(?:\s+at)?\s*$/g, "")
    .replace(/\s+(?:on|as of)\s*$/g, "")
    .trim();
  for (const [key, name] of INDEXES) {
    if (core === key) return { indexName: name, date: found.iso };
  }
  return null;
}

function findDate(
  text: string,
): { iso: string; index: number; length: number } | null {
  const re = new RegExp(
    `\\b(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\s+(?:${MONTH_ALT})\\s+\\d{4}|\\d{1,2}-(?:${MONTH_ALT})-\\d{4})\\b`,
    "g",
  );
  let found: { iso: string; index: number; length: number } | null = null;
  for (const m of text.matchAll(re)) {
    const token = m[1];
    if (!token || m.index == null) continue;
    const iso = parseDateToken(token);
    if (!iso) continue;
    found = { iso, index: m.index, length: token.length };
  }
  return found;
}

function parseDateToken(token: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
  if (iso?.[1] && iso[2] && iso[3])
    return validIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const hy = /^(\d{1,2})-([a-z]+)-(\d{4})$/.exec(token);
  const spaced = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(token);
  const hit = hy ?? spaced;
  if (!hit?.[1] || !hit[2] || !hit[3]) return null;
  const month = MONTH_NUM[hit[2]];
  if (!month) return null;
  return validIso(Number(hit[3]), month, Number(hit[1]));
}

function validIso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  )
    return null;
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function asSymbol(token: string | undefined): string | null {
  if (!token || NOT_A_TICKER.has(token)) return null;
  const symbol = token.toUpperCase();
  return SYMBOL.test(symbol) ? symbol : null;
}

function priceAsk(
  text: string,
): { explicit: string } | "bare" | "named" | null {
  const of = PRICE_OF.exec(text);
  const explicitOf = asSymbol(of?.[1]);
  if (explicitOf) return { explicit: explicitOf };
  const lead = TICKER_PRICE.exec(text);
  const explicit = asSymbol(lead?.[1]);
  if (explicit) return { explicit };
  if (BARE.test(text)) return "bare";
  if (NAMED_PRICE.test(text)) return "named";
  return null;
}

/**
 * Classify one composer sentence. `hint` is the NSE symbol already in
 * focus (the company named in the sentence, or the open company).
 */
export function classifyLiveAsk(
  raw: string,
  hint: string | null,
): LiveAsk | null {
  const text = normalize(raw);
  if (!text) return null;
  if (isStatus(text)) return { kind: "status" };
  const actions = matchActions(text, hint);
  if (actions) return actions;
  const dated = indexOnDate(text);
  if (dated) return { kind: "index-close", ...dated };
  if (BLOCK.test(text)) return null;
  const indexName = matchIndex(text);
  if (indexName) return { kind: "index", indexName };
  const price = priceAsk(text);
  if (!price) return null;
  if (price === "named") return { kind: "needs-symbol", bare: false };
  if (price !== "bare") return { kind: "quote", symbol: price.explicit };
  const symbol = hint?.trim().toUpperCase() ?? "";
  if (!SYMBOL.test(symbol)) return { kind: "needs-symbol", bare: true };
  return { kind: "quote", symbol };
}

/** True when the company thread should call NSE instead of grounded Ask. */
export function isLiveTurn(raw: string): boolean {
  const live = classifyLiveAsk(raw, null);
  if (!live) return false;
  if (live.kind === "needs-symbol") return live.bare;
  return true;
}
