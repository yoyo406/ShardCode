import { spawn } from "node:child_process";
import { ToolExecutionError } from "@shardcode/shared";
import type { ShellRequest, ShellResult } from "@shardcode/shared";

export interface SandboxRunner {
  readonly isolated: boolean;
  execute(request: ShellRequest): Promise<ShellResult>;
}

export interface ProcessSandboxOptions {
  isolated: boolean;
  allowUnisolated?: boolean;
  executor?: (request: ShellRequest) => Promise<ShellResult>;
}

function executeLocal(request: ShellRequest): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1, ...(signal ? { signal } : {}) });
    });
  });
}

export function createProcessSandbox(options: ProcessSandboxOptions): SandboxRunner {
  const executor = options.executor ?? executeLocal;
  return {
    isolated: options.isolated,
    async execute(request: ShellRequest): Promise<ShellResult> {
      if (!options.isolated && !options.allowUnisolated) {
        throw new ToolExecutionError(
          "process sandbox is unavailable; configure a container/OS sandbox or explicitly allow local execution"
        );
      }
      return executor(request);
    }
  };
}
