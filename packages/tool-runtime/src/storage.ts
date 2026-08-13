import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StorageAdapter } from "@shardcode/shared";

export class FileStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private path(value: string): string {
    const absolute = resolve(this.root, value);
    const relative = absolute.slice(resolve(this.root).length);
    if (relative.startsWith("..") || relative.includes(`${requireSeparator()}..`)) {
      throw new Error("storage path escapes root");
    }
    return absolute;
  }

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(this.path(path), "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const target = this.path(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async append(path: string, content: string): Promise<void> {
    const target = this.path(path);
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, content, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    return (await this.read(path)) !== undefined;
  }
}

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/";
}
