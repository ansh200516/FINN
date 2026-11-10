"use server";

import { runFinnieTurn } from "@/lib/finnieTurn";
import type { FinniePrior, FinnieTurnResult } from "@/lib/finnieTypes";

export async function finnieTurn(
  sentence: string,
  focus: string | null,
  prior?: FinniePrior | null,
): Promise<FinnieTurnResult> {
  const text = typeof sentence === "string" ? sentence : "";
  const open = typeof focus === "string" ? focus : null;
  const earlier =
    prior && typeof prior === "object"
      ? {
          sentence: typeof prior.sentence === "string" ? prior.sentence : "",
          tool: typeof prior.tool === "string" ? prior.tool : null,
        }
      : null;
  return runFinnieTurn(text, open, earlier);
}
