import { verifyQuote } from "@/engine/llm/verify";

export interface ExtractedPage {
  page: number;
  text: string;
}

/**
 * PDF page a citation should open.
 *
 * A guidance row stores the page its speaker turn started on. The quote can
 * sit later in that turn. When the quote is on exactly one extracted page,
 * that page is the link. When the stored page itself contains the quote, it
 * stays, including when the same sentence also appears elsewhere. When the
 * quote is on no extracted page, or on several pages and not the stored one,
 * the stored page is kept.
 */
export function pageForQuote(
  quote: string,
  pages: readonly ExtractedPage[],
  storedPage: number | null,
): number | null {
  const hits = new Set<number>();
  for (const p of pages) {
    if (verifyQuote(quote, p.text) !== null) hits.add(p.page);
  }
  if (hits.size === 1) {
    for (const page of hits) return page;
  }
  if (storedPage != null && hits.has(storedPage)) return storedPage;
  return storedPage;
}
