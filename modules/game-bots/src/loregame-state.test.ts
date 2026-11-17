import { type BusEvent } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import {
  CONSUMES,
  freshness,
  held,
  initialState,
  type LoreState,
  reduce,
  stateSchema,
} from './loregame-state.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const turn = (outcome: unknown, t = T): BusEvent =>
  ({ type: 'loregame.turn', t, chat: '@LoreGameBot', outcome }) as unknown as BusEvent;
const gain = (item: string, extra: Record<string, unknown> = {}) =>
  turn({ kind: 'gain', bot: 'LoreGameBot', item, rarity: 'B1', tags: [], sure: true, ...extra });

describe('the loregame state', () => {
  it('starts empty, fits its schema, and applies the parser’s turns', () => {
    expect(stateSchema.safeParse(initialState()).success).toBe(true);
    expect(CONSUMES).toEqual(['loregame.turn']);
  });

  it('adds a gain, its count one without one, and keeps the exactness it had', () => {
    const one = reduce(initialState(), gain('un sasso'));
    expect(one.inventory.items['un sasso']).toEqual({
      qty: 1,
      exact: false,
      date: '2026-11-06T12:00:00.000Z',
      via: 'drop',
      rarity: 'B1',
      tags: [],
    });
    expect(one.owner.as_of).toBe('2026-11-06T12:00:00.000Z');
    // A listing, later, will make a holding exact: a gain then adds to it exactly.
    const exact: LoreState = {
      ...one,
      inventory: {
        ...one.inventory,
        items: {
          'un sasso': { ...(one.inventory.items['un sasso'] as object), exact: true } as never,
        },
      },
    };
    const more = reduce(exact, gain('un sasso', { qty: 4, rarity: '', tags: ['usabile'] }));
    expect(more.inventory.items['un sasso']).toMatchObject({ qty: 5, exact: true, rarity: 'B1' });
    expect(more.inventory.held).toBe(1);
    expect(stateSchema.safeParse(more).success).toBe(true);
  });

  it('adds a level-up’s items as the level-up’s, and leaves the coins and points out', () => {
    const e = turn({
      kind: 'gain',
      bot: 'LoreGameBot',
      item: 'una pigna',
      rarity: 'B1',
      tags: [],
      sure: true,
      levelUp: {
        level: 4,
        coins: 40,
        skillPoints: 1,
        items: [{ item: 'un dado storto', qty: 3, rarity: 'M1', tags: [] }],
        other: [],
      },
    });
    const s = reduce(initialState(), e);
    expect(held(s)).toEqual({ 'una pigna': 1, 'un dado storto': 3 });
    expect(s.inventory.items['un dado storto']).toMatchObject({ via: 'level-up', qty: 3 });
    // A level-up with no gain before it (cut off, say) still gives its items.
    const alone = reduce(
      initialState(),
      turn({
        kind: 'nothing',
        bot: 'LoreGameBot',
        reason: 'defeated',
        levelUp: { items: [{ item: 'un dado storto', qty: 1, rarity: 'M1', tags: [] }] },
      })
    );
    expect(held(alone)).toEqual({ 'un dado storto': 1 });
  });

  it('is the same state for what gains nothing, or reads wrong', () => {
    const s = initialState();
    for (const outcome of [
      { kind: 'nothing', bot: 'LoreGameBot', reason: 'cooldown', retryMs: 1000 },
      { kind: 'unknown', bot: 'LoreGameBot', text: 'boh' },
      { kind: 'gain', bot: 'LoreGameBot', item: '', rarity: 'B1', tags: [] },
      { kind: 'gain', bot: 'LoreGameBot', item: 'un sasso', qty: 0, rarity: 'B1', tags: [] },
      { kind: 'gain', item: 'un sasso', tags: 'no' },
      'a string',
      undefined,
    ])
      expect(reduce(s, turn(outcome))).toBe(s);
  });

  it('keeps an item named like an object’s own property, and the schema accepts it', () => {
    const s = reduce(reduce(initialState(), gain('__proto__')), gain('__proto__'));
    expect(Object.hasOwn(s.inventory.items, '__proto__')).toBe(true);
    expect(held(s)).toEqual({ ['__proto__']: 2 });
    expect(Object.keys(held(reduce(initialState(), gain('constructor'))))).toEqual(['constructor']);
    expect(stateSchema.safeParse(JSON.parse(JSON.stringify(s))).success).toBe(true);
  });

  it('counts only the items above zero as held', () => {
    const s = reduce(initialState(), gain('un sasso'));
    const spent: LoreState = {
      ...s,
      inventory: {
        ...s.inventory,
        items: { 'un sasso': { ...s.inventory.items['un sasso'], qty: 0 } as never },
      },
    };
    expect(held(spent)).toEqual({});
  });

  it('gives a changed section a delta, and a cut-off turn an uncertain inventory', () => {
    expect(freshness(gain('un sasso'), ['owner', 'inventory'])).toEqual({
      owner: 'delta',
      inventory: 'delta',
    });
    const cut = turn({ kind: 'nothing', bot: 'LoreGameBot', reason: 'truncated' });
    expect(freshness(cut, [])).toEqual({ inventory: 'uncertain' });
    expect(freshness(turn({ kind: 'nothing', bot: 'LoreGameBot', reason: 'lost' }), [])).toEqual(
      {}
    );
  });
});
