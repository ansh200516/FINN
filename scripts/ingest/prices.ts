/**
 * ingest:prices — NSE UDiFF bhavcopies → `prices` for every company in the DB.
 *
 *   pnpm ingest:prices --days 70            # last ~70 calendar days of trading sessions
 *   pnpm ingest:prices --from 2026-09-01 --to 2026-11-08
 *   pnpm ingest:prices --date 2026-11-06    # one session
 *   pnpm ingest:prices --upstox             # fill missing sessions from Upstox (FINN_UPSTOX_FALLBACK=true)
 *   pnpm ingest:prices --export             # write data/seed/fixtures/prices-<date>.json (bars in the DB for the range)
 *
 * Owner: Builder A. Same code path as the API job (engine/ingest/prices.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { detectAnomalies } from "@/engine/analyse/anomalies";
import { listCompanies } from "@/engine/ingest/companies";
import {
  ingestPriceRange,
  ingestPrices,
  loadBarsMany,
} from "@/engine/ingest/prices";
import { logger } from "@/lib/logger";
import { addDaysKey, istDateKey, lastMarketClose } from "@/lib/time";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "70" },
      from: { type: "string" },
      to: { type: "string" },
      date: { type: "string" },
      upstox: { type: "boolean", default: false },
      export: { type: "boolean", default: false },
      anomalies: { type: "boolean", default: true },
    },
  });
  const t0 = Date.now();
  const now = Date.now();
  const toKey = values.to ?? lastMarketClose(now).dateKey;
  const fromKey = values.from ?? addDaysKey(toKey, -Number(values.days));

  if (values.date) {
    const s = await ingestPrices(values.date);
    console.log(
      `${values.date}: ${s.inserted} inserted · ${s.updated} updated · ${s.skipped ? "skipped" : "ok"} ${s.errors.join(" ")}`,
    );
  } else {
    if (values.upstox) process.env.FINN_UPSTOX_FALLBACK = "true";
    const r = await ingestPriceRange(fromKey, toKey, { upstox: values.upstox });
    logger.info(
      {
        job: "prices",
        from: fromKey,
        to: toKey,
        ...r.summary,
        missing: r.missing,
        upstoxFilled: r.upstoxFilled,
        ms: r.elapsedMs,
      },
      "ingest:prices done",
    );
    console.log(
      `${fromKey} → ${toKey}: ${r.days.length} trading days · ${r.summary.inserted} bars inserted · ${r.summary.updated} updated · missing ${r.missing.length ? r.missing.join(",") : "none"} · upstox filled ${r.upstoxFilled} · ${(r.elapsedMs / 1000).toFixed(1)} s`,
    );
    if (r.summary.errors.length)
      console.log(`errors: ${r.summary.errors.slice(0, 5).join(" | ")}`);
  }

  const companies = await listCompanies();
  const barsBy = await loadBarsMany(
    companies.map((c) => c.isin),
    fromKey,
    toKey,
  );
  if (values.anomalies) {
    const rows: Array<{
      symbol: string;
      date: string;
      kind: string;
      value: number;
      summary: string;
    }> = [];
    for (const c of companies) {
      for (const a of detectAnomalies(barsBy.get(c.isin) ?? []))
        rows.push({
          symbol: c.nseSymbol,
          date: a.date,
          kind: a.kind,
          value: a.value,
          summary: a.summary,
        });
    }
    rows.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || Math.abs(b.value) - Math.abs(a.value),
    );
    console.log(`anomalies (2.0× volume / ±5%): ${rows.length}`);
    console.table(rows.slice(0, 40));
  }
  if (values.export) {
    const dir = join(process.cwd(), "data", "seed", "fixtures");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `prices-${istDateKey(now)}.json`);
    const all = [...barsBy.values()].flat();
    writeFileSync(file, JSON.stringify(all));
    console.log(`exported ${all.length} bars → ${file}`);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
