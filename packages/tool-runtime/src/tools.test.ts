import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProcessSandbox } from "@shardcode/sandbox";
import { ToolRuntime } from "./runtime.js";
import { FileStorage } from "./storage.js";

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

  it("denies attempts to write protected files", async () => {
    const root = await workspace();
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "acceptEdits" });

    const result = await runtime.execute({ id: "secret-1", name: "write_file", input: { path: ".env", content: "SECRET=x" } });
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
});
