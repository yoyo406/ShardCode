# Alignement du TUI ShardCode sur le style OpenCode — Plan d’implémentation

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Reconstituer le socle TUI absent du checkout courant puis lui appliquer une identité visuelle inspirée d’OpenCode, sans nouvelle dépendance ni changement des frontières runtime.

**Architecture:** packages/cli reste responsable de la présentation, de la saisie et du parsing slash. Un module de thème pur traduit les tokens de couleur en ANSI truecolor, 256, 16 ou sans couleur. main.ts continue de construire le runtime existant et adapte ses événements vers le TUI via CliIO ; le TUI n’exécute aucune opération de repository.

**Tech Stack:** TypeScript strict, Node.js readline/promises et streams standard, séquences ANSI, Vitest, pnpm workspaces. Aucun moteur OpenTUI/Ink/Blessed et aucune dépendance supplémentaire.

## Global Constraints

- Option A est obligatoire : aucune nouvelle dépendance TUI ; uniquement readline/promises et ANSI écrits à la main.
- Le TUI reste dans packages/cli et n’importe ni providers ni tool-runtime pour exécuter des actions.
- Les actions filesystem, shell et Git continuent de passer par CliIO et runtime.
- Les sorties du modèle et des outils sont sanitizées avant l’ajout de tout style ANSI.
- --json reste une sortie machine sans ANSI et run/resume conservent leur comportement.
- Le mode interactif refuse un terminal non-TTY et ne valide jamais implicitement une permission.
- Le footer n’affiche que permission mode, provider/modèle, workspace et session connus par ShardCode.
- LSP, MCP, sidebar, timeline/fork, animations OpenTUI, RGBA et syntax highlighting sont hors scope.
- /connect reste parseable et son crochet TUI reste injectable, mais aucune nouvelle gestion de provider n’est ajoutée au checkout courant qui n’en contient pas ; sans callback fourni, le TUI indique que la connexion n’est pas disponible.
- secretInputRemainder et le masquage des secrets restent fonctionnellement inchangés ; seuls libellés et styles évoluent.
- Chaque comportement nouveau suit RED, vérification de l’échec, GREEN, vérification du succès.
- La vérification finale doit exécuter pnpm build, pnpm test et pnpm lint.

## File Map

- Modify: packages/cli/src/args.ts et args.test.ts — mode interactive et tests.
- Create: packages/cli/src/slash.ts et slash.test.ts — commandes slash et aide typées.
- Create: packages/cli/src/theme.ts et theme.test.ts — tokens OpenCode et conversion ANSI.
- Modify: packages/cli/src/render.ts et create render.test.ts — sanitization et tons.
- Create: packages/cli/src/tui.ts et tui.test.ts — écrans, boucle interactive et secrets.
- Modify: packages/cli/src/prompts.ts et create prompts.test.ts — habillage des permissions.
- Modify: packages/cli/src/main.ts et main.test.ts — adaptation au runtime existant.
- Modify: packages/cli/src/index.ts, packages/cli/package.json, package.json et README.md.

---

### Task 1: Reconstituer le parsing interactif et les commandes slash

**Interfaces:** CliCommand ajoute interactive. parseArgs([]) devient interactive, une première valeur non-option/non-commande devient une tâche directe, et les commandes run/resume restent inchangées. parseInteractiveInput retourne task, command ou invalid. Les commandes sont help, clear, status, model, permissions, resume, connect, exit et quit.

- [ ] Step 1: écrire les tests RED dans args.test.ts et slash.test.ts.

~~~ts
it("opens the interactive mode with no explicit command", () => {
  expect(parseArgs([])).toMatchObject({ command: "interactive", provider: "openai" });
  expect(parseArgs(["--provider", "scripted"])).toMatchObject({
    command: "interactive",
    provider: "scripted"
  });
});

it("accepts a bare task while preserving explicit commands", () => {
  expect(parseArgs(["Fix the tests", "--provider", "scripted"])).toMatchObject({
    command: "run",
    prompt: "Fix the tests",
    provider: "scripted"
  });
  expect(parseArgs(["run", "Fix the tests"])).toMatchObject({ command: "run", prompt: "Fix the tests" });
  expect(parseArgs(["resume", "session-123"])).toMatchObject({ command: "resume", sessionId: "session-123" });
});

