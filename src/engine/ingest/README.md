# engine/ingest — owner: Builder A (data) / Builder B (classification)

Raw → DB. Idempotent (upsert by natural keys), resumable, safe to run every
15 minutes. Each function takes already-fetched raw records where practical so
it can be unit-tested against fixtures in `tests/fixtures/`.

| File | Does |
|---|---|
| `announcements.ts` | `AnnouncementRaw[]` → `announcements` rows (IST → ms UTC), then `classify` → `dedupe` → `prioritise` → `events` |
| `classify.ts` | rules first (`desc` 69%, regex over `desc`+`attchmntText` 27%), LLM residue (~1.6%) via `llm.callStructured({task:'classify_residue'})` |
| `prices.ts` | bhavcopy rows → `prices` (session_type from `lib/time.sessionType`), then anomalies (20-day avg excluding special sessions) |
| `results.ts` | integrated-filing index → XBRL → `results_quarters` (absolute INR; basis + audited flags; identity checks) |
| `documents.ts` | discover + download + `unpdf` text → `documents` (+ page text to `data/cache`) |

Contracts in `index.ts`.
