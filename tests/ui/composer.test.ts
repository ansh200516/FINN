import { describe, expect, it } from "vitest";
import {
  advanceGhost,
  type ComposerMode,
  composerExample,
  composerExamples,
  exampleForEmptySend,
  FINNIE_GREETING,
  fieldHint,
  type GhostState,
} from "@/ui/composer";

const MODES: ComposerMode[] = ["ask", "price", "alerts", "actions"];

describe("composer examples", () => {
  it("changes the hint with the mode and the scope", () => {
    expect(composerExample("ask", "name")).toBe("reliance results");
    expect(composerExample("ask", "book")).toBe("what did they promise");
    expect(composerExample("alerts", "name")).toBe(
      "always tell me about results",
    );
    expect(composerExample("alerts", "book")).toBe(
      "set a book price alert to 4%",
    );
    expect(composerExample("price", "name")).toBe("reliance price");
    expect(composerExample("price", "book")).toBe("nifty");
    expect(composerExample("actions", "name")).toBe("reliance dividends");
    expect(composerExample("actions", "book")).toBe(
      "corporate actions for reliance",
    );
  });

  it("keeps Name and Book on their own lists, with no line a prefix of another", () => {
    for (const mode of MODES) {
      const name = composerExamples(mode, "name");
      const book = composerExamples(mode, "book");
      expect(name[0]).toBe(composerExample(mode, "name"));
      expect(book[0]).toBe(composerExample(mode, "book"));
      expect(name.length).toBeGreaterThan(1);
      expect(book).not.toEqual(name);
      for (const list of [name, book]) {
        for (const a of list) {
          for (const b of list) {
            if (a !== b) expect(b.startsWith(a)).toBe(false);
          }
        }
      }
    }
  });
});

describe("typed example", () => {
  it("names Finnie in the opening line", () => {
    expect(FINNIE_GREETING).toBe(
      "Hey, I\u2019m Finnie. Ask me for a result, a promise, a price, or a rule.",
    );
  });

  it("types each example, then an empty send uses the finished line", () => {
    const examples = composerExamples("ask", "name");
    let state: GhostState = { index: 0, shown: "", phase: "typing" };
    const held: string[] = [];
    for (let i = 0; i < 500 && held.length < examples.length; i++) {
      if (state.phase === "holding") held.push(state.shown);
      const finished = examples.find((example) => example === state.shown);
      expect(exampleForEmptySend(examples, state.shown)).toBe(
        finished ?? examples[0],
      );
      state = advanceGhost(state, examples);
    }
    expect(held).toEqual([...examples]);
  });

  it("uses the first example while a line is incomplete", () => {
    const examples = composerExamples("price", "book");
    expect(exampleForEmptySend(examples, "ni")).toBe("nifty");
    expect(exampleForEmptySend(examples, "nifty")).toBe("nifty");
    expect(exampleForEmptySend(examples, "bank nifty")).toBe("bank nifty");
  });

  it("shows a static placeholder when motion is reduced", () => {
    const examples = composerExamples("alerts", "name");
    expect(
      fieldHint({
        animate: false,
        paused: false,
        examples,
        shown: "set a pr",
      }),
    ).toEqual({
      placeholder: "always tell me about results",
      ghost: null,
      submit: "always tell me about results",
    });
    expect(
      fieldHint({
        animate: true,
        paused: true,
        examples,
        shown: "set a pr",
      }).ghost,
    ).toBeNull();
  });
});
