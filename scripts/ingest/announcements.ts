/**
 * ingest:announcements — per-symbol NSE windows → announcements → classify →
 * dedupe → events (+ one-liners / bios within the LLM budget).
 *
 *   pnpm ingest:announcements --days 30                 # every company in the DB
 *   pnpm ingest:announcements --days 7 --symbol RELIANCE,INFY
 *   pnpm ingest:announcements --no-llm                  # rules only (no Gemini)
 *   pnpm ingest:announcements --llm-max 20              # cap real Flash-Lite calls this run
 *   pnpm ingest:announcements --no-attachments          # skip PDF downloads
 *   pnpm ingest:announcements --export                  # also write data/seed/fixtures/announcements-<date>.json
 *
 * Owner: Builder A. Same code path as the API job (engine/ingest/announcements.ts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fetchAndIngestAnnouncements } from "@/engine/ingest/announcements";
import { logger } from "@/lib/logger";
import { istDateKey } from "@/lib/time";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "30" },
      symbol: { type: "string" },
      "no-llm": { type: "boolean", default: false },
      "llm-max": { type: "string", default: "30" },
      "no-attachments": { type: "boolean", default: false },
      "max-attachments": { type: "string", default: "80" },
      "no-backfill": { type: "boolean", default: false },
      export: { type: "boolean", default: false },
    },
  });
  const days = Number(values.days);
  const symbols = (values.symbol ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const budget = { remaining: Number(values["llm-max"]) };
  const t0 = Date.now();
  const r = await fetchAndIngestAnnouncements({
    days,
    symbols: symbols.length ? symbols : undefined,
    llm: !values["no-llm"],
    llmBudget: budget,
    attachments: !values["no-attachments"],
    maxAttachments: Number(values["max-attachments"]),
    bioBackfill: !values["no-backfill"],
  });
  const ing = r.ingest;
  logger.info(
    {
      job: "announcements",
      fetched: r.raw.length,
      fetchMs: r.fetchMs,
      ingest: ing,
      ms: Date.now() - t0,
    },
    "ingest:announcements done",
  );
  console.log(
    `fetched ${r.raw.length} rows from ${Object.keys(r.perSymbol).length} symbols in ${(r.fetchMs / 1000).toFixed(1)} s`,
  );
  if (r.fetchErrors.length)
    console.log(`fetch errors: ${r.fetchErrors.join(" | ")}`);
  if (ing) {
    console.log(
      `announcements: ${ing.inserted} inserted · ${ing.updated} updated · ${ing.reposts} exact re-posts · ${ing.attachmentsFetched} attachments downloaded`,
    );
    console.log(
      `events: ${ing.events} (T1 ${ing.eventsByTier[1]} · T2 ${ing.eventsByTier[2]} · T3 ${ing.eventsByTier[3]}) · cards with fields ${ing.cardsWithFields} · bios ${ing.biosFound} · LLM calls ${ing.llmCalls} · ${(ing.elapsedMs / 1000).toFixed(1)} s`,
    );
    console.log(
      `events by category: ${Object.entries(ing.eventsByCategory)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")}`,
    );
    if (ing.errors.length)
      console.log(
        `errors (${ing.errors.length}): ${ing.errors.slice(0, 5).join(" | ")}`,
      );
  }
  if (values.export) {
    const dir = join(process.cwd(), "data", "seed", "fixtures");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `announcements-raw-${istDateKey(Date.now())}.json`);
    writeFileSync(file, JSON.stringify(r.raw, null, 1));
    console.log(`exported ${r.raw.length} raw rows → ${file}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
