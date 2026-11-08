# RegnoTron

NorelecBot's game, and the turns of the other game bots of its Italian Telegram group, as modules
for [MegaBotTron1999](https://github.com/djjeck/MegaBotTron1999), a plugin-based bot shell: their
grammars, their parsers, the state they keep, and read-only tools.

RegnoTron is not affiliated with the games or their authors. It reads what the bots write and plays
nothing: there is no automation here. Its models of the games include the rules the bots apply
without announcing them, since a rule that is public levels the field.

**Status: v1-alpha.** The code is the parsers, state and tools that ran in production on an earlier,
monolithic version, now split into modules for MegaBotTron1999 `v0.1.0-alpha.1`, whose loader
installs them into a running shell. Everything here changes freely until the shell's launch.

## The modules

| Module          | Provides                   | What it holds                                                                                                                                              |
| --------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `norelec`       | `@regnotron/norelec`       | NorelecBot's game: its grammar (read and written), its parser over IRC and over Telegram exports, the game state, a simulator; the `norelec` parser plugin |
| `norelec-tools` | `@regnotron/norelec-tools` | The map of the players' homes (`/map`) and the nuclear clock (`/nuclear_warning`), as the plugins `norelec-map` and `nuclear-clock`; imports `norelec`     |
| `game-bots`     | `@regnotron/game-bots`     | @InventoryBot's, @LoreGameBot's and @EpicLorelecBot's grammars and parser plugins, and `metagame`, the ledger of what the owner's turns brought (`/loot`)  |

Each module has its own README. The bots' texts are quoted in Italian, as they write them; the
players' names in the tests and fixtures are made up.

## Installing a module

A module is a directory, `modules/<id>/`, of plain TypeScript files that Node runs by stripping
types, with a `module.json` (MegaBotTron1999's docs/bot-os.md D49):

```json
{
  "id": "norelec-tools",
  "version": "0.1.0",
  "api": "1",
  "provides": "@regnotron/norelec-tools",
  "imports": { "@regnotron/norelec": "^0.1.0" },
  "plugins": ["src/plugins/norelec-map.ts", "src/plugins/nuclear-clock.ts"]
}
```

A module has no npm dependencies of its own: it imports only Node, the shell's packages
(`@megabottron1999/*`), zod and other modules, all of which the shell resolves to its own copies.
The map renders its PNG through the shell's render service (`ctx.render`), not a library of its own.
Each plugin entry exports `plugins`, the plugins built from their saved config alone
(MegaBotTron1999's docs/bot-os-api.md §7.2): no factory takes a deployment's values, so every node
is data the shell's editor makes.

The owner of an instance installs a module through the shell's control API (`POST /modules`, from a
directory or a tarball, `git archive --prefix=norelec/ -o norelec.tar.gz HEAD:modules/norelec`),
with the modules it imports, and restarts it: for the map, `norelec` and `norelec-tools`. The
plugins then appear in `GET /available` and the web UI's graph, where the owner adds and wires their
nodes. Modules run with the shell's full rights, unsandboxed: install only what you have read.

**Configuration the game needs.** The shell knows no game, so its defaults are generic:

- The `norelec` node's config names the game's IRC channel (`channel`), and its edge from `irc`
  reads it.
- The game bots' parsers count only the turn commands they are configured with. The shell's base
  defaults to a placeholder, `/play`; RegnoTron's parsers default to their bot's own (`/avventura`,
  and @EpicLorelecBot's `/rompimiilcazzo` too: `TURN_COMMANDS` in
  `modules/game-bots/src/replies.ts`). An edge that also reads the game's group has them read the
  turns played there. A shell turn-actor run beside one needs `{ "command": "/avventura" }`.
- The nuclear clock posts only to the group its config names (`group`), which its edge from
  `telegram-bot` must send to, and only with its `nuclearClock` setting on.

Each module's README lists its plugins' config fields.

## Developing

MegaBotTron1999 is vendored as a git submodule, `vendor/MegaBotTron1999`, pinned to a tag
(`v0.1.0-alpha.1`); its packages are workspaces here, beside the modules, which are workspaces too
(each `@regnotron/<id>`, with `exports` `./*` → `./src/*`), so that imports and tests resolve as the
loader will resolve them.

```sh
git clone --recurse-submodules https://github.com/djjeck/RegnoTron.git
cd RegnoTron
nvm use && npm ci
npm run validate   # tests with coverage, types, lint, formatting
```

To take newer shell code, move the submodule to a newer tag of MegaBotTron1999 and commit the new
pin with the lockfile.
`node vendor/MegaBotTron1999/packages/core/tools/modules.ts modules/norelec modules/norelec-tools modules/game-bots`
loads the modules as an instance does, and exits 1 if one is refused. See [CLAUDE.md](CLAUDE.md) for
the repository's rules, and `docs/` for the game: [the rules](docs/game-rules.md),
[NorelecBot's messages and the parser](docs/bot-protocol.md), and
[the other game bots](docs/game-bots.md).

## Licence

MIT ([LICENSE](LICENSE)). The bundled font, IBM Plex Mono, is under the SIL Open Font License
(`modules/norelec-tools/src/map/fonts/OFL.txt`).
