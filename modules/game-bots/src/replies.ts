/**
 * What the owner gets from a turn of the group's game bots, as their parser plugins publish it
 * (`Outcome`), with the grammars of two of them: @LoreGameBot and @EpicLorelecBot, in the private
 * chat with each or in the group. Pure: their parser plugins (@megabottron1999/turns/turn-parser.ts)
 * decide which messages answer the owner's turns. The rests between turns are here too, as the bots
 * state them or as measured (docs/game-bots.md §2). @InventoryBot's parser is InventoryBotTron's
 * (https://github.com/djjeck/InventoryBotTron), whose outcomes have this shape too.
 *
 * - @LoreGameBot replies to the command and names nobody. A turn (`/avventura`, `/lore`, `/l`) reads
 *   "Lore - <place> [<code>]", a story (free text, written by players: nothing in it is trusted),
 *   then, in about one turn in nine, an encounter ("Durante il tuo cammino compare <enemy> [L3]!", "Il
 *   combattimento inizia...", and the fight's line), and ends in its outcome: "Hai ottenuto [2x]
 *   <item> [(0 - 1)] [M2]!" (the item's name may span lines), a fight lost ("Torni a casa dolorante
 *   e a mani vuote..."), the item lost in a draw ("L'oggetto si perde nello scontro..."), or, after
 *   a gain, a level-up ("🎉 Congratulazioni, hai raggiunto il livello 4! 🎉", "Ottieni:" and its
 *   list). Outside a turn: the cooldown ("Non è passato abbastanza tempo! Riprova fra …", sometimes
 *   followed by a quip), "Stai calmo maschio..." or "Non sei registrato!". Anything else is kept as
 *   not understood. docs/game-bots.md §5 is the grammar's specification.
 *
 * - @EpicLorelecBot counts the player's "rotture": "Complimenti 78, <display name>, mi hai rotto il
 *   cazzo 53 volte!" (the count may be negative, and lines of the day's event may come first); it
 *   names the player by display name, so only its private chat tells it is the owner's. Its cooldown,
 *   "Non è passato abbastanza tempo dall'ultima rottura! Riprova fra …", may come after a
 *   parenthesis ("(🎲 un inciso) "), and replies to the command.
 *
 * The bots write some accented letters decomposed ("e" and a combining grave for "è"), so the text
 * is read in its composed form (NFC), and the items are kept in it.
 */

export const INVENTORYBOT = 'InventoryBot';
export const LOREGAMEBOT = 'LoreGameBot';
export const EPICLORELECBOT = 'EpicLorelecBot';
export type GameBot = typeof INVENTORYBOT | typeof LOREGAMEBOT | typeof EPICLORELECBOT;

/**
 * The turn command each of the three bots takes, in private and in the group: each parser's spec
 * names its bot's (`turnCommands`, a fact of the game, MegaBotTron1999's bot-os.md D70), which a
 * shell `player` bound to the parser offers to play. One turn each: the first entry its name, the
 * rest its aliases (D140), in the owner's order of preference, which the player follows on a tie of
 * reach: the bot's own command first, the shared `/avventura` after it, abbreviations last. In a
 * group, the bare `/avventura` still wins by reach whenever it plays several bots' turns at once.
 */
export const TURN_COMMANDS: Readonly<Record<GameBot, readonly string[]>> = {
  [INVENTORYBOT]: ['/avventura'],
  [LOREGAMEBOT]: ['/lore', '/avventura', '/l'],
  [EPICLORELECBOT]: ['/rompimiilcazzo', '/avventura'],
};

/**
 * The commands of @LoreGameBot (the turn's, and those of the game that move the owner's state) that
 * a ban holds back. It answers a banned player's every message with the ban, whatever the command,
 * so a ban is the account's: the parser declares it a hold on these (MegaBotTron1999's bot-os.md
 * D98), for the commands a node queues. A command the list lacks is not held by the shell: an actor
 * checks the ban itself (`bannedUntil`, `src/bans.ts`).
 */
export const LORE_COMMANDS: readonly string[] = [
  ...TURN_COMMANDS[LOREGAMEBOT],
  '/vai',
  '/v',
  '/zaino',
  '/i',
  '/z',
  '/info',
  '/usa',
  '/dai',
  '/give',
  '/abilita',
  '/accumulo',
  '/acc',
  '/generaoggetto',
  '/generastoria',
  '/generaguardiano',
  '/generautilizzo',
  '/generaequipaggiamento',
  '/generastagione',
  '/generaricetta',
  '/generablueprint',
];

