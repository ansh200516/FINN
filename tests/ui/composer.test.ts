import { describe, expect, it } from "vitest";
import {
  advanceGhost,
  COMPOSER_EXAMPLES,
  COMPOSER_MAX_PX,
  COMPOSER_MIN_PX,
  composerBoxHeight,
  composerExamples,
  exampleForEmptySend,
  FINNIE_GREETING,
  fieldHint,
  type GhostState,
  plainHint,
} from "@/ui/composer";

describe("composer examples", () => {
  it("rotates results, promises, the portfolio, a price, and an alert", () => {
    expect(composerExamples()).toEqual([
      "reliance results",
      "reliance promises",
      "whats in my portfolio",
      "reliance price",
      "set a price alert to 4%",
    ]);
    expect(composerExamples()).toBe(COMPOSER_EXAMPLES);
    const list = composerExamples();
    expect(list.length).toBeGreaterThan(1);
    for (const a of list) {
      expect(plainHint(a)).toBe(a);
      expect(a).not.toMatch(/[[\]]/);
      for (const b of list) {
        if (a !== b) expect(b.startsWith(a)).toBe(false);
      }
    }
  });
});

describe("composer height", () => {
  it("stays one line when empty, grows to six, then scrolls", () => {
    expect(COMPOSER_MIN_PX).toBe(44);
    expect(COMPOSER_MAX_PX).toBe(154);
    expect(composerBoxHeight(400, false)).toEqual({
      height: 44,
      scroll: false,
    });
    expect(composerBoxHeight(44, true)).toEqual({ height: 44, scroll: false });
    expect(composerBoxHeight(66, true)).toEqual({ height: 66, scroll: false });
    expect(composerBoxHeight(154, true)).toEqual({
      height: 154,
      scroll: false,
    });
    expect(composerBoxHeight(176, true)).toEqual({
      height: 154,
      scroll: true,
    });
  });
});

describe("typed example", () => {
  it("names Finnie in the opening line", () => {
    expect(FINNIE_GREETING).toBe(
      "Hey, I\u2019m Finnie. Ask me for a result, a promise, a price, or a rule.",
    );
  });

  it("types each example, then an empty send uses the finished line", () => {
    const examples = composerExamples();
    let state: GhostState = { index: 0, shown: "", phase: "typing" };
    const held: string[] = [];
    for (let i = 0; i < 500 && held.length < examples.length; i++) {
      if (state.phase === "holding") held.push(state.shown);
      const current = examples[state.index] ?? examples[0] ?? "";
      const expected =
        current.startsWith(state.shown) || current === state.shown
          ? current
          : (examples.find((example) => example === state.shown) ?? current);
      expect(exampleForEmptySend(examples, state.shown, state.index)).toBe(
        expected,
      );
      state = advanceGhost(state, examples);
    }
    expect(held).toEqual([...examples]);
  });

  it("uses the first example while a line is incomplete", () => {
    const examples = composerExamples();
    expect(exampleForEmptySend(examples, "reli")).toBe("reliance results");
    expect(exampleForEmptySend(examples, "reliance results")).toBe(
      "reliance results",
    );
    expect(exampleForEmptySend(examples, "reliance price")).toBe(
      "reliance price",
    );
    expect(exampleForEmptySend(examples, "reliance p", 3)).toBe(
      "reliance price",
    );
    expect(exampleForEmptySend(examples, "set a pr", 4)).toBe(
      "set a price alert to 4%",
    );
  });

  it("shows a static placeholder when motion is reduced", () => {
    const examples = composerExamples();
    expect(
      fieldHint({
        animate: false,
        paused: false,
        examples,
        shown: "set a pr",
      }),
    ).toEqual({
      placeholder: "reliance results",
      submit: "reliance results",
    });
    expect(
      fieldHint({
        animate: true,
        paused: true,
        examples,
        shown: "set a pr",
      }).placeholder,
    ).toBe("reliance results");
  });

  it("types into the placeholder and never a bracket or the field value", () => {
    const examples = composerExamples();
    let state: GhostState = { index: 0, shown: "", phase: "typing" };
    for (let i = 0; i < 80; i++) {
      const hint = fieldHint({
        animate: true,
        paused: false,
        examples,
        shown: state.shown,
      });
      expect(hint.placeholder).toBe(state.shown);
      expect(hint.placeholder).not.toMatch(/[[\]]/);
      expect(hint).not.toHaveProperty("ghost");
      state = advanceGhost(state, examples);
    }
    expect(plainHint("reliance results]")).toBe("reliance results");
  });
});
