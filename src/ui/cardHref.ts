import type { CompanyReply } from "@/lib/companyTurn";
import { readingId } from "./readingId";

/** Where the full card lives. Chat keeps a short copy; this is the page. */
export function cardHref(reply: CompanyReply, symbol: string): string | null {
  const sym = symbol.trim().toUpperCase();
  const company = sym ? `/c/${encodeURIComponent(sym)}` : null;
  switch (reply.kind) {
    case "results":
      return company ? `${company}#results` : null;
    case "promises":
      return company ? `${company}#ledger` : null;
    case "reading":
      return company ? `${company}#${readingId(reply.block.title)}` : null;
    case "rule":
      return "/alerts";
    case "nse":
      return company;
    default:
      return null;
  }
}

export function cardLinkLabel(href: string, symbol: string): string {
  if (href.startsWith("/alerts")) return "Alerts";
  if (href.startsWith("/e/")) return "The filing";
  if (href === "/" || href.startsWith("/?")) return "The brief";
  if (href.includes("#ledger")) return "Promise ledger";
  if (href.includes("#results")) return "Full results";
  if (href.includes("#reading-")) return "From the filings";
  if (symbol) return `Open ${symbol}`;
  return "Open";
}

/** A one-line lead when the card itself is a grid or a list. */
export function cardLead(reply: CompanyReply): string | null {
  switch (reply.kind) {
    case "results":
      return reply.card ? "Latest results." : null;
    case "promises":
      return reply.rows.length ? "Scored promises." : null;
    default:
      return null;
  }
}