const MINUTE = 60_000;
/** Every bot's rest between turns: 15 minutes [M] (docs/game-bots.md §2). */
export const TURN_REST_MS = 15 * MINUTE;
/** @LoreGameBot's after a fight lost: 30 minutes [M] (docs/game-bots.md §2). */
export const LORE_DEFEAT_REST_MS = 30 * MINUTE;

/** The place a turn happened in, from its header: "Lore - <name> [<code>]". */
export interface LorePlace {
  name: string;
  /** In the notation of the rarities (`B1`, `M4`, `N1`): the place's own. */
  code: string;
}

/** The fight of a turn, from its encounter and the line that tells how it ended. */
export interface LoreFight {
  enemy: { name: string; level: number };
  /** `draw`: "Nessuno dei due sembra avere la meglio...", which costs the item. */
  result: 'won' | 'lost' | 'draw';
  /** The player as the fight's line names them (their game name and level); not in a draw. */
  player?: { name: string; level: number };
  /** The N of a win's "Hai imparato qualcosa di nuovo... (+N)" [?] (not the level bar's points). */
  learned?: number;
  /** The equipment whose power the player activated ("⚡️ <player> [L5] attiva il potere di <item> ⚡️!"). */
  powers?: string[];
}

/** What a level-up gives: "Ottieni:" and its list. */
export interface LoreLevelUp {
  level: number;
  coins: number;
  /** "N punto /abilita". */
  skillPoints: number;
  items: { item: string; qty: number; rarity: string; tags: string[] }[];
  /** List lines that none of the above, kept whole. */
  other: string[];
}

/**
 * The line a turn carries while the player's accumulo is full: "🔋 /accumulo pronto!", after the
 * story and before the encounter or the gain (docs/game-bots.md §5.2).
 */
export const ACCUMULO_MARK = '🔋 /accumulo pronto!';

/**
 * What a turn says of the accumulo: that it is full. `sure` is false when the line is there more
 * than once, which the bot never writes: a story quotes it (players write them), and then the
 * bot's own line, if it added one, cannot be told from the copies.
 */
export interface LoreAccumulo {
  ready: true;
  sure: boolean;
}

/** What a @LoreGameBot turn says besides its outcome. */
export interface LoreDetails {
  place?: LorePlace;
  fight?: LoreFight;
  levelUp?: LoreLevelUp;
  accumulo?: LoreAccumulo;
}

export type Outcome =
  | ({
      kind: 'gain';
      bot: GameBot;
      /** The item's name, without its "2x" or its "(0 - 1)". */
      item: string;
      rarity: string;
      /** The tags after the rarity, which start lower-case: `usabile`, `equipaggiabile 🗡`. */
      tags: string[];
      /** False when the item's name is a guess (@InventoryBot's, from an unknown sentence). */
      sure: boolean;
      /** @LoreGameBot's "2x": how many of it; 1 without. */
      qty?: number;
      /** @LoreGameBot's "(0 - 1)" after an equippable item's name [?]. */
      stats?: { low: number; high: number };
    } & LoreDetails)
  | ({
      kind: 'nothing';
      bot: GameBot;
      reason: 'cooldown' | 'defeated' | 'lost' | 'calm' | 'unregistered' | 'truncated';
      /** A cooldown's wait, as the bot states it, in ms. */
      retryMs?: number;
    } & LoreDetails)
  /**
   * @LoreGameBot's "Sei stato bannato fino al …": the player is banned, and the bot answers every
   * message of theirs with it. `until` is when the ban ends [?] (ms): the end of the day for a date
   * alone, and Rome's clock for a time.
   */
  | { kind: 'banned'; bot: GameBot; until: number }
  /** @EpicLorelecBot's count of the player's "rotture". */
  | { kind: 'count'; bot: GameBot; count: number }
  | { kind: 'unknown'; bot: GameBot; text: string };

const UNITS: Record<string, number> = {
  or: 3600_000,
  minut: MINUTE,
  second: 1000,
};

