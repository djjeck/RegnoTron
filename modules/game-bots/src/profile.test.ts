import { describe, expect, it } from 'vitest';
import { levelForXp, parseProfile, xpForLevel } from './profile.ts';

// Invented players, items and places; the bot's own words are the game's.
const NOW = [
  '👤 bob_the_tester',
  '',
  '👥 Una Compagnia, Srl',
  '',
  'Livello 10 (4.614 ⚔️)',
  '▓▓▓░░░░░░░ 31.88%',
  '',
  'Il Male 👿',
  'Episodio 3.980',
  '1 Ricette completate',
  '3.250 ₭',
  '',
  'Ossessionato da Un sasso con dietro scritto "x2" x37',
  '',
  'Armatura 🛡 - una racchetta 🏓 (6 - 15)',
  'Amuleto 🩺 - una cappa (7)',
  'Arma 🗡 - (vuoto)',
  '',
  '🎯 Ricercato IV',
  '🖌 Ispirazione V',
  '💪🏻 Calistenico I',
  '',
  '🎭 Effetti',
  '  - Neutralizzato (1 ora, 4 minuti e 26 secondi)',
  '  - Confuso',
  '',
  '🎖️ Titoli',
  '  - Ho giocato alla versione alpha! 🏅',
  '  - 0',
  '',
  '',
  'Attualmente in Il Bosco Inventato 🕑 [N1]',
].join('\n');

const BEFORE = [
  '👤 carol',
  '',
  '👥 Nessun clan',
  '',
  'Il Neutrale 👤',
  'Livello 1 (0)',
  'Episodio 27',
  '0 ₭',
  '',
  'Armatura 🥋 - (vuoto)',
  'Amuleto 🩺 - (vuoto)',
  'Arma 🗡 - (vuoto)',
  '',
  '',
  'Attualmente in Il Bosco Inventato 🕑 [N1]',
].join('\n');

describe('a profile', () => {
  it('reads every line of today’s profile', () => {
    expect(parseProfile(NOW)).toEqual({
      player: 'bob_the_tester',
      company: 'Una Compagnia, Srl',
      level: 10,
      xp: 4614,
      progress: 31.88,
      alignment: 'Male',
      episode: 3980,
      recipes: 1,
      coins: 3250,
      obsession: { item: 'Un sasso con dietro scritto "x2"', count: 37 },
      equipment: {
        armour: { item: 'una racchetta 🏓', level: { low: 6, high: 15 } },
        // "(n)": a range of one.
        amulet: { item: 'una cappa', level: { low: 7, high: 7 } },
        weapon: null,
      },
      skills: { Ricercato: 4, Ispirazione: 5, Calistenico: 1 },
      effects: [
        { name: 'Neutralizzato', leftMs: (3600 + 4 * 60 + 26) * 1000 },
        { name: 'Confuso', leftMs: null },
      ],
      titles: ['Ho giocato alla versione alpha! 🏅', '0'],
      location: { name: 'Il Bosco Inventato 🕑', code: 'N1' },
      unread: [],
    });
  });

  it('reads an older one: no bar, no XP mark, the alignment first, no recipes, no company', () => {
    expect(parseProfile(BEFORE)).toMatchObject({
      player: 'carol',
      company: null,
      level: 1,
      xp: 0,
      progress: null,
      alignment: 'Neutrale',
      episode: 27,
      recipes: null,
      coins: 0,
      obsession: null,
      equipment: { armour: null, amulet: null, weapon: null },
      skills: {},
      effects: [],
      titles: [],
      unread: [],
    });
    expect(parseProfile(BEFORE.replace('Nessun clan', 'Nessuna azienda'))?.company).toBeNull();
  });

  it('keeps a line it cannot read, and a skill named like an object’s property', () => {
    const p = parseProfile(
      NOW.replace('🖌 Ispirazione V', '🖌 Ispirazione V\nUna riga nuova\n🧪 __proto__ II')
    );
    expect(p?.unread).toEqual(['Una riga nuova']);
    expect(Object.hasOwn(p?.skills ?? {}, '__proto__')).toBe(true);
  });

  it('is not the settings, a turn, or a line naming a player alone', () => {
    expect(parseProfile('👤 Configurazioni giocatore\n\nNotifiche: sì')).toBeUndefined();
    expect(
      parseProfile('Lore - Il Bosco Inventato ⛅️ [B1]\n\nHai ottenuto un sasso [B1]!')
    ).toBeUndefined();
    expect(parseProfile('👤 bob\n\nCiao')).toBeUndefined();
  });

  it('has its level from its XP: 53 × (level − 1)²', () => {
    expect([1, 2, 3, 4, 10, 11].map(xpForLevel)).toEqual([0, 53, 212, 477, 4293, 5300]);
    expect([0, 52, 53, 211, 212, 4292, 4293, 5299].map(levelForXp)).toEqual([
      1, 1, 2, 2, 3, 9, 10, 10,
    ]);
  });
});
