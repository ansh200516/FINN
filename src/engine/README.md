# src/engine

The headless engine behind FINN. No React here; everything is callable from
`scripts/ingest/*` (Mac/launchd during build week) and from `src/app/api/jobs/*`
(Vercel) with identical behaviour.

```
sources/   fetch raw data from NSE, bhavcopy, Upstox, BSE (docs only), screener (optional)
ingest/    raw → DB rows: announcements → classify → dedupe → prioritise; prices → anomalies; XBRL → results_quarters; documents → text
extract/   LLM-assisted extraction with code gates: guidance, bio, one-liners, AR section map
analyse/   deterministic analysis: results math, ledger adjudication, priority, tripwires
llm/       gateway (REAL), verify (REAL) — the only place that talks to Gemini
types.ts   shared contracts (change with care; see CONTRIBUTING-AGENTS.md)
```

Rules that apply to every folder:

- Pure functions where possible; DB access via `@/db/client` only.
- Every number shown to the user must be traceable to a source URL + page/tag.
- Every LLM output passes through `verify.ts` gates before it is stored.
- Timestamps are ms UTC; IST strings only where the source stamped them.
