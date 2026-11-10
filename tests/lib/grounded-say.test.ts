import { describe, expect, it } from "vitest";
import { dropUngroundedSentences, ungroundedNumbers } from "@/lib/groundedSay";

describe("grounded say", () => {
  it("grounds a minus that the tokenizer drops", () => {
    const facts = [{ quarters: [{ qoqPct: -15.25, revenue: 71449.7 }] }];
    const say = "qoq -15.25 and revenue 71,449.7.";
    expect(ungroundedNumbers(say, "four quarters", facts)).toEqual([]);
  });

  it("drops a summed total that is not a field", () => {
    const facts = [{ filedAway: 25, watch: 13 }];
    const say =
      "Over the last 7 days, the book filed 38 total items, with 13 in the brief and 25 filed away. Those that deserve attention are on the brief.";
    const kept = dropUngroundedSentences(say, "last 7 days", facts);
    expect(kept).not.toContain("38");
    expect(kept).toContain("deserve attention");
  });
});
