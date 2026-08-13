import { ProviderError } from "@shardcode/shared";
import type { AvailableModel } from "@shardcode/shared";
import { asArray, asRecord, asString, type FetchFunction } from "./provider.js";
import {
  getProviderDefinition,
  PROVIDER_CATALOG,
  staticModelsFor,
  type ConnectableProviderId
} from "./catalog.js";

export interface DiscoveryOptions {
  fetch?: FetchFunction;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  models: AvailableModel[];
  verification: "verified" | "unverified";
}

const DISCOVERY_TIMEOUT_MS = 10_000;

function modelIdFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value.replace(/^models\//, "");
  const record = asRecord(value);
  const id = asString(record.id) ?? asString(record.name);
  return id?.replace(/^models\//, "");
}

function modelLabelFrom(value: unknown, modelId: string): string {
  const record = asRecord(value);
  return asString(record.display_name) ?? asString(record.displayName) ?? asString(record.name)?.replace(/^models\//, "") ?? modelId;
}

function modelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  for (const key of ["data", "models", "items"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  if (modelIdFrom(record)) return [record];
  return Object.entries(record)
    .filter(([, value]) => typeof value === "object" && value !== null)
    .map(([id, value]) => {
      const entry = asRecord(value);
      return { ...entry, id: modelIdFrom(entry) ?? id };
    });
}

function errorMessage(body: unknown, providerLabel: string, status: number): string {
  const record = asRecord(body);
  const nestedError = asRecord(record.error);
  return asString(nestedError.message) ?? asString(record.message) ?? `${providerLabel} model discovery failed (${status})`;
}

async function fetchDiscoveryPage(
  fetcher: FetchFunction,
  url: string,
  headers: Record<string, string>,
  providerLabel: string,
  signal: AbortSignal
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, { method: "GET", headers, signal });
  } catch (error) {
    throw new ProviderError(`${providerLabel} model discovery failed`, { retryable: true, cause: error });
  }

  const text = await response.text();
  let body: unknown = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch (error) {
      throw new ProviderError(`${providerLabel} returned invalid model data`, {
        retryable: false,
        statusCode: response.status,
        cause: error
      });
    }
  }
  if (!response.ok) {
    throw new ProviderError(errorMessage(body, providerLabel, response.status), {
      retryable: response.status === 429 || response.status >= 500,
      statusCode: response.status
    });
  }
  return body;
}

function discoverySignal(externalSignal: AbortSignal | undefined): { signal: AbortSignal; dispose: () => void } {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), DISCOVERY_TIMEOUT_MS);
  if (!externalSignal) return { signal: timeoutController.signal, dispose: () => clearTimeout(timeout) };

  const combinedController = new AbortController();
  const abort = () => combinedController.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  timeoutController.signal.addEventListener("abort", abort, { once: true });
  return {
    signal: combinedController.signal,
    dispose: () => {
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", abort);
      timeoutController.signal.removeEventListener("abort", abort);
    }
  };
}

function toAvailableModels(
  providerId: ConnectableProviderId,
  entries: unknown[]
): AvailableModel[] {
  const definition = getProviderDefinition(providerId);
  const models: AvailableModel[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (providerId === "google-gemini") {
      const supportedMethods = asRecord(entry).supportedGenerationMethods;
      if (Array.isArray(supportedMethods) && !supportedMethods.includes("generateContent")) continue;
    }
    const id = modelIdFrom(entry);
    if (!id || seen.has(id) || definition.modelFilter?.(id) === false) continue;
    seen.add(id);
    const label = modelLabelFrom(entry, id);
    models.push({ id, label, providerId, ...definition.modelDetails(id, label) });
  }
  return models;
}

export async function discoverModels(
  providerId: ConnectableProviderId,
  apiKey: string,
  options: DiscoveryOptions = {}
): Promise<DiscoveryResult> {
  const definition = getProviderDefinition(providerId);
  if (definition.discovery === "catalog") {
    return { models: staticModelsFor("cline"), verification: "unverified" };
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  const endpoint = definition.modelsEndpoint;
  if (!endpoint) throw new ProviderError(`${definition.label} has no model discovery endpoint`, { retryable: false });

  const { signal, dispose } = discoverySignal(options.signal);
  try {
    const models: AvailableModel[] = [];
    let nextUrl: string | undefined = endpoint;
    for (let page = 0; nextUrl && page < 20; page += 1) {
      const payload = await fetchDiscoveryPage(fetcher, nextUrl, definition.requestHeaders(apiKey), definition.label, signal);
      models.push(...toAvailableModels(providerId, modelEntries(payload)));
      if (providerId !== "anthropic-claude") break;
      const record = asRecord(payload);
      if (record.has_more !== true) break;
      const lastId = asString(record.last_id);
      nextUrl = lastId ? `${endpoint}?after_id=${encodeURIComponent(lastId)}` : undefined;
    }
    return { models, verification: providerId === "kilo-code" ? "unverified" : "verified" };
  } finally {
    dispose();
  }
}

export { getProviderDefinition, PROVIDER_CATALOG };
