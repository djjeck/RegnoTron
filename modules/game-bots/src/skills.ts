/**
 * @LoreGameBot's skills menu, the answer to `/abilita` (docs/game-bots.md §5.6), as the `loregame`
 * parser reads it. Pure.
 *
 * The menu lists every skill a player may raise, those at no level (`Ø`) too, each with its level
 * of five and what it gives, then the points they have left to spend: "🔋 Stoccaggio I (1/5) -1
 * Accumulo massimo necessario", "Punti disponibili: 2". It names nobody: it replies to the command.
 * The player spends a point with the menu's buttons, and the bot then edits the menu, which the
 * account does not hear: the next menu, or the next profile, tells what was bought.
 */

/** A skill as the menu states it. */
export interface MenuSkill {
  name: string;
  /** 0 to 5 (`Ø` is 0). */
  level: number;
  max: number;
  /** What it gives at this level, as the bot states it: "+10% Probabilità di …", "-1 Accumulo …". */
  effect: { value: number; unit: '%' | ''; what: string };
}

/** What the menu says. */
export interface SkillMenu {
  skills: MenuSkill[];
  /** "Punti disponibili": the points left to spend. */
  points: number;
}

const ROMAN: Record<string, number> = { Ø: 0, I: 1, II: 2, III: 3, IV: 4, V: 5 };
const LINE = /^\S+ (\S.*?) (Ø|I|II|III|IV|V) \((\d+)\/(\d+)\) ([+-]\d+)(%?) (.+)$/u;
const POINTS = /^Punti disponibili: (\d+)$/u;

/** The menu `raw` is, if it is one: every line a skill's, then the points left; nothing else. */
export function parseSkillMenu(raw: string): SkillMenu | undefined {
  const skills: MenuSkill[] = [];
  let points: number | undefined;
  for (const line of raw.normalize('NFC').trim().split('\n')) {
    const l = line.trim();
    if (l === '') continue;
    const m = LINE.exec(l);
    const p = POINTS.exec(l);
    if (m !== null && points === undefined)
      skills.push({
        name: m[1] as string,
        level: ROMAN[m[2] as string] as number,
        max: Number(m[4]),
        effect: { value: Number(m[5]), unit: m[6] === '%' ? '%' : '', what: m[7] as string },
      });
    else if (p !== null && points === undefined) points = Number(p[1]);
    else return undefined;
  }
  return points === undefined || skills.length === 0 ? undefined : { skills, points };
}

/**
 * The skills a player holds, by name, as the profile lists them: those at a level, with it. Any
 * menu's skills do, as read here or as `loregame.skills` carries them.
 */
export function skillLevels(menu: {
  skills: readonly Pick<MenuSkill, 'name' | 'level'>[];
}): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const s of menu.skills)
    if (s.level > 0)
      Object.defineProperty(levels, s.name, {
        value: s.level,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return levels;
}
