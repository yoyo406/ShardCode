# ShardCode

ShardCode is a CLI-first autonomous coding agent. It explores a repository,
calls an LLM through a normalized provider interface, edits files, runs
approved commands, observes failures, and iterates until validation succeeds.

## Quick start

```bash
pnpm install
pnpm build

# Start the interactive TUI.
pnpm shard

# OpenAI is the default provider for a direct task.
export OPENAI_API_KEY="..."
pnpm shard "Implement the requested change and add tests"
```

After building, the installed CLI exposes both `shard` and `shardcode`:

```bash
shard
shard "Fix the failing tests"
shardcode run "Implement a feature"
shardcode resume <session-id>
```

Running `shard` with no task opens the interactive terminal UI. It displays
runtime activity as it happens and asks for permission when the selected mode
requires confirmation. The explicit `run` and `resume` forms remain useful
for scripts and automation.

Inside the TUI, slash commands are handled locally and are never sent to the
model:

| Command | Purpose |
| --- | --- |
| `/help [command]` | List commands or show focused help. |
| `/clear` | Clear the event history on screen. |
| `/status` | Show the last task/session status. |
| `/model` | Show the active provider and model. |
| `/permissions` | Show the permission mode and isolation setting. |
| `/resume <session-id>` | Resume a persisted session. |
| `/connect` | Add an AI provider, validate/discover models, and choose the active model. |
| `/exit` or `/quit` | Leave the TUI. |

The prompt stays open after each task, so a typical session can look like:

```text
Task or /command: Implement OAuth and add tests
... runtime events ...
Task or /command: /status
Last session: <session-id>
Status: completed
Task or /command: /exit
```

During development, invoke the compiled binary directly:

```bash
node packages/cli/dist/index.js "Inspect the repository"
```

The CLI defaults to permission mode `ask`. Read-only exploration is allowed;
workspace edits and shell commands are shown for approval. `acceptEdits` allows
workspace edits while still asking before shell execution; shell execution also
requires a configured sandbox and fails closed when none is available:

```bash
pnpm shardcode run "Fix the failing tests" --permission-mode acceptEdits
```

`bypass` is accepted only with `--isolated-environment`. Use it only when the
process is already inside a container/OS sandbox with credentials and network
access scoped to the task.

## Providers

The provider adapters are normalized behind one tool-calling contract. In the
interactive TUI, use `/connect` to select a provider, enter its API key in a
masked prompt, retrieve the available models, and choose the default model.
The supported providers are:

- OpenAI (`openai`)
- OpenAI-Codex (`openai-codex`)
- Google-Gemini (`google-gemini`)
- Mistral (`mistral`)
- Anthropic-Claude (`anthropic-claude`)
- OpenCode ZEN (`opencode-zen`)
- OpenCode GO (`opencode-go`)
- Cline (`cline`)
- Kilo-code (`kilo-code`)

For direct commands, pass a provider and optional model:

```bash
pnpm shardcode run "..." --provider openai --model gpt-4o-mini
pnpm shardcode run "..." --provider openai-codex --model codex-mini-latest
pnpm shardcode run "..." --provider google-gemini --model gemini-2.5-flash
pnpm shardcode run "..." --provider mistral --model mistral-large-latest
pnpm shardcode run "..." --provider anthropic-claude --model claude-sonnet-4-6
```

Direct commands read credentials from the provider-specific environment
variables (`OPENAI_API_KEY`, `CODEX_API_KEY`, `GEMINI_API_KEY`,
`MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `CLINE_API_KEY`,
or `KILO_API_KEY`). Connections created with `/connect` are stored outside the
workspace in the user configuration directory (`~/.config/shardcode` on Linux,
`~/Library/Application Support/ShardCode` on macOS, or `%APPDATA%/ShardCode` on
Windows). Set `SHARDCODE_CONFIG_HOME` to override it for automation or tests.

Cline uses its documented bundled model catalog because it does not expose a
public model-list endpoint. Kilo reads its public model catalog without
sending the API key; both connections are marked unverified until their first
real model request. Provider transport failures use bounded retries; a failed
repository tool is returned to the model as an observation and is not retried
by the runtime.

For a no-network smoke run, use the deterministic provider:

```bash
pnpm build
pnpm shardcode run "Run the local smoke check" \
  --provider scripted --permission-mode bypass --isolated-environment
```

The isolated-environment flag is an assertion that the process is already
inside a container or OS sandbox; it does not create that isolation. When a
command is launched through pnpm, the repository root is taken from pnpm's
invocation directory. Set `SHARDCODE_WORKSPACE_ROOT` to override it explicitly.

`bypass` est réservé à un processus déjà isolé. Dans un terminal interactif,
`ask` ou `acceptEdits` conserve le flux normal de validation.

## Permissions and settings

Team rules can be committed in `.shardcode/settings.json`; personal overrides
belong in `.shardcode/settings.local.json`. Rules use `tool`, `path` and/or
`command` patterns and a `decision` of `allow`, `ask` or `deny`. Deny always
wins over ask, and ask wins over allow. `.git`, `.env`, secret paths and paths
outside the workspace are always denied.

See [.shardcode/settings.json.example](.shardcode/settings.json.example) for a
valid starting point.

## Budgets, sessions and output

Budgets are explicit and persisted with each session:

```bash
pnpm shardcode run "..." \
  --max-tokens 100000 \
  --max-tool-calls 100 \
  --max-wall-clock-seconds 1800 \
  --max-context-characters 120000
pnpm shardcode resume <session-id>
pnpm shardcode run "..." --json
```

Session state and JSONL events are stored under `.shardcode/sessions/`. A task
is completed only when the model emits `SHARDCODE_VALIDATED: ...` after at
least one successful recognized validation command such as `pnpm test`,
`pnpm build` or `pnpm lint`. Budget exhaustion and repeated equivalent
failures stop the session cleanly with resumable state.

Optional project guidance can be stored in `SHARDCODE.md`; it is loaded as
untrusted project data alongside scoped JSON memory.
The full transcript remains persisted; when the provider view reaches the
context limit, older user-turn groups are compacted only for the next request.
Press `Ctrl-C` to abort a run and keep it resumable.

## Development

```bash
pnpm build
pnpm test
pnpm lint
```

The monorepo boundaries and non-negotiable safety rules are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). V1 deliberately uses agentic
`glob`/`grep`/`read_file` exploration; embeddings, vector search and full LSP
are out of scope.
