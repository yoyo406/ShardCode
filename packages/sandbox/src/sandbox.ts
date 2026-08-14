import { spawn, type ChildProcess } from "node:child_process";
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

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => child.kill(signal));
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    child.kill(signal);
  }
}

function executeLocal(request: ShellRequest): Promise<ShellResult> {
  if (request.signal?.aborted) {
    return Promise.resolve({ stdout: "", stderr: "command aborted", exitCode: 130, signal: "SIGTERM" });
  }
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
    let outputTruncated = false;
    let termination: "aborted" | "timeout" | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const terminate = (reason: "aborted" | "timeout") => {
      if (settled || termination) return;
      termination = reason;
      terminateProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(() => terminateProcessTree(child, "SIGKILL"), 250);
    };

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      request.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => terminate("aborted");

    const appendOutput = (current: string, chunk: Buffer | string): string => {
      const limit = request.maxOutputChars;
      if (limit === undefined) return current + chunk.toString();
      if (current.length >= limit) {
        outputTruncated = true;
        return current;
      }
      const text = chunk.toString();
      const available = Math.max(0, limit - current.length);
      if (text.length > available) outputTruncated = true;
      return current + text.slice(0, available);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      cleanup();
      if (termination) {
        settled = true;
        resolve({
          stdout,
          stderr: stderr || (termination === "aborted" ? "command aborted" : "command timed out"),
          exitCode: termination === "aborted" ? 130 : 124,
          signal: "SIGTERM",
          ...(outputTruncated ? { outputTruncated: true } : {})
        });
        return;
      }
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      cleanup();
      settled = true;
      const reason = termination === "aborted" ? "command aborted" : termination === "timeout" ? "command timed out" : undefined;
      resolve({
        stdout,
        stderr: stderr || reason || "",
        exitCode: exitCode ?? (termination === "aborted" ? 130 : termination === "timeout" ? 124 : 1),
        ...(signal ? { signal } : termination ? { signal: "SIGTERM" } : {}),
        ...(outputTruncated ? { outputTruncated: true } : {})
      });
    });
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => terminate("timeout"), request.timeoutMs);
    }
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
      if (request.signal?.aborted) {
        return { stdout: "", stderr: "command aborted", exitCode: 130, signal: "SIGTERM" };
      }
      return executor(request);
    }
  };
}
