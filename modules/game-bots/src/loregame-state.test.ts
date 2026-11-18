import { type BusEvent } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import {
  announce,
  banOf,
  CONSUMES,
  foldReadiness,
  freshness,
  held,
  initialState,
  LORE_READINESS,
  type LoreState,
  playerOf,
  reduce,
  stateSchema,
} from './loregame-state.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const turn = (outcome: unknown, t = T): BusEvent =>
  ({ type: 'loregame.turn', t, chat: '@LoreGameBot', outcome }) as unknown as BusEvent;
const gain = (item: string, extra: Record<string, unknown> = {}) =>
  turn({ kind: 'gain', bot: 'LoreGameBot', item, rarity: 'B1', tags: [], sure: true, ...extra });
/** A level-up, the owner's unless `player` names another, as the parser publishes it apart. */
const levelUp = (
  level: number,
  items: { item: string; qty: number; rarity: string; tags: string[] }[] = [],
  o: { t?: number; player?: string } = {}
): BusEvent =>
  ({
    type: 'loregame.levelUp',
    t: o.t ?? T,
    chat: o.player === undefined ? '@LoreGameBot' : '-1001',
    player: o.player ?? 'alice',
    owner: o.player === undefined,
    level,
    coins: 40,
    skillPoints: 1,
    items,
    other: [],
  }) as unknown as BusEvent;

