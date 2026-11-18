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
- `src/accumulo.ts`: @LoreGameBot's accumulo: the bot's answers to `/accumulo` (`parseAccumulo`),
  whose they are (`AccumuloWatch`) and when an actor may send it (`accumuloReady`);
- `src/training.ts`: @LoreGameBot's training: the bot's answers to `/allenati` (`parseTraining`),
  whose they are (`TrainingWatch`) and its cooldown of a day (`TRAINING_MECHANICS`);
- `src/answer-watch.ts`: whose answer a message of the bot's own is, in the group, where it replies
  to no command (`AnswerWatch`, which the accumulo's and the training's watches are);
- `src/plugins/`: the parser plugins of @LoreGameBot and @EpicLorelecBot (`loregame`,
  `epiclorelec`), `loregame-state`, the state plugin on @LoreGameBot's turns (with the owner's
  readiness), and `epiclorelec-ready`, @EpicLorelecBot's readiness state.

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
no config: each spec names its bot's turn (`turnCommands`, from `TURN_COMMANDS`), a fact of the game
rather than of a deployment (MegaBotTron1999's bot-os.md D70): one turn, its name first and its
aliases after it (D140), in the owner's order of preference, the bot's own command first, the shared
`/avventura` after it, abbreviations last: @LoreGameBot's `/lore`, `/avventura`, `/l`;
@EpicLorelecBot's `/rompimiilcazzo`, `/avventura`. The parser counts any of them, bare or addressed
to its bot, as the turn, and names it by its name (`/lore`, `/rompimiilcazzo`) in its events. **A
parser only reads** (MegaBotTron1999's bot-os.md D141): it publishes the owner's sends, the bot's
answers and what they announce, and keeps nothing of when a command may go again; that is a state's,
which a shell `player` binds to: @LoreGameBot's `loregame-state` (below), @EpicLorelecBot's
`epiclorelec-ready`, the shell's generic readiness state on `epiclorelec`'s events (its rest alone),
offered by this module. Each state is bound to its parser twice: its `events` input to the parser's
events output, its `parser` input to the parser's interface (the sends a player tells it of, which
it hands on). A shell `player` in the group sends the form that plays the most ready turns at once
(the bare `/avventura` when several bots are ready), and on a tie the first in that order. A node
saved with a `commands` config, as they had before, still runs: the key is ignored, and may be
removed from the graph. Each publishes `<id>.turn`, which the editor lists with its description, and
which, through `turnParserPlugin`, answers its turn commands (the shell's bot-os.md D98: a "too
soon" refused, any other outcome `ok`). The answers hold nothing back in the shell's outbox (its
D142): when a command may go again is the state's alone.

**Bans.** @LoreGameBot answers a banned player's every message with the ban, so `loregame` watches
all it hears (docs/game-bots.md §5.1). The owner's turn answered with a ban is the outcome `banned`,
a refusal; `loregame-state` holds the bot's commands until the ban ends. It also publishes
`loregame.ban` and `loregame.unban` for any player, the group's too, which `loregame-state` keeps;
the owner's ban it folds into the owner's readiness, every command held until it ends, so a shell
`player` sends nothing into a ban. To name the group's players, the edge from the `telegram-user`
node that reads the group must deliver every sender: no `senders` filter (the default,
`@LoreGameBot` and `me`, shows the bot's replies and the owner's messages alone, and the parser can
then place the owner's bans only).

**The accumulo.** A turn that finds it full carries the line `🔋 /accumulo pronto!`, which
`loregame` reads into the outcome of `loregame.turn` (`accumulo: { ready, sure }`; `sure` is false
when a story quotes the line, which the bot never writes twice), and the bot's answer to the owner's
`/accumulo` is published as `loregame.accumulo` (docs/game-bots.md §5.2). In the group the answer is
a message of its own, not a reply, so the parser pairs it with the oldest command waiting: it needs
the same edge as the bans, delivering every sender.

**Playing it: the shell's `player`.** The parser names `/accumulo`, with `/acc` its alias (the bot
takes both; one command, one state, D140), among its bot's commands (its spec's `commands`), and
`loregame-state` declares its mechanics (`ACCUMULO_MECHANICS`, MegaBotTron1999's bot-os.md D132,
D137, D141), so the `player` bound to the `loregame-state` node lists it, one row with both forms,
beside the turn, ticked by default, with its mechanics:

