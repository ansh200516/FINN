import type { AskResult } from "./CompanyConversation";

/** Grounded Ask. The route is the only model path. */
export async function askFiling(
  symbol: string,
  question: string,
): Promise<AskResult> {
  try {
    const r = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol, question }),
    });
    let body: unknown;
    try {
      body = await r.json();
    } catch {
      return { ok: false, status: r.status, error: "Ask failed" };
    }
    if (!body || typeof body !== "object" || !("ok" in body))
      return { ok: false, status: r.status, error: "Ask failed" };
    const row = body as {
      ok: boolean;
      answer?: string;
      citations?: AskResult["citations"];
      notInFilings?: boolean;
      error?: string;
    };
    if (!row.ok)
      return { ok: false, status: r.status, error: row.error ?? "Ask failed" };
    return {
      ok: true,
      answer: row.answer,
      citations: row.citations,
      notInFilings: row.notInFilings,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : "Ask failed",
    };
  }
}
