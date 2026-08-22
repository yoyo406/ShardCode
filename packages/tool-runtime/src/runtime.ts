import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProcessSandbox, type SandboxRunner } from "@shardcode/sandbox";
import type {
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ToolCall,
  ToolDefinition,
  ToolInvoker,
  ToolResult
} from "@shardcode/shared";
import { FileStorage } from "./storage.js";
import { PermissionEngine } from "./permissions.js";
import { ensureParent, globWorkspace, grepWorkspace, inputRecord, listWorkspaceFiles, requiredString, stringValue, TOOL_DEFINITIONS } from "./tools.js";
import { assertWorkspacePath, quoteShell, resolveWorkspacePath } from "./paths.js";

export interface ToolRuntimeOptions {
  workspaceRoot: string;
  mode: PermissionMode;
  isolatedEnvironment?: boolean;
  permissionEngine?: PermissionEngine;
  sandbox?: SandboxRunner;
  ask?: (request: PermissionRequest, decision: PermissionDecision) => Promise<boolean>;
  maxOutputChars?: number;
  shellTimeoutMs?: number;
}

export class ToolRuntime implements ToolInvoker {
  readonly workspaceRoot: string;
  readonly mode: PermissionMode;
  private readonly permissions: PermissionEngine;
  private readonly sandbox: SandboxRunner;
  private readonly ask: ToolRuntimeOptions["ask"];
  private readonly fileStorage: FileStorage;
  private readonly maxOutputChars: number;
  private readonly shellTimeoutMs: number | undefined;

  static async create(options: ToolRuntimeOptions): Promise<ToolRuntime> {
    const permissionEngine = options.permissionEngine ?? await PermissionEngine.create({
      workspaceRoot: options.workspaceRoot,
      mode: options.mode,
      isolatedEnvironment: options.isolatedEnvironment ?? false
    });
    return new ToolRuntime({ ...options, permissionEngine });
  }

  constructor(options: ToolRuntimeOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.mode = options.mode;
    this.permissions = options.permissionEngine ?? new PermissionEngine({
      workspaceRoot: options.workspaceRoot,
      mode: options.mode,
      isolatedEnvironment: options.isolatedEnvironment ?? false
<<<<<<< HEAD
    });
    this.sandbox = options.sandbox ?? createProcessSandbox({
      // Local process execution is acceptable only after an explicit approval.
      // Bypass mode must have a real sandbox injected by the host and therefore
      // fails closed when none is available.
      isolated: false,
      allowUnisolated: options.mode !== "bypass"
    });
=======
    });
    this.sandbox = options.sandbox ?? createProcessSandbox({ isolated: options.isolatedEnvironment === true });
