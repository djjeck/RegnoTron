import { type BusEvent } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import {
  announce,
  banOf,
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
    expect(CONSUMES).toEqual(['loregame.turn', 'loregame.ban', 'loregame.unban']);
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

const HOUR = 3_600_000;
const ban = (player: string, until: number | undefined, t = T, owner = false): BusEvent =>
  ({
    type: 'loregame.ban',
    t,
    chat: '-1001',
    player,
    owner,
    ...(until === undefined ? {} : { until }),
  }) as unknown as BusEvent;
const unban = (player: string, t = T): BusEvent =>
  ({ type: 'loregame.unban', t, chat: '-1001', player, owner: false }) as unknown as BusEvent;

describe('the loregame state’s bans', () => {
  it('holds a ban per player, with when it ends, and the owner’s name once told', () => {
    let s = reduce(initialState(), ban('bob', T + 5 * HOUR));
    s = reduce(s, ban('alice', T + HOUR, T + 60_000, true));
    expect(s.bans).toEqual({
      bob: { until: '2026-11-06T17:00:00.000Z', since: '2026-11-06T12:00:00.000Z' },
      alice: { until: '2026-11-06T13:00:00.000Z', since: '2026-11-06T12:01:00.000Z' },
    });
    expect(s.owner).toEqual({ as_of: '2026-11-06T12:01:00.000Z', name: 'alice' });
    expect(stateSchema.safeParse(s).success).toBe(true);
    expect(banOf(s)).toMatchObject({ until: '2026-11-06T13:00:00.000Z' });
    expect(banOf(s, 'bob')).toMatchObject({ until: '2026-11-06T17:00:00.000Z' });
    expect(banOf(s, 'carol')).toBeNull();
    expect(banOf(initialState())).toBeNull();
  });

  it('keeps a ban that states no end, changes one when the end moves, and ignores a repeat', () => {
    const open = reduce(initialState(), ban('bob', undefined));
    expect(open.bans['bob']).toMatchObject({ until: null });
    const moved = reduce(open, ban('bob', T + HOUR, T + 1000));
    expect(moved.bans['bob']).toEqual({
      until: '2026-11-06T13:00:00.000Z',
      since: '2026-11-06T12:00:01.000Z',
    });
    expect(reduce(moved, ban('bob', T + HOUR, T + 2000))).toBe(moved);
    // A ban that has ended by its own time is none.
    const none = initialState();
    expect(reduce(none, ban('bob', T - 1))).toBe(none);
  });

  it('ends a ban when the bot serves the player, and drops the ones that ran out by the time of any event', () => {
    let s = reduce(initialState(), ban('bob', T + 5 * HOUR));
    s = reduce(s, ban('carol', T + HOUR));
    expect(Object.keys(reduce(s, unban('bob')).bans)).toEqual(['carol']);
    expect(reduce(s, unban('dave'))).toBe(s);
    // Any event after the end drops the ban, a turn's too.
    const later = reduce(
      s,
      turn({ kind: 'nothing', bot: 'LoreGameBot', reason: 'lost' }, T + 2 * HOUR)
    );
    expect(Object.keys(later.bans)).toEqual(['bob']);
    expect(later.owner.as_of).toBe('2026-11-06T14:00:00.000Z');
  });

  it('serves players named like a prototype’s key', () => {
    let s = reduce(initialState(), ban('__proto__', T + HOUR));
    s = reduce(s, ban('constructor', T + HOUR));
    expect(Object.keys(s.bans)).toEqual(['__proto__', 'constructor']);
    expect(banOf(s, '__proto__')).not.toBeNull();
    expect(banOf(s, 'toString')).toBeNull();
    expect(Object.keys(reduce(s, unban('__proto__')).bans)).toEqual(['constructor']);
    expect(stateSchema.safeParse(s).success).toBe(true);
  });

  it('ignores a ban event that does not fit', () => {
    const bad = { type: 'loregame.ban', t: T, chat: '-1001' } as unknown as BusEvent;
    const s = initialState();
    expect(reduce(s, bad)).toBe(s);
  });

  it('announces each ban set or changed, and each ended, lifted or expired', () => {
    const s0 = initialState();
    const s1 = reduce(s0, ban('alice', T + HOUR, T, true));
    expect(announce(s0, s1, ban('alice', T + HOUR, T, true))).toEqual([
      {
        type: 'banned',
        payload: { player: 'alice', until: '2026-11-06T13:00:00.000Z', owner: true },
      },
    ]);
    expect(announce(s1, s1, ban('alice', T + HOUR))).toEqual([]);
    const s2 = reduce(s1, unban('alice', T + 1000));
    expect(announce(s1, s2, unban('alice', T + 1000))).toEqual([
      { type: 'unbanned', payload: { player: 'alice', owner: true, reason: 'lifted' } },
    ]);
    const e = turn({ kind: 'nothing', bot: 'LoreGameBot', reason: 'lost' }, T + 2 * HOUR);
    expect(announce(s1, reduce(s1, e), e)).toEqual([
      { type: 'unbanned', payload: { player: 'alice', owner: true, reason: 'expired' } },
    ]);
  });

  it('marks the sections a ban changed a delta, as any event', () => {
    expect(freshness(ban('bob', T + HOUR), ['owner', 'bans'])).toEqual({
      owner: 'delta',
      bans: 'delta',
    });
  });
});
