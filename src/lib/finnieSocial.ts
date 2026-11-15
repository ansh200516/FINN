/**
 * Greetings and other chat that is not a company, a price, a result,
 * a promise, or a rule. Answered here. The model is not called.
 */
export const FINNIE_SOCIAL =
  "Hey. Ask me for a result, a promise, a price, or a rule from the filings.";

const RESEARCH =
  /\b(?:results?|promises?|guidances?|prices?|quotes?|ltp|cmp|rules?|alerts?|filings?|portfolio|nifty|shares?)\b/;

const SOCIAL =
  /^(?:(?:hey+|hi+|hello+|howdy|yo|sup|hola|namaste|good\s+(?:morning|afternoon|evening|night))(?:\s+there)?(?:\s+(?:finnie|finn|babe|baby|buddy|friend|bro|dude|dear|yaar))?|thanks(?:\s+(?:a\s+lot|so\s+much|finnie|finn|babe))?|thank\s+you(?:\s+(?:so\s+much|finnie|finn))?|thx|ty|bye+|goodbye|good\s+bye|see\s+you|cya|how\s+are\s+you|how\s+r\s+u|what'?s\s+up|whats\s+up|how'?s\s+it\s+going|ok(?:ay)?|cool|nice|great|lol|lmao|haha+|hehe|hmm+|nm)$/;

function fold(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The capability reply, or null when the sentence might be a real question. */
export function socialReply(raw: string): string | null {
  const text = fold(raw);
  if (!text || RESEARCH.test(text) || !SOCIAL.test(text)) return null;
  return FINNIE_SOCIAL;
}
