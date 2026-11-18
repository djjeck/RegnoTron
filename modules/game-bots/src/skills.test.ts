import { describe, expect, it } from 'vitest';
import { parseSkillMenu, skillLevels } from './skills.ts';

// The bot's own words; the levels and points invented.
const MENU = [
  '🎒 Sciacallaggio II (2/5) +10% Probabilità di trovare oggetti rari',
  '🖌 Ispirazione Ø (0/5) +0% Probabilità di trovare generatori',
  '🔋 Stoccaggio I (1/5) -1 Accumulo massimo necessario',
  '🎯 Ricercato Ø (0/5) +0% Probabilità di incontrare guardiani',
  "💪🏻 Calistenico I (1/5) +2 Forza extra dall'allenamento",
  '',
  'Punti disponibili: 3',
].join('\n');

describe('the skills menu', () => {
  it('reads every skill, those at no level too, and the points left', () => {
    const menu = parseSkillMenu(MENU);
    expect(menu?.points).toBe(3);
    expect(menu?.skills).toHaveLength(5);
    expect(menu?.skills[2]).toEqual({
      name: 'Stoccaggio',
      level: 1,
      max: 5,
      effect: { value: -1, unit: '', what: 'Accumulo massimo necessario' },
    });
    expect(menu?.skills[1]).toMatchObject({
      name: 'Ispirazione',
      level: 0,
      effect: { value: 0, unit: '%' },
    });
    // As the profile lists them: those at a level.
    expect(skillLevels(menu as NonNullable<typeof menu>)).toEqual({
      Sciacallaggio: 2,
      Stoccaggio: 1,
      Calistenico: 1,
    });
  });

  it('is not a menu with a line it does not know, nor without its points', () => {
    expect(parseSkillMenu(`${MENU}\nUna riga in più`)).toBeUndefined();
    expect(parseSkillMenu(MENU.replace('\n\nPunti disponibili: 3', ''))).toBeUndefined();
    expect(parseSkillMenu('Punti disponibili: 3')).toBeUndefined();
  });
});
