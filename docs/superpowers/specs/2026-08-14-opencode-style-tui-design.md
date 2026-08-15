# Alignement du TUI ShardCode sur le style OpenCode

## Objectif

Faire évoluer l’interface terminal interactive de ShardCode vers une
expérience visuelle inspirée d’OpenCode : identité colorée, écran d’accueil
orienté tâche, flux de session lisible et barre de statut compacte. Le projet
conserve son architecture CLI/runtime actuelle et ne promet que les
informations réellement disponibles dans les contrats ShardCode.

## 0. Décision technique

### Option retenue : A — zéro nouvelle dépendance TUI

ShardCode conserve uniquement les primitives Node existantes
(`readline/promises`) et les séquences ANSI produites dans `packages/cli`.
L’implémentation recrée les patterns visuels utiles d’OpenCode sans importer
`@opentui/core`, `@opentui/solid`, Ink, Blessed ou un autre moteur de rendu.

La palette est exprimée comme des tokens de couleur sémantiques. Le point
d’extension `TuiTerminal` choisit le niveau de sortie adapté au terminal :

- truecolor ANSI `38;2;r;g;b` lorsque `COLORTERM` vaut `truecolor` ou
  `24bit` ;
- palette ANSI 256 couleurs lorsque `TERM` indique un terminal 256 couleurs ;
- attributs et palette ANSI 16 couleurs dans les autres cas ;
- sortie sans couleur si la sortie n’est pas un TTY ou si la couleur est
  désactivée par l’environnement.

Le rendu reste textuel et piloté par `readline`. Il n’y aura pas de moteur de
layout en composants, de compositing RGBA, d’animation dépendante d’un timer
ou de coloration syntaxique native. La fidélité recherchée est visuelle et
interactionnelle, pas une réimplémentation du runtime OpenCode.

L’Option B — ajouter un moteur de rendu terminal — est explicitement rejetée
pour cette étape. Elle changerait l’architecture, les dépendances et les
frontières de test du CLI ; elle nécessiterait une décision séparée et une
mise à jour de `docs/ARCHITECTURE.md`.

## 1. Périmètre utilisateur

Le mode interactif de ShardCode est ouvert lorsqu’aucune commande directe
(`run`, `resume`) n’est fournie. Il conserve les commandes slash existantes et
les tâches libres.

L’écran d’accueil contient :

- un logo texte ShardCode et une courte accroche ;
- le chemin du répertoire de travail ;
- un prompt visuellement accentué ;
- une suggestion de tâche affichée comme placeholder ou exemple ;
- une indication concise des commandes `/help` et `/exit`.

Les exemples alternent entre des tâches de code et des commandes de
validation/repository, par exemple `Inspect the repository`, `Run the tests` ou
`git status`. Ils servent uniquement d’habillage : ils ne sont jamais exécutés
automatiquement et ne modifient pas le prompt réellement saisi.

L’écran de session contient :

- un en-tête compact avec le logo, le statut et le contexte courant ;
- un flux d’événements affiché dans une zone bornée et défilante ;
- une ligne de saisie persistante permettant d’enchaîner plusieurs tâches ;
- un footer avec uniquement les informations ShardCode disponibles.

Le footer affiche le mode de permission, le provider et le modèle, le
répertoire de travail et l’id de la dernière session connue. Le statut courant
(`waiting`, `running`, `completed`, `failed` ou `aborted`) reste visible dans
l’en-tête ou le footer.

## 2. Correspondance visuelle avec OpenCode

La palette sombre par défaut reprend les valeurs pertinentes du thème OpenCode
:

| Token | Sombre | Clair | Usage ShardCode |
| --- | --- | --- | --- |
| `background` | `#0a0a0a` | `#ffffff` | fond logique du TUI |
| `foreground` | `#eeeeee` | `#1a1a1a` | texte principal |
| `primary` | `#fab283` | `#3b7dd8` | logo, prompt, focus |
| `accent` | `#9d7cd8` | `#d68c27` | suggestions et méta-information |
| `success` | `#7fd88f` | `#3d9a57` | validation et succès |
| `warning` | `#f5a742` | `#d68c27` | attente, permission |
| `error` | `#e06c75` | `#d1383d` | erreur et échec |
| `info` | `#56b6c2` | `#318795` | événements informatifs |

Le thème clair est sélectionné avec `COLORFGBG` lorsqu’il indique un fond
clair ; le thème sombre est le repli. Les tokens sont convertis par le
terminal en séquences ANSI, sans tenter de contrôler la couleur de fond de
l’émulateur.

Les tokens de typographie du thème web sont ignorés : un programme terminal
ne peut pas choisir la police de l’émulateur.

Le rendu doit rester lisible sans couleur. Les couleurs ne portent donc pas
seules le sens : chaque événement conserve un libellé textuel, et les états
utilisent éventuellement des marqueurs ASCII (`✓`, `!`, `·`) compatibles avec
les terminaux modernes.

## 3. Éléments explicitement exclus

Les éléments suivants ne sont pas implémentés ou simulés :

- LSP et état des serveurs LSP : aucune brique LSP n’existe dans la V1 ;
- MCP et compteur de connexions MCP : aucune occurrence ni contrat MCP dans
  ShardCode ;
- sidebar workspace/session : aucun modèle de sidebar ou de workspace
  interactif n’existe dans le CLI actuel ;
- navigateur de timeline, fork et détail de sous-agent : ShardCode reprend
  une session via `/resume <session-id>` ou `shardcode resume`, sans navigateur
  interactif ;
