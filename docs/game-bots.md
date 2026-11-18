# The game bots RegnoTron reads

Documented as of 17 Nov 2026. Besides NorelecBot ([game-rules.md](game-rules.md)), the game's group
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
  that chat, the way the bot answers them (a ban it replies to the command with ends that command's
  wait). It therefore needs, like the bans (§5.1), the group's chat edge to deliver every sender: it
  cannot tell an answer to the owner from one to another player when it does not hear the other
  player's command. The level gate counts only as an answer to the command.
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
  success, and ends the turns' rest (the state's rule); "not yet" holds it for the turns still
  needed (15 minutes each) and withdraws its unlock until the next line, the level gate holds it 6
  hours. **A whole turn of the owner's without the line withdraws its unlock too** (one cut off, or
  quoting the line, says nothing): the bot's word that it is not full, whatever the state believed,
  so a use whose answer the account missed, or a start that knew nothing, never leaves it offered.
  The line is missing from 3% of the turns while full (above): such a turn holds it until the next
  line, a turn later. The owner's own answer, by hand or in the group (where the shell cannot pair
  it), counts the same: the state folds `loregame.accumulo` into the readiness, a use ending the
  turns' rest. A player in the group (D139): the bot answers its `/accumulo` with a message of its
  own, so the parser pairs it with the send the player tells it of (through the state), declares it
  the answer (`loregame.accumulo`), and the state frees the turn.

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
editing the message, each button a 🔒 at the first and the last page [owner]; the text says nothing
of its page, and only the first names its player. A page is cut by lines, so a name running over
several lines may be cut between two pages (6 of the exports' listings). The parser reads every page
as it comes, the first from the message and each turned from its edit (MegaBotTron1999's D144), and
which page it is from its buttons (D145: the first has no ◀️, the last no ▶️); a later page is the
player's whose first page it follows, or whose command it replies to.

**`loregame.inventory`** carries every listing and page the parser reads: `player`, `owner`,
`filter`, `items` (each `item`, `qty`, `rarity`, `tags`, `level`), `cut` (an item cut between this
page and another, not read), `page` (`first`, `last`; none without its buttons: an export, a shell
before D145), `message` (whose edits its pages are) and `edited`.

**Not supported**, as past the game's changes: the encounter of level 0 that ends in
`Ma non accade nulla...` (last seen on 3 Aug 2026), and the power line without its ⚡️ (March 2026).

The outcome the plugin publishes carries all this, as `Outcome` (`replies.ts`): a gain has its
`item` (without its count and its stats), `qty`, `rarity`, `tags` and `stats`; every outcome of a
turn has its `place`, its `fight` (`enemy`, `result`, `player`, `learned`, `powers`) and its
`levelUp` (`level`, `coins`, `skillPoints`, `items`, `other`) when the reply had them.

## 6. The owner's state at @LoreGameBot

`loregame-state` (`modules/game-bots/`) keeps what the `loregame` parser reads of the owner's turns.
It is a floor, not the truth, while the turns are all it reads:

- **The inventory** gains what a turn drops (with its `2x`) and the items of the owner's level-ups'
  lists (§5.4), and a listing (§5.8) sets it: each item a page lists is held exactly as it says; a
  listing followed from its first page to its last (its pages turn one at a time, so reaching the
  last saw them all) is the whole inventory, every item exact and those it does not list gone, as of
  then (`listed`). An item dropped into an inventory listed whole is exact too (none was held). A
  filtered listing, a page without its buttons, a chain whose first page was missed, or one with an
  item cut between two pages is a part: exact for what it lists, no more. An item held exactly that
  a whole listing says otherwise is a mismatch (`stats_drift`, `inventory`: each count expected and
  said). The generators, the recipes, `/usa` and the shop change items and are not read yet.
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
- **Their profile** (§5.5), and their username (`owner.name`), as with every player's (§6.1).
- **Items and players are named by players**, anything, `__proto__` included.

### 6.1 Every player

The state also keeps **every player** whose turns the account reads (`players`, by username; the
owner's included), from five events of the parser for any player, `loregame.playerTurn` (a turn, or
a "too soon"), `loregame.playerAccumulo` (an answer to `/accumulo`), `loregame.training` (an answer
to `/allenati`), `loregame.levelUp` and `loregame.profile`: the bot replies to a turn command naming
nobody, so the parser names the player by the message it replies to, and pairs an `/accumulo` or a
training answer as it does the owner's (§5.2, §5.3, §5.4). Per player:

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
  sets `level`, adds its coins to `coins`, and raises `xp` to its threshold if short (not exact). A
  stat stops being exact when a change to it is not known whole: a turn told of by a "too soon"
  alone (`xp`, `episode`, `location`, `level`), a draw, a turn cut off. A stat no command read moves
  (the equipment, the skills, the company, …) stays as the profile said, exact. Before a profile
  there are none. `state.stat({ player?, stat })` answers one, by its dotted path, with its `exact`
  and `as_of`;
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
