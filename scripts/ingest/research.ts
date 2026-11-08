/**
 * ingest:research — extract guidance from stored transcripts and settle the promise ledger.
 *
 *   pnpm ingest:research --symbols SUPREMEIND,INFY --guidance [--transcripts 4] [--max-calls 40]
 *   pnpm ingest:research --symbols SUPREMEIND,INFY --ledger
 *   pnpm ingest:research --symbols SUPREMEIND --sections        # annual-report page map
 *
 * Same code path as the API job. Owner: Builder C.
 */
import { parseArgs } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, guidance } from "@/db/schema";
import { settleGuidance } from "@/engine/analyse/ledger";
import {
  extractGuidanceDetailed,
  persistGuidance,
} from "@/engine/extract/guidance";
import { mapSectionsForDocument } from "@/engine/extract/sections";
import { listDocuments, loadDocumentText } from "@/engine/ingest/documents";
import { remainingBudget } from "@/engine/llm/gateway";
import { logger } from "@/lib/logger";

const log = logger.child({ job: "research" });

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      symbols: { type: "string" },
      symbol: { type: "string" },
      all: { type: "boolean", default: false },
      guidance: { type: "boolean", default: false },
      ledger: { type: "boolean", default: false },
      sections: { type: "boolean", default: false },
      transcripts: { type: "string", default: "4" },
      "max-calls": { type: "string", default: "60" },
      "llm-sections": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (!values.guidance && !values.ledger && !values.sections) {
    console.error(
      "nothing to do: pass --guidance and/or --ledger and/or --sections",
    );
    process.exit(2);
  }
  const symbolList = (values.symbols ?? values.symbol ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const rows = values.all
    ? await db.select().from(companies)
    : symbolList.length
      ? await db
          .select()
          .from(companies)
          .where(inArray(companies.nseSymbol, symbolList))
      : [];
  if (!rows.length) {
    console.error(
      "usage: pnpm ingest:research --symbols SUPREMEIND,INFY --guidance --ledger",
    );
    process.exit(2);
  }

  const maxTranscripts = Number(values.transcripts);
  let callsLeft = Number(values["max-calls"]);
  const report: Record<string, unknown>[] = [];

  for (const c of rows) {
    const entry: Record<string, unknown> = {
      symbol: c.nseSymbol,
      isin: c.isin,
    };
    if (values.guidance) {
      const docs = (await listDocuments(c.isin, ["transcript"])).filter(
        (d) => d.textStatus === "ok",
      );
      const perDoc: Record<string, unknown>[] = [];
      let processed = 0;
      for (const d of docs) {
        if (processed >= maxTranscripts) break;
        const doc = await loadDocumentText(d.id);
        if (!doc) continue; // rows without stored pages (fixtures) do not consume a slot
        processed++;
        if (callsLeft <= 0) {
          perDoc.push({
            docId: d.id,
            period: d.period,
            skipped: "call budget exhausted",
          });
          continue;
        }
        const existing = await db
          .select({ id: guidance.id })
          .from(guidance)
          .where(eq(guidance.docId, d.id));
        const t0 = Date.now();
        const r = await extractGuidanceDetailed(
          doc,
          { isin: c.isin, period: d.period },
          { maxCalls: callsLeft },
        );
        callsLeft -= r.calls - r.cached;
        const structure =
          (d.meta?.structureJson
            ? (JSON.parse(d.meta.structureJson) as { callDate?: string | null })
            : {}) ?? {};
        const persisted = await persistGuidance(c.isin, d.id, r.statements, {
          period: r.parsed.period ?? d.period,
          callDate: r.parsed.callDate ?? structure.callDate ?? null,
          publishedAt: d.meta?.publishedAt ?? null,
        });
        const line = {
          docId: d.id,
          period: r.parsed.period ?? d.period,
          chunks: r.chunks,
          calls: r.calls,
          cached: r.cached,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          ...r.stats,
          verbatimPassRate: r.stats.candidates
            ? Math.round(
                ((r.stats.candidates - r.stats.quoteRejected) /
                  r.stats.candidates) *
                  1000,
              ) / 10
            : null,
          inserted: persisted.inserted,
          existingRows: existing.length,
          errors: r.errors,
          ms: Date.now() - t0,
        };
        perDoc.push(line);
        if (!values.json)
          console.log(
            `  ${c.nseSymbol.padEnd(11)} ${(line.period ?? "?").padEnd(7)} chunks=${line.chunks} calls=${line.calls}(cached ${line.cached}) tok=${line.tokensIn}/${line.tokensOut} cand=${line.candidates} quoteRej=${line.quoteRejected} numRej=${line.numberRejected} backRej=${line.backwardRejected} dup=${line.duplicates} kept=${line.kept} adj=${line.adjectival} verbatim=${line.verbatimPassRate ?? "-"}% inserted=${line.inserted} ${(line.ms / 1000).toFixed(1)}s${line.errors.length ? ` ! ${line.errors.join("; ")}` : ""}`,
          );
        if (!values.json)
          for (const s of r.statements)
            console.log(
              `      · ${s.metric} ${s.low ?? "-"}..${s.high ?? "-"} ${s.unit} ${s.horizon ?? "?"} ${s.isExplicit ? "explicit" : "adjectival"} ${s.revision} p${s.page} ${s.speaker ?? "?"}: "${s.quote.slice(0, 110)}${s.quote.length > 110 ? "…" : ""}"`,
            );
      }
      entry.guidance = perDoc;
    }
    if (values.sections) {
      const ars = (await listDocuments(c.isin, ["annual_report"]))
        .filter((d) => d.textStatus === "ok")
        .slice(0, 1);
      const out: unknown[] = [];
      for (const d of ars) {
        const r = await mapSectionsForDocument(d.id, {
          useLlm: values["llm-sections"] && callsLeft > 0,
        });
        if (r?.usedLlm) callsLeft--;
        out.push(r);
        if (!values.json && r)
          console.log(
            `  ${c.nseSymbol.padEnd(11)} AR ${d.period} pages=${r.pages} sections=${r.sections.length} folioOffset=${r.folioOffset ?? "-"} llm=${r.usedLlm}\n      ${r.sections.map((s: { label: string; fromPage: number; toPage: number; confidence: number }) => `${s.label}:${s.fromPage}-${s.toPage}(${s.confidence})`).join("  ")}`,
          );
      }
      entry.sections = out;
    }
    if (values.ledger) {
      const t0 = Date.now();
      const l = await settleGuidance(c.isin);
      entry.ledger = {
        rows: l.rows.length,
        summary: l.summary,
        stats: l.stats,
        ms: Date.now() - t0,
      };
      if (!values.json) {
        console.log(
          `\n== ${c.nseSymbol} ledger — ${l.summary} (${l.rows.length} rows, ${Date.now() - t0} ms)`,
        );
        for (const r of l.rows) {
          const d = r.delivered;
          const promised =
            r.low !== null || r.high !== null
              ? `${fmt(r.low, r.unit)}${r.high !== null && r.high !== r.low ? `–${fmt(r.high, r.unit)}` : ""}${r.unit === "%" ? "%" : ""}`
              : r.direction;
          console.log(
            `  ${(r.verdict ?? r.status).padEnd(14)} ${r.metric.padEnd(16)} ${(r.horizon ?? "?").padEnd(8)} promised ${promised.padEnd(22)} delivered ${d && d.value !== null ? `${fmt(d.value, d.unit)}${d.unit === "%" ? "%" : ""} (${r.settledByQuarter ?? ""})` : "—"}  p${r.page} ${r.speaker ?? ""} · ${String((r.evidence as { note?: string }).note ?? "").slice(0, 90)}`,
          );
          console.log(
            `      "${r.quote.slice(0, 120)}${r.quote.length > 120 ? "…" : ""}"`,
          );
        }
      }
    }
    report.push(entry);
  }
  const budget = await remainingBudget();
  if (values.json) console.log(JSON.stringify({ report, budget }, null, 2));
  else
    console.log(
      `\nLLM budget: ${budget.map((b) => `${b.model} ${b.requests}/${b.cap}`).join(" | ")}`,
    );
  log.info({ companies: rows.length }, "research done");
}

function fmt(v: number | null, unit: string | null): string {
  if (v === null) return "-";
  if (unit === "INR")
    return `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
  if (unit === "USD")
    return `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })} mn`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
