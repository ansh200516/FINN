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
  "open_company",
] as const;

export type FinnieTool = (typeof FINNIE_TOOLS)[number];

export const FINNIE_OUT_OF_CALLS =
  "Finnie is out of model calls until 13:30 IST";
export const FINNIE_MODEL_DOWN = "Finnie could not reach the model.";

export const MAX_TOOL_CALLS = 4;

export interface ToolArgs {
  symbol?: string;
  which?: string;
  name?: string;
  scope?: string;
  kind?: string;
  params?: {
    pct?: number;
    ratio?: number;
    lookbackDays?: number;
    categories?: string[];
    pattern?: string;
    flags?: string;
  };
}

export type BookChange = "added" | "already_in" | "removed";

/** A card built from a tool result. The model does not write this. */
export type FinnieCard =
  | {
      kind: "portfolio";
      names: Array<{ symbol: string; name: string; aliases: string[] }>;
    }
  | { kind: "reply"; symbol: string; reply: CompanyReply };

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
  href: string | null;
  link: string | null;
  symbol: string | null;
  book: BookChange | null;
}
