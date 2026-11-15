"use server";

import { redirect } from "next/navigation";
import { removeFromPortfolio } from "@/app/add/actions";
import { resolveNseSymbol } from "@/engine/jobs/resolve";
import { CATEGORIES, type Category } from "@/engine/types";
import { openBookConfirm } from "@/lib/bookConfirm";
import { runFinnieTurn } from "@/lib/finnieTurn";
import type { FinnieMemory, FinnieTurnResult } from "@/lib/finnieTypes";
import { startResearch } from "@/lib/jobs";
import { disableTripwire, writeTripwire } from "@/lib/tripwireWrite";

function asCategory(value: string | undefined): Category | undefined {
  if (!value) return undefined;
  return (CATEGORIES as readonly string[]).includes(value)
    ? (value as Category)
    : undefined;
}

export async function finnieTurn(
  sentence: string,
  focus: string | null,
  prior?: FinnieMemory[] | null,
): Promise<FinnieTurnResult> {
  const text = typeof sentence === "string" ? sentence : "";
  const open = typeof focus === "string" ? focus : null;
  return runFinnieTurn(text, open, prior ?? null);
}

/** The user pressed Confirm. The model cannot call this. */
export async function applyBookConfirm(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const body = openBookConfirm(token);
  if (!body) redirect("/chat");
  if (body.op === "add") {
    const job = await startResearch(body.symbol, { portfolio: true });
    if (job.ok) redirect(`/add?job=${encodeURIComponent(job.jobId)}`);
    redirect("/add");
  }
  if (body.op === "remove") {
    const found = await resolveNseSymbol(body.symbol);
    if (found) await removeFromPortfolio(found.isin);
    redirect("/c");
  }
  if (body.op === "alert") {
    await writeTripwire(body.isin, body.rule, body.scope, body.isin ?? "book", {
      replace: true,
    });
    redirect("/alerts");
  }
  if (
    body.kind === "price_move" ||
    body.kind === "volume_ratio" ||
    body.kind === "category"
  ) {
    await disableTripwire(
      body.scope,
      body.kind,
      body.isin,
      asCategory(body.drop),
    );
  }
  redirect("/alerts");
}