- **unlocked by the bot's word:** a turn with the bot's own line (one copy) makes it ready; never
  our count, and never a line a story quotes;
- **its use ends the rest of the next `/lore`:** the player therefore plays it only while `/lore`
  rests, which is when it gains a turn, and the state lets the `/lore` go at once;
- **its answers** are `loregame.answer` (`command: "/accumulo"`) where the shell pairs them, and
  `loregame.accumulo`, the owner's, wherever they come: a use is the success; "not yet" holds it for
  the turns the bot's counter says it still needs, at 15 minutes each, and withdraws its unlock
  until the next line; the level gate holds it 6 hours; "already ready" (nothing spent) not at all;
  a ban, like every command, until it ends;
- **a player that plays in the group** (MegaBotTron1999's D139): the bot answers its `/accumulo`
  with a message of its own, which the shell cannot pair; the parser pairs it itself (the player
  tells it each send, through the state), declares it the command's answer, and the turns are free
  in the state at once. The player looks again when its two-minute wait for an answer is over, so
  the free turn comes a couple of minutes after the use;
- **a use by hand** counts too, in private or in the group, `/acc` included, even where the shell
  alone would not pair it: it is not ready again until the next turn's line.

**The training**, `/allenati` (docs/game-bots.md §5.3), is played the same way: the parser names it
in its vocabulary, `loregame-state` declares its mechanics (`TRAINING_MECHANICS`: a cooldown of a
day, 1440 minutes, after each success), and the player lists it, a row of its own, ticked by
default:

- **its answers** are a training, the success, which starts the day's wait, and "too soon", which
  holds it for the wait the bot states, to the second; a ban, like every command, until it ends;
- **the success replies to no command**, in private or in the group. In private the shell pairs it
  (the first message after the send); in the group the parser pairs it as the accumulo's
  (`TrainingWatch`), with the same edge delivering every sender, and publishes every player's
  answers as `loregame.training` (`owner` true for the owner's). The owner's is declared the
  command's answer, and the state starts the wait from it wherever it came, by hand too.

Nothing else is to configure: the player's checklist offers both, and its chat-out edge follows.

**Level-ups.** Any message of the bot's that ends in a level-up, whatever brought it, is published
as `loregame.levelUp` for the player it is about (docs/game-bots.md §5.4): the owner's in private,
else the sender of the message it replies to, else the player whose training it paired.

## The state: `loregame-state`

The owner's state at @LoreGameBot, kept by MegaBotTron1999's `statePlugin` from what the `loregame`
parser reads (`src/plugins/loregame-state.ts`, its reducer in `src/loregame-state.ts`). In the graph
editor, add a `loregame-state` node and bind its two inputs, both required: `events` to the
`loregame` node's events output, and `parser` to its interface (the sends a shell player tells the
state of, handed on to the parser, MegaBotTron1999's D141). A shell `player` of @LoreGameBot binds
its `state` input to this node's interface. In the graph file:

```json
{
  "nodes": [{ "id": "loregame-state", "plugin": "loregame-state" }],
  "edges": [
    { "from": "loregame.events", "to": "loregame-state.events", "type": "events" },
    { "from": "loregame.interface", "to": "loregame-state.parser", "type": "interface" },
    { "from": "loregame-state.interface", "to": "lore-player.state", "type": "interface" }
  ]
}
```

It also keeps the **owner's readiness** at @LoreGameBot (the section `readiness`): when each of the
bot's commands may be played, reduced by the shell from the parser's events, with the owner's ban,
their `/accumulo` answers and their trainings folded in (`foldReadiness`), which a shell player
reads before each command (`state.ready`, `state.commands`, `state.bot`).

Its config is `pin` alone, the paths of the state its panel draws first (the first two make the line
on its card; by default `inventory.held` and `owner.as_of`). It survives restarts, resumes from its
cursor in the event log, so each turn is applied once (those the parser published while it was down
included), and announces each change as `loregame-state.changed`.

It keeps the **bans** of every player the parser heard of, with when each ends (below), the owner's
**accumulo** (below), and the **inventory**: what the owner's turns gained (a drop with its `2x`
count, and the items the owner's level-ups give, whatever brought them), per item its count, rarity,
tags, when and by what (`drop` or `level-up`). It is an **estimate, a floor**: nothing lists the
inventory yet (`/zaino` is paginated, and is read later), and a `/usa`, a `/dai` or a generator are
not read yet, so a count only rises and `exact` stays false. A turn cut off at Telegram's limit may
have gained what the reply lost: it changes no count, and marks the inventory `uncertain` in
`state.freshness`.

| Interface                | Answers                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `state.get({ path? })`   | The state, or the value at a dotted path (`inventory.items`)     |
| `state.freshness`        | How fresh each section is: its last snapshot, the deltas since   |
| `state.count({ name })`  | How many of an item the owner holds, as the state estimates it   |
| `state.held()`           | Every item held, with its count                                  |
| `state.ban({ player? })` | A player's ban (the owner's unless named): `{ until, since }`    |
| `state.bans()`           | Every banned player, with their ban                              |
| `state.accumulo()`       | The owner's accumulo: the count, the bot's word, the drift       |
| `state.player({ name })` | A player by username: level, turns, rest, accumulo, training, XP |
| `state.ready()`          | Each of the bot's commands' readiness, for a shell player (D141) |
| `state.commands()`       | The bot's commands with their aliases and mechanics              |
| `state.bot()`            | The bot's username, `LoreGameBot`                                |

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

**The accumulo** is counted and heard at once. The state counts the owner's turns since it was last
emptied (`count`; `exact` once the bot's own counter, "Il tuo accumulo: 7/20", or a use has set it)
and keeps the bot's word apart: `ready` is true only when the bot said it is full (a turn's line, or
a counter at its maximum), never because the count says so, and `max` is the one the bot's counter
states (20 until then; the Stoccaggio skill lowers it, and is not read yet). Where the two disagree
it keeps the latest ten in `drift`, and announces each once: `count`, `early`, `late`, `lapsed`,
`not_ready`, `used_early` (docs/game-bots.md §6 says which is which). The bot's word wins. **An
actor** sends `/accumulo` when the bot said it is full, never on its own count:

```ts
import { type AccumuloInterface, accumuloReady } from '@regnotron/game-bots/accumulo.ts';

if (accumuloReady(ctx.use<AccumuloInterface>('state').state.accumulo())) {
  // full by the bot's word, and not behind a level: send /accumulo
}
```

**Every player** whose turns the account reads is kept too, by username (`players`, the owner's
included; docs/game-bots.md §6.1): their name and level in the game, their turns seen and those a
"too soon" told of (played in their private chat, which the account does not read), their rest,
their accumulo and their trainings (`training`: those seen, those a "too soon" told of, the last,
and until when the next waits) and their XP (`xp`: the XP seen, since their last level-up, and their
latest level-ups with the XP seen before each). The parser publishes them as `loregame.playerTurn`,
`loregame.playerAccumulo`, `loregame.training` and `loregame.levelUp`, which needs the group edge to
deliver every sender, as the bans do.

`loregame-state.accumuloReady` (`count`, `max`, `via`: `turn` or `reading`), `accumuloUsed` (`turns`
since the last use, `exact`) and `accumuloDrift` (`kind`, `counted`, `said`, `max`) announce each
change from live news.
