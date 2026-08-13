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
    return JSON.parse(content) as Session;
  }

  async appendEvent(event: ShardCodeEvent): Promise<void> {
    await this.storage.append(`sessions/${event.sessionId}.events.jsonl`, `${JSON.stringify(event)}\n`);
  }
}

export function newSessionId(): string {
  return randomUUID();
}
