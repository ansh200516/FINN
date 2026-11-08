/**
 * Environment access. Everything is optional except DATABASE_URL, which
 * defaults to the local SQLite file so `pnpm dev` works with zero config.
 *
 * Next.js loads .env.local itself; for `tsx scripts/*` we load it here
 * (Node ≥ 20.12 `process.loadEnvFile`), without overriding existing vars.
 */
import { z } from "zod";

function loadDotEnvFiles(): void {
  if (process.env.NEXT_RUNTIME || process.env.VERCEL) return;
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // file absent — fine
    }
  }
}
loadDotEnvFiles();

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1).default("file:./data/finn.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** comma-separated overrides of the model ladders */
  FINN_MODELS_BULK: z.string().optional(),
  FINN_MODELS_REASON: z.string().optional(),
  /** "true" → never call Gemini; serve from llm_cache or throw LlmBudgetExhausted */
  FINN_LLM_CACHE_ONLY: z.string().optional(),
  JOBS_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export function isCacheOnly(): boolean {
  return (env().FINN_LLM_CACHE_ONLY ?? "").toLowerCase() === "true";
}
