/**
 * One tripwire row, written the same way the alerts page writes a book rule.
 * Book scope uses that page's id (`user:kind`). A symbol uses `user:kind:isin`.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { TripwireRule } from "@/db/json";
import { tripwires, users } from "@/db/schema";
import { CATEGORIES, type Category, type Tripwire } from "@/engine/types";
import { invalidateBrief } from "@/lib/brief";
import { mergeCategoryList, tripwireId } from "@/lib/companyTurn";
import { DEMO_USER_ID } from "@/lib/queries";

export interface TripwireWriteOpts {
  /** Category lists replace the saved list. The default keeps and adds. */
  replace?: boolean;
}

export type DisableResult =
  | { ok: "missing" }
  | { ok: "off"; already: boolean }
  | { ok: "narrowed"; categories: Category[] }
  | { ok: "absent" };

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

async function refreshAlerts(): Promise<void> {
  try {
    revalidatePath("/alerts");
    revalidatePath("/");
    revalidatePath("/brief");
    await invalidateBrief();
  } catch {
    // The row is saved. The brief cache expires on its own.
  }
}

export async function writeTripwire(
  isin: string | null,
  rule: Tripwire,
  scope: "symbol" | "book",
  symbolIsin: string,
  opts?: TripwireWriteOpts,
): Promise<boolean> {
  const userId = DEMO_USER_ID;
  const now = Date.now();
  const id = tripwireId(userId, rule.kind, scope, symbolIsin);
  let next: Tripwire = rule;
  if (rule.kind === "category" && !opts?.replace) {
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
  await refreshAlerts();
  return true;
}

/**
 * Turn a saved rule off, or drop one announcement category from it.
 * Same `tripwires` row the alerts page writes. No second store.
 */
export async function disableTripwire(
  scope: "symbol" | "book",
  kind: "price_move" | "volume_ratio" | "category",
  symbolIsin: string,
  drop?: Category,
): Promise<DisableResult> {
  const id = tripwireId(DEMO_USER_ID, kind, scope, symbolIsin);
  const existing = await db
    .select()
    .from(tripwires)
    .where(eq(tripwires.id, id))
    .limit(1);
  const row = existing[0];
  if (!row) return { ok: "missing" };

  if (kind === "category" && drop) {
    let current: Category[] = [];
    try {
      const parsed = TripwireRule.safeParse(JSON.parse(row.ruleJson));
      if (parsed.success && parsed.data.kind === "category")
        current = parsed.data.params.categories.filter(isCategory);
    } catch {
      current = [];
    }
    if (!row.enabled) return { ok: "off", already: true };
    if (!current.includes(drop)) return { ok: "absent" };
    const next = current.filter((c) => c !== drop);
    try {
      if (!next.length) {
        await db
          .update(tripwires)
          .set({ enabled: false })
          .where(eq(tripwires.id, id));
        await refreshAlerts();
        return { ok: "off", already: false };
      }
      const ruleJson = JSON.stringify(
        TripwireRule.parse({
          kind: "category",
          params: { categories: next },
        }),
      );
      await db
        .update(tripwires)
        .set({ ruleJson, enabled: true })
        .where(eq(tripwires.id, id));
    } catch {
      return { ok: "missing" };
    }
    await refreshAlerts();
    return { ok: "narrowed", categories: next };
  }

  if (!row.enabled) return { ok: "off", already: true };
  try {
    await db
      .update(tripwires)
      .set({ enabled: false })
      .where(eq(tripwires.id, id));
  } catch {
    return { ok: "missing" };
  }
  await refreshAlerts();
  return { ok: "off", already: false };
}
