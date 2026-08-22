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
  timeoutMs?: number;
  maxOutputBytes?: number;
  executor?: (request: ShellRequest) => Promise<ShellResult>;
}

<<<<<<< HEAD
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function executeLocal(request: ShellRequest, options: ProcessSandboxOptions): Promise<ShellResult> {
=======
function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    const fallback = () => {
      try {
        child.kill(signal);
      } catch {
        // The process may have exited while taskkill was running.
      }
    };
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", fallback);
    killer.on("close", (exitCode) => {
      if (exitCode !== 0) fallback();
    });
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
>>>>>>> origin/main
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
<<<<<<< HEAD
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
=======
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
>>>>>>> origin/main
      });
    });
    request.signal?.addEventListener("abort", onAbort, { once: true });
    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => terminate("timeout"), request.timeoutMs);
    }
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
      if (request.signal?.aborted) {
        return { stdout: "", stderr: "command aborted", exitCode: 130, signal: "SIGTERM" };
      }
      return executor(request);
    }
  };
}
