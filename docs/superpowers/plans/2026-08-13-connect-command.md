# `/connect` Provider Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure interactive `/connect` flow that configures all nine requested AI providers, discovers/selects models, and makes the selected connection available to ShardCode runtime tasks.

**Architecture:** Extend the shared provider contract with stable provider IDs, protocols, and normalized model metadata. Add a provider registry/discovery layer with native adapters and a generic OpenAI-compatible adapter, then connect it to a user-scoped credential store and an asynchronous TUI modal flow. Keep slash parsing local and inject the network/configuration operation into the TUI.

**Tech Stack:** TypeScript, Node.js `fetch`, Vitest, existing `@shardcode/shared`, `@shardcode/providers`, `@shardcode/cli`, terminal TUI abstractions.

## Global Constraints

- `/connect` takes no arguments and remains local to the TUI; it must never become a model prompt.
- API keys are user-scoped and must never be written to the workspace, `.shardcode`, session events, JSONL output, logs, or terminal snapshots.
- Native model-list requests use a bounded timeout and one request only; no setup probe may invoke a paid completion.
- Cline and Kilo connections are persisted as `unverified` and become `verified` only after a successful real completion.
- `scripted` remains available for deterministic tests but is not shown in the `/connect` provider menu.
- Existing slash commands, provider normalization, sandbox boundaries, session persistence, build, test, lint, and CLI smoke behavior must remain green.
- Use test-first cycles: write one failing test, run it, implement the minimum, rerun the focused test, then run the affected package tests.

---

### Task 1: Expand shared provider and model contracts

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/shared/src/contracts.test.ts`
- Modify: `packages/providers/src/providers.test.ts`

**Interfaces:**
- Produce `ProviderId`, `ProviderProtocol`, `AvailableModel`, `StoredProviderConnection`, and `ProviderConfigFile` types exported from `@shardcode/shared`.
- Update `ProviderConfig.provider` to accept the nine configured provider IDs plus `scripted`.
- Add optional `protocol`, `baseUrl`, and `verification` fields to `ProviderConfig` without exposing credentials in events; persist `protocol` and `baseUrl` with the selected model.

- [ ] **Step 1: Write the failing contract test**

Add a test that constructs a `ProviderConfig` for `opencode-go`, an `AvailableModel` for `anthropic/claude-sonnet-4-6`, and a `StoredProviderConnection` marked `unverified`.

```ts
it("accepts all connect provider identities and normalized model metadata", () => {
  const config: ProviderConfig = {
    provider: "opencode-go",
    model: "anthropic/claude-sonnet-4-6",
    apiKey: "test-key",
    protocol: "gateway",
    verification: "unverified"
  };
  const model: AvailableModel = {
    id: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    providerId: "opencode-go",
    protocol: "gateway",
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    capabilities: { toolCalling: true }
  };
  expect(config.provider).toBe(model.providerId);
});
```

- [ ] **Step 2: Run the focused test and verify the expected type failure**

Run: `pnpm exec vitest run packages/shared/src/contracts.test.ts`

Expected: FAIL because the new provider IDs, protocol, and model types are not declared.

- [ ] **Step 3: Implement the minimal shared types**

Define the literal unions and interfaces in `contracts.ts`, preserve `ModelProvider.id: string` for compatibility, and keep `ProviderConfig.apiKey` optional for environment-based and scripted providers.

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `pnpm exec vitest run packages/shared/src/contracts.test.ts packages/providers/src/providers.test.ts && pnpm --filter @shardcode/shared build`

Expected: PASS with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/contracts.ts packages/shared/src/contracts.test.ts packages/providers/src/providers.test.ts
git commit -m "feat: add normalized provider connection contracts"
```

### Task 2: Add provider catalog and model discovery

**Files:**
- Create: `packages/providers/src/catalog.ts`
- Create: `packages/providers/src/discovery.ts`
- Create: `packages/providers/src/discovery.test.ts`
- Modify: `packages/providers/src/index.ts`
- Modify: `packages/providers/src/provider.ts`

