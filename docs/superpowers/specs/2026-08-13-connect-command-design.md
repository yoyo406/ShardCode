# `/connect` Provider Connection Design

**Date:** 2026-08-13

**Status:** Approved for specification review

## Goal

Add a local `/connect` command to the interactive TUI. The command lets a user choose one of nine AI providers, enter an API key in a masked terminal modal, validate the credential where the provider exposes a safe validation path, retrieve the provider's available models, select a default model, and persist the active provider configuration for future ShardCode tasks.

## User flow

The command is available from the existing slash-command loop:

```text
Task or /command: /connect
┌─ Connect provider ─────────────────────────┐
│ > OpenAI                                   │
│   OpenAI Codex                             │
│   Google Gemini                            │
│   Mistral                                  │
│   Anthropic Claude                         │
│   OpenCode Zen                             │
│   OpenCode Go                              │
│   Cline                                    │
│   Kilo Code                                │
└────────────────────────────────────────────┘

API key: **************

Checking credential…
Available models:
  > gpt-5.4
    gpt-5.4-mini
    gpt-4.1

Provider connected: OpenAI / gpt-5.4
```

The terminal modal is an interactive TUI overlay, not a GUI window. The user can cancel at the provider, key, or model step. Cancellation and failed validation leave the previous configuration unchanged.

After model selection, `/model` shows the active provider and model. The selected provider is used by subsequent direct runs, interactive tasks, and resumed sessions that do not explicitly override their provider.

## Provider registry

Provider-specific details are represented in one registry rather than spread across slash parsing, TUI rendering, CLI argument parsing, and model adapters.

| Display name | Stable ID | Model discovery | Authentication | Runtime protocol |
|---|---|---|---|---|
| OpenAI | `openai` | `GET https://api.openai.com/v1/models` | `Authorization: Bearer <key>` | OpenAI Chat Completions by default |
| OpenAI Codex | `openai-codex` | OpenAI models endpoint, filtered to coding/Codex-capable models | OpenAI API key mode | OpenAI Responses for Codex models |
| Google Gemini | `google-gemini` | `GET https://generativelanguage.googleapis.com/v1beta/models` | `x-goog-api-key: <key>` | Gemini `generateContent` |
| Mistral | `mistral` | `GET https://api.mistral.ai/v1/models` | `Authorization: Bearer <key>` | Mistral Chat Completions |
| Anthropic Claude | `anthropic-claude` | `GET https://api.anthropic.com/v1/models` with pagination | `x-api-key` and `anthropic-version` | Anthropic Messages |
| OpenCode Zen | `opencode-zen` | `GET https://opencode.ai/zen/v1/models` | `Authorization: Bearer <key>` | Protocol selected from model metadata/catalog |
| OpenCode Go | `opencode-go` | `GET https://opencode.ai/zen/go/v1/models` | `Authorization: Bearer <key>` | Protocol selected from model metadata/catalog |
| Cline | `cline` | Bundled Cline model catalog; no documented public models endpoint | Bearer API key | OpenAI-compatible Chat Completions |
| Kilo Code | `kilo-code` | `GET https://api.kilo.ai/api/gateway/models` | Bearer API key for runtime requests | Kilo gateway/OpenAI-compatible protocol |

OpenAI Codex is implemented in API-key mode for this command. The upstream Codex project also supports ChatGPT browser/device authentication, but that is a separate OAuth/device-code flow and is outside this `/connect` key modal.

The registry returns normalized model records:

```ts
interface AvailableModel {
  id: string;
  label: string;
  providerId: string;
  protocol: "openai-chat" | "openai-responses" | "gemini" | "anthropic" | "mistral" | "gateway";
  capabilities?: {
    toolCalling?: boolean;
    reasoning?: boolean;
    vision?: boolean;
  };
}
```

The selected model stores both its provider ID and model ID. Model IDs are not rewritten or guessed; gateway-qualified IDs such as `anthropic/claude-sonnet-4-6` remain intact.

## Validation and model discovery

Each native provider uses a bounded HTTP request with a timeout. A successful model-list response validates the key and supplies the selectable models. HTTP 401/403, invalid JSON, timeout, rate limit, or an empty model list is reported in the modal without exposing the key.

OpenCode Zen and Go use their documented model-list endpoints. Their catalogs can contain models served through different API protocols, so the normalized model record must preserve the protocol metadata required by the runtime.

Cline's public API documentation specifies an OpenAI-compatible Chat Completions API and a `provider/model` model-ID convention, but does not specify a public model-list endpoint. ShardCode therefore ships a curated Cline catalog derived from the documented model catalog. The Cline key is marked `unverified` after `/connect` and is verified on the first real model request; no probe request is sent during setup.

Kilo's gateway model catalog is public and does not by itself prove that a key is valid. ShardCode displays that catalog, stores the key as `unverified`, and verifies it on the first authenticated model request. No paid probe request is sent during setup.

