import { describe, expect, it } from 'vitest';
import { pageOf, parseInventory } from './inventory.ts';

// Invented items; the bot's own words are the game's.
const FIRST = [
  'bob, hai:',
  '> un generatore di oggetti [X] [generatore] x3',
  '> un mestolo (2 - 6) [M2] [equipaggiabile 🗡] x1',
  '> un sasso',
  'su due righe [B1] x4',
  '> una cappa (7) [M1] [equipaggiabile 🩺] x1',
].join('\n');

describe('the inventory', () => {
  it('reads its first page: its player, every item, a name over two lines, a level range', () => {
    expect(parseInventory(FIRST)).toEqual({
      player: 'bob',
      filter: null,
      cut: false,
      items: [
        {
          item: 'un generatore di oggetti',
          qty: 3,
          rarity: 'X',
          tags: ['generatore'],
          level: null,
        },
        {
          item: 'un mestolo',
          qty: 1,
          rarity: 'M2',
          tags: ['equipaggiabile 🗡'],
          level: { low: 2, high: 6 },
        },
        { item: 'un sasso\nsu due righe', qty: 4, rarity: 'B1', tags: [], level: null },
        {
          item: 'una cappa',
          qty: 1,
          rarity: 'M1',
          tags: ['equipaggiabile 🩺'],
          level: { low: 7, high: 7 },
        },
      ],
    });
  });

  it('reads a filtered listing, an empty one, and a later page, which names nobody', () => {
    expect(parseInventory(`Filtri attivi: gen\n\n${FIRST}`)).toMatchObject({ filter: 'gen' });
    expect(parseInventory('bob, il tuo inventario è vuoto!')).toEqual({
      player: 'bob',
      filter: null,
      items: [],
      cut: false,
    });
    expect(parseInventory('> un sasso [B1] x2\n> una pigna [B1] x1')).toMatchObject({
      player: null,
      items: [{ item: 'un sasso' }, { item: 'una pigna' }],
      cut: false,
    });
  });

  it('tells a name cut between two pages, and skips its part', () => {
    expect(parseInventory('su due righe [B1] x4\n> una pigna [B1] x1')).toMatchObject({
      items: [{ item: 'una pigna' }],
      cut: true,
    });
    expect(parseInventory('bob, hai:\n> una pigna [B1] x1\n> un sasso')).toMatchObject({
      items: [{ item: 'una pigna' }],
      cut: true,
    });
  });

  it('reads nothing else', () => {
    expect(parseInventory('Stai calmo maschio...')).toBeUndefined();
    expect(parseInventory('bob, hai:\nUna riga')).toBeUndefined();
    expect(parseInventory('bob, il tuo inventario è vuoto!\n> un sasso [B1] x1')).toBeUndefined();
  });

  it('tells its page by its buttons: a lock for the first’s ◀️ and the last’s ▶️', () => {
    expect(pageOf([['🔒', '▶️']])).toEqual({ first: true, last: false });
    expect(pageOf([['◀️', '▶️']])).toEqual({ first: false, last: false });
    expect(pageOf([['◀️', '🔒']])).toEqual({ first: false, last: true });
    expect(pageOf([['🔒', '🔒']])).toEqual({ first: true, last: true });
    // A short inventory shows no buttons: one page, all of it. Unknown buttons tell nothing.
    expect(pageOf([])).toEqual({ first: true, last: true });
    expect(pageOf(undefined)).toBeNull();
  });
});
