# NorelecBot "palle" game: rulebook

Documented as of 5 Nov 2026. NorelecBot is a Telegram bot, written by Norelec, that runs a game in
the game's group and, through a relay, in an IRC channel. This describes the rules in force at the
end of the data (20 Oct 2026 23:59, UTC−4; Italian time is 6 hours later), with a few later
observations, the mechanics the bot applies without announcing them (§2.7, §3.4, §3.6), and how the
rules got there (§8). Norelec changes the rules almost daily: check anything important against the
live `/help` and `/emoji` before relying on it.

**Marks.**

- **[S]** stated by the bot (announcements, `/help`, `/emoji`, its replies) or by Norelec.
- **[M]** measured from the group's messages (mostly 13–20 Oct) or from later live observation.
- **[I]** inferred: consistent with the data but neither stated nor directly measured.
- **[?]** the data does not settle it (collected in §9).

The group's history holds only what was posted in the group. Commands sent in a direct chat with the
bot show up only through its reply, or not at all. Bot replies quoted below are in Italian, as the
bot writes them; their exact formats are in [bot-protocol.md](bot-protocol.md). Player names in
examples are made up.

---

## 0. The game in one paragraph

Every player has a **home** at a fixed point on a hidden map and a balance of **palle** (balls). The
one place that produces balls is **@TheConquister37** ("Conquister"): its holder earns 1 ball per
second, paid when they leave or are ousted. To take the place you must get past the holder's balloon
🎈. Players also travel to each other's homes to **raid** (steal balls), **give** balls or emoji, or
**throw** emoji at them. Emoji are bought with balls and carry powers. Since 18–19 Oct the bot also
applies unannounced random events (dreams, forks in the road, a gatekeeper, a short lock on
Conquister).

---

## 1. Commands

Telegram commands start with `/`. IRC players (relayed by the account "Regno", shown as
`Nick [IRC]: text`) use the same commands with `!`. Every command below exists in both forms [S]. On
Telegram, `/cmd@NorelecBot` also works [M].

**Naming a player.** A command names a Telegram account as `@name` and an IRC-only player without
`@`, from either side; the other form is refused with "non conosco nessun giocatore di nome …" [M]:
`Juno` refused and `/raid @Juno` accepted right after; `@alice`, an IRC player, refused. An IRC nick
linked to a Telegram account (`/link`) is that account, named with `@`. Which form a player takes
shows in the bot's own messages ([bot-protocol.md](bot-protocol.md) §2).

### 1.1 Command list (from `/help`, 18 Oct, unless noted)

| Command (Telegram / IRC)                             | What it does                                                                                                                    | Where you must be                                  | Notes                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `We @TheConquister37` or `/avventura` (`!avventura`) | Try to enter @TheConquister37                                                                                                   | At home: not travelling, not frozen, not penalised | The only "We" line still accepted [S]. `/avventura` since 6 Oct [S]. From the road: "sei per strada: non puoi entrare… prima di tornare in X, tra T" (T = rest of the outward leg plus the whole way back) [M]                   |
| `/raid @player` (`!raid player`)                     | Travel to the player's home and rob it                                                                                          | At home                                            | "razzie e consegne partono da casa tua: esci prima da @TheConquister37 con /back" [M]. The `@` is optional [M]                                                                                                                   |
| `/give @player 500`                                  | Carry 500 balls to the player                                                                                                   | At home                                            | Balls leave you at departure, cannot be stolen on the road, and are delivered whether or not the target is at home [S]. Reply "hai consegnato N palle" [M]                                                                       |
| `/give @player 🍕`                                   | Carry an emoji as a gift                                                                                                        | At home                                            | A 💣 or ☢️ given arrives intact and the recipient can use it [S]. You cannot give away your last 🎈 [S]                                                                                                                          |
| `/throw @player 💣`                                  | Carry a throwable emoji (💣 💩 🇷🇺 🇮🇱 🧊 💦 ☢️) to the player's home, where it takes effect                                      | At home, with a free carried slot                  | You travel there (see §6). Syntax `!throw <player> <emoji>` [M]                                                                                                                                                                  |
| `/throw @TheConquister37 💣`                         | Throw at whoever holds Conquister                                                                                               | At home                                            | Instant, no travel [M]. Before 14 Oct: `We @TheConquister37 💣` [S]                                                                                                                                                              |
| `/buy ⚡`                                            | Buy an emoji                                                                                                                    | At home ("le emoji si comprano da casa tua") [M]   | Goes with you if it has a carried power and you have a free carried slot, else into the house; powerless emoji always go into the house [S]. With a full house: "hai già tutti i 10 posti della casa pieni… Nessun addebito" [M] |
| `/buy 🍕 3`                                          | Buy and put it in house slot 3, replacing what is there                                                                         | At home                                            | [S], [M] ("al posto di 💣")                                                                                                                                                                                                      |
| `/take ⚡` / `/take ⚡ 🚀`                           | Move ⚡ from the house to you (swapping 🚀 back)                                                                                | At home                                            | [S]                                                                                                                                                                                                                              |
| `/store ⚡`                                          | Put a carried emoji back in the house                                                                                           | At home                                            | [S]                                                                                                                                                                                                                              |
| `/move 1 2`                                          | Move the house emoji in slot 1 to slot 2                                                                                        | At home                                            | [S]                                                                                                                                                                                                                              |
| `/back` (`!back`)                                    | Go home: from Conquister (instant, you collect your earnings) or from a trip (you turn back)                                    | Anywhere                                           | Replaced `/home` on 8 Oct [S]. Turning back takes as long as you had already travelled (194 cases, 131 exact and the rest within 1 s) [M]                                                                                        |
| `/burn 🍕` / `/burn 500`                             | Destroy an emoji or some balls                                                                                                  | Anywhere                                           | A 💣 or ☢️ burnt hits nobody [S]. Babies can be burnt since 14 Oct [S]                                                                                                                                                           |
| `/leaderboard`                                       | Top 10 with carried emoji, balls, quote count, and who holds Conquister                                                         | Anywhere                                           | [M]                                                                                                                                                                                                                              |
| `/profile [name]`                                    | Carried emoji, balance, rank, location ("a casa", "in viaggio verso X: rientra tra…", "sulla via del ritorno da X…"), 🐔 income | Anywhere                                           | [M]                                                                                                                                                                                                                              |
| `/house [name]`                                      | The 10 house slots by number                                                                                                    | Anywhere                                           | [S], [M]                                                                                                                                                                                                                         |
| `/emoji [emoji…]`                                    | The list of powers, or only those of the emoji given                                                                            | Anywhere                                           | [S]                                                                                                                                                                                                                              |
| `/addquote <text>`                                   | Add a quote; costs 1000 balls                                                                                                   | Anywhere                                           | "Uso: /addquote <testo>. Costa 1000 palle."; reply "hai aggiunto la citazione spendendo 1000 palle" [M]                                                                                                                          |
| `/link <name>`                                       | Link a Telegram account to a registered nick on the IRC network                                                                 | Anywhere                                           | [S]                                                                                                                                                                                                                              |
| `!strada <name>`                                     | Answer the fork in the road (§2.6)                                                                                              | On the road, when asked                            | [S]; seen only on 19 Oct                                                                                                                                                                                                         |
| `!parola <name>` / `/parola <name>`                  | Answer the gatekeeper's riddle (§3.6)                                                                                           | At the door of Conquister, when asked              | [S]                                                                                                                                                                                                                              |

