import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProcessSandbox } from "@shardcode/sandbox";
import { ToolRuntime } from "./runtime.js";
import { FileStorage } from "./storage.js";
<<<<<<< HEAD
import { globToRegExp } from "./tools.js";
=======
import { globWorkspace } from "./tools.js";
>>>>>>> origin/main

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shardcode-tools-"));
  await writeFile(join(root, "README.md"), "ShardCode\n");
  return root;
}

describe("repository tools", () => {
  it("reads and writes through the permission boundary", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });

    const read = await runtime.execute({ id: "read-1", name: "read_file", input: { path: "README.md" } });
    expect(read.status).toBe("completed");
    expect(read.output).toContain("ShardCode");

    const write = await runtime.execute({ id: "write-1", name: "write_file", input: { path: "src/main.ts", content: "export {};\n" } });
    expect(write.status).toBe("completed");
    await expect(readFile(join(root, "src/main.ts"), "utf8")).resolves.toBe("export {};\n");
  });

  it("returns a failed shell result without retrying it", async () => {
    const root = await workspace();
    let executions = 0;
    const runtime = new ToolRuntime({
      workspaceRoot: root,
      mode: "acceptEdits",
      sandbox: createProcessSandbox({
        isolated: true,
        executor: async () => {
          executions += 1;
          return { stdout: "", stderr: "command failed", exitCode: 2 };
        }
      }),
      ask: async () => true
    });

    const result = await runtime.execute({ id: "shell-1", name: "run_shell", input: { command: "false" } });
    expect(result.status).toBe("failed");
    expect(result.output).toContain("command failed");
    expect(result.exitCode).toBe(2);
    expect(executions).toBe(1);
  });

  it("fails closed for bypass when no isolated sandbox is injected", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({
      workspaceRoot: root,
      mode: "bypass",
      isolatedEnvironment: true
    });

    const result = await runtime.execute({
      id: "bypass-without-sandbox",
      name: "run_shell",
      input: { command: "printf unsafe" }
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("TOOL_EXECUTION_FAILED");
    expect(result.output).toContain("process sandbox is unavailable");
  });

  it("denies attempts to write protected files", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });

    const result = await runtime.execute({ id: "secret-1", name: "write_file", input: { path: ".env", content: "SECRET=x" } });
    expect(result.status).toBe("denied");
    expect(result.error?.code).toBe("PERMISSION_DENIED");

    const nested = await runtime.execute({
      id: "nested-secret",
      name: "write_file",
      input: { path: "src/secrets/key.txt", content: "SECRET=x" }
    });
    expect(nested.status).toBe("denied");
  });

  it("denies workspace tools access to internal ShardCode state", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });

    const result = await runtime.execute({
      id: "internal-state",
      name: "write_file",
      input: { path: ".shardcode/sessions/session.json", content: "{}" }
    });

    expect(result.status).toBe("denied");
    expect(result.error?.code).toBe("PERMISSION_DENIED");
  });

  it("allows an empty file and keeps internal storage inside its root", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });
    const result = await runtime.execute({ id: "empty-1", name: "write_file", input: { path: "empty.txt", content: "" } });

    expect(result.status).toBe("completed");
    await expect(readFile(join(root, "empty.txt"), "utf8")).resolves.toBe("");
    const storage = new FileStorage(join(root, ".shardcode"));
    await expect(storage.write("../escape.txt", "bad")).rejects.toThrow("escapes root");
  });

  it("matches direct and nested files with a double-star glob", async () => {
    const root = await workspace();
    await writeFile(join(root, "index.ts"), "export {};\n");
    await writeFile(join(root, "nested.ts"), "export {};\n");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "src", "lib"), { recursive: true }));
    await writeFile(join(root, "src", "index.ts"), "export {};\n");
    await writeFile(join(root, "src", "lib", "nested.ts"), "export {};\n");

    await expect(globWorkspace(root, "src/**/*.ts")).resolves.toEqual(["src/index.ts", "src/lib/nested.ts"]);
  });

  it("fails closed for shell execution without an explicit sandbox", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits", ask: async () => true });

    const result = await runtime.execute({ id: "shell-default", name: "run_shell", input: { command: "node -e \"process.exit(0)\"" } });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("process sandbox is unavailable");
  });

  it("denies file operations through symlinks escaping the workspace", async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), "shardcode-outside-"));
    await symlink(outside, join(root, "linked"));
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });

    const result = await runtime.execute({ id: "symlink-escape", name: "write_file", input: { path: "linked/escaped.txt", content: "outside" } });

    expect(["denied", "failed"]).toContain(result.status);
    await expect(readFile(join(outside, "escaped.txt"), "utf8")).rejects.toThrow();
  });

  it("does not follow a workspace symlink to read or write outside the workspace", async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), "shardcode-outside-"));
    await writeFile(join(outside, "target.txt"), "outside");
    await symlink(join(outside, "target.txt"), join(root, "link.txt"));
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });

    const read = await runtime.execute({ id: "symlink-read", name: "read_file", input: { path: "link.txt" } });
    const write = await runtime.execute({ id: "symlink-write", name: "write_file", input: { path: "link.txt", content: "changed" } });

    expect(["denied", "failed"]).toContain(read.status);
    expect(["denied", "failed"]).toContain(write.status);
    await expect(readFile(join(outside, "target.txt"), "utf8")).resolves.toBe("outside");
  });

  it("does not write session storage through a symlinked storage root", async () => {
    const root = await workspace();
    const outside = await mkdtemp(join(tmpdir(), "shardcode-storage-outside-"));
    await symlink(outside, join(root, ".shardcode"));
    const storage = new FileStorage(join(root, ".shardcode"));

    await expect(storage.write("sessions/session.json", "secret")).rejects.toThrow("symbolic links");
    await expect(readFile(join(outside, "sessions", "session.json"), "utf8")).rejects.toThrow();
  });

  it("does not enumerate protected environment and secret files", async () => {
    const root = await workspace();
    await writeFile(join(root, ".env"), "TOKEN=do-not-read");
    await writeFile(join(root, ".env.local"), "TOKEN=do-not-read");
    await mkdir(join(root, "secrets"));
    await writeFile(join(root, "secrets", "key.txt"), "do-not-read");
    await mkdir(join(root, "credentials"));
    await writeFile(join(root, "credentials", "key.txt"), "do-not-read");
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(join(root, "config", "secrets.json"), "do-not-read");
    await mkdir(join(root, "src", ".git"), { recursive: true });
    await writeFile(join(root, "src", ".git", "config"), "do-not-read");
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "ask" });

    const listed = await runtime.execute({ id: "list-safe", name: "list_files", input: {} });
    const searched = await runtime.execute({ id: "grep-safe", name: "grep", input: { pattern: "do-not-read" } });
    const matched = await runtime.execute({ id: "glob-safe", name: "glob", input: { pattern: "**/*" } });

    expect(listed.output).not.toContain(".env");
    expect(listed.output).not.toContain("secrets/");
    expect(listed.output).not.toContain("config/secrets.json");
    expect(listed.output).not.toContain(".git/");
    expect(searched.output).toBe("");
    expect(matched.output).not.toContain("credentials/");
    expect(matched.output).not.toContain("config/secrets.json");
    expect(matched.output).not.toContain(".git/");
  });

  it("propagates cancellation and bounds command output", async () => {
    const root = await workspace();
    let receivedSignal: AbortSignal | undefined;
    const runtime = new ToolRuntime({
      workspaceRoot: root,
      mode: "acceptEdits",
      maxOutputChars: 1_000,
      ask: async () => true,
      sandbox: createProcessSandbox({
        isolated: true,
        executor: async (request) => {
          receivedSignal = request.signal;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { stdout: "x".repeat(2_000), stderr: "", exitCode: 0 };
        }
      })
    });
    const controller = new AbortController();
    const result = await runtime.execute({ id: "shell-2", name: "run_shell", input: { command: "long-output" } }, controller.signal);

    expect(receivedSignal).toBe(controller.signal);
    expect(result.status).toBe("completed");
    expect(result.output.length).toBeLessThanOrEqual(1_000);
    expect(result.output).toContain("output tronqué");
  });

  it("matches root-level files with a globstar pattern", () => {
    expect(globToRegExp("**/*.md").test("README.md")).toBe(true);
    expect(globToRegExp("**/*.md").test("docs/ARCHITECTURE.md")).toBe(true);
  });
});
