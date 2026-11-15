import { describe, expect, it } from "vitest";
import {
  parseChatEvent,
  parseChatRequest,
  readChatEvents,
} from "@/lib/chatStream";
import type { FinnieTurnResult } from "@/lib/finnieTypes";

const result: FinnieTurnResult = {
  say: "Two names.",
  tools: [],
  card: null,
  cards: [],
  pages: [],
  links: [],
  sayAfter: false,
  href: null,
  link: null,
  symbol: null,
  book: null,
};

describe("chat stream", () => {
  it("reads a title change split across chunks, then the answer", async () => {
    const events: string[] = [];
    const payload = [
      JSON.stringify({ type: "ping" }),
      JSON.stringify({
        type: "step",
        title: "Planning the turn",
        text: "Choosing which filings to read.",
      }),
      JSON.stringify({
        type: "thought",
        fresh: true,
        text: "**Choosing the book**\nNames.",
      }),
      JSON.stringify({
        type: "thought",
        fresh: false,
        text: "**Choosing the book**\nNames. Open it.",
      }),
      JSON.stringify({ type: "result", result }),
    ].join("\n");
    const cut = 40;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, cut)));
        controller.enqueue(new TextEncoder().encode(payload.slice(cut)));
        controller.close();
      },
    });
    let answer = "";
    await readChatEvents(stream, (event) => {
      if (event.type === "step" || event.type === "thought") {
        events.push(event.type === "step" ? event.title : event.text);
      }
      if (event.type === "result") answer = event.result.say;
    });
    expect(events[0]).toBe("Planning the turn");
    expect(events[1]).toContain("Choosing the book");
    expect(events[2]).toContain("Open it.");
    expect(answer).toBe("Two names.");
  });

  it("drops a signature line and a bad body", () => {
    expect(parseChatEvent('{"type":"ping"}')).toEqual({ type: "ping" });
    expect(parseChatEvent("not json")).toBeNull();
    expect(parseChatEvent('{"type":"thought","text":""}')).toBeNull();
    expect(
      parseChatRequest({ sentence: "  ITC price  ", focus: null }),
    ).toEqual({
      sentence: "ITC price",
      focus: null,
      prior: null,
    });
    expect(parseChatRequest({ sentence: "" })).toBeNull();
    expect(
      parseChatRequest({
        sentence: "x",
        focus: "THISSYMBOLISWAYTOOLONG",
      }),
    ).toBeNull();
  });
});
