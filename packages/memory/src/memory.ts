import { randomUUID } from "node:crypto";
import type { StorageAdapter } from "@shardcode/shared";

export type MemoryScope = "session" | "project" | "user";

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  source: string;
  createdAt: string;
  content: string;
}

export class MemoryStore {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly projectStorage?: StorageAdapter
  ) {}

  async readProjectGuidance(): Promise<string | undefined> {
    return this.projectStorage?.read("SHARDCODE.md");
  }

  async list(scope: MemoryScope): Promise<MemoryEntry[]> {
    const content = await this.storage.read(`memory/${scope}.json`);
    if (!content) return [];
    try {
      const value: unknown = JSON.parse(content);
      return Array.isArray(value) ? (value as MemoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  async add(scope: MemoryScope, source: string, content: string): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: randomUUID(),
      scope,
      source,
      createdAt: new Date().toISOString(),
      content
    };
    const entries = await this.list(scope);
    entries.push(entry);
    await this.storage.write(`memory/${scope}.json`, JSON.stringify(entries, null, 2));
    return entry;
  }

  async clearSession(): Promise<void> {
    await this.storage.write("memory/session.json", "[]");
  }
}
