import { BudgetExceededError } from "@shardcode/shared";
import type { Budget } from "@shardcode/shared";

export type BudgetLimits = Pick<Budget, "maxTokens" | "maxToolCalls" | "maxWallClockSeconds">;

export class BudgetTracker {
  private readonly startedAt: number;
  private current: Budget;

  constructor(budget: Budget | BudgetLimits, startedAt = Date.now()) {
    const persistedStartedAt = "startedAt" in budget && typeof budget.startedAt === "string"
      ? Date.parse(budget.startedAt)
      : Number.NaN;
    this.startedAt = Number.isFinite(persistedStartedAt) ? persistedStartedAt : startedAt;
    this.current = {
      maxTokens: budget.maxTokens,
      maxToolCalls: budget.maxToolCalls,
      maxWallClockSeconds: budget.maxWallClockSeconds,
      usedTokens: "usedTokens" in budget ? budget.usedTokens : 0,
      usedToolCalls: "usedToolCalls" in budget ? budget.usedToolCalls : 0,
      startedAt: new Date(this.startedAt).toISOString()
    };
  }

  recordTokens(tokens: number): void {
    if (tokens < 0 || !Number.isFinite(tokens) || !Number.isInteger(tokens)) {
      throw new BudgetExceededError(`invalid token usage (${tokens})`);
    }
    const next = this.current.usedTokens + tokens;
    if (next > this.current.maxTokens) {
      this.current.usedTokens = next;
      throw new BudgetExceededError(`token budget exceeded (${next}/${this.current.maxTokens})`);
    }
    this.current.usedTokens = next;
  }

  recordToolCall(): void {
    const next = this.current.usedToolCalls + 1;
    if (next > this.current.maxToolCalls) {
      throw new BudgetExceededError(`tool-call budget exceeded (${next}/${this.current.maxToolCalls})`);
    }
    this.current.usedToolCalls = next;
  }

  assertWallClock(): void {
    const elapsedSeconds = (Date.now() - this.startedAt) / 1000;
    if (elapsedSeconds > this.current.maxWallClockSeconds) {
      throw new BudgetExceededError(`wall-clock budget exceeded (${Math.ceil(elapsedSeconds)}s/${this.current.maxWallClockSeconds}s)`);
    }
  }

  snapshot(): Budget {
    return { ...this.current };
  }
}
