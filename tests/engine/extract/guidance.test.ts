import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// never call Gemini from a test
vi.mock("@/engine/llm/gateway", () => ({
  callStructured: vi.fn(),
}));

import {
  adjectiveBand,
  applyCueWords,
  assessGuidanceGrounding,
  chunkTurns,
  dedupeStatements,
  extractGuidanceDetailed,
  type GateStats,
  gateStatement,
  guidanceId,
  type ModelStatementT,
  numberFriendly,
  numberInQuote,
  parseHorizon,
  reconcileMetricUnit,
} from "@/engine/extract/guidance";
import {
  makePeriod,
  managementTurns,
  parsePeriodLabel,
  parseTranscript,
} from "@/engine/extract/transcript";
import { callStructured } from "@/engine/llm/gateway";
import type { DocumentText, TranscriptTurn } from "@/engine/types";

const FIX = join(process.cwd(), "tests", "fixtures", "docs");
function fixture(name: string): DocumentText {
  const raw = JSON.parse(
    readFileSync(join(FIX, `${name}.pages.json`), "utf8"),
  ) as DocumentText;
  return { docId: raw.docId, pages: raw.pages };
}
const Q2FY27 = makePeriod("quarter", 2027, 2);

function stats(): GateStats {
  return {
    candidates: 0,
    quoteRejected: 0,
    numberRejected: 0,
    backwardRejected: 0,
    duplicates: 0,
    kept: 0,
    adjectival: 0,
  };
}

const turn: TranscriptTurn = {
  index: 7,
  speaker: "M. P. Taparia",
  role: "management",
  section: "qa",
  page: 8,
  text: "FY27, we expect our business to grow between INR13,500 crores to INR14,000 crores, operating margin between 14% to 14.5%. Capex outflow should not be more than INR700-750 crores. We expect teens revenue growth next year.",
};
const doc: DocumentText = {
  docId: "d1",
  pages: [{ page: 8, text: turn.text }],
};
const ctx = (model = "mock") => ({
  turns: new Map([[turn.index, turn]]),
  chunkText: turn.text,
  docText: doc,
  callPeriod: Q2FY27,
  chunk: 0,
  model,
});

function ms(over: Partial<ModelStatementT>): ModelStatementT {
  return {
    turn: 7,
    quote: "operating margin between 14% to 14.5%",
    metric: "operating_margin",
    direction: "range",
    value_low: 14,
    value_high: 14.5,
    unit: "pct",
    horizon: "FY27",
    comparison: "absolute",
    revision: "new",
    is_explicit: true,
    confidence: 0.9,
    ...over,
  };
}

