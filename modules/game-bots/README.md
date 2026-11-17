# @regnotron/game-bots

The turns of the group's game bots, read on the turn plugins of `@megabottron1999/turns`:

- `src/replies.ts`: what a turn of @InventoryBot, @LoreGameBot or @EpicLorelecBot brought (an item,
  nothing and why, a count: `Outcome`), their rests, their turn commands (`TURN_COMMANDS`), and the
  grammars of @LoreGameBot and @EpicLorelecBot. A @LoreGameBot turn is read whole (its place, its
  fight, its gain with the count and the stats, its level-up:
  [docs/game-bots.md](../../docs/game-bots.md) §5), and `loregame.turn` publishes it so;
- `src/loregame-state.ts`: the owner's state at @LoreGameBot (its schema, reducer and freshness);
- `src/bans.ts`: @LoreGameBot's bans, as the parser watches them (`BanWatch`) and an actor checks
  them (`bannedUntil`);
- `src/plugins/`: the parser plugins of @LoreGameBot and @EpicLorelecBot (`loregame`,
  `epiclorelec`), and `loregame-state`, the state plugin on @LoreGameBot's turns.

@InventoryBot's parser, the plugin `inventorybot`, is no longer here: it is the module
`inventorybot` of [InventoryBotTron](https://github.com/djjeck/InventoryBotTron), beside its
grammar, with the same plugin id and the same `inventorybot.turn` events. This module imports no
other.

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
`/avventura`, @LoreGameBot's `/lore` and `/l`, and @EpicLorelecBot's `/rompimiilcazzo` too), a fact
of the game rather than of a deployment (MegaBotTron1999's bot-os.md D70). A node saved with a
`commands` config, as they had before, still runs: the key is ignored, and may be removed from the
graph. Each publishes `<id>.turn`, which the editor lists with its description, and which, through
`turnParserPlugin`, answers its turn commands (the shell's bot-os.md D98: a "too soon" refused with
its `retryAt`, any other outcome `ok`).

**Bans.** @LoreGameBot answers a banned player's every message with the ban, so `loregame` watches
all it hears (docs/game-bots.md §5.1). The owner's turn answered with a ban is the outcome `banned`,
a refusal that holds the bot's commands until the ban ends, and the parser's `state.rest` says so,
so a shell turn-actor sends nothing into a ban. It also publishes `loregame.ban` and
`loregame.unban` for any player, the group's too, which `loregame-state` keeps. To name the group's
players, the edge from the `telegram-user` node that reads the group must deliver every sender: no
`senders` filter (the default, `@LoreGameBot` and `me`, shows the bot's replies and the owner's
messages alone, and the parser can then place the owner's bans only). A turn-actor of the shell, if
the owner runs one beside a parser, needs `{ "command": "/avventura" }`.

## The state: `loregame-state`

The owner's state at @LoreGameBot, kept by MegaBotTron1999's `statePlugin` from what the `loregame`
parser reads (`src/plugins/loregame-state.ts`, its reducer in `src/loregame-state.ts`). In the graph
editor, add a `loregame-state` node and bind its one input, `events` (required), to the `loregame`
node's events output; in the graph file:

```json
{
  "nodes": [{ "id": "loregame-state", "plugin": "loregame-state" }],
  "edges": [{ "from": "loregame.events", "to": "loregame-state.events", "type": "events" }]
}
```

Its config is `pin` alone, the paths of the state its panel draws first (the first two make the line
on its card; by default `inventory.held` and `owner.as_of`). It survives restarts, resumes from its
cursor in the event log, so each turn is applied once (those the parser published while it was down
included), and announces each change as `loregame-state.changed`.

It keeps the **bans** of every player the parser heard of, with when each ends (below), and the
**inventory**: what the owner's turns gained (a drop with its `2x` count, and the items a level-up
gives), per item its count, rarity, tags, when and by what (`drop` or `level-up`). It is an
**estimate, a floor**: nothing lists the inventory yet (`/zaino` is paginated, and is read later),
and a `/usa`, a `/dai` or a generator are not read yet, so a count only rises and `exact` stays
false. A turn cut off at Telegram's limit may have gained what the reply lost: it changes no count,
and marks the inventory `uncertain` in `state.freshness`.

| Interface                | Answers                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `state.get({ path? })`   | The state, or the value at a dotted path (`inventory.items`)   |
| `state.freshness`        | How fresh each section is: its last snapshot, the deltas since |
| `state.count({ name })`  | How many of an item the owner holds, as the state estimates it |
| `state.held()`           | Every item held, with its count                                |
| `state.ban({ player? })` | A player's ban (the owner's unless named): `{ until, since }`  |
| `state.bans()`           | Every banned player, with their ban                            |

A ban is kept with when it ends, as the bot states it (Rome's clock; a date alone: the end of the
day), and is over when the bot serves the player again, which it does early at times, or when its
end passes: the state drops it at the next event, and `state.ban` may answer a ban that has ended,
which an actor checks against its clock. **An actor** (a script or a plugin) that sends the bot's
commands asks as it wakes, before each one:

```ts
import { type BansInterface, bannedUntil } from '@regnotron/game-bots/bans.ts';

const until = bannedUntil(ctx.use<BansInterface>('bans'), ctx.clock.now());
if (until !== undefined) return; // banned: the account's, whatever the command; ask again later
```

`loregame-state.banned` (`player`, `until`, `owner`) and `loregame-state.unbanned` (`player`,
`owner`, `reason`: `lifted` or `expired`) announce each change, for any player, from live news.
