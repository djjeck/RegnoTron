# NorelecBot's messages, as a parser sees them

Documented as of 16 Nov 2026, from the game's group (messages of 13–20 Oct) and from the IRC
channel, read live since 22 Oct. Since the ⚽ version (9 Nov 2026, §3.3) @TheConquister37 is closed,
/give and /burn are disabled and every emoji is free; the parser follows the live game, and the
earlier rule-set's templates are in the repository's history (the tag `norelec-classic`). The rules
behind each message are in [game-rules.md](game-rules.md); this file is about recognising them, and
about the parsers in `modules/norelec/` that do. Templates use `N` for a player, `X` for another
player or place, `#` for a number and `(…)` for an emoji list; the counts are the occurrences on
13–20 Oct. Player names in examples are made up.

## 1. Transport

### 1.1 Telegram

- Commands: `/raid @X`, `/buy 🧊`, …, optionally `/cmd@NorelecBot` (rules §1).
- The bot answers with a new message, not as a Telegram reply: its replies carry no `reply_to`, so a
  reply must be matched to its command by player name and time.
- One message can hold several lines about several players (a theft and the ⚽ taken with it, §3.3).
- **Read live too** (since 15 Nov 2026): the `norelec` plugin reads the group, and the owner's
  private chat with the bot, through a Telegram connector (its `telegram` input), beside or instead
  of IRC. The bot is known by its username (the plugin's `bot`, `NorelecBot` by default); a message
  comes whole, so no join window; a file's caption is read as its text; an edit is not read again. A
  player is named by their Telegram username (the bot names Telegram players by it), the owner's own
  messages as the owner's account. In the private chat the bot's replies are the owner's: a line
  that names nobody there (`COGLIONE`) is the owner's. The relay's copies of IRC lines in the group
  (`<nick> text` from the relay) are read as the IRC side reads them.
- **Both networks at once:** the relay copies every message, so the same bot message comes twice.
  The first copy read is applied and published; a copy from the other network within 60 s whose
  text, spacing and `·` aside, is the first's or a part of it (a message IRC split) is dropped, its
  answers to the owner's commands alone published, for the commands sent to its chat.

### 1.2 IRC and the relay

- The group is bridged with an IRC channel by a relay account, named **Regno** on both sides. On IRC
  its nick has been **`Regno_`** since 11 Nov 2026 (it reconnected while IRC still held `Regno`);
  the `norelec` plugin unwraps the lines of every nick in its `relays` config, by default both. IRC
  players use the same commands with `!` (`!raid X`, `!buy 🧊`, `!back`).
- **IRC → Telegram:** each IRC line arrives as a Telegram message from "Regno", text `<nick> text`.
  Actions arrive as `* nick text`; connection notices as
  `Lost connection to '<channel>' on '<server>'`.
- **Telegram → IRC:** Telegram messages appear on IRC as lines from the nick `Regno` whose text is
  `<N​ame> text`, with a zero-width space (U+200B) after the first letter of the name so that it
  does not ping, and replies quoted as `[Re N​ame: snippet…] text`. Seen when IRC users paste them
  back, e.g. `<Regno> <B​ravo> [Re R​egno: <Charlie> ciao…] text`. Strip U+200B before matching
  names.
- **NorelecBot speaks on IRC itself,** as the nick `NorelecBot`, not through the relay (seen live on
  22 Oct; it also did from 13 to 15 Sep, as `NorelecBot` and `NorelecBot_`). A Telegram player's
  command reaches IRC through the relay (`<Regno> <alice> /raid Bravo`), and the bot's reply arrives
  about a second later as its own line:
  `<NorelecBot> alice parti per Bravo: arrivi tra 2 minuti e 16 secondi. Casa tua resta scoperta.`
  The live side reads these command lines too (`modules/norelec/src/game/player-command.ts`), the
  relayed ones and IRC players' own `!raid X`: a command shows what a player tried even when the
  bot's refusal does not say what it was.
- **On IRC a bot message is one line,** whatever its length on Telegram: its lines are joined by
  `·`, blank lines dropped, and each player's name follows a zero-width space (U+200B) so that it
  does not ping:
  `<NorelecBot> alice · Con te: niente · 0 palle, 24° su 37 in classifica · a casa, in alice` is a
  `/profile` reply (seen live, 22 Oct). `fromIrc` in `modules/norelec/src/transport/relay.ts`
  restores the Telegram form. The anti-ping space is U+200B only: the zero-width joiner U+200D
  inside emoji such as 🏴‍☠️ and 🥷🏻 is part of the emoji and must be kept.
- **An emoji named `·` writes the separator inside a line.** The game sells any character
  (`/buy · 5`, 13 Nov 2026), and `Alfa (🐶) · ora è con te: …` would split in two. `fromIrc`, given
  the templates (both parsers give them), joins two neighbouring pieces back when the second starts
  with a lower-case letter, either alone is unknown and together they are known. In a /house reply
  such an emoji is indistinguishable from an empty slot (`5 ·`).
- **A long message is split over several IRC lines,** at line boundaries, each part under about 390
  bytes: a leaderboard comes as two lines, a long entry with its quote as two. The parts follow each
  other within about 120 ms, and separate bot messages are usually 600 ms or more apart, but not
  always: a raid's line and a `/profile` reply came 324 ms apart (27 Oct), so the IRC-side parser
  joins them into one message and reads the profile from its name line on. An entry's quote can also
  come several seconds late, as a line of its own (22 Oct). Since the IRC-side parser reads a short
  message of known lines as it arrives (§5), two such messages that come close are no longer joined.
- `/link <name>` links a Telegram account to a registered IRC nick; without it the two are separate
  game accounts ("Entrambi gli account hanno già beni: serve una fusione manuale").

## 2. Names

- A player is written `Name (emoji)`: the parentheses list the carried emoji, `[]` an empty slot,
  e.g. `Alfa (🥷🎈🔥🥷🏻🔥)`, `Bravo ([]🎈)`. With nothing carried the parentheses are absent.
- **`@` marks a Telegram account.** The bot writes a Telegram account (or an IRC nick linked to one)
  with `@` where it names a home or a target: `Torni in @X`, `torni in @X`, `sei tornato in @X`,
  `hai cacciato @X`, `palle a @X`, `le difese di @X`, `a casa, in @X`, and often
  `il palloncino di @X`. It writes the same player without `@` at the start of a line, after
  `parti per`, and in the leaderboard, so one message can show both forms. It never writes an
  IRC-only player with `@`. So a single `@` proves a Telegram account, and a bare name proves
  nothing. Commands must name a player in that form (rules §1): the parser lists the names a line
  writes with `@` in its event's `telegram`, never a name the bot quotes from a refusal, the game
  state keeps them (`PlayerState.telegram`), and `address()` in
  `modules/norelec/src/state/game-state.ts` writes every player name a command needs. The accounts
  are kept across restarts in the `norelec` plugin's store (the document `accounts`,
  `modules/norelec/src/plugins/norelec-accounts.ts`, filled once from the whole log): a restart
  replays only the last hours, and on 4 Nov the bot had written one player only with a title in
  them, so a `!give` naming them bare was refused. That refusal is evidence too, whoever sent the
  command: "non conosco nessun giocatore di nome Name" after a known player's bare name makes it a
  Telegram account, and after `@Name` an IRC one.
