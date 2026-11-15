import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.ts';
import { parseLine } from './parse-line.ts';
import { playerRef } from './player.ts';
import { balls, duration, heldFor, named } from './wording.ts';

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
    expect([heldFor(0), heldFor(61_000), heldFor(167_442_000)]).toEqual([
      '0 secondi',
      '1 minuto e 1 secondo',
      '1 giorno, 22 ore, 30 minuti e 42 secondi',
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
    expect(parseLine(`3) ${named('Alfa', ['⚡'])} — ${heldFor(90_061_000)} ⚽`)).toEqual(
      expect.objectContaining({
        kind: 'ballRow',
        player: { name: 'Alfa', carried: ['⚡'] },
        seconds: 90_061,
        holding: true,
      })
    );
    expect(parseLine(`Alfa rubi ${balls(1)}`).kind).toBe('unknown');
  });
});
