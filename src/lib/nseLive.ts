/**
 * Live exchange questions for the composer. Filings, promises, and
 * readings never match. A bare "price" uses the company already in
 * focus. A name the book has not resolved does not borrow that company.
 */

export type LiveAsk =
  | { kind: "quote"; symbol: string }
  | { kind: "index"; indexName: string }
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
  if (!text || BLOCK.test(text)) return null;
  if (isStatus(text)) return { kind: "status" };
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
