/**
 * zod parsers for the `*_json` text columns. Always go through these — a
 * malformed JSON column should surface as a typed error, not `any`.
 */
import { z } from "zod";

export const StringArray = z.array(z.string());

export const PushSubscriptionJson = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export const PushSubscriptions = z.array(PushSubscriptionJson);

export const UserPrefs = z
  .object({
    windowHours: z.number().int().positive().default(24),
    theme: z.enum(["paper", "ink", "auto"]).default("auto"),
    quietCategories: z.array(z.string()).default([]),
  })
  .partial();

export const TripwireRule = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("volume_ratio"),
    params: z.object({
      ratio: z.number().positive(),
      lookbackDays: z.number().int().positive().default(20),
    }),
  }),
  z.object({
    kind: z.literal("price_move"),
    params: z.object({ pct: z.number().positive() }),
  }),
  z.object({
    kind: z.literal("category"),
    params: z.object({ categories: z.array(z.string()).min(1) }),
  }),
  z.object({
    kind: z.literal("text"),
    params: z.object({
      pattern: z.string().min(1),
      flags: z.string().optional(),
    }),
  }),
]);

export const DeliveredVia = z.record(z.string(), z.string());

export const ResultsChecks = z
  .object({
    nii: z.number().optional(),
    ppop: z.number().optional(),
    identities: z.record(z.string(), z.boolean()).optional(),
    warnings: z.array(z.string()).default([]),
  })
  // Builder B: keep the additive optional keys written by engine/ingest/results
  // (taxonomy, variant, income, provisions, gnpaPct, ytd, pdf, …) — see ResultsQuarter.checks
  .catchall(z.unknown())
  .partial();

export const JobLogEntry = z.object({
  at: z.number(),
  step: z.string(),
  msg: z.string(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  data: z.record(z.string(), z.unknown()).optional(),
});
export const JobLog = z.array(JobLogEntry);

/** Parse a JSON text column with a schema; returns the fallback on any failure. */
export function parseJsonColumn<T>(
  schema: z.ZodType<T>,
  raw: string | null | undefined,
  fallback: T,
): T {
  if (raw == null || raw === "") return fallback;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : fallback;
  } catch {
    return fallback;
  }
}

/** Strict variant: throws on malformed data (use in ingest, not in UI). */
export function parseJsonColumnStrict<T>(schema: z.ZodType<T>, raw: string): T {
  return schema.parse(JSON.parse(raw));
}

export function toJsonColumn(value: unknown): string {
  return JSON.stringify(value ?? null);
}
