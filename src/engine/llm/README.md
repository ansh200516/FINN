# engine/llm — owner: Principal (gateway, verify); everyone consumes

The **only** module allowed to import `@google/genai`. Both files are real
implementations, not stubs.

## `gateway.ts`

`callStructured<T>({ task, schema, prompt, parts?, tier, maxTokens? })` → `{ data: T, model, cached, tokensIn, tokensOut, tokensThought, latencyMs }`

- Schema-constrained JSON output (`responseMimeType: application/json` + `responseJsonSchema` from zod).
- Model ladders: `bulk` = `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`; `reason` = `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3.8-flash` → bulk ladder. Override with `FINN_MODELS_BULK` / `FINN_MODELS_REASON`.
- Thinking: `MINIMAL` for bulk, `LOW` for reason. A Finnie plan or answer call that streams thoughts uses `MEDIUM` with `includeThoughts`. That is the lowest level that returns a displayable summary on Gemini 3 Flash. LOW returns no thought tokens.
- Per-model daily ledger (`llm_ledger`, date in America/Los_Angeles) with hard caps at **80 % of RPD** (Flash-Lite 500 → 400, Flash 20 → 16). A capped model is skipped; if every model is capped → `LlmBudgetExhausted`.
- Process-local token bucket: bulk 10 RPM / 250k TPM, reason 5 RPM.
- 60 s timeout; one retry with jitter on 429/503/500, then next model.
- Content-hash cache (`llm_cache`): key = sha256(task | promptVersion | system | prompt | parts | schema). Cache hits cost nothing and are flagged `cached: true`.
- `FINN_LLM_CACHE_ONLY=true` → never calls the API (demo safety).
- Finnie plan and answer calls stay on the Gemini ladder first. On a daily cap, or a quota / 429 / credit 403 / 503 failure, they try the next configured provider in `providers.ts`: Groq `openai/gpt-oss-20b` (`GROQ_API_KEY`), OpenRouter `openrouter/free` (`OPENROUTER_API_KEY`), then Cerebras `qwen-3.8-27b` (`CEREBRAS_API_KEY`). An empty env var skips that provider. Those calls use the same JSON schema and do not read or write `llm_cache`. A provider that cannot take the schema is not used for the planner. Fallback responses do not invent thought summaries; the step titles already on screen stay.

Budget introspection for `/status`: `remainingBudget()`.

## `verify.ts`

- `verifyQuote(quote, sourceText)` → offset in the normalised source or `null`. Normalises whitespace, curly quotes, dashes and NBSP; otherwise exact.
- `groundNumbers(text, sourceText)` → the number tokens in `text` that do **not** appear in `sourceText` (handles `1,23,456` and `123,456` grouping, decimals, `(123)` negatives, `−`, `%`). Empty array = fully grounded.

Rule: anything that fails a gate is dropped, not repaired.
