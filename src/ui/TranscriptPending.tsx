import { formatIst } from "@/lib/time";

/**
 * Whether the company ledger should say a transcript is still due.
 *
 * `getLedger` attaches this deadline as `coverage.pending.expectedBy`
 * (SEBI: five working days after the results broadcast). The line is only
 * for a company that holds calls and is actually waiting. A recovered
 * cover letter means the call is already in. An annual-report-only name
 * has no concall, so the date would be invented.
 */
export interface TranscriptPendingCoverage {
  holdsConcalls: boolean;
  pending: {
    period: string;
    expectedBy: number | null;
  } | null;
}

export function transcriptPendingExpectedBy(
  coverage: TranscriptPendingCoverage | null,
  /** The pending period's only transcript is a cover letter with a recovered PDF. */
  coverRecovered: boolean,
): number | null {
  if (!coverage?.holdsConcalls || coverRecovered) return null;
  const expectedBy = coverage.pending?.expectedBy;
  return typeof expectedBy === "number" ? expectedBy : null;
}

/**
 * Status line for one row in the company documents list.
 * `null` omits the row (a duplicate filing). A cover letter is not a
 * download still in progress; `pending` stays "fetch pending".
 */
export function documentRowStatus(textStatus: string): string | null {
  if (textStatus === "duplicate") return null;
  if (textStatus === "ok") return "text extracted";
  if (textStatus === "failed")
    return "could not read (scanned?) — open the PDF";
  if (textStatus === "cover_only") return "cover letter only";
  return "fetch pending";
}

/** One receipt line on the paper page. No glyph — the words are the status. */
export function TranscriptPending({
  expectedBy,
  className = "",
}: {
  expectedBy: number;
  className?: string;
}) {
  const date = formatIst(expectedBy, "d MMM yyyy");
  return (
    <p className={className ? `receipt ${className}` : "receipt"}>
      Transcript pending · expected by {date}
    </p>
  );
}