**Interfaces:**
- Produce `PROVIDER_CATALOG`, `getProviderDefinition(providerId)`, and `discoverModels(providerId, apiKey, options?)`.
- `discoverModels` accepts `{ fetch?: FetchFunction; signal?: AbortSignal }` and returns `{ models: AvailableModel[]; verification: "verified" | "unverified" }`.
- Each provider definition contains display name, discovery URL, auth header builder, runtime protocol defaults, and model normalization rules.

- [ ] **Step 1: Write failing discovery tests for all HTTP-backed providers**

Use an injected fetch function and assert URL, headers, and normalized output for OpenAI, Codex, Gemini, Mistral, Anthropic, Zen, Go, and Kilo. Include Anthropic pagination and Gemini filtering to models supporting `generateContent`.

```ts
it("discovers Gemini models with the documented header and filters unsupported actions", async () => {
  let request: Request | undefined;
  const result = await discoverModels("google-gemini", "gemini-key", {
    fetch: async (input, init) => {
      request = new Request(input, init);
      return jsonResponse({
        models: [
          { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] }
        ]
      });
    }
  });
  expect(request?.headers.get("x-goog-api-key")).toBe("gemini-key");
  expect(result.models.map((model) => model.id)).toEqual(["gemini-2.5-flash"]);
  expect(result.verification).toBe("verified");
});
```

Add tests for Cline's bundled catalog and Kilo's `unverified` result without any completion request.

- [ ] **Step 2: Run the focused discovery tests and verify they fail for missing exports**

Run: `pnpm exec vitest run packages/providers/src/discovery.test.ts`

Expected: FAIL because the catalog/discovery modules do not exist.

- [ ] **Step 3: Implement catalog definitions and common fetch helpers**

Add a single `fetchJson` path that uses `AbortSignal.timeout(10_000)` when no signal is supplied, sends only provider-required headers, performs no retry for discovery, and maps 401/403/429/5xx/invalid JSON to a safe `ProviderError` message. Normalize OpenAI-shaped `data`, Gemini `models`, and Anthropic paginated `data` arrays.

Use these discovery endpoints and authentication rules:

```ts
openai:       GET https://api.openai.com/v1/models              Authorization: Bearer
google-gemini:GET https://generativelanguage.googleapis.com/v1beta/models x-goog-api-key
mistral:      GET https://api.mistral.ai/v1/models               Authorization: Bearer
anthropic:    GET https://api.anthropic.com/v1/models             x-api-key + anthropic-version
opencode-zen: GET https://opencode.ai/zen/v1/models               Authorization: Bearer
opencode-go:  GET https://opencode.ai/zen/go/v1/models            Authorization: Bearer
kilo-code:    GET https://api.kilo.ai/api/gateway/models          no auth required; key remains unverified
```

Filter `openai-codex` to model IDs containing `codex` or `coding`, preserve gateway-qualified IDs, infer OpenCode protocol from model-family prefixes, and return `verification: "unverified"` for Cline and Kilo.

- [ ] **Step 4: Implement the bundled Cline catalog**

Add documented representative model IDs using the `provider/model` format, including `anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `google/gemini-2.5-pro`, and `minimax/minimax-m2.5`. Keep the catalog isolated so it can be refreshed without changing slash or runtime code.

- [ ] **Step 5: Run focused tests and package lint**

Run: `pnpm exec vitest run packages/providers/src/discovery.test.ts && pnpm --filter @shardcode/providers lint`

Expected: PASS with all endpoint/header assertions covered.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/catalog.ts packages/providers/src/discovery.ts packages/providers/src/discovery.test.ts packages/providers/src/index.ts packages/providers/src/provider.ts
git commit -m "feat: add provider model discovery registry"
```

### Task 3: Implement runtime adapters for the nine providers

**Files:**
- Create: `packages/providers/src/openai-compatible.ts`
- Create: `packages/providers/src/responses.ts`
- Create: `packages/providers/src/gateway.ts`
- Create: `packages/providers/src/runtime-providers.test.ts`
- Modify: `packages/providers/src/openai.ts`
- Modify: `packages/providers/src/index.ts`

