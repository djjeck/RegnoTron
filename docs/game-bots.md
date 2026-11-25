# The game bots RegnoTron reads

Documented as of 25 Nov 2026. Besides NorelecBot ([game-rules.md](game-rules.md)), the game's group
has other game bots, each with its own game played one turn at a time. RegnoTron reads the turns of
two of them, @LoreGameBot and @EpicLorelecBot, in `modules/game-bots/`: their reply grammars
(`src/replies.ts`) and their parser plugins in `src/plugins/`. @InventoryBot's parser, the plugin
`inventorybot`, is [InventoryBotTron](https://github.com/djjeck/InventoryBotTron)'s, beside the
bot's grammar and protocol, and publishes its turns as `inventorybot.turn` events. Marks as in
[game-rules.md](game-rules.md): **[S]** stated, **[M]** measured, **[?]** unknown.

**Nothing here plays any bot.** RegnoTron's modules only read the bots' answers; they send no turn.
@pescaccia_bot, the group's fishing game, does not allow automation, and nothing here plays it.

## 1. The bots and their turns

Every game bot of the group answers `/avventura`, as its own command or as an alias of its main one,
so that a player of several games can play them all at once [S]. In the group, `/command@BotName`
plays a turn with that bot only [S]; in a direct chat with a bot, every message is a turn of the
player's own.

| Bot             | Turn command                      | What a turn's answer looks like                                                                                                                                                                                                                                      |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @InventoryBot   | `/avventura`                      | One random item in a random sentence, naming the player: `@alice, … un ombrello sgonfio [C]!` (a rarity code in brackets, sometimes tags after it). Rarely the day's lucky adventure: `Complimenti @alice, questa e' l'avventura FORTUNATA del giorno! Hai vinto: …` |
| @LoreGameBot    | `/lore`, `/avventura` or `/l`     | A story, replying to the command, that ends in an item (`Hai ottenuto un'ancora di burro [B1]!`), in a fight lost (`Torni a casa dolorante e a mani vuote...`) or in the item lost (`L'oggetto si perde nello scontro...`)                                           |
| @EpicLorelecBot | `/rompimiilcazzo` or `/avventura` | A running count of the player's "rotture": `Complimenti 78, <display name>, mi hai rotto il cazzo 53 volte!` (the count may be negative, and lines of the day's event may come first)                                                                                |

