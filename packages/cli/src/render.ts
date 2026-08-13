import type { ShardCodeEvent } from "@shardcode/shared";

const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const ANSI_C1_OSC = /\u009d[^\u0007\u009c]*(?:\u0007|\u009c)/g;
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE = /\u001b[@-_]/g;

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_OSC, "")
    .replace(ANSI_C1_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_SINGLE, "")
    .replace(/\u001b/g, "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u0080-\u009f]/g, "");
}

export function renderEvent(event: ShardCodeEvent, write: (line: string) => void, json: boolean): void {
  if (json) {
    write(JSON.stringify(event));
    return;
  }
  const writeHuman = (line: string): void => write(sanitizeTerminalText(line));
  const data = event.data;
  switch (event.type) {
    case "SessionStarted":
      writeHuman(`[session] started ${event.sessionId}`);
      break;
    case "ModelResponseReceived":
      writeHuman(`[model] response (${String(data.toolCallCount ?? 0)} tool call(s))`);
      break;
    case "ToolRequested":
      writeHuman(`[tool] requested ${String((data.call as { name?: unknown } | undefined)?.name ?? "unknown")}`);
      break;
    case "ToolCompleted":
      writeHuman(`[tool] completed ${String(data.executionId ?? "")}`);
      break;
    case "ToolFailed":
      writeHuman(`[tool] failed: ${String((data.result as { output?: unknown } | undefined)?.output ?? "unknown error")}`);
      break;
    case "BudgetExceeded":
    case "ThrashingDetected":
      writeHuman(`[runtime] ${event.type}: ${String(data.message ?? "")}`);
      break;
    case "ValidationPassed":
      writeHuman(`[validation] passed`);
      break;
    case "SessionCompleted":
      writeHuman(`[session] ${String(data.status ?? "completed")}`);
      break;
    default:
      writeHuman(`[${event.type}]`);
  }
}