describe("gates", () => {
  it("accepts a verbatim quote with grounded numbers and converts units", () => {
    const st = stats();
    const v = gateStatement(
      ms({
        quote:
          "we expect our business to grow between INR13,500 crores to INR14,000 crores",
        metric: "revenue",
        value_low: 13500,
        value_high: 14000,
        unit: "inr_cr",
      }),
      ctx(),
      st,
    );
    expect(v).not.toBeNull();
    expect(v).toMatchObject({
      low: 13500e7,
      high: 14000e7,
      unit: "INR",
      horizon: "FY27",
      horizonEnd: "2027-03-31",
      page: 8,
      speaker: "M. P. Taparia",
      isExplicit: true,
      verifiedAgainst: "turn",
    });
    expect(st.kept).toBe(1);
  });
  it("drops a paraphrased / fabricated quote (the model copied last quarter's sentence)", () => {
    const st = stats();
    const v = gateStatement(
      ms({
        quote:
          "we expect our margin guidance for the full year at 14% to 14.5%",
      }),
      ctx(),
      st,
    );
    expect(v).toBeNull();
    expect(st.quoteRejected).toBe(1);
  });
  it("drops numbers that are not literally in the quote", () => {
    const st = stats();
    const v = gateStatement(ms({ value_low: 14, value_high: 15 }), ctx(), st);
    expect(v).toBeNull();
    expect(st.numberRejected).toBe(1);
  });
  it("grounds numbers glued to currency prefixes and hyphenated ranges", () => {
    expect(numberFriendly("INR700-750 crores")).toBe("INR 700 to 750 crores");
    const st = stats();
    const v = gateStatement(
      ms({
        quote: "Capex outflow should not be more than INR700-750 crores",
        metric: "capex",
        value_low: 700,
        value_high: 750,
        unit: "inr_cr",
      }),
      ctx(),
      st,
    );
    expect(v).toMatchObject({ low: 700e7, high: 750e7, unit: "INR" });
  });
  it("finds a quote the model attributed to the wrong turn and fixes the page", () => {
    const other: TranscriptTurn = {
      ...turn,
      index: 3,
      page: 5,
      text: "Nothing relevant here at all.",
    };
    const c = {
      ...ctx(),
      turns: new Map([
        [3, other],
        [7, turn],
      ]),
    };
    const v = gateStatement(ms({ turn: 3 }), c, stats());
    expect(v).toMatchObject({ page: 8, turn: 7, verifiedAgainst: "turn" });
  });
  it("drops statements whose horizon ended before the call (reported numbers)", () => {
    const st = stats();
    const v = gateStatement(
      ms({ quote: "operating margin between 14% to 14.5%", horizon: "H1FY27" }),
      { ...ctx(), callDate: "2026-10-26" },
      st,
    );
    expect(v).toBeNull();
    expect(st.backwardRejected).toBe(1);
    expect(
      gateStatement(
        ms({ horizon: "FY27" }),
        { ...ctx(), callDate: "2026-10-26" },
        stats(),
      ),
    ).not.toBeNull();
  });
  it("maps adjectival guidance to a band and marks it non-explicit", () => {
    const st = stats();
    const v = gateStatement(
      ms({
        quote: "We expect teens revenue growth next year",
        metric: "revenue_growth",
        direction: "increase",
        value_low: null,
        value_high: null,
        unit: "text",
        horizon: "next year",
        comparison: "yoy",
        is_explicit: false,
      }),
      ctx(),
      st,
    );
    expect(v).toMatchObject({
      low: 13,
      high: 19,
      unit: "%",
      isExplicit: false,
      horizon: "FY28",
      horizonEnd: "2028-03-31",
    });
    expect(st.adjectival).toBe(1);
  });
  it("ignores model numbers when it says the statement is not explicit", () => {
    const v = gateStatement(
      ms({
        quote: "We expect teens revenue growth next year",
        metric: "revenue_growth",
        value_low: 15,
        value_high: 17,
        is_explicit: false,
        horizon: "FY28",
      }),
      ctx(),
      stats(),
    );
    expect(v).toMatchObject({ low: 13, high: 19, isExplicit: false });
  });
});

describe("band mapping and cue words", () => {
  it("covers the docs/02 vocabulary", () => {
    expect(adjectiveBand("high single digit growth")).toMatchObject({
      low: 7,
      high: 9,
    });
    expect(adjectiveBand("low teens")).toMatchObject({ low: 10, high: 13 });
    expect(adjectiveBand("mid-twenties EBITDA growth")).toMatchObject({
      low: 24,
      high: 26,
    });
    expect(adjectiveBand("double-digit volume growth")).toMatchObject({
      low: 10,
      high: null,
    });
    expect(adjectiveBand("margins will be flat")).toMatchObject({
      low: 0,
      high: 0,
    });
    expect(adjectiveBand("we sold 12 units")).toBeNull();
  });
  it("keeps the quoted figure for 'about X' (approx flag) and opens 'at least' / 'up to'", () => {
    expect(
      applyCueWords("volume growth of about 10% for FY27", 10, 10, "%"),
    ).toEqual({ low: 10, high: 10, approx: true });
    expect(applyCueWords("at least 15% growth", 15, 15, "%")).toEqual({
      low: 15,
      high: null,
      approx: false,
    });
    expect(applyCueWords("capex of up to 800 crores", 800, 800, "INR")).toEqual(
      { low: null, high: 800, approx: false },
    );
    expect(applyCueWords("between 14% to 14.5%", 14, 14.5, "%")).toEqual({
      low: 14,
      high: 14.5,
      approx: false,
    });
  });
  it("enforces metric/unit compatibility (quality list b)", () => {
    expect(reconcileMetricUnit("revenue_growth", "INR", true)).toMatchObject({
      metric: "revenue",
      typeIssue: false,
    });
    expect(reconcileMetricUnit("revenue", "%", true)).toMatchObject({
      metric: "revenue_growth",
      typeIssue: false,
    });
    expect(reconcileMetricUnit("ebitda_margin", "INR", true)).toMatchObject({
      metric: "other",
      typeIssue: true,
    });
    expect(reconcileMetricUnit("loan_growth", "INR", true)).toMatchObject({
      metric: "other",
      typeIssue: true,
    });
    expect(reconcileMetricUnit("capacity", "%", true)).toMatchObject({
      metric: "capacity",
      typeIssue: false,
    });
    expect(reconcileMetricUnit("tax_rate", "%", true)).toMatchObject({
      metric: "tax_rate",
      typeIssue: false,
    });
    expect(
      reconcileMetricUnit("revenue_growth", "qualitative", false),
    ).toMatchObject({ metric: "revenue_growth", typeIssue: false });
  });
});

