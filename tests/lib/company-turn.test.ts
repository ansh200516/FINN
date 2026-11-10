import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  clipAskAnswer,
  confirmRule,
  mergeCategoryList,
  NO_PROMISES,
  NO_RESULTS,
  NOT_IN_FILINGS_LINE,
  parseCompanyTurn,
  presentAsk,
  scoredPromises,
  tripwireId,
} from "@/lib/companyTurn";
import { ReplyBody } from "@/ui/CompanyConversation";
import { FINNIE_GREETING } from "@/ui/composer";
import { Desk } from "@/ui/Desk";
import type { LedgerRowView } from "@/ui/model";
import { ScoredPromises } from "@/ui/ScoredPromises";

function row(
  over: Partial<LedgerRowView> &
    Pick<LedgerRowView, "id" | "verdict" | "status" | "quote">,
): LedgerRowView {
  return {
    isin: "INE195A01028",
    docId: "d",
    speaker: "CFO",
    role: "CFO",
    page: 4,
    metric: "operating_margin",
    direction: "range",
    low: 14,
    high: 14.5,
    unit: "%",
    horizon: "FY27",
    statedAt: 0,
    settledByQuarter: null,
    delivered: null,
    evidence: {},
    docKind: "transcript",
    docPeriod: "Q2FY27",
    docUrl: null,
    statedOnIst: "26 Oct 2026",
    ...over,
  };
}

describe("parseCompanyTurn", () => {
  it("maps the card commands without a model", () => {
    expect(parseCompanyTurn("results")).toEqual({ kind: "results" });
    expect(parseCompanyTurn("Numbers")).toEqual({ kind: "results" });
    expect(parseCompanyTurn("show me the numbers")).toEqual({
      kind: "results",
    });
    expect(parseCompanyTurn("promises")).toEqual({ kind: "promises" });
    expect(parseCompanyTurn("What did they say?")).toEqual({
      kind: "promises",
    });
    expect(parseCompanyTurn("guidance")).toEqual({
      kind: "reading",
      title: "Guidance",
    });
    expect(parseCompanyTurn("balance sheet")).toEqual({
      kind: "reading",
      title: "Balance sheet",
    });
    expect(parseCompanyTurn("cash")).toEqual({
      kind: "reading",
      title: "Cash quality",
    });
    expect(parseCompanyTurn("business")).toEqual({
      kind: "reading",
      title: "Business snapshot",
    });
  });

  it("writes a price, volume, or category rule, including the book", () => {
    expect(parseCompanyTurn("set price alert to 4%")).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: { kind: "price_move", params: { pct: 4 } },
    });
    expect(parseCompanyTurn("tell me if it moves more than 4%")).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: { kind: "price_move", params: { pct: 4 } },
    });
    expect(parseCompanyTurn("volume over 3x")).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: {
        kind: "volume_ratio",
        params: { ratio: 3, lookbackDays: 20 },
      },
    });
    expect(parseCompanyTurn("volume over 3× its 10-day average")).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: {
        kind: "volume_ratio",
        params: { ratio: 3, lookbackDays: 10 },
      },
    });
    expect(parseCompanyTurn("always tell me about results")).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: { kind: "category", params: { categories: ["results"] } },
    });
    expect(
      parseCompanyTurn("always tell me about dividends and management changes"),
    ).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: {
        kind: "category",
        params: { categories: ["dividend", "management_change"] },
      },
    });
    expect(parseCompanyTurn("set price alert to 4% for my portfolio")).toEqual({
      kind: "rule",
      scope: "book",
      rule: { kind: "price_move", params: { pct: 4 } },
    });
    expect(parseCompanyTurn("set a book price alert to 4%")).toEqual({
      kind: "rule",
      scope: "book",
      rule: { kind: "price_move", params: { pct: 4 } },
    });
    expect(parseCompanyTurn("what did they promise")).toEqual({
      kind: "promises",
    });
    expect(
      parseCompanyTurn("always tell me about litigation for the book"),
    ).toEqual({
      kind: "rule",
      scope: "book",
      rule: { kind: "category", params: { categories: ["litigation"] } },
    });
  });

  it("refuses a threshold outside the survey range and does not call Ask", () => {
    const turned = parseCompanyTurn("set price alert to 80%");
    expect(turned.kind).toBe("rejected");
    if (turned.kind === "rejected")
      expect(turned.sentence).toBe("Price alerts run from 0.5% to 30%.");
  });

  it("leaves a real question for Ask", () => {
    expect(parseCompanyTurn("what did they say about the plant")).toEqual({
      kind: "ask",
    });
    expect(parseCompanyTurn("how much debt is on the balance sheet")).toEqual({
      kind: "ask",
    });
    expect(parseCompanyTurn("results for the plastics business")).toEqual({
      kind: "ask",
    });
    expect(parseCompanyTurn("price")).toEqual({ kind: "live" });
    expect(parseCompanyTurn("nifty")).toEqual({ kind: "live" });
    expect(parseCompanyTurn("is the market open")).toEqual({ kind: "live" });
    expect(parseCompanyTurn("reliance price")).toEqual({ kind: "live" });
    expect(parseCompanyTurn("corporate actions")).toEqual({ kind: "live" });
    expect(parseCompanyTurn("nifty on 6 october 2026")).toEqual({
      kind: "live",
    });
    expect(parseCompanyTurn("always tell me about bonus or split")).toEqual({
      kind: "rule",
      scope: "symbol",
      rule: { kind: "category", params: { categories: ["bonus_split"] } },
    });
  });
});