- A name can carry a title: `Alfa lo smerdato` (from 💩, 1 day), and others the bot gives. Match the
  known player list rather than splitting on spaces.
- The place is always `@TheConquister37`. A home is named after its owner: `torni in Alfa`,
  `torni in @Bravo`.

## 3. Message families

### 3.1 Travel

| Event                 | Template                                                                                                                                                                                              | Count |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Departure (raid)      | `N parti per X: arrivi tra # minuti e # secondi. Casa tua resta scoperta.` (also `# minuto e`, `# secondi`, `# minuti.`)                                                                              | ~2700 |
| Departure with a load | `N parti per X con 🧊 da consegnare: arrivi tra …` (also `con 💣`, `con 💦`; a throw)                                                                                                                 | —     |
| Rocket departure      | `🚀 N parti per X: arrivi tra …. N resta scoperto.` Not on IRC: there a departure with 🚀 has the plain form, with the boosted time (rules §2.3)                                                      | —     |
| Already travelling    | `N sei già in viaggio, torni tra # secondi.`                                                                                                                                                          | 175   |
| Turning back          | `N lasci perdere e torni in X: arrivi tra # secondi.`                                                                                                                                                 | 130   |
| Found balls           | a departure followed by `Lungo la via trovi # palle!`                                                                                                                                                 | 33    |
| Dreamt departure      | `N (…) eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!` — may come minutes later, or never                                                                             | 64    |
| Fork (19 Oct only)    | `A metà strada la via si divide: ⛰️ collina o 🏞️ fiume? Scrivi !strada <nome> entro 3 minuti…`; failure `N (…) non hai scelto nessuna strada al bivio: ti sei perso e sei tornato in X a mani vuote.` | 22    |
| Buying away from home | `N sei sulla via del ritorno: le emoji si comprano da casa tua. Rientri tra # secondi.`                                                                                                               | 21    |

