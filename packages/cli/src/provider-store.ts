import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  ProviderConfigFile,
  ProviderId,
  ProviderProtocol,
  StoredProviderConnection
} from "@shardcode/shared";

export interface ProviderStoreOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

const PROVIDER_IDS = new Set<ProviderId>([
  "openai",
  "openai-codex",
  "google-gemini",
  "mistral",
  "anthropic-claude",
  "opencode-zen",
  "opencode-go",
  "cline",
  "kilo-code",
  "anthropic",
  "gemini",
  "scripted"
]);

const PROTOCOLS = new Set<ProviderProtocol>([
  "openai-chat",
  "openai-responses",
  "gemini",
  "anthropic",
  "mistral",
  "gateway"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`invalid provider config: ${field}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseConnection(value: unknown): StoredProviderConnection {
  if (!isRecord(value) || typeof value.providerId !== "string" || !PROVIDER_IDS.has(value.providerId as ProviderId)) {
    throw new Error("invalid provider config: providerId");
  }
  if (typeof value.protocol !== "string" || !PROTOCOLS.has(value.protocol as ProviderProtocol)) {
    throw new Error("invalid provider config: protocol");
  }
  const baseUrl = optionalString(value.baseUrl);
  return {
    providerId: value.providerId as ProviderId,
    apiKey: requiredString(value.apiKey, "apiKey"),
    modelId: requiredString(value.modelId, "modelId"),
    protocol: value.protocol as ProviderProtocol,
    ...(baseUrl ? { baseUrl } : {}),
    verification: value.verification === "verified" || value.verification === "unverified"
      ? value.verification
      : (() => { throw new Error("invalid provider config: verification"); })(),
    updatedAt: requiredString(value.updatedAt, "updatedAt")
  };
}

function parseConfig(value: unknown): ProviderConfigFile {
  if (!isRecord(value) || !Array.isArray(value.connections)) throw new Error("invalid provider config file");
  const activeProviderId = optionalString(value.activeProviderId);
  if (activeProviderId && (!PROVIDER_IDS.has(activeProviderId as ProviderId))) {
    throw new Error("invalid provider config: activeProviderId");
  }
  return {
    ...(activeProviderId ? { activeProviderId: activeProviderId as ProviderId } : {}),
    connections: value.connections.map(parseConnection)
  };
}

function defaultConfigDirectory(options: ProviderStoreOptions): string {
  const env = options.env ?? process.env;
  if (env.SHARDCODE_CONFIG_HOME) return resolve(env.SHARDCODE_CONFIG_HOME);
  const home = options.homeDir ?? env.HOME ?? homedir();
  switch (options.platform ?? process.platform) {
    case "win32":
      return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "ShardCode");
    case "darwin":
      return join(home, "Library", "Application Support", "ShardCode");
    default:
      return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "shardcode");
  }
}

async function ensureDirectory(directory: string): Promise<void> {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error("provider config directory cannot be a symbolic link");
    if (!info.isDirectory()) throw new Error("provider config path is not a directory");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

async function rejectSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("provider config file cannot be a symbolic link");
  } catch (error) {
    if (error instanceof Error && error.message === "provider config file cannot be a symbolic link") throw error;
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

export class ProviderStore {
  readonly directory: string;
  readonly filePath: string;

  constructor(options: ProviderStoreOptions = {}) {
    this.directory = defaultConfigDirectory(options);
    this.filePath = join(this.directory, "connections.json");
  }

  async load(): Promise<ProviderConfigFile> {
    await ensureDirectory(this.directory);
    await rejectSymlink(this.filePath);
    let content: string;
    try {
      content = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { connections: [] };
      throw error;
    }
    await chmod(this.filePath, 0o600);
    try {
      return parseConfig(JSON.parse(content) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("provider config file contains invalid JSON", { cause: error });
      throw error;
    }
  }

  async loadActive(): Promise<StoredProviderConnection | undefined> {
    const config = await this.load();
    if (!config.activeProviderId) return undefined;
    return config.connections.find((connection) => connection.providerId === config.activeProviderId);
  }

  async save(connection: StoredProviderConnection): Promise<void> {
    if (!connection.apiKey) throw new Error("provider API key cannot be empty");
    const current = await this.load();
    const connections = [
      ...current.connections.filter((item) => item.providerId !== connection.providerId),
      connection
    ];
    await this.write({ activeProviderId: connection.providerId, connections });
  }

  async markVerified(providerId: ProviderId): Promise<void> {
    const current = await this.load();
    let found = false;
    const connections = current.connections.map((connection) => {
      if (connection.providerId !== providerId) return connection;
      found = true;
      return { ...connection, verification: "verified" as const, updatedAt: new Date().toISOString() };
    });
    if (!found) throw new Error(`no stored connection for ${providerId}`);
    await this.write({
      ...(current.activeProviderId ? { activeProviderId: current.activeProviderId } : {}),
      connections
    });
  }

  private async write(config: ProviderConfigFile): Promise<void> {
    await ensureDirectory(this.directory);
    await rejectSymlink(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
