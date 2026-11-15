"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { alerts } from "@/db/schema";
import { DEMO_USER_ID } from "@/lib/queries";

/** Opening the inbox clears the unread badge. The rows stay in the list. */
export async function markInboxRead(): Promise<{ count: number }> {
  const now = Date.now();
  const pending = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.userId, DEMO_USER_ID), isNull(alerts.readAt)));
  if (!pending.length) return { count: 0 };
  await db
    .update(alerts)
    .set({ readAt: now })
    .where(and(eq(alerts.userId, DEMO_USER_ID), isNull(alerts.readAt)));
  try {
    revalidatePath("/inbox");
    revalidatePath("/");
    revalidatePath("/brief");
  } catch {
    // The rows are marked. The next request reads them.
  }
  return { count: pending.length };
}
