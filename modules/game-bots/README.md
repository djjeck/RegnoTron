# @regnotron/game-bots

The turns of three game bots of the group, read on the turn plugins of `@megabottron1999/turns`:

- `src/replies.ts`: their grammars: what a turn of @InventoryBot, @LoreGameBot or @EpicLorelecBot
  brought (an item, nothing and why, a count), their rests, and their turn commands
  (`TURN_COMMANDS`); `src/inventorybot-templates.ts`, @InventoryBot's adventure sentences;
- `src/ledger.ts`: the ledger of what the turns brought;
- `src/plugins/`: their parser plugins (`inventorybot`, `loregame`, `epiclorelec`), and `metagame`,
  the ledger's plugin and its `/loot` command, read only, over a list of games.

It plays nothing. The bots are described in [docs/game-bots.md](../../docs/game-bots.md).

## Configuration

Every plugin is built from its node's config alone.

**The parsers** (`inventorybot`, `loregame`, `epiclorelec`, on the shell's `turnParserPlugin`,
through `src/plugins/game-parser.ts`): their `chat` input is an edge from the owner's
`telegram-user` node that reads the private chat with the bot (`@InventoryBot`, …), and the game's
group too when the owner's turns there should count.

| Config     | Default                                                                 | Meaning                                               |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `commands` | `["/avventura"]`; @EpicLorelecBot's `["/avventura", "/rompimiilcazzo"]` | The owner's turn commands it counts (`TURN_COMMANDS`) |

The shell's own base defaults to a placeholder, `/play`; these default to their bot's. A turn-actor
of the shell, if the owner runs one beside a parser, needs `{ "command": "/avventura" }`.

**`metagame`:** its optional events inputs `inventorybot-events` and `loregame-events` take the two
parsers' turns. Another game's parser (outside RegnoTron) adds its outcomes through the action `add`
(`{ t, outcomes }`), over an interface edge to `metagame`. Its store's two migrations are no-ops,
kept so that v0's store (at version 2) can be imported as its instance.

| Config   | Default                           | Meaning                                                               |
| -------- | --------------------------------- | --------------------------------------------------------------------- |
| `ledger` | `true`                            | Keep the ledger; off, `/loot` says there is none                      |
| `bots`   | `["InventoryBot", "LoreGameBot"]` | The bots whose gains `/loot` lists, in its order (another game's too) |