describe("rule copy", () => {
  it("confirms the new rule in one sentence", () => {
    const price = parseCompanyTurn("set price alert to 4%");
    if (price.kind !== "rule") throw new Error("expected a rule");
    expect(confirmRule("SUPREMEIND", price.scope, price.rule)).toBe(
      "I’ll tell you when SUPREMEIND moves more than 4% in a day.",
    );
    const book = parseCompanyTurn("volume over 3x for my portfolio");
    if (book.kind !== "rule") throw new Error("expected a rule");
    expect(confirmRule("ITC", book.scope, book.rule)).toBe(
      "I’ll tell you when volume on the portfolio is over 3× its 20-day average.",
    );
  });

  it("keeps the survey id for the book and a separate id for one name", () => {
    expect(tripwireId("demo", "price_move", "book", "INE195A01028")).toBe(
      "demo:price_move",
    );
    expect(tripwireId("demo", "price_move", "symbol", "INE195A01028")).toBe(
      "demo:price_move:INE195A01028",
    );
    expect(mergeCategoryList(["dividend"], ["results", "dividend"])).toEqual([
      "dividend",
      "results",
    ]);
  });
});

describe("scoredPromises", () => {
  it("keeps verdicts and drops unverifiable, open, and superseded rows", () => {
    const rows = scoredPromises([
      row({
        id: "u",
        verdict: "unverifiable",
        status: "settled",
        quote: "Cannot check this.",
      }),
      row({
        id: "o",
        verdict: null,
        status: "open",
        quote: "Still open.",
      }),
      row({
        id: "s",
        verdict: "cut",
        status: "superseded",
        quote: "Old cut.",
      }),
      row({
        id: "k",
        verdict: "kept",
        status: "settled",
        quote: "Margin held.",
      }),
      row({
        id: "m",
        verdict: "missed",
        status: "settled",
        quote: "Margin missed.",
      }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["m", "k"]);
  });
});

describe("presentAsk", () => {
  it("keeps three sentences and drops markdown", () => {
    const text = clipAskAnswer(
      "# Margin held.\n\nDemand was **firm**.\n\nThe filing says 14%.\n\nThis fourth sentence goes.",
    );
    expect(text).toBe("Margin held. Demand was firm. The filing says 14%.");
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
    expect(text).not.toContain("fourth");
  });

  it("says not in the filings instead of the essay", () => {
    const view = presentAsk({
      answer:
        "I think the answer is 29% but I am not sure. Second. Third. Fourth.",
      notInFilings: true,
      citations: [{ ref: "page:doc:2", quote: "No figure is printed here." }],
    });
    expect(view.text).toBe(NOT_IN_FILINGS_LINE);
    expect(view.text).not.toContain("29%");
    expect(view.chips).toEqual([
      { label: "page:doc:2", quote: "No figure is printed here." },
    ]);
  });
});

describe("company thread markup", () => {
  it("opens on Finnie's greeting and the composer, with no filings menu", () => {
    const html = renderToStaticMarkup(
      createElement(Desk, {
        initialSymbol: "ITC",
        initialName: "ITC Limited",
        onTurn: () => Promise.reject(new Error("no turn")),
      }),
    );
    expect(html).toContain(FINNIE_GREETING);
    expect(html).not.toContain("Ask for the results, the promises, or a rule.");
    expect(html).toContain('data-composer=""');
    expect(html).toContain("ITC Limited");
    expect(html).not.toContain("From the filings");
    expect(html).not.toContain("Promise ledger");
  });

  it("names NSE on a live card and does not quote the feed", () => {
    const html = renderToStaticMarkup(
      createElement(ReplyBody, {
        symbol: "RELIANCE",
        reply: {
          kind: "nse",
          headline: "RELIANCE ₹ 1,324.40, up 0.03%.",
          note: "NSE · 09 Nov 2026 16:00",
        },
      }),
    );
    expect(html).toContain('data-source="NSE"');
    expect(html).toContain("RELIANCE ₹ 1,324.40, up 0.03%.");
    expect(html).not.toContain("filing");
  });

  it("shows no results as one line", () => {
    const html = renderToStaticMarkup(
      createElement(ReplyBody, {
        symbol: "ITC",
        reply: { kind: "results", card: null },
      }),
    );
    expect(html).toContain(NO_RESULTS);
  });

  it("collapses the quote until the row is opened", () => {
    const quote =
      "Even the topline, you see, polymer prices, they are coming down.";
    const html = renderToStaticMarkup(
      createElement(ScoredPromises, {
        symbol: "SUPREMEIND",
        rows: [
          row({
            id: "k",
            verdict: "kept",
            status: "settled",
            quote,
          }),
          row({
            id: "u",
            verdict: "unverifiable",
            status: "settled",
            quote: "This unverifiable pile stays out.",
          }),
        ],
      }),
    );
    const summary = html.split("</summary>")[0] ?? "";
    expect(summary).toContain("Kept");
    expect(summary).not.toContain("polymer");
    expect(html).toContain(quote);
    expect(html).not.toContain("unverifiable pile");
    expect(html).not.toContain(NO_PROMISES);
  });
});
