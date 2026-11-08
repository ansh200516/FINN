"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { parseJsonColumn, StringArray } from "@/db/json";
import { companies, users } from "@/db/schema";
import { invalidateBrief } from "@/lib/brief";
import {
  type StartResearchResult,
  startResearch as startResearchJob,
} from "@/lib/jobs";
import { DEMO_USER_ID } from "@/lib/queries";

/**
 * "Research any NSE ticker": resolves the symbol (EQUITY_L master + alias
 * table), upserts the company (role 'adhoc' unless `portfolio`) and creates
 * / re-queues the `research:<SYMBOL>` job. The Add-company page shows the
 * live receipt for the returned job id and drives it by polling.
 */
export async function startResearch(
  symbol: string,
  opts: { portfolio?: boolean } = {},
): Promise<StartResearchResult> {
  const r = await startResearchJob(symbol, { portfolio: opts.portfolio });
  if (r.ok && opts.portfolio) {
    revalidatePath("/");
    revalidatePath("/c");
    await invalidateBrief();
  }
  return r;
}

const Add = z.object({
  symbol: z.string().regex(/^[A-Z0-9&.-]{1,20}$/),
  name: z.string().min(1).max(120),
  isin: z.string().regex(/^IN[A-Z0-9]{10}$/),
  series: z.string().max(3).optional(),
});

export type AddState =
  | {
      ok: true;
      symbol: string;
      isin: string;
      name: string;
      created: boolean;
      alreadyInPortfolio: boolean;
    }
  | { ok: false; error: string }
  | null;

async function ensureUser(now: number): Promise<string[]> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, DEMO_USER_ID))
    .limit(1);
  const u = rows[0];
  if (!u) {
    await db
      .insert(users)
      .values({ id: DEMO_USER_ID, createdAt: now, lastSeenAt: now });
    return [];
  }
  return parseJsonColumn(StringArray, u.portfolioIsinsJson, []);
}

/**
 * "Add to portfolio": upserts the company (ISIN-keyed), appends the ISIN to
 * the demo user's portfolio, starts the `research:<SYMBOL>` job and redirects
 * to `/add?job=<id>` where the live receipt drives it. Idempotent — adding a
 * company twice re-queues the research run (every step is idempotent).
 */
export async function addToPortfolio(
  _prev: AddState,
  formData: FormData,
): Promise<AddState> {
  const state = await addToPortfolioRow(_prev, formData);
  if (!state?.ok) return state;
  const job = await startResearchJob(state.symbol, { portfolio: true });
  await invalidateBrief();
  if (job.ok) redirect(`/add?job=${encodeURIComponent(job.jobId)}`);
  return state;
}

async function addToPortfolioRow(
  _prev: AddState,
  formData: FormData,
): Promise<AddState> {
  const parsed = Add.safeParse({
    symbol: String(formData.get("symbol") ?? "")
      .toUpperCase()
      .trim(),
    name: String(formData.get("name") ?? "").trim(),
    isin: String(formData.get("isin") ?? "")
      .toUpperCase()
      .trim(),
    series: formData.get("series") ? String(formData.get("series")) : undefined,
  });
  if (!parsed.success)
    return { ok: false, error: "Pick a company from the list first" };
  const { symbol, name, isin } = parsed.data;
  const now = Date.now();
  const existing = await db
    .select()
    .from(companies)
    .where(eq(companies.isin, isin))
    .limit(1);
  let created = false;
  if (!existing[0]) {
    await db.insert(companies).values({
      isin,
      nseSymbol: symbol,
      name,
      aliasesJson: "[]",
      inPortfolio: true,
      isAdhoc: true,
      addedAt: now,
    });
    created = true;
  } else if (!existing[0].inPortfolio) {
    await db
      .update(companies)
      .set({ inPortfolio: true })
      .where(eq(companies.isin, isin));
  }
  const current = await ensureUser(now);
  const alreadyInPortfolio = current.includes(isin);
  if (!alreadyInPortfolio) {
    await db
      .update(users)
      .set({
        portfolioIsinsJson: JSON.stringify([...current, isin]),
        lastSeenAt: now,
      })
      .where(eq(users.id, DEMO_USER_ID));
  }
  revalidatePath("/");
  revalidatePath("/c");
  return { ok: true, symbol, isin, name, created, alreadyInPortfolio };
}

/** Undo for the toast: removes the ISIN from the demo portfolio (the company row stays). */
export async function removeFromPortfolio(
  isin: string,
): Promise<{ ok: boolean }> {
  if (!/^IN[A-Z0-9]{10}$/.test(isin)) return { ok: false };
  const now = Date.now();
  const current = await ensureUser(now);
  await db
    .update(users)
    .set({
      portfolioIsinsJson: JSON.stringify(current.filter((x) => x !== isin)),
      lastSeenAt: now,
    })
    .where(eq(users.id, DEMO_USER_ID));
  const others = await db
    .select({ isin: companies.isin })
    .from(companies)
    .where(eq(companies.isin, isin))
    .limit(1);
  if (others[0]) {
    await db
      .update(companies)
      .set({ inPortfolio: false })
      .where(eq(companies.isin, isin));
  }
  revalidatePath("/");
  revalidatePath("/c");
  return { ok: true };
}
