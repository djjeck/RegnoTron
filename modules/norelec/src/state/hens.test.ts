import { describe, expect, it } from 'vitest';
import { parseMessage } from '#src/game/parse-message.ts';
import { HenCount } from './hens.ts';

describe('HenCount', () => {
  it('follows the 🐔 stored, swapped home, bought, replaced, rearranged and bombed', () => {
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
    // A purchase says how many there are; one over a 🐔 replaces it.
    expect(
      count(
        'Alfa hai preso gratis 🐔: 🐔 in casa nel posto 4. Ora ne hai 5 in casa: fanno 300 palle.'
      )
    ).toBe(5);
    expect(count('Alfa hai preso gratis 🐔: 🐔 in casa nel posto 5.')).toBe(6);
    expect(count('Alfa hai preso gratis 📮: 📮 in casa nel posto 5, al posto di 🐔.')).toBe(5);
    expect(count('Alfa hai spostato 🐔 dal posto 1 al posto 2. Casa: []🐔🐔🐔📮')).toBe(3);
    expect(
      count(
        "@Alfa (🎈) è nata una femmina 👶: il padre è @Bravo. Non c'era un posto libero: ha preso quello di 🐔."
      )
    ).toBe(2);
    expect(
      count(
        'Bravo (🎈) la tua bomba esplode in casa di @Alfa (🎈) e si porta via 🐔! Torni in Bravo tra 1 minuto.'
      )
    ).toBe(1);
  });
});
