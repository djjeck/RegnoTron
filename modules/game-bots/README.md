# @regnotron/game-bots

The turns of three game bots of the group, read on the turn plugins of `@megabottron1999/turns`:

- `src/replies.ts`: what a turn of @InventoryBot, @LoreGameBot or @EpicLorelecBot brought (an item,
  nothing and why, a count: `Outcome`), their rests, their turn commands (`TURN_COMMANDS`), and the
  grammars of @LoreGameBot and @EpicLorelecBot;
- `src/inventorybot.ts`: @InventoryBot's messages read with the InventoryBot wiki's grammar, the
  module `inventorybot-grammar` it imports (`@inventorybot-wiki/grammar`, `^0.2.0`), onto the same
  outcomes; `src/inventorybot-knowledge.ts`, what the parser knows to find a drop's item (the
  sentence prefixes of `src/inventorybot-prefixes.ts`, measured from the group, and what it learns);
- `src/ledger.ts`: the ledger of what the turns brought;
- `src/plugins/`: their parser plugins (`inventorybot`, `loregame`, `epiclorelec`), and `metagame`,
  the ledger's plugin and its `/loot` command, read only, over a list of games.

It plays nothing. The bots are described in [docs/game-bots.md](../../docs/game-bots.md).

## Configuration

Every plugin is built from its node's config alone.

**The parsers** (`inventorybot`, `loregame`, `epiclorelec`, on the shell's `turnParserPlugin`;
install the InventoryBot wiki's grammar module before this one): their `chat` input is an edge from
the owner's `telegram-user` node that reads the private chat with the bot (`@InventoryBot`, …), and
the game's group too when the owner's turns there should count. They have no config: each spec names
its bot's turn commands (`turnCommands`, from `TURN_COMMANDS`: `/avventura`, and @EpicLorelecBot's
`/rompimiilcazzo` too), a fact of the game rather than of a deployment (MegaBotTron1999's bot-os.md
D70). A node saved with a `commands` config, as they had before, still runs: the key is ignored, and
may be removed from the graph. Each publishes `<id>.turn`, which the editor lists with its
description. A turn-actor of the shell, if the owner runs one beside a parser, needs
`{ "command": "/avventura" }`.

**`metagame`:** its optional events inputs `inventorybot-events` and `loregame-events` take the two
parsers' turns. Another game's parser (outside RegnoTron) adds its outcomes through the action `add`
(`{ t, outcomes }`), over an interface edge to `metagame`. Its store's two migrations are no-ops,
kept so that v0's store (at version 2) can be imported as its instance.

| Config   | Default                           | Meaning                                                               |
| -------- | --------------------------------- | --------------------------------------------------------------------- |
| `ledger` | `true`                            | Keep the ledger; off, `/loot` says there is none                      |
| `bots`   | `["InventoryBot", "LoreGameBot"]` | The bots whose gains `/loot` lists, in its order (another game's too) |

**`inventorybot`'s store** keeps what it learns of @InventoryBot's drops (document `knowledge`): the
item of every drop it resolves, whoever's, and the sentence before a known item, at most 5000 items
and 1000 sentences, the oldest dropped first. Its drops resolve better as it reads; a drop it cannot
resolve is a gain with the grammar's guess at the item, `sure: false`.
