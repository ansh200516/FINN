import { describe, expect, it } from "vitest";
import {
  appendThought,
  companyLabel,
  consumeThoughtParts,
  planMoment,
  quarterSpan,
  reduceTrace,
  scoreMoment,
  type ThoughtScan,
  thoughtTitle,
  toolMoment,
  visibleThoughtText,
} from "@/lib/finnieTrace";

const rows = [
  { symbol: "HDFCBANK", name: "HDFC Bank Limited" },
  { symbol: "RELIANCE", name: "Reliance Industries Limited" },
];

describe("visible thoughts", () => {
  it("shows a thought summary and hides signatures and redacted parts", () => {
    expect(
      visibleThoughtText({
        thought: true,
        text: "Comparing the two quarters against guidance.",
      }),
    ).toBe("Comparing the two quarters against guidance.");
    expect(
      visibleThoughtText({
        thought: true,
        thoughtSignature: "c2lnbmF0dXJl",
      }),
    ).toBeNull();
    expect(
      visibleThoughtText({
        thought: true,
        text: "c2lnbmF0dXJl",
        thoughtSignature: "c2lnbmF0dXJl",
      }),
    ).toBeNull();
    expect(
      visibleThoughtText({
        thought: true,
        text: "the raw chain",
        redacted: true,
      }),
    ).toBeNull();
    expect(
      visibleThoughtText({ thought: true, text: "[REDACTED]" }),
    ).toBeNull();
    expect(
      visibleThoughtText({
        thought: true,
        text: "A".repeat(90),
      }),
    ).toBeNull();
    expect(visibleThoughtText({ text: "This is the answer." })).toBeNull();
  });

  it("appends streamed summaries and starts fresh after the answer", () => {
    const state: ThoughtScan = { answer: "", thought: "", thoughtOpen: false };
    const first = consumeThoughtParts(
      [{ thought: true, text: "**Reading guidance**\n" }],
      state,
    );
    const second = consumeThoughtParts(
      [{ thought: true, text: "HDFC's rows are next." }],
      state,
    );
    expect(first[0]?.fresh).toBe(true);
    expect(second[0]?.fresh).toBe(false);
    expect(second[0]?.text).toContain("HDFC's rows are next.");
    consumeThoughtParts(
      [
        { thought: true, text: "hidden", thoughtSignature: "hidden" },
        { text: '{"say":"Kept."}' },
      ],
      state,
    );
    expect(state.answer).toBe('{"say":"Kept."}');
    const again = consumeThoughtParts(
      [{ thought: true, text: "Scoring the quarters." }],
      state,
    );
    expect(again[0]?.fresh).toBe(true);
    expect(again[0]?.text).toBe("Scoring the quarters.");
    expect(state.answer).toBe('{"say":"Kept."}');
  });

  it("keeps a cumulative thought chunk from doubling", () => {
    expect(appendThought("Read", "ing guidance", false)).toBe(
      "Reading guidance",
    );
    expect(appendThought("Reading", "Reading guidance", false)).toBe(
      "Reading guidance",
    );
  });
});

describe("thought titles", () => {
  it("uses the bold heading, otherwise the first clause", () => {
    expect(
      thoughtTitle("**Comparing guidance to results**\n\nThe rows are in."),
    ).toBe("Comparing guidance to results");
    expect(
      thoughtTitle(
        "Reading the guidance rows for the bank before the quarter print.",
      ),
    ).toBe("Reading the guidance rows");
    expect(thoughtTitle("Score the last two quarters.")).toBe(
      "Score the last two quarters.",
    );
  });

  it("replaces the step title once a thought exists", () => {
    let items = reduceTrace([], {
      type: "step",
      title: "Planning the turn",
      text: "Choosing which filings to read.",
    });
    items = reduceTrace(items, {
      type: "step",
      title: "Reading HDFC Bank guidance",
      text: "Reading HDFC Bank's guidance rows.",
    });
    expect(items.map((item) => item.title)).toEqual([
      "Reading HDFC Bank guidance",
    ]);
    items = reduceTrace(items, {
      type: "thought",
      fresh: true,
      text: "**Scoring two quarters**\nKept against the guidance.",
    });
    items = reduceTrace(items, {
      type: "thought",
      fresh: false,
      text: "**Scoring two quarters**\nKept against the guidance. One is open.",
    });
    items = reduceTrace(items, {
      type: "step",
      title: "Writing the answer",
      text: "Writing the answer from the filings just read.",
    });
    expect(items.map((item) => item.title)).toEqual(["Scoring two quarters"]);
    expect(items[0]?.text).toContain("One is open.");
    expect(items[0]?.source).toBe("thought");
    expect(items.some((item) => item.source === "step")).toBe(false);
  });

  it("updates the collapsed title as the thought text arrives", () => {
    let items = reduceTrace([], {
      type: "thought",
      fresh: true,
      text: "Comparing",
    });
    expect(items[0]?.title).toBe("Comparing");
    items = reduceTrace(items, {
      type: "thought",
      fresh: false,
      text: "Comparing the delivered quarters now. The margin is the rest of the thought.",
    });
    expect(items[0]?.title).toBe("Comparing the delivered quarters now.");
    expect(items[0]?.text).toContain("margin is the rest");
  });
});

describe("step titles", () => {
  it("names the filing actually being read", () => {
    expect(companyLabel("HDFCBANK", rows)).toBe("HDFC Bank");
    expect(planMoment("HDFC Bank").title).toBe("Planning HDFC Bank");
    expect(toolMoment("get_promises", { symbol: "HDFCBANK" }, rows).title).toBe(
      "Reading HDFC Bank guidance",
    );
    expect(
      toolMoment("get_results", { symbol: "HDFCBANK", quarters: 2 }, rows),
    ).toEqual({
      title: "Reading the last two quarters",
      text: "Reading HDFC Bank's last two quarters.",
    });
    expect(quarterSpan(2)).toBe("the last two quarters");
    expect(scoreMoment("HDFC Bank", 2)).toEqual({
      title: "Scoring the last two quarters",
      text: "Scoring HDFC Bank's last two quarters against the guidance on file.",
    });
    expect(toolMoment("get_quote", { symbol: "RELIANCE" }, rows).title).toBe(
      "Checking Reliance Industries price",
    );
  });
});