describe("horizon parsing (relative to a Q2FY27 call)", () => {
  const cp = parsePeriodLabel("Q2FY27");
  it("handles explicit and relative horizons", () => {
    expect(parseHorizon("FY27", cp)).toMatchObject({
      label: "FY27",
      end: "2027-03-31",
    });
    expect(parseHorizon("FY 2026-27", cp)).toMatchObject({ label: "FY27" });
    expect(parseHorizon("Q3FY27", cp)).toMatchObject({
      label: "Q3FY27",
      end: "2026-12-31",
    });
    expect(parseHorizon("Q4", cp)).toMatchObject({ label: "Q4FY27" });
    expect(parseHorizon("Q1", cp)).toMatchObject({ label: "Q1FY28" });
    expect(parseHorizon("H2 FY27", cp)).toMatchObject({
      label: "H2FY27",
      end: "2027-03-31",
    });
    expect(parseHorizon("second half", cp)).toMatchObject({ label: "H2FY27" });
    expect(parseHorizon("this year", cp)).toMatchObject({ label: "FY27" });
    expect(parseHorizon("next year", cp)).toMatchObject({ label: "FY28" });
    expect(parseHorizon("next quarter", cp)).toMatchObject({ label: "Q3FY27" });
    expect(parseHorizon("exit rate", cp)).toMatchObject({ label: "Q4FY27" });
    expect(parseHorizon("by FY30", cp)).toMatchObject({
      label: "FY30",
      end: "2030-03-31",
    });
    expect(parseHorizon("next 2-3 years", cp)).toMatchObject({
      label: "medium_term",
      end: null,
    });
    expect(parseHorizon("medium term", cp)).toMatchObject({
      label: "medium_term",
    });
    expect(parseHorizon("long term", cp)).toMatchObject({ label: "long_term" });
    expect(parseHorizon(null, cp)).toMatchObject({ label: null, end: null });
  });
});

describe("chunking and de-duplication", () => {
  it("groups management turns into ~chunk-sized blocks and splits giant turns by sentence", () => {
    const turns: TranscriptTurn[] = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      speaker: "CEO",
      role: "management",
      section: "opening",
      page: 1 + i,
      text: `Sentence number ${i}. `.repeat(400).trim(),
    }));
    const chunks = chunkTurns(turns, 12_000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.chars <= 12_000 * 1.05)).toBe(true);
    expect(chunks[0]?.text).toMatch(/^\[T0 \| CEO \| p1/);
    const giant = chunkTurns(
      [
        {
          ...(turns[0] as TranscriptTurn),
          text: "A long sentence here. ".repeat(2000),
        },
      ],
      10_000,
    );
    expect(giant.length).toBeGreaterThan(3);
    expect(giant[0]?.text).toMatch(/part 1\//);
  });
  it("drops repeated quotes and restated commitments within a document", () => {
    const a = {
      quote: "margin guidance for the full year at 14% to 14.5%",
      metric: "operating_margin",
      horizon: "FY27",
      low: 14,
      high: 14.5,
      unit: "%",
      isExplicit: true,
      direction: "range" as const,
      status: "open" as const,
      speaker: null,
      role: null,
      page: 7,
    };
    const b = {
      ...a,
      quote:
        "we have given guidance of operating margin between 14% to 14.5% for the full year",
      page: 8,
    };
    const c = {
      ...a,
      metric: "capex",
      quote: "capex of 700 crores",
      low: 700e7,
      high: 700e7,
      unit: "INR",
    };
    const st = stats();
    const out = dedupeStatements([a, b, c], st);
    expect(out).toHaveLength(2);
    expect(st.duplicates).toBe(1);
    expect((out[0] as { restatements?: number }).restatements).toBe(1);
  });
  it("derives a stable id from doc, quote, metric and horizon", () => {
    const id1 = guidanceId("doc_x", {
      quote: "A  b",
      metric: "capex",
      horizon: "FY27",
    });
    const id2 = guidanceId("doc_x", {
      quote: "a b",
      metric: "capex",
      horizon: "FY27",
    });
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^g_[0-9a-f]{20}$/);
    expect(
      guidanceId("doc_y", { quote: "a b", metric: "capex", horizon: "FY27" }),
    ).not.toBe(id1);
  });
});

