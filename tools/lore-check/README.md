# lore-check

Replays Telegram Desktop exports of @LoreGameBot through the real `loregame` parser and
`loregame-state` node, and checks what they made of them: how much of what the bot said the grammar
read, and whether the state agrees with what the bot said next. Run it again as the parser learns to
read more, and add a check for what it learns.

```sh
npm run lore-check -- <export folder>… --owner "<your display name>" --username <your username> \
  --bot "<the bot's display name>" [--since 2026-10-01] [--time-zone Europe/Rome] [--names]
```

- **The exports:** folders of Telegram Desktop exports, HTML or JSON, read by MegaBotTron1999's
  `@megabottron1999/telegram-export` (its docs/telegram-export.md): the private chat with the bot
  and the game's group together, as the account sees them, since the state is one, whatever the
  chat. Overlapping exports are merged. A group renamed between two exports is one chat: an export
  names a chat by its title when it was made, and gives no id, so two titles that share messages
  (the same id, sender and text, ten at least) are taken as one, and each message is replayed once
  (`mergeRenamedChats`). A macOS HTML export has no UTC offset: its dates are read in `--time-zone`,
  this computer's by default.
- **Who is who:** your messages, by your display name in the exports (`--owner`, repeatable: give
  each name you had over the exports' span, since an export shows the one you had when it was made),
  are the account's own, under `--username`; the private chat with the bot is the one titled with
  its name (`--bot`). The exports have no usernames, so each player is known by their display name.
- **The replay:** MegaBotTron1999's `replay` (its bot-os.md D131), on the dev kit's clock, every
  chat read from every sender: rests, answers and the stores behave as they do live.
- **The report** is printed; the players are shown as P1, P2, … unless `--names`, so that it can be
  shared. **The exports and the report stay on your computer:** the repository is public, and its
  tests use invented chats only (CLAUDE.md).

## The checks

`checks.ts`, each a pure function of the run (the messages, and each parser event with the state
before and after it):

| Check       | What it measures                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage    | Of the bot's replies to a turn command, any player's, those read as a turn or a "too soon"; by outcome; the parser's drift on the owner's.                                                                                                                                                                                                                                                        |
| Rest model  | Each "too soon" against the rest predicted from the player's last turn: agrees within 2 minutes, a turn unseen (played in private), longer or shorter. Each turn before the predicted rest was over: after a use of the accumulo seen, a second turn within a minute of the last (docs/game-bots.md §2), a use unseen (the accumulo was full), or not a use (it was not).                         |
| Accumulo    | Each counter the bot gave a player against the state's count (equal if exact, not below if a floor); how often the bot said it was full; the disagreements found, by kind.                                                                                                                                                                                                                        |
| Training    | Of the `/allenati` sent, those whose answer the parser paired with a player; each training "too soon" against a day after the last training seen: agrees within 2 minutes, a training unseen (played in private), or sooner than predicted.                                                                                                                                                       |
| Levels      | Of the bot's level-ups, those the parser placed with a player; the XP seen gained; per level reached, the XP seen since the level-up before (the ground for telling whether the thresholds are fixed).                                                                                                                                                                                            |
| Profiles    | Each profile against the state since the player's last one: its episodes against the turns seen (agreeing, every turn was seen); then its XP against the state's (the XP rule alone); its level against its XP; its lines left unread; the stats the state held exactly that it said otherwise, the owner's and the other players' apart.                                                         |
| Shop        | Of the bot's shop listings, those read; the days they cover, the sagra days, how often the day's items changed within a day, the items seen on sale (the generators apart), the players whose listings were read; the purchases read (a listing edited back from its confirmation: live alone, an export keeping each message as last edited), and each buyer's coins against their next profile. |
| Generators  | The bot's generator confirmations and outcomes, by kind; the outcomes paired with a player (their confirmation's), by kind; the moving boxes opened, and those read.                                                                                                                                                                                                                              |
| Catalogue   | Every item seen in the game: how many, the generators among them, how each was first seen, and by rarity.                                                                                                                                                                                                                                                                                         |
| Players     | How many, their turns seen and those told of by a "too soon" alone, and the busiest.                                                                                                                                                                                                                                                                                                              |
| Whereabouts | The players no profile of theirs was read for: how many have a place (from their turns) and a faction (from its ladder); and, at each player's first profile, how often it agrees with the place and the faction their turns told.                                                                                                                                                                |

**To add one** (the inventory, the equipment, the stats, as the parser reads them): write a `Check`
in `checks.ts` (`{ id, run(r) → { title, rows } }`), comparing what the state held before an event
with what the bot then said, add it to `CHECKS`, and test it in `lore-check.test.ts` with an
invented chat.
