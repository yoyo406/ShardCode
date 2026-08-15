import { chmod, readFile, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { StoredProviderConnection } from "@shardcode/shared";
import { ProviderStore } from "./provider-store.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "shardcode-provider-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function connection(providerId: StoredProviderConnection["providerId"], verification: StoredProviderConnection["verification"] = "verified"): StoredProviderConnection {
  return {
    providerId,
    apiKey: `${providerId}-secret`,
    modelId: `${providerId}-model`,
    protocol: providerId === "google-gemini" ? "gemini" : "openai-chat",
    verification,
    updatedAt: "2026-08-13T00:00:00.000Z"
  };
}

describe("ProviderStore", () => {
  it("stores connections outside the workspace with restrictive permissions", async () => {
    const configHome = await temporaryDirectory();
    const store = new ProviderStore({ env: { SHARDCODE_CONFIG_HOME: configHome }, platform: "linux" });

    await store.save(connection("openai"));

    const directoryMode = (await stat(configHome)).mode & 0o777;
    const fileMode = (await stat(store.filePath)).mode & 0o777;
    expect(directoryMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    expect(JSON.parse(await readFile(store.filePath, "utf8"))).toMatchObject({ activeProviderId: "openai" });
    expect(await store.loadActive()).toMatchObject({ providerId: "openai", apiKey: "openai-secret" });
  });

  it("merges providers, replaces the selected provider, and marks it active", async () => {
    const configHome = await temporaryDirectory();
    const store = new ProviderStore({ env: { SHARDCODE_CONFIG_HOME: configHome }, platform: "linux" });

    await store.save(connection("openai"));
    await store.save(connection("mistral", "unverified"));
    await store.save({ ...connection("openai"), apiKey: "rotated-secret", modelId: "new-model" });

    const config = await store.load();
    expect(config.activeProviderId).toBe("openai");
    expect(config.connections).toHaveLength(2);
    expect(config.connections.find((item) => item.providerId === "openai")).toMatchObject({
      apiKey: "rotated-secret",
      modelId: "new-model"
    });

    await store.markVerified("mistral");
    expect((await store.load()).connections.find((item) => item.providerId === "mistral")?.verification).toBe("verified");
  });

  it("supports platform-specific defaults and an explicit config override", async () => {
    const home = await temporaryDirectory();
    const windowsStore = new ProviderStore({ env: { APPDATA: join(home, "appdata") }, platform: "win32", homeDir: home });
    const macStore = new ProviderStore({ env: {}, platform: "darwin", homeDir: home });
    const linuxStore = new ProviderStore({ env: { XDG_CONFIG_HOME: join(home, "xdg") }, platform: "linux", homeDir: home });

    expect(windowsStore.filePath).toBe(join(home, "appdata", "ShardCode", "connections.json"));
    expect(macStore.filePath).toBe(join(home, "Library", "Application Support", "ShardCode", "connections.json"));
    expect(linuxStore.filePath).toBe(join(home, "xdg", "shardcode", "connections.json"));
  });

  it("rejects a symlinked config file", async () => {
    const configHome = await temporaryDirectory();
    const store = new ProviderStore({ env: { SHARDCODE_CONFIG_HOME: configHome }, platform: "linux" });
    await store.save(connection("openai"));
    const target = `${store.filePath}.target`;
    await chmod(store.filePath, 0o600);
    const { symlink, writeFile: write } = await import("node:fs/promises");
    await write(target, "{}");
    await rm(store.filePath);
    await symlink(target, store.filePath);

    await expect(store.load()).rejects.toThrow("symbolic link");
  });

  it("repairs permissive permissions on an existing config file", async () => {
    const configHome = await temporaryDirectory();
    const store = new ProviderStore({ env: { SHARDCODE_CONFIG_HOME: configHome }, platform: "linux" });

    await store.save(connection("openai"));
    await chmod(store.filePath, 0o644);

    await expect(store.load()).resolves.toMatchObject({ activeProviderId: "openai" });
    expect((await stat(store.filePath)).mode & 0o777).toBe(0o600);
  });
});
