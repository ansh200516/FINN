import { type ChatStreamEvent, parseChatRequest } from "@/lib/chatStream";
import type { FinnieTrace } from "@/lib/finnieTrace";
import { runFinnieTurn } from "@/lib/finnieTurn";

export const dynamic = "force-dynamic";
// The page action used to hold the turn until the end. This stream stays
// open for the same 300s cap. Each Gemini call still times out at 60s.
export const maxDuration = 300;

const encoder = new TextEncoder();
const PING_MS = 8_000;

function line(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

/**
 * POST /api/chat  { sentence, focus, prior }
 * NDJSON: step and thought events, then one result. The model is called live.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json(
      { ok: false },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const body = parseChatRequest(json);
  if (!body) {
    return Response.json(
      { ok: false },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const abort = new AbortController();
  const onClientGone = () => abort.abort();
  req.signal.addEventListener("abort", onClientGone, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(line(event));
        } catch {
          closed = true;
          abort.abort();
        }
      };
      const beat = setInterval(() => send({ type: "ping" }), PING_MS);
      const trace: FinnieTrace = {
        signal: abort.signal,
        step(title, text) {
          send({ type: "step", title, text });
        },
        thought(thought) {
          send({ type: "thought", text: thought.text, fresh: thought.fresh });
        },
      };
      try {
        send({ type: "ping" });
        const result = await runFinnieTurn(
          body.sentence,
          body.focus,
          body.prior,
          trace,
        );
        send({ type: "result", result });
      } catch {
        if (!abort.signal.aborted) send({ type: "error" });
      } finally {
        clearInterval(beat);
        closed = true;
        req.signal.removeEventListener("abort", onClientGone);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