Each parser names its bot's turn by the bot's own command, the others its aliases, in the order of
the table (`TURN_COMMANDS`, `modules/game-bots/src/replies.ts`; MegaBotTron1999's bot-os.md D140):
the bot's own command first, the shared `/avventura` after it, abbreviations last. Any of them, bare
or addressed, is the turn. The order is the owner's preference, which the shell's `player` follows
when two forms play as many turns: in the group the bare `/avventura` still wins whenever it plays
several bots' turns at once, and a bot ready alone gets its own command (`/lore`), not
`/avventura@LoreGameBot`.

@InventoryBot's sentence and item are not delimited, so its parser learns as it reads which is
which, and marks a gain whose item it had to guess (InventoryBotTron's README). The bots write some
accented letters decomposed ("e" and a combining grave for "è"), so the text is read in its composed
form (NFC).

## 2. Rests between turns

- **15 minutes** after a turn, for each of the three [M].
- **@LoreGameBot: 30 minutes after a fight lost** [M] (about 4% of its turns).
- **@LoreGameBot: a second turn within a minute** [M]: a turn command sent within a minute of a turn
  is answered at times as a turn of its own, not a "too soon": 24 times in Oct–Nov 2026, 22 of them
  an `/avventura`. The rest then runs from the second turn. Far more turns come within a minute of
  the last after an `/accumulo` the player sent between the two (291 of 315), which ends the rest
  (§5.2); an earlier count, 226 of 236 `/lore` after an `/avventura`, took those for second turns.
- A turn sent too soon gets the bot's "too soon", with the wait left, which the parsers read:
  - @InventoryBot:
    `Troppo presto, devi riposare ancora per 9 minuti e 29 secondi prima di poterti avventurare…`
  - @LoreGameBot: `Non è passato abbastanza tempo! Riprova fra 5 minuti e 3 secondi.` (it does not
    extend the rest)
  - @EpicLorelecBot:
    `Non è passato abbastanza tempo dall'ultima rottura! Riprova fra 14 minuti e 57 secondi.`
    (sometimes after a parenthesis)

Good etiquette is not to play a bot at its limit [S].

## 3. How the parsers tell the owner's turns

Each parser plugin (InventoryBotTron's for @InventoryBot) reads the direct chat between the owner's
account and its bot, and the group when its edge reads it too:

- **In the direct chat** every turn is the owner's, so the bot's first message after a turn answers
  it. An answer there that a parser cannot read is reported as drift.
- **@InventoryBot** does not reply to the command but names the player (`@username, …`, sometimes
  with a title after the name, and after `[W] ` when it announces the adventure to another group),
  so its drops are read in either chat when they name the owner. Its "too soon" names nobody, so it
  is read only in the direct chat.
- **@LoreGameBot** replies to the command and names nobody: a reply to one of the owner's turns is
  read in either chat.
- **@EpicLorelecBot** names the player by display name, so its count is read only in the direct
  chat; its "too soon" replies to the command, so it is read in either chat.

@EpicLorelecBot's count is a running total the bot states at each turn, not an item.

## 4. Not read, not played

- **@pescaccia_bot** does not allow automation [S]. RegnoTron has no parser for it and plays nothing
  there.
- **NorelecBot** is read by `modules/norelec/` over IRC ([bot-protocol.md](bot-protocol.md)), not by
  these plugins. It answers `/avventura` only in the group, where it tries to enter @TheConquister37
  ([game-rules.md](game-rules.md) §3.1); alone it is `/avventura@NorelecBot` [S].

## 5. @LoreGameBot's turn

The grammar of a reply to `/avventura`, `/lore` or `/l`, which `parseLoreGameBot`
(`modules/game-bots/src/replies.ts`) reads and the `loregame` plugin publishes as `loregame.turn`.
Measured [M] over some 49,600 replies to the three commands, in the private chat and in the group,
up to 17 Nov 2026. A reply, in order:

| Line(s)                                                       | What it is                                                                                                                                                                         | Seen in              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `Lore - <place> [<code>]`                                     | The place the turn took place in. The code is in the rarities' notation (`B1`, `M4`, `N1`); a place keeps its code. The name may hold emoji and spaces.                            | all but a "too soon" |
| `<story>`                                                     | Free text, one line or many, **written by players**: it may hold anything, the bot's own phrases included, so the parser anchors on the end.                                       | all but a "too soon" |
| `🔋 /accumulo pronto!`                                        | While the player's accumulo is full (§5.2), a line of its own after the story, set off by a blank line. A story may quote it, so the parser counts its copies.                     | some 2,600 turns     |
| `Durante il tuo cammino compare <enemy> [L<n>]!`              | An encounter: about one turn in nine. The enemy has a level; it may be named like an item, tags and all.                                                                           | 11% of the turns     |
| `Il combattimento inizia...`                                  | Opens the fight.                                                                                                                                                                   | each encounter       |
| `⚡️ <player> [L<n>] attiva il potere di <item> ⚡️!`           | One per equipped item whose power fires, before the fight's line.                                                                                                                  | 4% of the fights     |
| `<player> [L<n>] sconfigge <enemy> [L<n>]!`                   | The fight is won. The player is named by their game name and level, which the line gives and no other does.                                                                        | 2/3 of the fights    |
| ` Hai imparato qualcosa di nuovo... (+<n>)`                   | Ends a won fight's line, most of the time: the XP the win gives besides the turn's (§5.4).                                                                                         | 3/4 of the wins      |
| `<enemy> [L<n>] sconfigge <player> [L<n>]!`                   | The fight is lost, then `Torni a casa dolorante e a mani vuote...` (a rest of 30 minutes, §2).                                                                                     | 1/3 of the fights    |
| `Nessuno dei due sembra avere la meglio...`                   | A draw, then `L'oggetto si perde nello scontro...`: the item is lost.                                                                                                              | 1.6% of the fights   |
| `Hai ottenuto [<n>x ]<item> [(<a> - <b>) ]<rarity>[ <tag>…]!` | The gain. `<n>x` is how many (1 without); `(a - b)` follows an equippable item's name, two numbers whose meaning is unknown [?]; the tags are `[usabile]`, `[equipaggiabile 🗡]`, … | 72% of the turns     |
| `🎉 Congratulazioni, hai raggiunto il livello <n>! 🎉`        | A level-up, after the gain, then `Ottieni:` and a list of `> ` lines: `> <n> monete`, `> <n> punto /abilita` (`punti`) and items (`> 1 <item> [<rarity>]…`).                       | 110 turns            |

**A turn's answer is a photo** [M], its caption the reply above: all 737 of the bot's answers to a
turn in the one export that holds its photos (22–26 Oct 2026). The picture is the **story's**, not
the place's: 143 stories told over those days, each with its picture (140 always the same one), at
whatever place it was told; a turn that meets an enemy shows **the enemy's** instead (13 enemies,
one picture each, the same at every place). Of 211 turns at a place whose own picture is known, 16
showed it (stories that have none of their own, it seems [?]). So the state takes no place's picture
from a turn (§6.2).

Besides these, a turn's reply may be:

- the "too soon" (§2), 25% of the replies, with its wait:
  `Riprova fra 4 ore, 8 minuti e 23 secondi.` (the units are separated by commas or by "e"),
  sometimes followed by a line of the bot's own;
- `Stai calmo maschio...` and `Non sei registrato!`;
- **cut off** [M]: the bot's reply is cut where Telegram cuts a caption, at 1024 characters, when
  its story is long (0.3% of the replies, the latest on 6 Nov 2026), often just before the gain, so
  that it ends in `Hai ott`. Its place and its fight, if they came first, are still read; its
  outcome is lost, and the parser reads it as `nothing` with the reason `truncated`.

**Not read**, and so reported as drift (P5): the bot's failures, which end no turn:
`Nessun oggetto nel pool!`, `Manda un'immagine valida!`, and JavaScript errors the bot leaks
(`Cannot read properties of …`); under 0.1% of the replies.

### 5.1 Bans

`Sei stato bannato fino al <date>.` [M] is the bot's answer to **every message** of a banned player,
not only to a turn: the replies in the exports (two players, Feb and Oct–Nov 2026) answer a `/lore`
or `/avventura`, a command of another bot (`/pesca`, `/take`) and a plain word in the chat alike. So
a ban is read off any reply of the bot:

- **The date** is `DD/MM/YYYY`, or `DD/MM/YYYY, HH:MM:SS`. It is read on Rome's clock [?], and a
  date alone as the **end of that day**: the bot answered with the ban through the day itself, so
  midnight cannot be its end.
- **The bot lifts bans early** [M], with no word: of the bans measured, most ended before the end
  they named (one by hours), and a player was served between two replies of the same ban. So the
  date is an upper bound, and a reply that is anything but a ban to a banned player ends their ban.
- **In private** the reply is the owner's. **In the group** it replies to the banned player's
  message and names nobody: the player is the sender of the message replied to, which the parser
  remembers as it hears (the last 5,000 messages), so it needs the group's chat edge to deliver
  every sender, not only the bot's and the owner's. A reply to a message it did not hear is no
  one's.
- **The owner's turn** answered with a ban is the outcome `banned` (with its `until`), declared a
  refusal (`reason: banned`, MegaBotTron1999's bot-os.md D98), not an `ok`; the state below holds
  the bot's commands until `until` (the shell's outbox holds nothing back, its D142).
- **The owner's readiness in `loregame-state`** (MegaBotTron1999's bot-os.md D141), which the
  shell's `player` asks before each command (`state.ready`), holds every command until the owner's
  ban ends: the state folds the owner's `loregame.ban` in, and lifts it on their `loregame.unban`.
  The player never sends into a ban, and plays again at its end, or when the bot serves the owner
  again.
- **`loregame.ban` and `loregame.unban`** are the parser's events for any player, each when a ban
  starts, changes or ends (a banned player's hundred replies are one `ban`): `loregame-state` keeps
  them (§6). The parser keeps the bans it knows across restarts.

### 5.2 The accumulo

`/accumulo` (`/acc` is two in three of its uses [M]) is unlocked at level 4. The bot's help says it
charges by one at each `/lore`, and that once full, `/accumulo` zeroes the rest of the next `/lore`.

- **The count** [M] follows the player's turns: over some 3,400 counters the bot gave, the rise
  since the last one equals the turns the player took in 99% of them. It needs **20 turns**, and
  fewer with the Stoccaggio skill of `/abilita` (`🔋 Stoccaggio … -N Accumulo massimo necessario`;
  19, 18 and 17 are in the exports). It does not stop at the maximum: a full accumulo keeps charging
  until it is used.
- **The turn's line**, `🔋 /accumulo pronto!`, is there from the turn that fills it, and on the
  turns after until it is used (97% of them [M]). It came on 15 Feb 2026, when the second 🔋 also
  left the bot's use message. It is a line like any story line, so it can be quoted: 53 turns carry
  it 33 or 34 times [M], which the bot never does, and a single copy can be quoted too (the cases
  the state's `drift` shows). The parser reads the line in a turn that has a place, and says whether
  it is `sure` (one copy). A turn cut off at Telegram's limit loses it with its ending.
- **The answers to `/accumulo`** are four, each the whole message:

| Reply                                                                                       | Means                                                         |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Accumulo non ancora sufficiente!` and `Il tuo accumulo: <n>/<max>`, after a blank line     | Not yet: `n` of the `max` it needs                            |
| `La lore è già pronta!` and the same counter                                                | Refused: full, but the turn is not resting, so nothing to end |
| `🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore` | Used: the rest is zeroed, the count starts again from 0       |
| `Devi essere almeno di livello 4!`                                                          | Under the level; the sentence is shared with other commands'  |

- **Whose answer it is.** In private it is the owner's. In the group, since 7 Feb 2026 [M] the bot
  no longer replies to the command: the answer is a message of its own that follows it, within 10
  seconds in 99.8% of 5,400 answers. The parser pairs each answer with the oldest command waiting in
  that chat, the way the bot answers them, on the bot's clock across an outage (§5.15) (a ban it
  replies to the command with ends that command's wait). It therefore needs, like the bans (§5.1),
  the group's chat edge to deliver every sender: it cannot tell an answer to the owner from one to
  another player when it does not hear the other player's command. The level gate counts only as an
  answer to the command.
- **`loregame.accumulo`** carries the owner's answers (`result`: `short`, `idle`, `used`, `locked`;
  `count`, `max`, `level`), as the parser's event; the turn's line is `accumulo` in the outcome of
  `loregame.turn`. `loregame-state` counts against them (§6).
- **Played by the shell's `player`**, bound to `loregame-state` (D141): the parser names
  `/accumulo`, with `/acc` its alias (one command, one state, D140), in its vocabulary, and the
  state declares its mechanics (D132, D137): unlocked by the bot's own line on a turn (not a pattern
  on the text, which a quoted story would match). **It is legal only while `/lore` rests** [M]: the
  bot refuses it otherwise ("already ready": all 10 such answers in the exports came with the turn
  free, the last in July 2026, and spent nothing, the accumulo used later with no turn between), and
  every one of the 1,446 uses it answered came while the turn rested but two, minutes after the rest
  the state predicted, a turn unseen as likely. So the state reports it not ready while the turn is
  free (`/lore is not resting: nothing to end`), and declares no effect for the player to derive a
  condition from: legal, the player plays it at once; illegal, it is not offered. A use is the
  success, and ends the turns' rest (the state's rule). **"Not yet" and the level gate hold it for
  no time:** each withdraws its unlock, and only the bot's line on a turn unlocks it again (a line
  comes only full, so at the level). The turns it lacks come when they are played, not on a clock; a
  guess at 15 minutes a turn held a full accumulo 5 minutes past its line. **A whole turn of the
  owner's without the line withdraws its unlock too** (one cut off, or quoting the line, says
  nothing): the bot's word that it is not full, whatever the state believed, so a use whose answer
  the account missed, or a start that knew nothing, never leaves it offered. The line is missing
  from 3% of the turns while full (above): such a turn holds it until the next line, a turn later.
  The owner's own answer, by hand or in the group (where the shell cannot pair it), counts the same:
  the state folds `loregame.accumulo` into the readiness, a use ending the turns' rest. A player in
  the group (D139): the bot answers its `/accumulo` with a message of its own, so the parser pairs
  it with the send the player tells it of (through the state), declares it the answer
  (`loregame.accumulo`), and the state frees the turn.

**Not read yet**: Stoccaggio itself (the maximum is the one the bot's counter states, else the usual
20). The level is read off any level-up the parser can place (§5.4).

### 5.3 The training

`/allenati` trains the player once a day [M]: measured over 225 commands of the exports' players
(Oct–Nov 2026), in private and in the group.

- **Its wait is a day after the last success**, to the second: every "too soon" states the time
  left, and of the 99 that follow a training seen, 97 end within two minutes of a day after it, and
  the other two later (a training in private, which the account does not read); none sooner. The day
  is not a calendar one: a training at 15:30 allows the next at 15:30.
- **The answers**, each the whole message:

| Reply                                                                                      | Means                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `🏋🏼 Ti sei allenato nella palestra di <faction>! Hai imparato qualcosa di nuovo... (+<n>)` | Trained, in their faction's gym (+15 in the exports)        |
| `🏋🏼 Ti sei allenato! Hai imparato qualcosa di nuovo... (+<n>)`                             | Trained, with no faction (+10)                              |
| then `💪🏻 +<n> extra`, or a level-up (§5) after a blank line                                | A bonus [?] (7 of 118), and the level it reached (4 of 118) |
| `Non è passato abbastanza tempo dal tuo ultimo allenamento! Riprova fra <wait>.`           | Too soon: the wait left, written as the turn's (§5)         |

- **Whose answer it is.** The success is a message of its own, **not a reply**, in private and in
  the group alike (all 118), within two seconds of the command; "too soon" replies to it. So it is
  paired as the accumulo's answers are (§5.2): in private it is the owner's, in the group the oldest
  command waiting in that chat, which needs the group's chat edge to deliver every sender. Nothing
  in it says who trained.
- **`loregame.training`** carries every player's answer the parser pairs, the owner's included
  (`player`, `owner`, `result`: `trained` with `gym`, `learned`, `extra` and its `levelUp`, or
  `soon` with `retryMs`).
- **Played by the shell's `player`**, as the accumulo (§5.2): the parser names `/allenati` in its
  vocabulary, and `loregame-state` declares its mechanics, a cooldown of a day (`cooldownMin: 1440`)
  after each success. A training is the success; "too soon" holds it for the wait it states. The
  owner's training, by hand or in the group, where the shell cannot pair it, counts the same: the
  state folds the owner's `loregame.training` into the readiness, and declares it the command's
  answer to the outbox.

**What it gives** [M]: the `+<n>` is XP, kept for good (the profile's ⚔️, §5.4, §5.5): 10 without a
faction, 15 in a faction's gym. **The extra is part of it**: the skill 💪🏻 Calistenico raises what a
training gives (`+2 Forza extra dall'allenamento` a level, §5.6: "Forza" is the training's award,
not a stat of the player), and `💪🏻 +2 extra` says how much of the `+<n>` it added. Every training
with `+2 extra` gave 2 more than its kind without: 17 in a gym (5 of them), 12 without one (2); and
over every interval between the owner's profiles since October, a training rose their ⚔️ by its
`+<n>`, the extra no more.

### 5.4 Level-ups and XP

**A level-up** ends a message of the bot's: `🎉 Congratulazioni, hai raggiunto il livello <n>! 🎉`,
then `Ottieni:` and its list (§5). In the exports since October it ends turns and trainings alone,
but it is not tied to them: the parser reads it off **any** message of the bot's that ends in one,
whatever brought it, and publishes it as an event of its own, `loregame.levelUp` (`player`, `owner`,
`level`, `coins`, `skillPoints`, `items`, `other`). A level-up names nobody, so the parser places it
as it places the rest: in private the owner's; in the group the sender of the message it replies to,
whatever that message was; else the player whose training it paired (§5.3). One it cannot place is
no one's (none since October: all 21 placed [M]). The turn's and the training's outcomes still carry
the level-up they ended in, but the state reads it from `loregame.levelUp` alone, so it is counted
once.

**XP** [M] is the profile's ⚔️ (§5.5), measured over every interval between the owner's profiles
since October (25 of 25 exact), and again by `lore-check` over every player's profiles whose turns
were all seen (30 of 31; the one apart by a training's +15, in private):

- **a turn gives 1**, whatever it brings; **a fight won** gives its `+<n>` besides (none when the
  line has none); **a fight lost** takes 2 (the turn's 1 included, it costs 1);
- **a training** gives its `+<n>`, and not its extra (§5.3);
- a draw, and a turn cut off before its fight ends, are not measured yet.

**The levels** [M] are fixed: a player holds **53 × (level − 1)²** XP at the start of a level (0,
53, 212, 477, 848, 1,325, 1,908, 2,597, 3,392, 4,293, 5,300, …), and the profile's bar is the share
of the way to the next, to two decimals: exact in all 239 profiles since August 2026 (the season
before had other levels). The state counts the XP it sees each player gain and, at each level-up,
how much it saw since the one before; with a profile, it holds their total (§6.1).

### 5.5 The profile

`/info` and `/me` give the player's own profile, `/info <username>` another's [M]: 458 in the
exports (January–November 2026), every line read. Since August 2026 it replies to the command
(February to July, in the group, it was a message of its own); either way its first line names its
player, so the parser needs no pairing: any profile of the bot's, in any chat, is its player's. The
lines are read by what they say, not where they stand (the season before had the alignment first, no
⚔️ and no bar), and a line read as nothing is kept as `unread`:

| Line                                             | What it is                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `👤 <username>`                                  | The player, by username (the argument of `/info <username>`, in all 76 cases with one).                                                                                                                                                                |
| `👥 <company>`                                   | Their company; `Nessuna azienda` (before: `Nessun clan`), none.                                                                                                                                                                                        |
| `Livello <n> (<xp> ⚔️)`                          | Level and XP (§5.4); numbers in the thousands are written `4.614`.                                                                                                                                                                                     |
| `▓▓▓░░░░░░░ <pct>%`                              | The way to the next level (§5.4); its ▓ are the tens of the percentage.                                                                                                                                                                                |
| `Il Bene 😇`, `Il Male 👿`, `Il Neutrale 👤`     | Alignment.                                                                                                                                                                                                                                             |
| `Episodio <n>`                                   | The turns they took [M]: it rose by the owner's turns seen, exactly, in 24 of 25 intervals.                                                                                                                                                            |
| `<n> Ricette completate`                         | Recipes completed (since September 2026).                                                                                                                                                                                                              |
| `<n> ₭`                                          | Coins.                                                                                                                                                                                                                                                 |
| `Ossessionato da <item> x<n>`                    | An obsession, if any.                                                                                                                                                                                                                                  |
| `Armatura 🛡 - …`, `Amuleto 🩺 - …`, `Arma 🗡 - …` | Equipped (🥋 the armour's emoji before February): `(vuoto)`, empty; else the item and its level range, `(a - b)`, rolled when `/generaequipaggiamento` makes it, or `(n)`, a range of one (no range is ever written `(n - n)`: 3,736 seen, all a < b). |
| `<emoji> <skill> <I–V>`                          | The skills of `/abilita`, each with its level: 🎒 Sciacallaggio, 🎯 Ricercato, 🖌 Creatività, 🖌 Ispirazione, 🔋 Stoccaggio, 💪🏻 Calistenico.                                                                                                             |
| `🎭 Effetti`, then `  - <effect> (<time left>)`  | Effects, with the time left in the turn's words (§2); only "Neutralizzato" seen.                                                                                                                                                                       |
| `🎖️ Titoli`, then `  - <title>`                  | Titles: players write them, so they are kept as they are.                                                                                                                                                                                              |
| `Attualmente in <place> [<code>]`                | Where they are.                                                                                                                                                                                                                                        |

`👤 Configurazioni giocatore` (the settings) also starts with 👤, and is not a profile. What each
skill does, the `/abilita` menu says (§5.6).

**`loregame.profile`** carries every profile the parser reads (`player`, `owner`, and each line's
value: `company`, `level`, `xp`, `progress`, `alignment`, `episode`, `recipes`, `coins`,
`obsession`, `equipment`, `skills`, `effects`, `titles`, `location`, `unread`).

### 5.6 The skills menu

`/abilita` [M] answers with a menu, always replying to the command (139 in the exports, every line
read): each skill a player may raise, those at no level too, then the points left to spend, and the
buttons to spend them:

```
🎒 Sciacallaggio II (2/5) +10% Probabilità di trovare oggetti rari
🖌 Ispirazione Ø (0/5) +0% Probabilità di trovare generatori
🔋 Stoccaggio I (1/5) -1 Accumulo massimo necessario
🎯 Ricercato Ø (0/5) +0% Probabilità di incontrare guardiani
💪🏻 Calistenico I (1/5) +2 Forza extra dall'allenamento

Punti disponibili: 1
```

A level a step each, the same in every menu since February: Sciacallaggio +5% (+10% in January),
Creatività, Ispirazione after it (September), +10%, Ricercato +6%, **Stoccaggio −1 to what the
accumulo needs** (§5.2), **Calistenico +2 to what each training gives** (§5.3, since October). `Ø`
is no level. A level-up gives the points (§5).

**A point is spent with the menu's buttons**, which the bot answers by editing the menu: no message
of its own, and nothing of the button pressed reaches the account. The parser follows the menu
through its edits (MegaBotTron1999's D144: a plugin asks for edits, which nothing else reads, as the
game ignores a command edited): each edit of a menu replying to a player's `/abilita` is that
player's menu now, at the edit's time [?] (built on a simulation: no edit was recorded, the exports
showing each message as it was last edited, so the menus they hold are the ones after the purchase).
Every other edit is ignored. A skill raised, as many levels as the points fell (a menu), or no more
than the points held (a profile, which does not show them, and then has them spent), is a purchase,
not a mismatch (§6.1): what the state does with an edit, and with a menu or profile when an edit was
missed (a shell before D144, the instance down).

**`loregame.skills`** carries every menu the parser reads, the player's whose `/abilita` it replies
to (in private, the owner's): each skill (`name`, `level`, `max`, `effect`: `value`, `unit`, `what`)
and `points`; `edited` for a menu as a button changed it.

### 5.7 `/equipaggia`

`/equipaggia <item>` [M] equips an item, in the slot it goes in, taking off the one there:
`Hai rimosso <old>!` then `Hai equipaggiato <new>!`, or the latter alone; an item worn already is
taken off (`Hai rimosso <item>!` alone). Without an item, the bot lists the three slots, as the
profile does (`Formato non valido! /equipaggia {oggetto}` and the slots). Its refusals change
nothing: `Non hai il livello necessario…`, `Non possiedi l'oggetto!`,
`L'oggetto non è equipaggiabile!`, `Hai già equipaggiato questo oggetto!`,
`Troppi oggetti trovati con quel nome (…)` and its list. Every answer replies to the command (64 in
the exports; the ones read, every line).

The answer names no slot and no level range: the state takes them from what it saw of the item (the
slot of the item it replaced; a profile or a listing that showed it worn; the owner's drop's tag,
`[equipaggiabile 🗡]`), and leaves the equipment not exact when it cannot tell (§6.1).

**`loregame.equipment`** carries every answer that changes or lists the equipment, the player's
whose `/equipaggia` it replies to (in private, the owner's): `kind` (`equipped`, with `item` and the
`removed` one; `removed`, with `item`; `listing`, with `equipment`). A refusal is not read: other
commands' answers share its words.

### 5.8 The inventory

`/zaino` and `/i` [M] list a player's inventory (546 in the exports, every line read but two "Stai
calmo maschio..."), replying to the command: the first page names its player, after the filter if
one was given (`/i <text>`, a part of the name: `Filtri attivi: <text>`), then an item a line:

```
bob, hai:
> un generatore di oggetti [X] [generatore] x3
> un mestolo (2 - 6) [M2] [equipaggiabile 🗡] x1
> una pigna [B1] x4
```

`<player>, il tuo inventario è vuoto!` for none. An equippable item's name ends in its level range
(§5.7); a name may run over several lines (players write them), the item ending at the line that
ends in its rarity, tags and count. The items come sorted [owner]: the generators, then by the
season's level whatever its faction, then the special ones, each by count, most first.

**Its pages.** A long inventory is paged: its ◀️ and ▶️ buttons turn the page, which the bot does by
editing the message, each button a 🔒 at the first and the last page [owner]; an inventory short
enough for one page shows no buttons at all [owner]; the text says nothing of its page, and only the
first names its player (the pages' length varies, 27 to 35 lines for a first page in the exports, so
the text cannot tell a full page from a whole list). A page is cut by lines, so a name running over
several lines may be cut between two pages (6 of the exports' listings). The parser reads every page
as it comes, the first from the message and each turned from its edit (MegaBotTron1999's D144), and
which page it is from its buttons (D145: the first has no ◀️, the last no ▶️; none at all, `[]`, is
one page, the whole list); a later page is the player's whose first page it follows, or whose
command it replies to.

**`loregame.inventory`** carries every listing and page the parser reads: `player`, `owner`,
`filter`, `items` (each `item`, `qty`, `rarity`, `tags`, `level`), `cut` (an item cut between this
page and another, not read), `page` (`first`, `last`, both for a listing without buttons; none when
its buttons are not known: an export, a shell before MegaBotTron1999 0.1.47), `message` (whose edits
its pages are) and `edited`.

### 5.9 The places

The game's places ("stagioni") ask a level and items to enter, consumed at the arrival [M]:

- **`/vai <place>`** moves (its answer replies to the command):
  `WOOSH! Sei arrivato alla Stagione <place> [<code>]!`, then, when entering took items,
  `Per entrare, hai consumato i seguenti oggetti` and the items, one each (91 of the 158 arrivals in
  the exports). Refused: `Non hai accesso a <place> [<code>]!` and the place's requirements. The
  place is matched among the exits of where one is alone, by any part of its name or code (the place
  one is at is none of them): any other is `Stagione non trovata!`, which changes nothing.
- **`/v`** says where one is: `Ti trovi nella stagione <place> [<code>]`, its requirements, then
  where one can go (`Puoi andare in:`, each place, `🔒` if locked to them) or
  `Nessuna stagione disponibile!`. The requirements
  (`Requisiti d'accesso (oggetti consumati all'arrivo)`, the level and the items) are read if there:
  no card in the owner's export of October–November 2026 carries them (every one goes straight to
  `Puoi andare in:`).
- **An arrival and a `/v` are a photo of the place** [M], their text its caption: the arrival and
  the three `/v` the exports hold photos of (two places) showed the place's picture, the arrival the
  same as the place's creation card (below).
- **A place's requirements**
  (`Requisiti d'accesso per <place> [<code>] (oggetti consumati all'arrivo)`, then `> Livello <n>`
  and the items, under `Ti serve:` and `Hai già:` in a refusal) are read wherever the bot states
  them: a refusal, an answer that changed them
  (`La modalità d'accesso alla stagione [<code>] è cambiata!`, a generator's; none in the owner's
  export of October–November 2026), and **the answer to `/requisiti <name>`** (alias `/req`), the
  block alone, split by what the asking player holds as a refusal's is (both lists are the place's
  requirements). `/requisiti` matches a place by a part of its name, not its code; any other query
  is `Elemento non trovato o utente non registrato!` (5 of the 9 in that export, `/req` one of
  them), which tells nothing and is not read. A place that asks no item lists its level alone
  (`> Livello <n>`). The parser names `/requisiti` among its bot's commands and the state declares
  it `interactive` (it needs a place's name): a shell `player` never plays it unless the owner ticks
  it. An item's name may run over several lines. A requirement may be a condition, not an item:
  `> Almeno un guardiano [generato da] [<code>]` (57 in the exports): **a guardian made at that
  place, by anyone**, with `/generaguardiano` and a `generatore di guardiani`, standing there. It is
  listed under `Hai già:` for every player once one is: the owner's refusals listed it so from their
  third day in the game, who never made one, and another player's months before their first; the
  first one made at a place turns `Ti serve:` into `Hai già:` for the next refused (a refusal for
  one from `N2`, one made at `N2`, the place entered two minutes later). Entering does not consume
  it. **A neutral place does not ask it of a faction's player**, there with a ticket: their refusals
  for `N2` listed its item alone, a guardian from `N1` made days before (`Il Neutrale`'s player was
  asked it). The guardians made are the enemies the players meet in their turns: in the bot's help,
  one turn in 10 meets an enemy, "generalmente un guardiano della fazione rivale", and a fight won
  gives two items and combat strength, a draw nothing, a fight lost doubles the next turn's wait
  (the skill Ricercato: "Probabilità di incontrare guardiani"). The making is confirmed by a button
  (`Stai per generare il guardiano <name>. Sei sicuro?`), then
  `La tua idea si materializza... hai generato il guardiano <name> [L<n>]!`, which replies to no
  command: not read. Every answer and block in the exports is read: 714 answers, 280 blocks, 859
  items.
- **The places are made by the players** (`/generastagione`, a name, an emoji, an image, then
  `Stai per generare la stagione <name>. Sei sicuro?`). **Its creation card** is the generator's
  outcome (§5.13), `La tua idea si materializza... hai generato la stagione <name> [<code>]!`, a
  photo of the image given [M: the one in the exports' photos], the earliest sight of the place's
  picture: a ladder's next step, its requirements at first a guardian of the step before (`N3`, made
  at `N2`). The generators work in one's faction's places alone, none in a neutral one
  (`Non puoi generare oggetti in questa stagione!`, a ticket's player at `N1`). **The game was reset
  on 17 August 2026** (`Stai per resettare TUTTO...`, its second season): every place since is new,
  and `M7` was `Il laboratorio segreto di Kia 🧪` (asking 6 items) before it and `Il Paradiso 2 ⛅️`
  (entered with none consumed) after; each place is as last told.
- **Requirements change unannounced** [M]: the game's help says that generated items may become a
  place's requirements as it goes on
  (`Le meccaniche di gioco cambiano automaticamente col tempo. Alcuni oggetti generati potrebbero diventare requisiti di accesso a una stagione specifica (luogo), …`),
  and nothing tells when one does: a generator's confirmation names the place an item is made for
  (`Stai per generare l'oggetto <name> per la stagione <place> [<code>]. Sei sicuro?`), not that it
  is asked there, and no message of the bot's in that export announces a change. A change is seen
  only in the next statement: a place's refusal listed a guardian alone, another four minutes later
  its item too; another's arrival consumed nothing, and its refusal the next day asked an item. So
  the state takes each statement, and each arrival, as the place's requirements now, the newer
  replacing the older; an item's name that speaks of a place, or what players write, is never taken
  for one. In that export, every place's requirements but `B1`'s and `N2`'s are told (a refusal, a
  `/requisiti` or an arrival); the evil ladder's `M3`–`M8` and `N1` only by arrivals, which tell no
  level.

**The rules of a move** [M], from every arrival in the exports with the player's place before it:

- **Entering a place takes its items, whichever way one comes**, up or down: every arrival since
  March 2026 whose place's requirements had been told in the 3 days before it consumed exactly those
  items, one each, guardians aside (41 of 41: 35 up, 6 down; three in February 2026, under older
  rules, did not). A move down is refused too, for the items one lacks. A requirements list older
  than that misleads: the items change as players generate (an item added for a faction's place at a
  season the game picks), so each place's are as last told, and an arrival tells them anew (what it
  consumed is what the place takes; nothing consumed, nothing).
- **The ladders:** the places are three ladders, the good's `B1`, `B2`, …, the evil's `M1`, …, and
  the neutral `N1`, …; each place leads to the step before and after it in its own (`/v`'s exits,
  every one in the exports), and some neutral places to the same step of the factions' ladders:
  since the reset, `N1` to `B1` and `M1`, and `N2` to `B2` and `M2`, listed from both sides; `N3` to
  `N2` alone (`B3` and `M3` list no `N3`). Before it, `M10` led to `N10`. A place a player may not
  enter now (its requirements not met, or a neutral one without the effect) is listed with `🔒`. **A
  sideways step takes its place's items as any other:** from `N10`, `M10` took its items (before the
  reset).
- **Three factions:** `Il Bene` (`B`), `Il Male` (`M`) and `Il Neutrale` (`N`, the profile's
  `Il Neutrale 👤`). A player of `Il Neutrale` climbs the neutral ladder as the others theirs, its
  items paid (`N2`, then `N3`), with no ticket; from `N2` the factions' `M2` and `B2` were listed
  locked to them (never tried).
- **Neutrality:** a faction's player enters the neutral ladder only while the effect `Neutralizzato`
  lasts (`N1` is listed locked otherwise, and open with it; from `N1`, they are shown their own
  faction's `B1` or `M1` alone, and `N2`). A `un biglietto neutralizzante 🎫 [X] [usabile]` (the
  shop sells it, 300₭) gives it, used with `/usa`:
  `<username>, prendi il biglietto ma ti sbriciola in mano! Aspetta, ti sta succedendo qualcosa di strano... perché hai perso colore?`,
  a message of its own, naming its player (23 in the exports). It does not move them: they go with
  `/vai`. It lasts **10 hours, and each ticket more adds 10** (two used a few seconds apart ended 20
  hours later; a profile's time left agrees). At its end, at the next whole minute, the bot tells
  the player alone, in private: `[N] Hai ripreso colore e sei stato buttato fuori dalla neutralità!`
  (4 of 4 of the owner's), and a player in a neutral place is back in their faction's: from `N1`,
  `B1` or `M1` (their next turn's place, every time). The `[N] ` is the bot's mark of a notification
  (a gift's, §5.10).
- **What a ticket was used for** (the 23 uses, 9 players): to enter `N1`, free, from `B1` or `M1`
  (its items none), and play its turns; and back and forth while it lasts (`N1` to `M1` and back,
  free both ways, before the end). Players went down their ladder to `M1` (one from `M10`), paying
  every step's items, to use one, and up again after, paying again. No ticket's player entered `N2`:
  the two who tried (one from `N1`, one straight from `M2`, a ticket used there) were refused it for
  its item alone (`una forchetta da surf 🥄 [N2]`). No player but one of `Il Neutrale` ever played a
  turn at `N2` or `N3`. So whether a step climbed on the neutral ladder is kept at the end (thrown
  out to `B2` from `N2`, its items unpaid) is not seen. Before the reset, the moves followed other
  rules: `M10` to `N10` free, a player at `N5` a month.
- **Not every move is in the exports:** a player may play in private with the bot, which the exports
  do not hold but for the owner's (one was at `N1`, then at `M6` 20 minutes later, no move seen).

**`loregame.travel`** carries a player's answer (the one whose `/vai` or `/v` it replies to): `kind`
(`arrived`, with what entering `consumed`; `here`, with the place's `requirements` and its `exits`;
`refused`, with the `requirements`, whose `met` is the guardians already made), `place`, and
`answer`, the answer's message id (its photo, §6.2). **`loregame.requirements`** carries any
place's: `place`, `level`, `items`, `guardians` (each a place's code) and `met` (the guardians
already made, where the block is split; the same for every player). **`loregame.neutral`** carries a
ticket used (`neutralized`, its player by the name the answer gives) and the owner's neutrality
ended (`restored`, heard in private alone): `player`, `owner`, `kind`. A guardian made is read from
its generator's outcome (§5.13). **Not read yet:** where a player thrown out of a neutral place
above `N1` lands (the state guesses the same step of their faction's ladder).

### 5.10 Gifts

`/give` and `/dai` [M] send items or coins to another player:
`Hai inviato <n>x <item> [<rarity>] [<tag>]… a <username>!`, or
`Hai inviato <n> monete a <username>!`, at times after `[N] ` (the bot's mark of a notification,
§5.9). The receiver is named as the giver typed them (an `@`, any case). The answer names the
receiver, not the giver, and since August 2026 it replies to no command (all 209 since then): the
parser pairs it with the command waiting, as the accumulo's answers (§5.2). Its refusals
(`Formato non valido!`, `Oggetto non trovato!`, `Non possiedi l'oggetto!`,
`Elemento non trovato o utente non registrato!`, …) change nothing, and are not read. All 388 gifts
in the group's exports are read, 45 of coins.

**Each side is also told in private** [M]: the giver `[N] Hai inviato …`, the same text as the
answer, and the receiver `[N] Hai ricevuto <n>x <item> [<rarity>] [<tag>]… da <username>!` (or
`<n> monete`), the giver by username, seconds after the answer in the group (2 s, in the owner's
private export). So the owner hears a gift they give or receive in the group twice, its answer there
and its notice in private, and one given them in private once, its notice. Whether the owner's own
gift played in private brings a notice besides its answer is not seen [?]; if it did, the rule below
drops it. **The parser gives each gift of the owner's once**, whichever of its messages it hears, in
whichever order:

- A private `Hai inviato` that answers no command known to wait is the owner's, and a private
  `Hai ricevuto` is a gift to the owner from the player it names.
- An answer paired with its command and a notice that answers none tell the same gift when they
  agree on its way (the owner's to the same receiver, or another's to the owner), its item, rarity
  and quantity, or its coins, and come within a minute of each other: the second heard is dropped. A
  giver named alike is paired first (an export names the group's players by display name, the notice
  by username).
- Each message pairs once: two like gifts in a row are two answers and two notices, two gifts. Two
  answers never pair, each having answered its own command, nor two notices. A gift heard once is
  given; one whose two messages came more than a minute apart would be counted twice (none seen).
- Other players' gifts have no notice the owner hears, and are given as answered.

**`loregame.gift`** carries every gift the parser pairs, or the owner's notice of one, once: the
giver (`player`, `owner`), `kind` (`item`, with `item`, `qty`, `rarity`, `tags`, `level`; `coins`,
with `coins`), `to` and `toOwner` (a notice received names the owner as `to`), from whichever of its
messages came first (`chat`). The state moves the items from the giver's inventory to the
receiver's, or the coins from the one's `coins` to the other's; the receiver known whatever the case
of their name.

### 5.11 The market

The "📈 Mercato Fazionario 📉" [M] quotes the companies the players make (`/creaazienda`: a name, an
emoji, 1.000 ₭) and run (a leader, up to 20 members, of any faction). A company is named as the
market writes it, its emoji included (`F.R.O.D.E. Capital Partners ⚖️`), and its leader renames it
at times: one took five names in ten days of September 2026 (`⚖️`, `✡️ ⚖️`, `🩲💼 ⚖️`, `📈 … ⏫ ⚖️`,
`⚖️` again), then kept one for months, a person's doing, not the bot's; no other was renamed. Every
message of the market in the exports is read (615: 372 updates, 142 markets, 54 investments, 27
withdrawals, 20 company pages):

- **An update**, a message of the bot's own: `📈 Mercato Fazionario 📉 aggiornato!`, then a line a
  company, `↗ <company>: <value> (<change>, <pct>%)`, its arrow the direction (`↗` up, `↘` down, `→`
  flat), the change since the update before. Every 6 hours, at the same hours of the bot's clock
  (Italy's: 22, 4, 10 and 16 UTC until the end of summer time, 23, 5, 11 and 17 after; 286 of the
  exports'); and out of turn when its developer asks (`/aggiornaborsa`, `/aggiornamercato`, 60; a
  player's is refused, "Questo comando è riservato allo sviluppatore.").
- **The market**, `/mercato` or `/borsa`: `📈 Mercato Fazionario 📉`, the same lines (or
  `Nessuna azienda quotata.`, and nothing more), then the asker's investments,
  `I tuoi investimenti`, a line each, `> <company>: <n> ₭ investiti, valore <n> ₭ (<pct>%)`, and
  `Totale investito`, `Valore attuale`; or `Non hai investimenti attivi.`
- **An investment**, `/punta` or `/investi` `<n> <company>`: `Hai puntato <n> ₭ su <company>.`,
  `Totale investito: <n> ₭ al valore iniziale <value>.`, `Ti rimangono <n> ₭.` One open a company:
  another is refused (`Hai gia' una puntata aperta su questa azienda!`). An investment is worth what
  is invested, times the company's value over the one it was entered at.
- **A withdrawal**, `/riscuoti` or `/ritira`: of a part or of one,
  `Hai riscosso <n> ₭ da <company>.`, `Incasso: <n> ₭ (<pct>%).`, and, for a part,
  `Valore rimasto: <n> ₭.`; of all,
  `Hai riscosso tutti gli investimenti dal 📈 Mercato Fazionario 📉.`, a line each,
  `> <company>: <n> ₭ investiti, incasso <n> ₭`, and `Totale ritirato`, `Incasso totale`.
- **A company's page**, `/azienda`: `Azienda <name> (<members>/<max>)`, `👑 <leader>`, `⚔️ <power>`,
  `👥 <n> membri`, a line a member, `- <faction> <player> [L<level>] (<power> ⚔️)`,
  `📈 Valore: <value>`, at times `Profilo: <profile>`. It names the company without its emoji.

None of the answers replies to its command: each follows it within seconds, and the parser pairs it
with the command waiting, as the accumulo's answers (§5.2); an update needs none. Their refusals
(`Quantità non valida!`, `Non hai abbastanza soldi!`, `Azienda non trovata!`,
`Troppe aziende trovate per …`, `Non hai investimenti in questa azienda!`, `Non sei in un'azienda!`)
change nothing, and are not read. Numbers are written with the bot's thousands (`1.341`),
percentages with a decimal point (`+9.25`).

**`loregame.market`** carries the values of every update and market listed, anyone's: `via`
(`update`, the bot's own; `forced`, one that answers its developer's command; `listing`) and
`quotes` (each `company`, `value`, `change`, `pct`, `direction`). **`loregame.investments`** carries
a player's open investments, as the market they asked for lists them (`positions`, each `company`,
`invested`, `value`, `pct`; and `total`); **`loregame.invest`** an investment (`company`, `amount`,
`invested`, `entry`, `coins`); **`loregame.cashout`** a withdrawal (`all`, and `positions`, each
`company`, `amount` of what was invested, `cashed`, and what is `left` there at its value, none when
all of it was taken): each with its `player` and `owner`. **`loregame.company`** carries a company's
page, whoever asked.

**Not supported**, as past the game's changes: the encounter of level 0 that ends in
`Ma non accade nulla...` (last seen on 3 Aug 2026), and the power line without its ⚡️ (March 2026).

The outcome the plugin publishes carries all this, as `Outcome` (`replies.ts`): a gain has its
`item` (without its count and its stats), `qty`, `rarity`, `tags` and `stats`; every outcome of a
turn has its `place`, its `fight` (`enemy`, `result`, `player`, `learned`, `powers`) and its
`levelUp` (`level`, `coins`, `skillPoints`, `items`, `other`) when the reply had them.

### 5.12 The shop

`/negozio` and `/shop` [M] list what the shop sells today (178 listings in the exports, August to
November 2026, every line read; `/store` is NorelecBot's, which @LoreGameBot answers only with a
ban, §5.1). The answer replies to the command (126 of the 133 bare `/negozio`, 49 of the 50 `/shop`;
the others are a listing edited into a purchase, below, and one answer missing), naming the player
who asked, then an item a line:

```
bob, oggi nel negozio:
- 🛒 un generatore di oggetti [X] [generatore] 100₭
- ✅ una pigna [B1] 200₭
- 🛒 un mestolo [M4] 400₭
```

- **An item's line** is `- 🛒 <item> [<rarity>][ <tag>…] <price>₭`, the price with the bot's
  thousands (`1.000₭`). A name may run over several lines (players write them), the item ending at
  the line that ends in its rarity, tags and price. The prices follow no rule measured [?]: an item
  of a rarity is sold at different prices on different days, and the generators' (`[X]`) differ by
  kind.
- **`✅` for `🛒`** marks an item the player who asked has already bought (29 listings): the list is
  otherwise the same for everyone.
- **A sagra day** (the bot's event): the answer starts with `bob, c'è la sagra <of something>!` and
  a blank line, then `oggi nel negozio:` and its list, of 10 items instead of 3. The bot announces
  the sagra in the group at midnight Italian time, as a message of its own,
  `È arrivata la sagra <of something>!` (11 in the exports, each at 00:00). Before 22 September 2026
  a sagra day's listing had 10 items without the sagra line.
- **The same shop for every player**, all day: on every day with several listings (48), they list
  the same items, `✅` aside, whoever asked and in whichever group.
- **It changes at midnight Italian time:** at each of the 75 day boundaries the exports cross, the
  last listing before midnight and the first after it differ (the closest, 23:59 and 00:01). It
  changed during a day three times (24 August, 10 and 12 September 2026: three generators' prices
  swapped, the whole list, an item's rarity), each by the bot's own data [?], not on a clock.
- **Ready again at midnight** (since game-bots 0.51.0): the parser names `/negozio` (`/shop` its
  alias) among its bot's commands, and the state declares it `resetsAt: 00:00 Europe/Rome`
  (MegaBotTron1999's D165). Any player's listing, read in any chat, counts as its use: the shop is
  the same for everyone, so the owner's own would tell nothing new until midnight. A shell `player`
  bound to the state plays it soon after each change, at its person's next sitting. The owner's
  `/negozio`, paired by the shell, is read as a success (`kind: 'shop'`; its items are
  `loregame.shop`'s); since 0.52.1: 0.51.0 left it unread, a drift notice at each listing, and past
  five in 15 minutes a stop of the parser's actors.
- **Buying** is done with the listing's buttons [M]: the bot edits the listing into
  `bob, sei sicuro di voler comprare <item> per <price> ₭?` (7 listings were last seen so in the
  exports, which show each message as it was last edited), and the purchase itself sends no message.
  **A purchase is read from the listing's edits** (MegaBotTron1999's D144), live: a confirmation
  (the player, the item with its rarity and tags, the price), then the same message edited back into
  that player's listing, the item `✅` (`🛒`: cancelled, nothing bought). An export, which keeps
  each message as it was last edited, holds none of them. `/buy` is another bot's (a fishing game's,
  whose `Hai acquistato con successo …!` the exports hold once), not @LoreGameBot's.

**`loregame.shop`** carries every listing the parser reads, in any chat, whoever asked: `player` (as
the listing names them), `owner`, `sagra` (none on an ordinary day), `items` (each `item`, `rarity`,
`tags`, `price` in coins, and `bought`, the `✅`) and `edited`. `npm run lore-check` reads every one
of the exports' 178 listings, over 76 days; the shop sold 35 items in them, 8 of them generators
(`[generatore]`). The sagra announced in the group (`È arrivata la sagra …!`) is not read: the day's
first listing names it. **`loregame.purchase`** carries each purchase read: `player`, `owner`,
`item`, `rarity`, `tags`, `price` and `qty` (1).

### 5.13 Generators and `/usa`

A generator (`[X] [generatore]`, sold at the shop, §5.12) is used by its command, `/generaoggetto`,
`/generastoria`, `/generaguardiano`, `/generastagione`, `/generautilizzo`, `/assembla`, `/duplica`
[M], and a conversation of questions; then the bot asks to confirm what it is about to make,
replying to the player's command (so it is theirs), with a button:

- `Stai per generare l'oggetto <name>[ per la stagione …]. Sei sicuro?`, `… il guardiano <name>. …`,
  `… la stagione <name>. …`, `Stai per generare una nuova storia che recita: …` (or
  `una storia [<code>] per <faction> …`, `Stai per aggiungere una storia per la stagione …`);
- `Stai per rendere usabile l'oggetto <name>. …`;
- `Stai per assemblare l'equipaggiamento <name>. L'assemblaggio consuma il generatore e <n>₭. …`,
  the only one that costs coins beside its generator;
- `Stai per duplicare l'equipaggiamento <item> dal tuo inventario. …` (a blueprint; or
  `… un equipaggiamento assemblato …`, which names none).

**The outcome** is a message of its own, replying to nothing [M: every one in the exports], seconds
after the button: `La tua idea si materializza... hai generato <item> [<rarity>]!`,
`… il guardiano <name> [L<n>]!`, `… la stagione <name> [<code>]!`, `… una nuova storia [<code>]!`;
`Oggetto reso usabile con successo!` (or `Script installato con successo!`);
`Il tuo equipaggiamento prende forma... hai assemblato e ottenuto 1x <item>!`;
`Hai duplicato <item>!`. **A season's and a story's outcome is a photo** [M]: its creation card, the
image its player gave (the one season and the one story made in the export that holds its photos;
the story's is the picture its turns then show, §5); whether a guardian's is, no export tells [?]
(none of the 17 made since the reset is in it). It may end in a reward, `Hai ottenuto <n>₭!`; a
season made ends in `Tutti i generatori di stagione de <faction> … sono stati rimossi!`: every
season generator of that faction's players is gone. The parser pairs an outcome with the
confirmation it answers (`src/generators.ts`): by the name it repeats (an equipment's or a
blueprint's by the name it starts with), or, for a story or an item made usable, which name nothing,
the oldest of its kind waiting in its chat; a confirmation waits 15 minutes. An outcome nothing
waits for is no one's. Each generator used is one of its kind consumed (`un generatore di oggetti`,
`… di storie`, `… di guardiani`, `… di stagioni`, `… di utilizzi`, `… di equipaggiabili`,
`… di blueprint`).

**`/usa <item>`** uses an item. Of the game's own, only two are consumed [M]: the neutrality ticket
(§5.9) and the moving box, `uno scatolone da trasloco 📦`, whose answer names its player and what it
held, an item a line (`bob, apri lo scatolone 📦 e trovi:` then `> <item>`…). An item a player made
usable (`/generautilizzo`) runs its script and stays, as many times as it is used.

Over the exports, `npm run lore-check` reads 730 confirmations (392 items, 156 stories, 72
equipment, 56 guardians, 36 made usable, 9 seasons, 9 blueprints) and 641 outcomes (the others
cancelled), every one paired with its player; and 47 boxes opened, every one read.
**`loregame.generated`** carries each outcome paired: `player`, `owner`, `kind` (`item`, `story`,
`guardian`, `season`, `utility`, `equipment`, `blueprint`), `name`, `code` (an item's rarity, a
guardian's level, a season's or a story's code), `gained` (the item it gave: equipment assembled, a
blueprint's copy; `item`, `rarity`, `tags`, `level`), `reward` and `cost` in coins, and `removed`
(the faction whose season generators went), and `answer`, the outcome's message id (its photo,
§6.2). **`loregame.used`** carries each box opened: `player`, `owner`, `item` and `found` (each
`item`, `rarity`, `tags`, `level`).

### 5.14 The recipes

A recipe takes items and gives one. Each answer names its player (`@<username>`), and replies to
nothing [M: none of the exports' does]:

```
@bob, ecco le ricette a tua disposizione:
- La zuppa del lunedì [L2] [manca 2]
- Il razzo a pedali [L1] [*]

Scrivi /ricetta <nome ricetta> per vedere quali oggetti ti mancano per una certa ricetta!
```

- **`/ricetta`** lists the game's recipes (or `Nessuna ricetta creata finora.`), **the whole
  catalogue, the same for every player** [M: every list of the owner's export of October–November
  2026 names every recipe there was then, 11 at its end]: each one's level, `[L<n>]`, and
  `[manca <n>]`, how many items they lack, the lines its answer lists as lacking [M: 34 of 34]; or
  **`[*]`, a recipe they have made already** [M], listed after the others, in place of how many they
  lack (24 in that export: every player seen making a recipe had it starred in their next list, 5 of
  5, and none seen making one lacked the mark after; `[manca 0]`, all held, is not it). The profile
  counts the recipes made (`<n> Ricette completate`), not which.
- **`/ricetta <name>`** (any part of a name) answers what a recipe lacking something lacks, then
  what is held of what it takes, each with the player's whole count (`Mentre hai già:`, absent when
  nothing is), an item a line as in an inventory (§5.8):
  `@bob, per fare la ricetta <name> ti mancano:`, `- <item> [<rarity>][ [<tag>]…] x<n>`. No item is
  listed as both [M]. A name no recipe has: `Ricetta non trovata!`.
- **A recipe made** is the same command with nothing lacking: `@bob, prendi in mano:`, the items it
  takes, each with its count, a story (`e …`), and `Ottieni: <item> [<rarity>]!`. It costs nothing
  and names no recipe [M: 7 of 7]. A recipe can be made again (one player made one twice in six
  seconds). `/generaricetta`, which creates a recipe, previews it the same way after its command
  repeated, with `Ottieni: 1x …` and `Costo: <n>₭`: not read (it creates, through buttons, and moves
  nothing yet).

Over the exports, `npm run lore-check` reads all 53 lists, 34 answers and 7 recipes made; the game
had 4 recipes, and each one made is known by the items it took. **`loregame.recipes`** carries a
list: `player`, `owner`, `recipes` (each `name`, `level`, `lacking`, none for `[*]`, and `starred`).
**`loregame.recipe`** carries an answer: `player`, `owner`, `name`, `lacking` and `held` (each
`item`, `qty`, `rarity`, `tags`, `level`). **`loregame.recipeMade`** carries a recipe made:
`player`, `owner`, `used` (each as above) and `made`.

### 5.15 Outages and replays

@LoreGameBot goes down often [M], for minutes to days, until its machine is restarted: it stops
answering, and says nothing. When it comes back it answers every message it missed, in private and
in the group, as if all had been sent that instant, so its flood guard answers most of them with
`Stai calmo maschio...`, the players who kept retrying most of all. Measured on the group's exports,
Aug–Nov 2026:

- **Live, it answers at once:** of ~19,300 commands it answers with a reply, half within 1 s, 98%
  within 2 s. About 1% are never answered, outages or not.
- **An outage is silence:** nothing at all, for 2 minutes to 14 hours in that span (two of about 14
  hours in October). Short stalls, of minutes, end the same way as long outages.
- **The replay keeps the order:** 428 replayed replies across three replays, none out of order, each
  replying to the command it answers, up to 13 hours late.
- **A replay may come in bursts with silence between:** one outage replayed 54 messages, went silent
  for 3 hours more, then replayed 326.
- **The flood guard dominates a replay:** 282 of 307 replayed answers in one burst, to 10 players.
  Outside a replay it is an ordinary refusal (`reason: calm`).
- **The bot applies a replayed command when it answers it**, as if just sent: its outcome counts
  from then, not from the command.
- For two days in August most answers did not reply to their command, the bot up throughout: a
  missing reply is no sign of an outage.

**How the parsers pair across one.** A reply names its command, so the turns' answers (§5) and the
others that reply are paired however late. The answers that do not reply (the accumulo's, §5.2, a
training's, §5.3, a gift's, §5.10, the market's, §5.11) are paired in order with the commands
waiting, and a command waits on **the bot's clock**, not the time's: how far the bot has answered in
that chat. A reply sets it to the time of the message it answers; a message of its own, to now,
while the bot is live (its clock current at its last word, a moment before), and leaves it otherwise
(while it replays, or after a silence, until a reply tells). Silent, it stops. So a command is given
up as unanswered only once the bot has answered more than 10 s past it, live or in a replay; a watch
keeps at most 1,000 waiting. An answer more than a minute after its command is marked `replayed`,
with its command's time (`asked`), in the events that carry it.

### 5.16 The bot's health

Whether the bot is answering now, from what the parser reads (`src/health.ts`), on the measures of
§5.15: live, it answers within 2 s (98%); an outage is silence, then a replay in order, maybe in
bursts. Some days it lags for minutes while live, and not replaying: so it is suspect only after 4
minutes (since game-bots 0.50.3; 60 s before), and a reply up to 4 minutes late is in time.

| State         | Entered when                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `up`          | a reply within 4 minutes of what it answers (from any state); at the start, until told otherwise                              |
| `suspect`     | up, and the bot has said nothing for 4 minutes since one of its commands was sent (any player's, in any chat read)            |
| `down`        | suspect, and a command sent since went unanswered for 2 minutes, or 8 minutes of silence; catching up, 8 minutes of silence   |
| `catching-up` | suspect or down, and the bot speaks again: replies to what was sent before its silence (its replay), or words it cannot place |

- **Its commands** are those it answered in 95% of the exports' cases or more (`/lore`, `/l`,
  `/avventura`, `/accumulo`, `/i`, `/vai`, `/me`, `/info`, …); not `/dai` nor `/usa`, which other
  bots take too. Any word of the bot's ends their wait: a single answer never given (1%) or a day of
  answers that reply to nothing (August) raises nothing.
- **No command is special.** A command sent while the bot is suspect, by a player or by the owner's
  account (a probe another node sends, told to the parser as a send), is read as any other: its
  answer at normal latency is `up`, none for 2 minutes is `down`. In private the bot's first word
  after the owner's send is its answer, as the shell pairs it. Nothing here sends: what to send, and
  when, is a node's of the owner's graph, woken by `loregame.health`.
- **Back** needs a fresh reply: a replay's replies all answer what was sent before the silence, so a
  burst that stops (§5.15) leaves it catching up, and silent again, down. The replay keeps the
  order, so a fresh reply means it is through.
- **Every command held while `down`** (since game-bots 0.52.0): the state's readiness holds them
  all, with no end, `the bot is down`, as it holds them for the owner's ban; a shell player then
  sends nothing that would only join the backlog. Lifted as the health moves on. Not while `suspect`
  (mostly a slow bot, and a command sent then confirms an outage sooner), nor `catching-up`: only a
  reply to a command sent since the bot spoke again ends it, so a hold would wait on the other
  players. `down` ends at any word of the bot, and is reached only with a command unanswered, so a
  replay is due; if it is lost, a node that probes may repeat while `down`.

## 6. The owner's state at @LoreGameBot

`loregame-state` (`modules/game-bots/`) keeps what the `loregame` parser reads of the owner's turns.
It is a floor, not the truth, while the turns are all it reads:

- **The inventory** gains what a turn drops (with its `2x`) and the items of the owner's level-ups'
  lists (§5.4), and a listing (§5.8) sets it: each item a page lists is held exactly as it says; a
  listing followed from its first page to its last (its pages turn one at a time, so reaching the
  last saw them all; a listing without buttons is one page) is the whole inventory, every item exact
  and those it does not list gone, as of then (`listed`). An item dropped into an inventory listed
  whole is exact too (none was held). A filtered listing, a page whose buttons are not known (an
  export), a chain whose first page was missed, or one with an item cut between two pages is a part:
  exact for what it lists, no more. An item held exactly that a whole listing says otherwise is a
  mismatch (`stats_drift`, `inventory`: each count expected and said). The shop (§5.12), the
  generators and `/usa` (§5.13) and the recipes (§5.14) change items too.
- **A turn cut off** (§5) may have gained an item the reply lost, so the inventory is marked
  uncertain, not changed.
- **The bans** (§5.1) of every player the parser heard of, the owner's and the group's: per player,
  when the ban ends (none if the bot does not say) and when it was told. A ban ends in the state
  when the parser says the bot served the player again, and one past its end is dropped at the next
  event, by that event's time. `state.ban({ player? })` is a player's (the owner's unless named),
  `state.bans()` every one; `loregame-state.banned` and `loregame-state.unbanned` announce each
  change, for any player, from live news alone. **An actor** checks the ban as it wakes, before each
  command, with `bannedUntil` (`src/bans.ts`): a ban is the account's, whatever the command.
- **The accumulo** (§5.2): the turns taken since it was last emptied (`count`), counted here, and
  the bot's own word on it. `count` is an estimate, `exact` once the bot's counter or a use has set
  it, and not charged below the level the bot's gate names. **`ready` is the bot's word alone**: a
  turn's line (one copy), or a counter at its maximum, until a use or a counter below it; our count
  reaching the maximum is not a go, so an actor that wants `/accumulo` waits for it
  (`accumuloReady`, `src/accumulo.ts`). Where the two disagree it keeps `drift` (the latest ten) and
  announces each as `loregame-state.accumuloDrift`, once until something else differs: `count` (the
  bot's counter is not ours), `early` (the line before our count reaches the maximum, as when the
  maximum is lower, or a story quotes it), `late` (our count reached it and there is no line),
  `lapsed` (it was full and the line is gone with no use seen), `not_ready` (a counter below the
  maximum while we held it full) and `used_early` (used with no line, short of the maximum). A floor
  says nothing against the bot, so `early`, `late` and `used_early` need an exact count. The bot's
  word wins: the state follows it, and does not learn the maximum from a line. `state.accumulo()` is
  the section; `loregame-state.accumuloReady` and `accumuloUsed` announce the rest.
- **The training** (§5.3): the readiness's, a day after the owner's last training.
- **A level-up** of the owner's (§5.4), whatever brought it, adds its items to the inventory, and
  opens the accumulo when it reaches its level.
- **The places** (§5.9, `places`): each place's level, the items entering it takes, the guardians it
  asks, and where one can go from it, the game's, from any player's answers, each as last told
  (`as_of`); an arrival tells what its place takes now. `requirements_as_of` is when its
  requirements were last told (a statement or an arrival; none if never, and a trip then knows
  nothing of the step): a statement older than it is not taken. The migration to 0.46.0 dated those
  held by the place's `as_of`, a place with none told none. **Seeded from the exports**
  (tools/media-seed): each place's requirements as a replay of the exports ends with them, taken at
  the next start where those held are older, or none. An arrival sets a player's `location`, and
  takes the items entering consumed from their inventory, one each; `/v` sets it too.
- **The guardians made** (§5.9, `guardians`, `state.guardians()`): by the code of a place a guardian
  is asked from, whether one has been made there, by anyone, as last told: a refusal's or a
  `/requisiti`'s (`Hai già:`, or `Ti serve:`), whoever's, an arrival's (all its place asks, made),
  and a guardian made by a generator, at the place its player stands (§5.13).
- **The market** (§5.11), the first part of the state that is a series through time, not only a
  value now:
  - **The companies there are** (`market.companies`, `state.market()`), the primary way to follow
    it: each by an **id** of its own (its first name's letters: `f-r-o-d-e-capital-partners`, with
    `-2` after when another had it), under which everything of it is kept whatever it is called: its
    name (its latest, emoji included), every name it had (`names`, each `since`), its latest value
    (`quote`: value, change, percentage, direction, how it was told, when) and its page (`page`:
    leader, members with their faction, level and power, power, value, profile).
  - **A rename** (`src/companies.ts`): a name the market writes that no company has now is the
    company's that had it, or whose letters it has (emoji and symbols aside), or, in a whole
    listing, whose value it carries on (its value less its change), each only when one alone fits. A
    company's page, which names it without its emoji, and an investment are the company's whose name
    or letters they have.
  - **Gone**: every listing (an update, or the market listed) quotes the whole market, so a company
    it does not quote is gone (deleted, closed, or missing for now by a slip of the bot's): kept
    apart with its history (`market_history.gone`, since when, its `points`), out of the series of
    those there are. Quoted again (by a name it had, or its letters, when one alone fits), it is
    back under its id, its history whole. **Two weeks after its newest value it is forgotten**,
    history and all, at the market's next listing; a company that takes its name then is another. A
    listing told late (older than the latest) renames and removes nothing.
  - **Each company's series** (`market_history.series`, by id, the companies there are only;
    `state.marketHistory({ company?, since?, until?, gone? })`, those gone too with `gone` or when
    one is named, by its id or any name it had, each with its name and when it was gone): a point
    `{ t, value, change, pct, via }` for each update (`update`, the bot's own; `forced`, out of
    turn), and for a market listed (`listing`) only when it shows a value the point before does not.
    The same update heard twice (told the same way, the same value and change, within 2 minutes) is
    one point, a point told late takes its place by time, and a company keeps its latest 3,000 (two
    years at four a day). Apart from the market's section, so that the companies there are read at a
    glance.
  - **The bot's updates** (`market.schedule`): their interval, learned from their times, not from a
    clock (the interval most seen among the latest twelve, to 5 minutes, once seen three times: 6
    hours). An update a whole number of intervals after the last (10 minutes either way) is on
    schedule, and the ones between it and the last are **missed** (`missed`, ISO); one off it is out
    of turn, `forced`, as its developer's are. The schedule moves with the bot's clock (summer time
    ended on 25 October 2026, and every update came an hour later in UTC): an update off it that the
    next one follows by an interval starts it anew, and is relabelled `update`. `state.market()`
    gives the `next` update due.
  - **`loregame-state.marketUpdated`** announces each update, live: its `via`, its `quotes` (each
    with the company's `id`) and the companies it made `gone`.
- **Every player's investments** (`investments`, `state.investments({ player? })`): each open one,
  by the company's id (with its name), as an investment (its `invested` and `entry` value), a market
  listed to them (all of them: the others are gone) and a withdrawal (what is left, or none) tell,
  and `now`, its worth at the company's latest value. An investment sets their `coins` exactly
  (`Ti rimangono`); a withdrawal adds what it cashed.
- **Neutrality** (§5.9): a ticket used is gone from its player's inventory, and adds 10 hours to
  their `Neutralizzato` (in their `effects`, exact); its end, told the owner, takes it off, and
  moves them out of a neutral place to the same step of their faction's ladder, not exactly (their
  next turn tells). Another player's end is not told: their effect's time ends it, and their next
  turn their place.
- **A trip, planned** (`state.trip({ to, player?, at? })`, `src/trips.ts`): the way from where a
  player is (the owner unless named) to a place, through the exits told and each ladder's next
  steps, and each step's level, the items it takes (those an earlier step took are not there for the
  next), those the player is known to lack (`missing`) or not known to hold (`unsure`), the
  guardians it asks and whether one has been made at each (`guardians_ok`; a neutral place asks none
  of a faction's player), and for a neutral place entered from a faction's by a faction's player
  (not one of `Il Neutrale`), whether `Neutralizzato` holds; `ok` is true, false (something known
  lacking), or none (a step it cannot tell: a place whose requirements were never told, a guardian
  not known, an inventory not listed).
- **How far a player can climb** (`state.reach({ player? })`, `src/reach.ts`): from where a player
  is (the owner unless named), up their faction's ladder (`Bene` `B`, `Male` `M`, `Neutrale` `N`,
  from their `alignment`), a step at a time. A player below the highest place they reached (gone
  down to play a lower place's turns) walks up from where they are, **each step entered again taking
  its items again**, so one who spent them is stuck lower; a faction's player on the neutral ladder
  walks back first, the shortest way through the exits told and the ladders' steps (`N1` to `B1`,
  `N2` to `B2`, `N3` through `N2`), each place on the way entered as any other (a neutral one asks
  no guardian of them; neutrality is not checked, as its end throws them out to their own ladder
  anyway). Each step needs its level (**not checked where the player's is unknown**: few profiles
  are read, and where they stand bounds it; a place whose level was never told asks its step's, as
  every place told does [M: 8 of 8 in the owner's export of October–November 2026]), each guardian
  it asks made, and its items, one each, from a copy of their inventory. The answer: `player`,
  `ladder`, `from`, `level`, `path` (the places entered), `reached` (K: `{ code, step }`, the
  highest step of their ladder they can be at now; none if they cannot get back to it), `next`
  (where the walk stopped: `code`, `name`, `level` (`level_told` false when its step's), `level_ok`,
  `lacking`, the items it takes they would lack after the walk, `unsure`, those of them the state
  cannot be sure of, `guardians`, those known not made), `top` (no place known above K), `unknown`
  (why it could not be told: `player`, `alignment`, `location`, `way back`, `requirements`, a step
  never told, or `guardian`, one not known made) and `unsure` (the items taken whose count is not
  exact).
- **The shop** (§5.12, `shop`): its `day` (the date in Italy, when it changes), its `sagra` and its
  `items` (each `item`, `rarity`, `tags`, `price`), as the day's latest listing told, whoever's (one
  for every player); the items each player has bought that day, apart (`bought`, by player, as their
  own listing's `✅` marks them, forgotten at the next day's listing); and every item seen on sale
  (`seen`, by name: rarity, tags, `first` and `last` day, `days`). A listing of a day before the one
  kept changes nothing. `state.shop({ player?, at? })` answers the day's items, each `bought` by the
  player (the owner unless named; none when their listing of the day was not read), and whether its
  day is `today`'s; `state.shopSeen()` every item seen. **`loregame-state.shopChanged`** announces a
  new day's items, or the day's told otherwise (`day`, `sagra`, `items`), with those never seen on
  sale before (`new`), from live news alone. **A purchase** (§5.12) puts its item in the buyer's
  inventory, as a drop does (`via: purchase`), and takes its price off their `coins` (exact if they
  were); the listing edited back marks it bought for the day.
- **A generator used** (§5.13) is one of its kind gone from its player's inventory (exact if it
  was); what it made or gave is in it, as a drop is (`via: generated`: an item made, equipment
  assembled, a blueprint's copy); its reward and cost move their `coins`; a guardian is recorded as
  made where its player stands (`guardians`, §5.9); a season made takes every season generator of
  its faction's players. **The moving box opened** is gone, and what it held is in the inventory
  (`via: used`).
- **The recipes** (§5.14): the game's (`recipes`, `state.recipes()`), by name, each one's `level`,
  its `ingredients` (each item's rarity, tags and `qty`, how many it takes: from a recipe made, or
  an item lacking, which its player holds none of; none if not known) and what it gives (`made`,
  once seen made), as any player's list and answers last told; and each player's (`recipes` in their
  record), as their list and answers last told: `level`, `lacking` (how many items) and `items`
  (which, from an answer, while as many lack), `starred` (made already: `[*]` in their list, or a
  make of theirs seen since; a later list is the authority). A list is the player's whole: the
  recipes it does not name are gone. **An answer is evidence of the inventory:** each item held,
  exactly so many; each lacking, none. **A recipe made** takes its items out (exact while they
  were), puts what it gives in, as a drop (`via: recipe`), and adds one to the player's `recipes`
  (exact if it was); which recipe it was is told by the items it took, or what it gave, when one
  recipe alone fits, and marks it made for the player (`starred`). **What a recipe gives is the
  game's secret** until made: `made` is kept for choosing (which recipes lead to a place's
  requirement); a consumer must never show it to players, nor to anything that writes to them.
  `state.recipe({ name, player? })` answers one, by its name or a part of it as `/ricetta` does,
  with a player's own (the owner's unless named).
- **The catalogue** (`catalogue`, `state.catalogue()`): every item seen in the game, by name, its
  `rarity` and `tags` as last told (an item told without its rarity, a gift's at times, keeps the
  one known), when it was `first` seen and how (`via`: `drop`, anyone's turn; `level-up`;
  `inventory`, anyone's listing; `gift`; `place`, a place's requirements or what an arrival
  consumed; `shop`; `generated`, an item a generator made or gave; `recipe`, one a recipe takes or
  gives). **`loregame-state.itemsDiscovered`** announces the items seen for the first time (`items`,
  each `item`, `rarity`, `tags`, `via`), from live news alone. The migration to 0.39.0 seeded it
  from the items the state held: every inventory, the places, the shop's history. Replayed
  (`npm run lore-check`), the owner's exports catalogue 719 items over their whole span, the game
  before its reset of 17 August 2026 included (§5.9: its items were discarded), and **361 since the
  reset** (`--since 2026-08-17`): 212 first seen made by a generator (most items are players' own,
  dropped afterwards), 113 in a drop, 16 in an inventory, 8 in a gift, 4 at a place, 4 in the shop,
  3 in a recipe, 1 in a level-up; 8 of them generators. A state that started after the reset holds
  no item of before it.
- **The pictures** (§6.2): each place's, kept once, at its first sight.
- **Their profile** (§5.5), and their username (`owner.name`), as with every player's (§6.1).
- **Items and players are named by players**, anything, `__proto__` included.

### 6.1 Every player

The state also keeps **every player** whose turns the account reads (`players`, by username; the
owner's included), from five events of the parser for any player, `loregame.playerTurn` (a turn, or
a "too soon"; with the turn command's message id, `message`, and the bot's answer's, `answer`, so
that a consumer can reply to a player's turn: a supergroup's message ids are the same for every
member, a bot's too), `loregame.playerAccumulo` (an answer to `/accumulo`), `loregame.training` (an
answer to `/allenati`), `loregame.levelUp` and `loregame.profile`: the bot replies to a turn command
naming nobody, so the parser names the player by the message it replies to, and pairs an `/accumulo`
or a training answer as it does the owner's (§5.2, §5.3, §5.4). Per player:

- **in the game:** their name and level, as a fight's line and a level-up (§5.4) say;
- **turns seen**, the last one's time, and their **rest** (15 minutes, 30 after a fight lost, a "too
  soon"'s wait, §2);
- **unseen turns:** players also play where the account does not read, in their private chat with
  the bot. A "too soon" to a player we held rested tells of one, which is counted, charges their
  accumulo, and leaves its count a floor;
- **their accumulo**, with the owner's rules (§6): the turns counted, the bot's word (`ready`), and
  the drift between the two, which a turn unseen does not count as a disagreement. Two more things a
  turn tells: **below level 4** (known from a fight's line or a level-up) nothing charges it, and
  **a turn well before the rest was over** while the accumulo was full tells of a use the account
  did not hear (in private: `unseen_uses`), which empties it, unless it came within a minute of the
  last turn, which the bot answers as a turn at times (§2: `double_turns`);
- **their trainings** (§5.3): those seen, the last one, and until when the next waits (a day after
  it, or a "too soon"'s wait); a "too soon" whose wait ends well after the one predicted tells of a
  training in private (`unseen`);
- **their XP** (§5.4): what the account saw them gain (`seen`), how much since their last level-up
  seen (`since_level`), and their latest ten level-ups with the XP seen before each;
- **their profile** (§5.5), the last one the account read, as the bot gave it, each line a stat of
  its own (`profile`: `level`, `xp`, `coins`, `skills`, `equipment`, …), the effects with when they
  end; it sets their level. `state.profile({ player?, stat? })` answers it whole, or one stat by its
  dotted path (`skills.Stoccaggio`, `equipment.weapon.level`), the owner's unless named;
- **their stats now** (`stats`): the last profile's, each moved by the commands the parser reads
  since, with whether it is still `exact` and when it changed (`as_of`). A turn moves `xp` (§5.4),
  `episode` (one more) and `location` (its place: the profile's location was the last turn's place
  in all 31 of the owner's [M]), and the `level` the XP makes; a training moves `xp`; a level-up
  sets `level`, adds its coins to `coins`, and raises `xp` to its threshold if short (not exact); a
  purchase (§5.12) takes its price off `coins`, a generator (§5.13) moves them by its reward and
  cost, and a recipe made (§5.14) adds one to `recipes`. A stat stops being exact when a change to
  it is not known whole: a turn told of by a "too soon" alone (`xp`, `episode`, `location`,
  `level`), a draw, a turn cut off. A stat no command read moves (the equipment, the skills, the
  company, …) stays as the profile said, exact. **Before a profile** there are none but where they
  are and their faction: a turn, an arrival or `/v` sets `location`, exact, with or without a
  profile; and, while no profile told it, `alignment` from the place's ladder (`B<n>`, `Il Bene`;
  `M<n>`, `Il Male`: a faction's player is not seen on the other's [M]; a neutral place tells
  nothing), not exact, until a profile says it. `state.stat({ player?, stat })` answers one, by its
  dotted path, with its `exact` and `as_of`;
- **their skills and gear** (§5.6, §5.7): the skills menu is a part of a profile, checked and
  seeding `skills` and `skill_points` (the points left, which the profile does not show and keeps);
  a level-up adds its points; a purchase the account did not hear (the menu's buttons) is no
  mismatch. An answer to `/equipaggia` moves `equipment`: the item equipped in the slot of the one
  it replaced, else the slot their `gear` knows (every item seen worn, by name: its slot and its
  level range) or the owner's drop's tag says; an item taken off empties its slot. A slot or a range
  the state cannot tell leaves it not exact. The slots listed are a part of a profile, checked and
  seeding `equipment`;
- **their stats' mismatches** (`stats_drift`, the latest ten): each stat held exactly that the next
  profile, menu or listing says otherwise (`stat`, `expected`, `said`, when), announced live as
  `loregame-state.statsDrift`; then it seeds the stats it says again. An effect is compared by
  whether it still holds, not by its end (told to the second). A mismatch tells of a command the
  parser does not read yet (the coins of the shop and the market, the company, a recipe, a button
  pressed, …), or of a rule the state has wrong. It is the state's own record, not the shell's drift
  (bot-os.md P5), which counts a parser's unread messages and would pause the players over it.

Measured [M] with `npm run lore-check` (tools/lore-check/README.md) on the exports of Oct–Nov 2026,
every player of the group: the counter the bot gives agrees with the state's in 98% of its readings,
and a "too soon" with the rest predicted in 99%; a training's "too soon" with the day predicted in
98% (the rest are trainings in private); a profile's level with its XP in all 103 of them, and its
XP with the state's in 33 of the 34 intervals whose turns were all seen (the one apart by a
training's +15, in private). Every turn seen before the rest was over is explained: after a use of
the accumulo the account heard (293), a second turn within a minute (§2: 3), or a use in private
(1). Of the owner's stats, the mismatches the profiles told are the coins (22, the shop and the
market not read yet), the company joined, a recipe, the Neutralizzato effect, an armour worn without
a message the account read, and one turn not seen (its XP and its episode); the skills bought are
each a purchase the next menu explains.

What it keeps of a player is a floor of what they did, and better as they play in the group. A
player is known by the username the connector gives; one without a username is not kept (the
connector gives `''`). **Their inventory** is kept as the owner's is (their drops, their level-ups,
their listings: `inventory`, the owner's being the state's own), so that `state.holders({ item })`
tells who holds an item, and how many.

### 6.2 The pictures

The game shows a picture with much of what the state keeps: a place's creation card, an arrival and
a `/v` are a photo of the place (§5.9); a turn's answer is its story's, or the enemy met's (§5); a
story's creation card its story's (§5.13). The state keeps **each place's pictures** (`media` in
`places`, newest last), so that a plugin wanting one asks the state, not Telegram:

- **Fetched once, at first sight, live:** when the state applies an event that shows a place still
  wanting a picture (none kept, nor a message found to hold another kind of media) — its creation
  card (`loregame.generated` of a season), else an arrival or a `/v` (`loregame.travel`), each with
  its `answer`'s message id — it fetches that message's photo through the account's `photo`
  (MegaBotTron1999's D151) on its optional input `photo`, one at a time. Live alone: a message may
  be deleted or edited later, so its first sight may be the only one; the catch-up from the event
  log at a start fetches nothing. A place pictured is not fetched again, so a picture changed later
  is seen only in a seed.
- **An entry** is `{ id, kind, mime?, width?, height?, source: { chat, message, via, at } }`: `id`
  `sha256:<hex>` of the bytes; `kind` `image` (kept), `other` (the message holds no photo: another
  kind of media, its source alone), or `unknown` (not fetched: no `photo` edge, or the fetch failed;
  tried again at the next sight); `via` `creation`, `arrival`, `v`, `export` (a seed), or `turn`
  (for the stories and enemies to come). Without the edge, the first sight's source is kept, no
  bytes. A picture that changes is a new entry, the old kept; the same picture seen again is one.
- **The bytes** are the state node's files (D149), `sha256-<hex>`, one per picture whatever the
  places showing it; never in `state.json`. `state.media({ id })` answers them as the core's
  `MediaResult` (D153), `{ ok: true, media: { data, mime, width?, height? } | null }` or
  `{ ok: false, error }`, as `photo` does; `state.places()` carries the entries.
- **The stories and the enemies are not kept yet**, so their pictures are not: the entry and its
  `turn` source are ready for them.
- **Seeded from the exports** (tools/media-seed): an export made with its photos holds them, by
  message. Over the owner's exports (one holds photos, 22–26 Oct 2026: 881), `npm run lore-check`
  counts, since the reset, 8 creation cards of seasons read (1 with its photo), 60 of stories (1),
  17 guardians made (none), 69 arrivals (1), 155 `/v` (3), 15,127 turns (737): 3 places pictured,
  each by one picture.
