import { describe, expect, it } from 'vitest';
import { initialPlayer, initialState, type LoreState } from './loregame-state.ts';
import { reachOf } from './reach.ts';

// Invented places and items.
const AT = '2026-01-01T00:00:00.000Z';
const item = (name: string) => ({ item: name, rarity: 'B1', tags: [], level: null });
type Told = {
  level?: number | null;
  items?: string[];
  exits?: string[];
  guardians?: string[];
  told?: boolean;
};
const place = (code: string, o: Told = {}) => ({
  name: `Il Posto ${code}`,
  level: o.level === undefined ? Number(code.slice(1)) : o.level,
  items: (o.items ?? []).map(item),
  guardians: o.guardians ?? [],
  exits: (o.exits ?? []).map((c) => ({ name: c, code: c })),
  as_of: AT,
  requirements_as_of: o.told === false ? null : AT,
  media: [],
});
const stat = (value: unknown, exact = true) => ({ value, exact, as_of: AT });

/** The places: B1–B4, M1–M2, N1–N3, as the game links them since its reset. */
const PLACES = {
  B1: place('B1', { exits: ['B2', 'N1'] }),
  B2: place('B2', { items: ['un sasso'], guardians: ['B1'] }),
  B3: place('B3', { items: ['un sasso', 'una pigna'], guardians: ['B2'] }),
  B4: place('B4', { items: ['una gemma finta'] }),
  M1: place('M1', { exits: ['M2', 'N1'] }),
  M2: place('M2', { items: ['un osso'] }),
  N1: place('N1', { exits: ['B1', 'M1', 'N2'] }),
  N2: place('N2', { items: ['una forchetta'], exits: ['N1', 'N3', 'B2', 'M2'] }),
  N3: place('N3', { exits: ['N2'] }),
};

/** A state: bob at `at`, of `alignment`, at `level`, holding `held` (listed whole, unless not). */
function state(o: {
  at?: string | null;
  alignment?: string | null;
  level?: number | null;
  held?: Record<string, { qty: number; exact?: boolean }>;
  listed?: boolean;
  places?: Record<string, ReturnType<typeof place>>;
  guardians?: Record<string, boolean>;
}): LoreState {
  const s = initialState();
  const p = initialPlayer(AT);
  const items = Object.fromEntries(
    Object.entries(o.held ?? {}).map(([n, h]) => [
      n,
      {
        qty: h.qty,
        exact: h.exact ?? true,
        date: AT,
        via: 'listing' as const,
        rarity: 'B1',
        tags: [],
      },
    ])
  );
  const alignment = o.alignment === undefined ? 'Bene' : o.alignment;
  const level = o.level === undefined ? 9 : o.level;
  return {
    ...s,
    owner: { as_of: AT, name: 'alice' },
    players: {
      bob: {
        ...p,
        inventory: { held: 0, items, listed: o.listed === false ? null : AT },
        stats: {
          ...(o.at === null ? {} : { location: stat({ name: 'x', code: o.at ?? 'B1' }) }),
          ...(alignment === null ? {} : { alignment: stat(alignment) }),
          ...(level === null ? {} : { level: stat(level) }),
        },
      },
    },
    places: o.places ?? PLACES,
    guardians: o.guardians ?? { B1: true, B2: true },
  };
}