**Interfaces:**
- Produce `createOpenAICompatibleProvider(config)`, `createOpenAIResponsesProvider(config)`, and `createGatewayProvider(config)`.
- `createProvider(config)` dispatches by `config.provider` and `config.protocol`, while preserving existing `createOpenAIProvider`, `createAnthropicProvider`, `createGeminiProvider`, and scripted behavior.

- [ ] **Step 1: Write failing adapter tests**

Test a normalized tool call through Mistral, Cline, and Kilo-compatible Chat Completions; a Responses API function call for OpenAI Codex; Gemini and Anthropic gateway family routing; and preservation of provider/model IDs in `ModelProvider`.

```ts
it("routes a Kilo model through the documented OpenAI-compatible gateway", async () => {
  let url = "";
  const provider = createProvider({
    provider: "kilo-code",
    model: "anthropic/claude-sonnet-4.5",
    apiKey: "kilo-key",
    baseUrl: "https://api.kilo.ai/api/gateway/chat/completions",
    protocol: "gateway",
    fetch: async (input) => {
      url = String(input);
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }] });
    }
  });
  await expect(provider.complete(request)).resolves.toMatchObject({ message: { content: "done" } });
  expect(url).toBe("https://api.kilo.ai/api/gateway/chat/completions");
});
```

- [ ] **Step 2: Run adapter tests to verify the missing implementation failure**

Run: `pnpm exec vitest run packages/providers/src/runtime-providers.test.ts`

Expected: FAIL because new adapter factories and provider dispatch branches are absent.

- [ ] **Step 3: Implement the generic OpenAI-compatible adapter**

Extract the existing OpenAI request/response normalization into a configurable adapter. Allow provider ID, endpoint, model, and optional headers to vary while retaining tool calls, usage, finish reasons, and safe error handling.

- [ ] **Step 4: Implement the Responses adapter**

Send `model`, `input`, and function tools to the Responses endpoint. Normalize `output_text`/message content and `function_call` items into `ModelResponse.toolCalls`; serialize tool results as function-call outputs on later turns.

- [ ] **Step 5: Implement gateway routing**

Use model metadata/protocol from the selected connection. Route OpenCode model families to their documented `/responses`, `/messages`, `/models/{id}`, or `/chat/completions` endpoint; route Kilo and Cline through their OpenAI-compatible chat endpoints. Keep the selected base URL in the connection so the runtime does not rediscover or guess it during a task.

- [ ] **Step 6: Run adapter tests, existing provider tests, and lint**

Run: `pnpm exec vitest run packages/providers/src/runtime-providers.test.ts packages/providers/src/providers.test.ts && pnpm --filter @shardcode/providers lint`

Expected: PASS with existing OpenAI, Anthropic, Gemini, and scripted tests unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/openai-compatible.ts packages/providers/src/responses.ts packages/providers/src/gateway.ts packages/providers/src/runtime-providers.test.ts packages/providers/src/openai.ts packages/providers/src/index.ts
git commit -m "feat: add runtime adapters for connected providers"
```

### Task 4: Add secure user-scoped provider storage

**Files:**
- Create: `packages/cli/src/provider-store.ts`
- Create: `packages/cli/src/provider-store.test.ts`

**Interfaces:**
- Produce `ProviderStore` with `load(providerId?)`, `loadActive()`, `save(connection)`, and `markVerified(providerId)`.
- Produce `configPath(env, platform?)` with `SHARDCODE_CONFIG_HOME` override.

- [ ] **Step 1: Write failing storage tests**

Test deterministic override paths, round-trip storage, atomic replacement, preserving the old file after a failed write, and absence of keys from a redacted summary.

```ts
it("stores a connection outside the workspace and reloads it", async () => {
  const store = new ProviderStore({ env: { SHARDCODE_CONFIG_HOME: tempRoot } });
  await store.save({ providerId: "openai", apiKey: "secret", modelId: "gpt-5.4", protocol: "openai-chat", verification: "verified", updatedAt: "now" });
  await expect(store.load("openai")).resolves.toMatchObject({ modelId: "gpt-5.4", apiKey: "secret" });
  expect(configPath({ SHARDCODE_CONFIG_HOME: tempRoot })).not.toContain("workspace");
});
```

- [ ] **Step 2: Run focused storage tests and verify failure**

Run: `pnpm exec vitest run packages/cli/src/provider-store.test.ts`

Expected: FAIL because the store is not implemented.

- [ ] **Step 3: Implement platform path and restrictive storage**

Use `SHARDCODE_CONFIG_HOME` for tests/automation; otherwise use `%APPDATA%/ShardCode` on Windows, `~/Library/Application Support/ShardCode` on macOS, and `~/.config/shardcode` on Linux. Create directories with `0700`, write the JSON file with `0600` where supported, use a randomized sibling temporary file, flush/close it, then rename atomically.

- [ ] **Step 4: Implement safe summaries and verification update**

Return provider/model labels without API keys, update only the matching connection in the JSON object, set `activeProviderId` to the saved provider, and keep unknown or malformed files as an empty configuration with a safe error path.

- [ ] **Step 5: Run focused tests and lint**

Run: `pnpm exec vitest run packages/cli/src/provider-store.test.ts && pnpm --filter @shardcode/cli lint`

Expected: PASS; file mode assertions may be skipped only on platforms that do not expose POSIX modes.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/provider-store.ts packages/cli/src/provider-store.test.ts
git commit -m "feat: securely persist user provider connections"
```

