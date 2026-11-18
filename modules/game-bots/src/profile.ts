/**
 * @LoreGameBot's profile, the answer to `/info`, `/me` and `/info <player>` (docs/game-bots.md
 * §5.5), as the `loregame` parser reads it. Pure.
 *
 * A profile names its player on its first line ("👤 <username>"), so it needs no pairing with the
 * command that asked for it: it is that player's, in any chat. Its lines are read by what they say,
 * not where they are (the bot moved them over the seasons), and the lists (effects, titles) by the
 * heading above them. Every line is read or kept in `unread`, so nothing it says is lost.
 */
import { italianWait } from '#src/replies.ts';

/** An equipped item: its name, and its level range ("(a - b)"; "(n)" is a range of one). */
export interface Equipped {
  item: string;
  level: { low: number; high: number } | null;
}

/** What a profile says. */
export interface LoreProfile {
  /** Its player, by username. */
  player: string;
  /** Their company ("👥"); none for "Nessuna azienda" (before: "Nessun clan"). */
  company: string | null;
  level: number;
  /** "⚔️": the XP they hold [M] (docs/game-bots.md §5.4). */
  xp: number;
  /** The bar's percentage towards the next level; none in the older profiles without a bar. */
  progress: number | null;
  alignment: 'Bene' | 'Male' | 'Neutrale';
  /** "Episodio": the turns they took [M]. */
  episode: number;
  /** "Ricette completate"; none in the profiles before September 2026. */
  recipes: number | null;
  coins: number;
  /** "Ossessionato da <item> x<n>". */
  obsession: { item: string; count: number } | null;
  equipment: {
    armour: Equipped | null;
    amulet: Equipped | null;
    weapon: Equipped | null;
  };
  /** The skills of `/abilita`, by name, with their level (I–V as 1–5). */
  skills: Record<string, number>;
  /** "🎭 Effetti": each with the time left, as the bot states it (none if it states none). */
  effects: { name: string; leftMs: number | null }[];
  /** "🎖️ Titoli": players write them, so they are kept as they are. */
  titles: string[];
  /** "Attualmente in <place> [<code>]". */
  location: { name: string; code: string } | null;
  /** The lines it could not read, whole. */
  unread: string[];
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
/** "4.614": the bot's thousands. */
const count = (s: string): number => Number(s.replaceAll('.', ''));

const NAME = /^👤 (\w+)$/u;
const LEVEL = /^Livello (\d+) \(([\d.]+)(?: ⚔️)?\)$/u;
const BAR = /^[▓░]{10} (\d+(?:\.\d+)?)%$/u;
const ALIGNMENT = /^Il (Bene|Male|Neutrale) \S+$/u;
const COMPANY = /^👥 (.+)$/u;
const EPISODE = /^Episodio ([\d.]+)$/u;
const RECIPES = /^([\d.]+) Ricette completate$/u;
const COINS = /^([\d.]+) ₭$/u;
const OBSESSION = /^Ossessionato da (.+) x([\d.]+)$/u;
/** An equipment slot's line, as the profile and `/equipaggia` write it. */
export const SLOT = /^(Armatura|Amuleto|Arma) \S+ - (.+)$/u;
const SKILL = /^\S+ (\S.*) (I|II|III|IV|V)$/u;
const ITEM = /^\s+- (.+)$/u;
const LEFT = /^(.+?) \(([^()]+)\)$/u;
const LOCATION = /^Attualmente in (.+) \[([A-Z]+\d*\+?)\]$/u;
/** The slots, by the word the bot writes. */
export const SLOTS = { Armatura: 'armour', Amuleto: 'amulet', Arma: 'weapon' } as const;
/** A slot, as the state names it. */
export type Slot = (typeof SLOTS)[keyof typeof SLOTS];

/** An equipped item, "(vuoto)" none. */
export function equipped(raw: string): Equipped | null {
  if (raw === '(vuoto)') return null;
  const range = /^(.+) \((\d+) - (\d+)\)$/u.exec(raw);
  if (range !== null)
    return {
      item: range[1] as string,
      level: { low: Number(range[2]), high: Number(range[3]) },
    };
  const one = /^(.+) \((\d+)\)$/u.exec(raw);
  return one === null
    ? { item: raw, level: null }
    : { item: one[1] as string, level: { low: Number(one[2]), high: Number(one[2]) } };
}

/**
 * The profile `raw` is, if it is one: a first line naming a player, and a level line. Anything
 * else (the settings, "👤 Configurazioni giocatore", say) is not.
 */
export function parseProfile(raw: string): LoreProfile | undefined {
  const lines = raw.normalize('NFC').trimEnd().split('\n');
  const name = NAME.exec(lines[0]?.trim() ?? '');
  if (name === null || !lines.some((l) => LEVEL.test(l.trim()))) return undefined;
  const p: LoreProfile = {
    player: name[1] as string,
    company: null,
    level: 0,
    xp: 0,
    progress: null,
    alignment: 'Neutrale',
    episode: 0,
    recipes: null,
    coins: 0,
    obsession: null,
    equipment: { armour: null, amulet: null, weapon: null },
    skills: {},
    effects: [],
    titles: [],
    location: null,
    unread: [],
  };
  let list: 'effects' | 'titles' | undefined;
  for (const raw of lines.slice(1)) {
    const line = raw.trimEnd();
    if (line.trim() === '') continue;
    const item = ITEM.exec(line);
    if (item !== null && list !== undefined) {
      const text = item[1] as string;
      if (list === 'titles') p.titles.push(text);
      else {
        const left = LEFT.exec(text);
        const ms = left === null ? undefined : italianWait(left[2] as string);
        p.effects.push(
          ms === undefined || left === null
            ? { name: text, leftMs: null }
            : { name: left[1] as string, leftMs: ms }
        );
      }
      continue;
    }
    list = undefined;
    const l = line.trim();
    let m: RegExpExecArray | null;
    if (l === '🎭 Effetti') list = 'effects';
    else if (l === '🎖️ Titoli') list = 'titles';
    else if ((m = LEVEL.exec(l)) !== null) {
      p.level = Number(m[1]);
      p.xp = count(m[2] as string);
    } else if ((m = BAR.exec(l)) !== null) p.progress = Number(m[1]);
    else if ((m = ALIGNMENT.exec(l)) !== null) p.alignment = m[1] as LoreProfile['alignment'];
    else if ((m = COMPANY.exec(l)) !== null)
      p.company = m[1] === 'Nessuna azienda' || m[1] === 'Nessun clan' ? null : (m[1] as string);
    else if ((m = EPISODE.exec(l)) !== null) p.episode = count(m[1] as string);
    else if ((m = RECIPES.exec(l)) !== null) p.recipes = count(m[1] as string);
    else if ((m = COINS.exec(l)) !== null) p.coins = count(m[1] as string);
    else if ((m = OBSESSION.exec(l)) !== null)
      p.obsession = { item: m[1] as string, count: count(m[2] as string) };
    else if ((m = SLOT.exec(l)) !== null)
      p.equipment[SLOTS[m[1] as keyof typeof SLOTS]] = equipped(m[2] as string);
    else if ((m = LOCATION.exec(l)) !== null)
      p.location = { name: m[1] as string, code: m[2] as string };
    else if ((m = SKILL.exec(l)) !== null)
      // Own, whatever its name (`__proto__` too).
      Object.defineProperty(p.skills, m[1] as string, {
        value: ROMAN[m[2] as string],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else p.unread.push(line);
  }
  return p;
}

/** The XP a player holds at the start of `level` [M]: 53 × (level − 1)² (docs/game-bots.md §5.4). */
export const xpForLevel = (level: number): number => 53 * (level - 1) ** 2;

/** The level `xp` makes [M]: the highest whose threshold it reaches. */
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 53)) + 1);
}
