import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.ts';
import { parseLine } from './parse-line.ts';
import { playerRef } from './player.ts';
import { balls, duration, multiplier, named } from './wording.ts';

describe('wording', () => {
  it('writes durations, names and multipliers as the bot does', () => {
    expect([duration(90_500), duration(60_000), duration(1000), duration(0)]).toEqual([
      '1 minuto e 30 secondi',
      '1 minuto',
      '1 secondo',
      '0 secondi',
    ]);
    expect(duration(3_725_000)).toBe('1 ora e 2 minuti');
    expect(named('Alfa', ['🏴‍☠️', null, '🎈', null])).toBe('Alfa (🏴‍☠️[]🎈)');
    expect(named('Alfa', [null, null])).toBe('Alfa');
    expect([multiplier(1), multiplier(2), multiplier(3), multiplier(4)]).toEqual([
      'x1.5',
      'x2.25',
      'x3.37',
      'x5.06',
    ]);
    expect([balls(1), balls(2)]).toEqual(['1 palla', '2 palle']);
  });

  it('is read back by the parser as it was written', () => {
    // A duration, to the second, with the bot's two largest units.
    for (const s of [0, 1, 59, 60, 61, 90, 599, 3599])
      expect(parseDuration(duration(s * 1000 + 999))).toBe(s);
    expect(parseDuration(duration(3_725_000))).toBe(3720);
    // A name with its carried emoji, an empty slot before a full one.
    const carried = ['🏴‍☠️', null, '🎈'];
    const [name, emoji] = /^(\S+) \((.*)\)$/u.exec(named('Alfa', carried))?.slice(1) ?? [];
    expect(playerRef(String(name), emoji)).toEqual({ name: 'Alfa', carried });
    // Whole lines of the templates, built from the pieces.
    expect(parseLine(`${named('Alfa', ['⚡'])} hai guadagnato ${balls(1)} col ⚡ x1.5!`)).toEqual(
      expect.objectContaining({
        kind: 'holderPaid',
        player: { name: 'Alfa', carried: ['⚡'] },
        balls: 1,
        multiplier: 1.5,
      })
    );
  });
});
