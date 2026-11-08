import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AskSheet } from "@/ui/AskSheet";
import { ASK_WAIT_SLOW_MS, askFailureCopy, askWaitCopy } from "@/ui/ask/status";

const SLOW = "Still reading the filings. This can take a minute.";

function oneSentence(line: string) {
  expect(line).toMatch(/^[^.!?]+[.]$/);
}

describe("askWaitCopy", () => {
  it("names the filings for the first eight seconds", () => {
    expect(ASK_WAIT_SLOW_MS).toBe(8_000);
    expect(askWaitCopy("SUPREMEIND", 0)).toBe("Reading SUPREMEIND’s filings");
    expect(askWaitCopy("SUPREMEIND", ASK_WAIT_SLOW_MS - 1)).toBe(
      "Reading SUPREMEIND’s filings",
    );
  });

  it("says the read is still going once eight seconds have passed", () => {
    expect(askWaitCopy("SUPREMEIND", ASK_WAIT_SLOW_MS)).toBe(SLOW);
    expect(askWaitCopy("SUPREMEIND", 60_000)).toBe(SLOW);
  });

  it("never uses the Asking label", () => {
    for (const ms of [0, ASK_WAIT_SLOW_MS - 1, ASK_WAIT_SLOW_MS, 60_000]) {
      expect(askWaitCopy("SUPREMEIND", ms)).not.toMatch(/Asking/);
    }
  });
});

describe("askFailureCopy", () => {
  it("says a timeout in one sentence", () => {
    for (const line of [
      askFailureCopy({ status: 504 }),
      askFailureCopy({ status: 408, error: "Ask failed" }),
      askFailureCopy({ error: "timeout after 60000 ms" }),
      askFailureCopy({ error: "Gateway deadline exceeded" }),
    ]) {
      expect(line).toBe("The ask timed out.");
      oneSentence(line);
    }
  });

  it("says a failure in one sentence and does not pass browser errors through", () => {
    expect(askFailureCopy({ status: 500, error: "Ask failed" })).toBe(
      "The ask failed.",
    );
    expect(askFailureCopy({ error: "Failed to fetch" })).toBe(
      "The ask failed.",
    );
    expect(askFailureCopy({ error: null })).toBe("The ask failed.");
    expect(
      askFailureCopy({ status: 503, error: "Model budget exhausted" }),
    ).toBe("The model budget is exhausted.");
    expect(
      askFailureCopy({ status: 429, error: "Daily ask limit reached" }),
    ).toBe("The daily ask limit is reached.");
    expect(askFailureCopy({ status: 404, error: "Unknown symbol" })).toBe(
      "That symbol is not on file.",
    );
    oneSentence(askFailureCopy({ error: "Ask failed" }));
  });
});

describe("AskSheet", () => {
  it("does not render Asking, a spinner, or a progress bar while idle", () => {
    const html = renderToStaticMarkup(
      createElement(AskSheet, {
        symbol: "SUPREMEIND",
        budget: null,
        docCount: 2,
      }),
    );
    expect(html).not.toContain("Asking");
    expect(html).toContain("Ask");
    expect(html).not.toMatch(/spinner|skeleton|progressbar|animate-pulse/i);
  });
});
