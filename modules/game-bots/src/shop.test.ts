import { describe, expect, it } from 'vitest';
import { parseConfirm, parseShop, PurchaseWatch, shopDayOf } from './shop.ts';

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

describe('a purchase, with the listing’s buttons', () => {
  // Invented items; the bot's own words are the game's.
  const LISTING = (mark: string) =>
    `bob, oggi nel negozio:\n- ${mark} una pigna [B1] 200₭\n- 🛒 un mestolo [M4] [equipaggiabile 🗡] 1.000₭`;
  const CONFIRM =
    'bob, sei sicuro di voler comprare un mestolo [M4] [equipaggiabile 🗡] per 1.000 ₭?';

  it('reads the confirmation: its player, its item and its price', () => {
    expect(parseConfirm(CONFIRM)).toEqual({
      player: 'bob',
      item: 'un mestolo',
      rarity: 'M4',
      tags: ['equipaggiabile 🗡'],
      price: 1000,
    });
    expect(parseConfirm('bob, oggi nel negozio:')).toBeUndefined();
  });

  it('takes a confirmation edited back into the listing, its item bought, as the purchase', () => {
    const w = new PurchaseWatch();
    const at = (text: string, id = '7') => ({ chat: '-1001', id, text });
    expect(w.hear(at(LISTING('🛒')))).toBeUndefined();
    expect(w.hear(at(CONFIRM))).toBeUndefined();
    expect(w.hear(at(LISTING('🛒').replace('🛒 un mestolo', '✅ un mestolo')))).toMatchObject({
      player: 'bob',
      item: 'un mestolo',
      price: 1000,
    });
    // Once: the same listing again buys nothing more.
    expect(w.hear(at(LISTING('🛒').replace('🛒 un mestolo', '✅ un mestolo')))).toBeUndefined();
    // Edited back with the item not bought: cancelled; another message's listing is none of it.
    w.hear(at(CONFIRM));
    expect(w.hear(at(LISTING('🛒')))).toBeUndefined();
    w.hear(at(CONFIRM, '8'));
    expect(w.hear(at(LISTING('✅'), '9'))).toBeUndefined();
    expect(w.hear({ chat: '-1001', text: CONFIRM })).toBeUndefined();
    // A hundred confirmations waiting at most: the oldest forgotten.
    for (let i = 0; i < 101; i++) w.hear(at(CONFIRM, `c${i}`));
    expect(
      w.hear(at(LISTING('🛒').replace('🛒 un mestolo', '✅ un mestolo'), 'c0'))
    ).toBeUndefined();
    expect(
      w.hear(at(LISTING('🛒').replace('🛒 un mestolo', '✅ un mestolo'), 'c100'))
    ).toBeDefined();
  });
});