it("parses tasks, aliases and connect without executing them", () => {
  expect(parseInteractiveInput("  Inspect the repo  ")).toEqual({
    kind: "task",
    prompt: "Inspect the repo"
  });
  expect(parseInteractiveInput("/quit")).toEqual({ kind: "command", command: { name: "exit" } });
  expect(parseInteractiveInput("/connect")).toEqual({ kind: "command", command: { name: "connect" } });
});

it("rejects unsafe resume ids and invalid arguments", () => {
  expect(parseInteractiveInput("/resume ../secrets")).toMatchObject({ kind: "invalid" });
  expect(parseInteractiveInput("/clear extra")).toMatchObject({ kind: "invalid" });
  expect(parseInteractiveInput("/unknown")).toMatchObject({ kind: "invalid" });
});
~~~

- [ ] Step 2: vérifier RED avec
  pnpm exec vitest run packages/cli/src/args.test.ts packages/cli/src/slash.test.ts

Expected: échec car le parser courant ne reconnaît pas interactive et slash.ts n’existe pas.

- [ ] Step 3: implémenter le minimum. Traiter une invocation vide ou commençant par une option comme interactive, un premier argument non-option/non-commande comme prompt direct, et conserver la validation actuelle. Dans slash.ts, normaliser en minuscules, limiter l’id à /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, produire l’aide ciblée ou complète, et ne faire aucun appel runtime.

- [ ] Step 4: vérifier GREEN avec la même commande ciblée. Expected: tous les tests args/slash passent.

- [ ] Step 5: committer.

~~~bash
git add packages/cli/src/args.ts packages/cli/src/args.test.ts packages/cli/src/slash.ts packages/cli/src/slash.test.ts
git commit -m "feat(cli): add interactive slash command parsing"
~~~

### Task 2: Ajouter le thème sémantique et le repli ANSI

**Interfaces:** theme.ts exporte TuiColorMode (truecolor, ansi256, ansi16, none), TuiThemeName, TuiTone (normal, primary, accent, success, warning, error, info), TuiCapabilities, detectTuiCapabilities(isTTY, env) et styleTuiText(text, tone, capabilities).

- [ ] Step 1: écrire les tests RED.

~~~ts
it("detects truecolor and the dark OpenCode palette", () => {
  const capabilities = detectTuiCapabilities(true, { COLORTERM: "truecolor", COLORFGBG: "15;0" });
  expect(capabilities).toEqual({ colorMode: "truecolor", theme: "dark" });
  expect(styleTuiText("ShardCode", "primary", capabilities)).toBe("\u001b[38;2;250;178;131mShardCode\u001b[39m");
});

it("falls back to 256, 16 and no color in order", () => {
  expect(detectTuiCapabilities(true, { TERM: "xterm-256color" }).colorMode).toBe("ansi256");
  expect(styleTuiText("ok", "primary", { colorMode: "ansi256", theme: "dark" })).toBe("\u001b[38;5;217mok\u001b[39m");
  expect(styleTuiText("ok", "primary", { colorMode: "ansi16", theme: "dark" })).toContain("\u001b[9");
  expect(styleTuiText("ok", "primary", { colorMode: "none", theme: "dark" })).toBe("ok");
});

it("detects a light terminal and disables color for non-TTY", () => {
  expect(detectTuiCapabilities(true, { COLORFGBG: "0;15" }).theme).toBe("light");
  expect(detectTuiCapabilities(false, { COLORTERM: "truecolor" })).toEqual({ colorMode: "none", theme: "dark" });
});
~~~

- [ ] Step 2: vérifier RED avec
  pnpm exec vitest run packages/cli/src/theme.test.ts

Expected: échec car theme.ts n’existe pas.

