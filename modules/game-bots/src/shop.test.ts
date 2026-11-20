import { describe, expect, it } from 'vitest';
import { parseShop, shopDayOf } from './shop.ts';

// Invented items; the bot's own words are the game's.
const ORDINARY = [
  'bob, oggi nel negozio:',
  '- 🛒 un generatore di oggetti [X] [generatore] 1.000₭',
  '- ✅ una pigna [B1] 200₭',
  '- 🛒 un mestolo',
  'su due righe [M4] [equipaggiabile 🗡] 400₭',
].join('\n');

describe('the shop', () => {
  it('reads a listing: its player, every item, a name over two lines, a price in thousands, ✅', () => {
    expect(parseShop(ORDINARY)).toEqual({
      player: 'bob',
      sagra: null,
      items: [
        {
          item: 'un generatore di oggetti',
          rarity: 'X',
          tags: ['generatore'],
          price: 1000,
          bought: false,
        },
        { item: 'una pigna', rarity: 'B1', tags: [], price: 200, bought: true },
        {
          item: 'un mestolo\nsu due righe',
          rarity: 'M4',
          tags: ['equipaggiabile 🗡'],
          price: 400,
          bought: false,
        },
      ],
    });
  });

  it('reads a sagra day’s, its sagra named first', () => {
    const sagra = [
      "bob, c'è la sagra della pigna!",
      '',
      'oggi nel negozio:',
      '- 🛒 una pigna [B1] 200₭',
    ];
    expect(parseShop(sagra.join('\n'))).toMatchObject({
      player: 'bob',
      sagra: 'della pigna',
      items: [{ item: 'una pigna' }],
    });
    // The typographic apostrophe too.
    expect(parseShop(sagra.join('\n').replace("'", '’'))?.sagra).toBe('della pigna');
  });

  it('reads nothing else', () => {
    for (const text of [
      'bob, hai:\n> una pigna [B1] x1',
      'bob, oggi nel negozio:',
      'bob, oggi nel negozio:\nuna pigna [B1] 200₭',
      'bob, oggi nel negozio:\n- 🛒 una pigna senza prezzo',
      "bob, c'è la sagra della pigna!\n\n- 🛒 una pigna [B1] 200₭",
      'bob, sei sicuro di voler comprare una pigna per 200 ₭?',
    ])
      expect(parseShop(text), text).toBeUndefined();
  });

  it('tells its day in Italy, which changes at midnight there', () => {
    // 23:30 and 00:30 in Rome (UTC+1 in November).
    expect(shopDayOf(Date.parse('2026-11-06T22:30:00Z'))).toBe('2026-11-06');
    expect(shopDayOf(Date.parse('2026-11-06T23:30:00Z'))).toBe('2026-11-07');
  });
});
