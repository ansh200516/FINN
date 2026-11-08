import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { istTimeOn } from "@/lib/time";
import {
  TranscriptPending,
  transcriptPendingExpectedBy,
} from "@/ui/TranscriptPending";

const NOV15 = istTimeOn("2026-11-15", "23:59");

describe("transcriptPendingExpectedBy", () => {
  it("returns the deadline when results are in and the call is not", () => {
    expect(
      transcriptPendingExpectedBy(
        {
          holdsConcalls: true,
          pending: { period: "Q2FY27", expectedBy: NOV15 },
        },
        false,
      ),
    ).toBe(NOV15);
  });

  it("does not invent a date for an annual-report-only company", () => {
    expect(
      transcriptPendingExpectedBy(
        {
          holdsConcalls: false,
          pending: { period: "Q2FY27", expectedBy: NOV15 },
        },
        false,
      ),
    ).toBeNull();
  });

  it("stays quiet when the cover letter already recovered the call", () => {
    expect(
      transcriptPendingExpectedBy(
        {
          holdsConcalls: true,
          pending: { period: "Q2FY27", expectedBy: NOV15 },
        },
        true,
      ),
    ).toBeNull();
  });

  it("does not invent a date when the deadline is unknown", () => {
    expect(
      transcriptPendingExpectedBy(
        {
          holdsConcalls: true,
          pending: { period: "Q2FY27", expectedBy: null },
        },
        false,
      ),
    ).toBeNull();
    expect(
      transcriptPendingExpectedBy(
        { holdsConcalls: true, pending: null },
        false,
      ),
    ).toBeNull();
    expect(transcriptPendingExpectedBy(null, false)).toBeNull();
  });
});

describe("TranscriptPending", () => {
  it("is one plain receipt line with the date and no glyph", () => {
    const html = renderToStaticMarkup(
      createElement(TranscriptPending, { expectedBy: NOV15 }),
    );
    expect(html).toBe(
      '<p class="receipt">Transcript pending · expected by 15 Nov 2026</p>',
    );
    expect(html).not.toMatch(/◐|⏳|📄/);
  });
});
