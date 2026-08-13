import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

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
  const withinWorkspace = relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
  return {
    absolute,
    relative: relativePath,
    withinWorkspace,
    protected: !withinWorkspace || isProtectedRelativePath(relativePath)
  };
}

export function normalizeRulePath(value: string): string {
  return normalize(value).split(sep).join("/").replace(/^\.\//, "");
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
