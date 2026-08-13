import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "@shardcode/shared";
import { MemoryStore } from "./memory.js";

class InMemoryStorage implements StorageAdapter {
  private readonly values = new Map<string, string>();
  async read(path: string): Promise<string | undefined> { return this.values.get(path); }
  async write(path: string, content: string): Promise<void> { this.values.set(path, content); }
  async append(path: string, content: string): Promise<void> { this.values.set(path, `${this.values.get(path) ?? ""}${content}`); }
  async exists(path: string): Promise<boolean> { return this.values.has(path); }
}

describe("scoped memory", () => {
  it("stores source, timestamp and scope metadata", async () => {
    const store = new MemoryStore(new InMemoryStorage());
    const entry = await store.add("project", "user", "Use pnpm for this repository");

    expect(entry).toMatchObject({ scope: "project", source: "user", content: "Use pnpm for this repository" });
    expect(entry.id).toEqual(expect.any(String));
    expect(entry.createdAt).toEqual(expect.any(String));
    await expect(store.list("project")).resolves.toEqual([entry]);
  });

  it("clears only session memory", async () => {
    const store = new MemoryStore(new InMemoryStorage());
    await store.add("session", "runtime", "temporary");
    await store.add("project", "user", "durable");

    await store.clearSession();

    await expect(store.list("session")).resolves.toEqual([]);
    await expect(store.list("project")).resolves.toHaveLength(1);
  });
});
