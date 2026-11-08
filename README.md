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

## Layout

```
src/app         routes: / (brief) /c/[symbol] /alerts /inbox /add /status, api/health, api/jobs/*
src/db          Drizzle + libSQL (file: locally, libsql:// Turso in prod), schema, zod JSON parsers
src/engine      sources/ ingest/ extract/ analyse/ llm/ — the headless engine (see src/engine/README.md)
src/lib         env, logger, IST + NSE trading-calendar helpers
scripts         db/migrate, ingest:* CLIs (same code as the API jobs), llm-smoke
data/seed       committed snapshot loader; data/finn.db is gitignored
tests           vitest
docs            research + decisions; problem statement/ holds the brief
```

Stack: Next.js 16.4 (App Router, Turbopack), React 19.3, Tailwind 4 (CSS-first
tokens in `globals.css`), TypeScript strict, Drizzle + libSQL, Gemini via
`@google/genai`, Biome, Vitest. Deploys to Vercel `bom1` zero-config.

Design and engineering decisions: `docs/research/20-synthesis-and-decision.md`.
Working agreements for builder agents: `CONTRIBUTING-AGENTS.md`.
