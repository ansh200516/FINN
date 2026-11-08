import { describe, expect, it } from "vitest";
import {
  extractNumbers,
  groundNumbers,
  normalizeForMatch,
  verifyQuote,
} from "@/engine/llm/verify";

const transcript = `
Salil Parekh — CEO & MD: Thank you, Sandeep. We had a strong quarter. Revenue grew
2.2% sequentially and 4.1% year on year in constant currency. We are raising our
revenue growth guidance for FY26 to 2–3% in constant currency. Operating margin
was 21.0%, and our margin guidance remains 20–22%. Free cash flow was ₹5,893 crore,
which is 1,05.3% of net profit (adjusted). Net loss on the hedge book was (123) crore.
Total revenue stood at ₹44,490 crore; headcount 3,23,788.
`;

describe("normalizeForMatch", () => {
  it("collapses whitespace and straightens quotes and dashes", () => {
    expect(normalizeForMatch("  “FY26”   2–3%\u00A0‘x’ ")).toBe(
      `"FY26" 2-3% 'x'`,
    );
  });
});

describe("verifyQuote", () => {
  it("finds an exact quote", () => {
    const off = verifyQuote("We had a strong quarter.", transcript);
    expect(off).not.toBeNull();
    expect(normalizeForMatch(transcript).slice(off ?? 0, (off ?? 0) + 8)).toBe(
      "We had a",
    );
  });
  it("tolerates whitespace, curly quotes, en-dash and wrapper quotes", () => {
    expect(
      verifyQuote(
        "“raising our\n   revenue growth guidance for FY26 to 2-3% in constant currency”",
        transcript,
      ),
    ).not.toBeNull();
  });
  it("tolerates a trailing full stop or leading ellipsis added by the model", () => {
    expect(
      verifyQuote("our margin guidance remains 20–22%.", transcript),
    ).not.toBeNull();
    expect(
      verifyQuote("...our margin guidance remains 20–22%", transcript),
    ).not.toBeNull();
  });
  it("rejects paraphrases and fabricated numbers", () => {
    expect(verifyQuote("We had a very strong quarter", transcript)).toBeNull();
    expect(
      verifyQuote("margin guidance remains 21-23%", transcript),
    ).toBeNull();
    expect(verifyQuote("", transcript)).toBeNull();
  });
});

describe("extractNumbers", () => {
  it("parses Indian and Western grouping, decimals, parentheses negatives, percents", () => {
    const vals = extractNumbers(
      "₹3,32,861 cr; 332,861; (123); -4.5%; 18.88; 1,05.3%",
    ).map((n) => n.value);
    expect(vals).toEqual([332861, 332861, -123, -4.5, 18.88, 105.3]);
  });
  it("skips numbers glued to letters (Q2, FY26, H1) and decimals glued to words", () => {
    expect(
      extractNumbers("Q2 FY26 H1 results for FY2026").map((n) => n.raw),
    ).toEqual([]);
  });
  it("handles unicode minus", () => {
    expect(extractNumbers("\u22122.3%").map((n) => n.value)).toEqual([-2.3]);
  });
});

describe("groundNumbers", () => {
  it("returns [] when every number is in the source (grouping-insensitive)", () => {
    expect(
      groundNumbers(
        "Revenue ₹44490 crore, growth 2.2% QoQ and 4.1% YoY; headcount 323,788",
        transcript,
      ),
    ).toEqual([]);
  });
  it("lists numbers absent from the source", () => {
    expect(
      groundNumbers(
        "Revenue grew 2.5% to ₹44,490 crore; margin 21.0%; FCF 6,000 crore",
        transcript,
      ),
    ).toEqual(["2.5%", "6,000"]);
  });
  it("treats sign as significant", () => {
    expect(groundNumbers("hedge loss 123 crore", transcript)).toEqual(["123"]);
    expect(groundNumbers("hedge loss (123) crore", transcript)).toEqual([]);
    expect(groundNumbers("hedge loss -123 crore", transcript)).toEqual([]);
  });
  it("ignores numbers glued to labels like Q2/FY26", () => {
    expect(groundNumbers("Q2 FY26 revenue 44,490", transcript)).toEqual([]);
  });
});
