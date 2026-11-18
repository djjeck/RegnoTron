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
  is answered at times as a turn of its own, not a "too soon": most often a `/lore` after an
  `/avventura` (226 of 236 within a minute, Oct–Nov 2026), less often the same command again; never
  a `/avventura` after a `/lore` in the exports. After a minute the rest holds (33 of 34). The bot
  answers within a second, so it is not a race of two commands; nor is it the bot catching up after
  a disconnection (its delayed answers explain at most 6 of them). The rest then runs from the
  second turn.
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
| ` Hai imparato qualcosa di nuovo... (+<n>)`                   | Ends a won fight's line, most of the time. Not the level bar's points: it does not add up to them [?].                                                                             | 3/4 of the wins      |
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

| Reply                                                                                       | Means                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Accumulo non ancora sufficiente!` and `Il tuo accumulo: <n>/<max>`, after a blank line     | Not yet: `n` of the `max` it needs                           |
| `La lore è già pronta!` and the same counter                                                | Full, but there is no rest to zero: nothing is spent         |
| `🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore` | Used: the rest is zeroed, the count starts again from 0      |
| `Devi essere almeno di livello 4!`                                                          | Under the level; the sentence is shared with other commands' |

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
  on the text, which a quoted story would match), and its use clearing the turns' rest, so the
  player plays it only while `/lore` rests. A use is the success; "not yet" holds it for the turns
  still needed (15 minutes each) and withdraws its unlock until the next line, the level gate holds
  it 6 hours, "already ready" not at all. The owner's own answer, by hand or in the group (where the
  shell cannot pair it), counts the same: the state folds `loregame.accumulo` into the readiness, a
  use ending the turns' rest. A player in the group (D139): the bot answers its `/accumulo` with a
  message of its own, so the parser pairs it with the send the player tells it of (through the
  state), declares it the answer (`loregame.accumulo`), and the state frees the turn.

**Not read yet**: Stoccaggio itself (the maximum is the one the bot's counter states, else the usual
20), and the level, which a level-up elsewhere (not a turn, not a training: §5.3) raises without the
state hearing.

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

**Not read yet**: what `+<n>` is (the turn's fight has the same sentence, §5), and where the extra
comes from.

**Not supported**, as past the game's changes: the encounter of level 0 that ends in
`Ma non accade nulla...` (last seen on 3 Aug 2026), and the power line without its ⚡️ (March 2026).

The outcome the plugin publishes carries all this, as `Outcome` (`replies.ts`): a gain has its
`item` (without its count and its stats), `qty`, `rarity`, `tags` and `stats`; every outcome of a
turn has its `place`, its `fight` (`enemy`, `result`, `player`, `learned`, `powers`) and its
`levelUp` (`level`, `coins`, `skillPoints`, `items`, `other`) when the reply had them.

## 6. The owner's state at @LoreGameBot

`loregame-state` (`modules/game-bots/`) keeps what the `loregame` parser reads of the owner's turns.
It is a floor, not the truth, while the turns are all it reads:

- **The inventory** gains what a turn drops (with its `2x`) and the items of a level-up's list. It
  loses nothing: a `/usa`, a `/dai`, a `/give`, the generators and the recipes change the owner's
  items and are not read yet, nor is a whole `/zaino` (paginated, and not whole in an export), which
  will make a count exact. Until they are, a count only rises, and a real inventory is richer than
  what turns alone bring.
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
- **The training** (§5.3): the readiness's, a day after the owner's last training; a level-up it
  brings adds its items to the inventory, and opens the accumulo when it reaches its level.
- **Items and players are named by players**, anything, `__proto__` included.

### 6.1 Every player

The state also keeps **every player** whose turns the account reads (`players`, by username; the
owner's included), from three events of the parser for any player, `loregame.playerTurn` (a turn, or
a "too soon"), `loregame.playerAccumulo` (an answer to `/accumulo`) and `loregame.training` (an
answer to `/allenati`): the bot replies to a turn command naming nobody, so the parser names the
player by the message it replies to, and pairs an `/accumulo` or a training answer as it does the
owner's (§5.2, §5.3). Per player:

- **in the game:** their name and level, as a fight's line and a level-up say;
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
  training in private (`unseen`).

Measured [M] with `npm run lore-check` (tools/lore-check/README.md) on the exports of Oct–Nov 2026,
every player of the group: the counter the bot gives agrees with the state's in 97% of its readings,
and a "too soon" with the rest predicted in 99%; a training's "too soon" with the day predicted in
98% (the rest are trainings in private). Every turn seen before the rest was over is explained:
after a use of the accumulo the account heard, a second turn within a minute (§2), or, rarely, a use
in private.

What it keeps of a player is a floor of what they did, and better as they play in the group. A
player is known by the username the connector gives; one without a username is not kept (the
connector gives `''`). Their items are not kept yet.
