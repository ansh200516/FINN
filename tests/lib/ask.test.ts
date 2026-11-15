import { describe, expect, it } from "vitest";
import { LlmBudgetExhausted } from "@/engine/llm/gateway";
import { verifyQuote } from "@/engine/llm/verify";
import {
  ASK_SYSTEM,
  ASK_TOKEN_CAP,
  type AskCorpus,
  answerWithContext,
  askInputError,
  estimateTokens,
  groundCitations,
  readAskCount,
  renderAskPrompt,
  sealAskCookie,
  selectPages,
} from "@/lib/ask";

const PAGE = "page:doc1:8";
const GUIDE = "guidance:g1";
const PAGE_TEXT =
  "We've still given the margin guidance for the full year at 14% to 14.5%. Capex outflow should not be more than INR700 crores.";
const GUIDE_QUOTE =
  "We've still given the margin guidance for the full year at 14% to 14.5%.";

function corpus(): AskCorpus {
  return {
    symbol: "SUPREMEIND",
    companyName: "Supreme Industries Limited",
    isin: "INE195A01028",
    results: [
      {
        ref: "results:INE195A01028|results|2026-10-26",
        text: "title: Quarterly results filed\nSupreme Industries Limited filed its quarterly results on 26 Oct.",
      },
    ],
    guidance: [
      {
        ref: GUIDE,
        quote: GUIDE_QUOTE,
        text: `metric: operating_margin\nhorizon: FY27\nverdict: (unset)\nquote: ${GUIDE_QUOTE}`,
      },
    ],
    pages: [
      {
        ref: PAGE,
        text: PAGE_TEXT,
        label: "transcript Q2FY27 p.8",
        score: 3,
      },
    ],
  };
}

describe("selectPages", () => {
  it("keeps the six pages with the most keyword overlap and drops misses", () => {
    const pages = [
      { id: "miss", text: "The board met on Tuesday.", kind: "annual_report" },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `p${i}`,
        text: `Margin guidance of 14 percent appears here. Page ${i}. Capex is discussed ${"again ".repeat(i)}`,
        kind: i === 0 ? "annual_report" : "transcript",
      })),
    ];
    const picked = selectPages(
      pages,
      "What margin guidance and capex did management give?",
      6,
    );
    expect(picked).toHaveLength(6);
    expect(picked.some((p) => p.id === "miss")).toBe(false);
    expect(picked[0]?.kind).toBe("transcript");
    for (const p of picked) expect(p.score).toBeGreaterThan(0);
  });
});

describe("renderAskPrompt", () => {
  it("stays inside the token cap and names the refs", () => {
    const huge: AskCorpus = {
      ...corpus(),
      pages: Array.from({ length: 6 }, (_, i) => ({
        ref: `page:doc:${i + 1}`,
        text: `margin guidance capex ${"word ".repeat(8_000)}`,
        label: `transcript p.${i + 1}`,
        score: 6 - i,
      })),
    };
    const { prompt } = renderAskPrompt(huge, "What is the margin guidance?");
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(ASK_TOKEN_CAP);
    expect(prompt).toContain("[results:");
    expect(prompt).toContain("[guidance:g1]");
    expect(ASK_SYSTEM).toMatch(/no outside knowledge/i);
    expect(ASK_SYSTEM).toMatch(/not in the filings/i);
  });
});

describe("groundCitations", () => {
  it("drops a quote that is not in the retrieved page and drops an unknown ref", () => {
    const { sources } = renderAskPrompt(corpus(), "margin?");
    const { citations, quotesDropped } = groundCitations(
      [
        { kind: "page", ref: PAGE, quote: GUIDE_QUOTE },
        {
          kind: "page",
          ref: PAGE,
          quote: "The company will double margins next year.",
        },
        { kind: "guidance", ref: GUIDE, quote: "14% to 14.5%" },
        { kind: "page", ref: "page:nope:1", quote: GUIDE_QUOTE },
        {
          kind: "results",
          ref: "results:INE195A01028|results|2026-10-26",
          quote: "filed its quarterly results on 26 Oct",
        },
      ],
      sources,
    );
    expect(quotesDropped).toBe(1);
    expect(citations.map((c) => c.ref)).not.toContain("page:nope:1");
    const bad = citations.find((c) => c.quote?.includes("double margins"));
    expect(bad).toBeUndefined();
    const good = citations.find((c) => c.quote === GUIDE_QUOTE);
    expect(good?.kind).toBe("page");
    expect(verifyQuote(GUIDE_QUOTE, PAGE_TEXT)).not.toBeNull();
    expect(
      citations.some(
        (c) => c.kind === "guidance" && c.quote === "14% to 14.5%",
      ),
    ).toBe(true);
  });
});

describe("ask input", () => {
  it("says a 501-character question is too long", () => {
    expect(
      askInputError({ symbol: "RELIANCE", question: "a".repeat(501) }),
    ).toBe("Ask is limited to 500 characters.");
    expect(askInputError({ symbol: "", question: "" })).toBe(
      "symbol and question are required",
    );
    expect(
      askInputError({ symbol: "RELIANCE", question: "margin" }),
    ).toBeNull();
  });
});

describe("answerWithContext", () => {
  it("uses a mocked reason call and falls back to bulk when that tier is exhausted", async () => {
    const tiers: string[] = [];
    const answer = await answerWithContext(
      corpus(),
      "What margin was guided?",
      async (o) => {
        tiers.push(o.tier);
        if (o.tier === "reason")
          throw new LlmBudgetExhausted("reason", ["gemini-3.5-flash"]);
        return {
          data: {
            answer: "Full-year margin guidance is 14% to 14.5%.",
            citations: [
              { kind: "page" as const, ref: PAGE, quote: GUIDE_QUOTE },
              {
                kind: "page" as const,
                ref: PAGE,
                quote: "Invented sentence about a new plant.",
              },
            ],
            notInFilings: false,
          },
          model: "gemini-3.5-flash-lite",
          cached: false,
          tokensIn: 10,
          tokensOut: 10,
          tokensThought: 0,
          latencyMs: 1,
          cacheKey: "k",
        };
      },
    );
    expect(tiers).toEqual(["reason", "bulk"]);
    expect(answer.model).toBe("gemini-3.5-flash-lite");
    expect(answer.notInFilings).toBe(false);
    expect(answer.citations).toEqual([
      { kind: "page", ref: PAGE, quote: GUIDE_QUOTE },
      { kind: "page", ref: PAGE },
    ]);
    expect(answer.quotesDropped).toBe(1);
  });

  it("does not call the model when the company has no filing context", async () => {
    let calls = 0;
    const answer = await answerWithContext(
      { ...corpus(), results: [], guidance: [], pages: [] },
      "Anything?",
      async () => {
        calls++;
        throw new Error("should not be called");
      },
    );
    expect(calls).toBe(0);
    expect(answer.notInFilings).toBe(true);
    expect(answer.citations).toEqual([]);
  });
});

describe("ask cookie", () => {
  it("rejects a tampered counter and resets a previous day", () => {
    const day = "2026-11-08";
    const sealed = sealAskCookie(3, day);
    expect(readAskCount(sealed, day)).toEqual({ count: 3, valid: true });
    const tampered = sealed.replace(/\d/, "9");
    expect(readAskCount(tampered, day).valid).toBe(false);
    expect(readAskCount(tampered, day).count).toBe(0);
    expect(readAskCount(sealed, "2026-11-09")).toEqual({
      count: 0,
      valid: true,
    });
    expect(readAskCount(undefined, day)).toEqual({ count: 0, valid: false });
  });
});