describe('how far a player can climb', () => {
  it('climbs from where they are, each step’s items taken from what is left', () => {
    const r = reachOf(state({ held: { 'un sasso': { qty: 2 }, 'una pigna': { qty: 1 } } }), 'bob');
    expect(r).toMatchObject({
      ladder: 'B',
      from: 'B1',
      level: 9,
      path: ['B2', 'B3'],
      reached: { code: 'B3', step: 3 },
      next: {
        code: 'B4',
        level: 4,
        level_ok: true,
        lacking: [item('una gemma finta')],
        guardians: [],
      },
      top: false,
      unknown: null,
      unsure: [],
    });
  });

  it('pays again to climb back from a lower place, and is stuck once spent', () => {
    // At B2 again, one stone: B3 takes it with the cone; then nothing for B4.
    const r = reachOf(
      state({ at: 'B2', held: { 'un sasso': { qty: 1 }, 'una pigna': { qty: 1 } } }),
      'bob'
    );
    expect(r).toMatchObject({ path: ['B3'], reached: { step: 3 }, next: { code: 'B4' } });
    // At B1, the same: B2 takes the only stone, and B3 asks another.
    expect(
      reachOf(state({ held: { 'un sasso': { qty: 1 }, 'una pigna': { qty: 1 } } }), 'bob')
    ).toMatchObject({
      path: ['B2'],
      reached: { code: 'B2' },
      next: { code: 'B3', lacking: [item('un sasso')], unsure: [] },
    });
  });

  it('tells a level too low, a guardian not made, and stops at the top', () => {
    expect(
      reachOf(state({ level: 1, held: { 'un sasso': { qty: 1 } } }), 'bob').next
    ).toMatchObject({ code: 'B2', level_ok: false, lacking: [] });
    expect(
      reachOf(state({ guardians: { B1: false }, held: { 'un sasso': { qty: 1 } } }), 'bob')
    ).toMatchObject({ reached: { code: 'B1' }, next: { code: 'B2', guardians: ['B1'] } });
    expect(
      reachOf(state({ at: 'M1', alignment: 'Male', held: { 'un osso': { qty: 1 } } }), 'bob')
    ).toMatchObject({ path: ['M2'], reached: { code: 'M2' }, next: null, top: true });
  });

  it('checks no level where theirs is not known, and takes a place’s untold as its step’s', () => {
    expect(reachOf(state({ level: null }), 'bob')).toMatchObject({
      level: null,
      next: { code: 'B2', level: 2, level_told: true, level_ok: null },
    });
    const places = { ...PLACES, B2: place('B2', { level: null }) };
    expect(reachOf(state({ level: 1, places }), 'bob')).toMatchObject({
      reached: { code: 'B1' },
      next: { code: 'B2', level: 2, level_told: false, level_ok: false },
    });
  });

  it('walks a faction’s player back from the neutral ladder, asking no guardian there', () => {
    // N3 leads to N2 alone; N2 to B2, its forchetta first.
    const held = { 'una forchetta': { qty: 1 }, 'un sasso': { qty: 1 } };
    expect(reachOf(state({ at: 'N3', held }), 'bob')).toMatchObject({
      path: ['N2', 'B2'],
      reached: { code: 'B2', step: 2 },
      next: { code: 'B3' },
    });
    // Stuck on the way back: K is not known to be reached.
    expect(reachOf(state({ at: 'N3' }), 'bob')).toMatchObject({
      path: [],
      reached: null,
      next: { code: 'N2', lacking: [item('una forchetta')] },
      unknown: null,
    });
    // No way known back.
    const lone = { N5: place('N5'), B1: PLACES.B1 };
    expect(reachOf(state({ at: 'N5', places: lone }), 'bob')).toMatchObject({
      reached: null,
      unknown: 'way back',
    });
  });

  it('climbs the neutral ladder for a player of Il Neutrale', () => {
    const r = reachOf(
      state({ at: 'N1', alignment: 'Neutrale', held: { 'una forchetta': { qty: 1 } } }),
      'bob'
    );
    expect(r).toMatchObject({
      ladder: 'N',
      path: ['N2', 'N3'],
      reached: { code: 'N3' },
      top: true,
    });
  });

  it('stops on what it does not know, and says why', () => {
    const untold = { ...PLACES, B2: place('B2', { told: false }) };
    expect(reachOf(state({ places: untold }), 'bob')).toMatchObject({
      reached: { code: 'B1' },
      next: { code: 'B2', name: 'Il Posto B2', level: 2, level_told: false, lacking: [] },
      unknown: 'requirements',
    });
    // B5 is not a place known: the top; a guardian whose making is not known.
    expect(
      reachOf(state({ guardians: {}, held: { 'un sasso': { qty: 1 } } }), 'bob')
    ).toMatchObject({ reached: { code: 'B1' }, next: { code: 'B2' }, unknown: 'guardian' });
    expect(reachOf(state({ at: null }), 'bob').unknown).toBe('location');
    expect(reachOf(state({ at: 'X' }), 'bob').unknown).toBe('location');
    expect(reachOf(state({ alignment: null }), 'bob').unknown).toBe('alignment');
    expect(reachOf(state({}), 'carol')).toMatchObject({ unknown: 'alignment', from: null });
    expect(reachOf({ ...state({}), owner: { as_of: AT, name: null } })).toMatchObject({
      player: null,
      unknown: 'player',
    });
    // A place the state has no record of on the way back is not one.
    expect(reachOf(state({ at: 'N9', places: { B1: PLACES.B1 } }), 'bob').unknown).toBe('way back');
  });

  it('tells which lacks and which items taken it cannot be sure of', () => {
    // Not exact: taken, but not sure, and none left not sure either; the cone, listed, is sure.
    expect(reachOf(state({ held: { 'un sasso': { qty: 1, exact: false } } }), 'bob')).toMatchObject(
      {
        unsure: [item('un sasso')],
        next: {
          code: 'B3',
          lacking: [item('un sasso'), item('una pigna')],
          unsure: [item('un sasso')],
        },
      }
    );
    // Not listed: a lack not sure.
    expect(reachOf(state({ listed: false }), 'bob').next).toMatchObject({
      lacking: [item('un sasso')],
      unsure: [item('un sasso')],
    });
    expect(
      reachOf(state({ held: { 'un sasso': { qty: 0, exact: false } } }), 'bob').next
    ).toMatchObject({ unsure: [item('un sasso')] });
  });
});
