import { describe, expect, it } from "vitest";
import { pageForQuote } from "@/lib/quotePage";

const QUOTE =
  "We are well on track to deliver between 60 million to 62 million new loans in FY27.";

describe("pageForQuote", () => {
  it("links a quote that sits on the next extracted page", () => {
    expect(
      pageForQuote(
        QUOTE,
        [
          { page: 3, text: "Earlier remarks about the franchise." },
          { page: 4, text: `Management said: ${QUOTE} That is the plan.` },
        ],
        3,
      ),
    ).toBe(4);
  });

  it("keeps the stored page when the quote is already on it", () => {
    expect(
      pageForQuote(
        QUOTE,
        [
          { page: 16, text: QUOTE },
          { page: 17, text: "The next page is a different topic." },
        ],
        16,
      ),
    ).toBe(16);
  });

  it("links a quote that is several pages after the stored page", () => {
    expect(
      pageForQuote(
        "On Revenue, we expect growth to be in the range of 10% to 12% for FY27.",
        [
          { page: 2, text: "The call opened with a summary." },
          {
            page: 13,
            text: "On Revenue, we expect growth to be in the range of 10% to 12% for FY27.",
          },
        ],
        2,
      ),
    ).toBe(13);
  });

  it("keeps the stored page when the quote is on no extracted page", () => {
    expect(
      pageForQuote(
        QUOTE,
        [
          { page: 3, text: "We are well on track." },
          {
            page: 4,
            text: "to deliver between 60 million to 62 million new loans.",
          },
        ],
        3,
      ),
    ).toBe(3);
  });

  it("keeps the stored page when the quote is on several pages and not the stored one", () => {
    expect(
      pageForQuote(
        QUOTE,
        [
          { page: 6, text: QUOTE },
          { page: 29, text: `Later in the call: ${QUOTE}` },
        ],
        28,
      ),
    ).toBe(28);
  });

  it("keeps the stored page when that page contains the quote and another page repeats it", () => {
    expect(
      pageForQuote(
        QUOTE,
        [
          { page: 4, text: QUOTE },
          { page: 27, text: QUOTE },
        ],
        4,
      ),
    ).toBe(4);
  });
});
