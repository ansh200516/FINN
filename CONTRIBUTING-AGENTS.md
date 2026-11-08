# Working agreements for builder agents

Four builders work in parallel on this repo. The scaffold fixes the interfaces;
you fill in behaviour. Read `AGENTS.md` (Next 16 is not the Next you know),
`src/engine/README.md` and the README in your folder before writing code.

## Ownership (touch only your folders + their tests)

| Builder | Owns | Tests |
|---|---|---|
| **A — Data** | `src/engine/sources/`, `src/engine/ingest/{announcements,prices,results,documents}.ts`, `scripts/ingest/` | `tests/engine/sources`, `tests/engine/ingest` |
| **B — Analysis** | `src/engine/ingest/classify.ts`, `src/engine/analyse/` | `tests/engine/analyse`, classifier fixtures |
| **C — Extraction** | `src/engine/extract/` | `tests/engine/extract` |
| **D — Product/UI** | `src/app/`, `src/ui/`, `public/` | component/route tests |
| Principal | `src/engine/types.ts`, `src/engine/llm/`, `src/db/`, `src/lib/`, config, CI | `tests/engine/llm`, `tests/lib` |

Shared files (`types.ts`, `schema.ts`, `json.ts`, `package.json`): propose the
change in your final report and make the **smallest additive edit** (new
optional field, new table) — never rename or remove. New npm dependency = state
why in the commit body. No UI-kit or charting libraries.

## Contracts

- Function signatures in each `engine/*/index.ts` are the contract. Implement
  in sibling files and re-export from `index.ts`; keep the signatures.
- All LLM calls go through `engine/llm/gateway.callStructured` (never import
  `@google/genai` elsewhere). Bulk work → `tier: "bulk"`; only adjudication
  prose, narrative-vs-numbers, bull/bear and Ask → `tier: "reason"`.
- Every quote passes `verifyQuote`, every number `groundNumbers`, before it is
  stored. Failures are dropped, not repaired.
- Timestamps are ms UTC; use `src/lib/time.ts` for IST and the trading
  calendar. Money is absolute rupees in the DB; crore only at render time.
- JSON columns go through the zod parsers in `src/db/json.ts`.
- Scratch work (downloads, experiments) lives outside the repo (`/tmp/finn-*`).
  Never commit PDFs, `.env.local`, or files > 5 MB.
- Quota is scarce (Flash 20 RPD, Flash-Lite 500 RPD). Cache hits are free;
  prefer fixtures in tests; never call the model from a test.

## Commits

Conventional Commits, small and frequent, scoped by folder:
`feat(ingest): xbrl parser with identity checks`, `fix(time): …`,
`test(analyse): …`, `data: snapshot 2026-11-09`, `docs: …`, `chore: …`.
Add the trailer `AI-Session: <first 8 chars of your Cursor session id>`.
Before claiming done: `pnpm check && pnpm build` pass and your tests are green.

## Next 16 reminders

`params`/`searchParams` are Promises (`await` them); `middleware.ts` is
`proxy.ts`; `cacheComponents` is **off** (keep it off); Tailwind 4 is CSS-first
(`@theme` in `globals.css`, no `tailwind.config`); `next build` does not lint —
run `pnpm lint` (Biome) yourself.
