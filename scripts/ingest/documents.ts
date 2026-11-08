/**
 * ingest:documents — CLI entry (placeholder). Same code path as the API job.
 * Usage: pnpm ingest:documents [--since YYYY-MM-DD] [--symbol SYM] [--export]
 * Owner: Builder A. Parse args with node:util parseArgs; call engine/ingest.
 */
import { logger } from "@/lib/logger";

async function main(): Promise<void> {
  logger.info(
    { job: "documents", argv: process.argv.slice(2) },
    "ingest:documents not implemented",
  );
  throw new Error("not implemented: scripts/ingest/documents.ts");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
