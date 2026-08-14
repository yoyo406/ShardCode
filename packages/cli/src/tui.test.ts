import { PassThrough } from "node:stream";
import { createEvent } from "@shardcode/shared";
import { describe, expect, it } from "vitest";
import {
  createDefaultTuiTerminal,
  renderTuiFooter,
  renderTuiWelcome,
  runInteractiveTui,
  secretInputRemainder,
  type InteractiveTaskRequest,
  type TuiRuntimeInfo,
  type TuiSessionSnapshot,
  type TuiTerminal
} from "./tui.js";
import { renderEvent } from "./render.js";

const info: TuiRuntimeInfo = {
  permissionMode: "acceptEdits",
  provider: "scripted",
  model: "scripted-local"
};

function snapshot(): TuiSessionSnapshot {
  return { sessionId: "abc-123", status: "completed" };
}

function fakeTerminal(inputs: string[], isTTY = true): TuiTerminal & {
  output: string[];
  errors: string[];
  clearCount: number;
  finished: number[];
  closed: number;
  statuses: string[];
} {
  const value = {
    isTTY,
    output: [] as string[],
    errors: [] as string[],
    clearCount: 0,
    finished: [] as number[],
    closed: 0,
    statuses: [] as string[],
    open: async () => undefined,
    question: async () => inputs.shift() ?? "/exit",
    confirm: async () => false,
    write: (line: string) => value.output.push(line),
    error: (line: string) => value.errors.push(line),
    clear: () => { value.clearCount += 1; },
    setStatus: (status: string) => value.statuses.push(status),
    finish: (exitCode: number) => value.finished.push(exitCode),
    close: () => { value.closed += 1; }
  };
  return value;
}

function fakeTtyStreams(): {
  input: PassThrough & { isTTY: boolean; setRawMode(enabled: boolean): void };
  output: PassThrough & { isTTY: boolean };
  errorOutput: PassThrough;
  rawModes: boolean[];
  outputText: () => string;
  errorText: () => string;
} {
  const rawModes: boolean[] = [];
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode(enabled: boolean): void };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  const errorOutput = new PassThrough();
  let text = "";
  let errorText = "";
  input.isTTY = true;
  input.setRawMode = (enabled) => { rawModes.push(enabled); };
  output.isTTY = true;
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); });
  errorOutput.on("data", (chunk: Buffer) => { errorText += chunk.toString(); });
  return { input, output, errorOutput, rawModes, outputText: () => text, errorText: () => errorText };
}