**Return home** has several wordings since 18 Oct 22:56, all meaning the same:
`N (…) sei tornato in X.`, `N (…) torni in X con # palle.`, `N (…) rientri in X portando # palle.`,
`N (…) rientri in X a mani vuote.`, `N (…) eccoti di nuovo in X[, con # palle in più].`,
`N (…) X ti riaccoglie[: hai con te # palle].` A throw turned back comes home as
`N torni in X con 🧊 ancora in tasca.`

### 3.2 Arrival at a home

| Outcome                 | Template                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theft, balloon popped   | `N (…) hai bucato il palloncino di X (…) e rubato # palle! Torni in N tra …`                                                                                                                                                                                               |
| Theft, victim out       | `N (…) hai rubato # palle a X (…), che non era a casa! Torni in N tra …` (also after a popped balloon: `…e rubato # palle, che non era a casa!`)                                                                                                                           |
| Theft past the defences | `N (…) scivoli di nascosto oltre le difese di X (…) e rubi # palle! Torni in N tra …`                                                                                                                                                                                      |
| Balloon resists         | `N (…) il palloncino di X (…) ha resistito. Ora il palloncino ha il #% di probabilità di essere bucato. Torni in N tra …`                                                                                                                                                  |
| Dog                     | `N (…) il cane di X (…) ti ha intercettato: niente bottino. Torni in N tra …`                                                                                                                                                                                              |
| Pity                    | `X ti ha impietosito: gli rubi # palle invece di # palle (#% in meno).`                                                                                                                                                                                                    |
| Alarm                   | `L'allarme di X ti scopre: devi vedertela con le sue difese.`                                                                                                                                                                                                              |
| Dinosaur                | `Il 🦖 di X ti mangia 🏴‍☠️`                                                                                                                                                                                                                                                  |
| Pirate flag             | `Arrembaggio: ti porti via anche 🧊 da casa sua`, then `: ora hai con te 🏴‍☠️🧊[]🎈.` (the raider's carried slots after the plunder; the raid's own line shows them before) and an explanation of the emoji                                                                  |
| Throw delivered         | `N (…) la tua 💦 è arrivata a casa di X: tra # ore si vedrà. Torni in N tra …`                                                                                                                                                                                             |
| Freeze delivered        | `N (…) congeli X: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in N tra …` (the base 30; live). From 23 Oct to the ⚽ version also `… non può partire e, se lo cacciano, non può rientrare.` (the real length, 🔥 counted) |
| The ⚽ taken            | `⚽ E gli porti via la palla! Ora ce l'hai tu: tienila il più a lungo possibile.`, the line after a theft from the ⚽'s holder (§3.3)                                                                                                                                      |
| Defective bomb          | `N (…) la bomba era difettosa: ti esplode in mano e si porta via 🥷! Torni in N tra …`, or `…ti esplode in mano, ma non avevi niente con te da perdere. Torni in N tra …`                                                                                                  |
| Milestone               | `🎉 N 100 raid riusciti!`                                                                                                                                                                                                                                                  |

