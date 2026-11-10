import { describe, expect, it } from "vitest";
import { composerExample } from "@/ui/composer";

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
});
