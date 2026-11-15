/**
 * Names people type that are not the NSE symbol. SBI is State Bank of India.
 * The listing symbol is SBIN. This is not symbol churn (TATAMOTORS → TMPV).
 */
import { mentionsToken } from "@/lib/companyMatch";

export const SPOKEN_SYMBOLS: Readonly<Record<string, string>> = {
  SBI: "SBIN",
};

export function canonicalSymbol(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return SPOKEN_SYMBOLS[upper] ?? upper;
}

/** True when the utterance names this listing, including a spoken alias. */
export function utteranceHasSymbol(utterance: string, symbol: string): boolean {
  if (mentionsToken(utterance, symbol)) return true;
  const wanted = canonicalSymbol(symbol);
  if (wanted && mentionsToken(utterance, wanted)) return true;
  for (const [spoken, current] of Object.entries(SPOKEN_SYMBOLS)) {
    if (current === wanted && mentionsToken(utterance, spoken)) return true;
  }
  return false;
}
