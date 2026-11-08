/**
 * ingest:results — quarterly results from NSE XBRL (owner: Builder B).
 *
 *   pnpm ingest:results                         all companies (DB `companies`, else data/seed/portfolio.json)
 *   pnpm ingest:results --symbols RELIANCE,HDFCBANK
 *   pnpm ingest:results --symbols X --isin INE… (symbol not in the lists: ISIN read from the XBRL if omitted)
 *   pnpm ingest:results --prelim <pdf url|path> --symbol HDFCBANK [--period-end 2026-09-30] [--basis standalone] [--llm]
 *
 * Flags: --dry-run (no DB writes) · --no-legacy · --max-quarters N (default 12) · --json (print cards as JSON)
 *        --report (tag sets per taxonomy, pass rates, quirks, timing) · --export [--export-path p] (data/seed/results.json)
 *
 * Same code path as the API job: engine/ingest/results.ingestResults + engine/analyse/results.buildResultsCard.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { db } from "@/db/client";
import { companies } from "@/db/schema";
import { buildResultsCard } from "@/engine/analyse/results";
import { extractResultsFromPdf } from "@/engine/extract/results-pdf";
import { fiscalQuarter, xbrlIsin } from "@/engine/ingest/parse-xbrl";
import {
  type IngestResultsReport,
  ingestResults,
  loadResultsQuarters,
  upsertResultsQuarter,
} from "@/engine/ingest/results";
import {
  downloadXbrl,
  listIntegratedFilings,
} from "@/engine/sources/nse-results";
import type { ResultsBasis, ResultsCard, ResultsQuarter } from "@/engine/types";
import { logger } from "@/lib/logger";

const log = logger.child({ mod: "scripts/ingest/results" });

interface Target {
  symbol: string;
  isin: string | null;
  name?: string;
}

const { values: args } = parseArgs({
  options: {
    symbols: { type: "string" },
    symbol: { type: "string" },
    isin: { type: "string" },
    prelim: { type: "string" },
    "period-end": { type: "string" },
    basis: { type: "string" },
    llm: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "no-legacy": { type: "boolean", default: false },
    "max-quarters": { type: "string" },
    json: { type: "boolean", default: false },
    report: { type: "boolean", default: false },
    export: { type: "boolean", default: false },
    "export-path": { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: true,
});

function cr(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return (v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function crNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

async function resolveTargets(): Promise<Target[]> {
  const wanted = (args.symbols ?? args.symbol ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  let known: Target[] = [];
  try {
    const rows = await db.select().from(companies);
    known = rows.map((r) => ({
      symbol: r.nseSymbol.toUpperCase(),
      isin: r.isin,
      name: r.name,
    }));
  } catch (e) {
    log.warn(
      { err: e instanceof Error ? e.message : String(e) },
      "companies table unavailable",
    );
  }
  if (known.length === 0) {
    const seedPath = join(process.cwd(), "data", "seed", "portfolio.json");
    if (existsSync(seedPath)) {
      const raw = JSON.parse(readFileSync(seedPath, "utf8")) as {
        companies?: Array<{ isin: string; nseSymbol: string; name: string }>;
      };
      known = (raw.companies ?? []).map((c) => ({
        symbol: c.nseSymbol.toUpperCase(),
        isin: c.isin,
        name: c.name,
      }));
      log.info(
        { n: known.length },
        "companies loaded from data/seed/portfolio.json",
      );
    }
  }
  if (wanted.length === 0) return known;
  return wanted.map((s) => {
    const k = known.find((c) => c.symbol === s);
    return (
      k ?? {
        symbol: s,
        isin: args.isin && wanted.length === 1 ? args.isin.toUpperCase() : null,
      }
    );
  });
}

/** For symbols we do not know: read the ISIN fact from the latest XBRL. */
async function discoverIsin(symbol: string): Promise<string | null> {
  const filings = await listIntegratedFilings(symbol);
  const first = filings[0];
  if (!first) return null;
  const xml = await downloadXbrl(first.xbrlUrl);
  return xbrlIsin(xml);
}

