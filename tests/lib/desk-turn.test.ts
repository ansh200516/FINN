import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPANY_EMPTY } from "@/lib/companyTurn";
import {
  assumptionLine,
  contextLine,
  type DeskCompany,
  formatLines,
  NAME_THE_COMPANY,
  nothingOnFile,
  parseDeskTurn,
} from "@/lib/deskTurn";
import { cardHref, cardLinkLabel } from "@/ui/cardHref";
import { Desk } from "@/ui/Desk";

const book: DeskCompany[] = [
  { symbol: "ITC", name: "ITC Limited", aliases: [] },
  { symbol: "HDFCBANK", name: "HDFC Bank Limited", aliases: ["HDFC Bank"] },
  { symbol: "RELIANCE", name: "Reliance Industries Limited", aliases: ["RIL"] },
  { symbol: "IT", name: "IT Limited", aliases: [] },
  { symbol: "FOR", name: "FOR Limited", aliases: [] },
];

describe("parseDeskTurn", () => {
  it("asks for one card on the company in the sentence", () => {
    expect(parseDeskTurn("itc results", book, null)).toEqual({
      kind: "card",
      symbol: "ITC",
      text: "results",
    });
    expect(parseDeskTurn("show me the itc numbers", book, null)).toMatchObject({
      kind: "card",
      symbol: "ITC",
    });
    expect(parseDeskTurn("hdfc bank promises", book, null)).toEqual({
      kind: "card",
      symbol: "HDFCBANK",
      text: "promises",
    });
    expect(parseDeskTurn("reliance guidance", book, null)).toMatchObject({
      kind: "card",
      symbol: "RELIANCE",
      text: "guidance",
    });
  });

  it("keeps the active company when the sentence does not name one", () => {
    expect(parseDeskTurn("results", book, "ITC")).toEqual({
      kind: "card",
      symbol: "ITC",
      text: "results",
    });
    expect(parseDeskTurn("results", book, null)).toEqual({
      kind: "need-company",
    });
  });

  it("switches context without opening a card", () => {
    expect(parseDeskTurn("show me itc", book, null)).toEqual({
      kind: "context",
      symbol: "ITC",
    });
    expect(parseDeskTurn("ITC", book, null)).toEqual({
      kind: "context",
      symbol: "ITC",
    });
  });

  it("saves a price rule on the company, or on the book when none is named", () => {
    expect(parseDeskTurn("set price alert to 4%", book, null)).toMatchObject({
      kind: "rule",
      scope: "book",
      symbol: null,
    });
    expect(parseDeskTurn("set price alert to 4%", book, "ITC")).toMatchObject({
      kind: "rule",
      scope: "symbol",
      symbol: "ITC",
    });
    expect(parseDeskTurn("set price alert to 4% on itc", book, null)).toEqual({
      kind: "rule",
      scope: "symbol",
      symbol: "ITC",
      text: "set price alert to 4%",
    });
    expect(
      parseDeskTurn("set price alert to 4% for my portfolio", book, "ITC"),
    ).toMatchObject({ kind: "rule", scope: "book", symbol: null });
    expect(
      parseDeskTurn("always tell me about itc results", book, null),
    ).toMatchObject({
      kind: "rule",
      scope: "symbol",
      symbol: "ITC",
    });
  });

  it("does not treat English words as tickers", () => {
    const moved = parseDeskTurn("tell me if it moves more than 4%", book, null);
    expect(moved.kind).toBe("rule");
    if (moved.kind === "rule") expect(moved.symbol).toBeNull();
    expect(parseDeskTurn("IT results", book, null)).toMatchObject({
      kind: "card",
      symbol: "IT",
    });
    const bookRule = parseDeskTurn(
      "set price alert to 4% for my portfolio",
      book,
      null,
    );
    expect(bookRule.kind).toBe("rule");
    if (bookRule.kind === "rule") expect(bookRule.symbol).toBeNull();
  });

  it("refuses a bad threshold without a company and without Ask", () => {
    const turned = parseDeskTurn("set price alert to 80%", book, "ITC");
    expect(turned.kind).toBe("rejected");
  });

  it("leaves a real question for Ask, and the brief for a rule", () => {
    expect(
      parseDeskTurn("what did they say about the plant", book, "ITC"),
    ).toMatchObject({
      kind: "ask",
      symbol: "ITC",
      question: "what did they say about the plant",
    });
    expect(
      parseDeskTurn("what did they say about the itc plant", book, null),
    ).toMatchObject({ kind: "ask", symbol: "ITC" });
    expect(
      parseDeskTurn("results for the plastics business", book, "ITC"),
    ).toMatchObject({
      kind: "ask",
      symbol: "ITC",
    });
    expect(
      parseDeskTurn("what did they say about the plant", book, null),
    ).toEqual({
      kind: "need-company",
    });
    expect(parseDeskTurn("how is itc", book, null)).toEqual({
      kind: "vague",
      symbol: "ITC",
      named: true,
    });
    expect(parseDeskTurn("how is Amber", amberBook(), null)).toEqual({
      kind: "vague",
      symbol: "AMBER",
      named: true,
    });
    expect(parseDeskTurn("anything I should know", book, null)).toEqual({
      kind: "vague",
      symbol: null,
      named: false,
    });
    expect(parseDeskTurn("anything I should know", book, "ITC")).toEqual({
      kind: "vague",
      symbol: "ITC",
      named: false,
    });
    expect(parseDeskTurn("how is the itc plant", book, null)).toMatchObject({
      kind: "ask",
      symbol: "ITC",
    });
    expect(parseDeskTurn("what needs a decision?", book, null)).toEqual({
      kind: "brief",
    });
    expect(parseDeskTurn("what should I watch", book, "ITC")).toEqual({
      kind: "watch",
    });
  });

  it("sends a live price, the index, and market status to NSE", () => {
    expect(parseDeskTurn("reliance price", book, null)).toEqual({
      kind: "live",
      text: "price",
      symbol: "RELIANCE",
    });
    expect(parseDeskTurn("price", book, "ITC")).toEqual({
      kind: "live",
      text: "price",
      symbol: "ITC",
    });
    expect(parseDeskTurn("nifty", book, "ITC")).toEqual({
      kind: "live",
      text: "nifty",
      symbol: null,
    });
    expect(parseDeskTurn("is the market open", book, null)).toEqual({
      kind: "live",
      text: "is the market open",
      symbol: null,
    });
    expect(parseDeskTurn("price", book, null)).toEqual({
      kind: "need-company",
    });
    expect(parseDeskTurn("reliance corporate actions", book, null)).toEqual({
      kind: "live",
      text: "corporate actions",
      symbol: "RELIANCE",
    });
    expect(parseDeskTurn("hdfc bank corporate actions", book, null)).toEqual({
      kind: "live",
      text: "corporate actions",
      symbol: "HDFCBANK",
    });
    expect(parseDeskTurn("check for splits or bonuses", book, "ITC")).toEqual({
      kind: "live",
      text: "check for splits or bonuses",
      symbol: "ITC",
    });
    expect(parseDeskTurn("corporate actions", book, null)).toEqual({
      kind: "need-company",
    });
    expect(parseDeskTurn("reliance dividends", book, null)).toEqual({
      kind: "live",
      text: "dividends",
      symbol: "RELIANCE",
    });
    expect(parseDeskTurn("what did they promise", book, "ITC")).toEqual({
      kind: "card",
      symbol: "ITC",
      text: "what did they promise",
    });
    expect(parseDeskTurn("what did they promise", book, null)).toEqual({
      kind: "brief",
    });
    expect(parseDeskTurn("set a book price alert to 4%", book, "ITC")).toEqual({
      kind: "rule",
      scope: "book",
      symbol: null,
      text: "set a book price alert to 4%",
    });
    expect(parseDeskTurn("nifty on 6 october 2026", book, "ITC")).toEqual({
      kind: "live",
      text: "nifty on 6 october 2026",
      symbol: null,
    });
  });
});

