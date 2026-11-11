import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assumptionLine,
  bookCountLine,
  contextLine,
  type DeskCompany,
  formatLines,
  NAME_THE_COMPANY,
  nothingOnFile,
  parseDeskTurn,
} from "@/lib/deskTurn";
import { cardHref, cardLinkLabel } from "@/ui/cardHref";
import { FINNIE_GREETING } from "@/ui/composer";
import { BookNames, Desk, FinnieAnswer } from "@/ui/Desk";

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

  it("does not list the book just because the sentence says portfolio", () => {
    for (const sentence of [
      "whats in my portfolio",
      "what's in my portfolio",
      "What’s in my portfolio?",
      "my book",
      "add PIIND to my portfolio",
      "which companies",
      "what do I hold",
      "list my names",
    ]) {
      expect(parseDeskTurn(sentence, book, "RELIANCE").kind).not.toBe("book");
      expect(parseDeskTurn(sentence, book, null).kind).not.toBe("book");
    }
    expect(parseDeskTurn("results", book, null)).toEqual({
      kind: "need-company",
    });
    expect(parseDeskTurn("reliance results", book, null)).toMatchObject({
      kind: "card",
      symbol: "RELIANCE",
      text: "results",
    });
    expect(
      parseDeskTurn("set price alert to 4% for my portfolio", book, "ITC"),
    ).toMatchObject({ kind: "rule", scope: "book", symbol: null });
    expect(
      parseDeskTurn("set price alert to 4% for my book", book, "ITC"),
    ).toMatchObject({ kind: "rule", scope: "book", symbol: null });
  });
});

