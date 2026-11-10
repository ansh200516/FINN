/**
 * Composer hints. One rotating set of examples, typed into the
 * placeholder. An empty send uses the line that finished, or the first
 * line while a line is still moving. The hint is never the input value.
 */
export const FINNIE_GREETING =
  "Hey, I\u2019m Finnie. Ask me for a result, a promise, a price, or a rule.";

export const COMPOSER_EXAMPLES: readonly string[] = [
  "reliance results",
  "reliance promises",
  "whats in my portfolio",
  "reliance price",
  "set a price alert to 4%",
];

export function composerExamples(): readonly string[] {
  return COMPOSER_EXAMPLES;
}

export type GhostPhase = "typing" | "holding" | "deleting";

export interface GhostState {
  index: number;
  shown: string;
  phase: GhostPhase;
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

/** Placeholders never carry a bracket. A caret painted as text leaked "]". */
export function plainHint(raw: string): string {
  return raw.replace(/[[\]]/g, "");
}

export function advanceGhost(
  state: GhostState,
  examples: readonly string[],
): GhostState {
  const clean = examples.map(plainHint);
  const count = clean.length;
  if (count === 0) return { index: 0, shown: "", phase: "typing" };
  const index = ((state.index % count) + count) % count;
  const example = clean[index] ?? "";
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
}): { placeholder: string; submit: string } {
  const examples = input.examples.map(plainHint);
  const first = examples[0] ?? "";
  const shown = plainHint(input.shown);
  const typing = input.animate && !input.paused;
  return {
    placeholder: typing ? shown : first,
    submit: input.animate ? exampleForEmptySend(examples, shown) : first,
  };
}
