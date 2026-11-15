/**
 * Composer hints. One rotating set of examples, typed into the
 * placeholder. An empty send uses the line that finished, or the first
 * line while a line is still moving. The hint is never the input value.
 */
export const FINNIE_GREETING =
  "Hey, I\u2019m Finnie. Ask me for a result, a promise, a price, or a rule.";

/** One line is 44px: 11px padding above and below a 22px line. Six lines, then scroll. */
export const COMPOSER_LINE_PX = 22;
export const COMPOSER_PAD_Y = 11;
export const COMPOSER_MIN_PX = COMPOSER_PAD_Y * 2 + COMPOSER_LINE_PX;
export const COMPOSER_MAX_LINES = 6;
export const COMPOSER_MAX_PX =
  COMPOSER_PAD_Y * 2 + COMPOSER_LINE_PX * COMPOSER_MAX_LINES;

/**
 * Height of the composer field. An empty field stays one line so a typed
 * placeholder cannot grow it. Content grows until six lines, then scrolls.
 */
export function composerBoxHeight(
  scrollHeight: number,
  hasText: boolean,
): { height: number; scroll: boolean } {
  if (!hasText) return { height: COMPOSER_MIN_PX, scroll: false };
  const full =
    Number.isFinite(scrollHeight) && scrollHeight > 0
      ? scrollHeight
      : COMPOSER_MIN_PX;
  const height = Math.min(Math.max(full, COMPOSER_MIN_PX), COMPOSER_MAX_PX);
  return { height, scroll: full > COMPOSER_MAX_PX };
}

export const COMPOSER_EXAMPLES: readonly string[] = [
  "How did Supreme Industries' last four quarters land against management's FY26 revenue guidance?",
  "What does Reliance do, and how does revenue split across O2C, retail, and the other printed segments?",
  "What are Voltas's segments, and what revenue mix is printed for them?",
  "What were HDFC Bank's net interest income, margin, and profit after tax in the latest quarter?",
  "Does Amber's profit turn into cash?",
  "How do L&T's debt-equity, working capital, and funding read in the filings?",
  "How did PI Industries' last four quarters compare with management's guidance?",
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

/**
 * The example on screen. A partial line finishes the example being typed,
 * not a different one earlier in the rotation.
 */
export function exampleForEmptySend(
  examples: readonly string[],
  shown: string,
  index = 0,
): string {
  const clean = examples.map(plainHint);
  const count = clean.length;
  const at = count ? ((index % count) + count) % count : 0;
  const current = clean[at] ?? "";
  if (current && (shown === current || current.startsWith(shown)))
    return current;
  for (const example of clean) {
    if (example === shown) return example;
  }
  return current || clean[0] || "";
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
  index?: number;
}): { placeholder: string; submit: string } {
  const examples = input.examples.map(plainHint);
  const first = examples[0] ?? "";
  const shown = plainHint(input.shown);
  const typing = input.animate && !input.paused;
  const index = input.index ?? 0;
  return {
    placeholder: typing ? shown : first,
    submit: input.animate ? exampleForEmptySend(examples, shown, index) : first,
  };
}
