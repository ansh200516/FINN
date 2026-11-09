/**
 * Promise-ledger counts for a decision sentence. Pure. Superseded rows are
 * earlier drafts of a promise, so they do not count as a miss, a cut, or an
 * open promise. No model call.
 */
export interface LedgerCounts {
  missed: number;
  cut: number;
  open: number;
  kept: number;
  beat: number;
  /** every row, including superseded */
  rows: number;
}

export const EMPTY_LEDGER: LedgerCounts = {
  missed: 0,
  cut: 0,
  open: 0,
  kept: 0,
  beat: 0,
  rows: 0,
};

export function tallyLedger(
  rows: Array<{ verdict: string | null; status: string; n?: number }>,
): LedgerCounts {
  const c: LedgerCounts = { ...EMPTY_LEDGER };
  for (const r of rows) {
    const n = r.n ?? 1;
    c.rows += n;
    if (r.status === "superseded") continue;
    if (r.status === "open") c.open += n;
    if (r.verdict === "missed") c.missed += n;
    else if (r.verdict === "cut") c.cut += n;
    else if (r.verdict === "kept") c.kept += n;
    else if (r.verdict === "beat") c.beat += n;
  }
  return c;
}