The model list is normalized, sorted by display label, and presented with paging or scrolling when it exceeds the terminal viewport. If no model supports tool calling, the user is warned before saving because ShardCode's agent loop requires tool calls for repository work.

## Configuration and secret handling

Provider credentials are user-scoped, not project-scoped. They must not be written to `.shardcode`, `SHARDCODE.md`, session events, JSONL output, terminal redraw buffers, or repository files.

The configuration adapter uses a platform-appropriate user configuration directory, with an explicit `SHARDCODE_CONFIG_HOME` override for tests and automation. The credentials file is created with owner-only permissions (`0600` where supported). The stored value contains:

```ts
interface StoredProviderConnection {
  providerId: string;
  apiKey: string;
  modelId: string;
  verification: "verified" | "unverified";
  updatedAt: string;
}
```

The key is never included in `Session`, `ProviderConfig` event payloads, rendered status output, thrown error messages, or debug logs. Configuration writes are atomic: write a temporary file with restrictive permissions, rename it into place, and keep the old file if serialization or persistence fails.

## TUI and slash boundaries

`slash.ts` remains responsible for parsing and documenting the command. `/connect` takes no arguments and produces a typed command. The TUI owns the interactive modal lifecycle and remains responsible for local commands not sent to the model.

The provider connection operation is injected into `runInteractiveTui` as a callback. This keeps network access and credential storage out of the parser and keeps the TUI testable with a fake terminal. The callback returns either a committed connection summary or a cancellation/error result; the TUI renders only safe labels and messages.

The existing synchronous local-command renderer becomes asynchronous only where required by `/connect`. Existing `/help`, `/clear`, `/status`, `/model`, `/permissions`, `/resume`, and `/exit` behavior remains unchanged.

## Runtime integration

The shared provider contract is expanded from the current three live providers to the normalized provider IDs above, while `scripted` remains test-only. Provider creation consumes the selected connection and model record. Existing providers keep their current request normalization; new adapters share the existing HTTP/JSON helpers and tool-schema conversion utilities.

The CLI loads the user connection at task start. An explicit command-line provider/model continues to take precedence. A resumed session continues using the provider and model stored in that session unless the user explicitly overrides them. An `unverified` Cline or Kilo connection transitions to `verified` only after a successful real completion request.

## Error handling

- Empty keys are rejected locally before any request.
- Provider errors are mapped to short, safe messages such as `Invalid API key`, `Provider unavailable`, `Rate limited`, or `No compatible models found`.
- Raw response bodies are not shown because they may contain request metadata or provider secrets.
- A failed connection never replaces the previously active provider.
- A canceled modal returns to the slash loop without changing the TUI status or creating a session.
- Network calls use an abort timeout and do not retry non-idempotent validation requests.

## Testing strategy

Tests are required before implementation code:

1. Slash parser tests verify `/connect`, argument rejection, and `/help connect` output.
2. TUI tests verify provider selection, masked key entry, model selection, cancel behavior, and safe rendering of a successful connection.
3. Provider discovery tests use injected fetch functions to verify every endpoint, required headers, pagination, filtering, and normalized model records.
4. Cline and Kilo tests verify the `unverified` state and confirm setup does not send a probe completion request.
5. Configuration tests verify atomic persistence, user-level path selection, restrictive permissions where supported, reload behavior, and absence of secrets from rendered output.
6. Runtime tests verify the selected provider/model configuration, protocol-specific adapters, tool-call normalization, and verification transition after a successful real request.
7. Existing CLI, TUI, provider, security, build, lint, and smoke tests must remain green.

## Success criteria

- `/connect` is listed in `/help` and can be completed entirely from the TUI.
- All nine provider entries are selectable.
- Native provider keys are validated by their documented model APIs.
- OpenCode Zen and Go models are fetched from their documented catalogs.
- Cline and Kilo show models without unsafe probe requests and verify keys on first real use.
- A user can select a model and immediately run a ShardCode task with that configuration.
- No API key appears in workspace files, session data, logs, terminal output, or test snapshots.
- `pnpm build`, `pnpm test`, `pnpm lint`, `git diff --check`, and the scripted CLI smoke test pass.

## Documentation sources

- [OpenAI Models API](https://developers.openai.com/api/docs/models)
- [Gemini Models API](https://ai.google.dev/api/models)
- [Mistral Models API](https://docs.mistral.ai/api/endpoint/models)
- [Claude API overview and Models API](https://platform.claude.com/docs/en/api/overview)
- [OpenCode Zen](https://opencode.ai/docs/zen/)
- [OpenCode Go](https://opencode.ai/docs/go/)
- [Cline API overview and Models](https://docs.cline.bot/api/overview)
- [Kilo models and providers](https://kilo.ai/docs/gateway/models-and-providers)