### 3.3 The ⚽ (since 9 Nov 2026), and what the game closed

The ⚽ version closed @TheConquister37 (until at least 8 Dec 2026) and replaced it with one ball,
`⚽`, which no slot holds: a **successful raid on its holder** (a theft of any kind, of any number
of balls, the holder home or away) takes it, and nothing else moves it. Who held it longest wins.

| Event               | Template                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Taken               | the theft's line, then `⚽ E gli porti via la palla! Ora ce l'hai tu: tienila il più a lungo possibile.` (no name: the thief and the victim are the theft's)                                                          |
| Leaderboard, header | `⚽ Classifica della palla: chi l'ha tenuta più a lungo`                                                                                                                                                              |
| Leaderboard, rows   | `#) N (…) — 1 giorno, 22 ore, 30 minuti e 42 secondi` (the total held; the top 10; ` ⚽` after the holder's row, whose total counts the hold under way; no `(…)` without carried emoji)                               |
| Leaderboard, holder | `La palla ce l'ha N (…) da # minuti e # secondi: rubagliela con /raid @N.` (`!raid N` when asked from IRC)                                                                                                            |
| A command disabled  | `N /burn è disattivato.`, `N !give è disattivato.` (since 10 Nov; on 9–10 Nov `…è disattivato: ora si gioca alla palla ⚽. …`)                                                                                        |
| The ☢️ disabled     | `N la ☢️ è disattivata.`; in /emoji `☢️ è disattivata: non si compra, non si lancia e non si regala`                                                                                                                  |
| The place closed    | `N @TheConquister37 è chiuso: ora si gioca alla palla ⚽. …` (9–10 Nov only); since 10 Nov /avventura and a throw at the place get no reply                                                                           |
| A banned player     | `COGLIONE`, the one reply to a banned player, to some of their commands (about one per 10 minutes); their other commands get no reply. The plugin names the player from the command it answers, the latest within 5 s |

A duration may have days (`1 giorno`, `2 giorni`). The leaderboard's rows no longer give balls: the
balance is read only from `/profile`, thefts and refusals.

### 3.4 Freeze

- On the target (the place named still, though closed):
  `X una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri # minuti e # secondi.`
  (the reply to any blocked action; it gives the time left).
- Slots:
  `N hai già 5 emoji con te: per portare 🧊 serve un posto libero. Rimetti qualcosa in casa con !store <emoji>.`

### 3.5 Buying and slots

| Event                | Template                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bought, free         | `N (…) hai preso gratis 💣: 💣 in casa nel posto #[, al posto di X]. …` (every emoji since 10 Nov 2026: the price 0; `X`, what was in the slot, is destroyed); `… 🥷 ora è con te. …`; the effect after, with the count held (`Ora ne hai # in casa: …`)                                                                                                                                           |
| Bought, priced       | `N (…) hai speso # palle: 💣 in casa nel posto #. …` (before 10 Nov; read the same way, at its price)                                                                                                                                                                                                                                                                                              |
| Too poor             | `N ti servono # palle per 🧊 (ne hai #).` — a price and the balance, when an emoji has one again                                                                                                                                                                                                                                                                                                   |
| Quotes               | `N hai aggiunto la citazione spendendo 1000 palle!`, then the quote echoed (not game text, dropped); `N ti servono 1000 palle per aggiungere una citazione (ne hai #).`: quotes still cost 1000                                                                                                                                                                                                    |
| Slot locked          | `N nel posto # c'è 👶, che non si tocca: se ne andrà da solo. Nessun addebito.` (a baby's slot cannot be bought over)                                                                                                                                                                                                                                                                              |
| Birth                | `@V (…) è nata una femmina 👶: il padre è @P[. Non c'era un posto libero: ha preso quello di 📮].` — 9 hours after P's 💦 reached V's house, a baby takes a slot (the first free one, or replacing what was there in a full house) and locks it; it grows (👶 → 👦/👧 → 👨/👩 → 👴/👵) seen only in `/house`; `@V 👴 ha vissuto la sua vita…`, 96 hours after its birth, is read as its slot freed |
| House full           | `N hai già tutti i 10 posti della casa pieni: scegli quale sostituire con /buy <emoji> <posto>…`                                                                                                                                                                                                                                                                                                   |
| Retired command      | `N questo comando non c'è più: scrivi /raid @X`                                                                                                                                                                                                                                                                                                                                                    |
| Swap, move (`/move`) | `N hai scambiato 🧊 e 🐶: ora 🧊 è nel posto 5 e 🐶 nel posto 1. Casa: 🐶🐶💣[]🧊`, `N hai spostato 📮 dal posto 10 al posto 9. Casa: 🐶🐶…`: the whole house after it, `[]` an empty slot                                                                                                                                                                                                         |
| Take, store          | `N (…) 🚀 ora è con te: …`, `N (…) 🚀 ora è in casa: …`, `N (…) 🧊 ora è con te al posto di 🎈, che torna in casa: …` (the slot is not named)                                                                                                                                                                                                                                                      |
| Refusals             | Each after the player's name, among others: `nel posto # della casa non c'è nessuna emoji.`, `i posti della casa vanno da 1 a 10: nessun addebito.`, `™️ non si lancia: per regalarla scrivi /give @X ™️.` (old advice, /give being disabled), `non puoi portare palle a te stesso.`, `l'invito vale solo per chi è appena arrivato nel gioco.`                                                    |

### 3.6 State queries

- `/leaderboard`: the ⚽'s (§3.3).
- `/profile`: the carried emoji, `# palle, #° su # in classifica` (the ball rank), the location
  (`a casa, in @N`, `in viaggio verso X: rientra tra …`, `sulla via del ritorno da X…`), the 🐔
  income (`2 🐔: 120 palle all'ora`, read as the hens in the house), and since 19 Oct stats such as
  `⚔️ # raid riusciti, il colpo più grosso # palle`, `🎯 bersaglio preferito: X (…)`,
  `📜 con noi da # giorni`.
- `/house [N]`: `Casa di N (#/10):` (the slots in use) and the 10 numbered slots, several to a line,
  each number followed by its emoji, or by nothing or `·` when empty: `1 🎈  2 🧊  3 💣  4 🧊  5`.

### 3.7 The golden hour

Double loot for an hour a day (rules §4.1), in three lines that change no state of their own:

- At the start: `🌟 È l'ora d'oro: fino alle 22 ogni raid riuscito ruba il doppio delle palle!`
- After each successful theft, in the same message: `🌟 Ora d'oro: bottino doppio!`; the theft's
  line already states the doubled loot.
- At the end: `🌙 L'ora d'oro è finita: torna domani alle 21.`

### 3.8 Lines apart from their message

The bot sends a long reply in several IRC lines, and a line that comes late enough is read as a
message of its own: the statistics of a `/profile` (`🎯 bersaglio preferito: X (# colpi)`,
`⏱️ record in @TheConquister37: …`), the lines of `/emoji` after its first
(`🚀 viaggi il 10% più veloce per ognuno`, `🧂 se la stessa persona…`, `Funzionano con te, …`,
`Si lanciano: …`, `Tutte le altre emoji sono decorative: …`; listings now come 3–5 s per line), the
lines of the new player's welcome (`Per le prime 24 ore nessuno può derubarti. …`,
`👋 Benvenuto N! Ecco cosa provare:`, `• /raid <nome>: …`), and a quote's echo. All but the echo are
known lines that change no state; an echo come apart cannot be told from new wording. Also known and
changing nothing: `Citazione eliminata: …`, `Citazione già presente o non salvabile: …`,
`Account collegati: …`, `Hai ricevuto un rispetto!`, a 💩 hit
(`@N, tiri una palla di cacca a X, bravo hai fatto centro…`), and the road chosen at a fork (19 Oct
only: `N prendi 🏚️ rovine: arrivi tra …`).

## 4. Parsing notes

- **Do not trust a departure line.** Since 18 Oct a confirmed departure may be a dream; confirm with
  the arrival line within the travel time plus a margin, or with `/profile` (rules §2.7).
- **A dream line may be about an earlier trip.** It can come an hour late, during a later trip
  (rules §2.6): read it as about the oldest trip that never arrived, and never as about a trip whose
  arrival line came.
- **A return line may never be read.** On 4 Nov the IRC connection died without a word for six
  minutes, until a write failed, and a return line sent meanwhile was lost: the player stayed on the
  road in the game state until a restart. The game state now takes a player home once the return is
  2 minutes overdue (the `returnMissed` notice), as it takes a departure with no arrival for a
  dream.
- **Time.** Durations are rounded down to the second; distances fit to ±0.7 s (rules §2.2).
- **Variants.** Wording changes without notice (the return lines changed on 18 Oct). Match on stable
  fragments (`parti per`, `hai rubato`, `ha resistito`, `congeli`) and log unmatched bot lines, so
  that new wording shows up.
- **Emoji code points.** `⚡` and `⚡️` (with U+FE0F), and the skin tones of 🥷 and of the babies,
  are separate emoji but the same for effects (rules §5.2): normalise for effects.
- **A decorative ⚽ exists.** An emoji `⚽` bought into a house is not the ball: the ball is in no
  slot, and is read only from its own lines (§3.3).

## 5. The parsers

The formats above are implemented in `modules/norelec/src/`, as one core and two front ends, so that
a wording fix serves the Telegram exports, the live IRC side and the live Telegram side at once:

| Part                                          | Job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/norelec/src/game/parse-line.ts`      | **The templates:** one line into one typed event (`modules/norelec/src/game/events.ts`), `unknown` when none matches. Every wording fix goes here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modules/norelec/src/game/parse-message.ts`   | A message's lines in order, with the context a line needs: a player-less line (found balls, pity, the pirate flag, salt) gets the last player named before it; the ⚽ taken gets the thief and the victim of the theft before it, and the pirate flag's plunder the victim whose house it empties; after a quote added, lines no template knows are its echo and are dropped; listings and announcements are one `info` event; a `/profile` reply is one `profile` event, read from its name line on when another message was joined before it; a `/house` reply is one `house` event wherever it starts, up to its last slot line, the rest read on its own (a profile and a house joined, 3 Nov) |
| `modules/norelec/src/game/wording.ts`         | **The wording, written:** the pieces of the bot's lines (durations, times held, names with their emoji, balls) for whoever writes the bot's lines (a simulator, the tests); the writing half of the grammar, read back by the templates in its tests. The simulator of the earlier rule-set (`src/arena/`) is in the history (`norelec-classic`)                                                                                                                                                                                                                                                                                                                                                   |
| `modules/norelec/src/export/export-parser.ts` | **Export side:** a message of a Telegram Desktop export into a bot message: the bot's Telegram messages, and lines the relay carried from an IRC nick of the bot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `modules/norelec/src/transport/irc-parser.ts` | **Live side:** lines of the IRC channel into bot messages: a message that cannot be the first part of a split one is complete with its line (under 200 bytes, so its next part would need a line of more than about 190 bytes; every line known; no listing, leaderboard, profile or house; an entry only once its quote came); any other is continued by a bot line within 400 ms of its last (by `server-time`, §1.2), and complete when another line arrives or after 400 ms on the local clock. Then `fromIrc` restores the Telegram form and the same core reads it. The export side applies `fromIrc` too, to bot lines the relay carried from IRC                                           |

- **Kept in step by the tests:** the multi-line fixtures of `modules/norelec/test/bot-messages.ts`
  (synthetic messages in the bot's real formats, with invented players) run through both front ends
  (the IRC tests turn each into the IRC form of §1.2), and every template has a line in
  `modules/norelec/src/game/parse-line.test.ts`. A new message form gets a line there, and a fixture
  if it spans lines.
- **Combined messages:** the bot may put several events in one message, e.g. a theft and the ⚽
  taken. Blank lines therefore mark nothing: known lines are kept wherever they are.
- **Read as it arrives:** the `norelec` plugin hands each channel line to the IRC-side parser inside
  the shell's message handler, so a message complete with its line is published there, while the
  shell hands the line over. That is the moment MegaBotTron1999 counts as the channel heard (its
  send watchdog, bot-os.md D93) and pairs a command with its answer (D98). A message that waits for
  the join window is published from the plugin's tick, or with the next line of the channel, and
  answers no command.
- **Answers to commands** (`modules/norelec/src/game/answers.ts`): an event about the owner's own
  account (the plugin's `self`) that the bot says at once in reply to one of the game's commands
  (§1.1 of the rules) is also published as `norelec.answer`, after its message, naming its rule. The
  plugin's manifest declares each rule as a D98 answer of the game's commands, in both forms
  (`!raid` on IRC, `/raid` on Telegram), so that it pairs with a command sent to either chat: `ok`
  (a departure, a purchase, a move, a turn back, …) or `refused` (`travelling`, `frozen`, `locked`
  for a baby's slot, `disabled` for /give, /burn and the ☢️, `invalid`, `missing`, …), with
  `retryAt` where the bot states a time (already travelling, frozen, buying on the way back). Each
  rule names only the commands that can draw it (`non hai X in casa.` answers /take,
  `nel posto # della casa non c'è nessuna emoji.` /move, `nel posto # c'è già X` /buy,
  `la casa è piena` /store, `non hai X, né con te né in casa.` /throw, …; only the way back,
  `shopAway`, answers all the house's commands): the core pairs an answer with the oldest send of
  its commands still waiting, so a rule wider than its commands lets a command the game ignores take
  another's answer. **The group's own commands** (`GROUP_ONLY`: /buy, /raid, /give, /burn,
  /avventura, in both forms) get no reply at all in the private chat with the bot, when enabled:
  they work only in the group. An answer read in the private chat is published with `private: true`,
  and a rule that names one of them is declared twice, for the group (`unless: { private: true }`)
  and, with its other commands only, for the private chat; so no answer read there pairs with one of
  them sent there, which waits its window and is `unanswered` (a MegaBotTron1999 that tells
  unanswered sends, its D107, then tells the owner). The answers contract cannot say "answered only
  in a group" to the core, which does not know a chat's kind, so such a send is not refused when it
  goes. Commands the game no longer answers (/avventura) have no answer; a banned player's
  `COGLIONE` answers nothing. Dreams and arrivals come later and answer nothing; another player's
  events answer nobody's command.
- **Each event on its own:** after a message, the plugin publishes each of its events (but `info`
  and `unknown`) as `norelec.<kind>` (`norelec.theft`, `norelec.ballTaken`, …), with the owner's
  account (`self`) and, for a message said while the instance was down, `playback`: the input of the
  `norelec-state` node (modules/norelec/README.md), which keeps the game's record from them.
- **Coverage:** on the messages of 13–21 Oct, 17,322 bot messages give 30,736 events, of which 50
  lines (0.16%) are `unknown`, mostly human text the bot reposts. The formats before 13 Oct differ
  (the game had other rules and wording), and 24% of the year's lines are unknown: the parsers
  target the current game. On the live IRC logs of 22 Oct to 5 Nov, 72 of 7,836 bot messages (0.92%)
  have a line the parser does not know, mostly role-play prose [M]. Live, each such message is
  reported as drift, so that new wording shows up. On the IRC logs of 9 Nov 22:53 (the ⚽ version)
  to 15 Nov, replayed offline through the parser of 15 Nov, none of 3,630 bot messages has a line it
  does not know (it was 1,237 with the parser of 14 Nov), nor any of the 140 bot messages of the
  plugin's event log of 14–15 Nov (62 before).
- **Checked live** (22 Oct): the bot speaks on IRC as `NorelecBot`, a message is one line in the
  form of §1.2, and a long message is split (§1.2). Over the 7 hours of 22 Oct that both sources
  cover, 189 of the export's 192 bot messages have an IRC message with the same text, joined back
  from its parts; the others are one at the window's edge, two entries whose quote came late, and
  one IRC message absent from the export. Both sides have the same 3 unknown lines, and IRC 2 more:
  a late quote.
