/**
 * One tiny real Gemini call through the gateway to confirm SDK + model name +
 * ledger + cache. Spends 1 request of Flash-Lite quota. `pnpm llm:smoke`
 */
import { z } from "zod";
import { callStructured, remainingBudget } from "@/engine/llm/gateway";

const Out = z.object({
  ok: z.boolean(),
  sum: z.number().int(),
  word: z.string(),
});

async function main(): Promise<void> {
  const r = await callStructured({
    task: "smoke",
    tier: "bulk",
    schema: Out,
    prompt:
      "Return ok=true, sum = 17 + 25, and word = the English word for the number 3. JSON only.",
    maxTokens: 64,
  });
  console.log(
    JSON.stringify(
      {
        data: r.data,
        model: r.model,
        cached: r.cached,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        tokensThought: r.tokensThought,
        latencyMs: r.latencyMs,
      },
      null,
      2,
    ),
  );
  const budget = await remainingBudget();
  console.table(
    budget.map((b) => ({
      model: b.model,
      tier: b.tier,
      used: b.requests,
      cap: b.cap,
      remaining: b.remaining,
    })),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