### Task 5: Add `/connect` parsing and terminal modal primitives

**Files:**
- Modify: `packages/cli/src/slash.ts`
- Modify: `packages/cli/src/slash.test.ts`
- Modify: `packages/cli/src/tui.ts`
- Modify: `packages/cli/src/tui.test.ts`
- Modify: `packages/cli/src/main.test.ts`

**Interfaces:**
- Add slash command `{ name: "connect" }` and `SLASH_COMMANDS` help entry.
- Extend `TuiTerminal` with `select(title, options)` and `secret(prompt)` methods returning a selected index or `undefined` on cancel.
- Extend `InteractiveTuiOptions` with `connect(): Promise<TuiConnectionResult | undefined>`.

- [ ] **Step 1: Write failing slash tests**

Assert `/connect` parses as a local command, extra arguments are rejected, and `/help` plus `/help connect` describe it.

- [ ] **Step 2: Run slash tests to verify failure**

Run: `pnpm exec vitest run packages/cli/src/slash.test.ts`

Expected: FAIL because `connect` is not in the command definition or parser.

- [ ] **Step 3: Implement slash parsing/help**

Add the command definition, typed union branch, parser switch case, and help rendering. Do not add provider names or keys to parsed slash input.

- [ ] **Step 4: Write failing TUI modal tests**

Extend the fake terminal with queued selections/secrets and test that `/connect` calls the injected callback, renders a safe success message, updates `/model`, and returns to the prompt when canceled.

- [ ] **Step 5: Run TUI tests to verify failure**

Run: `pnpm exec vitest run packages/cli/src/tui.test.ts packages/cli/src/main.test.ts`

Expected: FAIL because the TUI interface and local command branch do not support connection flow.

- [ ] **Step 6: Implement modal primitives and async local command handling**

Render a bounded provider/model menu, use raw terminal input for masked secrets in the default terminal, ensure Ctrl+C/escape-like cancellation returns `undefined`, and keep the fake terminal deterministic. Make only the connect branch asynchronous; preserve all existing local commands.

- [ ] **Step 7: Run focused TUI/slash tests and lint**

Run: `pnpm exec vitest run packages/cli/src/slash.test.ts packages/cli/src/tui.test.ts packages/cli/src/main.test.ts && pnpm --filter @shardcode/cli lint`

