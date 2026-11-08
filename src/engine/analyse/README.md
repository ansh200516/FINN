# engine/analyse — owner: Builder B (analysis)

Deterministic analysis over DB rows. **No LLM calls except `ledger.ts`
adjudication prose** (reason tier, cached per document hash). Every function is
pure and unit-tested against fixtures.

| File | Does |
|---|---|
| `results.ts` | `ResultsQuarter[]` → `ResultsCard`: EBITDA (convention explicit), QoQ/YoY, 5-quarter sparks, identity checks → checksum badge |
| `ledger.ts` | guidance × results → `Verdict` per row (adjective→band mapping, tolerances, `unverifiable` when the metric has no exchange number) |
| `priority.ts` | SEBI materiality × category weight × novelty → 0..100 and `Tier` |
| `tripwires.ts` | evaluate `Tripwire` rules against bars/events; `backtest` returns the "would have fired N× in 60 days" sentence |

Contracts in `index.ts`.
