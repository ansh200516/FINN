/** Copy swaps at 8s. The request itself is not aborted. */
export const ASK_WAIT_SLOW_MS = 8_000;

const STILL_READING = "Still reading the filings. This can take a minute.";

/**
 * Receipt line while Ask is in flight. Names the company, then after eight
 * seconds says the read is still going. Static copy: nothing pulses, so
 * reduced motion has no animation to turn off.
 */
export function askWaitCopy(symbol: string, elapsedMs: number): string {
  if (elapsedMs >= ASK_WAIT_SLOW_MS) return STILL_READING;
  const name = symbol.trim();
  return `Reading ${name}’s filings`;
}

function isTimeout(status: number | undefined, error: string): boolean {
  if (status === 408 || status === 504) return true;
  return /\b(?:time-?out|timed out|deadline)\b/i.test(error);
}

/**
 * One sentence when the ask does not return an answer. The question stays
 * in the field; this line only says what happened.
 */
export function askFailureCopy(input: {
  status?: number;
  error?: string | null;
}): string {
  const raw = (input.error ?? "").replace(/\s+/g, " ").trim();
  if (isTimeout(input.status, raw)) return "The ask timed out.";
  if (/daily ask limit reached/i.test(raw))
    return "The daily ask limit is reached.";
  if (/unknown symbol/i.test(raw)) return "That symbol is not on file.";
  if (/model budget exhausted/i.test(raw))
    return "The model budget is exhausted.";
  if (/symbol and question are required/i.test(raw))
    return "A symbol and a question are required.";
  return "The ask failed.";
}
