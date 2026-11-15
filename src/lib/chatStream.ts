/**
 * NDJSON events for one chat turn. The route writes them as they happen.
 * The client reads them before the answer is ready.
 */
import type { FinnieTurnResult } from "@/lib/finnieTypes";

export type ChatStreamEvent =
  | { type: "step"; title: string; text: string }
  | { type: "thought"; text: string; fresh: boolean }
  | { type: "result"; result: FinnieTurnResult }
  | { type: "ping" }
  | { type: "error" };

export interface ChatRequest {
  sentence: string;
  focus: string | null;
  prior: unknown;
}

export function parseChatRequest(value: unknown): ChatRequest | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.sentence !== "string") return null;
  const sentence = rec.sentence.replace(/\s+/g, " ").trim();
  if (!sentence || sentence.length > 500) return null;
  let focus: string | null = null;
  if (rec.focus == null) focus = null;
  else if (typeof rec.focus === "string") {
    const symbol = rec.focus.trim();
    if (symbol.length > 20) return null;
    focus = symbol || null;
  } else return null;
  return { sentence, focus, prior: rec.prior ?? null };
}

export function parseChatEvent(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  if (rec.type === "ping") return { type: "ping" };
  if (rec.type === "error") return { type: "error" };
  if (
    rec.type === "step" &&
    typeof rec.title === "string" &&
    typeof rec.text === "string"
  ) {
    const title = rec.title.trim().slice(0, 80);
    const text = rec.text.trim().slice(0, 2_000);
    if (!title || !text) return null;
    return { type: "step", title, text };
  }
  if (rec.type === "thought" && typeof rec.text === "string") {
    const text = rec.text.trim().slice(0, 8_000);
    if (!text) return null;
    return { type: "thought", text, fresh: rec.fresh !== false };
  }
  if (rec.type === "result" && rec.result && typeof rec.result === "object") {
    const result = rec.result as FinnieTurnResult;
    if (typeof result.say !== "string") return null;
    return { type: "result", result };
  }
  return null;
}

/** Read NDJSON. A line split across chunks is held until the newline. */
export async function readChatEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const take = (chunk: string) => {
    buf += chunk;
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const event = parseChatEvent(line);
      if (event) onEvent(event);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      take(decoder.decode(value, { stream: true }));
    }
    take(decoder.decode());
    const tail = buf.trim();
    if (tail) {
      const event = parseChatEvent(tail);
      if (event) onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}
