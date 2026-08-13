import type { ShardCodeEvent } from "@shardcode/shared";

export function renderEvent(event: ShardCodeEvent, write: (line: string) => void, json: boolean): void {
  if (json) {
    write(JSON.stringify(event));
    return;
  }
  const data = event.data;
  switch (event.type) {
    case "SessionStarted":
      write(`[session] started ${event.sessionId}`);
      break;
    case "ModelResponseReceived":
      write(`[model] response (${String(data.toolCallCount ?? 0)} tool call(s))`);
      break;
    case "ToolRequested":
      write(`[tool] requested ${String((data.call as { name?: unknown } | undefined)?.name ?? "unknown")}`);
      break;
    case "ToolCompleted":
      write(`[tool] completed ${String(data.executionId ?? "")}`);
      break;
    case "ToolFailed":
      write(`[tool] failed: ${String((data.result as { output?: unknown } | undefined)?.output ?? "unknown error")}`);
      break;
    case "BudgetExceeded":
    case "ThrashingDetected":
      write(`[runtime] ${event.type}: ${String(data.message ?? "")}`);
      break;
    case "ValidationPassed":
      write(`[validation] passed`);
      break;
    case "SessionCompleted":
      write(`[session] ${String(data.status ?? "completed")}`);
      break;
    default:
      write(`[${event.type}]`);
  }
}
