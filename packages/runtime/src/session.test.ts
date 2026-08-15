import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvent } from "@shardcode/shared";
import { FileStorage } from "@shardcode/tool-runtime";
import { InMemorySessionStore, JsonSessionStore } from "./session.js";

describe("session store", () => {
  it("persists sessions and event records", async () => {
    const store = new InMemorySessionStore();
    const session = {
      id: "session-1",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      workspaceRoot: "/repo",
      provider: "scripted",
      model: "test",
      rootTask: { id: "task-1", prompt: "test", status: "pending" as const, subtasks: [], attempts: [] },
      worktrees: [],
      budget: { maxTokens: 10, maxToolCalls: 1, maxWallClockSeconds: 1, usedTokens: 0, usedToolCalls: 0 },
      eventLogPath: ".shardcode/sessions/session-1.events.jsonl",
      status: "pending" as const,
      messages: []
    };
    await store.save(session);
    const event = createEvent(session.id, "SessionStarted", {});
    await store.appendEvent(event);

    await expect(store.load(session.id)).resolves.toEqual(session);
    await expect(store.events(session.id)).resolves.toEqual([event]);
  });

  it("rejects persisted sessions that do not match the session schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-session-schema-"));
    const storage = new FileStorage(join(root, ".shardcode"));
    await storage.write("sessions/forged.json", JSON.stringify({ id: "forged", status: "completed" }));
    const store = new JsonSessionStore(storage);

    await expect(store.load("forged")).rejects.toThrow("invalid persisted session");
  });
});
