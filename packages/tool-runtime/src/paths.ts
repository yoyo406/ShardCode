import { dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

export interface WorkspacePath {
  absolute: string;
  relative: string;
  withinWorkspace: boolean;
  protected: boolean;
}

function isProtectedRelativePath(value: string): boolean {
  const segments = value.split(/[\\/]+/).filter(Boolean);
  const first = segments[0]?.toLowerCase();
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  return (
    first === ".git" ||
    first === "secrets" ||
    first === "secret" ||
    first === "credentials" ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    value === ".shardcode/settings.local.json"
  );
}

export function resolveWorkspacePath(workspaceRoot: string, requested: string): WorkspacePath {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, requested);
  const relativePath = relative(root, absolute).split(sep).join("/");
  const physicalRoot = existingRealPath(root);
  const physicalTarget = existingRealPath(absolute);
  const physicalRelative = relative(physicalRoot, physicalTarget);
  const lexicalWithinWorkspace = relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  const physicalWithinWorkspace = physicalRelative === "" || (!physicalRelative.startsWith("..") && !isAbsolute(physicalRelative));
  const withinWorkspace = lexicalWithinWorkspace && physicalWithinWorkspace;
  return {
    absolute,
    relative: relativePath,
    withinWorkspace,
    protected: !withinWorkspace || isProtectedRelativePath(relativePath)
  };
}

function existingRealPath(value: string): string {
  let current = value;
  while (true) {
    try {
      return realpathSync.native(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(value);
      current = parent;
    }
  }
}

export function normalizeRulePath(value: string): string {
  return normalize(value).split(sep).join("/").replace(/^\.\//, "");
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
