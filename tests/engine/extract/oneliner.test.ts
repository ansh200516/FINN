import { describe, expect, it } from "vitest";
import {
  cleanSubject,
  computeTotals,
  extractOneLinersBatch,
  fallbackOneLiner,
  fallbackTitle,
  focusText,
  gateFields,
  gateItem,
  type OneLinerInput,
} from "@/engine/extract/oneliner";

const filing = `Dear Sir/Madam,
Pursuant to Regulation 30, we wish to inform you that the Board of Directors at its meeting held on October 28, 2026
declared an Interim Dividend of Rs. 19 per equity share of face value Re. 1 each for FY 2026-27.
The record date for the purpose of the said dividend is Wednesday, 12th November, 2026 and the dividend will be paid on or before 27-Nov-2026.
CRISIL has reaffirmed the rating at CRISIL AAA/Stable on bank facilities of Rs. 8,084.9 crore (Rs. 5,000 crore term loans and Rs. 3,084.9 crore working capital).`;

const inp: OneLinerInput = {
  id: "a1",
  category: "dividend",
  symbol: "HINDUNILVR",
  companyName: "Hindustan Unilever Limited",
  desc: "Dividend",
  subject:
    "Board approves Interim Dividend of Rs. 19 per equity share for FY 2026-27",
  voiceSummary: null,
  text: filing,
  filedAtIst: "28-Oct-2026 09:45:35",
};