Expected: PASS with no API key appearing in captured terminal output.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/slash.ts packages/cli/src/slash.test.ts packages/cli/src/tui.ts packages/cli/src/tui.test.ts packages/cli/src/main.test.ts
git commit -m "feat: add interactive connect slash command"
```

### Task 6: Wire connect discovery, storage, and runtime selection into the CLI

**Files:**
- Modify: `packages/cli/src/args.ts`
- Modify: `packages/cli/src/args.test.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/src/main.test.ts`
- Modify: `packages/cli/src/tui.ts`
- Modify: `packages/shared/src/contracts.ts`

**Interfaces:**
- `runCli` loads the stored active connection when no explicit CLI provider/model is supplied.
- The interactive closure keeps the newly connected configuration for later task prompts without restarting the TUI.
- Explicit `--provider`/`--model` continues to override the stored connection.

- [ ] **Step 1: Write failing CLI tests**

Test all nine `--provider` values parse, an interactive `/connect` flow calls discovery with the selected key, persists the selected model, updates `/model`, and a subsequent task uses the connected provider. Test that explicit command-line configuration wins over stored configuration.

```ts
it("uses the connected provider for the next interactive task", async () => {
  const terminal = tuiTerminal(["/connect", "OpenAI", "test-key", "gpt-5.4", "Run checks", "/exit"]);
  const testIo = io({ tui: terminal });
  const exitCode = await runCli(["--permission-mode", "bypass", "--isolated-environment"], testIo);
  expect(exitCode).toBe(0);
  expect(terminal.output.some((line) => line.includes("Provider connected"))).toBe(true);
});
```

- [ ] **Step 2: Run focused CLI tests to verify failure**

Run: `pnpm exec vitest run packages/cli/src/args.test.ts packages/cli/src/main.test.ts`

Expected: FAIL because the CLI provider union, store loading, and connect callback are not wired.

- [ ] **Step 3: Expand CLI provider parsing and help**

Accept the nine stable provider IDs in `--provider`, keep `scripted` accepted for tests, and update `HELP_TEXT` without printing credentials.

- [ ] **Step 4: Wire `ProviderStore` and discovery into the interactive callback**

Create the callback in `runCli` with the resolved workspace-independent config environment, call `discoverModels` using `io.fetch ?? globalThis.fetch`, pass safe provider/model labels to the TUI, save only after model selection, and leave the prior connection untouched on all failures/cancel paths. Add optional `fetch?: typeof globalThis.fetch` to `CliIO` solely for deterministic discovery tests.

- [ ] **Step 5: Load stored connections for task execution**

At task start, prefer explicit options, then an active stored connection, then environment variables. Map `StoredProviderConnection` into `ProviderConfig` including protocol/base URL, and call `markVerified` only after a successful Cline/Kilo completion.

- [ ] **Step 6: Run focused CLI tests and full build**

Run: `pnpm exec vitest run packages/cli/src/args.test.ts packages/cli/src/main.test.ts && pnpm build && pnpm --filter @shardcode/cli lint`

Expected: PASS; interactive scripted tests remain deterministic and do not require network access.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/args.ts packages/cli/src/args.test.ts packages/cli/src/main.ts packages/cli/src/main.test.ts packages/cli/src/tui.ts packages/shared/src/contracts.ts
git commit -m "feat: wire connected providers into cli tasks"
```

### Task 7: Document the command and complete regression verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-08-13-connect-command-design.md`

- [ ] **Step 1: Document `/connect` and credential behavior**

Add the menu/key/model flow, the nine provider names, the Cline/Kilo deferred-validation behavior, the user-level credential location, and a warning never to paste keys into task prompts or repository files.

- [ ] **Step 2: Run formatting and conflict checks**

Run: `git diff --check && git grep -n -E '<<<<<<<|=======|>>>>>>>' -- ':!*.lock' || true`

Expected: no whitespace errors and no conflict markers.

- [ ] **Step 3: Run the full verification suite**

Run: `pnpm build && pnpm test && pnpm lint && pnpm --silent shardcode run "Run the local smoke check" --provider scripted --permission-mode bypass --isolated-environment --json`

Expected: build and lint exit 0, all Vitest files pass, and the CLI smoke test exits 0 with a completed scripted validation event.

- [ ] **Step 4: Inspect the final diff and working tree**

Run: `git diff ee37950..HEAD --stat && git status --short`

Expected: only the planned provider, CLI, TUI, shared contract, test, and documentation files are changed; no generated credentials or workspace session files are included.

- [ ] **Step 5: Commit documentation and final verification changes**

```bash
git add README.md docs/ARCHITECTURE.md docs/superpowers/specs/2026-08-13-connect-command-design.md
git commit -m "docs: document connected provider setup"
```
