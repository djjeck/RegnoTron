# @regnotron/norelec

NorelecBot's ball game, in its Telegram group and its IRC channel (bridged by a relay):

- `src/game/`: the grammar. `parse-line.ts` holds the templates that read each line of the bot into
  a typed event (`events.ts`); `parse-message.ts` a message's lines in order; `wording.ts` writes
  the bot's lines, and is read back by the templates in its tests. The templates follow the live
  game (the ⚽ version, since 9 Nov 2026); the earlier rule-set's, and the simulator of it that was
  `src/arena/`, are in the history (the tag `norelec-classic`).
- `src/transport/`: the relay's line formats and the IRC side's parser; `src/export/`: the Telegram
  exports' side.
- `src/state/`: `game-state.ts`, the parser's live view, for its notices: players, trips, freezes,
  rest, balance estimates; `record.ts`, the game's record the `norelec-state` node keeps.
- `src/plugins/`: the `norelec` parser plugin and the `norelec-state` state plugin.
  `src/game/answers.ts` says which events answer which of the game's commands.

The design is in [docs/bot-protocol.md](../../docs/bot-protocol.md), the rules in
[docs/game-rules.md](../../docs/game-rules.md). A new message form gets a test line in
`src/game/parse-line.test.ts` and, if it spans lines, a fixture in `test/bot-messages.ts`, which
both parsers are tested against.

**Plugin:** `norelec` (`src/plugins/norelec.ts`), a parser, built from its node's config alone. It
reads the game's IRC channel through its `channel` input (there while `channel` is set), a chat-in
edge from an `irc` node that reads the channel, and the game's Telegram group and the owner's
private chat with the bot through its `telegram` input (optional), a chat-in edge from a Telegram
connector (`telegram-user`) that reads those chats; either or both (with both, a message read on one
is not read again from the other: docs/bot-protocol.md §1.1). It replays the last hours of bot
messages from the event log (`ctx.events`) at `ready`. A fresh instance learns the players who are
Telegram accounts from the whole log once, and keeps them in its store (`accounts`).

| Config         | Default           | Meaning                                                                                   |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `channel`      | none              | The game's IRC channel; its edge from `irc` reads it too. Unset: Telegram alone           |
| `bot`          | `NorelecBot`      | The game bot's Telegram username, whose messages the `telegram` edge reads as the bot's   |
| `self`         | the account's     | The game account whose notices are printed, and whose events answer commands              |
| `relays`       | `Regno`, `Regno_` | The relay's IRC nicks, whose `<nick> text` lines are a Telegram side's (case-insensitive) |
| `restS`        | `90`              | Rest after a return, in seconds                                                           |
| `historyHours` | `6`               | The hours of `norelec.message` records replayed from the event log at start               |

It offers `state.game` (the game, for the plugins that use it through an interface edge) and
`state.status` (the channel's health), and publishes `norelec.message` (with its `source`, `irc` or
`telegram`, and `playback` for a message said while the instance was down), `norelec.notice`,
`norelec.answer`, and each event of a message on its own, `norelec.<kind>` (`norelec.theft`,
`norelec.ballTaken`, …; not `info` and `unknown`), with the owner's account (`self`). A bot message
short enough not to be the start of a split one is read and published with its line, inside the
shell's message handler (the others wait the 400 ms join window, for the plugin's tick), so that
MegaBotTron1999's send watchdog hears the channel (bot-os.md D93) and its command answers (D98) pair
a command sent to the channel with the bot's reply: `norelec.answer`, for the events about the
account `self` names, which the manifest declares as the answers of the game's commands in both
forms, `!` and `/`, so that they pair on either network (`ok` or `refused`, and when the command may
go again where the bot says; [docs/bot-protocol.md](../../docs/bot-protocol.md) §5). An answer read
in the private chat with the bot carries `private: true` and answers none of the commands the game
takes only in its group (`GROUP_ONLY`: /buy, /raid, /give, /burn, /avventura). An `irc` node whose
sends the bot answers needs no `unansweredAt: 0`. It needs MegaBotTron1999 0.1.21 or later, whose
manifests declare answers. Its store is at version 1: its one migration, for a layout no store holds
any more, is a no-op, kept because the shell refuses a store at a version above its plugin's count
of migrations.

