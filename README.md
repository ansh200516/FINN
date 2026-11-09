## For the grader

Live app: [https://finn-gray.vercel.app](https://finn-gray.vercel.app)

Send the covering note to assessment@enam.com. The subject line is exactly:

`IIT Delhi – AI Engineer - 2027`

The note is [`docs/submission/covering-note.md`](docs/submission/covering-note.md). How the app was built is [`docs/submission/build-history.md`](docs/submission/build-history.md).

Ask answers a price, the index, and corporate actions from [NSE's official MCP](https://www.nseindia.com/nse-mcp); five of 36 tools are wired, and the inventory is [`docs/research/30-nse-mcp-tools.md`](docs/research/30-nse-mcp-tools.md) (`527f876`).

Ten minutes on a phone:

1. Open the brief and read it through to "You're done". The window is the last 24 hours and widens when that day is empty. Use **7 d** for a longer book.
2. Open a results card, under Needs you or inside the filed-away fold, and read the basis chip.
3. Open Supreme's promise ledger: [https://finn-gray.vercel.app/c/SUPREMEIND](https://finn-gray.vercel.app/c/SUPREMEIND).
4. Open **Alerts**, move the price or volume threshold, and press **Save alerts**.
5. Open **Companies**, then **+ Add** ([https://finn-gray.vercel.app/add](https://finn-gray.vercel.app/add)), and enter an NSE symbol that is not already on the book.

# FINN

**A brief that remembers what management promised.**

FINN is a mobile-first investing brief for an Indian equity portfolio (ENAM AI
Engineer Build Challenge, Nov 2026). Twice a day it hands over a finite brief —
the few filings that need attention, the routine filed away with a count, and a
hard end. Every loud item is worded against the company's own history and open
promises; research is a **promise ledger** (what management said on calls vs.
what the exchange-filed XBRL numbers show), with every number and quote one tap
from its source page.

Three objects, one pipeline: **Filing → Card** (push), **Commitment → Ledger
row** (pull), **Condition → Tripwire** (configurable alerts).

## Run it

```sh
pnpm i
pnpm db:migrate     # creates data/finn.db from drizzle/ migrations
pnpm db:seed        # loads the committed snapshot in data/seed/
pnpm dev            # http://localhost:3000 (LAN-bound for phone testing)
```

No API keys are needed for the seeded portfolio. Set `GEMINI_API_KEY` in
`.env.local` (see `.env.example`) for live extraction and the Ask sheet.

Jobs (same code as the CLIs; each call runs until a 50 s deadline and can be
continued): `curl -X POST -H "Authorization: Bearer $JOBS_SECRET" localhost:3000/api/jobs/eod`.
Vercel cron hits `GET /api/jobs/eod` at 20:30 IST on weekdays. Set
`FINN_REFRESH_ON_VISIT=true` in production so an open brief refreshes a stale feed.

Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (or `pnpm check`).

## Deploy

Production: [https://finn-gray.vercel.app](https://finn-gray.vercel.app) (Vercel `bom1`).

The deployed database is Supabase Postgres on the existing project **ENAM** (Sydney, `ap-southeast-2`). `DATABASE_URL` is a `postgresql://` transaction-pooler URL. `file:` stays local libSQL, and `libsql://` still needs `DATABASE_AUTH_TOKEN`. Do not point the app at a Supabase HTTPS URL.

Env is set on the Vercel project, not in git:

- `DATABASE_URL`
- `GEMINI_API_KEY` — live extraction. Leave `FINN_LLM_CACHE_ONLY` unset when this is set.
- `JOBS_SECRET` — bearer for `/api/jobs/*`
- `CRON_SECRET` — the same value, so the weekday cron is accepted
- `NEXT_PUBLIC_APP_URL` — `https://finn-gray.vercel.app`

Apply the schema with `pnpm db:push:pg`, then load a sqlite snapshot with `pnpm db:load:pg` (`SQLITE_PATH` defaults to `data/finn.db`). Epoch-millisecond columns are `bigint`, boolean columns are real booleans, and JSON text is read through `finn_json_text` / `finn_json_array`.

## Layout

```
src/app         routes: / (brief) /c/[symbol] /alerts /inbox /add /status, api/health, api/jobs/*
src/db          Drizzle. libSQL for file: and libsql:; Postgres when DATABASE_URL is postgres://
src/engine      sources/ ingest/ extract/ analyse/ llm/ — the headless engine (see src/engine/README.md)
src/lib         env, logger, IST + NSE trading-calendar helpers
scripts         db/migrate, ingest:* CLIs (same code as the API jobs), llm-smoke
data/seed       committed snapshot loader; data/finn.db is gitignored
tests           vitest
docs            research + decisions; problem statement/ holds the brief
```

Stack: Next.js 16.4 (App Router, Turbopack), React 19.3, Tailwind 4 (CSS-first
tokens in `globals.css`), TypeScript strict, Drizzle (libSQL locally, Postgres
in production), Gemini via `@google/genai`, Biome, Vitest. Deploys to Vercel
`bom1`.

Design and engineering decisions: `docs/research/20-synthesis-and-decision.md`.
Working agreements for builder agents: `CONTRIBUTING-AGENTS.md`.
