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
  it("rotates questions the book can answer", () => {
    expect(composerExamples()).toEqual([
      "How did Supreme Industries' last four quarters land against management's FY26 revenue guidance?",
      "What does Reliance do, and how does revenue split across O2C, retail, and the other printed segments?",
      "What are Voltas's segments, and what revenue mix is printed for them?",
      "What were HDFC Bank's net interest income, margin, and profit after tax in the latest quarter?",
      "Does Amber's profit turn into cash?",
      "How do L&T's debt-equity, working capital, and funding read in the filings?",
      "How did PI Industries' last four quarters compare with management's guidance?",
    ]);
    expect(composerExamples()).toBe(COMPOSER_EXAMPLES);
    const list = composerExamples();
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.length).toBeLessThanOrEqual(7);
    expect(list).not.toContain("hi");
    expect(list).not.toContain("reliance price");
    expect(list).not.toContain("reliance results");
    for (const a of list) {
      expect(plainHint(a)).toBe(a);
      expect(a).not.toMatch(/[[\]]/);
      expect(a.endsWith("?")).toBe(true);
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
    for (let i = 0; i < 4000 && held.length < examples.length; i++) {
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

  it("uses the example on screen, not a different one", () => {
    const examples = composerExamples();
    const first = examples[0] ?? "";
    const fourth = examples[3] ?? "";
    const last = examples.at(-1) ?? "";
    expect(exampleForEmptySend(examples, first.slice(0, 12))).toBe(first);
    expect(exampleForEmptySend(examples, first)).toBe(first);
    expect(exampleForEmptySend(examples, fourth.slice(0, 10), 3)).toBe(fourth);
    expect(
      exampleForEmptySend(examples, last.slice(0, 8), examples.length - 1),
    ).toBe(last);
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
      placeholder: examples[0],
      submit: examples[0],
    });
    expect(
      fieldHint({
        animate: true,
        paused: true,
        examples,
        shown: "set a pr",
      }).placeholder,
    ).toBe(examples[0]);
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
    expect(plainHint(`${examples[0]}]`)).toBe(examples[0]);
  });
});
