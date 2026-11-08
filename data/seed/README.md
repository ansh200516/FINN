# data/seed

The committed snapshot that makes `pnpm dev` and the production deploy work
with **zero live calls**: `pnpm db:seed` loads every file here into the DB
(idempotent upserts).

Files (JSON, small — keep the folder < 30 MB; no PDFs):

| File | Loaded into | Written by |
|---|---|---|
| `portfolio.json` | `companies` (20 portfolio + 5 ad-hoc, ISIN-keyed, `aliases`) | Builder A / coordinator |
| `prices.json` | `prices` (60 trading days × portfolio) | `pnpm ingest:prices --export` |
| `announcements.json` | `announcements` + `events` (30 days) | `pnpm ingest:announcements --export` |
| `results.json` | `results_quarters` (5–8 quarters each) | `pnpm ingest:results --export` |
| `documents.json`, `guidance.json`, `facts.json`, `research_sections.json` | respective tables | `pnpm ingest:research --export` |
| `llm_cache.json` | `llm_cache` (so the demo never spends quota) | exported from the local DB |

`seed.ts` is the loader. It reads whichever files exist and skips the rest, so
partial snapshots are fine during the build week. Export helpers belong to the
ingest CLIs (`--export` flag) so that seed files are produced by the same code
that writes the DB.