/**
 * A wait as the bots write it, in ms: "9 minuti e 29 secondi", "1 minuto", "10 secondi", "4 ore e
 * 58 minuti", "4 ore, 8 minuti e 23 secondi"; undefined for anything else.
 */
export function italianWait(text: string): number | undefined {
  const parts = text.trim().split(/\s+e\s+|,\s+/u);
  let ms = 0;
  for (const part of parts) {
    const m = /^(\d+) (or|minut|second)[aeio]$/u.exec(part);
    if (m === null) return undefined;
    ms += Number(m[1]) * (UNITS[m[2] as string] as number);
  }
  return ms;
}

/** A rarity code (`C`, `R+`, `M2`, `L8`, `X`), and the tags after it, at the end of a gain. */
const RARITY_END = /^(.*?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*)!?$/su;

function tagsOf(s: string): string[] {
  return [...s.matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((m) => m[1] as string);
}

/** A name with its "2x" in front and its "(0 - 1)" behind, as the bot writes a drop's. */
function itemOf(raw: string): { item: string; qty: number; stats?: { low: number; high: number } } {
  const q = /^(\d+)x (.+)$/su.exec(raw);
  const named = q === null ? raw : (q[2] as string);
  const st = /^(.+) \((\d+) - (\d+)\)$/su.exec(named);
  return {
    item: st === null ? named : (st[1] as string),
    qty: q === null ? 1 : Number(q[1]),
    ...(st === null ? {} : { stats: { low: Number(st[2]), high: Number(st[3]) } }),
  };
}

const DEFEATED = /Torni a casa dolorante e a mani vuote\.\.\.\s*$/u;

const LORE_NOTHING: [RegExp, Extract<Outcome, { kind: 'nothing' }>['reason']][] = [
  [/^Non è passato abbastanza tempo! Riprova fra /mu, 'cooldown'],
  [DEFEATED, 'defeated'],
  [/L'oggetto si perde nello scontro\.\.\.\s*$/u, 'lost'],
  [/^Stai calmo maschio\.\.\.\s*$/u, 'calm'],
  [/^Non sei registrato!/u, 'unregistered'],
];

const LEVEL_UP_AT = '🎉 Congratulazioni, hai raggiunto il livello ';
const LEVEL_UP = /^🎉 Congratulazioni, hai raggiunto il livello (\d+)! 🎉\nOttieni:\n(>[^]*)$/u;

/**
 * The level-up that ends a reply: where it starts, its level and its list; null for a reply
 * with none, or one a story quotes (the last mark is the bot's, and nothing follows its list but
 * more of it).
 */
function levelUpAt(text: string): { at: number; level: number; list: string } | null {
  const at = text.lastIndexOf(LEVEL_UP_AT);
  const m = at < 0 ? null : LEVEL_UP.exec(text.slice(at));
  if (m === null || /\nHai ottenuto /u.test(m[2] as string)) return null;
  return { at, level: Number(m[1]), list: m[2] as string };
}

/** A level-up's list ("> 40 monete", "> 1 punto /abilita", "> 1 <item> [B1]"). */
function levelUpOf(level: number, list: string): LoreLevelUp {
  const up: LoreLevelUp = { level, coins: 0, skillPoints: 0, items: [], other: [] };
  for (const line of list.trim().split(/\n(?=> )/u)) {
    const entry = line.slice(2);
    const coins = /^(\d+) monet[ae]$/u.exec(entry);
    const points = /^(\d+) punt[oi] \/abilita$/u.exec(entry);
    const end = RARITY_END.exec(entry);
    if (coins !== null) up.coins += Number(coins[1]);
    else if (points !== null) up.skillPoints += Number(points[1]);
    else if (end !== null) {
      // The list leads with a count ("1 un dado"), not with the drop's "2x".
      const lead = /^(\d+) (.+)$/su.exec(end[1] as string);
      const { item } = itemOf(lead === null ? (end[1] as string) : (lead[2] as string));
      up.items.push({
        item,
        qty: lead === null ? 1 : Number(lead[1]),
        rarity: end[2] as string,
        tags: tagsOf(end[3] as string),
      });
    } else up.other.push(entry);
  }
  return up;
}

/** The accumulo line of a turn, if it has one: its copies are counted, a story may quote it. */
function accumuloOf(text: string): LoreAccumulo | undefined {
  const copies = text.split('\n').filter((l) => l.trim() === ACCUMULO_MARK).length;
  return copies === 0 ? undefined : { ready: true, sure: copies === 1 };
}

const PLACE = /^Lore - (.+?) \[([A-Z]+\d*\+?)\]$/u;
const ENCOUNTER = /^Durante il tuo cammino compare (.+) \[L(\d+)\]!$/u;
const LEARNED = String.raw`(?: Hai imparato qualcosa di nuovo\.\.\. \(\+(\d+)\))?`;
const DRAW = /^Nessuno dei due sembra avere la meglio\.\.\.$/u;
const POWER = /^⚡️ .+ \[L\d+\] attiva il potere di (.+) ⚡️!$/u;

/**
 * A reply this long that ends in no outcome was cut where Telegram cuts a caption, 1024
 * characters (docs/game-bots.md §5): the bot's story was too long for its ending.
 */
const CUT_AT = 1000;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * The last encounter of a turn and how its fight ended. The enemy is what the encounter line
 * names, so the fight's line is read against it: it is the winner or the loser of that line.
 */
function fightOf(text: string): LoreFight | undefined {
  const lines = text.split('\n');
  const at = lines.findLastIndex((l) => ENCOUNTER.test(l));
  const enc = at < 0 ? null : ENCOUNTER.exec(lines[at] as string);
  if (enc === null || lines[at + 1] !== 'Il combattimento inizia...') return undefined;
  const enemy = { name: enc[1] as string, level: Number(enc[2]) };
  const you = `${escapeRe(enemy.name)} \\[L${enemy.level}\\]`;
  const won = new RegExp(`^(.+) \\[L(\\d+)\\] sconfigge ${you}!${LEARNED}$`, 'u');
  const lost = new RegExp(`^${you} sconfigge (.+) \\[L(\\d+)\\]!$`, 'u');
  const defeated = DEFEATED.test(text);
  const powers: string[] = [];
  const ended = (f: Omit<LoreFight, 'enemy' | 'powers'>): LoreFight => ({
    enemy,
    ...f,
    ...(powers.length === 0 ? {} : { powers }),
  });
  for (const line of lines.slice(at + 2)) {
    const power = POWER.exec(line);
    if (power !== null) powers.push(power[1] as string);
    if (DRAW.test(line)) return ended({ result: 'draw' });
    const l = lost.exec(line);
    const w = won.exec(line);
    if (l !== null && (defeated || w === null))
      return ended({ result: 'lost', player: { name: l[1] as string, level: Number(l[2]) } });
    if (w !== null)
      return ended({
        result: 'won',
        player: { name: w[1] as string, level: Number(w[2]) },
        ...(w[3] === undefined ? {} : { learned: Number(w[3]) }),
      });
  }
  return undefined;
}

const BAN =
  /^Sei stato bannato fino al (\d{2})\/(\d{2})\/(\d{4})(?:, (\d{2}):(\d{2}):(\d{2}))?\.\s*$/u;

/** How far Rome's clock is ahead of UTC at `ms`, in ms. */
function romeOffset(ms: number): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(ms);
  const n = (type: string): number => Number(p.find((x) => x.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - ms;
}

/** The instant at which Rome's clock reads `local` (written as if UTC), in ms. */
export function romeMs(local: number): number {
  const guess = local - romeOffset(local);
  return local - romeOffset(guess);
}

/**
 * The end of a ban, from its date and, if it states one, its time, Rome's: undefined for a date that
 * does not exist. A date alone is read as the end of that day: the bot answers with the ban through
 * the day itself [M]; it also lifts bans early [M], so the end is an upper bound that a normal
 * answer overrides.
 */
function banEnd(m: RegExpExecArray): number | undefined {
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const time = m[4] === undefined ? undefined : [Number(m[4]), Number(m[5]), Number(m[6])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  if (time === undefined) return romeMs(Date.UTC(year, month - 1, day + 1));
  const [h, mi, s] = time as [number, number, number];
  return h > 23 || mi > 59 || s > 59 ? undefined : romeMs(Date.UTC(year, month - 1, day, h, mi, s));
}

/**
 * The rest a turn's outcome starts, in ms (docs/game-bots.md §2): 15 minutes after a turn, 30 after
 * a fight lost, a "too soon"'s wait; none for anything else (a ban, a "calm down").
 */
export function loreRestMs(o: Outcome): number | undefined {
  if (o.kind === 'gain') return TURN_REST_MS;
  if (o.kind !== 'nothing') return undefined;
  if (o.reason === 'defeated') return LORE_DEFEAT_REST_MS;
  if (o.reason === 'lost') return TURN_REST_MS;
  // The ending is cut off, but a fight lost shows in the line before it.
  if (o.reason === 'truncated')
    return o.fight?.result === 'lost' ? LORE_DEFEAT_REST_MS : TURN_REST_MS;
  if (o.reason === 'cooldown') return o.retryMs;
  return undefined;
}

/** An @LoreGameBot reply to the owner's `/avventura`, `/lore` or `/l`. */
export function parseLoreGameBot(raw: string): Outcome {
  const whole = raw.normalize('NFC');
  const ban = BAN.exec(whole.trim());
  if (ban !== null) {
    const until = banEnd(ban);
    return until === undefined ? unknownLore(whole) : { kind: 'banned', bot: LOREGAMEBOT, until };
  }
  const up = levelUpAt(whole);
  const text = up === null ? whole : whole.slice(0, up.at).trimEnd();
  const place = PLACE.exec(text.split('\n')[0] as string);
  const fight = fightOf(text);
  const accumulo = place === null ? undefined : accumuloOf(text);
  const details: LoreDetails = {
    ...(place === null ? {} : { place: { name: place[1] as string, code: place[2] as string } }),
    ...(fight === undefined ? {} : { fight }),
    ...(up === null ? {} : { levelUp: levelUpOf(up.level, up.list) }),
    ...(accumulo === undefined ? {} : { accumulo }),
  };
  // A level-up it cannot cut off would end up inside the gain's item.
  const at = up === null && whole.includes(LEVEL_UP_AT) ? -1 : text.lastIndexOf('Hai ottenuto ');
  if (at >= 0) {
    const end = RARITY_END.exec(text.slice(at + 'Hai ottenuto '.length).trim());
    if (end !== null) {
      const { item, qty, stats } = itemOf(end[1] as string);
      return {
        kind: 'gain',
        bot: LOREGAMEBOT,
        item,
        qty,
        ...(stats === undefined ? {} : { stats }),
        rarity: end[2] as string,
        tags: tagsOf(end[3] as string),
        sure: true,
        ...details,
      };
    }
  }
  for (const [re, reason] of LORE_NOTHING)
    if (re.test(text)) {
      const wait = reason === 'cooldown' ? retryOf(text) : undefined;
      return {
        kind: 'nothing',
        bot: LOREGAMEBOT,
        reason,
        ...(wait === undefined ? {} : { retryMs: wait }),
        ...details,
      };
    }
  // The story ran to the limit and took the ending with it: the turn happened, its outcome is lost.
  if (place !== null && whole.length >= CUT_AT)
    return { kind: 'nothing', bot: LOREGAMEBOT, reason: 'truncated', ...details };
  return unknownLore(whole);
}

function unknownLore(text: string): Outcome {
  return { kind: 'unknown', bot: LOREGAMEBOT, text: text.trim() };
}

/** The wait of a "Riprova fra …." line, if it states one. */
function retryOf(text: string): number | undefined {
  const m = /Riprova fra ([^.!\n]+)/u.exec(text);
  return m === null ? undefined : italianWait(m[1] as string);
}

const EPIC_COUNT = /mi hai rotto il cazzo (-?\d+) volt[ae]!/u;
const EPIC_COOLDOWN =
  /^(?:\([^)\n]*\) )?Non è passato abbastanza tempo dall'ultima rottura! Riprova fra /u;

/**
 * An @EpicLorelecBot message: the count of a turn, its cooldown with the wait, or undefined for
 * anything else (its fights, its other commands).
 */
export function parseEpicLorelecBot(raw: string): Outcome | undefined {
  const text = raw.normalize('NFC').trim();
  const count = EPIC_COUNT.exec(text);
  if (count !== null) return { kind: 'count', bot: EPICLORELECBOT, count: Number(count[1]) };
  if (EPIC_COOLDOWN.test(text)) {
    const wait = retryOf(text);
    return {
      kind: 'nothing',
      bot: EPICLORELECBOT,
      reason: 'cooldown',
      ...(wait === undefined ? {} : { retryMs: wait }),
    };
  }
  return undefined;
}
