# @regnotron/game-bots

The turns of the group's game bots, read on the turn plugins of `@megabottron1999/turns`:

- `src/replies.ts`: what a turn of @InventoryBot, @LoreGameBot or @EpicLorelecBot brought (an item,
  nothing and why, a count: `Outcome`), their rests, their turn commands (`TURN_COMMANDS`), and the
  grammars of @LoreGameBot and @EpicLorelecBot;
- `src/ledger.ts`: the ledger of what the turns brought;
- `src/plugins/`: the parser plugins of @LoreGameBot and @EpicLorelecBot (`loregame`,
  `epiclorelec`), and `metagame`, the ledger's plugin and its `/loot` command, read only, over a
  list of games.

@InventoryBot's parser, the plugin `inventorybot`, is no longer here: it is the module
`inventorybot` of [InventoryBotTron](https://github.com/djjeck/InventoryBotTron), beside its
grammar, with the same plugin id and the same `inventorybot.turn` events, which `metagame` reads as
before. This module imports no other.

It plays nothing. The bots are described in [docs/game-bots.md](../../docs/game-bots.md).

## Moving an instance's `inventorybot` node to InventoryBotTron

An instance that ran `inventorybot` from this module (0.1.0) has the InventoryBot wiki's
`inventorybot-grammar` (0.2.0, `@inventorybot-wiki/grammar`) installed for it. Version 0.1.1 offers
`inventorybot` no more and imports no grammar; InventoryBotTron's module `inventorybot` offers the
same plugin, on its own grammar, InventoryBotTron's `inventorybot-grammar` (0.3.1,
`@inventorybottron/grammar`), which has the wiki's module id and so replaces it. The node keeps its
id, its config and its instance (its store: what it learned, its rest), since its plugin id is the
same:

1. On the Modules page, paste `https://github.com/djjeck/InventoryBotTron` and install both modules
   it lists, `inventorybot-grammar` (an update of the wiki's, which it replaces) and `inventorybot`.
2. Update `game-bots` to 0.1.1.
3. Restart, once, after all three.

Every install takes effect at the next start only, so the order of the three does not matter, but no
restart may come between them: at a start with only some of them, a module is refused (the old
`game-bots` imports the wiki's grammar, gone; the new `inventorybot` imports InventoryBotTron's, not
there yet), the saved graph names a plugin no module offers, and the whole graph is refused until
the remaining installs and a restart. Nothing is lost meanwhile: the instances are kept. Both
modules can never offer `inventorybot` at once, since each needs its own grammar under the one
module id. The wiki's grammar needs no removal: the install replaced it, and keeps it as the version
a rollback would restore.

## Configuration

Every plugin is built from its node's config alone.

**The parsers** (`loregame`, `epiclorelec`, on the shell's `turnParserPlugin`): their `chat` input
is an edge from the owner's `telegram-user` node that reads the private chat with the bot
(`@LoreGameBot`, …), and the game's group too when the owner's turns there should count. They have
no config: each spec names its bot's turn commands (`turnCommands`, from `TURN_COMMANDS`:
`/avventura`, and @EpicLorelecBot's `/rompimiilcazzo` too), a fact of the game rather than of a
deployment (MegaBotTron1999's bot-os.md D70). A node saved with a `commands` config, as they had
before, still runs: the key is ignored, and may be removed from the graph. Each publishes
`<id>.turn`, which the editor lists with its description. A turn-actor of the shell, if the owner
runs one beside a parser, needs `{ "command": "/avventura" }`.

**`metagame`:** its optional events inputs `inventorybot-events` and `loregame-events` take the two
parsers' turns: InventoryBotTron's `inventorybot` and this module's `loregame`. Another game's
parser (outside RegnoTron) adds its outcomes through the action `add` (`{ t, outcomes }`), over an
interface edge to `metagame`. Its store's two migrations are no-ops, kept so that v0's store (at
version 2) can be imported as its instance.

| Config   | Default                           | Meaning                                                               |
| -------- | --------------------------------- | --------------------------------------------------------------------- |
| `ledger` | `true`                            | Keep the ledger; off, `/loot` says there is none                      |
| `bots`   | `["InventoryBot", "LoreGameBot"]` | The bots whose gains `/loot` lists, in its order (another game's too) |
