/**
 * Composer modes. The placeholder is an example for the current mode
 * and scope. It is not typed into the field. An empty send uses it.
 */
export type ComposerMode = "ask" | "price" | "alerts" | "actions";
export type ComposerScope = "name" | "book";

export const COMPOSER_MODES: Array<{ id: ComposerMode; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "price", label: "Price" },
  { id: "alerts", label: "Alerts" },
  { id: "actions", label: "Actions" },
];

export function composerExample(
  mode: ComposerMode,
  scope: ComposerScope,
): string {
  switch (mode) {
    case "ask":
      return scope === "name" ? "reliance results" : "what did they promise";
    case "alerts":
      return scope === "name"
        ? "always tell me about results"
        : "set a book price alert to 4%";
    case "price":
      return scope === "name" ? "reliance price" : "nifty";
    case "actions":
      return scope === "name"
        ? "reliance dividends"
        : "corporate actions for reliance";
  }
}
