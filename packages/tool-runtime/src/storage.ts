import { appendFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { StorageAdapter } from "@shardcode/shared";

export class FileStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private async path(value: string): Promise<string> {
    const root = resolve(this.root);
    const absolute = resolve(root, value);
    const relativePath = relative(root, absolute);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error("storage path escapes root");
    }

    let current = absolute;
    while (true) {
      try {
        if ((await lstat(current)).isSymbolicLink()) throw new Error("symbolic links are not allowed in storage paths");
      } catch (error) {
        if (error instanceof Error && error.message === "symbolic links are not allowed in storage paths") throw error;
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
      if (current === root) break;
      const parent = resolve(current, "..");
      if (parent === current) throw new Error("storage path has no root");
      current = parent;
    }
    return absolute;
  }

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(await this.path(path), "utf8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const target = await this.path(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async append(path: string, content: string): Promise<void> {
    const target = await this.path(path);
    await mkdir(dirname(target), { recursive: true });
    await appendFile(target, content, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    return (await this.read(path)) !== undefined;
  }
}
