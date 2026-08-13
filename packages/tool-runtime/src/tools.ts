import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolDefinition } from "@shardcode/shared";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: "read_file", description: "Read a UTF-8 file in the workspace.", risk: "read", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Create or replace a UTF-8 file in the workspace.", risk: "write", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "edit_file", description: "Replace one exact text range in a workspace file.", risk: "write", inputSchema: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] } },
  { name: "delete_file", description: "Delete a file in the workspace.", risk: "write", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "list_files", description: "List files below a workspace directory.", risk: "read", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "glob", description: "Find workspace files matching a glob pattern.", risk: "read", inputSchema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } },
  { name: "grep", description: "Search workspace text files with a regular expression.", risk: "read", inputSchema: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" }, ignoreCase: { type: "boolean" } }, required: ["pattern"] } },
  { name: "run_shell", description: "Run an approved shell command in the workspace sandbox.", risk: "shell", inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "git_status", description: "Show the current Git status.", risk: "git", inputSchema: { type: "object", properties: {} } },
  { name: "git_diff", description: "Show the current Git diff.", risk: "git", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "git_log", description: "Show recent Git history.", risk: "git", inputSchema: { type: "object", properties: { limit: { type: "number" } } } }
];

export interface InputRecord {
  [key: string]: unknown;
}

export function inputRecord(input: unknown): InputRecord {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as InputRecord) : {};
}

export function requiredString(input: InputRecord, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

export function stringValue(input: InputRecord, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

export async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (
      name === ".git" ||
      name === ".shardcode" ||
      name === "node_modules" ||
      name === "dist" ||
      name === "secrets" ||
      name === "secret" ||
      name === "credentials" ||
      name === ".env" ||
      name.startsWith(".env.")
    ) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function listWorkspaceFiles(root: string, directory: string): Promise<string[]> {
  const base = join(root, directory);
  const files = await walkFiles(root, base);
  return files.map((file) => file.slice(root.length + 1).replaceAll("\\", "/"));
}

export function globToRegExp(pattern: string): RegExp {
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*";
        index += 1;
      } else result += "[^/]*";
    } else if (char === "?") result += "[^/]";
    else result += (char ?? "").replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${result}$`);
}

export async function globWorkspace(root: string, pattern: string): Promise<string[]> {
  const matcher = globToRegExp(pattern.replaceAll("\\", "/"));
  const files = await walkFiles(root);
  return files
    .map((file) => file.slice(root.length + 1).replaceAll("\\", "/"))
    .filter((file) => matcher.test(file));
}

export async function grepWorkspace(root: string, pattern: string, directory = "", ignoreCase = false): Promise<string> {
  const expression = new RegExp(pattern, ignoreCase ? "i" : undefined);
  const files = await listWorkspaceFiles(root, directory);
  const matches: string[] = [];
  for (const file of files) {
    try {
      const content = await readFile(join(root, file), "utf8");
      content.split(/\r?\n/).forEach((line, index) => {
        if (expression.test(line)) matches.push(`${file}:${index + 1}:${line}`);
      });
    } catch {
      // Binary and unreadable files are ignored by the search tool.
    }
  }
  return matches.join("\n");
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export { readFile, rm, stat, writeFile };