describe("desk copy", () => {
  it("answers the brief in one block, not a stack of cards", () => {
    expect(contextLine("ITC")).toBe("On ITC.");
    expect(NAME_THE_COMPANY).toBe("Name the company.");
    const text = formatLines((n) => `${n} to act on.`, "Nothing to act on.", [
      { symbol: "ITC", sentence: "Margin held." },
      { symbol: "TCS", sentence: "A management change." },
    ]);
    expect(text).toBe(
      "2 to act on. ITC. Margin held. TCS. A management change.",
    );
    expect(
      formatLines((n) => `${n} to act on.`, "Nothing to act on.", []),
    ).toBe("Nothing to act on.");
    expect(assumptionLine("AMBER", "named", "results")).toBe(
      "Assuming AMBER's latest results.",
    );
    expect(assumptionLine("RELIANCE", "brief", "results")).toBe(
      "Assuming RELIANCE, the first name to act on, and its latest results.",
    );
    expect(nothingOnFile("ITC", "open")).toBe(
      "Assuming ITC, already open. Nothing is on file.",
    );
    expect(cardHref({ kind: "results", card: null }, "SUPREMEIND")).toBe(
      "/c/SUPREMEIND#results",
    );
    expect(cardHref({ kind: "rule", sentence: "Saved." }, "ITC")).toBe(
      "/alerts",
    );
    expect(cardLinkLabel("/c/RELIANCE", "RELIANCE")).toBe("Open RELIANCE");
  });
});

function amberBook(): DeskCompany[] {
  return [
    ...book,
    {
      symbol: "AMBER",
      name: "Amber Enterprises India Limited",
      aliases: [],
    },
  ];
}

describe("desk markup", () => {
  it("opens on the empty line and a composer, not the filings", () => {
    const act = ["One.", "Two.", "Three.", "Fourth stays off the tape."].map(
      (sentence, i) => ({
        symbol: `N${i}`,
        sentence,
      }),
    );
    const html = renderToStaticMarkup(
      createElement(Desk, {
        act,
        watch: [{ symbol: "ITC", sentence: "Results filed." }],
        filedAway: 14,
        checked: "checked NSE 15:04 IST",
        companies: book,
        onTurn: () => Promise.reject(new Error("no turn")),
      }),
    );
    expect(html).toContain(COMPANY_EMPTY);
    expect(html).toContain('data-composer=""');
    expect(html).toContain('placeholder="reliance results"');
    expect(html).toContain("Ask");
    expect(html).toContain("Price");
    expect(html).toContain("Alerts");
    expect(html).toContain("Actions");
    expect(html).toContain("Name");
    expect(html).toContain("Book");
    expect(html).not.toContain('data-card=""');
    expect(html).not.toContain("One.");
    expect(html).not.toContain("Fourth stays off the tape.");
    expect(html).not.toContain("1 more. Ask.");
    expect(html).not.toContain("14 filed away");
    expect(html).not.toContain("Results filed.");
    expect(html).not.toContain("The figures");
    expect(html).not.toContain("From the filings");
    expect(html).not.toContain("Promise ledger");
  });
});
