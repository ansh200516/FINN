# engine/extract — owner: Builder C (extraction)

LLM-assisted extraction, always behind code gates. Every function here:

1. builds a prompt + zod schema and calls `llm.callStructured(...)` on the **bulk** tier (Flash-Lite, `thinkingLevel: MINIMAL`);
2. runs the result through `llm/verify.ts` (`verifyQuote` for every quote, `groundNumbers` for every number) and **drops** anything that fails — never "fixes" it;
3. returns typed objects with page/offset provenance.

| File | Does |
|---|---|
| `guidance.ts` | transcript → speaker turns → chunked calls → `GuidanceStatement[]` (verbatim gate; single-pass recall is poor, so chunk by speaker turn) |
| `bio.ts` | appointment filing text → brief profile (SEBI LODR Sch. III mandates one; 10/11 filings had it) |
| `oneliner.ts` | per-category field schemas (amount, record date, rating change, stake %, pledge %) → list outputs; totals computed in code |
| `sections.ts` | annual-report page map via regex anchors + LLM labelling of ambiguous pages |

Contracts in `index.ts`.
