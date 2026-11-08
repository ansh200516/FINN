/**
 * ingest:documents — discover + download + extract + structure company documents.
 *
 *   pnpm ingest:documents --symbols SUPREMEIND,INFY [--kinds transcript,annual_report]
 *                         [--quarters 6] [--ar 2] [--force] [--discover-only] [--screener] [--json]
 *   pnpm ingest:documents --relabel [--symbols …] [--dry-run]   recompute transcript periods from (publish date, text)
 *   pnpm ingest:documents --dedupe  [--symbols …] [--dry-run]   mark cross-source duplicates, migrate their guidance
 *   pnpm ingest:documents --reclassify [--symbols …] [--dry-run] cover-letter-only / not-a-transcript detection + recovery
 *
 * Same code path as the API job (engine/ingest/documents). Owner: Builder C.
 * screener.in is consulted only with --screener or FINN_ALLOW_SCREENER=true.
 */
import { parseArgs } from "node:util";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { companies } from "@/db/schema";
import {
  dedupeStoredDocuments,
  discoverDocuments,
  ingestDocuments,
  reclassifyTranscripts,
  relabelTranscriptPeriods,
} from "@/engine/ingest/documents";
import type { DocumentKind } from "@/engine/types";
import { logger } from "@/lib/logger";

const log = logger.child({ job: "documents" });

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      symbols: { type: "string" },
      symbol: { type: "string" },
      all: { type: "boolean", default: false },
      kinds: { type: "string", default: "transcript,annual_report" },
      quarters: { type: "string", default: "6" },
      ar: { type: "string", default: "2" },
      force: { type: "boolean", default: false },
      "discover-only": { type: "boolean", default: false },
      "no-screener": { type: "boolean", default: false },
      screener: { type: "boolean", default: false },
      relabel: { type: "boolean", default: false },
      dedupe: { type: "boolean", default: false },
      reclassify: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });

  const symbolList = (values.symbols ?? values.symbol ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const maintenance = values.relabel || values.dedupe || values.reclassify;
  const rows =
    values.all || (maintenance && !symbolList.length)
      ? await db.select().from(companies)
      : symbolList.length
        ? await db
            .select()
            .from(companies)
            .where(inArray(companies.nseSymbol, symbolList))
        : [];

  if (maintenance) {
    const isins = symbolList.length ? rows.map((r) => r.isin) : undefined;
    const write = !values["dry-run"];
    if (values.relabel) {
      const changes = await relabelTranscriptPeriods({ isins, write });
      console.log(
        `\n== relabel (${write ? "applied" : "dry run"}): ${changes.length} change(s)`,
      );
      for (const c of changes)
        console.log(
          `  ${(c.symbol ?? c.isin).padEnd(11)} ${c.docId} ${String(c.from).padEnd(7)} → ${String(c.to).padEnd(7)} ${c.reason}`,
        );
    }
    if (values.reclassify) {
      const changes = await reclassifyTranscripts({ isins, write });
      console.log(
        `\n== reclassify (${write ? "applied" : "dry run"}): ${changes.length} change(s)`,
      );
      for (const c of changes)
        console.log(
          `  ${(c.symbol ?? c.isin).padEnd(11)} ${(c.period ?? "?").padEnd(7)} ${c.docId} ${c.from} → ${c.to} (${c.note})${c.recoveredDocId ? ` recovered→${c.recoveredDocId}` : ""}`,
        );
    }
    if (values.dedupe) {
      const changes = await dedupeStoredDocuments({ isins, write });
      console.log(
        `\n== dedupe (${write ? "applied" : "dry run"}): ${changes.length} duplicate(s)`,
      );
      for (const c of changes)
        console.log(
          `  ${(c.symbol ?? c.isin).padEnd(11)} ${(c.period ?? "?").padEnd(7)} ${c.duplicateId} → ${c.canonicalId} (${c.reason}) guidance moved=${c.guidanceMoved} deleted=${c.guidanceDeleted}`,
        );
    }
    return;
  }

  if (!rows.length) {
    console.error(
      "usage: pnpm ingest:documents --symbols SUPREMEIND,INFY | --all   (companies must be seeded: pnpm db:seed)",
    );
    process.exit(2);
  }
  const missing = symbolList.filter(
    (s) => !rows.some((r) => r.nseSymbol === s),
  );
  for (const m of missing)
    console.error(`unknown symbol (not in companies): ${m}`);

  const kinds = values.kinds.split(",").map((k) => k.trim()) as DocumentKind[];
  const quarters = Number(values.quarters);
  const annualReports = Number(values.ar);
  const useScreener = values["no-screener"]
    ? false
    : values.screener
      ? true
      : undefined;
  const report: unknown[] = [];

  for (const c of rows) {
    const t0 = Date.now();
    if (values["discover-only"]) {
      const disc = await discoverDocuments(c.nseSymbol, c.isin, {
        quarters,
        annualReports,
        useScreener,
      });
      report.push(disc);
      if (!values.json) {
        console.log(
          `\n== ${c.nseSymbol} (${c.isin}) sources=${JSON.stringify(disc.sources)} raw=${JSON.stringify(disc.raw)}${disc.reason ? ` reason="${disc.reason}"` : ""}`,
        );
        for (const d of disc.documents)
          console.log(
            `  ${d.kind.padEnd(13)} ${(d.period ?? "?").padEnd(7)} ${d.source.padEnd(8)} ${d.publishedAtMs ? new Date(d.publishedAtMs).toISOString().slice(0, 10) : "          "} ${d.url}`,
          );
        for (const e of disc.errors) console.log(`  ! ${e}`);
      }
      continue;
    }
    const res = await ingestDocuments(c.isin, kinds, {
      symbol: c.nseSymbol,
      quarters,
      annualReports,
      force: values.force,
      useScreener,
      onProgress: (msg, data) =>
        log.info({ symbol: c.nseSymbol, ...data }, msg),
    });
    const elapsedMs = Date.now() - t0;
    report.push({ symbol: c.nseSymbol, isin: c.isin, elapsedMs, ...res });
    if (!values.json) {
      const d = res.discovery;
      console.log(
        `\n== ${c.nseSymbol} (${c.isin}) discovered=${d?.documents.length ?? "-"} fetched=${res.fetched} inserted=${res.inserted} updated=${res.updated} skipped=${res.skipped} errors=${res.errors.length} ${(elapsedMs / 1000).toFixed(1)}s${d?.reason ? ` reason="${d.reason}"` : ""}`,
      );
      for (const r of res.documents)
        console.log(
          `  ${r.status.padEnd(14)} ${r.kind.padEnd(13)} ${(r.period ?? "?").padEnd(7)} ${r.source.padEnd(8)} pages=${String(r.pages ?? "-").padStart(3)} chars=${String(r.chars ?? "-").padStart(7)} q=${(r.textQuality ?? "-").padEnd(7)} turns=${String(r.turns ?? "-").padStart(3)} mgmt=${String(r.managementTurns ?? "-").padStart(3)} ${(r.elapsedMs / 1000).toFixed(1)}s ${r.id ?? ""}${r.duplicateOf ? ` dup-of ${r.duplicateOf}` : ""}${r.recoveredDocId ? ` recovered→${r.recoveredDocId}` : ""}${r.periodNote ? ` ⚠ ${r.periodNote}` : ""}${r.error ? ` ! ${r.error}` : ""}`,
        );
      for (const e of res.errors) console.log(`  ! ${e}`);
    }
  }
  if (values.json) console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