describe("desk copy", () => {
  it("answers the brief in one block, not a stack of cards", () => {
    expect(contextLine("ITC")).toBe("On ITC.");
    expect(NAME_THE_COMPANY).toBe("Which name? Try Reliance.");
    expect(bookCountLine(2)).toBe("2 names.");
    expect(bookCountLine(1)).toBe("1 name.");
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
  it("opens on Finnie's greeting and a composer, not the filings", () => {
    const html = renderToStaticMarkup(
      createElement(Desk, {
        onTurn: () => Promise.reject(new Error("no turn")),
      }),
    );
    expect(html).toContain(FINNIE_GREETING);
    expect(html).toContain("New chat");
    expect(html).toContain('class="new-chat"');
    expect(html).not.toContain("Ask for the results, the promises, or a rule.");
    expect(html).not.toContain("Ask when you want to.");
    expect(html).toContain('data-composer=""');
    expect(html).toContain("<textarea");
    expect(html).toContain('placeholder="reliance results"');
    expect(html).not.toContain("<input");
    expect(html).toContain('aria-label="Send"');
    expect(html).not.toContain("mode-btn");
    expect(html).not.toContain("scope-btn");
    expect(html).not.toContain(">Price<");
    expect(html).not.toContain(">Alerts<");
    expect(html).not.toContain(">Actions<");
    expect(html).not.toContain(">Name<");
    expect(html).not.toContain(">Book<");
    expect(html).not.toContain("reliance results]");
    expect(html).not.toContain('value="reliance');
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

  it("puts the filings line after the price and drops the decision sentence", () => {
    const line =
      "I can only give you the filings and the price. The decision is yours.";
    const html = renderToStaticMarkup(
      createElement(FinnieAnswer, {
        say: line,
        sayAfter: true,
        href: "/c/RELIANCE",
        link: "Open RELIANCE",
        cards: [
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: { kind: "nse", headline: "CARD-RESULTS", note: "filings" },
          },
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: { kind: "nse", headline: "CARD-PROMISES", note: "filings" },
          },
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: { kind: "nse", headline: "CARD-PRICE", note: "NSE" },
          },
        ],
      }),
    );
    const results = html.indexOf("CARD-RESULTS");
    const promises = html.indexOf("CARD-PROMISES");
    const price = html.indexOf("CARD-PRICE");
    const filings = html.indexOf(
      "I can only give you the filings and the price.",
    );
    expect(results).toBeGreaterThan(-1);
    expect(results).toBeLessThan(promises);
    expect(promises).toBeLessThan(price);
    expect(price).toBeLessThan(html.indexOf("Open RELIANCE"));
    expect(html.indexOf("Open RELIANCE")).toBeLessThan(filings);
    expect(html).not.toContain("The decision is yours");
  });

  it("draws the book as one card of symbol and name links", () => {
    const html = renderToStaticMarkup(
      createElement(BookNames, {
        names: [
          {
            symbol: "ITC",
            name: "ITC Limited",
            aliases: [],
          },
          {
            symbol: "RELIANCE",
            name: "Reliance Industries Limited",
            aliases: [],
          },
        ],
      }),
    );
    expect(html).toContain('data-book=""');
    expect(html).toContain('href="/c/ITC"');
    expect(html).toContain('href="/c/RELIANCE"');
    expect(html).toContain("ITC Limited");
    expect(html).toContain("Reliance Industries Limited");
    expect(html).not.toContain("Name the company.");
    expect(html).not.toContain("]");
  });

  it("shows a quarter recital as two sentences and still draws the grid", () => {
    const say = [
      "For Q3 FY26, Revenue was 269,496 crore, up 4.09% qoq and 10.51% yoy; EBITDA was 46,018 crore; PBT was 29,697 crore; PAT was 22,290 crore.",
      "For Q4 FY26, Revenue was 298,621 crore, up 10.81% qoq; EBITDA was 44,141 crore; PBT was 27,195 crore; PAT was 20,589 crore.",
      "For Q1 FY27, Revenue was 311,850 crore, up 4.43% qoq; EBITDA was 47,517 crore; PBT was 30,630 crore; PAT was 23,196 crore.",
      "For Q2 FY27, Revenue was 352,861 crore, up 6.74% qoq; EBITDA was 56,616 crore; PBT was 38,613 crore; PAT was 29,550 crore.",
    ].join(" ");
    const line = (
      label: string,
      crore: number,
      qoqPct: number,
      yoyPct: number,
    ) => ({ label, crore, qoqPct, yoyPct });
    const html = renderToStaticMarkup(
      createElement(FinnieAnswer, {
        say,
        cards: [
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: { kind: "results", card: null },
            quarters: [
              {
                period: "Q3 FY26",
                revenue: line("Revenue", 269496, 4.09, 10.51),
                ebitda: line("EBITDA", 46018, 0.29, 5.09),
                pbt: line("PBT", 29697, 1.97, 3.68),
                pat: line("PAT", 22290, 0.9, 1.64),
              },
              {
                period: "Q4 FY26",
                revenue: line("Revenue", 298621, 10.81, 12.87),
                ebitda: line("EBITDA", 44141, -4.08, 0.7),
                pbt: line("PBT", 27195, -8.43, 6.56),
                pat: line("PAT", 20589, -7.63, 8.94),
              },
              {
                period: "Q1 FY27",
                revenue: line("Revenue", 311850, 4.43, 25.41),
                ebitda: line("EBITDA", 47517, 7.65, 10.75),
                pbt: line("PBT", 30630, 12.63, 17.54),
                pat: line("PAT", 23196, -12.66, -24.65),
              },
              {
                period: "Q2 FY27",
                revenue: line("Revenue", 352861, 6.74, 28.57),
                ebitda: line("EBITDA", 56616, 19.15, 23.39),
                pbt: line("PBT", 38613, 26.06, 32.58),
                pat: line("PAT", 29550, 27.39, 33.76),
              },
            ],
          },
        ],
      }),
    );
    expect(html).not.toContain("For Q3 FY26");
    expect(html).not.toContain("Revenue was 269,496");
    expect(html).toContain("Q3 FY26");
    expect(html).toContain("Q2 FY27");
    expect(html).toContain("2,69,496");
    expect(html).toContain("3,52,861");
    expect(html).toContain("YoY");
    expect(html).not.toContain("QoQ");
    expect(html).not.toContain("<svg");
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).not.toContain("qoqPct");
    expect(html).not.toContain("yoyPct");
  });

  it("caps guidance rows and links to the company page", () => {
    const verdicts = [
      "kept",
      "missed",
      "open",
      "unverifiable",
      "kept",
      "missed",
      "kept",
    ] as const;
    const html = renderToStaticMarkup(
      createElement(FinnieAnswer, {
        say: "Guidance is still open. The decision is yours.",
        cards: [
          {
            kind: "reply",
            symbol: "RELIANCE",
            reply: {
              kind: "promises",
              rows: [
                {
                  id: "old",
                  quote: "SUPERSEDED_GUIDE should stay hidden.",
                  status: "superseded",
                  verdict: "cut",
                },
                ...verdicts.map((verdict, index) => ({
                  id: `g-${index}`,
                  quote: `GUIDE_${index} stays on the ledger.`,
                  status: verdict === "open" ? "open" : "settled",
                  verdict: verdict === "open" ? null : verdict,
                })),
              ] as never,
            },
          },
        ],
      }),
    );
    expect(html).toContain("Kept");
    expect(html).toContain("Missed");
    expect(html).toContain("Open");
    expect(html).toContain("Unverifiable");
    expect(html).toContain("GUIDE_0");
    expect(html).toContain("GUIDE_5");
    expect(html).not.toContain("GUIDE_6");
    expect(html).not.toContain("SUPERSEDED_GUIDE");
    expect(html).toContain("more on the company page");
    expect(html).toContain('href="/c/RELIANCE"');
    expect(html).not.toContain("The decision is yours");
  });
});