### 1.2 Cooldowns and refusals

- **No stated cooldown on raids, gifts or throws.** The bot accepts a departure the second you are
  home [M]. But since 18 Oct a departure within a minute of coming home is usually a dream (§2.7),
  so in practice there is a cooldown of about 60–120 s.
- **One trip at a time.** "sei già in viaggio, torni tra T" [M]. While travelling you can only turn
  back with `/back` [S].
- **Conquister penalty after a failed entry:** about 5 minutes (§3.4). Retries during the penalty:
  "hai ancora T di penalità" until 18 Oct [M]; since 19 Oct they get no reply [M].
- **Conquister lock (since 19 Oct 02:04):** "@TheConquister37 è chiuso: qualcuno ha appena provato a
  entrare. Riprova tra poco." (§3.5) [M].
- **Freeze:** a 🧊 blocks entering Conquister and leaving home for 30 minutes (§6).
- **Leaving Conquister without `/back`:** `/buy`, `/take` and `/store` sent while you hold
  Conquister first take you home ("torni da @TheConquister37 in X con N palle"), then run [M].
- **Old commands:** since 14 Oct, `We @player …` lines do nothing except point you to the new
  command ("questo comando non c'è più: scrivi /raid @X") [S] [M]. `/home` and `/buyballoon` were
  removed on 8 Oct.

---

## 2. Places and travel

### 2.1 Places

- **Homes.** Every player has one, named after them ("torni in @Alfa"). The bot treats it as the
  place you return to, where you buy, and where raids land [S].
- **@TheConquister37.** The single place to hold. Entering is instant from home, and so is leaving
  with `/back`, which pays out at once [M].