function printCard(
  target: Target,
  card: ResultsCard | null,
  quarters: ResultsQuarter[],
): void {
  const head = `${target.symbol}${target.name ? ` — ${target.name}` : ""}`;
  if (!card) {
    console.log(`\n${head}: no card (${quarters.length} quarters)`);
    return;
  }
  const v = card.verification;
  console.log(`\n${head}`);
  console.log(
    `  ${card.fiscalLabel} (${card.periodEnd}) · ${card.basisLabel} · ${card.variant} · ${card.checksum} · identities ${v?.identitiesPassed ? "✓" : "✗"}${v?.h1Check === undefined ? "" : ` · YTD ${v.h1Check ? "✓" : "✗"}`} · ${card.quartersAvailable} quarters on this basis`,
  );
  console.log(
    `  ${"metric".padEnd(13)}${"current".padStart(10)}${"QoQ".padStart(9)}${"YoY".padStart(9)}${"prev Q".padStart(10)}${"yoy Q".padStart(10)}${"margin".padStart(9)}`,
  );
  for (const r of card.headline ?? []) {
    console.log(
      `  ${r.label.padEnd(13)}${crNum(r.currentCr).padStart(10)}${pct(r.qoqPct).padStart(9)}${pct(r.yoyPct).padStart(9)}${crNum(r.prevQuarterCr).padStart(10)}${crNum(r.yoyQuarterCr).padStart(10)}${(r.marginPct === null ? "—" : `${r.marginPct.toFixed(1)}%`).padStart(9)}`,
    );
  }
  if (card.variant === "corporate")
    console.log(
      `  EBITDA incl. other income: ${crNum(card.ebitdaInclOtherIncomeCr)} cr · EPS ${card.epsCurrent ?? "—"} (yoy ${card.epsYoy ?? "—"})`,
    );
  if (card.gnpaPct !== null && card.gnpaPct !== undefined)
    console.log(
      `  GNPA ${card.gnpaPct.toFixed(2)}% · NNPA ${card.nnpaPct?.toFixed(2) ?? "—"}%`,
    );
  for (const n of v?.notes ?? []) console.log(`  · ${n}`);
  console.log(`  source: ${card.sourceUrl}`);
}

async function runPrelim(): Promise<void> {
  const input = args.prelim as string;
  const symbol = (args.symbol ?? args.symbols ?? "").toUpperCase();
  const targets = await resolveTargets();
  const t = targets.find((x) => x.symbol === symbol);
  const isin = t?.isin ?? args.isin?.toUpperCase() ?? null;
  if (!isin) throw new Error("--prelim needs --symbol (known) or --isin");
  const bytes = existsSync(input) ? new Uint8Array(readFileSync(input)) : input;
  const t0 = Date.now();
  const res = await extractResultsFromPdf(bytes, {
    isin,
    sourceUrl: typeof bytes === "string" ? bytes : `file:${input}`,
    periodEnd: args["period-end"],
    preferBasis: args.basis as ResultsBasis | undefined,
    allowLlm: Boolean(args.llm),
  });
  if (!res) {
    console.log(
      `prelim: rejected (${Date.now() - t0} ms) — nothing verified; see reasons in the log above`,
    );
    return;
  }
  console.log(
    `prelim: ${res.quarters.length} quarter(s) + ${res.comparatives.length} comparatives from ${res.pages} pages via ${res.method} in ${Date.now() - t0} ms · confidence ${res.confidence}`,
  );
  for (const r of res.reasons) console.log(`  · ${r}`);
  for (const q of [...res.quarters, ...res.comparatives]) {
    console.log(
      `  ${fiscalQuarter(q.periodEnd).label} ${q.basis.padEnd(12)} rev ${cr(q.revenue)} · OI ${cr(q.otherIncome)} · PBT ${cr(q.pbt)} · tax ${cr(q.tax)} · PAT ${cr(q.pat)}${q.checks.nii !== undefined ? ` · NII ${cr(q.checks.nii)} · PPOP ${cr(q.checks.ppop)}` : ""} · ids ${Object.values(q.checks.identities ?? {}).every(Boolean) ? "✓" : "✗"}${q.checks.warnings.filter((w) => /repaired/.test(w)).length ? ` · repaired: ${q.checks.warnings.filter((w) => /repaired/.test(w)).join("; ")}` : ""}`,
    );
  }
  if (!args["dry-run"]) {
    let n = 0;
    for (const q of [...res.quarters, ...res.comparatives]) {
      const o = await upsertResultsQuarter(q);
      if (o !== "skipped") n++;
    }
    console.log(
      `  upserted ${n} row(s) (xbrl/legacy rows are never overwritten by pdf)`,
    );
  }
  if (args.json) console.log(JSON.stringify(res.quarters, null, 2));
  const all = args["dry-run"]
    ? [...res.quarters, ...res.comparatives]
    : await loadResultsQuarters(isin);
  printCard(
    t ?? { symbol, isin },
    buildResultsCard(all, args.basis as ResultsBasis | undefined),
    all,
  );
}