**Plugin:** `norelec-state` (`src/plugins/norelec-state.ts`), the game's record
(`src/state/record.ts`), kept by MegaBotTron1999's `statePlugin` from the `norelec` node's
`norelec.<kind>` events (its `events` input): it survives restarts, resumes from its cursor in the
event log, and tells news (and where the record and the game disagree, below), and nothing for an
event played back or read at its catch-up (bot-os.md D72, D83). It keeps, per player, the house (its
slots, babies included; a 🏴‍☠️'s plunder taken out of it), the carried emoji, the trip under way
(from, to, start, arrival, return, the 🚀 carried), the balls and rank of the last `/profile`, and
since when the game bans them; the ⚽'s holder and each player's time with it (reconciled with every
`/leaderboard`); every 💦 delivered to a house, its baby due 9 hours later; every baby seen, with
its birth, slot, father, each stage it was seen in and when, when it is due to leave (`leaves`: 96
hours after its birth, measured on 13 babies; for one whose birth was not seen, the latest its
stages allow, a stage a day) and when it was first seen gone; the base trip time measured between
two homes (a trip's time is the base / (1 + 0.1 × 🚀 carried), floored); the prices the bot stated
(an emoji's, `quote`'s); the commands it said are disabled.

**What the game does on its own**, the record times (`settleDue` in `src/state/record.ts`): a baby's
birth 9 hours after a 💦 delivered, its departure 96 hours after its birth, a trip's return. The bot
says a line for each, and the line is the authority (a `babyGone` frees the slot), but a line can be
lost on Telegram or IRC while the game applies the change all the same: once one is `missedAfterMin`
(10) minutes overdue with no line, the record applies it at the next event it applies (the state
plugin has no timer of its own: the game's events, every few seconds, are its clock, and replaying
the log gives the same record), as the game did: the baby born at its time (into the first free
slot, when the house is known and has one), marked `unseen: ['born']`, a late birth line taking its
place; the baby gone at its time, its slot freed (`unseen: ['gone']`); the player home. Its store is
at version 1: its one migration gives each baby kept its `leaves`.

Its interface, beside `state.get` and `state.freshness`:

| Query                 | Answers                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `player({ name })`    | The player's record, or null                                                                                                                                                             |
| `house({ name })`     | `{ slots, locked, locks, at }`: the slots (empty null), those a baby locks (1–10), and each lock `{ slot, emoji, until, exact }` (when its baby leaves; `exact` when its birth was seen) |
| `trip({ name })`      | `{ from, to, start, arriveAt, arrivedAt, returnAt, rockets, load }`, or null                                                                                                             |
| `ball({ at? })`       | `{ holder: { name, since }, totals: [{ name, seconds }] }`, most held first                                                                                                              |
| `held({ name, at? })` | The seconds the player held the ⚽, the hold under way included                                                                                                                          |
| `babies({ name? })`   | The babies (of one house): `{ player, slot, born, father, stages, lastSeen, leaves, exact, gone, unseen }`                                                                               |
| `banned()`            | `{ name: since }`                                                                                                                                                                        |
| `price({ emoji })`    | `{ balls, at }` as the bot last stated it, or null                                                                                                                                       |

Its events: `norelec-state.ballMoved` (`{ from, to }`, the ⚽ taken, for anyone), and about the
owner's account (`self`): `raided` (`{ by, outcome: stolen | held | dog, balls }`), `thrownAt`
(`{ by, emoji }`: a 💦, a 🧊, a 💣 arrived), `ballTaken` (`{ by }`) and `slotLocked`
(`{ slot, emoji, by, replaced }`: a baby born in the owner's house).

**Where the record and the game disagree** (`src/state/checks.ts`), told with the same rule, never
for an event played back or read at the catch-up:

- `missed` (`{ what: born | babyGone | returnHome, player, due, slot?, detail }`): a change the
  record expected for the owner's account and applied with no line (above): a birth, a baby's
  departure, a return (only for a trip seen arriving: one not seen may be a dream, whose line comes
  late).
- `disagreed` (`{ what: house | trip | ball, player?, before, after, detail }`): a listing that
  contradicts what the record held, which the record takes as the truth, as it always did: the
  owner's `/house` (a slot holding something else, a lost raid, purchase, birth or departure; a baby
  grown a stage, or one whose time is up, is none), the owner's `/profile` where it puts them
  elsewhere than the record's trip (a lost departure or return; a trip not seen arriving, now home,
  is left to the dream it may be), and a holder of the ⚽ the leaderboard names other than the
  record's (a lost theft), whoever holds it.

Left out, as they drift in silence: the balances (the 🐔 pay a ball a minute, unannounced), the
carried emoji (kept as last listed, never through each change), and other players' houses and
profiles (their /take, /store and /move may be made in a private chat with the bot). `detail` is one
line for the owner. Both are also raised as the owner's notices of their kind (`missed`,
`disagreed`; MegaBotTron1999's bot-os-api.md §4.16), which an `owner-notice` node tells among its
`other` kinds (on by default; grouped, a minute's gather, at most one message per 10 minutes): no
edge of their own is needed, only an `owner-notice` node with its chat edge. A script or a reactor
can take the events (`norelec-state.missed`, `norelec-state.disagreed`) instead.

| Config           | Default | Meaning                                                                                    |
| ---------------- | ------- | ------------------------------------------------------------------------------------------ |
| `pin`            | `[]`    | The state's paths drawn first in its panel (the state plugin's)                            |
| `missedAfterMin` | `10`    | Minutes past its time an expected change waits for its line, before it is applied and told |
