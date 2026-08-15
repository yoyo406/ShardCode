import { describe, expect, it } from "vitest";
import type { Budget } from "@shardcode/shared";
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

  it("enforces wall-clock time from a persisted session start", () => {
    const persistedBudget = {
      maxTokens: 20,
      maxToolCalls: 2,
      maxWallClockSeconds: 1,
      usedTokens: 0,
      usedToolCalls: 0,
      startedAt: new Date(Date.now() - 2_000).toISOString()
    } as unknown as Budget;
    const tracker = new BudgetTracker(persistedBudget);

    expect(() => tracker.assertWallClock()).toThrow("wall-clock budget");
  });
});
