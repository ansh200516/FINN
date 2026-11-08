/**
 * ingest:prices — CLI entry (placeholder). Same code path as the API job.
 * Usage: pnpm ingest:prices [--since YYYY-MM-DD] [--symbol SYM] [--export]
 * Owner: Builder A. Parse args with node:util parseArgs; call engine/ingest.
 */
import { logger } from "@/lib/logger";

async function main(): Promise<void> {
  logger.info(
    { job: "prices", argv: process.argv.slice(2) },
    "ingest:prices not implemented",
  );
  throw new Error("not implemented: scripts/ingest/prices.ts");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