- **On the road ("per strada").** Every raid, gift or throw sends you on a round trip: the outward
  leg, then the same time back [M]. During it "Casa tua resta scoperta" ("your home stays
  uncovered", §2.5) [S] every departure line.

### 2.2 Travel time: distance on a hidden 2D map

- Every player has "una posizione sulla mappa" [S] (Norelec, 18 Sep); in Sep the random mishaps
  could teleport a player elsewhere on the map [S].
- **Travel time between two homes is fixed and symmetric** [M]. Across 13–20 Oct each pair always
  shows the same time in both directions, over hundreds of trips for the busiest pairs.
- **It is Euclidean distance.** The base times of 63 player pairs (21 players) fit distances between
  points on a plane with an RMS error of 0.27 s and a maximum error of 0.7 s, that is, the rounding
  of the displayed seconds [M]. So time = distance ÷ speed, with distances fixed by hidden home
  positions. It is not alphabetical [I].
- **Which homes the times fix** [M]. The map is known only up to rotation and reflection. A home
  measured to 3 or more others is fixed: the 63 times between 21 players over-determine the plane (2
  × 21 − 3 = 39 degrees of freedom), and every good fit put 16 of them within 0.1 s of each other. A
  home measured to exactly 2 others has two spots, mirror images across the line through those two.
  A home measured to 1 other, or none, has no spot.
  - The method (`modules/norelec-tools/src/map/`, which `/map` draws). Fit: stress minimisation,
    every home from a random point of a 300 s cube, moved towards each measured time over 20 000
    passes, the third axis squeezed to nothing over the first half (in the plane alone, a fit folds
    and stays folded); seeds 1, 2, … until 4 fits are within 1 s, the bot's rounding, and the best
    kept. Fixed or not: a player with fewer than 2 pairs is unplaced; one with 2 has the two circle
    intersections; and the check is empirical, every good fit aligned to the best on the players
    with 3 or more pairs that the two fits agree on (2D Procrustes with optional reflection, on the
    triple of players most of the others agree with), a player more than 2 s away in some good fit
    having two spots too. `/map` draws only the fixed homes, and lists the rest as without a place
    until more trips fix them.
- The return leg takes the same time as the outward one (the "Torni in X tra T" lines match the
  outward time within about 2 s) [M].
- Where new players' homes are placed is not known [?].

### 2.3 Rockets 🚀

- Each carried 🚀 makes travel 10% faster, both ways [S]. Numerically, time = base ÷ (1 + 0.1 × 🚀)
  [M]: with 1 🚀, 199 → 180 s, 279 → 253 s, 242 → 220 s, 116 → 105 s, 91 → 82 s. Only rockets
  carried at departure count [S].
- **Rockets add up: time = base ÷ (1 + 0.1 × 🚀)** [M] (observed live, 26–27 Oct): a player carrying
  2 🚀 took 125 s and 75 s on trips whose base times are 150 s and 90 s (÷1.2, not ×0.8).
- The departure line does not say whether the player carries 🚀: on IRC it has the plain form, with
  the boosted time, whatever the player carries [M] (every departure seen live since 22 Oct). The
  rockets show only where a line lists the player's emoji.
- 🚀 does **not** reduce the loot: loot depends on the unboosted distance (§4.1) [M].
- History: +25% per 🚀 from 30 Sep, cut to 10% on 3 Oct.

### 2.4 Measured travel times (one way, without rockets)

Left out of the public edition: the table of measured trip times between named players' homes. The
finding is in §2.2: the times are fixed, symmetric, and fit Euclidean distances on a hidden 2D map
within the bot's rounding; the loot of a full raid is about 7 × the base time (§4.1).

### 2.5 Leaving home uncovered

- While you travel or hold Conquister you are "non a casa". Raids on your home still land, and the
  bot says so ("hai rubato N palle a X, che non era a casa!") [M].
- Carried emoji go with you. A carried 🎈 "difende te dove sei: casa tua quando ci sei,
  @TheConquister37 quando lo tieni", so it does not guard an empty home. A 🎈 kept **in the house**
  guards the house even when you are out [S]. House emoji (🐶 🥺 📮 🔊 🐔 🦖 🧂) work whether you
  are in or out [S].
- The loot is the same whether the victim is home or not (§4.1) [M].
- Gifts that arrive while you are out go into the house [S].

### 2.6 Random travel events (since 18 Oct 22:49, unannounced)

These events were never announced; they are measured from the bot's replies. From 18 Oct 22:44 to
the end of 20 Oct there were 999 departures [M].

| Event       | Text                                                                                                                                                    | Effect                                                                                                                          | Frequency                               | First / last                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| "Dream"     | "eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!"                                                                        | The trip never happened, even when a "parti per…" line was already shown. A 🧊 being carried stays with its owner, in the house | 66 / 999 ≈ 6.6%                         | 18 Oct 22:49 / 20 Oct 15:36                                 |
| Found balls | "Lungo la via trovi N palle!" appended to a departure                                                                                                   | +N balls, N from 102 to 498 in 33 cases                                                                                         | 33 / 999 ≈ 3.3%                         | from 19 Oct 04:00                                           |
| Fork        | "A metà strada la via si divide: ⛰️ collina o 🏞️ fiume? Scrivi !strada <nome> entro 3 minuti: finché non scegli resti fermo, e se non scegli ti perdi." | You stop until you answer. Without an answer: "ti sei perso e sei tornato in X a mani vuote" (19 of the 22 forks)               | 22 / 290 departures ≈ 7.6% while active | Only 19 Oct 06:24–13:54; Norelec called it "troppo forzata" |
| Wording     | "ti riaccoglie", "eccoti di nuovo in X", "rientri in X portando N palle", etc.                                                                          | Cosmetic: the same events in new words                                                                                          | —                                       | from 18 Oct 22:56                                           |

The dream message often appears minutes after the departure, not at its scheduled arrival (delays
from 21 s to over an hour) [M], and sometimes never: the trip simply has no outcome. The reliable
check is `/profile`, which says "a casa" during a dreamt trip [M]. Most dreams are not random: see
§2.7.

### 2.7 Tiredness: leaving too soon after coming home (since 18 Oct 22:49, unannounced)

The dream's wording, "eri così stanco", is literal: the chance that a departure is a dream depends
on how long the player has been home since their last return [M] (19–20 Oct, 939 departures matched
to the player's previous return):

| Time since the last return | Departures | No arrival |
| -------------------------- | ---------- | ---------- |
| under 10 s                 | 174        | 91%        |
| 10–60 s                    | 42         | 48%        |
| 1–5 min                    | 395        | 4%         |
| over 5 min                 | 328        | 8%         |

- After a minute or more the rate falls to about the base rate of 6.6% (§2.6). The base chance does
  not depend on how active the player is [M]: departures binned by the player's number of bot
  messages in the previous hour dreamt 6.3%, 6.1% and 8.9%.
- **A retry right after a dreamt trip is just as tired:** it counts from the same last return, so it
  usually dreams too [M].
- It hits hardest the accounts that leave again within seconds of each return [M].
- **Rule of thumb:** wait at least 60 s, better 120 s, after coming home before leaving again.
- Whether the threshold is a fixed time, a probability falling with time, or something else, and
  whether actions other than returns (buying, entering Conquister) reset it, is not known [?].

---

## 3. @TheConquister37

### 3.1 Entering

- `We @TheConquister37` or `/avventura`, from home [S]. If the holder has no 🎈 (or the 🎈 is
  frozen, §6), you oust them at once [S]. If they have one, the entry is decided by the balloon roll
  (§3.3) or by your ninjas (§3.3).
- You cannot bring emoji or balls into the place: "a @TheConquister37 non si porta niente: per
  bruciare ❤️ scrivi /burn ❤️" [S] [M].
- An ousted player can re-enter at once: re-entries 1–2 s after being ousted were accepted [M] [S].

### 3.2 Earnings

- **1 ball per second** of holding [S]. Measured: exactly 1.000 balls/s on 714 holds of 2 minutes or
  more without ⚡, every day 13–20 Oct [M].
- **⚡ multiplier:** each **carried** ⚡ gives +10% [S]. Measured: ×1.1 with 1, ×1.2 with 2, ×1.3
  with 3, ×1.4 with 4, shown as "hai guadagnato N palle col ⚡ x1.3!" [M]. Losing a ⚡ while inside
  lowers the rate from that moment on; balls already made stay [S].
- **Payment:** the balls build up while you hold, and are paid when you leave (`/back`) or are
  ousted ("X hai guadagnato N palle!") [S] [M].
- **Zodiac signs and day "elements": off since 14 Oct** ("L'oroscopo è spento: ogni giorno vale
  uguale per tutti") [S]. Before, each player had a sign derived from a hash of the name, each day
  had an element, and the sign earned ×1.25 on favourable days and ×0.75 on unfavourable ones [S].
  The 13 Oct holds already paid exactly 1.000/s [M].
- **Boost:** `/buyboost` (×3 for 1500, incompatible with the balloon, added 17 Sep [S]) no longer
  exists; ⚡ took over the role [I].
- **Babies:** produce nothing since 14 Oct [S].

### 3.3 The balloon 🎈 and the entry roll

- **Rule:** each failed attempt (the balloon "resists") raises the chance that the next attempt pops
  it: 25% → 50% → 75% → 100%. A popped balloon "torna nuovo" (back to 25%) and stays with its owner.
  Bombs and theft cannot touch it [S]. The bot says it every time: "Ora il palloncino ha il 50% di
  probabilità di essere bucato" [S].
- **Measured** (all balloon contacts 13–20 Oct, Conquister and raids together) [M]:

  | Stated chance | Attempts | Popped | Rate  |
  | ------------- | -------- | ------ | ----- |
  | fresh (25%)   | 2155     | 546    | 25.3% |
  | 50%           | 1629     | 812    | 49.8% |
  | 75%           | 806      | 601    | 74.6% |
  | 100%          | 192      | 190    | 99.0% |

  The two resists at "100%" both hit the same player, who had one 🎈 carried and one in the house.
  That suggests each 🎈 has its own counter [I].

- **Does the counter decay?** Attempts that came long after the previous one popped less often than
  stated (at the 50% level: 37% when 1–6 h later, 20% when more than 6 h later, on small samples). A
  reset or decay over time is possible but not settled [?].
- **Ninja 🥷:** each carried 🥷 gives 10% to slip past the holder's 🎈 without touching it ("scivoli
  di nascosto oltre il palloncino di X!") [S]. Measured at Conquister: 8.1% with 1 🥷 (n=135), 19.9%
  with 2 (n=206), 30.9% with 3 (n=446), 45.2% with 4 (n=62) [M]. Every skin tone counts (🥷🏿 🥷🏻) [S].
- **Several 🎈 on yourself:** allowed, at 1000 each [M]. Whether a second 🎈 adds protection is not
  shown [?].
- **🦞 lobster:** when you oust someone, each carried 🦞 turns into the emoji the ousted holder had
  in the same slot, with its effect, until you leave ("Le tue aragoste diventano 🎈 finché resti
  qui") [S]; [M] 42 times, e.g. into 🎈, 🚀, 🥷.
- **Frozen holder:** since 18 Oct a frozen player's 🎈 does not defend Conquister either [S] (§6).

### 3.4 Penalty for a failed entry

- When the holder's balloon resists your entry you get a penalty [S].
- **13–18 Oct:** "ha resistito e prendi 5 minuti di penalità" (1105 times). Measured length: 300 s
  (299–301, n=120) [M].
- **Since 19 Oct 00:43:** the bot says only "prendi una penalità" (329 times by 20 Oct), and the
  penalty became **silent and deceptive**: an entry attempted during it gets a fake success [M]
  (19–20 Oct, every entry message matched to the player's last penalty):

  | Attempt came…                        | Real entries | Fake entries |
  | ------------------------------------ | ------------ | ------------ |
  | within 300 s of the player's penalty | 6            | 28           |
  | 300–600 s after it                   | 41           | 1            |
  | with no penalty in the last 10 min   | 303          | 4            |
  - The fake reads like a real entry, "N hai bucato il palloncino di X! N sei in @TheConquister37!",
    but the player never moved (§3.6, entry dream).
  - **Tell:** a real entry by ousting always has the line "N hai cacciato X da @TheConquister37."
    and the ousted holder is paid ("X hai guadagnato N palle!"). The fake has neither, and the
    leaderboard's "In @TheConquister37 ora:" still names the old holder [M] (three fakes on 19 Oct,
    each 10–130 s after the penalty).
  - So the penalty stayed at about 5 minutes. The six real entries inside 300 s (two at 60 s and 69
    s) are unexplained [?].
  - **Rule of thumb:** after "prendi una penalità", wait 5 minutes before trying again.

- **⏳ hourglass:** each carried ⏳ shortens the penalty by 10% [S]. Never used by 20 Oct; Norelec
  noted that nobody had bought one [S].
- A failed raid on a home (the balloon resists) costs no penalty: you go home empty-handed ("ha
  resistito… Torni in X tra T") [M].

### 3.5 The lock (since 19 Oct 02:04, unannounced)

- "@TheConquister37 è chiuso: qualcuno ha appena provato a entrare. Riprova tra poco." [M]; 250
  times by the end of 20 Oct.
- It follows a resisted attempt: 242 of the 249 locked replies came closer to the last resisted
  attempt than to the last successful entry. They came 1–72 s after it (median 34 s), and no new
  resisted attempt came less than 46 s after the previous one [M]. So after a failed attempt the
  place is closed to everyone for roughly 45–70 s [I]. Successful entries can still follow each
  other within a second [M].

### 3.6 Gatekeeper and entry dreams (since 19 Oct, unannounced)

- **Gatekeeper:** "alla porta di @TheConquister37 il guardiano ti ferma e chiede: come si chiama
  questo frutto? 🍎 Rispondi con !parola <nome> entro 3 minuti." [M] (8 times, 19–20 Oct). A right
  answer: "il guardiano ti fa passare" [M]. No answer in time: "la porta… resta chiusa per te per 3
  minuti e 22 secondi" (another time 3 min 34 s) [M].
  - **It is a riddle for bots, part of the game** [S]. The fruit changes; the answers accepted, in
    the singular: 🍍 ananas, 🍑 pesca, 🍒 ciliegia, 🍊 arancia, 🍇 uva, 🍈 melone [M]. The right
    answer lets the entry go on in the same message (passed, then the entry or the 🎈's roll) [M]. A
    wrong or empty answer: "il guardiano scuote la testa e ti chiude la porta di @TheConquister37:
    riprova tra 4 minuti e 58 secondi" [M]. Scripted players answered it 4–14 s after the question
    [M]. The question says `!parola` to IRC players and `/parola` to Telegram players [I].
- **Entry dream:** "eri così stanco che hai solo sognato di entrare in @TheConquister37: non ti sei
  mai mosso da casa!" (23 times from 19 Oct 02:03 to 20 Oct) [M]. The attempt does nothing.
  - It is the other half of the silent penalty (§3.4): the player first gets the fake success, and
    the dream line comes later, **inside the next player's entry message**, as an extra line after
    "… sei in @TheConquister37!" [M] (a dream at 15:00:01, revealed at 15:00:39 in another player's
    entry). Nothing is addressed to the dreamer at the time.

### 3.7 What happens to the ousted player

- They are paid what they made ("X hai guadagnato N palle"), with the ⚡ multiplier, and are at home
  at once: a player ousted at 00:43:57 was robbed at home at 00:44:15 (no "non era a casa") [M].
- No penalty and no cooldown for them [M].

### 3.8 Throws at the holder

- `/throw @TheConquister37 <emoji>` hits whoever is inside, instantly [S] [M]. Confirmed again on 21
  Oct with a 💦 from home, delivered at once: "Alfa la tua 💦 è arrivata addosso a Bravo in
  @TheConquister37: tra 9 ore si vedrà." [M].
  - 💣 destroys one powered emoji they carry ("si porta via 🥷") [M].
  - 💩 and the flags make them "lo smerdato" [S].
  - 💦 gives a baby after 9 h [S]. At a home whose player is out it comes back: "a casa di @Bravo
    non c'è nessuno: la 💦 te la riporti a casa" [M] (16 times, always a 💦; a 🧊 freezes a player
    who is out, §6).
  - ☢️ resets the whole game [S] [M].
  - 🧊 freezes them (§6).
- A 📮 does not protect the holder: it guards only the home [S].

### 3.9 Quotes (`/addquote`)

- 1000 balls per quote [S] [M].
- After every successful entry the bot posts a random stored quote [M].
- The leaderboard shows each player's quote count [M].
- In Sep a quote also gave back 1 simpatia point [S] (§4.4). No other effect is known [?].

---

## 4. Theft and raids

### 4.1 How much is stolen

- **Rule (measured):** a successful raid takes about **7 balls per second of the unboosted one-way
  travel time** between the two homes, capped by what the victim has [M].
  - 1182 thefts 13–20 Oct. The ratio stolen ÷ base time is 7.00 (median) every day, and 64% of
    thefts fall in 7.0–7.2 exactly; the rest are lower because of 🥺 or because the victim had less.
  - Examples: base 36 s → 257; base 57 s (52 s with 🚀) → 406; base 191 s → 1337; base 58 s → 411.
  - Values just above 7× (257 for 36 s) fit an exact distance that the display rounds down (36.7 s)
    [I].
- Rockets do not shrink the loot: thieves with 1 🚀 take 7.83 × their actual (shorter) return time,
  against 7.10 without [M].
- Norelec stated it on 2 Oct: "Il bottino però dipende dalla strada percorsa… da una casa così
  vicina sono solo 212 palle a viaggio" [S].
- **The golden hour ("ora d'oro", since 23 Oct):** every day from 21:00 to 22:00 Italian time a
  successful raid takes twice the loot (2102 instead of 1051 on the same pair) [S] [M]; the bot
  announces its start and end ([bot-protocol.md](bot-protocol.md) §3.7).
- **Cap:** you cannot take more than the victim holds: a victim with 160 lost 160, one with 641
  lost 641. "hai rubato 0 palle" from players at 0 [M].
- Some thefts below 7× are not explained by 🥺 or the cap (e.g. 1360 instead of about 1680) [?].
- History: until about 18 Sep the loot was a share of the victim's balance, modified by zodiac ("♊️
  gemelli contro ♌️ leone: 125/100") [S]. The random-rules days of 18–19 Sep set it to "un 4esimo"
  or "un 2esimo" [S].

### 4.2 Outcomes of a raid on arrival (order of checks partly unknown)

1. **Alarm 🔊 vs ninja 🥷.** Each of the raider's 🥷 gives 10% to slip past 🎈 and 🐶. Each of the
   victim's 🔊 in the house takes 10 points off that chance; "L'allarme di X ti scopre: devi
   vedertela con le sue difese" [S] [M] (15 times, all on 17 Oct). Measured ninja success on homes:
   5.0% (1 🥷, n=120), 16.7% (2, n=144), 27.8% (3, n=72), 37.3% (4, n=193), a little below 10% per
   ninja, consistent with some 🔊 [M]. A ninja success reads "scivoli di nascosto oltre le difese di
   X e rubi N palle" [M].
2. **Balloon 🎈** (the victim's carried 🎈 if they are home, the house 🎈 always): the same
   25/50/75/100% roll as in §3.3. If it resists you go home empty-handed, with no penalty [M].
3. **Dog 🐶:** each 🐶 in the house has a 10% chance to stop the raid: "il cane di X ti ha
   intercettato: niente bottino" [S]; [M] 31 times.
4. **Pity 🥺:** each 🥺 in the house cuts the loot by 10% (10 🥺 = nothing) [S]; [M] "X ti ha
   impietosito: gli rubi 288 palle invece di 411 palle (30% in meno)" (83 times).
5. **Dinosaur 🦖:** each 🦖 in the house has a 10% chance to eat one emoji the raider carries (never
   the 🎈) [S]; [M] "Il 🦖 di @Bravo ti mangia 🏴‍☠️" (11 times).
6. **Pirate flag 🏴‍☠️:** after a successful raid, each carried 🏴‍☠️ gives 10% to also take one random
   emoji from the victim's house (never the 🎈). It goes onto you if you have a free carried slot
   [S]; [M] "Arrembaggio: ti porti via anche 🧊 da casa sua" (41 times to 22 Oct).
   - **Without a free carried slot it takes nothing, silently** [M]: 0 in 561 rolls, against 8.1%
     per 🏴‍☠️ (32 in 395) with one. One raider carried off 4 emoji from the same house in 14 raids
     until their slots were full, then none in the next 60.
   - **A raid that takes 0 balls still rolls it** [M]: "hai rubato 0 palle", then "Arrembaggio",
     from a victim with no balls and with the loot cut 100% by 🥺; 3 in 30 rolls. What counts is
     getting past the defences, not the loot.
   - **The pick is among the emoji left**, "un'emoji a caso tra quelle rimaste a casa del bersaglio"
     [S], so a house with one emoji gives the same 10% as a full one. The data agrees, weakly [M]:
     houses with one or two emoji that could be taken gave 2 in 10 raids, where a rate scaled by the
     emoji left would give 1–2%.
   - The bot then lists the raider's carried slots: "ora hai con te 🏴‍☠️🧊🎈🎈®️" [M]. The raid's own
     line shows them before the plunder.
7. **Salt 🧂:** if the same raider arrives again within 5 minutes, at the second arrival they pay
   the victim 10% of the **raider's** balls per 🧂, up to 100%. Only raids that reach the house
   count, and the count resets after paying [S]. [M] 4 times: 21902, 86, 1606, 1683.

### 4.3 Shield and bank (both gone)

- **Shield ("scudo"):** existed in Sep and was removed on 24 Sep ("HAI LEVATO LO SCUDO") [S].
- **Bank:** in Sep players could deposit balls safe from raids, with daily interest that ⚡ boosted
  [S]. It was removed on 25 Sep: "è fallita la banca", "troppo sbilanciata" [S].
- No bank, shield or other safe storage exists at the end [I]: no bank lines in the 13–20 Oct
  messages.

### 4.4 Simpatia

- Introduced on 18 Sep [S]:
  - Everyone starts at 20.
  - Each successful theft costs the thief 1 point and gives the victim 1.
  - A quote gives back 1 point, and so does each day, up to 20.
  - Below 18 the bot announces "SEI ANTIPATICO. Ti denuncio alla Guardia di Finanza", and `/profilo`
    showed it.
- No penalty beyond the announcement was described [S].
- In the 13–20 Oct messages the bot never mentions simpatia, and `/profile` no longer shows it. It
  is probably gone, or at least silent [I].

### 4.5 Other raid facts

- Milestones are announced ("🎉 Alfa 100 raid riusciti!", "… 500 raid riusciti!") [M].
- Stolen balls are credited on arrival home ("rientri in X portando N palle") [M]. Whether they can
  be lost on the way back is unknown [?].
- **Balls on the road cannot be stolen.** A gift of balls leaves the giver's balance at departure
  and reaches the recipient on delivery; turned back with `/back`, it comes home with the giver
  ("torni in X con le tue N palle ancora in tasca") [M] (28 Oct; [bot-protocol.md](bot-protocol.md)
  §3.1). A raid that lands meanwhile finds the balls gone, so a player can carry them away from a
  raid and bring them back; players have done so in the open (early Nov) [I].

---

## 5. Emoji

### 5.1 Slots

- **Carried, 5 slots** ("con te", shown next to your name), and **house, 10 slots** (`/house`) [S].
- An emoji in the wrong area does nothing [S]: carried 🧂 "con te non fa niente" [M].
- `[]` in a name is an empty carried slot [M].

### 5.2 Prices and escalation

- **Base price 1000** for every emoji, decorative ones included, except ☢️ (1,000,000) [M] (every
  "hai speso" line).
- **Not only emoji:** the shop sells plain characters too, as decorative ones: a player bought a π
  and burnt it [M] (5 Nov).
- **Escalation:** price = ⌊1000 × 1.5ⁿ⌋, where n = copies of that emoji already "in giro" in the
  game [S] "il valore dell'emoji è in base a quante ce ne sono in giro"; [M]:

  | n     | 0    | 1    | 2    | 3    | 4    | 5    | 6     | 7     | 8     | 9     | 10    |
  | ----- | ---- | ---- | ---- | ---- | ---- | ---- | ----- | ----- | ----- | ----- | ----- |
  | price | 1000 | 1500 | 2250 | 3375 | 5062 | 7593 | 11389 | 17083 | 25624 | 38436 | 57654 |

  Seen: 🧊 ×1.5, 🔥 ×3.37 and ×5.06, 🏴‍☠️ ×17.08 and up to ×57.65.

- **What counts as "in giro":** copies carried, in houses, and being carried on a trip [M]: a 🧊
  cost 1500 while another player was on the road with one, and 1500 while another sat in a house.
  Thrown (consumed) and burnt copies stop counting: a player's second 🧊 cost 1000 after their first
  was thrown.
- **Each code point counts separately:** ⚡ and ⚡️ (with the variation selector) had separate
  counters, as did 🥷, 🥷🏿 and 🥷🏻 [M].
- **🎈 is exempt:** always 1000 ("ce n'erano già 47 in giro, prezzo x1") [M].
- **Without enough balls:** "ti servono N palle per X (ne hai M)" [M].

### 5.3 Every emoji with a power, as of 20 Oct

Effects are from the last `/emoji` listing (19 Oct 03:04) unless noted. Area: **C** = carried (works
where you are), **H** = house (works even when you are out), **T** = thrown (consumed).

| Emoji                       | Area   | Effect                                                                                                                                                                                                                                             | Probability / size       | Stacking                       | Measured                               |
| --------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------ | -------------------------------------- |
| 🎈 balloon                  | C or H | Carried: defends you, your home while you are there, and Conquister while you hold it. In the house: defends the house even when you are out. Pops and comes back new; bombs and theft cannot touch it; your last 🎈 cannot be given away          | 25/50/75/100% escalation | One counter per balloon [I]    | §3.3                                   |
| 🚀 rocket                   | C      | Travel 10% faster, both ways                                                                                                                                                                                                                       | ÷(1 + 0.1 × 🚀)          | Additive [S]                   | §2.3                                   |
| ⚡ lightning                | C      | +10% balls in Conquister                                                                                                                                                                                                                           | ×(1 + 0.1 × ⚡)          | Additive                       | ×1.1–×1.4 measured, §3.2               |
| 🦞 lobster                  | C      | In Conquister, becomes the ousted holder's emoji in the same slot, with its effect, while you stay                                                                                                                                                 | —                        | Per 🦞                         | 42 transformations                     |
| 🥷 ninja (any skin tone)    | C      | 10% to pass 🎈 and 🐶 without touching them, on homes and at Conquister                                                                                                                                                                            | 10% per 🥷               | Additive                       | §3.3, §4.2                             |
| 🏴‍☠️ pirate flag              | C      | 10% to steal one emoji from the victim's house on a successful raid                                                                                                                                                                                | 10% per 🏴‍☠️               | Additive                       | §4.2                                   |
| 🔥 fire                     | C      | Each 🔥 shortens a 🧊 freeze by 10%; with 10 you never freeze [S]                                                                                                                                                                                  | 10% per 🔥               | Additive                       | 2 🔥 gave a 24-minute freeze (§6.1)    |
| ⏳ hourglass                | C      | Each ⏳ shortens the Conquister penalty by 10%                                                                                                                                                                                                     | 10% per ⏳               | Additive                       | Never bought by 20 Oct [S]             |
| 🥺 pleading face            | H      | Raiders steal 10% less per 🥺                                                                                                                                                                                                                      | 10% per 🥺               | Additive (10 = nothing stolen) | "30% in meno" etc., 83 times           |
| 🐶 dog                      | H      | 10% to stop a raid; the thief goes home empty-handed                                                                                                                                                                                               | 10% per 🐶               | Additive [S]                   | 31 interceptions                       |
| 📮 mailbox                  | H      | 10% to send back what is thrown at your home (💩 💣 ☢️ 💦 🧊, flags; 🌀 when it worked); gifts always pass                                                                                                                                         | 10% per 📮               | Additive                       | 4 returns (a 💣, a 💦, …)              |
| 🔊 alarm                    | H      | Takes 10 points off a raider's ninja chance; not valid at Conquister                                                                                                                                                                               | −10 points per 🔊        | Additive                       | 15 alarms                              |
| 🐔 hen                      | H      | 1 ball per minute, even when you are out                                                                                                                                                                                                           | 60/hour per 🐔           | Additive (10 = 600/h) [S]      | `/profile` "1 🐔: 60 palle all'ora"    |
| 🦖 dinosaur                 | H      | 10% to eat one emoji the raider carries (not 🎈)                                                                                                                                                                                                   | 10% per 🦖               | Additive                       | 11 times                               |
| 🧂 salt                     | H      | A raider who comes back within 5 min pays you 10% of their balls per 🧂, up to all                                                                                                                                                                 | 10% per 🧂               | Additive                       | 4 times, §4.2                          |
| 💣 bomb                     | T      | Destroys one random powered emoji where it explodes (at a home: the house emoji, plus carried ones if the owner is in; at Conquister: the holder's carried ones). 10% are defective and explode in your hand, destroying one of your carried emoji | 10% defective [S]        | —                              | 47 thrown 13–20 Oct, 2 defective       |
| 💩 🇷🇺 🇮🇱                    | T      | The target is "lo smerdato" (a title next to the name) for 1 day; a new hit restarts the 24 h [S]                                                                                                                                                  | —                        | —                              | Seen                                   |
| ☢️ nuke                     | T      | Costs 1,000,000. On a home: that player restarts from 0 balls and only the starting 🎈. On Conquister: the whole game restarts (everyone 0 balls, starting 🎈 only, place empty, nobody travelling); players, houses and quotes stay               | —                        | —                              | Both used on 14 Oct (§7.3)             |
| 💦                          | T      | After 9 h a baby is born on the target's name (at a home only if the target is in); 📮 can send it back                                                                                                                                            | —                        | —                              | 35 throws 13–20 Oct                    |
| 🧊 ice                      | T      | Freeze for **30 minutes**: no Conquister, no departures, and your 🎈 does not defend (§6)                                                                                                                                                          | —                        | Re-freeze resets the timer [M] | §6                                     |
| Babies 👶 👦 👧 👨 👩 👴 👵 | H      | Born from 💦, age one step per day, then leave. **No effect since 14 Oct**; untouchable by bombs and theft; can be moved or burnt [S]                                                                                                              | —                        | —                              | Births until 14 Oct                    |
| Everything else             | H      | Decorative: no effect, immune to bombs, but a 🏴‍☠️ can steal it from a house                                                                                                                                                                         | —                        | —                              | 🌀 🕋 ⛪ 🧲 🪤 are decorative now (§8) |

---

## 6. 🧊 Ice in full

### 6.1 Rules as of 20 Oct

| Point                   | Rule                                                                                                                                                                                                                                                                                         | Source                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Price                   | 1000, escalating like any emoji: 1500 when one other 🧊 is in the game                                                                                                                                                                                                                       | [S] listing; [M]                                                                                                                                                                                                                                                                                                   |
| Buying                  | `/buy 🧊`, at home; it goes into the house ("Non dà nessun bonus: aspetta in casa finché non la lanci")                                                                                                                                                                                      | [M]                                                                                                                                                                                                                                                                                                                |
| Syntax                  | `/throw @player 🧊` (`!throw player 🧊`); at the holder: `/throw @TheConquister37 🧊`. Until 14 Oct: `We @player 🧊`                                                                                                                                                                         | [S] [M]                                                                                                                                                                                                                                                                                                            |
| Must be carried         | The 🧊 must travel with you: throwing needs a **free carried slot**. With 5 carried emoji: "hai già 5 emoji con te: per portare 🧊 serve un posto libero. Rimetti qualcosa in casa con !store <emoji>." Given a free slot, the bot moves it from the house by itself                         | [M]                                                                                                                                                                                                                                                                                                                |
| Not remote (at a home)  | You travel to the target's home with the 🧊 ("parti per Bravo con 🧊 da consegnare: arrivi tra 1 minuto e 51 secondi. Casa tua resta scoperta."). The trip takes the same time as a raid, and the freeze lands on arrival. You are away from home, uncovered, for the whole round trip       | [M]                                                                                                                                                                                                                                                                                                                |
| At Conquister           | Hits whoever is inside, at once (§3.8): on 23 Oct each of five throws froze the holder in the second it was sent                                                                                                                                                                             | [S]; [M] 23 Oct                                                                                                                                                                                                                                                                                                    |
| Consumed                | Yes: a thrower's house lost its 🧊, and they had to buy another                                                                                                                                                                                                                              | [S] "Si consumano"; [M]                                                                                                                                                                                                                                                                                            |
| Turning back            | `/back` during the trip brings the 🧊 home unused ("torni in @Alfa con 🧊 ancora in tasca")                                                                                                                                                                                                  | [M]                                                                                                                                                                                                                                                                                                                |
| Target need not be home | It freezes a player who is out: one away on a raid was frozen, and so was one already on the road                                                                                                                                                                                            | [M]                                                                                                                                                                                                                                                                                                                |
| Success chance          | No roll was ever seen: 🎈 and 🐶 do not stop throws, only a 📮 can send it back (10% per 📮)                                                                                                                                                                                                 | [S]; [M] 10 of 10 arrivals froze, two of them at a house with 📮                                                                                                                                                                                                                                                   |
| Duration                | **30 minutes** since 18 Oct 22:44 (5 minutes before)                                                                                                                                                                                                                                         | [S]; [M] §6.3                                                                                                                                                                                                                                                                                                      |
| Frozen: cannot          | Enter Conquister; start a raid, gift or throw ("una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri T")                                                                                                                                                        | [S] [M]                                                                                                                                                                                                                                                                                                            |
| Frozen: 🎈 off          | Since 18 Oct the frozen player's 🎈 defends neither the home nor Conquister, the 🎈 kept in the house included; the house's 🐶 still do                                                                                                                                                      | [S]; [M] one raider robbed a frozen player 5 times in a row without touching its 🎈, and the first raid after the thaw had to pop it; on 23 Oct, of 17 raids on a frozen player whose house holds a 🎈, 16 got through without touching it and one was stopped by a 🐶, while the raids when not frozen met the 🎈 |
| Frozen: can             | Finish a trip already under way and come home; be raided; add quotes; burn (a frozen player robbed someone and burnt the loot 1.8 s after coming home, 3 Nov)                                                                                                                                | [M]                                                                                                                                                                                                                                                                                                                |
| In Conquister           | The frozen holder stays in the place, but once ousted cannot come back until the freeze ends; the ousted holder hears "una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri T". Since their 🎈 no longer defends (18 Oct), the first entrant ousts them at once | [S]; [M] 23 Oct: four frozen holds, each ended by the first entrant 3 to 18 minutes after the freeze                                                                                                                                                                                                               |
| Ousts?                  | No, a freeze does not oust                                                                                                                                                                                                                                                                   | [S]; [M] 23 Oct: the frozen holder stayed until someone entered                                                                                                                                                                                                                                                    |
| Counters                | 🔥 carried: −10% duration per 🔥 (10 = immune); 📮 in the target's house: 10% per 📮 to send it back to the thrower's house, at a home only                                                                                                                                                  | [S]; [M] two 🔥 gave 24 minutes; two 📮 sent back none of five throws at a holder (23 Oct)                                                                                                                                                                                                                         |
| Repeated throws         | No limit or cooldown is stated or seen. A second freeze on a frozen player **restarts** the timer from the later hit; it does not add up                                                                                                                                                     | [M] 17 Oct: a player frozen twice, 30 s apart, thawed 5:00 after the second hit                                                                                                                                                                                                                                    |
| Theft                   | A 🧊 in a house can be stolen by 🏴‍☠️, landing on the thief's carried slots                                                                                                                                                                                                                    | [M]                                                                                                                                                                                                                                                                                                                |
| Dream                   | A throw can turn into a "dream" (§2.6): nothing happens, and the 🧊 stays with the thrower                                                                                                                                                                                                   | [M]                                                                                                                                                                                                                                                                                                                |

### 6.2 Every observed throw

Left out of the public edition: the log of every throw (13 throws, 2–21 Oct, with thrower, target,
times and outcome). §6.3 summarises it. One pattern from it is a rule: a player with 5 carried emoji
and the 🧊 in the house is refused every time (31 and 56 refusals in a row were seen); the bot never
frees a slot by itself.

### 6.3 Measured summary

- **Throws that reached their target:** 10 of 10 froze it. Of the 13 launched, 1 was turned back, 1
  was a dream, and 1 has no logged outcome.
- **Duration:** exactly 300 s (±1 s) while the rule was 5 min. Exactly 1800 s after 18 Oct 22:44
  (two throws checked to the second).
- **Throw trip:** the same time as a raid between the two homes [M].
- On 18 Oct Norelec said the 🧊 had been thrown "solo 2 volte" since the reset. The messages show 4
  throws between the reset and then (16–17 Oct).

---

## 7. Economy

### 7.1 Income

- **Holding Conquister:** 1 ball/s × (1 + 0.1 × ⚡) (§3.2). "Praticamente l'unica fonte": 417,086
  balls in three days of Sep came from holds [S].
- **🐔:** 60 balls per hour each [S] [M].
- **The wanderer's bag** (new on 22 Oct, unannounced): "🧙 Un viandante lascia cadere un sacchetto
  di palle davanti a @X! Il primo che scrive /raccogli (!raccogli su IRC) se lo prende." The first
  to answer takes it: "🎒 Charlie raccoglie il sacchetto del viandante: 1762 palle!", 48 s later [M]
  (22 Oct). How often bags fall and what they hold is not known yet [?].
- **Found on the road** (since 19 Oct): +102 to +498 on about 3% of departures [M].
- **Transfers, which create nothing** [S]:
  - raids, about 7 × base seconds (§4.1);
  - gifts (`/give`), up to 118,931 balls in one gift [M];
  - salt payments (§4.2).
- **Gone:**
  - the bank with interest (until 25 Sep);
  - babies, 1 ball/s as adults, until 14 Oct [S];
  - the Sep minigames, whose prizes reached 5,000,000 balls [S]. None appear in the 13–20 Oct
    messages [M];
  - random mishaps of −3 to +2 balls [S].

### 7.2 Sinks

- Emoji purchases, with escalating prices (§5.2).
- Quotes at 1000 each, "lo scarico più grande" in Sep [S].
- `/burn` of balls or emoji.
- ☢️ at 1,000,000.
- Losses to bombs (emoji) and to salt (balls) [S].

### 7.3 Balances, resets, seasons

- **Reset of 14 Oct 08:04:** a player with over 2 million balls bought two ☢️. They nuked another
  player's home at 08:02:40, then @TheConquister37 at 08:04:53: "il gioco riparte da zero. Tutti
  senza palle e con il solo 🎈 di partenza" [M]. Norelec: "il gioco è RESETTATO" [S].
- **Earlier wipes:** the bank's removal on 25 Sep ("in due giorni hai distrutto 2 volte il gioco").
  A script on 3 Oct damaged the name tables of the state and of all backups; the live state was
  repaired from a copy [S].
- **Seasons:** NorelecBot has none. The "stagioni" in the chat belong to another bot's game
  (@LoreGameBot, [game-bots.md](game-bots.md)) [I].
- **Balances at the end** (leaderboard, 20 Oct 22:16): the top balance was under 90,000 balls, four
  players were above 25,000, and the rest of the top 10 had under 1,000 [M]. Before the reset the
  top balances ran into the millions. The per-player table is left out of the public edition.
- **Starting state:** 0 balls and one carried 🎈, as after the reset [S]. New players presumably
  start the same way [I].

---

## 8. Changes since 13 Sep

Dates are UTC−4. **[S]** unless marked.

**September**

- **28 Aug:** the Telegram ↔ IRC bridge (relayed by the account "Regno") is restored ("bridge
  ripristinato"). **13 Sep:** its relay code is reworked.
- **16 Sep:** Conquister pays 1 ball/s; balloons cost 1000. Balloon escalation 25/50/75/100% and a
  5-minute penalty; special immune balloons for two players, later dropped.
- **17 Sep:** `/buyboost` ×3 for 1500, incompatible with the balloon. Zodiac signs and day elements,
  ×1.25 / ×0.75.
- **18 Sep:**
  - Raids that travel; an NPC attacks Conquister every 1–10 min.
  - `/profilo`.
  - Simpatia.
  - 25 random mishaps every 5–30 min.
  - Word triggers that win or lose balls.
  - Rules changing by themselves at random intervals: prices, multipliers, raid share, travel speed,
    fines, penalties.
- **19 Sep:** Minigames opened by the bot every 40–120 min, then generated automatically.
- **24 Sep:** Shield removed.
- **25 Sep:** Bank removed.
- **27 Sep:** Gifts of balls.
- **30 Sep:**
  - ⚡ +25% each instead of +50%; 🦞 added.
  - 💩 "lo smerdato".
  - 🚀 +25%.
  - 🥺 −5% each.

**October**

- **1 Oct:**
  - 💣.
  - ☢️.
  - 🎈 becomes a real emoji; it does not vanish when popped and is immune to bombs.
  - Free `/buyballoon`; 🐶.
  - 📮.
  - 🥷; 🔊.
  - 🌀, made admin-only.
  - 🏴‍☠️.
  - 💦 thrown.
  - 🐔.
  - Price escalation in force: "in base a quante ce ne sono in giro".
- **2 Oct:**
  - Adult babies earn 1 ball/s; families.
  - 🪤.
  - `/emoji`.
  - 🥺 and 🪤 to 10%.
  - **🧊 added: 5-minute freeze.**
  - Ummah 🕋.
  - 🔥, ⏳, Chiesa ⛪.
- **3 Oct:**
  - 🇷🇺 🇮🇱 count as 💩.
  - 🚀 and ⚡ cut to 10%.
  - 🦖.
  - Ummah and Chiesa abolished.
  - 🧲 added, then 🧲 and 🪤 made powerless.
- **6 Oct:** `/avventura`.
- **8 Oct:**
  - 🧂.
  - `/buy`, `/raid`, `/give`, `/throw`; 🌀 becomes decorative.
  - `/burn`; `/buyballoon` removed.
  - `/home` and `/move`.
  - Two slot areas, 5 carried and 10 house, with `/take` and `/store`.
  - `/back` replaces `/home`; `/house`.
- **14 Oct:**
  - 08:04: ☢️ reset of the whole game.
  - 13:34: babies earn nothing and can be burnt; `We @player …` lines retired except for entering
    Conquister; `/emoji 🧂⚡` filter; **horoscope off**; nothing can be carried into Conquister;
    throws at the holder use `/throw @TheConquister37`; `/house` and `/profile` split.
- **18 Oct 22:44:**
  - **🧊 freezes for 30 minutes instead of 5, and the frozen player's 🎈 does not defend**, neither
    the home nor Conquister.
  - You cannot give away your last 🎈.

**Unannounced, 18–20 Oct (all [M])**

- 18 Oct 22:49: travel "dreams", mostly for leaving soon after coming home (§2.7).
- 18 Oct 22:56: varied wording of returns.
- 19 Oct 00:43: the penalty becomes silent, "una penalità".
- 19 Oct 02:03: entry dreams: entries during the penalty get a fake success (§3.4).
- 19 Oct 02:04: lock after a failed attempt.
- 19 Oct 04:00: balls found on the road.
- 19 Oct 06:24–13:54: fork in the road with `!strada`.
- 19 Oct 13:49: the gatekeeper's fruit riddle with `!parola`.
- All of these except the fork were still running at the end of 20 Oct.
- 23 Oct 21:00 (Italian time): the first golden hour, double loot for an hour, every day (§4.1).

**What the chat says about the changes.** Players read the 19 Oct changes as measures against
scripted players ("l'ultima contromisura del guardiano su conquister"). Norelec stated no such
purpose [I].

---

## 9. Open questions

1. **Penalty length since 19 Oct:** entries within 300 s are almost all fake (§3.4), but six were
   real, two of them after 60 s and 69 s. Whether the length is now random is not settled.
2. **Lock length:** about 45–70 s after a resisted attempt, inferred from the gaps. The exact rule
   (fixed or random, and whether it also follows successful entries) is not stated.
3. **Balloon counter:** whether the 25/50/75/100% level decays or resets over time, and whether
   carried and house balloons (or several carried ones) keep separate counters or add protection.
4. **Order of home defences** (🔊/🥷, then 🎈, then 🐶, 🥺, 🦖, 🏴‍☠️): stated only piecemeal; which
   balloon is hit when you are home with both a carried and a house 🎈.
5. **🔥 against 🧊:** one observation (two 🔥, 24 minutes) fits "10% per 🔥" as a share of 30 min;
   more data would settle it.
6. **🧊 at Conquister:** whether 📮 has ever sent back a 🧊.
7. **What a frozen player can still do:** `/buy`, `/take`, `/store`, `/give` while frozen were never
   tried in the data (`/burn` works, §6). Whether turning back (`/back`) works during a freeze.
8. **A 🧊 throw of 19 Oct 19:54:** no outcome logged.
9. **Dreams:** the exact tiredness rule (§2.7: threshold or curve, and what resets it), when a dream
   is decided and revealed (the message often comes minutes later, or never), and whether some
   accounts are exempt (claimed in the chat; the data shows the accounts named dreaming).
10. **Loot:** the cases below 7 × distance not explained by 🥺 or the victim's balance, and whether
    loot on the way home can be lost.
11. **Rocket stacking:** settled since (÷1.2 with two, §2.3).
12. **Simpatia:** whether it still exists silently.
13. **New players' map positions,** and one trip of 49 s on a pair whose time is 150 s (19 Oct).
14. **Bomb defect rate:** stated 10%, measured 2 of 47 (4%); the sample is small.
15. **Escalation counting:** whether emoji in transit as gifts and babies count as "in giro"
    (in-transit 🧊 did count); whether a variant code point (⚡ vs ⚡️) shares an effect but not a
    price counter, as it appears.
16. **Rule volatility:** rules changed almost daily, several times without announcement (§8). Any of
    the above may have changed after 20 Oct.
