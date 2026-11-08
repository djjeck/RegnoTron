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

**Plugin:** `norelec` (`src/plugins/norelec.ts`). Its factory takes the game's IRC channel and what
the game logs to, prints to and reads the time from (`norelecPlugin({ channel, game })`).
