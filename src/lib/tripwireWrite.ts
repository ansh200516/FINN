/**
 * One tripwire row, written the same way the alerts page writes a book rule.
 * Book scope uses that page's id (`user:kind`). A symbol uses `user:kind:isin`.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { TripwireRule } from "@/db/json";
import { tripwires, users } from "@/db/schema";
import type { Tripwire } from "@/engine/types";
import { invalidateBrief } from "@/lib/brief";
import { mergeCategoryList, tripwireId } from "@/lib/companyTurn";
import { DEMO_USER_ID } from "@/lib/queries";

export async function writeTripwire(
  isin: string | null,
  rule: Tripwire,
  scope: "symbol" | "book",
  symbolIsin: string,
): Promise<boolean> {
  const userId = DEMO_USER_ID;
  const now = Date.now();
  const id = tripwireId(userId, rule.kind, scope, symbolIsin);
  let next: Tripwire = rule;
  if (rule.kind === "category") {
    const existing = await db
      .select()
      .from(tripwires)
      .where(eq(tripwires.id, id))
      .limit(1);
    const row = existing[0];
    let prev: string[] | null = null;
    if (row) {
      try {
        const parsed = TripwireRule.safeParse(JSON.parse(row.ruleJson));
        if (parsed.success && parsed.data.kind === "category")
          prev = parsed.data.params.categories;
      } catch {
        prev = null;
      }
    }
    next = {
      kind: "category",
      params: {
        categories: mergeCategoryList(prev, rule.params.categories),
      },
    };
  }
  const ruleJson = JSON.stringify(TripwireRule.parse(next));
  try {
    const have = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!have[0]) {
      await db
        .insert(users)
        .values({ id: userId, createdAt: now, lastSeenAt: now });
    }
    await db
      .insert(tripwires)
      .values({
        id,
        userId,
        isin,
        ruleJson,
        enabled: true,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: tripwires.id,
        set: { ruleJson, enabled: true, isin },
      });
  } catch {
    return false;
  }
  try {
    revalidatePath("/alerts");
    revalidatePath("/");
    revalidatePath("/brief");
    await invalidateBrief();
  } catch {
    // The row is saved. The brief cache expires on its own.
  }
  return true;
}
