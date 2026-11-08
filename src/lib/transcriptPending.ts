/**
 * Company-page read of `getLedger`'s `coverage.pending.expectedBy`.
 * Uses `transcriptCoverage` (the call `getLedger` makes) so a view does not
 * re-adjudicate the promise rows the page already reads from the table.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { parseJsonColumn } from "@/db/json";
import * as t from "@/db/schema";
import { transcriptCoverage } from "@/engine/ingest/documents";
import { transcriptPendingExpectedBy } from "@/ui/TranscriptPending";

function recoveredDocId(structureJson: string | null): string | null {
  const structure = parseJsonColumn(
    z.record(z.string(), z.unknown()),
    structureJson,
    {},
  );
  const id = structure.recoveredDocId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** True when this period's transcripts are cover letters and one was recovered. */
async function coverLetterRecovered(
  isin: string,
  period: string,
): Promise<boolean> {
  const rows = await db
    .select({
      textStatus: t.documents.textStatus,
      structureJson: t.documentMeta.structureJson,
    })
    .from(t.documents)
    .leftJoin(t.documentMeta, eq(t.documentMeta.docId, t.documents.id))
    .where(
      and(
        eq(t.documents.isin, isin),
        eq(t.documents.kind, "transcript"),
        eq(t.documents.period, period),
      ),
    );
  const live = rows.filter((r) => r.textStatus !== "duplicate");
  if (!live.length || live.some((r) => r.textStatus === "ok")) return false;
  const covers = live.filter((r) => r.textStatus === "cover_only");
  if (covers.length !== live.length) return false;
  return covers.some((r) => recoveredDocId(r.structureJson) != null);
}

export async function loadTranscriptPendingBy(
  isin: string,
): Promise<number | null> {
  let coverage: Awaited<ReturnType<typeof transcriptCoverage>> | null = null;
  try {
    coverage = await transcriptCoverage(isin);
  } catch {
    return null;
  }
  const period = coverage.pending?.period ?? null;
  const coverRecovered = period
    ? await coverLetterRecovered(isin, period)
    : false;
  return transcriptPendingExpectedBy(coverage, coverRecovered);
}
