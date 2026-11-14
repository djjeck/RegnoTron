# @regnotron/norelec

NorelecBot's ball game, in its Telegram group and its IRC channel (bridged by a relay):

- `src/game/`: the grammar. `parse-line.ts` holds the templates that read each line of the bot into
  a typed event (`events.ts`); `parse-message.ts` a message's lines in order; `wording.ts` writes
  the bot's lines, for a simulator, and is read back by the templates in its tests.
- `src/transport/`: the relay's line formats and the IRC side's parser; `src/export/`: the Telegram
  exports' side.
- `src/state/`: the game state: players, trips, freezes, the place's holder, the timers.
- `src/plugins/`: the `norelec` parser plugin, which reads the channel through the `irc` connector
  and publishes `norelec.message` and `norelec.notice`, and offers the game (`state.game`) to the
  plugins that read it.
- `src/arena/engine.ts`: the game, simulated, with the bot's wording, for testing offline.

The design is in [docs/bot-protocol.md](../../docs/bot-protocol.md), the rules in
[docs/game-rules.md](../../docs/game-rules.md). A new message form gets a test line in
`src/game/parse-line.test.ts` and, if it spans lines, a fixture in `test/bot-messages.ts`, which
both parsers are tested against.

**Plugin:** `norelec` (`src/plugins/norelec.ts`), a parser, built from its node's config alone. It
reads the game's channel through its `channel` input, a chat-in edge from an `irc` node that reads
the channel, and replays the last hours of bot messages from the event log (`ctx.events`) at
`ready`. A fresh instance learns the players who are Telegram accounts from the whole log once, and
keeps them in its store (`accounts`).

| Config         | Default      | Meaning                                                                     |
| -------------- | ------------ | --------------------------------------------------------------------------- |
| `channel`      | (required)   | The game's IRC channel; its edge from `irc` reads it too                    |
| `self`         | the IRC nick | The game account whose notices are printed                                  |
| `restS`        | `90`         | Rest after a return, in seconds                                             |
| `historyHours` | `6`          | The hours of `norelec.message` records replayed from the event log at start |

It offers `state.game` (the game, for the plugins that use it through an interface edge) and
`state.status` (the channel's health), and publishes `norelec.message` and `norelec.notice`. Its
store is at version 1: its one migration, for a layout no store holds any more, is a no-op, kept
because the shell refuses a store at a version above its plugin's count of migrations.