- [ ] Step 3: implémenter les conversions. Déclarer les couleurs sombres et claires du spec. Détecter COLORTERM truecolor/24bit avant TERM *256color, utiliser ansi16 pour les autres TTY, et none hors TTY. Interpréter COLORFGBG foreground;background pour le thème clair. Convertir RGB vers le cube 6×6×6/gris 256 et choisir la couleur 16 la plus proche par distance euclidienne. Toujours fermer une couleur foreground par \u001b[39m.

- [ ] Step 4: vérifier GREEN avec la commande ciblée. Expected: palette et quatre replis passent.

- [ ] Step 5: committer.

~~~bash
git add packages/cli/src/theme.ts packages/cli/src/theme.test.ts
git commit -m "feat(cli): add dependency-free tui theme"
~~~

### Task 3: Rendre les événements avec une hiérarchie visuelle sûre

**Interfaces:** render.ts ajoute RenderOptions = { style?: (text, tone) => string }. renderEvent conserve sa signature existante et accepte options. sanitizeTerminalText reste appliquée avant style et JSON reste sans style.

- [ ] Step 1: écrire les tests RED.

~~~ts
it("sanitizes hostile event text before applying a semantic tone", () => {
  const lines: string[] = [];
  renderEvent(
    createEvent("session-1", "ToolFailed", {
      result: { output: "\u001b[31mrm -rf\u001b[0m\nfailed" }
    }),
    (line) => lines.push(line),
    false,
    { style: (text, tone) => "<" + tone + ">" + text + "</" + tone + ">" }
  );
  expect(lines[0]).toBe("<error>Échec : rm -rf\nfailed</error>");
  expect(lines[0]).not.toContain("\u001b");
});

it("keeps JSON output unchanged and unstyled", () => {
  const lines: string[] = [];
  const event = createEvent("session-1", "ValidationPassed", { commands: ["pnpm test"] });
  renderEvent(event, (line) => lines.push(line), true, { style: () => "should-not-run" });
  expect(JSON.parse(lines[0]!)).toEqual(event);
});
~~~

- [ ] Step 2: vérifier RED avec
  pnpm exec vitest run packages/cli/src/render.test.ts

Expected: échec car options de style et rendu sémantique manquent.

- [ ] Step 3: implémenter des helpers sûrs pour data.call, data.result, data.error et data.message. Produire des lignes pour session, modèle, outils, validation, permission, budget, thrashing et fin de session. Associer chaque ligne à un TuiTone, sanitizée avant options.style, et ne jamais styler JSON.

- [ ] Step 4: vérifier GREEN avec la commande ciblée. Expected: sanitization, ton et JSON passent.

- [ ] Step 5: committer.

~~~bash
git add packages/cli/src/render.ts packages/cli/src/render.test.ts
git commit -m "feat(cli): add themed event rendering"
~~~

### Task 4: Construire l’écran d’accueil, de session et le footer

**Interfaces:** tui.ts expose TuiTerminal avec isTTY, open, question, confirm, write, error, clear, setStatus, finish, close et style?. Il exporte aussi les snapshots/runtime info, renderTuiWelcome, renderTuiFooter, runInteractiveTui et createDefaultTuiTerminal. L’historique est limité à 200 lignes et 4 000 caractères par ligne.

- [ ] Step 1: écrire les tests RED de layout et cycle.

~~~ts
it("renders an OpenCode-inspired welcome and footer with ShardCode data only", () => {
  const style = (text: string, tone: string) => "<" + tone + ">" + text + "</" + tone + ">";
  const welcome = renderTuiWelcome("/repo", info, "Run the tests", style).join("\n");
  const footer = renderTuiFooter("/repo", info, snapshot(), "waiting", style).join("\n");
  expect(welcome).toContain("ShardCode");
  expect(welcome).toContain("Run the tests");
  expect(footer).toContain("acceptEdits");
  expect(footer).toContain("scripted / scripted-local");
  expect(footer).toContain("/repo");
  expect(footer).toContain("abc-123");
  expect(footer).not.toMatch(/LSP|MCP|sidebar|workspace sessions/i);
});

it("keeps the session alive for local commands and a task", async () => {
  const terminal = fakeTerminal(["/model", "Implement OAuth", "/status", "/clear", "/exit"]);
  const requests: InteractiveTaskRequest[] = [];
  const result = await runInteractiveTui({
    terminal,
    workspaceRoot: "/repo",
    info,
    execute: async (request) => {
      requests.push(request);
      return { exitCode: 0, session: snapshot() };
    }
  });
  expect(result).toBe(0);
  expect(requests).toEqual([{ kind: "run", prompt: "Implement OAuth" }]);
  expect(terminal.clearCount).toBe(1);
  expect(terminal.finished).toEqual([0]);
  expect(terminal.closed).toBe(1);
});

it("fails closed without a TTY and never calls the executor", async () => {
  const terminal = fakeTerminal([], false);
  let executed = false;
  await expect(runInteractiveTui({
    terminal,
    workspaceRoot: "/repo",
    info,
    execute: async () => { executed = true; return { exitCode: 0 }; }
  })).resolves.toBe(1);
  expect(executed).toBe(false);
  expect(terminal.errors.join("\n")).toContain("TTY");
});
~~~

- [ ] Step 2: vérifier RED avec
  pnpm exec vitest run packages/cli/src/tui.test.ts

Expected: échec car tui.ts et les layouts n’existent pas.

- [ ] Step 3: implémenter l’accueil (logo, accroche, workspace, suggestion, aide slash), l’en-tête de session, le flux borné et le footer. Alterner les suggestions avec un index local sans muter le prompt. Redessiner avec clear/home uniquement dans le terminal réel et sanitizée toute sortie runtime avant historique. Garder les commandes locales. Si /connect n’a pas de callback, afficher que la connexion n’est pas disponible sans exécuter de tâche.

- [ ] Step 4: écrire le test RED du secret puis implémenter.

~~~ts
it("preserves lines pasted after a masked secret", () => {
  expect(secretInputRemainder("secret-key\r\n1\n/exit\n")).toEqual(["1", "/exit"]);
  expect(secretInputRemainder("secret-key")).toBeUndefined();
});
~~~

Implementer secretInputRemainder et TuiTerminal.secret(prompt) avec raw mode seulement si stdin.isTTY et setRawMode existent : afficher *, gérer backspace/Ctrl-C, restaurer raw mode, remettre les lignes collées dans la file et ne jamais stocker la valeur dans l’historique. Sans raw mode, demander normalement sans réémettre la valeur.

- [ ] Step 5: vérifier GREEN avec pnpm exec vitest run packages/cli/src/tui.test.ts.

Expected: layout, boucle, commandes, fail-closed TTY et secrets passent.

- [ ] Step 6: committer.

~~~bash
git add packages/cli/src/tui.ts packages/cli/src/tui.test.ts
git commit -m "feat(cli): add OpenCode-inspired tui shell"
~~~

### Task 5: Habiller les prompts sans changer leurs décisions

**Interfaces:** prompts.ts ajoute formatPermissionPrompt(question, style?) sans modifier askForPermission : réponses y, yes, o, oui, défaut négatif et refus hors TTY restent identiques. Aucune saisie secrète n’est écrite par write, error, renderEvent ou JSON.

- [ ] Step 1: écrire le test RED.

~~~ts
it("styles permission prompts without changing their decision text", () => {
  expect(formatPermissionPrompt("run_shell: pnpm test", (text) => "<warning>" + text + "</warning>"))
    .toBe("<warning>run_shell: pnpm test [y/N]</warning>");
});
~~~

- [ ] Step 2: vérifier RED avec
  pnpm exec vitest run packages/cli/src/prompts.test.ts packages/cli/src/tui.test.ts

Expected: échec car le formatter et prompts.test.ts manquent.

- [ ] Step 3: implémenter le formatter pur, l’utiliser dans askForPermission et garder la validation des réponses. Dans le TUI, passer la question sanitizée à confirm et appliquer warning au libellé seulement.

- [ ] Step 4: vérifier GREEN avec la commande ciblée. Expected: prompts et masking passent.

- [ ] Step 5: committer.

~~~bash
git add packages/cli/src/prompts.ts packages/cli/src/prompts.test.ts packages/cli/src/tui.ts packages/cli/src/tui.test.ts
git commit -m "feat(cli): theme interactive prompts"
~~~

### Task 6: Brancher le TUI sur main.ts et les entrées CLI

**Interfaces:** CliIO ajoute tui?: TuiTerminal. Un helper executeTask commun sert run, resume et les requêtes interactives. onEvent appelle renderEvent avec le style du TUI lorsque présent. runCli([]) lance le TUI ; run/resume directs restent inchangés ; --json interactif retourne 2.

- [ ] Step 1: écrire le test RED d’intégration.

~~~ts
it("runs the scripted lifecycle through the themed interactive TUI", async () => {
  const testIo = io();
  const terminal = tuiTerminal(["Run the checks", "/status", "/exit"]);
  testIo.tui = terminal;
  const exitCode = await runCli(["--provider", "scripted", "--permission-mode", "acceptEdits"], testIo);
  expect(exitCode).toBe(0);
  expect(terminal.output.some((line) => line.includes("Session"))).toBe(true);
  expect(terminal.output.some((line) => line.includes("Last session"))).toBe(true);
  expect(terminal.finished).toEqual([0]);
  expect(terminal.closed).toBe(1);
});

it("rejects JSON output in interactive mode", async () => {
  const testIo = io();
  expect(await runCli(["--json"], testIo)).toBe(2);
  expect(testIo.errors.join("\n")).toContain("--json");
});
~~~

- [ ] Step 2: vérifier RED avec pnpm exec vitest run packages/cli/src/main.test.ts.

Expected: échec car parser et main.ts ne savent pas créer le TUI.

- [ ] Step 3: conserver la construction actuelle de ToolRuntime, ContextEngine, MemoryStore, AgentRuntime et JsonSessionStore. Ajouter le dispatch interactive, l’info provider/modèle/permissions, l’adaptateur TuiExecutionIO et le snapshot de session. Exporter slash, tui, theme et render depuis index.ts. Ajouter bin shard et le script root pnpm shard.

- [ ] Step 4: vérifier GREEN avec pnpm exec vitest run packages/cli/src.

Expected: tous les tests CLI passent et aucune modification runtime/provider/tool-runtime/context-engine n’est nécessaire.

- [ ] Step 5: committer.

~~~bash
git add packages/cli/src/main.ts packages/cli/src/main.test.ts packages/cli/src/index.ts packages/cli/package.json package.json
git commit -m "feat(cli): wire themed tui into shardcode"
~~~

### Task 7: Documenter et vérifier l’ensemble

**Files:** README.md, docs/ARCHITECTURE.md en revue, et tous les fichiers CLI modifiés.

- [ ] Step 1: documenter shard/shardcode sans argument, tâches, slash commands, palette adaptative, footer réel, refus hors TTY, et exclusions LSP/MCP/sidebar/timeline. Préciser que run/resume et --json restent scriptables.

- [ ] Step 2: vérifier le diff.

Run: git diff --check && git status --short && git diff --stat

Inspecter les imports : aucune dépendance TUI, aucun filesystem/shell/Git dans le TUI, aucun secret dans les sorties.

- [ ] Step 3: installer si nécessaire puis vérifier.

~~~bash
pnpm install
pnpm build
pnpm test
pnpm lint
~~~

Expected: chaque commande sort avec le code 0. Toute correction commence par une régression ciblée.

- [ ] Step 4: lancer les smoke tests sans réseau.

~~~bash
pnpm shard --help
node packages/cli/dist/index.js "Run the local smoke check" --provider scripted --permission-mode acceptEdits --json
~~~

Expected: l’aide expose le mode interactif, la commande scripted produit du JSON sans ANSI et termine completed. Le TUI est couvert par faux terminal car le shell CI n’est pas un TTY.

- [ ] Step 5: relire les sections 0 à 7 du spec et vérifier Option A, palette/repli, écrans, footer, slash/secret, sanitization, frontières et exclusions.

- [ ] Step 6: committer la documentation.

~~~bash
git add README.md packages/cli/src
git commit -m "docs: document OpenCode-style ShardCode tui"
~~~
