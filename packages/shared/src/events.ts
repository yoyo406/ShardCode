import { randomUUID } from "node:crypto";

export const EVENT_TYPES = [
  "SessionStarted",
  "AgentStarted",
  "AgentAborted",
  "TurnStarted",
  "TurnCompleted",
  "ModelRequestStarted",
  "ModelResponseReceived",
  "ToolRequested",
  "ToolStarted",
  "ToolCompleted",
  "ToolFailed",
  "ToolDenied",
  "ContextUpdated",
  "ContextCompacted",
  "SubAgentSpawned",
  "SubAgentCompleted",
  "TestStarted",
  "TestFailed",
  "TestPassed",
  "ValidationStarted",
  "ValidationPassed",
  "BudgetExceeded",
  "ThrashingDetected",
  "SessionCompleted"
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ShardCodeEvent<TData = Record<string, unknown>> {
  id: string;
  type: EventType;
  sessionId: string;
  timestamp: string;
  data: TData;
}

export function createEvent<TData>(
  sessionId: string,
  type: EventType,
  data: TData
): ShardCodeEvent<TData> {
  return {
    id: randomUUID(),
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    data
  };
}