describe("extractGuidanceDetailed (mocked model)", () => {
  beforeEach(() => {
    vi.mocked(callStructured).mockReset();
  });
  it("runs the chunked pipeline over management turns only and keeps gate statistics", async () => {
    const d = fixture("supremeind-q2fy27");
    const parsed = parseTranscript(d);
    const mgmt = managementTurns(parsed);
    const t = mgmt.find((x) =>
      /volume growth of about 10%/.test(x.text),
    ) as TranscriptTurn;
    expect(t).toBeDefined();
    vi.mocked(callStructured).mockImplementation((async (
      o: Parameters<typeof callStructured>[0],
    ) => {
      // the model must only ever see management speech
      const sent = (o.parts ?? [])
        .map((p) => (p.kind === "text" ? p.text : ""))
        .join("\n");
      expect(sent).not.toMatch(/\| Moderator \|/);
      expect(sent).toMatch(/\[T\d+ \| M\. P\. Taparia \| p\d+\]/);
      return {
        data: {
          statements: [
            ms({
              turn: t.index,
              quote:
                "we expect company- wide volume growth of about 10% for FY27",
              metric: "volume_growth",
              direction: "target",
              value_low: 10,
              value_high: 10,
              horizon: "FY27",
              comparison: "yoy",
            }),
            ms({
              turn: t.index,
              quote:
                "we expect company-wide volume growth of roughly 12% for FY27",
              metric: "volume_growth",
              value_low: 12,
              value_high: 12,
            }), // fabricated
            ms({
              turn: t.index,
              quote:
                "we expect company- wide volume growth of about 10% for FY27",
              metric: "volume_growth",
              value_low: 11,
              value_high: 11,
            }), // wrong number
          ],
        },
        model: "mock-flash-lite",
        cached: false,
        tokensIn: 1000,
        tokensOut: 100,
        tokensThought: 0,
        latencyMs: 5,
        cacheKey: "k",
      } as never;
    }) as never);
    const r = await extractGuidanceDetailed(d, {
      isin: "INE195A01028",
      period: "Q2FY27",
    });
    expect(r.calls).toBe(1);
    expect(r.stats).toMatchObject({
      candidates: 3,
      quoteRejected: 1,
      numberRejected: 1,
      kept: 1,
    });
    expect(r.statements[0]).toMatchObject({
      metric: "volume_growth",
      low: 10,
      high: 10,
      approx: true,
      unit: "%",
      horizon: "FY27",
      page: t.page,
      speaker: "M. P. Taparia",
      model: "mock-flash-lite",
    });
    expect(vi.mocked(callStructured).mock.calls[0]?.[0]).toMatchObject({
      task: "guidance_extract",
      tier: "bulk",
    });
  });
  it("stops at the call budget and reports it", async () => {
    vi.mocked(callStructured).mockResolvedValue({
      data: { statements: [] },
      model: "m",
      cached: false,
      tokensIn: 1,
      tokensOut: 1,
      tokensThought: 0,
      latencyMs: 1,
      cacheKey: "k",
    } as never);
    const r = await extractGuidanceDetailed(
      fixture("infy-q2fy27"),
      { isin: "INE009A01021", period: "Q2FY27" },
      { maxCalls: 0 },
    );
    expect(r.calls).toBe(0);
    expect(r.errors[0]).toMatch(/budget/);
  });
});

