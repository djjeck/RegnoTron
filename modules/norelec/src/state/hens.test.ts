import { describe, expect, it } from 'vitest';
import { parseMessage } from '#src/game/parse-message.ts';
import { HenCount } from './hens.ts';

describe('HenCount', () => {
  it('follows the 🐔 stored, swapped home, given, bombed and burnt', () => {
    const h = new HenCount();
    const count = (...lines: string[]): number => {
      h.apply(parseMessage(lines.join('\n')));
      return h.in('Alfa');
    };
    expect(count('Casa di Alfa (1/10):\n1 🐔  2  3  4  5  6  7  8  9  10')).toBe(1);
    expect(count('Alfa ([]) 🐔 ora è in casa: non ne hai più con te, nessun bonus.')).toBe(2);
    expect(
      count('Alfa (💣) 💣 ora è con te al posto di 🐔, che torna in casa: nessun bonus.')
    ).toBe(3);
    // A 🐔 given leaves the house when none is carried.
    expect(
      count(
        'Alfa (💣) parti per Bravo con 🐔 da regalare: arrivi tra 50 secondi. Casa tua resta scoperta.'
      )
    ).toBe(2);
    expect(
      count(
        'Bravo (🎈) la tua bomba esplode in casa di @Alfa (🎈) e si porta via 🐔! Torni in Bravo tra 1 minuto.'
      )
    ).toBe(1);
    expect(count('Alfa hai bruciato 🐔: è uscita dal gioco.')).toBe(0);
    expect(count('Alfa hai bruciato 🐔: è uscita dal gioco.')).toBe(0);
  });
});
