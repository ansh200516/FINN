/**
 * Composer modes. Name and Book keep the examples already used for
 * that scope. The field types one, pauses, deletes it, and types the
 * next. An empty send uses the line that finished, or the first line
 * while a line is still moving.
 */
export type ComposerMode = "ask" | "price" | "alerts" | "actions";
export type ComposerScope = "name" | "book";

export const FINNIE_GREETING =
  "Hey, I\u2019m Finnie. Ask me for a result, a promise, a price, or a rule.";

export const COMPOSER_MODES: Array<{ id: ComposerMode; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "price", label: "Price" },
  { id: "alerts", label: "Alerts" },
  { id: "actions", label: "Actions" },
];

const EXAMPLES: Record<
  ComposerMode,
  Record<ComposerScope, readonly string[]>
> = {
  ask: {
    name: ["reliance results", "reliance promises", "reliance guidance"],
    book: ["what did they promise", "what did management promise"],
  },
  price: {
    name: ["reliance price", "reliance quote"],
    book: ["nifty", "bank nifty"],
  },
  alerts: {
    name: ["always tell me about results", "set a price alert to 4%"],
    book: [
      "set a book price alert to 4%",
      "notify me about results for the book",
    ],
  },
  actions: {
    name: ["reliance dividends", "reliance bonus or split"],
    book: ["corporate actions for reliance", "dividends for reliance"],
  },
};

export type GhostPhase = "typing" | "holding" | "deleting";

export interface GhostState {
  index: number;
  shown: string;
  phase: GhostPhase;
}

export function composerExamples(
  mode: ComposerMode,
  scope: ComposerScope,
): readonly string[] {
  return EXAMPLES[mode][scope];
}

export function composerExample(
  mode: ComposerMode,
  scope: ComposerScope,
): string {
  return composerExamples(mode, scope)[0] ?? "";
}

/** The line an empty send should use. A partial line falls back to the first. */
export function exampleForEmptySend(
  examples: readonly string[],
  shown: string,
): string {
  for (const example of examples) {
    if (example === shown) return example;
  }
  return examples[0] ?? "";
}

export function ghostDelay(state: GhostState): number {
  if (state.phase === "holding") return 1600;
  if (state.phase === "deleting") return 26;
  if (state.shown.length === 0) return 220;
  return 42;
}

export function advanceGhost(
  state: GhostState,
  examples: readonly string[],
): GhostState {
  const count = examples.length;
  if (count === 0) return { index: 0, shown: "", phase: "typing" };
  const index = ((state.index % count) + count) % count;
  const example = examples[index] ?? "";
  if (state.phase === "typing") {
    if (state.shown.length < example.length) {
      return {
        index,
        shown: example.slice(0, state.shown.length + 1),
        phase: "typing",
      };
    }
    return { index, shown: example, phase: "holding" };
  }
  if (state.phase === "holding") {
    return { index, shown: example, phase: "deleting" };
  }
  if (state.shown.length > 0) {
    return { index, shown: state.shown.slice(0, -1), phase: "deleting" };
  }
  return { index: (index + 1) % count, shown: "", phase: "typing" };
}

/** Reduced motion keeps the first example as a normal placeholder. */
export function fieldHint(input: {
  animate: boolean;
  paused: boolean;
  examples: readonly string[];
  shown: string;
}): { placeholder: string; ghost: string | null; submit: string } {
  const first = input.examples[0] ?? "";
  const showGhost = input.animate && !input.paused;
  return {
    placeholder: showGhost ? "" : first,
    ghost: showGhost ? input.shown : null,
    submit: input.animate
      ? exampleForEmptySend(input.examples, input.shown)
      : first,
  };
}
