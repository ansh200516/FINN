/**
 * Titles for a chat turn while it is still running.
 * A step is the fallback line before the first thought token. A thought is
 * the displayable model summary. Once a thought exists, it replaces the step
 * title. Signatures and redacted parts stay off the screen.
 */

const TITLE_WORDS = 6;
const COUNT = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
] as const;

const DANGLING = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "for",
  "and",
  "or",
  "in",
  "on",
  "with",
]);

export interface TraceItem {
  id: number;
  title: string;
  text: string;
  source: "step" | "thought";
}

export interface FinnieTrace {
  step: (title: string, text: string) => void;
  thought: (thought: { text: string; fresh: boolean }) => void;
  signal?: AbortSignal;
}

export interface ToolMomentArgs {
  symbol?: string;
  symbolA?: string;
  symbolB?: string;
  which?: string;
  name?: string;
  quarters?: number;
}

export interface ThoughtPart {
  thought?: boolean;
  text?: string;
  thoughtSignature?: string;
  /** Provider flag: this part is not for display. */
  redacted?: boolean;
  thoughtHidden?: boolean;
}

export function companyLabel(
  symbol: string | null | undefined,
  rows: Array<{ symbol: string; name: string }>,
): string | null {
  const key = symbol?.trim().toUpperCase() ?? "";
  if (!key) return null;
  const row = rows.find((item) => item.symbol.trim().toUpperCase() === key);
  const raw = row?.name?.trim() || key;
  const short = raw
    .replace(
      /\b(?:limited|ltd|inc|incorporated|corp|corporation|private|pvt|plc|company)\b\.?/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return short || key;
}

export function planMoment(label: string | null): {
  title: string;
  text: string;
} {
  if (label) {
    return {
      title: clipWords(`Planning ${label}`),
      text: `Choosing which filings to read for ${label}.`,
    };
  }
  return {
    title: "Planning the turn",
    text: "Choosing which filings to read.",
  };
}

export function writeMoment(): { title: string; text: string } {
  return {
    title: "Writing the answer",
    text: "Writing the answer from the filings just read.",
  };
}

/** get_results reads this many quarters when the plan omits the count. */
const RESULTS_DEFAULT_QUARTERS = 4;

export function quarterSpan(count: number | undefined): string | null {
  if (count == null || !Number.isFinite(count)) return null;
  const n = Math.trunc(count);
  if (n < 1) return null;
  const capped = Math.min(8, n);
  const word = COUNT[capped] ?? String(capped);
  return `the last ${word} ${capped === 1 ? "quarter" : "quarters"}`;
}

export function scoreMoment(
  label: string | null,
  quarters: number | undefined,
): { title: string; text: string } {
  const span = quarterSpan(quarters);
  if (!span) {
    return {
      title: "Scoring the quarters",
      text: label
        ? `Scoring ${label}'s quarters against the guidance on file.`
        : "Scoring the quarters against the guidance on file.",
    };
  }
  const bare = span.replace(/^the /, "");
  return {
    title: `Scoring ${span}`,
    text: label
      ? `Scoring ${label}'s ${bare} against the guidance on file.`
      : `Scoring ${span} against the guidance on file.`,
  };
}

export function toolMoment(
  tool: string,
  args: ToolMomentArgs,
  rows: Array<{ symbol: string; name: string }>,
): { title: string; text: string } {
  const label = companyLabel(args.symbol, rows);
  const who = label ?? "the company";
  switch (tool) {
    case "list_portfolio":
      return {
        title: "Reading the book",
        text: "Reading the names in the book.",
      };
    case "add_to_portfolio":
      return {
        title: label
          ? clipWords(`Preparing to add ${label}`)
          : "Preparing an add",
        text: label
          ? `Preparing the confirm step to add ${label}.`
          : "Preparing the confirm step to add a name.",
      };
    case "remove_from_portfolio":
      return {
        title: label
          ? clipWords(`Preparing to remove ${label}`)
          : "Preparing a removal",
        text: label
          ? `Preparing the confirm step to remove ${label}.`
          : "Preparing the confirm step to remove a name.",
      };
    case "get_results": {
      const asked =
        typeof args.quarters === "number" && Number.isFinite(args.quarters)
          ? args.quarters
          : RESULTS_DEFAULT_QUARTERS;
      const span = quarterSpan(asked);
      const bare = span?.replace(/^the /, "") ?? "quarters";
      return {
        title: span ? `Reading ${span}` : "Reading the quarters",
        text: label
          ? `Reading ${label}'s ${bare}.`
          : `Reading ${span ?? "the quarters"}.`,
      };
    }
    case "get_promises":
      return {
        title: label
          ? clipWords(`Reading ${label} guidance`)
          : "Reading guidance",
        text: label
          ? `Reading ${label}'s guidance rows.`
          : "Reading the guidance rows.",
      };
    case "get_reading": {
      const which = args.which?.trim() ?? "";
      if (/guidance/i.test(which)) {
        return {
          title: label
            ? clipWords(`Reading ${label} guidance`)
            : "Reading guidance",
          text: label
            ? `Reading ${label}'s guidance reading.`
            : "Reading the guidance reading.",
        };
      }
      if (which) {
        return {
          title: clipWords(`Reading ${which}`),
          text: label
            ? `Reading ${who}'s ${which} reading.`
            : `Reading the ${which} reading.`,
        };
      }
      return {
        title: "Reading the filing",
        text: label ? `Reading a filing for ${label}.` : "Reading a filing.",
      };
    }
    case "get_quote":
      return {
        title: label
          ? clipWords(`Checking ${label} price`)
          : "Checking the price",
        text: label ? `Checking the ${label} price.` : "Checking the price.",
      };
    case "get_index": {
      const name = args.name?.trim();
      return {
        title: name ? clipWords(`Checking ${name}`) : "Checking the index",
        text: name ? `Checking ${name}.` : "Checking the index.",
      };
    }
    case "get_corporate_actions":
      return {
        title: "Reading corporate actions",
        text: label
          ? `Reading dividends, splits, and bonuses for ${label}.`
          : "Reading dividends, splits, and bonuses.",
      };
    case "set_alert":
      return {
        title: "Drafting the alert",
        text: "Drafting the alert. Nothing is saved until you confirm.",
      };
    case "disable_alert":
      return {
        title: "Finding the alert",
        text: "Finding the alert to turn off.",
      };
    case "open_company":
      return {
        title: label ? clipWords(`Opening ${label}`) : "Opening the page",
        text: label ? `Opening ${label}.` : "Opening the company page.",
      };
    case "get_brief":
      return {
        title: "Reading the brief",
        text: label ? `Reading the brief for ${label}.` : "Reading the brief.",
      };
    case "list_unread":
      return {
        title: "Reading unread filings",
        text: "Reading the unread filings.",
      };
    case "mark_read":
      return {
        title: "Marking filings read",
        text: "Marking the filings read.",
      };
    case "get_upcoming":
      return {
        title: "Reading the calendar",
        text: "Reading the upcoming calendar.",
      };
    case "missed_promises":
      return {
        title: "Reading missed promises",
        text: "Reading the missed promises.",
      };
    case "movers":
      return {
        title: "Reading the movers",
        text: "Reading the movers.",
      };
    case "get_management":
      return {
        title: label
          ? clipWords(`Reading ${label} management`)
          : "Reading management",
        text: label
          ? `Reading management changes for ${label}.`
          : "Reading management changes.",
      };
    case "compare": {
      const a = companyLabel(args.symbolA, rows);
      const b = companyLabel(args.symbolB, rows);
      return {
        title: "Comparing the two",
        text: a && b ? `Comparing ${a} and ${b}.` : "Comparing the two names.",
      };
    }
    default:
      return {
        title: "Running a lookup",
        text: "Running the lookup the plan named.",
      };
  }
}

/**
 * Text the API allows on screen. A thought signature, an empty thought,
 * or a part flagged redacted/hidden is not shown.
 */
export function visibleThoughtText(part: ThoughtPart): string | null {
  if (part.thought !== true) return null;
  if (part.redacted || part.thoughtHidden) return null;
  const text = part.text?.trim() ?? "";
  if (!text) return null;
  if (part.thoughtSignature && text === part.thoughtSignature.trim())
    return null;
  if (isRedactedMarker(text)) return null;
  if (isOpaqueSignature(text)) return null;
  return text;
}

export function appendDelta(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}

export function appendThought(
  current: string,
  incoming: string,
  fresh: boolean,
): string {
  if (fresh) return incoming;
  return appendDelta(current, incoming);
}

export interface ThoughtScan {
  answer: string;
  thought: string;
  thoughtOpen: boolean;
}

/** Walk one chunk's parts. Hidden thoughts are skipped. Answer text is kept. */
export function consumeThoughtParts(
  parts: readonly ThoughtPart[],
  state: ThoughtScan,
): Array<{ text: string; fresh: boolean }> {
  const emitted: Array<{ text: string; fresh: boolean }> = [];
  for (const part of parts) {
    if (part.thought === true) {
      const visible = visibleThoughtText(part);
      if (!visible) continue;
      const fresh = !state.thoughtOpen;
      state.thoughtOpen = true;
      state.thought = appendThought(state.thought, visible, fresh);
      emitted.push({ text: state.thought, fresh });
      continue;
    }
    if (typeof part.text === "string" && part.text.length > 0) {
      state.thoughtOpen = false;
      state.thought = "";
      state.answer = appendDelta(state.answer, part.text);
    }
  }
  return emitted;
}

export function thoughtTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const bold = /^\*\*([^*]{1,80})\*\*/.exec(trimmed);
  const fromBold = bold?.[1]?.replace(/\s+/g, " ").trim();
  if (fromBold) return clipWords(fromBold);
  const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() ?? trimmed;
  const rest = trimmed.slice(firstLine.length).trim();
  if (
    rest &&
    firstLine.length > 0 &&
    firstLine.length <= 48 &&
    !firstLine.includes("**")
  ) {
    return clipWords(stripMarks(firstLine));
  }
  const flat = stripMarks(trimmed).replace(/\s+/g, " ").trim();
  const clause = flat.split(/(?<=[.!?;:])\s|[—–]/, 1)[0] ?? flat;
  return clipWords(clause);
}