- animations, rendu RGBA, syntax highlighting et composants Solid/OpenTUI ;
- fonctionnalité métier nouvelle, accès direct au filesystem, shell ou Git
  depuis le TUI ;
- modification de la logique de masquage des secrets, de permissions ou de
  connexion aux providers.

## 4. Architecture et frontières

Les responsabilités restent dans `packages/cli` :

- `tui.ts` orchestre l’état de l’écran, les transitions accueil/session et le
  cycle de saisie ;
- `render.ts` nettoie les données non fiables, rend les événements et expose
  les helpers de présentation ;
- `slash.ts` conserve le parsing et l’aide des commandes locales ;
- `prompts.ts` fournit le prompt de permission et les primitives de saisie
  secrète, avec le même comportement de masquage qu’aujourd’hui ;
- `main.ts` transforme les options CLI en exécution runtime et passe les
  sorties au TUI par `CliIO`.

Le TUI ne doit importer ni `@shardcode/providers` ni `@shardcode/tool-runtime`
pour exécuter lui-même des opérations. Les données transitent par
`TuiExecutionIO`, `TuiSessionSnapshot`, `InteractiveRuntimeInfo` et les
callbacks déjà exposés par `main.ts`.

Les fonctions de rendu sont pures autant que possible. Le terminal réel reste
injectable via `TuiTerminal`, afin que la palette, le repli de couleur, le
redimensionnement futur et le rendu puissent être testés avec un faux terminal.

## 5. Comportements détaillés

### Détection des capacités

`TuiTerminal` calcule ses capacités à l’ouverture à partir de `isTTY`,
`TERM`, `COLORTERM`, `COLORFGBG` et d’une éventuelle préférence de couleur.
Un terminal non-TTY ne reçoit aucune séquence de couleur et le mode interactif
continue de refuser l’exécution comme aujourd’hui.

### Accueil et session

Après `open`, le TUI affiche l’accueil. La première tâche libre fait passer le
statut à `running`, conserve l’historique borné et rend les événements dans le
flux. Une tâche terminée revient à `waiting` pour permettre une nouvelle
saisie. `/clear` efface le flux et revient à un écran d’accueil cohérent sans
perdre la configuration du runtime.

### Événements

`renderEvent` continue de traiter `--json` comme une sortie machine sans ANSI.
En mode humain, les données provenant du modèle, des outils et des commandes
sont d’abord passées par `sanitizeTerminalText`. Le style n’est ajouté
qu’après nettoyage et ne doit jamais permettre à une sortie d’outil de
d’injecter des séquences terminal.

Les événements importants reçoivent une hiérarchie visuelle stable :

- modèle et contexte : information neutre ;
- outil demandé/en cours : accent ;
- outil terminé/validation : succès ;
- permission en attente : warning ;
- outil échoué/budget/thrashing : erreur ou warning selon le cas ;
- session terminée : statut final explicite.

### Slash commands

`/help`, `/clear`, `/status`, `/model`, `/permissions`, `/resume`, `/connect`,
`/exit` et `/quit` restent analysés comme commandes locales ou transmis à la
couche existante selon leur contrat actuel. Leur texte d’aide adopte les
tokens du thème mais leur sémantique ne change pas. Aucune commande OpenCode
supplémentaire n’est ajoutée sans donnée ShardCode correspondante.

### Secret prompts

Les clés API restent lues et masquées par la logique existante
`secretInputRemainder`. Seule la couleur de l’invite, son libellé et son
indication de saisie peuvent évoluer. La valeur saisie ne doit jamais être
ajoutée au flux d’événements ni au rendu de debug.

## 6. Stratégie de test et critères d’acceptation

Le changement suit un cycle TDD : chaque comportement nouveau reçoit un test
qui échoue avant l’implémentation, puis une implémentation minimale et une
vérification ciblée.

Les tests couvriront :

- conversion des tokens hexadécimaux vers truecolor, 256 couleurs, 16
  couleurs et sortie sans couleur ;
- sélection du thème et absence d’ANSI en mode non-TTY ;
- construction de l’accueil, du header, du flux borné et du footer avec les
  seules métadonnées ShardCode ;
- rendu humain coloré après sanitization et rendu JSON inchangé ;
- rotation déterministe des suggestions sans mutation du prompt utilisateur ;
- conservation du parsing slash et des commandes `/resume`, `/connect` et
  `/exit` ;
- conservation du masquage des prompts secrets ;
- intégration du mode interactif avec un terminal injecté et un runtime
  simulé.

La validation finale exige :

```bash
pnpm build
pnpm test
pnpm lint
```

Les tests doivent aussi vérifier statiquement ou par import que le code du TUI
reste dans `packages/cli` et n’ajoute aucune dépendance de rendu terminal.

## 7. Point de départ du checkout

Le checkout analysé au 14 août 2026 est positionné sur le commit
`32e3167`, qui contient encore le CLI direct mais pas les fichiers
`tui.ts`, `slash.ts` ni leurs tests décrits par le brief. Ces fichiers existent
dans l’historique local, avec le socle TUI/slash dans `fada992` (`docs(cli):
document interactive slash commands`) et l’extension `/connect` plus le
masquage `secretInputRemainder` dans la série terminée par `f3958c0`
(`feat(runtime): improve agent orchestration`). Le plan d’implémentation
inclut donc la réintégration contrôlée du socle compatible avec les contrats du
brief, avec des tests avant toute évolution visuelle, puis son alignement
OpenCode. Cette réintégration ne change pas les contrats runtime et ne
constitue pas une nouvelle fonctionnalité de backend.
