/**
 * Cheap smoke tests for pure (server-renderable) components via
 * renderToStaticMarkup — no DOM, no browser. Written without JSX because the
 * shared vitest include list is `*.test.ts`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResultsCard } from "@/engine/types";
import { CategoryGlyph } from "@/ui/CategoryGlyph";
import { DeltaChip } from "@/ui/DeltaChip";
import { Receipt } from "@/ui/Receipt";
import { gridRows, ResultsGrid } from "@/ui/ResultsGrid";
import { Sparkline } from "@/ui/Sparkline";
import { VerdictBadge } from "@/ui/VerdictBadge";
import { resolveWindow, widenSequence } from "@/ui/window";

const CR = 1e7;

describe("DeltaChip", () => {
  it("renders arrow, sign and the colour class", () => {
    const html = renderToStaticMarkup(createElement(DeltaChip, { value: 9.8 }));
    expect(html).toContain("▲");
    expect(html).toContain("+9.8%");
    expect(html).toContain("delta-up");
    const down = renderToStaticMarkup(
      createElement(DeltaChip, { value: -2.3 }),
    );
    expect(down).toContain("▼");
    expect(down).toContain("\u22122.3%");
    expect(down).toContain("delta-down");
    const none = renderToStaticMarkup(
      createElement(DeltaChip, { value: null }),
    );
    expect(none).toContain("—");
    expect(none).not.toContain("▲");
  });
});

describe("Sparkline", () => {
  it("draws a path and an end dot for 2+ points", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, {
        values: [1, 2, 3, 2, 4],
        ariaLabel: "five points",
      }),
    );
    expect(html).toContain("<path");
    expect(html).toContain("<circle");
    expect(html).toContain('aria-label="five points"');
  });
  it("renders a dotted placeholder with fewer than two points", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { values: [null, 5] }),
    );
    expect(html).toContain("stroke-dasharray");
    expect(html).not.toContain("<path");
  });
});

describe("VerdictBadge", () => {
  it("has a glyph and a word for every verdict", () => {
    for (const v of [
      "kept",
      "beat",
      "missed",
      "cut",
      "raised",
      "withdrawn",
      "not_addressed",
      "unverifiable",
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(VerdictBadge, { verdict: v }),
      );
      expect(html).toContain("verdict:");
      expect(html.length).toBeGreaterThan(40);
    }
    expect(
      renderToStaticMarkup(createElement(VerdictBadge, { verdict: "missed" })),
    ).toContain("✕");
  });
});

describe("CategoryGlyph", () => {
  it("falls back to the routine glyph for unknown categories", () => {
    const a = renderToStaticMarkup(
      createElement(CategoryGlyph, { category: "nonsense" }),
    );
    const b = renderToStaticMarkup(
      createElement(CategoryGlyph, { category: "unclassified" }),
    );
    expect(a).toBe(b);
  });
});

describe("ResultsGrid", () => {
  const card: ResultsCard = {
    isin: "INE002A01018",
    basis: "consolidated",
    checksum: "exchange_xbrl",
    rows: [
      {
        metric: "revenue",
        value: 332861 * CR,
        qoqPct: 6.7,
        yoyPct: 28.6,
        spark: [258898, 269496, 298621, 311850, 332861].map((v) => v * CR),
      },
      {
        metric: "pat",
        value: 29550 * CR,
        qoqPct: 27.4,
        yoyPct: 33.8,
        spark: [],
      },
    ],
    ebitdaFormula: "pbt+fin+dna-oi",
    sourceUrl: null,
  };
  it("normalises raw rupee rows to crore", () => {
    const rows = gridRows(card);
    expect(rows[0]?.valueCr).toBe(332861);
    expect(rows[0]?.label).toBe("Revenue");
  });
  it("prefers render-ready headline rows when present", () => {
    const rows = gridRows({
      ...card,
      headline: [
        {
          metric: "nii",
          label: "NII",
          currentCr: 44464.2,
          prevQuarterCr: null,
          yoyQuarterCr: null,
          qoqDeltaCr: null,
          qoqPct: null,
          yoyDeltaCr: null,
          yoyPct: null,
          marginPct: null,
          prevMarginPct: null,
          yoyMarginPct: null,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("NII");
  });
  it("renders values with Indian grouping and the verification badge", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsGrid, {
        card,
        periodEnd: "2026-09-30",
        withSpark: false,
      }),
    );
    expect(html).toContain("3,32,861");
    expect(html).toContain("29,550");
    expect(html).toContain("Q2 FY27");
    expect(html).toContain("Exchange XBRL verified");
    expect(html).toContain("+28.6%");
  });
});

describe("Receipt", () => {
  it("marks steps with distinct glyphs and never a spinner", () => {
    const html = renderToStaticMarkup(
      createElement(Receipt, {
        steps: [
          { label: "a", state: "done" },
          { label: "b", state: "working" },
          { label: "c", state: "queued" },
        ],
      }),
    );
    expect(html).toContain("✓");
    expect(html).toContain("working");
    expect(html).not.toMatch(/spinner|skeleton|shimmer/i);
  });
});

describe("window resolution", () => {
  const now = Date.UTC(2026, 10, 8, 13, 10); // Sun 8 Nov 18:40 IST
  it("defaults to an auto 24 h window", () => {
    const w = resolveWindow(now, {});
    expect(w.preset).toBe("24h");
    expect(w.auto).toBe(true);
    expect(w.toMs - w.fromMs).toBe(24 * 3_600_000);
  });
  it("honours presets and custom ranges", () => {
    expect(resolveWindow(now, { w: "7d" }).label).toBe("Last 7 days");
    expect(resolveWindow(now, { w: "close" }).label).toMatch(
      /^Since \w{3} close$/,
    );
    const c = resolveWindow(now, { from: "2026-11-01", to: "2026-11-08" });
    expect(c.preset).toBe("custom");
    expect(c.label).toBe("1–8 Nov");
    expect(c.toMs).toBeLessThanOrEqual(now);
  });
  it("widens through 7 d and 30 d when the last close is inside 24 h", () => {
    // Sun 8 Nov: the Muhurat session closed at 15:30 IST, inside the 24 h window
    expect(widenSequence(now)).toEqual(["7d", "30d"]);
  });
  it("offers since-close first on a plain weekend", () => {
    const sunday = Date.UTC(2026, 10, 15, 13, 10); // Sun 15 Nov 18:40 IST, last close Fri 13 Nov
    expect(widenSequence(sunday)).toEqual(["close", "7d", "30d"]);
  });
});
