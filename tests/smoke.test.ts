import { describe, expect, it } from "vitest";
import { CATEGORIES, JOB_STEPS, LLM_TASKS } from "@/engine/types";

describe("smoke", () => {
  it("has the 17 reference categories (16 + unclassified)", () => {
    expect(CATEGORIES).toHaveLength(17);
    expect(CATEGORIES).toContain("results");
    expect(CATEGORIES).toContain("unclassified");
  });
  it("exports task and step lists", () => {
    expect(LLM_TASKS.length).toBeGreaterThan(5);
    expect(JOB_STEPS[0]).toBe("queued");
    expect(JOB_STEPS.at(-1)).toBe("done");
  });
});
