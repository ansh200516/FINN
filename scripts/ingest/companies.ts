/**
 * ingest:companies — EQUITY_L.csv (ISIN master) ⋈ data/seed/portfolio.json → `companies`.
 *
 *   pnpm ingest:companies                      # load seed (or default 20+5), cached master (24 h)
 *   pnpm ingest:companies --refresh            # force re-download of EQUITY_L.csv
 *   pnpm ingest:companies --adhoc DIXON,ETERNAL # add ad-hoc names (symbol, old symbol or ISIN)
 *
 * Owner: Builder A. Same code path as the API job (engine/ingest/companies.ts).
 */
import { parseArgs } from "node:util";
import { ingestCompanies, listCompanies } from "@/engine/ingest/companies";
import { logger } from "@/lib/logger";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      refresh: { type: "boolean", default: false },
      adhoc: { type: "string" },
      quiet: { type: "boolean", default: false },
    },
  });
  const adhoc = (values.adhoc ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const t0 = Date.now();
  const r = await ingestCompanies({
    refreshMaster: values.refresh,
    adhocSymbols: adhoc,
  });
  const all = await listCompanies();
  logger.info(
    {
      job: "companies",
      ...r.summary,
      masterRows: r.masterRows,
      unresolved: r.unresolved,
      ms: Date.now() - t0,
    },
    "ingest:companies done",
  );
  if (!values.quiet) {
    console.log(
      `master ${r.masterRows} rows · ${r.summary.inserted} inserted · ${r.summary.updated} updated · ${r.summary.errors.length} errors · ${Date.now() - t0} ms`,
    );
    if (r.unresolved.length)
      console.log(`unresolved: ${r.unresolved.join(", ")}`);
    console.table(
      all.map((c) => ({
        symbol: c.nseSymbol,
        isin: c.isin,
        name: c.name.slice(0, 40),
        role: c.inPortfolio ? "portfolio" : c.isAdhoc ? "adhoc" : "-",
        aliases: c.aliases.join("/"),
        industry: (c.industry ?? "").slice(0, 28),
      })),
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
