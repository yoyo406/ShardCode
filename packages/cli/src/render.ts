import type { ShardCodeEvent } from "@shardcode/shared";
import type { TuiTone } from "./theme.js";

export interface RenderOptions {
  style?: (text: string, tone: TuiTone) => string;
}

const ANSI_OSC = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const C1_OSC = /\u009d[^\u0007\u009c]*(?:\u0007|\u009c|\u001b\\)/g;
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_C1_CSI = /\u009b[0-?]*[ -/]*[@-~]/g;
const ANSI_SINGLE = /\u001b[@-_]/g;

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(ANSI_OSC, "")
    .replace(C1_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_SINGLE, "")
    .replace(/\u001b/g, "")
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function sanitizeTuiTerminalText(value: string, trustedStyles: ReadonlySet<string>): string {
  const preservedStyles: string[] = [];
  const styleToken = (index: number): string => `\uE000${index}\uE001`;
  let safeValue = value.replace(/[\uE000-\uE001]/g, "");
  safeValue = safeValue
    .replace(ANSI_OSC, "")
    .replace(C1_OSC, "")
    .replace(ANSI_CSI, (sequence) => {
      if (!trustedStyles.has(sequence)) return "";
      const index = preservedStyles.push(sequence) - 1;
      return styleToken(index);
    })
    .replace(ANSI_C1_CSI, "")
    .replace(ANSI_SINGLE, "")
    .replace(/\u001b/g, "")
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return safeValue.replace(/\uE000(\d+)\uE001/g, (_token, index: string) => preservedStyles[Number(index)] ?? "");
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function field(data: Record<string, unknown>, name: string, fallback = ""): string {
  return text(data[name], fallback);
}

function nested(data: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = data[name];
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function humanLine(line: string, tone: TuiTone, options?: RenderOptions): string {
  const safeLine = sanitizeTerminalText(line);
  return options?.style?.(safeLine, tone) ?? safeLine;
}

export function renderEvent(
  event: ShardCodeEvent,
  write: (line: string) => void,
  json: boolean,
  options?: RenderOptions
): void {
  if (json) {
    write(JSON.stringify(event));
    return;
  }

  const data = event.data;
  const call = nested(data, "call");
  const result = nested(data, "result");
  const status = field(data, "status", "completed");
  let line: string;
  let tone: TuiTone;

  switch (event.type) {
    case "SessionStarted":
      line = `[session] started ${event.sessionId}`;
      tone = "primary";
      break;
    case "AgentStarted":
      line = `[agent] started ${field(data, "provider", "ShardCode")} ${field(data, "model")}`.trim();
      tone = "info";
      break;
    case "ModelRequestStarted":
      line = `[model] request (turn ${field(data, "turn", "0")})`;
      tone = "info";
      break;
    case "ModelResponseReceived":
      line = `[model] response (${field(data, "toolCallCount", "0")} tool call(s))`;
      tone = "info";
      break;
    case "ToolRequested":
      line = `[tool] requested ${field(call, "name", "unknown")}`;
      tone = "accent";
      break;
    case "ToolStarted":
      line = `[tool] started ${field(data, "toolName", "unknown")}`;
      tone = "accent";
      break;
    case "ToolCompleted":
      line = `[tool] completed ${field(data, "executionId")}`;
      tone = "success";
      break;
    case "ToolFailed": {
      const permission = nested(result, "permission");
      line = result.status === "denied"
        ? `[permission] denied ${field(call, "name", field(result, "toolName", "unknown"))}: ${field(permission, "reason", "permission required")}`
        : `Échec : ${field(result, "output", field(nested(result, "error"), "message", "unknown error"))}`;
      tone = result.status === "denied" ? "warning" : "error";
      break;
    }
    case "ContextUpdated":
      line = `[context] updated (${field(data, "fileCount", "0")} file(s), ${field(data, "matchCount", "0")} match(es))`;
      tone = "info";
      break;
    case "SubAgentSpawned":
      line = `[sub-agent] spawned ${field(data, "agentId", field(data, "name", "unknown"))}`;
      tone = "accent";
      break;
    case "SubAgentCompleted":
      line = `[sub-agent] completed ${field(data, "agentId", field(data, "name", "unknown"))}`;
      tone = "success";
      break;
    case "TestStarted":
      line = `[test] started ${field(data, "name", field(data, "command"))}`;
      tone = "info";
      break;
    case "TestFailed":
      line = `[test] failed: ${field(data, "message", field(data, "error", "unknown error"))}`;
      tone = "error";
      break;
    case "TestPassed":
      line = `[test] passed ${field(data, "name", field(data, "command"))}`.trim();
      tone = "success";
      break;
    case "ValidationStarted":
      line = "[validation] started";
      tone = "info";
      break;
    case "ValidationPassed":
      line = "[validation] passed";
      tone = "success";
      break;
    case "BudgetExceeded":
      line = `[runtime] BudgetExceeded: ${field(data, "message")}`;
      tone = "error";
      break;
    case "ThrashingDetected":
      line = `[runtime] ThrashingDetected: ${field(data, "message")}`;
      tone = "warning";
      break;
    case "SessionCompleted":
      line = `[session] ${status}`;
      tone = status === "completed" ? "success" : "error";
      break;
    default:
      line = `[${event.type}]`;
      tone = "normal";
  }

  write(humanLine(line, tone, options));
}
