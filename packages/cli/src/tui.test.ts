import { PassThrough } from "node:stream";
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
} {
  const rawModes: boolean[] = [];
  const input = new PassThrough() as PassThrough & { isTTY: boolean; setRawMode(enabled: boolean): void };
  const output = new PassThrough() as PassThrough & { isTTY: boolean };
  const errorOutput = new PassThrough();
  let text = "";
  input.isTTY = true;
  input.setRawMode = (enabled) => { rawModes.push(enabled); };
  output.isTTY = true;
  output.on("data", (chunk: Buffer) => { text += chunk.toString(); });
  return { input, output, errorOutput, rawModes, outputText: () => text };
}

describe("interactive TUI", () => {
  it("renders an OpenCode-inspired welcome and footer with ShardCode data only", () => {
    const style = (text: string, tone: string) => "<" + tone + ">" + text + "</" + tone + ">";

    const welcome = renderTuiWelcome("/repo", info, "Run the tests", style).join("\n");
    const footer = renderTuiFooter("/repo", info, snapshot(), "waiting", style).join("\n");

    expect(welcome).toContain("ShardCode");
    expect(welcome).toContain("Run the tests");
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
