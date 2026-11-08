# RegnoTron

NorelecBot's game and the turns of the group's other game bots, as modules for MegaBotTron1999
(`vendor/MegaBotTron1999`, a git submodule): `norelec` (the parser, the game state, the `norelec`
plugin), `norelec-tools` (the map and the nuclear clock) and `game-bots` (the other bots' parser
plugins and the ledger). It reads the bots and plays nothing. See [README.md](README.md) for the
overview.

**This repository is public.** Everything committed here, history included, is readable by anyone.

## Development process

- Implementation is handled by the AI agent; the author reviews and approves each change.
- Each completed sub-task is a self-contained, reviewable change, with tests and documentation
  updated in the same commit. Commit only after the author has reviewed the change.
- **Commit on `main`.** No feature branches unless the author asks for one. One logical change per
  commit; the message says why, not only what.
- After each sub-task, stop and wait for the author's approval before the next.

### Read the documentation first

- [README.md](README.md): what the modules are, and how they are installed and configured.
- [docs/game-rules.md](docs/game-rules.md): the game's rules, with the unannounced ones.
- [docs/bot-protocol.md](docs/bot-protocol.md): NorelecBot's messages and the parsers' design; read
  it before writing anything that parses the bot.
- [docs/game-bots.md](docs/game-bots.md): the other game bots, their turns and rests.
- Each module's README.
- The shell's docs, in the submodule: `vendor/MegaBotTron1999/docs/bot-os.md` (the principles and
  decisions; D49 is the module format) and `vendor/MegaBotTron1999/docs/bot-os-api.md` (the plugin
  API). Check every design choice against them.

### Validate after every edit

```bash
source ~/.nvm/nvm.sh && nvm use && npm run validate
```

`validate` runs the tests with coverage, the type check, ESLint with its autofixes and the
formatting check. It is for local use; CI (`.github/workflows/ci.yml`, which checks out the
submodule) runs `npm run ci`, the same checks without fixing anything. Run `npm run format` to fix
formatting. Address every error before marking a sub-task complete.

## Rules

- **Docs change in the same commit as the behaviour.** A change to a module's plugins, its
  configuration or the game's model updates its README, the root README or `docs/` in that commit.
- **No private data, ever.** No real player's name or handle, no Telegram or other network id, no
  message quoted from a real chat (the bots' own texts are fine: they are the game), no export
  message ids, no hostname, IP address or domain of anyone's network, no registry or server of a
  private deployment, and no secret of any kind (in code, tests, fixtures, docs, comments or commit
  messages). Nothing about anyone's strategy, alliances or automation. Use made-up players (Alfa,
  Bravo, Juno, `alice`) and `example.net`. Before every commit, scan the change for tokens, keys,
  long numbers that could be ids, and names, and run gitleaks:
  `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.28.0 git /repo --no-banner -v`.
- **Test data is synthetic.** Tests and fixtures are made up, never copied from a real chat, log or
  export; tests never read real exports.
- **No automation.** No module imports the shell's actors (`@megabottron1999/turns/turn-actor.ts`;
  ESLint refuses it), and nothing here sends a game command.
- **Modules** (MegaBotTron1999's bot-os.md D49): each `modules/<id>/` has a `module.json` (`id`,
  `version`, `api`, `provides` `@regnotron/<id>`, the modules it `imports` with version ranges, its
  `plugins`) and is also a workspace package of the same name and version, with `exports` `./*` →
  `./src/*`. **A module has no npm dependencies:** it imports only `node:*`, `@megabottron1999/*`,
  `zod` and the modules it declares. ESLint and `test/modules.test.ts` enforce it. Each plugin entry
  exports `plugins: Plugin[]`, every plugin built from its saved config alone (`ctx.config`, its
  edges and its context: the event log through `ctx.events`, the time through `ctx.clock`), never
  from a factory's arguments (MegaBotTron1999's docs/bot-os-api.md §4, §7.2). What a module needs
  beyond that is a service of the shell (the map's PNG is `ctx.render.svgToPng`); if the shell lacks
  one, ask for it there rather than adding a dependency.
- **The shell knows no game,** so whatever the game needs of it is configuration: the `norelec`
  plugin's channel, and the game bots' turn command, `/avventura`, which RegnoTron's parsers default
  to, since the shell's turn plugins default to `/play` and count only their configured command
  (README, "Configuration the game needs").
- **The shell** is the submodule, pinned to a tag of MegaBotTron1999 (`v0.1.0-alpha.1`). Never edit
  it here: a change to the shell is made in its repository, and the pin is bumped here (with
  `npm install` for the lockfile) in a commit of its own.
- **Coverage stays at or above 90%** on statements, branches, functions and lines, for the whole and
  for each module's `src/` on its own (`vitest.config.ts` sets a threshold per module).
- **Dependencies:** the root has dev dependencies only, as few as possible, each justified in the
  commit that adds it, pinned to exact versions at least two weeks old, with `package-lock.json`
  committed; the same for the GitHub Actions the workflow uses.
- **People** are referred to as they/them.

## Conventions

- **Language:** English, except the bots' texts, quoted in Italian as they write them.
- **No build step.** Node 24 runs the `.ts` sources directly by stripping types, and `tsc` only
  type-checks (`noEmit`). So imports use `.ts` extensions, and only erasable TypeScript syntax is
  allowed (`erasableSyntaxOnly`: no enums, namespaces or constructor parameter properties).
- **Strict TypeScript,** including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Imports:** ESLint owns their style (sorted in one group, inline `type` specifiers, unused ones
  removed; `npm run lint:fix`). Within a module, import across directories through its own `#src/*`
  and `#test/*` aliases; from another module or the shell, by its name; never with `../`. Production
  code never imports test helpers.
- **Formatting:** Prettier, for every file it supports, Markdown included, with prose wrapped at 100
  columns. The submodule is left out.
- **Tests** sit next to the code they test (`foo.ts`, `foo.test.ts`) and run with Vitest; a module's
  shared helpers live in its `test/`. The loader ignores both.
- **Parsers:** the bot's wording lives in one place, the templates of
  `modules/norelec/src/game/parse-line.ts`, shared by the export-side and the IRC-side parser; the
  simulator writes it with the pieces of `modules/norelec/src/game/wording.ts`, which its test reads
  back with those templates. A new message form gets a test line in
  `modules/norelec/src/game/parse-line.test.ts` and, if it spans lines, a fixture in
  `modules/norelec/test/bot-messages.ts` ([docs/bot-protocol.md](docs/bot-protocol.md) §5).
- **Docs** say once at the top the date they describe ("Documented as of"); the game changes often,
  and whoever notices a change updates the doc and its date.
