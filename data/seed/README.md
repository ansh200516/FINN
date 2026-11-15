# data/seed

The committed snapshot that makes `pnpm dev` and the production deploy work
with **zero live calls**. `pnpm db:seed` runs `seed.ts`, which inserts
`portfolio.json` into `companies` (symbol, name, portfolio flag, ad-hoc flag,
aliases). It does not load prices, announcements, results, or guidance.
Those JSON files can sit in this folder; the loader does not upsert them.

Files (JSON, small — keep the folder < 30 MB; no PDFs):

| File | What `pnpm db:seed` does | Written by |
|---|---|---|
| `portfolio.json` | Inserts `companies` (portfolio and ad-hoc flags, aliases) | Builder A / coordinator |
| `prices.json` | Not loaded. The file can be present. | `pnpm ingest:prices --export` |
| `announcements.json` | Not loaded. | `pnpm ingest:announcements --export` |
| `results.json` | Not loaded. | `pnpm ingest:results --export` |
| `documents.json`, `guidance.json`, `facts.json`, `research_sections.json` | Not loaded. | `pnpm ingest:research --export` |
| `llm_cache.json` | Not loaded. | exported from the local DB |

`seed.ts` is the loader. It upserts `portfolio.json` only. If another snapshot
file is in the folder it prints `present but no loader yet` and leaves the
database alone. Export helpers belong to the ingest CLIs (`--export` flag).