describe("horizon guard", () => {
  it("snaps 'this financial year' to the call's fiscal year when the model drifts", async () => {
    const { reconcileHorizon } = await import("@/engine/extract/guidance");
    const cp = parsePeriodLabel("Q3FY26");
    const drifted = parseHorizon("FY28", cp);
    expect(
      reconcileHorizon(
        "The new revenue growth guidance for this financial year is 3% to 3.5%",
        drifted,
        cp,
      ).label,
    ).toBe("FY26");
    // an explicit FY in the quote is respected
    expect(
      reconcileHorizon(
        "Our operating margin guidance for financial year FY27 is 20% to 22%",
        parseHorizon("FY27", cp),
        cp,
      ).label,
    ).toBe("FY27");
    // "next year" is left to the model
    expect(
      reconcileHorizon(
        "we expect double-digit growth next financial year",
        parseHorizon("FY27", cp),
        cp,
      ).label,
    ).toBe("FY27");
    // quarter horizons are untouched
    expect(
      reconcileHorizon(
        "full year margin will be 14%",
        parseHorizon("Q4FY26", cp),
        cp,
      ).label,
    ).toBe("Q4FY26");
    // a Q4FY26 call (held April 2026) guiding "this year" means FY27; "financial year 2027" is explicit
    const q4 = parsePeriodLabel("Q4FY26");
    expect(parseHorizon("this year", q4).label).toBe("FY27");
    expect(parseHorizon("next year", q4).label).toBe("FY28");
    expect(parseHorizon("next quarter", q4).label).toBe("Q1FY27");
    expect(
      reconcileHorizon(
        "Our revenue growth guidance for the financial year 2027 is 1.5% to 3.5%",
        parseHorizon("FY26", q4),
        q4,
      ).label,
    ).toBe("FY27");
    expect(
      reconcileHorizon(
        "this year we are confident of delivering 20% to 22%",
        parseHorizon("FY26", q4),
        q4,
      ).label,
    ).toBe("FY27");
    // drift: an annual horizon two years out with no cue snaps back
    expect(
      reconcileHorizon(
        "Our operating margin guidance remains at 20% to 22%.",
        parseHorizon("FY28", cp),
        cp,
      ).label,
    ).toBe("FY26");
    expect(
      reconcileHorizon(
        "we aim to reach 20,000 crores by FY30",
        parseHorizon("FY30", cp),
        cp,
      ).label,
    ).toBe("FY30");
  });
});

describe("quote grounding", () => {
  it("accepts a quoted number in any unit and rejects a computed product", () => {
    expect(
      numberInQuote("capex guidance is around INR3,000 crores", 3_000 * 1e7),
    ).toBe(true);
    expect(
      numberInQuote("EBITDA 20.5 to 21.2 post investment", 21.199999999999),
    ).toBe(true);
    expect(
      numberInQuote("achieving 70% of our 70,000 ton capacity", 49_000),
    ).toBe(false);
    expect(numberInQuote("we expect mid-twenties EBITDA growth", 24)).toBe(
      false,
    );
  });

  it("drops derived bands, retypes a real INR level, and rejects a mix share tagged as growth", () => {
    expect(
      assessGuidanceGrounding({
        quote: "Wavin will get to around 48,000, 49,000 tons",
        metric: "volume",
        low: 48_000,
        high: 49_000,
        unit: "units",
        isExplicit: true,
      }).action,
    ).toBe("explicit");
    expect(
      assessGuidanceGrounding({
        quote: "we expect mid-twenties EBITDA growth",
        metric: "ebitda_growth",
        low: 24,
        high: 26,
        unit: "%",
        isExplicit: false,
      }),
    ).toMatchObject({
      action: "dropped",
      derived: true,
      low: null,
      high: null,
      isExplicit: false,
      typeNote: "derived figure",
    });
    expect(
      assessGuidanceGrounding({
        quote: "we expect to cross INR15,000 crores in revenue",
        metric: "revenue_growth",
        low: 15_000 * 1e7,
        high: 15_000 * 1e7,
        unit: "INR",
        isExplicit: true,
      }),
    ).toMatchObject({
      action: "retyped",
      metric: "revenue",
      isExplicit: true,
    });
    expect(
      assessGuidanceGrounding({
        quote: "capex growth of INR3,000 crores over two years",
        metric: "capex_growth",
        low: 3_000 * 1e7,
        high: 3_000 * 1e7,
        unit: "INR",
        isExplicit: true,
      }),
    ).toMatchObject({
      action: "ambiguous",
      typeIssue: true,
      isExplicit: false,
    });
    expect(
      assessGuidanceGrounding({
        quote: "by FY30 at least 50% of revenue come from the CDMO segment",
        metric: "revenue_growth",
        low: 50,
        high: 50,
        unit: "%",
        isExplicit: true,
      }),
    ).toMatchObject({
      action: "ambiguous",
      typeIssue: true,
      isExplicit: false,
    });
  });
});
