import { randomUUID } from "node:crypto";
import type { Session, ShardCodeEvent, StorageAdapter } from "@shardcode/shared";

export interface SessionStore {
  save(session: Session): Promise<void>;
  load(id: string): Promise<Session | undefined>;
  appendEvent(event: ShardCodeEvent): Promise<void>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const MODEL_ROLES = new Set(["system", "user", "assistant", "tool"]);
const SESSION_STATUSES = new Set(["pending", "running", "completed", "failed", "aborted"]);
const TASK_STATUSES = new Set(["pending", "planning", "running", "validating", "completed", "failed", "aborted"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPersistedSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  const rootTask = value.rootTask;
  const budget = value.budget;
  const messages = value.messages;
  if (!isRecord(rootTask) || !isRecord(budget) || !Array.isArray(messages)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.workspaceRoot !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.model !== "string" ||
    typeof value.eventLogPath !== "string" ||
    typeof value.status !== "string" ||
    !SESSION_STATUSES.has(value.status) ||
    typeof rootTask.status !== "string" ||
    !TASK_STATUSES.has(rootTask.status) ||
    typeof rootTask.id !== "string" ||
    typeof rootTask.prompt !== "string" ||
    !Array.isArray(rootTask.subtasks) ||
    !Array.isArray(rootTask.attempts) ||
    typeof budget.maxTokens !== "number" ||
    typeof budget.maxToolCalls !== "number" ||
    typeof budget.maxWallClockSeconds !== "number" ||
    !isFiniteNonNegative(budget.maxTokens) ||
    !isFiniteNonNegative(budget.maxToolCalls) ||
    !isFiniteNonNegative(budget.maxWallClockSeconds) ||
    !isFiniteNonNegative(budget.usedTokens) ||
    !isFiniteNonNegative(budget.usedToolCalls) ||
    !Array.isArray(value.worktrees) ||
    messages.some((message) =>
      !isRecord(message) ||
      typeof message.role !== "string" ||
      !MODEL_ROLES.has(message.role) ||
      typeof message.content !== "string"
    )
  ) return false;
  return true;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly eventLog = new Map<string, ShardCodeEvent[]>();

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, clone(session));
  }

  async load(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    return session ? clone(session) : undefined;
  }

  async appendEvent(event: ShardCodeEvent): Promise<void> {
    const events = this.eventLog.get(event.sessionId) ?? [];
    events.push(clone(event));
    this.eventLog.set(event.sessionId, events);
  }

  async events(id: string): Promise<ShardCodeEvent[]> {
    return clone(this.eventLog.get(id) ?? []);
  }
}

export class JsonSessionStore implements SessionStore {
  constructor(private readonly storage: StorageAdapter) {}

  async save(session: Session): Promise<void> {
    await this.storage.write(`sessions/${session.id}.json`, JSON.stringify(session, null, 2));
  }

  async load(id: string): Promise<Session | undefined> {
    const content = await this.storage.read(`sessions/${id}.json`);
    if (!content) return undefined;
    const value: unknown = JSON.parse(content);
    if (!isPersistedSession(value) || value.id !== id) throw new Error("invalid persisted session");
    return value;
  }

  async appendEvent(event: ShardCodeEvent): Promise<void> {
    await this.storage.append(`sessions/${event.sessionId}.events.jsonl`, `${JSON.stringify(event)}\n`);
  }
}

export function newSessionId(): string {
  return randomUUID();
}
