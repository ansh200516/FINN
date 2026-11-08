"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { TripwireRule } from "@/db/json";
import { tripwires, users } from "@/db/schema";
import { CATEGORIES } from "@/engine/types";
import { DEMO_USER_ID } from "@/lib/queries";

const Input = z.object({
  volumeRatio: z.number().min(1).max(10),
  lookbackDays: z.number().int().min(5).max(60).default(20),
  pricePct: z.number().min(0.5).max(30),
  volumeEnabled: z.boolean().default(true),
  priceEnabled: z.boolean().default(true),
  categories: z.array(z.enum(CATEGORIES)).max(17),
});

export type SaveTripwiresState =
  | { ok: true; savedAt: number }
  | { ok: false; error: string }
  | null;

/**
 * Upserts the demo user's three default tripwires (volume, price, category)
 * under stable ids. Rows are validated with the shared zod rule schema so
 * the engine's evaluator reads exactly what it expects.
 */
export async function saveTripwires(
  _prev: SaveTripwiresState,
  formData: FormData,
): Promise<SaveTripwiresState> {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return { ok: false, error: "Nothing to save" };
  let parsed: z.infer<typeof Input>;
  try {
    parsed = Input.parse(JSON.parse(raw));
  } catch {
    return { ok: false, error: "Those values are out of range" };
  }
  const now = Date.now();
  const userId = DEMO_USER_ID;
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!existing[0]) {
    await db
      .insert(users)
      .values({ id: userId, createdAt: now, lastSeenAt: now });
  }
  const rules: Array<{
    id: string;
    rule: z.infer<typeof TripwireRule>;
    enabled: boolean;
  }> = [
    {
      id: `${userId}:volume_ratio`,
      rule: {
        kind: "volume_ratio",
        params: {
          ratio: parsed.volumeRatio,
          lookbackDays: parsed.lookbackDays,
        },
      },
      enabled: parsed.volumeEnabled,
    },
    {
      id: `${userId}:price_move`,
      rule: { kind: "price_move", params: { pct: parsed.pricePct } },
      enabled: parsed.priceEnabled,
    },
  ];
  if (parsed.categories.length)
    rules.push({
      id: `${userId}:category`,
      rule: { kind: "category", params: { categories: parsed.categories } },
      enabled: true,
    });
  else await db.delete(tripwires).where(eq(tripwires.id, `${userId}:category`));
  for (const r of rules) {
    const ruleJson = JSON.stringify(TripwireRule.parse(r.rule));
    await db
      .insert(tripwires)
      .values({
        id: r.id,
        userId,
        isin: null,
        ruleJson,
        enabled: r.enabled,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: tripwires.id,
        set: { ruleJson, enabled: r.enabled },
      });
  }
  revalidatePath("/alerts");
  revalidatePath("/");
  return { ok: true, savedAt: now };
}