describe('the loregame state', () => {
  it('starts empty, fits its schema, and applies the parser’s turns', () => {
    expect(stateSchema.safeParse(initialState()).success).toBe(true);
    expect(CONSUMES).toEqual([
      'loregame.turn',
      'loregame.ban',
      'loregame.unban',
      'loregame.accumulo',
      'loregame.playerTurn',
      'loregame.playerAccumulo',
      'loregame.training',
      'loregame.levelUp',
      'loregame.profile',
    ]);
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

  it('adds a level-up’s items as the level-up’s, from its own event alone, the owner’s only', () => {
    const dice = [{ item: 'un dado storto', qty: 3, rarity: 'M1', tags: [] }];
    // The turn that brought it still carries it in its outcome: it is not counted twice.
    const s = [gain('una pigna', { levelUp: { level: 4, items: dice } }), levelUp(4, dice)].reduce(
      reduce,
      initialState()
    );
    expect(held(s)).toEqual({ 'una pigna': 1, 'un dado storto': 3 });
    expect(s.inventory.items['un dado storto']).toMatchObject({ via: 'level-up', qty: 3 });
    // Another player's gives the owner nothing.
    expect(held(reduce(initialState(), levelUp(4, dice, { player: 'bob' })))).toEqual({});
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

describe('the accumulo', () => {
  const MIN = 60_000;
  let at = T;
  /** A turn of the owner's with its place, as the parser reads one; `mark`: its accumulo line. */
  const lore = (mark?: 'sure' | 'quoted', extra: Record<string, unknown> = {}): BusEvent =>
    turn(
      {
        kind: 'gain',
        bot: 'LoreGameBot',
        item: 'un sasso',
        rarity: 'B1',
        tags: [],
        sure: true,
        place: { name: 'Il Bosco Inventato', code: 'B1' },
        ...(mark === undefined ? {} : { accumulo: { ready: true, sure: mark === 'sure' } }),
        ...extra,
      },
      (at += MIN)
    );
  /** The bot's answer to the owner's /accumulo. */
  const answer = (result: string, extra: Record<string, unknown> = {}): BusEvent =>
    ({
      type: 'loregame.accumulo',
      t: (at += MIN),
      chat: '@LoreGameBot',
      result,
      ...extra,
    }) as unknown as BusEvent;
  const run = (s: LoreState, ...events: BusEvent[]): LoreState => events.reduce(reduce, s);
  const kinds = (s: LoreState): string[] => s.accumulo.drift.map((d) => d.kind);
  /** A state that knows its accumulo holds `count` of `max`, from the bot's own counter. */
  const known = (count: number, max = 20): LoreState =>
    run(initialState(), answer('short', { count, max }));

  it('starts with nothing known, and counts a turn, but not a reply that is none', () => {
    const s0 = initialState();
    expect(stateSchema.safeParse(s0).success).toBe(true);
    expect(s0.accumulo).toEqual({
      as_of: null,
      count: 0,
      exact: false,
      max: null,
      ready: false,
      used_at: null,
      locked: null,
      drift: [],
    });
    const s = run(s0, lore(), lore(), lore('sure', { qty: 2 }));
    expect(s.accumulo).toMatchObject({ count: 3, exact: false, ready: true });
    // A "too soon", a fight lost without a place (older forms) and a ban charge nothing.
    const none = run(
      s,
      turn({ kind: 'nothing', bot: 'LoreGameBot', reason: 'cooldown' }, (at += MIN)),
      turn({ kind: 'banned', bot: 'LoreGameBot', until: T }, (at += MIN))
    );
    expect(none.accumulo).toBe(s.accumulo);
    // A fight lost is a turn all the same.
    const lost = run(
      initialState(),
      lore(undefined, { kind: 'nothing', reason: 'defeated', item: undefined })
    );
    expect(lost.accumulo.count).toBe(1);
  });

  it('takes the bot’s counter for the truth: exact from then on, and the maximum it states', () => {
    const s = known(7, 19);
    expect(s.accumulo).toMatchObject({ count: 7, exact: true, max: 19, ready: false });
    expect(s.owner.as_of).toBe(new Date(at).toISOString());
    // No drift when the count was only a floor and the bot says more: turns we missed.
    expect(
      run(initialState(), lore(), lore(), answer('short', { count: 9, max: 20 })).accumulo.drift
    ).toEqual([]);
    // Each turn adds one to it.
    expect(run(s, lore(), lore()).accumulo).toMatchObject({ count: 9, exact: true });
  });

  it('reports the bot’s counter when it is not ours: below a floor, or other than an exact count', () => {
    const floor = run(
      initialState(),
      lore(),
      lore(),
      lore(),
      answer('short', { count: 1, max: 20 })
    );
    expect(floor.accumulo.drift).toEqual([
      expect.objectContaining({ kind: 'count', counted: 3, said: 1, max: 20 }),
    ]);
    expect(floor.accumulo).toMatchObject({ count: 1, exact: true });
    // Exact: both ways. Turns we did not hear (another chat) raise it; a use we did not hear lowers it.
    const more = run(known(5), lore(), answer('short', { count: 9, max: 20 }));
    expect(more.accumulo.drift).toEqual([
      expect.objectContaining({ kind: 'count', counted: 6, said: 9 }),
    ]);
    const less = run(known(15), lore(), answer('short', { count: 2, max: 20 }));
    expect(kinds(less)).toEqual(['count']);
    // Agreeing is no news.
    expect(run(known(5), lore(), answer('short', { count: 6, max: 20 })).accumulo.drift).toEqual(
      []
    );
  });

  it('is ready on the bot’s word alone: a turn’s line, or a counter at its maximum', () => {
    // Our count reaching the maximum is not the bot's word: that is a disagreement, not a go.
    const counted = run(known(18), lore(), lore());
    expect(counted.accumulo).toMatchObject({ count: 20, ready: false });
    expect(kinds(counted)).toEqual(['late']);
    // The turn's line is.
    const told = run(known(18), lore(), lore('sure'));
    expect(told.accumulo).toMatchObject({ count: 20, ready: true });
    expect(told.accumulo.drift).toEqual([]);
    // The bot's own counter, at its maximum: "already ready".
    const idle = run(known(3), answer('idle', { count: 20, max: 20 }));
    expect(idle.accumulo).toMatchObject({ count: 20, exact: true, ready: true });
    // A line a story quotes (twice or more) is no word.
    const quoted = run(known(3), lore('quoted'));
    expect(quoted.accumulo).toMatchObject({ count: 4, ready: false });
    expect(quoted.accumulo.drift).toEqual([]);
    // Once full it stays so, line or not on the turns after (they carry it, but no news).
    expect(run(told, lore('sure'), lore('sure')).accumulo).toMatchObject({
      count: 22,
      ready: true,
    });
  });

  it('reports the line before our count gets there, and no line when it does', () => {
    const early = run(known(10), lore('sure'));
    expect(early.accumulo).toMatchObject({ count: 11, ready: true });
    expect(early.accumulo.drift).toEqual([
      expect.objectContaining({ kind: 'early', counted: 11, said: null, max: 20 }),
    ]);
    // Only against a count that is exact: a floor has nothing to say against the bot.
    expect(run(initialState(), lore('sure')).accumulo.drift).toEqual([]);
    // The maximum the bot stated is the one it is held to.
    expect(kinds(run(known(17, 19), lore('sure')))).toEqual(['early']);
    expect(kinds(run(known(18, 19), lore('sure')))).toEqual([]);
    expect(kinds(run(known(18, 19), lore()))).toEqual(['late']);
    // A turn cut off lost its ending with the line: it says nothing.
    const cut = lore(undefined, { kind: 'nothing', reason: 'truncated', item: undefined });
    expect(run(known(19), cut).accumulo).toMatchObject({ count: 20, ready: false, drift: [] });
  });

  it('reports a full accumulo that is not, without a use: the line gone, or the bot’s counter lower', () => {
    const full = run(known(19), lore('sure'));
    // The next turn has no line: it was used where we did not hear, and this is the first since.
    const lapsed = run(full, lore());
    expect(lapsed.accumulo).toMatchObject({ ready: false, count: 1, exact: false });
    expect(kinds(lapsed)).toEqual(['lapsed']);
    // Or the bot says "not yet": the line we trusted was a story's.
    const liar = run(known(3), lore('sure'), answer('short', { count: 4, max: 20 }));
    expect(liar.accumulo).toMatchObject({ ready: false, count: 4, exact: true });
    expect(kinds(liar)).toEqual(['early', 'not_ready']);
    // A quoted line on the turn after tells nothing either way.
    expect(run(full, lore('quoted')).accumulo).toMatchObject({ ready: true, count: 21 });
  });

  it('is emptied by a use, which the bot allowed with fewer turns than we count only when it never said', () => {
    const used = run(known(19), lore('sure'), answer('used'));
    expect(used.accumulo).toMatchObject({
      count: 0,
      exact: true,
      ready: false,
      locked: null,
      used_at: new Date(at).toISOString(),
    });
    expect(kinds(used)).toEqual([]);
    expect(run(used, lore()).accumulo.count).toBe(1);
    // Used though it never said so, and the count is short of the maximum.
    const early = run(known(12), answer('used'));
    expect(early.accumulo).toMatchObject({ count: 0, exact: true });
    expect(early.accumulo.drift).toEqual([
      expect.objectContaining({ kind: 'used_early', counted: 12, said: null }),
    ]);
    // A floor says nothing against it.
    expect(run(initialState(), lore(), answer('used')).accumulo.drift).toEqual([]);
  });

  it('is empty below the level, charges nothing until a turn reaches it, and keeps no stale line', () => {
    const locked = run(initialState(), lore(), lore(), answer('locked', { level: 4 }));
    expect(locked.accumulo).toMatchObject({ locked: 4, count: 0, exact: true, ready: false });
    // Turns under the level charge nothing.
    expect(run(locked, lore(), lore()).accumulo).toBe(locked.accumulo);
    expect(run(locked, lore(), levelUp(3)).accumulo).toBe(locked.accumulo);
    // The level-up that reaches it opens it, after the turn that brought it, which charges nothing;
    // and not exact. Another player's opens nothing.
    expect(run(locked, levelUp(4, [], { player: 'bob' })).accumulo).toBe(locked.accumulo);
    const open = run(locked, lore(), levelUp(4), lore());
    expect(open.accumulo).toMatchObject({ locked: null, count: 1, exact: false });
    // The bot's counter opens it too, and an answer with no level changes nothing.
    expect(run(locked, answer('short', { count: 0, max: 20 })).accumulo).toMatchObject({
      locked: null,
      exact: true,
    });
    const fresh = initialState();
    expect(run(fresh, answer('locked')).accumulo).toBe(fresh.accumulo);
  });

  it('reports a disagreement once, until something else differs, and keeps the latest ten', () => {
    // A player whose maximum is 19: the line comes at 19 against the 20 we hold, cycle after cycle.
    let s = known(18);
    for (let i = 0; i < 5; i++)
      s = run(
        s,
        lore('sure'),
        answer('used'),
        ...Array(18)
          .fill(0)
          .map(() => lore())
      );
    s = run(s, lore('sure'));
    expect(kinds(s)).toEqual(['early']);
    // A different count is news.
    s = run(
      s,
      answer('used'),
      ...Array(16)
        .fill(0)
        .map(() => lore()),
      lore('sure')
    );
    expect(s.accumulo.drift.map((d) => d.counted)).toEqual([19, 17]);
    // Only the ten latest are kept.
    let many = known(0);
    for (let i = 1; i <= 12; i++) many = run(many, answer('short', { count: i * 2, max: 20 }));
    expect(many.accumulo.drift).toHaveLength(10);
    expect(many.accumulo.drift.at(0)?.counted).toBe(4);
    expect(many.accumulo.drift.at(-1)?.said).toBe(24);
  });

  it('announces when it is full, when it is used and each disagreement, as the cause says', () => {
    const s0 = known(10);
    const e1 = lore('sure');
    const s1 = reduce(s0, e1);
    expect(announce(s0, s1, e1)).toEqual([
      { type: 'accumuloReady', payload: { count: 11, max: 20, via: 'turn' } },
      { type: 'accumuloDrift', payload: { kind: 'early', counted: 11, said: null, max: 20 } },
    ]);
    const e2 = lore('sure');
    expect(announce(s1, reduce(s1, e2), e2)).toEqual([]);
    const e3 = answer('used');
    const s3 = reduce(s1, e3);
    expect(announce(s1, s3, e3)).toEqual([
      { type: 'accumuloUsed', payload: { turns: 11, exact: true } },
    ]);
    const e4 = answer('idle', { count: 19, max: 19 });
    const s4 = reduce(s3, e4);
    expect(announce(s3, s4, e4)).toEqual([
      { type: 'accumuloReady', payload: { count: 19, max: 19, via: 'reading' } },
      { type: 'accumuloDrift', payload: { kind: 'count', counted: 0, said: 19, max: 19 } },
    ]);
  });

  it('refuses an answer or a turn it cannot read, and leaves the rest of the state alone', () => {
    const s = known(5);
    const bad = { type: 'loregame.accumulo', t: T, result: 'maybe' } as unknown as BusEvent;
    expect(reduce(s, bad)).toBe(s);
    const noMax = {
      type: 'loregame.accumulo',
      t: T,
      result: 'short',
      count: 4,
    } as unknown as BusEvent;
    expect(reduce(s, noMax)).toBe(s);
    expect(reduce(s, { type: 'loregame.turn', t: T, outcome: 'x' } as unknown as BusEvent)).toBe(s);
    // It touches no other section.
    const before = run(initialState(), gain('un sasso'));
    const after = run(before, answer('used'));
    expect(after.inventory).toBe(before.inventory);
    expect(after.bans).toBe(before.bans);
  });
});

describe('the players', () => {
  const MIN = 60_000;
  const PLACE = { name: 'Il Bosco Inventato', code: 'B1' };
  const played = (player: string, outcome: Record<string, unknown>, t: number): BusEvent =>
    ({
      type: 'loregame.playerTurn',
      t,
      chat: '-1001',
      player,
      owner: false,
      outcome: { bot: 'LoreGameBot', ...outcome },
    }) as unknown as BusEvent;
  const turnOf = (player: string, t: number, extra: Record<string, unknown> = {}) =>
    played(
      player,
      { kind: 'gain', item: 'un sasso', rarity: 'B1', tags: [], place: PLACE, ...extra },
      t
    );
  const soon = (player: string, t: number, retryMs: number) =>
    played(player, { kind: 'nothing', reason: 'cooldown', retryMs }, t);
  const asked = (player: string, t: number, reply: Record<string, unknown>): BusEvent =>
    ({
      type: 'loregame.playerAccumulo',
      t,
      chat: '-1001',
      player,
      owner: false,
      ...reply,
    }) as unknown as BusEvent;
  const run = (...events: BusEvent[]): LoreState => events.reduce(reduce, initialState());

  it('keeps each player’s turns, rest, name and level in the game, apart from the owner’s inventory', () => {
    const fight = {
      player: { name: 'Bobby', level: 5 },
      enemy: { name: 'un orso', level: 4 },
      result: 'won',
    };
    const s = run(
      turnOf('bob', T, { fight }),
      turnOf('bob', T + 16 * MIN),
      levelUp(6, [], { t: T + 16 * MIN, player: 'bob' }),
      played('carol', { kind: 'nothing', reason: 'defeated', place: PLACE }, T + MIN)
    );
    expect(playerOf(s, 'bob')).toMatchObject({
      game: { name: 'Bobby', level: 6 },
      turns: 2,
      unseen: 0,
      last_turn: new Date(T + 16 * MIN).toISOString(),
      rest_until: new Date(T + 31 * MIN).toISOString(),
    });
    // A fight lost: 30 minutes.
    expect(playerOf(s, 'carol')?.rest_until).toBe(new Date(T + 31 * MIN).toISOString());
    expect(playerOf(s, 'dave')).toBeNull();
    // Their drops are not the owner's.
    expect(s.inventory.items).toEqual({});
  });

  it('tells a turn played where the account does not read, by a "too soon" to a rested player', () => {
    // Seen at T, rested at T+15; at T+40 the bot says too soon: a turn at about T+30 we missed.
    const s = run(turnOf('bob', T), soon('bob', T + 40 * MIN, 5 * MIN));
    expect(playerOf(s, 'bob')).toMatchObject({
      turns: 1,
      unseen: 1,
      rest_until: new Date(T + 45 * MIN).toISOString(),
      accumulo: { count: 2, exact: false },
    });
    // A "too soon" within the rest we predicted tells of nothing missed.
    const within = run(turnOf('bob', T), soon('bob', T + 5 * MIN, 10 * MIN));
    expect(playerOf(within, 'bob')).toMatchObject({ unseen: 0, accumulo: { count: 1 } });
    // Nor does one for a player never seen to play: nothing to compare.
    expect(playerOf(run(soon('bob', T, 5 * MIN)), 'bob')).toMatchObject({ unseen: 0, turns: 0 });
  });

  it('keeps each player’s accumulo with the owner’s rules: the bot’s counter, its line, a use', () => {
    const lit = { accumulo: { ready: true, sure: true } };
    const s = run(
      asked('bob', T, { result: 'short', count: 18, max: 20 }),
      turnOf('bob', T + MIN),
      turnOf('bob', T + 17 * MIN, lit)
    );
    expect(playerOf(s, 'bob')?.accumulo).toMatchObject({
      count: 20,
      exact: true,
      ready: true,
      drift: [],
    });
    const used = reduce(s, asked('bob', T + 18 * MIN, { result: 'used' }));
    expect(playerOf(used, 'bob')?.accumulo).toMatchObject({ count: 0, ready: false });
    // The owner's own accumulo is not theirs.
    expect(used.accumulo).toEqual(initialState().accumulo);
    // An answer it cannot read changes nothing, and a nameless one is no one's.
    expect(reduce(used, asked('bob', T, { result: 'maybe' }))).toBe(used);
    expect(reduce(used, asked('', T, { result: 'used' }))).toBe(used);
  });

  it('tells a use of the accumulo unseen by a turn before the rest is over, only when it was full', () => {
    const lit = { accumulo: { ready: true, sure: true } };
    // Full by the bot's line at T; the next turn 5 minutes later, not 15: it was used in private.
    const used = run(turnOf('bob', T, lit), turnOf('bob', T + 5 * MIN));
    expect(playerOf(used, 'bob')).toMatchObject({
      unseen_uses: 1,
      accumulo: {
        count: 1,
        exact: true,
        ready: false,
        used_at: new Date(T + 5 * MIN).toISOString(),
      },
    });
    // Not full: the rest was ended otherwise (an item); the count is not touched.
    const other = run(
      asked('bob', T - MIN, { result: 'short', count: 3, max: 20 }),
      turnOf('bob', T),
      turnOf('bob', T + 5 * MIN)
    );
    expect(playerOf(other, 'bob')).toMatchObject({
      unseen_uses: 0,
      accumulo: { count: 5, exact: true },
    });
    // A use the account heard explains it already.
    const heard = run(
      turnOf('bob', T, lit),
      asked('bob', T + MIN, { result: 'used' }),
      turnOf('bob', T + 2 * MIN)
    );
    expect(playerOf(heard, 'bob')).toMatchObject({ unseen_uses: 0, accumulo: { count: 1 } });
  });

  it('takes a turn within a minute of the last for a double turn the bot gave, not a use', () => {
    const lit = { accumulo: { ready: true, sure: true } };
    const cmd = (e: BusEvent, command: string): BusEvent => ({ ...e, command }) as BusEvent;
    // Full, then /avventura and a /lore 20 seconds later: both turns, the accumulo untouched.
    const s = run(
      cmd(turnOf('bob', T, lit), '/avventura'),
      cmd(turnOf('bob', T + 20_000), '/lore')
    );
    expect(playerOf(s, 'bob')).toMatchObject({
      double_turns: 1,
      unseen_uses: 0,
      last_command: '/lore',
      turns: 2,
      rest_until: new Date(T + 20_000 + 15 * MIN).toISOString(),
    });
    // A use the account heard explains a quick turn first.
    const used = run(
      turnOf('bob', T, lit),
      asked('bob', T + 10_000, { result: 'used' }),
      turnOf('bob', T + 30_000)
    );
    expect(playerOf(used, 'bob')).toMatchObject({ double_turns: 0, accumulo: { count: 1 } });
  });

  it('charges no accumulo below level 4, as a fight or a level-up says, and from it again', () => {
    const at = (level: number) => ({
      fight: {
        player: { name: 'Bobby', level },
        enemy: { name: 'un orso', level: 2 },
        result: 'won',
      },
    });
    const low = run(
      turnOf('bob', T, at(3)),
      turnOf('bob', T + 16 * MIN),
      turnOf('bob', T + 32 * MIN)
    );
    expect(playerOf(low, 'bob')?.accumulo).toMatchObject({ locked: 4, count: 0, exact: true });
    // The level-up to 4: that turn charges nothing, the next does.
    const up = run(
      turnOf('bob', T, at(3)),
      turnOf('bob', T + 16 * MIN),
      levelUp(4, [], { t: T + 16 * MIN, player: 'bob' }),
      turnOf('bob', T + 32 * MIN)
    );
    expect(playerOf(up, 'bob')?.accumulo).toMatchObject({ locked: null, count: 1 });
    // Seen at level 4 or more after a lock without the level-up: open again, a floor.
    const later = run(turnOf('bob', T, at(3)), turnOf('bob', T + 16 * MIN, at(5)));
    expect(playerOf(later, 'bob')?.accumulo).toMatchObject({
      locked: null,
      exact: false,
      count: 1,
    });
  });

  it('counts the XP seen, and records with each level-up how much was seen since the last', () => {
    const won = (learned?: number) => ({
      fight: {
        player: { name: 'Bobby', level: 3 },
        enemy: { name: 'un orso', level: 2 },
        result: 'won',
        ...(learned === undefined ? {} : { learned }),
      },
    });
    const trained = (t: number, learned: number, extra = 0): BusEvent =>
      ({
        type: 'loregame.training',
        t,
        chat: '-1001',
        player: 'bob',
        owner: false,
        result: 'trained',
        gym: null,
        learned,
        extra,
      }) as unknown as BusEvent;
    const s = run(
      // Before any level-up seen: a total, and nothing since a level-up.
      turnOf('bob', T, won(4)),
      levelUp(4, [], { t: T, player: 'bob' }),
      // Then a win, a win that taught nothing, a fight lost, a training with its extra.
      turnOf('bob', T + 16 * MIN, won(5)),
      turnOf('bob', T + 32 * MIN, won()),
      turnOf('bob', T + 48 * MIN, { fight: { ...won(9).fight, result: 'lost' } }),
      trained(T + 50 * MIN, 15, 2),
      levelUp(5, [], { t: T + 50 * MIN, player: 'bob' })
    );
    // Each turn 1, a win's "+N" besides, a loss 2 less; a training its "+N", not its extra.
    expect(playerOf(s, 'bob')?.xp).toEqual({
      seen: 5 + 6 + 1 - 1 + 15,
      since_level: 0,
      level_ups: [
        { level: 4, at: new Date(T).toISOString(), xp: null },
        { level: 5, at: new Date(T + 50 * MIN).toISOString(), xp: 6 + 1 - 1 + 15 },
      ],
    });
    expect(playerOf(s, 'bob')?.game.level).toBe(5);
  });

  it('moves the stats a profile seeds by each command read since, and says what no longer holds', () => {
    const profile = (t: number, o: Record<string, unknown> = {}): BusEvent =>
      ({
        type: 'loregame.profile',
        t,
        chat: '-1001',
        player: 'bob',
        owner: false,
        company: null,
        level: 4,
        xp: 500,
        progress: null,
        alignment: 'Bene',
        episode: 100,
        recipes: 0,
        coins: 50,
        obsession: null,
        equipment: { armour: null, amulet: null, weapon: null },
        skills: { Ricercato: 1 },
        effects: [{ name: 'Neutralizzato', leftMs: 30 * MIN }],
        titles: [],
        location: { name: 'Altrove', code: 'M1' },
        unread: [],
        ...o,
      }) as unknown as BusEvent;
    const fight = (result: string, learned?: number) => ({
      fight: {
        player: { name: 'Bobby', level: 4 },
        enemy: { name: 'un orso', level: 2 },
        result,
        ...(learned === undefined ? {} : { learned }),
      },
    });
    const trained: BusEvent = {
      type: 'loregame.training',
      t: T + 70 * MIN,
      chat: '-1001',
      player: 'bob',
      owner: false,
      result: 'trained',
      gym: null,
      learned: 15,
      extra: 2,
    } as unknown as BusEvent;
    const stats = (...events: BusEvent[]) => playerOf(run(...events), 'bob')?.stats ?? {};
    const known = profile(T);
    // Before a profile, nothing to move.
    expect(stats(turnOf('bob', T))).toEqual({});
    // A turn 1, a win 1 and its "+N", a loss 1 less, a training its "+N" and not its extra; an
    // episode each turn; the place of the last.
    const moved = stats(
      known,
      turnOf('bob', T + MIN),
      turnOf('bob', T + 20 * MIN, fight('won', 5)),
      turnOf('bob', T + 40 * MIN, fight('lost')),
      trained
    );
    expect(moved['xp']).toEqual({
      value: 500 + 1 + 6 - 1 + 15,
      exact: true,
      as_of: new Date(T + 70 * MIN).toISOString(),
    });
    expect(moved['episode']).toMatchObject({ value: 103, exact: true });
    expect(moved['location']).toMatchObject({
      value: { name: 'Il Bosco Inventato', code: 'B1' },
      exact: true,
    });
    // Untouched by any command read: as the profile said, exact.
    expect(moved['skills']).toEqual({
      value: { Ricercato: 1 },
      exact: true,
      as_of: new Date(T).toISOString(),
    });
    // A draw: not known to give the same.
    expect(stats(known, turnOf('bob', T + MIN, fight('draw')))['xp']).toMatchObject({
      value: 501,
      exact: false,
    });
    // A turn unseen, told by a "too soon" when we held them rested: one more episode at least.
    const unseen = stats(known, turnOf('bob', T + MIN), soon('bob', T + 40 * MIN, 5 * MIN));
    expect(unseen['xp']).toMatchObject({ value: 501, exact: false });
    expect(unseen['episode']).toMatchObject({ value: 102, exact: false });
    // A level-up: the bot's level, its coins; XP short of its threshold raised to it, not exact.
    const up = stats(known, levelUp(5, [], { t: T + MIN, player: 'bob' }));
    expect(up['level']).toMatchObject({ value: 5, exact: true });
    expect(up['coins']).toMatchObject({ value: 90, exact: true });
    expect(up['xp']).toMatchObject({ value: 848, exact: false });
    // XP that makes the next level makes the level, before its level-up is read.
    expect(stats(profile(T, { xp: 847 }), turnOf('bob', T + MIN))['level']).toMatchObject({
      value: 5,
    });
  });

  it('tells each stat held exactly that the next profile says otherwise, then follows it', () => {
    const at = (t: number, o: Record<string, unknown> = {}): BusEvent =>
      ({
        type: 'loregame.profile',
        t,
        chat: '-1001',
        player: 'bob',
        owner: false,
        company: null,
        level: 4,
        xp: 500,
        progress: null,
        alignment: 'Bene',
        episode: 100,
        recipes: 0,
        coins: 50,
        obsession: null,
        equipment: { armour: null, amulet: null, weapon: null },
        skills: {},
        effects: [{ name: 'Neutralizzato', leftMs: 30 * MIN }],
        titles: [],
        location: { name: 'Il Bosco Inventato', code: 'B1' },
        unread: [],
        ...o,
      }) as unknown as BusEvent;
    // Two turns seen; the next profile: 3 episodes more (a turn unseen), coins spent, a weapon
    // equipped; the effect ended as it said.
    const s = run(
      at(T),
      turnOf('bob', T + MIN),
      turnOf('bob', T + 20 * MIN),
      at(T + HOUR, {
        xp: 503,
        episode: 103,
        coins: 10,
        effects: [],
        equipment: { armour: null, amulet: null, weapon: { item: 'una spatola', level: null } },
      })
    );
    const bob = playerOf(s, 'bob');
    expect(bob?.stats_drift.map((d) => d.stat)).toEqual(['xp', 'episode', 'coins', 'equipment']);
    expect(bob?.stats_drift[0]).toEqual({
      stat: 'xp',
      expected: 502,
      said: 503,
      at: new Date(T + HOUR).toISOString(),
    });
    // Seeded again from it, exact.
    expect(bob?.stats['episode']).toMatchObject({ value: 103, exact: true });
    // A stat no longer held exactly is not a mismatch; nor an effect still running, nor one ended.
    const quiet = run(at(T), soon('bob', T + MIN, MIN), at(T + 10 * MIN));
    expect(playerOf(quiet, 'bob')?.stats_drift).toEqual([]);
  });

  it('keeps a player named like an object’s own property', () => {
    const s = run(turnOf('__proto__', T), turnOf('constructor', T));
    expect(Object.keys(s.players)).toEqual(['__proto__', 'constructor']);
    expect(playerOf(s, '__proto__')?.turns).toBe(1);
    expect(playerOf(s, 'toString')).toBeNull();
  });
});

describe('the owner’s readiness, with what the state knows besides (MegaBotTron1999’s D141)', () => {
  const T = Date.parse('2026-11-06T12:00:00Z');
  const MIN = 60_000;
  const at = (type: string, t: number, payload: Record<string, unknown>): BusEvent => ({
    type: `loregame.${type}`,
    t,
    instance: 'loregame',
    ...payload,
  });
  const ready = (r: ReturnType<typeof LORE_READINESS.initial>, t = T) => LORE_READINESS.ready(r, t);
  /** The turn resting 15 minutes, the accumulo full: as after a turn with the bot's line. */
  const rested = LORE_READINESS.reduce(
    LORE_READINESS.initial(),
    at('turn', T, {
      outcome: { kind: 'gain', bot: 'LoreGameBot' },
      retryAt: T + 15 * MIN,
      unlocks: ['/accumulo'],
    })
  );

  it('holds every command while the owner is banned, until the ban ends or the bot serves them', () => {
    const banned = foldReadiness(
      rested,
      at('ban', T, { player: 'alice', owner: true, until: T + 60 * MIN })
    );
    for (const r of Object.values(ready(banned)))
      expect(r).toMatchObject({ ready: false, until: T + 60 * MIN, why: 'the owner is banned' });
    expect(ready(banned, T + 60 * MIN)['/lore']).toMatchObject({ ready: true });
    // Another player's ban is not the owner's; one with no end holds until it is lifted.
    expect(
      foldReadiness(rested, at('ban', T, { player: 'bob', owner: false, until: T + MIN }))
    ).toBe(rested);
    const open = foldReadiness(rested, at('ban', T, { player: 'alice', owner: true }));
    expect(ready(open, T + 99 * 60 * MIN)['/lore']).toEqual({
      ready: false,
      why: 'the owner is banned',
    });
    const lifted = foldReadiness(open, at('unban', T + MIN, { player: 'alice', owner: true }));
    expect(ready(lifted, T + 16 * MIN)['/lore']).toMatchObject({ ready: true });
  });

  it('takes the owner’s /accumulo answered anywhere: a use, a no, the level gate', () => {
    // A use: the unlock spent, the turn's rest ended.
    const used = foldReadiness(rested, at('accumulo', T + MIN, { result: 'used' }));
    expect(ready(used, T + MIN)['/lore']).toMatchObject({ ready: true, since: T + MIN });
    expect(ready(used, T + MIN)['/accumulo']).toMatchObject({ why: 'waits for an unlock' });
    // "Already ready": nothing spent.
    expect(foldReadiness(rested, at('accumulo', T, { result: 'idle' }))).toBe(rested);
    // Not yet: its unlock withdrawn, until the bot's next line.
    const short = foldReadiness(rested, at('accumulo', T, { result: 'short', count: 3, max: 20 }));
    expect(ready(short)['/accumulo']).toMatchObject({ ready: false, why: 'waits for an unlock' });
    // Under the level: withdrawn, and held 6 hours even if a line unlocks it again.
    const locked = foldReadiness(rested, at('accumulo', T, { result: 'locked', level: 10 }));
    const again = LORE_READINESS.unlock(locked, '/accumulo', T + MIN);
    expect(ready(again, T + MIN)['/accumulo']).toMatchObject({
      ready: false,
      until: T + 6 * 60 * MIN,
      why: 'under the level the bot asks',
    });
    // Any other event of the parser's is the shell's to reduce.
    expect(foldReadiness(rested, at('turn', T, {}))).toBe(rested);
  });
});
