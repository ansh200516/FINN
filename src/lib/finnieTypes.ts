import type { ResultsCard } from "@/engine/types";
import type { CompanyReply } from "@/lib/companyTurn";

export const FINNIE_TOOLS = [
  "list_portfolio",
  "add_to_portfolio",
  "remove_from_portfolio",
  "get_results",
  "get_promises",
  "get_reading",
  "get_quote",
  "get_index",
  "get_corporate_actions",
  "set_alert",
  "disable_alert",
  "open_company",
  "get_brief",
  "list_unread",
  "mark_read",
  "get_upcoming",
  "missed_promises",
  "movers",
  "get_management",
  "compare",
] as const;

export type FinnieTool = (typeof FINNIE_TOOLS)[number];

export const FINNIE_OUT_OF_CALLS = "Finnie is out of calls until 13:30 IST";
export const FINNIE_MODEL_DOWN = "Finnie could not reach the model.";
export const FINNIE_NO_MATCH = "I couldn\u2019t match that to data I have.";
export const FINNIE_DOES_NOT_HAVE = "Finnie does not have that.";
/** Last line after the results, the promises, and the price. Two sentences. */
export const FINNIE_DECISION_LINE =
  "I can only give you the filings and the price. The decision is yours.";

export const MAX_TOOL_CALLS = 4;

export interface ToolArgs {
  symbol?: string;
  symbolA?: string;
  symbolB?: string;
  which?: string;
  name?: string;
  scope?: string;
  kind?: string;
  window?: string;
  pct?: number;
  /** How many results quarters get_results returns. 1–8, default 4. */
  quarters?: number;
  /** false turns the named rule off. A new threshold replaces the saved one. */
  enabled?: boolean;
  params?: {
    pct?: number;
    ratio?: number;
    lookbackDays?: number;
    categories?: string[];
    pattern?: string;
    flags?: string;
  };
}

/** Turns kept on this device. The demo has one user. */
export const FINNIE_LOG_CAP = 30;
/** Prior turns sent with the latest sentence. */
export const FINNIE_CHAIN_CAP = 8;

/** One earlier turn. `results` lists symbols whose results card was drawn. */
export interface FinnieMemory {
  user: string;
  say: string;
  results: string[];
}

export type BookChange = "added" | "already_in" | "removed";

export interface FinnieLine {
  symbol: string;
  text: string;
  href: string;
}

export interface FinniePerson {
  person: string;
  role: string | null;
  action: string | null;
  excerpt: string | null;
}

/** One results quarter the model was given. Money is ₹ crore. */
export interface ChatQuarterMetric {
  label: string;
  crore: number | null;
  yoyPct: number | null;
}

export interface ChatQuarter {
  period: string;
  revenue: ChatQuarterMetric | null;
  ebitda: ChatQuarterMetric | null;
  pat: ChatQuarterMetric | null;
}

/** A card built from a tool result. The model does not write this. */
export type FinnieCard =
  | {
      kind: "portfolio";
      names: Array<{ symbol: string; name: string; aliases: string[] }>;
    }
  | {
      kind: "reply";
      symbol: string;
      reply: CompanyReply;
      quarters?: ChatQuarter[];
    }
  | { kind: "lines"; lines: FinnieLine[] }
  | {
      kind: "compare";
      a: { symbol: string; card: ResultsCard | null };
      b: { symbol: string; card: ResultsCard | null };
    }
  | { kind: "management"; symbol: string; people: FinniePerson[] };

export interface ToolOutcome {
  fact: Record<string, unknown>;
  card: FinnieCard | null;
  symbol: string | null;
  href: string | null;
  link: string | null;
  book: BookChange | null;
}

export interface FinnieTurnResult {
  say: string;
  tools: string[];
  card: FinnieCard | null;
  /** Cards from this turn, in the order the model chose. */
  cards: FinnieCard[];
  /** Page under each card. Same length as `cards`. Null when that card has none. */
  pages: Array<string | null>;
  /** Text links when the model named a symbol and did not choose a card. */
  links: Array<{ href: string; label: string }>;
  /** Cards first, then `say`. Used when the decision is left to the user. */
  sayAfter: boolean;
  href: string | null;
  link: string | null;
  symbol: string | null;
  book: BookChange | null;
}
