"use server";

import { runFinnieTurn } from "@/lib/finnieTurn";
import type { FinnieMemory, FinnieTurnResult } from "@/lib/finnieTypes";

export async function finnieTurn(
  sentence: string,
  focus: string | null,
  prior?: FinnieMemory[] | null,
): Promise<FinnieTurnResult> {
  const text = typeof sentence === "string" ? sentence : "";
  const open = typeof focus === "string" ? focus : null;
  return runFinnieTurn(text, open, prior ?? null);
}
