"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { TripwireRule } from "@/db/json";
import { tripwires, users } from "@/db/schema";
import {
  answerNse,
  NSE_FEED_FAILED,
  NseFeedError,
} from "@/engine/sources/nse-mcp";
import type { Tripwire } from "@/engine/types";
import { invalidateBrief } from "@/lib/brief";
import {
  type CompanyReply,
  confirmRule,
  mergeCategoryList,
  parseCompanyTurn,
  scoredPromises,
  tripwireId,
} from "@/lib/companyTurn";
import { NAME_THE_COMPANY } from "@/lib/deskTurn";
import { classifyLiveAsk } from "@/lib/nseLive";
import { loadPullMenu } from "@/lib/pullRead";
import {
  DEMO_USER_ID,
  getCompanyBySymbol,
  getCompanyResultsCard,
  getLedger,
  getQuarters,
} from "@/lib/queries";

export type { CompanyReply };

/**
 * One turn that is not a model ask: a results card, scored promises,
 * one reading, or a tripwire written the same way the alerts survey writes.
 */
export async function companyTurn(
  symbol: string,
  raw: string,
): Promise<CompanyReply> {
  const intent = parseCompanyTurn(raw.trim().slice(0, 500));
  if (intent.kind === "ask") return { kind: "ask" };
  if (intent.kind === "rejected")
    return { kind: "rejected", sentence: intent.sentence };

  const company = await getCompanyBySymbol(symbol);
  if (!company)
    return { kind: "error", message: "That symbol is not on file." };

  if (intent.kind === "live")
    return nseReply(raw.trim().slice(0, 500), company.nseSymbol);

  switch (intent.kind) {
    case "results":
      return {
        kind: "results",
        card: await getCompanyResultsCard(company.isin),
      };
    case "promises":
      return {
        kind: "promises",
        rows: scoredPromises(await getLedger(company.isin)),
      };
    case "reading": {
      const quarters = await getQuarters(company.isin);
      const consolidated = quarters.filter((q) => q.basis === "consolidated");
      const latest = (consolidated.length ? consolidated : quarters).at(-1);
      const isBank =
        (latest?.nii != null && latest.ppop != null) ||
        /bank/i.test(company.industry ?? "") ||
        /bank/i.test(company.sector ?? "");
      const blocks = await loadPullMenu({ isin: company.isin, isBank });
      const block = blocks.find((b) => b.title === intent.title);
      if (!block)
        return { kind: "error", message: "That reading is not on file." };
      return { kind: "reading", block };
    }
    case "rule": {
      const saved = await saveRule(
        intent.scope === "book" ? null : company.isin,
        intent.rule,
        intent.scope,
        company.isin,
      );
      if (!saved) return { kind: "error", message: "The rule did not save." };
      return {
        kind: "rule",
        sentence: confirmRule(company.nseSymbol, intent.scope, intent.rule),
      };
    }
  }
}

async function nseReply(
  text: string,
  symbol: string | null,
): Promise<CompanyReply> {
  const live = classifyLiveAsk(text, symbol);
  if (!live || live.kind === "needs-symbol")
    return { kind: "error", message: NAME_THE_COMPANY };
  try {
    const card = await answerNse(live);
    return { kind: "nse", headline: card.headline, note: card.note };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof NseFeedError ? err.message : NSE_FEED_FAILED,
    };
  }
}

async function saveRule(
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
    await invalidateBrief();
  } catch {
    // The row is saved. The brief cache expires on its own.
  }
  return true;
}

/**
 * One desk turn. A book-wide sentence saves without a company.
 * An ask is handed back so the client can call the grounded route.
 */
export async function deskTurn(
  symbol: string | null,
  raw: string,
  scope: "symbol" | "book" | null,
): Promise<CompanyReply> {
  const text = raw.trim().slice(0, 500);
  if (!text) return { kind: "error", message: NAME_THE_COMPANY };
  const safe =
    symbol && /^[A-Za-z0-9&.-]{1,20}$/.test(symbol)
      ? symbol.toUpperCase()
      : null;
  const intent = parseCompanyTurn(text);
  if (intent.kind === "rejected")
    return { kind: "rejected", sentence: intent.sentence };
  if (intent.kind === "live") return nseReply(text, safe);
  if (intent.kind === "ask") return { kind: "ask" };
  if (intent.kind === "rule") {
    const book = scope === "book" || intent.scope === "book" || !safe;
    if (book) {
      const saved = await saveRule(null, intent.rule, "book", safe ?? "book");
      if (!saved) return { kind: "error", message: "The rule did not save." };
      return {
        kind: "rule",
        sentence: confirmRule(safe ?? "the book", "book", intent.rule),
      };
    }
  }
  if (!safe) return { kind: "error", message: NAME_THE_COMPANY };
  return companyTurn(safe, text);
}
