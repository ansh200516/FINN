import { describe, expect, it } from "vitest";
import { givesAdvice } from "../../scripts/question-loop";

const MARGIN =
  "With the execution momentum expected to pick up in H2, we are reasonably confident to achieve our full year EBITDA margin target of 8.5%.";

describe("question-loop trade advice", () => {
  it("does not treat target inside a management quote as a price target", () => {
    const facts = [{ data: { rows: [{ quote: MARGIN }] } }];
    const say = `FY26 horizon, quote "${MARGIN}", promised ~8.5%, verdict unverifiable.`;
    expect(givesAdvice(say, facts)).toBe(false);

    const priced = "Our target price is 90 on the internal model.";
    expect(
      givesAdvice(`Management said "${priced}"`, [
        { data: { rows: [{ quote: priced }] } },
      ]),
    ).toBe(false);
    expect(givesAdvice("You should buy the shares.", facts)).toBe(true);
    expect(givesAdvice(`You should buy the shares. "${MARGIN}"`, facts)).toBe(
      true,
    );
  });
});