describe("interactive TUI", () => {
  it("renders an OpenCode-inspired welcome and footer with ShardCode data only", () => {
    const style = (text: string, tone: string) => "<" + tone + ">" + text + "</" + tone + ">";

    const welcome = renderTuiWelcome("/repo", info, "Run the tests", style).join("\n");
    const footer = renderTuiFooter("/repo", info, snapshot(), "waiting", style).join("\n");

    expect(welcome).toContain("ShardCode");
    expect(welcome).toContain("Run the tests");
    expect(welcome).toContain("/exit");
    expect(welcome).toContain("/quit");
    expect(footer).toContain("acceptEdits");
    expect(footer).toContain("scripted / scripted-local");
    expect(footer).toContain("/repo");
    expect(footer).toContain("abc-123");
    expect(footer).not.toMatch(/LSP|MCP|sidebar|workspace sessions/i);
  });

  it("keeps the session alive for local commands and a task", async () => {
    const terminal = fakeTerminal(["/model", "Implement OAuth", "/status", "/clear", "/exit"]);
    const requests: InteractiveTaskRequest[] = [];

    const result = await runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (request) => {
        requests.push(request);
        return { exitCode: 0, session: snapshot() };
      }
    });

    expect(result).toBe(0);
    expect(requests).toEqual([{ kind: "run", prompt: "Implement OAuth" }]);
    expect(terminal.clearCount).toBe(1);
    expect(terminal.finished).toEqual([0]);
    expect(terminal.closed).toBe(1);
  });

  it("renders topic-specific help and a complete generic command list", async () => {
    const terminal = fakeTerminal(["/help model", "/help", "/help quit", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async () => ({ exitCode: 0 })
    })).resolves.toBe(0);

    expect(terminal.output).toContain("/model [model] — show the active provider/model (read-only)");
    expect(terminal.output).toContain("/exit or /quit — leave the interactive TUI");
    expect(terminal.output.some((line) => line.includes("/exit") && line.includes("/quit"))).toBe(true);
  });

  it("bounds styled history by visible characters and keeps a complete reset", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);
    const prefix = "\u001b[38;2;224;108;117m";
    const reset = "\u001b[39m";
    terminal.style = (text) => `${prefix}${text}${reset}`;
    const longStyledLine = terminal.style("x".repeat(5_000), "error");

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onStyledOutput?.(longStyledLine);
        return { exitCode: 0 };
      }
    })).resolves.toBe(0);

    const outputLine = terminal.output.find((line) => line.startsWith(prefix) && line.length >= 4_000);
    expect(outputLine).toBeDefined();
    expect(outputLine).toMatch(/\u001b\[39m$/);
    expect(outputLine?.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")).toHaveLength(4_000);
  });

  it("closes an unterminated trusted foreground style before writing it", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);
    const styledOutput = "\u001b[31mleak";

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onStyledOutput?.(styledOutput);
        return { exitCode: 0 };
      }
    })).resolves.toBe(0);

    expect(terminal.output.filter((line) => line.includes("leak"))).toEqual(["\u001b[31mleak\u001b[39m"]);
  });

  it("closes and reopens trusted foreground styles around physical newlines", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onStyledOutput?.("\u001b[31mfirst\nsecond");
        return { exitCode: 0 };
      }
    })).resolves.toBe(0);

    const styledLines = terminal.output.filter((line) => line.includes("first") || line.includes("second"));
    expect(styledLines).toEqual(["\u001b[31mfirst\u001b[39m", "\u001b[31msecond\u001b[39m"]);
    expect(styledLines.every((line) => line.endsWith("\u001b[39m"))).toBe(true);
    expect(styledLines.every((line) => line.match(/\u001b\[39m/g)?.length === 1)).toBe(true);
  });

  it("consumes incomplete trusted CSI prefixes without exposing their suffix", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onStyledOutput?.("before\u001b[31");
        return { exitCode: 0 };
      }
    })).resolves.toBe(0);

    expect(terminal.output.filter((line) => line.includes("before"))).toEqual(["before"]);
  });

  it("sanitizes hostile live execution output before writing it", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onOutput?.("live\u001b[2Jclear\u009b2Jc1\tfield\nnext");
        return { exitCode: 0 };
      }
    })).resolves.toBe(0);

    const output = terminal.output.join("");
    expect(output).not.toContain("\u001b[2J");
    expect(output).not.toContain("\u009b2J");
    expect(output).not.toContain("\t");
    expect(terminal.output.some((line) => line.includes("liveclearc1 field next"))).toBe(true);
  });

  it("sanitizes hostile legacy execution output before writing it", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async () => ({ exitCode: 0, output: ["legacy\u001b[2Jclear\u009b2Jc1\tfield\nnext"] })
    })).resolves.toBe(0);

    const output = terminal.output.join("");
    expect(output).not.toContain("\u001b[2J");
    expect(output).not.toContain("\u009b2J");
    expect(output).not.toContain("\t");
    expect(terminal.output.some((line) => line.includes("legacyclearc1 field next"))).toBe(true);
  });

  it("shows live output and the running footer before execution completes", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const execution = runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onOutput?.("live event");
        started?.();
        await new Promise<void>((resolve) => { release = resolve; });
        return { exitCode: 0, session: snapshot() };
      }
    });

    await new Promise<void>((resolve) => { started = resolve; });

    expect(terminal.output).toContain("live event");
    expect(terminal.output.some((line) => line.includes("Status:") && line.includes("running"))).toBe(true);

    release?.();
    await expect(execution).resolves.toBe(0);
  });

  it("accepts legacy buffered output without duplicating live output", async () => {
    const terminal = fakeTerminal(["Run the checks", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        callbacks?.onOutput?.("shared output");
        return { exitCode: 0, session: snapshot(), output: ["shared output"] };
      }
    })).resolves.toBe(0);

    expect(terminal.output.filter((line) => line === "shared output")).toHaveLength(1);
  });

  it("retains the effective resumed provider, model, permissions, and aborted status", async () => {
    const terminal = fakeTerminal(["/resume saved-session", "/model", "/permissions", "/status", "/exit"]);

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async () => ({
        exitCode: 130,
        provider: "anthropic",
        model: "saved-model",
        permissionMode: "ask",
        session: { sessionId: "saved-session", status: "aborted" }
      })
    })).resolves.toBe(130);

    const output = terminal.output.join("\n");
    expect(output).toContain("Model: anthropic / saved-model");
    expect(output).toContain("Permissions: ask");
    expect(output).toContain("Status: aborted");
    expect(output).not.toContain("Status: failed");
  });

  it("fails closed without a TTY and never calls the executor", async () => {
    const terminal = fakeTerminal([], false);
    let executed = false;

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async () => {
        executed = true;
        return { exitCode: 0 };
      }
    })).resolves.toBe(1);

    expect(executed).toBe(false);
    expect(terminal.errors.join("\n")).toContain("TTY");
  });

  it("preserves lines pasted after a masked secret", () => {
    expect(secretInputRemainder("secret-key\r\n1\n/exit\n")).toEqual(["1", "/exit"]);
    expect(secretInputRemainder("secret-key")).toBeUndefined();
  });

  it("masks raw secret input and queues pasted lines without echoing the secret", async () => {
    const streams = fakeTtyStreams();
    const terminal = createDefaultTuiTerminal({ ...streams, env: {} });

    const secret = terminal.secret("Token: ");
    streams.input.write("secret-key\r\n1\n/exit\n");

    await expect(secret).resolves.toBe("secret-key");
    expect(streams.rawModes).toEqual([true, false]);
    expect(streams.outputText()).toContain("**********");
    expect(streams.outputText()).not.toContain("secret-key");
    await expect(terminal.question("> ")).resolves.toBe("1");
    await expect(terminal.question("> ")).resolves.toBe("/exit");
    terminal.close();
  });

  it("sanitizes and warns on confirmation labels without styling the decision suffix", async () => {
    const streams = fakeTtyStreams();
    const terminal = createDefaultTuiTerminal({ ...streams, env: { COLORTERM: "truecolor" } });

    const confirmed = terminal.confirm("\u001b[31mrun_shell: pnpm test\u001b[0m");
    streams.input.write("y\n");

    await expect(confirmed).resolves.toBe(true);
    expect(streams.outputText()).toContain("\u001b[38;2;245;167;66mrun_shell: pnpm test\u001b[39m [y/N] ");
    expect(streams.outputText()).not.toContain("\u001b[31m");
    terminal.close();
  });

  it("keeps LF and tab out of the default confirmation display", async () => {
    const streams = fakeTtyStreams();
    const terminal = createDefaultTuiTerminal({ ...streams, env: {} });
    const confirmed = terminal.confirm("run_shell: node\n\t-e hostile\n\treason");
    streams.input.write("y\n");

    await expect(confirmed).resolves.toBe(true);
    expect(streams.outputText()).not.toContain("\n");
    expect(streams.outputText()).not.toContain("\t");
    terminal.close();
  });

  it("uses plain styling when output is not a TTY", () => {
    const streams = fakeTtyStreams();
    streams.output.isTTY = false;
    const terminal = createDefaultTuiTerminal({ ...streams, env: { COLORTERM: "truecolor" } });

    expect(terminal.isTTY).toBe(false);
    expect(terminal.style?.("ShardCode", "primary")).toBe("ShardCode");
    terminal.close();
  });

  it("preserves trusted TUI styling through history while stripping hostile event ANSI", async () => {
    const streams = fakeTtyStreams();
    const terminal = createDefaultTuiTerminal({ ...streams, env: { COLORTERM: "truecolor" } });
    const inputs = ["Run the checks", "/exit"];
    terminal.question = async () => inputs.shift() ?? "/exit";
    const eventLines: string[] = [];

    terminal.write("\u001b[39mraw-reset");
    terminal.error("\u001b[39mraw-error-reset");
    expect(streams.outputText()).toBe("raw-reset\n");
    expect(streams.errorText()).toBe("raw-error-reset\n");

    renderEvent(
      createEvent("session-1", "ToolFailed", {
        result: { output: "\u001b[31mrm -rf\u001b[0m\nfailed" }
      }),
      (line) => eventLines.push(line),
      false,
      terminal.style ? { style: terminal.style } : undefined
    );

    await expect(runInteractiveTui({
      terminal,
      workspaceRoot: "/repo",
      info,
      execute: async (_request, callbacks) => {
        for (const eventLine of eventLines) callbacks?.onStyledOutput?.(eventLine);
        return { exitCode: 0 };
      }
    })).resolves.toBe(0);

    const output = streams.outputText();
    expect(output).toContain("\u001b[38;2;250;178;131mShardCode\u001b[39m");
    expect(output).toContain("\u001b[38;2;224;108;117mÉchec : rm -rf\u001b[39m\n\u001b[38;2;224;108;117mfailed\u001b[39m");
    expect(output).not.toContain("\u001b[31m");
    terminal.close();
  });

  it("restores raw mode when secret input is cancelled or the terminal closes", async () => {
    const streams = fakeTtyStreams();
    const terminal = createDefaultTuiTerminal({ ...streams, env: {} });

    const cancelled = terminal.secret("Token: ");
    streams.input.write("\u0003");
    await expect(cancelled).resolves.toBeUndefined();

    const closing = terminal.secret("Token: ");
    terminal.close();
    await expect(closing).resolves.toBeUndefined();
    expect(streams.rawModes).toEqual([true, false, true, false]);
  });
});
