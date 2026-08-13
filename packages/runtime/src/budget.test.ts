import { describe, expect, it } from "vitest";
import { BudgetTracker } from "./budget.js";

describe("budget tracker", () => {
  it("tracks tokens and tool calls against limits", () => {
    const tracker = new BudgetTracker({ maxTokens: 20, maxToolCalls: 2, maxWallClockSeconds: 60 });

    tracker.recordTokens(10);
    tracker.recordToolCall();
    expect(tracker.snapshot()).toMatchObject({ usedTokens: 10, usedToolCalls: 1 });
    expect(() => tracker.recordToolCall()).not.toThrow();
    expect(() => tracker.recordToolCall()).toThrow("tool-call budget");
    expect(() => tracker.recordTokens(11)).toThrow("token budget");
  });
});
