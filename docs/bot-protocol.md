# NorelecBot's messages, as a parser sees them

Documented as of 5 Nov 2026, from the game's group (messages of 13–20 Oct) and from the IRC channel,
read live since 22 Oct. The rules behind each message are in [game-rules.md](game-rules.md); this
file is about recognising them, and about the parsers in `modules/norelec/` that do. Templates use
`N` for a player, `X` for another player or place, `#` for a number and `(…)` for an emoji list; the
counts are the occurrences on 13–20 Oct. Player names in examples are made up.

## 1. Transport

### 1.1 Telegram

- Commands: `/raid @X`, `/buy 🧊`, …, optionally `/cmd@NorelecBot` (rules §1).
- The bot answers with a new message, not as a Telegram reply: its replies carry no `reply_to`, so a
  reply must be matched to its command by player name and time.
- One message can hold several lines about several players (an entry message also pays the ousted
  holder, reveals someone else's entry dream and ends with a quote; §3.3).

### 1.2 IRC and the relay

- The group is bridged with an IRC channel by a relay account, named **Regno** on both sides. IRC
  players use the same commands with `!` (`!raid X`, `!buy 🧊`, `!back`, `!strada`, `!parola`).
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
- **A long message is split over several IRC lines,** at line boundaries, each part under about 390
  bytes: a leaderboard comes as two lines, a long entry with its quote as two. The parts follow each
  other within about 120 ms, and separate bot messages are usually 600 ms or more apart, but not
  always: a raid's line and a `/profile` reply came 324 ms apart (27 Oct), so the IRC-side parser
  joins them into one message and reads the profile from its name line on. An entry's quote can also
  come several seconds late, as a line of its own (22 Oct).
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
| Departure with a load | `N parti per X con 🧊 da consegnare: arrivi tra …` (also `con # palle`, `con 💣`, `con 💦`)                                                                                                           | —     |
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
`N (…) X ti riaccoglie[: hai con te # palle].` A gift turned back comes home as
`N (…) torni in X con le tue # palle ancora in tasca.` (balls, which left the giver at departure) or
`N torni in X con 🧊 ancora in tasca.` (an emoji); a player can carry their balls this way, out of
reach of raids, and bring them home (28 Oct).

### 3.2 Arrival at a home

| Outcome                 | Template                                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theft, balloon popped   | `N (…) hai bucato il palloncino di X (…) e rubato # palle! Torni in N tra …`                                                                                                                                                                                                                             |
| Theft, victim out       | `N (…) hai rubato # palle a X (…), che non era a casa! Torni in N tra …` (also after a popped balloon: `…e rubato # palle, che non era a casa!`)                                                                                                                                                         |
| Theft past the defences | `N (…) scivoli di nascosto oltre le difese di X (…) e rubi # palle! Torni in N tra …`                                                                                                                                                                                                                    |
| Balloon resists         | `N (…) il palloncino di X (…) ha resistito. Ora il palloncino ha il #% di probabilità di essere bucato. Torni in N tra …`                                                                                                                                                                                |
| Dog                     | `N (…) il cane di X (…) ti ha intercettato: niente bottino. Torni in N tra …`                                                                                                                                                                                                                            |
| Pity                    | `X ti ha impietosito: gli rubi # palle invece di # palle (#% in meno).`                                                                                                                                                                                                                                  |
| Alarm                   | `L'allarme di X ti scopre: devi vedertela con le sue difese.`                                                                                                                                                                                                                                            |
| Dinosaur                | `Il 🦖 di X ti mangia 🏴‍☠️`                                                                                                                                                                                                                                                                                |
| Pirate flag             | `Arrembaggio: ti porti via anche 🧊 da casa sua`, then `: ora hai con te 🏴‍☠️🧊[]🎈.` (the raider's carried slots after the plunder; the raid's own line shows them before) and an explanation of the emoji                                                                                                |
| Gift delivered          | `N (…) hai consegnato # palle a X (…)! Torni in N tra …`                                                                                                                                                                                                                                                 |
| Throw delivered         | `N (…) la tua 💦 è arrivata a casa di X: tra # ore si vedrà. Torni in N tra …`                                                                                                                                                                                                                           |
| Freeze delivered        | Since 23 Oct: `N (…) congeli X in @TheConquister37: per 24 minuti non può partire e, se lo cacciano, non può rientrare.` (the real length, 🔥 counted). Before: `N (…) congeli X: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in N tra …` (the base 30) |
| Milestone               | `🎉 N 100 raid riusciti!`                                                                                                                                                                                                                                                                                |

### 3.3 @TheConquister37

| Event                           | Template                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry, place empty              | `N sei in @TheConquister37!` / `N sei entrato in @TheConquister37!`                                                                                                                                                                                                                                                                                                 |
| Entry by ousting (real)         | `N (…) hai bucato il palloncino di X (…)!` ⏎ `N hai cacciato X da @TheConquister37.` ⏎ `X hai guadagnato # palle[ col ⚡ x1.1]!` ⏎ `N sei in @TheConquister37!` ⏎ (blank) ⏎ a random quote                                                                                                                                                                          |
| Entry past the balloon          | `N (…) scivoli di nascosto oltre il palloncino di X (…)!` ⏎ then as above                                                                                                                                                                                                                                                                                           |
| **Fake entry (silent penalty)** | Like a real entry **without** the `hai cacciato` and `hai guadagnato` lines (rules §3.4)                                                                                                                                                                                                                                                                            |
| Entry dream, revealed           | an extra line `N eri così stanco che hai solo sognato di entrare in @TheConquister37: non ti sei mai mosso da casa!` inside the **next** entry message, about the earlier player                                                                                                                                                                                    |
| Balloon resists, penalty        | `N (…) il palloncino di X (…) ha resistito e prendi una penalità. Ora il palloncino ha il #% di probabilità di essere bucato.` (until 18 Oct: `prendi 5 minuti di penalità`; with a ⏳ carried, the shorter time: `prendi 4 minuti e 30 secondi di penalità`)                                                                                                       |
| Lock                            | `N @TheConquister37 è chiuso: qualcuno ha appena provato a entrare. Riprova tra poco.`                                                                                                                                                                                                                                                                              |
| Gatekeeper                      | `alla porta di @TheConquister37 il guardiano ti ferma e chiede: come si chiama questo frutto? 🍎 Rispondi con !parola <nome> entro 3 minuti.`; then `N il guardiano ti fa passare.` or `la porta … resta chiusa per te per # minuti e # secondi`; also `N il guardiano scuote la testa e ti chiude la porta di @TheConquister37: riprova tra # minuti e # secondi.` |
| Already inside                  | `N sei già in @TheConquister37!`                                                                                                                                                                                                                                                                                                                                    |
| On the road                     | `N sei per strada: non puoi entrare in @TheConquister37 prima di tornare in X, tra …`                                                                                                                                                                                                                                                                               |
| Leaving                         | `N torni da @TheConquister37 in X con # palle.`                                                                                                                                                                                                                                                                                                                     |
| Lobster                         | `Le tue aragoste diventano 🎈 finché resti qui.`                                                                                                                                                                                                                                                                                                                    |
| Throw at the holder             | `N la tua 💦 è arrivata addosso a X in @TheConquister37: tra 9 ore si vedrà.` (21 Oct)                                                                                                                                                                                                                                                                              |
| Raid from Conquister            | `N razzie e consegne partono da casa tua: esci prima da @TheConquister37 con /back.`                                                                                                                                                                                                                                                                                |

### 3.4 Freeze

- On the target:
  `X una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri # minuti e # secondi.`
  (the reply to any blocked action; it gives the time left).
- Slots:
  `N hai già 5 emoji con te: per portare 🧊 serve un posto libero. Rimetti qualcosa in casa con !store <emoji>.`

### 3.5 Buying and slots

| Event                 | Template                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bought into the house | `N (…) hai speso # palle: 💣 in casa nel posto # (…). Non dà nessun bonus: aspetta in casa finché…`                                                                                                                                                                                                                                                                                                                                            |
| Bought, carried       | `N (…) hai speso # palle: 🎈 ora è con te (ce n'erano già # in giro, prezzo x1). Con te difende te dove sei…`                                                                                                                                                                                                                                                                                                                                  |
| Salt                  | `N (…) hai speso # palle: 🧂 in casa nel posto # (…). Ora ne hai # in casa: chi torna a razziarti…`                                                                                                                                                                                                                                                                                                                                            |
| Fire                  | `Ora ne hai 2 con te: il gelo di una 🧊 dura il 20% in meno`                                                                                                                                                                                                                                                                                                                                                                                   |
| Too poor              | `N ti servono # palle per 🧊 (ce ne sono già # in giro, ne hai #).` — **the free way to read a price, the count and the balance**                                                                                                                                                                                                                                                                                                              |
| House full            | `N hai già tutti i 10 posti della casa pieni: scegli quale sostituire con /buy <emoji> <posto>…`                                                                                                                                                                                                                                                                                                                                               |
| Retired command       | `N questo comando non c'è più: scrivi /raid @X`                                                                                                                                                                                                                                                                                                                                                                                                |
| Swap (`/move`)        | `N hai scambiato 🧊 e 🐶: ora 🧊 è nel posto 5 e 🐶 nel posto 1. Casa: 🐶🐶💣…` (the house's emoji in slot order, empty ones left out)                                                                                                                                                                                                                                                                                                         |
| Move (`/move`)        | `N hai spostato 📮 dal posto 10 al posto 9. Casa: 🐶🐶…`                                                                                                                                                                                                                                                                                                                                                                                       |
| Gift received         | `N 🎈 ora è con te, ora hai con te 🎈🎈: …`, after the giver's `hai regalato` line                                                                                                                                                                                                                                                                                                                                                             |
| Take, store           | `N (…) 🚀 ora è con te: …`, `N (…) 🚀 ora è in casa: …`, `N (…) 🧊 ora è con te al posto di 🎈, che torna in casa: …` (the slot is not named)                                                                                                                                                                                                                                                                                                  |
| Refusals              | Each after the player's name, among others: `nel posto # della casa non c'è nessuna emoji.`, `indica un numero di palle maggiore di zero.`, `™️ non si lancia: per regalarla scrivi /give @X ™️.`, `non puoi regalare a te stesso.`, `hai solo N palle a disposizione.` (a `/give` of more balls than the balance: the parser reads N, and the game state takes it for the balance), `l'invito vale solo per chi è appena arrivato nel gioco.` |

### 3.6 State queries

- `/leaderboard`: `Classifica @TheConquister37`, then lines `#) Name (…) — # palle[ — # citazioni]`,
  then `In @TheConquister37 ora: Name (…)`.
- `/profile`: the carried emoji, `# palle, #° su # in classifica`, the location
  (`in @TheConquister37 da # minuti e # secondi` for the holder, `a casa, in @N`,
  `in viaggio verso X: rientra tra …`, `sulla via del ritorno da X…`), the 🐔 income
  (`2 🐔: 120 palle all'ora`, read as the hens in the house), and since 19 Oct stats such as
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
(`🚀 viaggi il 10% più veloce per ognuno`, `Si lanciano: …`,
`Tutte le altre emoji sono decorative: …`), and the random quote after an entry. The first two are
known lines that change no state; a random quote cannot be told from new wording. Also known and
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
- **Do not trust an entry line.** Check for `hai cacciato` when the place had a holder (rules §3.4).
- **Time.** Durations are rounded down to the second; distances fit to ±0.7 s (rules §2.2).
- **Variants.** Wording changes without notice (the return lines changed on 18 Oct). Match on stable
  fragments (`parti per`, `hai rubato`, `ha resistito`, `congeli`) and log unmatched bot lines, so
  that new wording shows up.
- **Emoji code points.** `⚡` and `⚡️` (with U+FE0F), and the skin tones of 🥷, are separate emoji
  for prices but the same for effects (rules §5.2): normalise for effects, not for prices.

## 5. The parsers

The formats above are implemented in `modules/norelec/src/`, as one core and two front ends, so that
a wording fix serves the Telegram exports and the live IRC side at once:

| Part                                          | Job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/norelec/src/game/parse-line.ts`      | **The templates:** one line into one typed event (`modules/norelec/src/game/events.ts`), `unknown` when none matches. Every wording fix goes here                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `modules/norelec/src/game/parse-message.ts`   | A message's lines in order, with the context a line needs: a player-less line (found balls, pity, the pirate flag, salt) gets the last player named before it; after an entry, lines no template knows are the random quote and are dropped; listings and announcements are one `info` event; a `/profile` reply is one `profile` event, read from its name line on when another message was joined before it; a `/house` reply is one `house` event wherever it starts, up to its last slot line, the rest read on its own (a profile and a house joined, 3 Nov) |
| `modules/norelec/src/game/wording.ts`         | **The wording, written:** the pieces of the bot's lines (durations, names with their emoji, balls, price multipliers) as the simulator (`modules/norelec/src/arena/engine.ts`) writes them; the writing half of the grammar, read back by the templates in its tests, so that the simulator and the parser share one grammar                                                                                                                                                                                                                                      |
| `modules/norelec/src/export/export-parser.ts` | **Export side:** a message of a Telegram Desktop export into a bot message: the bot's Telegram messages, and lines the relay carried from an IRC nick of the bot                                                                                                                                                                                                                                                                                                                                                                                                  |
| `modules/norelec/src/transport/irc-parser.ts` | **Live side:** lines of the IRC channel into bot messages: a bot line within 400 ms of the previous one (by `server-time`) continues its message (§1.2), which is complete when another line arrives or after 400 ms on the local clock; then `fromIrc` restores the Telegram form and the same core reads it. The export side applies `fromIrc` too, to bot lines the relay carried from IRC                                                                                                                                                                     |

- **Kept in step by the tests:** the multi-line fixtures of `modules/norelec/test/bot-messages.ts`
  (synthetic messages in the bot's real formats, with invented players) run through both front ends
  (the IRC tests turn each into the IRC form of §1.2), and every template has a line in
  `modules/norelec/src/game/parse-line.test.ts`. A new message form gets a line there, and a fixture
  if it spans lines.
- **Combined messages:** the bot may put several events in one message, e.g. an entry, its quote,
  then someone's theft. Blank lines therefore mark nothing: known lines are kept wherever they are.
- **Coverage:** on the messages of 13–21 Oct, 17,322 bot messages give 30,736 events, of which 50
  lines (0.16%) are `unknown`, mostly human text the bot reposts. The formats before 13 Oct differ
  (the game had other rules and wording), and 24% of the year's lines are unknown: the parsers
  target the current game. On the live IRC logs of 22 Oct to 5 Nov, 72 of 7,836 bot messages (0.92%)
  have a line the parser does not know, mostly role-play prose [M]. Live, each such message is
  reported as drift, so that new wording shows up.
- **Checked live** (22 Oct): the bot speaks on IRC as `NorelecBot`, a message is one line in the
  form of §1.2, and a long message is split (§1.2). Over the 7 hours of 22 Oct that both sources
  cover, 189 of the export's 192 bot messages have an IRC message with the same text, joined back
  from its parts; the others are one at the window's edge, two entries whose quote came late, and
  one IRC message absent from the export. Both sides have the same 3 unknown lines, and IRC 2 more:
  a late quote.