export function thoughtBody(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function reduceTrace(
  items: TraceItem[],
  event:
    | { type: "step"; title: string; text: string }
    | { type: "thought"; text: string; fresh: boolean },
): TraceItem[] {
  if (event.type === "step") {
    // A thought already on screen is the title. Later steps do not take it back.
    if (items.some((item) => item.source === "thought")) return items;
    const title = event.title.trim();
    const text = event.text.trim();
    if (!title) return items;
    const last = items.at(-1);
    // One current step covers the gap before the first thought. Not a ledger.
    return [
      {
        id: last?.id ?? 1,
        title,
        text: text || title,
        source: "step",
      },
    ];
  }
  const raw = event.text.trim();
  if (!raw) return items;
  const title = thoughtTitle(raw);
  const text = thoughtBody(raw);
  if (!title || !text) return items;
  const thoughts = items.filter((item) => item.source === "thought");
  const last = thoughts.at(-1);
  if (!event.fresh && last) {
    return thoughts.slice(0, -1).concat({ ...last, title, text });
  }
  return thoughts.concat({
    id: (items.at(-1)?.id ?? 0) + 1,
    title,
    text,
    source: "thought",
  });
}

function stripMarks(value: string): string {
  return value.replace(/[*_`#]/g, "");
}

function clipWords(value: string): string {
  const words = value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, TITLE_WORDS);
  while (words.length > 2 && DANGLING.has((words.at(-1) ?? "").toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}

function isRedactedMarker(text: string): boolean {
  return /^(?:\[?\s*redacted\s*\]?|hidden|thoughts?\s+hidden)$/i.test(text);
}

function isOpaqueSignature(text: string): boolean {
  if (text.length < 80) return false;
  if (/\s/.test(text)) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(text);
}
