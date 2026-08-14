import { describe, expect, it } from "vitest";
import type { ModelMessage } from "@shardcode/shared";
import { compactContext } from "./context.js";

describe("context compaction", () => {
  it("keeps the task and newest turns while bounding the provider view", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system rules" },
      { role: "user", content: "Original task: preserve this" },
      { role: "assistant", content: "old answer".repeat(20) },
      { role: "user", content: "old follow-up".repeat(20) },
      { role: "assistant", content: "new answer".repeat(20) },
      { role: "user", content: "Newest request: keep this" },
      { role: "assistant", content: "latest answer".repeat(20) }
    ];

    const result = compactContext(messages, { maxCharacters: 900, keepRecentGroups: 1 });

    expect(result.compacted).toBe(true);
    expect(result.finalCharacters).toBeLessThanOrEqual(900);
    expect(result.messages.some((message) => message.content.includes("Original task"))).toBe(true);
    expect(result.messages.some((message) => message.content.includes("Newest request"))).toBe(true);
    expect(result.messages.some((message) => message.content.includes("context compaction"))).toBe(true);
    expect(result.omittedMessages).toBeGreaterThan(0);
  });

  it("returns the same transcript when it is below the limit", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "short" }];
    const result = compactContext(messages, { maxCharacters: 10_000 });

    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("bounds a system-only transcript using serialized message size", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: `${'quoted "line"\\n'.repeat(1_000)}` },
      { role: "system", content: `${'quoted "line"\\n'.repeat(1_000)}` }
    ];
    const result = compactContext(messages, { maxCharacters: 200 });

    expect(result.compacted).toBe(true);
    expect(result.finalCharacters).toBeLessThanOrEqual(200);
    expect(JSON.stringify(result.messages).length).toBeLessThanOrEqual(200);
  });
});
