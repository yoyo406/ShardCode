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
  timeoutMs?: number;
  maxOutputBytes?: number;
  executor?: (request: ShellRequest) => Promise<ShellResult>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function executeLocal(request: ShellRequest, options: ProcessSandboxOptions): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let timedOut = false;
    let truncated = false;
    let terminated = false;
    const terminate = (): void => {
      if (terminated) return;
      terminated = true;
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {
          // Fall through to the direct child kill when process groups are unavailable.
        }
      }
      child.kill("SIGTERM");
    };
    const maxOutputBytes = Math.max(1, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    const append = (stream: "stdout" | "stderr", chunk: Buffer | string): void => {
      const value = Buffer.from(chunk.toString());
      const available = maxOutputBytes - capturedBytes;
      if (available <= 0) {
        truncated = true;
      } else if (value.byteLength > available) {
        const prefix = value.subarray(0, available).toString();
        if (stream === "stdout") stdout += prefix;
        else stderr += prefix;
        capturedBytes += available;
        truncated = true;
      } else {
        if (stream === "stdout") stdout += value.toString();
        else stderr += value.toString();
        capturedBytes += value.byteLength;
      }
      if (truncated) terminate();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    child.stdout.on("data", (chunk: Buffer | string) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer | string) => append("stderr", chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (timedOut) stderr += `${stderr ? "\n" : ""}command timed out`;
      if (truncated) stderr += `${stderr ? "\n" : ""}command output truncated`;
      resolve({
        stdout,
        stderr,
        exitCode: timedOut ? 124 : truncated ? 1 : exitCode ?? 1,
        ...(signal ? { signal } : {})
      });
    });
  });
}

export function createProcessSandbox(options: ProcessSandboxOptions): SandboxRunner {
  const executor = options.executor ?? ((request: ShellRequest) => executeLocal(request, options));
  return {
    isolated: options.isolated,
    async execute(request: ShellRequest): Promise<ShellResult> {
      if (options.isolated && !options.executor) {
        throw new ToolExecutionError("isolated executor is unavailable; inject a real process sandbox");
      }
      if (!options.isolated && !options.allowUnisolated) {
        throw new ToolExecutionError(
          "process sandbox is unavailable; configure a container/OS sandbox or explicitly allow local execution"
        );
      }
      return executor(request);
    }
  };
}