async function main(): Promise<void> {
  if (args.help) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
    return;
  }
  if (args.prelim) {
    await runPrelim();
    return;
  }
  const targets = await resolveTargets();
  if (targets.length === 0)
    throw new Error("no companies: pass --symbols or seed the companies table");
  const reports: IngestResultsReport[] = [];
  const cards: Array<{ symbol: string; card: ResultsCard | null }> = [];
  const exportRows: ResultsQuarter[] = [];
  const started = Date.now();
  for (const t of targets) {
    let isin = t.isin;
    if (!isin) {
      isin = await discoverIsin(t.symbol).catch(() => null);
      if (!isin) {
        console.log(
          `\n${t.symbol}: could not resolve ISIN (no XBRL filing found)`,
        );
        continue;
      }
      log.info({ symbol: t.symbol, isin }, "isin discovered from xbrl");
    }
    const rep = await ingestResults(isin, t.symbol, {
      includeLegacy: !args["no-legacy"],
      maxQuarters: args["max-quarters"] ? Number(args["max-quarters"]) : 12,
      dryRun: Boolean(args["dry-run"]),
    });
    reports.push(rep);
    const quarters = args["dry-run"]
      ? rep.quarters
      : await loadResultsQuarters(isin);
    exportRows.push(...quarters);
    const card = buildResultsCard(
      quarters,
      args.basis as ResultsBasis | undefined,
    );
    cards.push({ symbol: t.symbol, card });
    printCard({ ...t, isin }, card, quarters);
    const perBasis = ["consolidated", "standalone"]
      .map((b) => `${b[0]}=${quarters.filter((q) => q.basis === b).length}`)
      .join(" ");
    console.log(
      `  ingest: ${rep.fetched} filings · +${rep.inserted} ~${rep.updated} =${rep.skipped} · quarters ${perBasis} · taxonomy ${rep.taxonomies.join("/")} · identities ${(rep.identityPassRate * 100).toFixed(1)}% · ${rep.timingMs.total} ms (list ${rep.timingMs.list}, dl ${rep.timingMs.download}, parse ${rep.timingMs.parse}, db ${rep.timingMs.db})${rep.errors.length ? ` · errors: ${rep.errors.join(" | ")}` : ""}`,
    );
    if (args.json && card) console.log(JSON.stringify(card, null, 2));
  }

  if (args.report) {
    console.log("\n==== REPORT ====");
    const tags: Record<string, Set<string>> = {};
    for (const r of reports)
      for (const [k, v] of Object.entries(r.tagsByTaxonomy))
        for (const t of v) {
          let set = tags[k];
          if (!set) {
            set = new Set();
            tags[k] = set;
          }
          set.add(t);
        }
    for (const [k, v] of Object.entries(tags))
      console.log(
        `\n${k} (${v.size} distinct quarter-context tags):\n  ${[...v].sort().join(", ")}`,
      );
    const totalFilings = reports.reduce((s, r) => s + r.fetched, 0);
    const totalQ = reports.reduce((s, r) => s + r.quarters.length, 0);
    const fails = reports.flatMap((r) =>
      r.identityFailures.map(
        (f) => `${r.symbol} ${f.periodEnd} ${f.basis}: ${f.failed.join(",")}`,
      ),
    );
    const h1 = cards.map((c) => ({
      s: c.symbol,
      h: c.card?.verification?.h1Check,
    }));
    console.log(
      `\nfilings ${totalFilings} · quarters parsed ${totalQ} · companies ${reports.length} · elapsed ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    console.log(
      `identity pass rate (all quarters): ${(100 * (reports.reduce((s, r) => s + r.identityPassRate * Math.max(1, r.quarters.length), 0) / Math.max(1, totalQ))).toFixed(2)}%`,
    );
    console.log(
      `identity failures: ${fails.length ? fails.join(" | ") : "none"}`,
    );
    console.log(
      `YTD (H1/9M/FY) checks: ✓ ${h1.filter((x) => x.h === true).length} · ✗ ${
        h1
          .filter((x) => x.h === false)
          .map((x) => x.s)
          .join(",") || 0
      } · n/a ${h1.filter((x) => x.h === undefined).length}`,
    );
    console.log(
      `quirks:\n  ${reports.flatMap((r) => r.quirks.map((q) => `${r.symbol}: ${q}`)).join("\n  ") || "none"}`,
    );
    console.log(
      `errors:\n  ${reports.flatMap((r) => r.errors.map((e) => `${r.symbol}: ${e}`)).join("\n  ") || "none"}`,
    );
  }

  if (args.export || args["export-path"]) {
    const path =
      args["export-path"] ??
      join(process.cwd(), "data", "seed", "results.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        { generated_at: new Date().toISOString(), rows: exportRows },
        null,
        1,
      ),
    );
    console.log(`\nexported ${exportRows.length} rows → ${path}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