describe("gateFields", () => {
  it("keeps grounded numbers, drops model-invented ones (incl. summed totals), verifies dates and excerpts", () => {
    const { fields, dropped } = gateFields(
      {
        dividends: [
          {
            amount_per_share: 19,
            type: "interim",
            record_date: "12-Nov-2026",
            ex_date: "11-Nov-2026",
            payment_date: "27-Nov-2026",
            face_value: 1,
          },
        ],
        ratings: [
          {
            agency: "CRISIL",
            amount_as_stated: 8084.9,
            bogus_total: 93_87_992,
          },
        ],
        excerpt: "declared an Interim Dividend of Rs. 19 per equity share",
        bad_excerpt: "declared a special dividend of Rs. 25 per share",
      },
      filing,
    );
    const d = (fields.dividends as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >;
    expect(d.amount_per_share).toBe(19);
    expect(d.record_date).toBe("12-Nov-2026");
    expect(d.payment_date).toBe("27-Nov-2026");
    expect(d.ex_date).toBeNull(); // the 11th is not in the filing
    const r = (fields.ratings as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >;
    expect(r.amount_as_stated).toBe(8084.9);
    expect(r.bogus_total).toBeNull();
    expect(fields.excerpt).toMatch(/^declared an Interim Dividend/);
    expect(fields.bad_excerpt).toBeNull();
    expect(dropped).toEqual(
      expect.arrayContaining([
        "fields.dividends[0].ex_date",
        "fields.ratings[0].bogus_total",
        "fields.bad_excerpt",
      ]),
    );
  });
  it("drops list strings that carry ungrounded numbers", () => {
    const { fields } = gateFields(
      { prior_roles: ["CFO of ABC Ltd (2013-16)", "Head of Treasury"] },
      "He was Head of Treasury and then CFO of ABC Ltd from 2013 to 2016.",
    );
    expect(fields.prior_roles).toEqual(["Head of Treasury"]);
  });
});

describe("gateItem / totals / fallbacks", () => {
  it("replaces an ungrounded one-liner or title with the rules fallback and flags grounded=false", () => {
    const r = gateItem(inp, {
      title: "Rs 19 interim dividend, record date 12 Nov",
      one_liner: "HUL declared an interim dividend of Rs 21 per share.",
      fields: { dividends: [] },
    });
    expect(r.title).toBe("Rs 19 interim dividend, record date 12 Nov");
    expect(r.oneLiner).toMatch(/Rs\. 19 per equity share/);
    expect(r.grounded).toBe(false);
    expect(r.dropped).toContain("one_liner");
  });
  it("enforces ≤ 10-word titles", () => {
    const r = gateItem(inp, {
      title: "one two three four five six seven eight nine ten eleven twelve",
      one_liner: "Interim dividend of Rs. 19 per share declared.",
      fields: {},
    });
    expect(r.title.split(/\s+/).length).toBeLessThanOrEqual(10);
  });
  it("computes totals in code for list fields", () => {
    expect(
      computeTotals("insider_trading", {
        persons: [
          { quantity: 1847300, value: 262039500 },
          { quantity: 2205400, value: 312800000 },
        ],
      }),
    ).toEqual({ total_quantity: 4052700, total_value: 574839500 });
    expect(
      computeTotals("litigation", {
        matters: [{ amount: 1 }, { amount: 2 }, { amount: null }],
      }),
    ).toEqual({ sum_of_stated_amounts: 3, matters: 3 });
  });
  it("rules fallbacks: subject-derived title/one-liner, boilerplate stripped", () => {
    expect(
      cleanSubject(
        "Bajaj Finance Limited has informed the Exchange about Schedule of meet",
      ),
    ).toBe("Schedule of meet");
    expect(
      fallbackTitle({
        category: "dividend",
        desc: "Dividend",
        subject:
          "Board approves Interim Dividend of Rs. 19 per equity share for FY 2026-27",
      }),
    ).toBe(
      "Board approves Interim Dividend of Rs. 19 per equity share for FY 2026-27"
        .split(" ")
        .slice(0, 10)
        .join(" ")
        .concat("…"),
    );
    expect(
      fallbackTitle({
        category: "earnings_call",
        desc: "Analysts/Institutional Investor Meet/Con. Call Updates",
        subject: "X has informed the Exchange about Transcript",
      }),
    ).toBe("Earnings call transcript");
    expect(
      fallbackOneLiner({
        subject: "X Limited has informed the Exchange about General Updates",
        voiceSummary: "X Limited reported a 10% rise in volumes. More text.",
        desc: "General Updates",
        companyName: "X Limited",
      }),
    ).toBe("X Limited reported a 10% rise in volumes.");
  });
  it("focusText keeps the head plus a window around the brief profile for long KMP filings", () => {
    const head = "A".repeat(9000);
    const text = `${head}\n\nBrief Profile: Mr. Z has 30 years of experience ...${"B".repeat(500)}`;
    const f = focusText(text, "management_change", 8000);
    expect(f.length).toBeLessThanOrEqual(8200);
    expect(f).toContain("Brief Profile");
    expect(focusText("short", "dividend", 100)).toBe("short");
  });
});

describe("extractOneLinersBatch (mocked model)", () => {
  it("batches per category, gates every item, and counts only uncached calls against the budget", async () => {
    const calls: string[] = [];
    const llm = async (category: string, prompt: string) => {
      calls.push(category);
      const ids = [...prompt.matchAll(/### id=(\S+)/g)].map((m) => m[1]);
      return {
        model: "mock",
        cached: false,
        data: {
          items: ids.map((id) => ({
            id,
            title: "Rs 19 interim dividend declared",
            one_liner:
              "Interim dividend of Rs. 19 per share; record date 12th November, 2026.",
            fields: {
              dividends: [
                {
                  amount_per_share: 19,
                  type: "interim",
                  record_date: "12th November, 2026",
                  ex_date: null,
                  payment_date: null,
                  face_value: 1,
                },
              ],
            },
          })),
        },
      };
    };
    const budget = { remaining: 5 };
    const out = await extractOneLinersBatch(
      [
        inp,
        { ...inp, id: "a2" },
        { ...inp, id: "m1", category: "investor_meetings" },
      ],
      { llm, budget },
    );
    expect(calls).toEqual(["dividend"]);
    expect(budget.remaining).toBe(4);
    expect(out.get("a1")?.grounded).toBe(true);
    expect(out.get("a1")?.fields).toMatchObject({
      dividends: [{ amount_per_share: 19, record_date: "12th November, 2026" }],
    });
    expect(out.get("m1")?.source).toBe("rules"); // not an LLM category
  });
  it("falls back to rules when the budget is exhausted or the model fails", async () => {
    const out = await extractOneLinersBatch([inp], {
      llm: async () => ({ model: "m", cached: false, data: { items: [] } }),
      budget: { remaining: 0 },
    });
    expect(out.get("a1")?.source).toBe("rules");
    const out2 = await extractOneLinersBatch([inp], {
      llm: async () => {
        throw new Error("503");
      },
    });
    expect(out2.get("a1")?.source).toBe("rules");
    expect(out2.get("a1")?.title.length).toBeGreaterThan(0);
  });
});
