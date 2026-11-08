# @regnotron/game-bots

The turns of three game bots of the group, read on the turn plugins of `@megabottron1999/turns`:

- `src/replies.ts`: their grammars: what a turn of @InventoryBot, @LoreGameBot or @EpicLorelecBot
  brought (an item, nothing and why, a count), their rests, and their turn commands
  (`TURN_COMMANDS`); `src/inventorybot-templates.ts`, @InventoryBot's adventure sentences;
- `src/ledger.ts`: the ledger of what the turns brought;
- `src/plugins/`: their parser plugins (`inventorybot`, `loregame`, `epiclorelec`), and `metagame`,
  the ledger's plugin and its `/loot` command, read only, over a list of games.

It plays nothing. The bots are described in [docs/game-bots.md](../../docs/game-bots.md).

**Configure the turn command.** The shell's turn plugins count only the commands they are configured
with, and default to a placeholder, `/play`. Each parser node here needs
`{ "commands": ["/avventura"] }` (`TURN_COMMANDS`; @EpicLorelecBot's also takes `/rompimiilcazzo`),
or it reads none of the owner's turns. A turn-actor of the shell, if the owner runs one beside a
parser, needs `{ "command": "/avventura" }` likewise.
