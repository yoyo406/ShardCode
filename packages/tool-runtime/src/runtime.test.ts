import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ToolRuntime } from "./runtime.js";

describe("tool runtime definitions", () => {
  it("exposes the V1 repository tool set", async () => {
    const root = await mkdtemp(join(tmpdir(), "shardcode-definitions-"));
    const runtime = new ToolRuntime({ workspaceRoot: root, mode: "ask" });
    const names = runtime.definitions().map((definition) => definition.name);

    expect(names).toEqual([
      "read_file",
      "write_file",
      "edit_file",
      "delete_file",
      "list_files",
      "glob",
      "grep",
      "run_shell",
      "git_status",
      "git_diff",
      "git_log"
    ]);
  });
});