>>>>>>> origin/main
    this.ask = options.ask;
    this.fileStorage = new FileStorage(join(options.workspaceRoot, ".shardcode"));
    this.maxOutputChars = Math.max(1_000, options.maxOutputChars ?? 20_000);
    this.shellTimeoutMs = options.shellTimeoutMs;
  }

  definitions(): ToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  storage(): FileStorage {
    return this.fileStorage;
  }

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return this.failed(call, "ABORTED", "tool execution was aborted");
    const definition = TOOL_DEFINITIONS.find((candidate) => candidate.name === call.name);
    if (!definition) {
      return this.failed(call, "UNKNOWN_TOOL", `unknown tool: ${call.name}`);
    }
    const input = inputRecord(call.input);
    const pathValue = typeof input.path === "string" ? input.path : undefined;
    const commandValue = typeof input.command === "string" ? input.command : undefined;
    const request: PermissionRequest = {
      toolName: call.name,
      risk: definition.risk,
      mode: this.mode,
      ...(pathValue !== undefined ? { path: pathValue } : {}),
      ...(commandValue !== undefined ? { command: commandValue } : {})
    };
    const decision = this.permissions.check(request);
    if (decision.level === "deny") return this.denied(call, decision);
    if (decision.level === "ask") {
      const approved = this.ask ? await this.ask(request, decision) : false;
      if (!approved) return this.denied(call, { ...decision, reason: `${decision.reason}; approval was not granted` });
    }
    if (pathValue !== undefined) {
      try {
        await assertWorkspacePath(this.workspaceRoot, pathValue);
      } catch (error) {
        return this.failed(call, "PATH_SECURITY", error instanceof Error ? error.message : String(error));
      }
    }
    try {
      return await this.run(call, input, signal);
    } catch (error) {
      if (signal?.aborted) return this.failed(call, "ABORTED", "tool execution was aborted");
      return this.failed(call, "TOOL_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
    }
  }

  private async run(call: ToolCall, input: ReturnType<typeof inputRecord>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return this.failed(call, "ABORTED", "tool execution was aborted");
    switch (call.name) {
      case "read_file": {
        const target = this.path(requiredString(input, "path"));
        return this.completed(call, await readFile(target, "utf8"));
      }
      case "write_file": {
        const target = this.path(requiredString(input, "path"));
        const content = stringValue(input, "content");
        await ensureParent(target);
        await import("node:fs/promises").then(({ writeFile }) => writeFile(target, content, "utf8"));
        return this.completed(call, `wrote ${input.path}`);
      }
      case "edit_file": {
        const target = this.path(requiredString(input, "path"));
        const oldText = stringValue(input, "oldText");
        const newText = stringValue(input, "newText");
        const content = await readFile(target, "utf8");
        if (!content.includes(oldText)) throw new Error("oldText was not found in the file");
        await import("node:fs/promises").then(({ writeFile }) => writeFile(target, content.replace(oldText, newText), "utf8"));
        return this.completed(call, `edited ${input.path}`);
      }
      case "delete_file": {
        const target = this.path(requiredString(input, "path"));
        await import("node:fs/promises").then(({ rm }) => rm(target));
        return this.completed(call, `deleted ${input.path}`);
      }
      case "list_files":
        return this.completed(call, (await listWorkspaceFiles(this.workspaceRoot, typeof input.path === "string" ? input.path : "")).join("\n"));
      case "glob":
        return this.completed(call, (await globWorkspace(this.workspaceRoot, requiredString(input, "pattern"))).join("\n"));
      case "grep":
        return this.completed(call, await grepWorkspace(this.workspaceRoot, requiredString(input, "pattern"), typeof input.path === "string" ? input.path : "", input.ignoreCase === true));
      case "run_shell":
        return this.runShell(call, requiredString(input, "command"), signal);
      case "git_status":
        return this.runGit(call, "git status --short", signal);
      case "git_diff":
        return this.runGit(call, typeof input.path === "string" ? `git diff -- ${quoteShell(this.relativePath(input.path))}` : "git diff", signal);
      case "git_log": {
        const limit = typeof input.limit === "number" && Number.isInteger(input.limit) ? Math.min(Math.max(input.limit, 1), 100) : 20;
        return this.runGit(call, `git log --oneline -n ${limit}`, signal);
      }
      default:
        return this.failed(call, "UNKNOWN_TOOL", `unknown tool: ${call.name}`);
    }
  }

  private async runShell(call: ToolCall, command: string, signal?: AbortSignal): Promise<ToolResult> {
    const result = await this.sandbox.execute({
      command,
      cwd: this.workspaceRoot,
      ...(signal ? { signal } : {}),
      ...(this.shellTimeoutMs !== undefined ? { timeoutMs: this.shellTimeoutMs } : {}),
      maxOutputChars: this.maxOutputChars
    });
    const output = [result.stdout, result.stderr, ...(result.outputTruncated ? ["[…sortie shell tronquée…]"] : [])].filter(Boolean).join("\n");
    if (signal?.aborted) {
      return this.failed(call, "ABORTED", output || "command aborted", result.exitCode);
    }
    return result.exitCode === 0
      ? this.completed(call, output, result.exitCode)
      : this.failed(call, "COMMAND_FAILED", output || `command exited with ${result.exitCode}`, result.exitCode);
  }

  private async runGit(call: ToolCall, command: string, signal?: AbortSignal): Promise<ToolResult> {
    return this.runShell(call, command, signal);
  }

  private path(requested: string): string {
    const resolved = resolveWorkspacePath(this.workspaceRoot, requested);
    if (!resolved.withinWorkspace || resolved.protected) throw new Error("path is protected or outside the workspace");
    return resolved.absolute;
  }

  private relativePath(requested: string): string {
    return resolveWorkspacePath(this.workspaceRoot, requested).relative;
  }

  private completed(call: ToolCall, output: string, exitCode?: number): ToolResult {
    return {
      callId: call.id,
      toolName: call.name,
      status: "completed",
      output: this.limitOutput(output),
      ...(exitCode !== undefined ? { exitCode } : {})
    };
  }

  private failed(call: ToolCall, code: string, message: string, exitCode?: number): ToolResult {
    return {
      callId: call.id,
      toolName: call.name,
      status: "failed",
      output: this.limitOutput(message),
      error: { code, message: this.limitOutput(message) },
      ...(exitCode !== undefined ? { exitCode } : {})
    };
  }

  private limitOutput(output: string): string {
    if (output.length <= this.maxOutputChars) return output;
    const suffix = `\n[…output tronqué à ${this.maxOutputChars} caractères…]`;
    return `${output.slice(0, Math.max(0, this.maxOutputChars - suffix.length))}${suffix}`;
  }

  private denied(call: ToolCall, decision: PermissionDecision): ToolResult {
    return {
      callId: call.id,
      toolName: call.name,
      status: "denied",
      output: decision.reason,
      error: { code: "PERMISSION_DENIED", message: decision.reason },
      permission: decision
    };
  }
}
