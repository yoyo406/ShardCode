export type PermissionLevel = "allow" | "ask" | "deny";
export type PermissionMode = "ask" | "acceptEdits" | "bypass";
export type ToolRisk = "read" | "write" | "shell" | "git" | "network";

export interface PermissionRule {
  tool?: string;
  path?: string;
  command?: string;
  decision: PermissionLevel;
  reason?: string;
}

export interface PermissionSettings {
  rules?: PermissionRule[];
}

export interface PermissionRequest {
  toolName: string;
  risk: ToolRisk;
  mode: PermissionMode;
  path?: string;
  command?: string;
}

export interface PermissionDecision {
  level: PermissionLevel;
  reason: string;
  matchedRule?: PermissionRule;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolFailure {
  code: string;
  message: string;
}

export interface ToolResult {
  callId: string;
  toolName: string;
  status: "completed" | "failed" | "denied";
  output: string;
  error?: ToolFailure;
  exitCode?: number;
  permission?: PermissionDecision;
}

export type ModelRole = "system" | "user" | "assistant" | "tool";

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ModelMessage {
  role: ModelRole;
  content: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
}

export type ModelFinishReason = "stop" | "tool_call" | "length" | "unknown";

export interface ModelResponse {
  message: ModelMessage;
  toolCalls: ModelToolCall[];
  finishReason: ModelFinishReason;
  usage?: TokenUsage | undefined;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface ToolInvoker {
  definitions(): ToolDefinition[];
  execute(call: ToolCall): Promise<ToolResult>;
}

export interface StorageAdapter {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type TaskStatus =
  | "pending"
  | "planning"
  | "running"
  | "validating"
  | "completed"
  | "failed"
  | "aborted";

export type SubtaskStatus = "pending" | "running" | "succeeded" | "failed";
export type AttemptStatus = "started" | "tools_executing" | "observing" | "done";
export type ToolExecutionStatus =
  | "requested"
  | "permission_check"
  | "ask_pending"
  | "executing"
  | "completed"
  | "failed";

export interface Subtask {
  id: string;
  title: string;
  scope: string[];
  status: SubtaskStatus;
}

export interface Attempt {
  id: string;
  status: AttemptStatus;
  toolExecutionIds: string[];
}

export interface ToolExecution {
  id: string;
  call: ToolCall;
  status: ToolExecutionStatus;
  result?: ToolResult;
}

export interface Task {
  id: string;
  prompt: string;
  status: TaskStatus;
  subtasks: Subtask[];
  attempts: Attempt[];
  toolExecutions?: ToolExecution[];
  validation?: ValidationState;
  error?: string;
}

export interface ValidationState {
  markerSeen: boolean;
  passedCommands: string[];
  failedCommands: string[];
  message?: string;
}

export interface Budget {
  maxTokens: number;
  maxToolCalls: number;
  maxWallClockSeconds: number;
  usedTokens: number;
  usedToolCalls: number;
}

export interface WorktreeRef {
  id: string;
  path: string;
  branch: string;
  subtaskId?: string;
}

export type SessionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  workspaceRoot: string;
  provider: string;
  model: string;
  rootTask: Task;
  worktrees: WorktreeRef[];
  budget: Budget;
  eventLogPath: string;
  status: SessionStatus;
  messages: ModelMessage[];
  finalMessage?: string;
}

export interface ProviderConfig {
  provider: "openai" | "anthropic" | "gemini" | "scripted";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface ShellRequest {
  command: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  allowLocal?: boolean;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
}
