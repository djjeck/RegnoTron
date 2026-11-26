import { describe, expect, it } from 'vitest';
import { initialPlayer, initialState, type LoreState } from './loregame-state.ts';
import { tripOf } from './trips.ts';

// Invented places and items.
const AT = '2026-01-01T00:00:00.000Z';
const NOW = Date.parse(AT);
const item = (name: string) => ({ item: name, rarity: 'B1', tags: [], level: null });
const place = (
  name: string,
  level: number | null,
  items: string[],
  exits: string[] = [],
  guardians: string[] = []
) => ({
  name,
  level,
  items: items.map(item),
  guardians,
  exits: exits.map((code) => ({ name: code, code })),
  as_of: AT,
  requirements_as_of: AT,
  media: [],
});
const stat = (value: unknown, exact = true) => ({ value, exact, as_of: AT });

/**
 * A state: alice at `at`, level 3, holding `held` (listed whole, unless not), with these effects;
 * the guardians made (by anyone) as `guardians`.
 */
function state(o: {
  at?: string | null;
  held?: Record<string, { qty: number; exact?: boolean }>;
  listed?: boolean;
  effects?: unknown;
  alignment?: string;
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
  return {
    ...s,
    owner: { as_of: AT, name: 'alice', id: null },
    inventory: { held: 0, items, listed: o.listed === false ? null : AT },
    players: {
      alice: {
        ...p,
        stats: {
          level: stat(3),
          location: stat(o.at === null ? null : { name: o.at ?? 'B1', code: o.at ?? 'B1' }),
          ...(o.effects === undefined ? {} : { effects: stat(o.effects) }),
          ...(o.alignment === undefined ? {} : { alignment: stat(o.alignment) }),
        },
      },
    },
    places: {
      B1: place('Il Bosco', 1, [], ['B2', 'N1']),
      B2: place('Il Prato', 2, ['un sasso']),
      B3: place('Il Colle', 3, ['un sasso', 'una pigna']),
      B4: place('La Vetta', 9, []),
      N1: place('Il Limbo', 1, [], ['B1', 'M1', 'N2']),
      N2: place('Il Nodo', 1, [], ['N1'], ['N1']),
      M1: place('L’Inferno', 1, []),
      X: place('Altrove', null, []),
    },
    guardians: o.guardians ?? {},
  };
}

describe('a trip', () => {
  it('follows the ladder, and takes each step’s items from what is left', () => {
    const t = tripOf(
      state({ held: { 'un sasso': { qty: 2 }, 'una pigna': { qty: 1 } } }),
      'B3',
      NOW
    );
    expect(t).toMatchObject({ from: 'B1', route: ['B2', 'B3'], routed: true, ok: true });
    expect(t.steps.map((s) => s.missing)).toEqual([[], []]);
  });

  it('tells a lack known, a level too low, and what it cannot tell', () => {
    expect(tripOf(state({ held: { 'un sasso': { qty: 1 } } }), 'B3', NOW)).toMatchObject({
      ok: false,
      steps: [{ missing: [] }, { missing: [item('un sasso'), item('una pigna')] }],
    });
    expect(tripOf(state({}), 'B4', NOW)).toMatchObject({
      route: ['B2', 'B3', 'B4'],
      steps: [{}, {}, { level_ok: false }],
      ok: false,
    });
    // An inventory not listed whole, or a count not exact: not known either way.
    expect(tripOf(state({ listed: false }), 'B2', NOW)).toMatchObject({
      ok: null,
      steps: [{ unsure: [item('un sasso')], missing: [] }],
    });
    expect(
      tripOf(state({ held: { 'un sasso': { qty: 3, exact: false } } }), 'B2', NOW).steps[0]
    ).toMatchObject({ unsure: [item('un sasso')] });
    // A place it knows no level of.
    expect(tripOf(state({}), 'X', NOW)).toMatchObject({ routed: false, ok: null });
  });

  it('opens a neutral place while "Neutralizzato" lasts, and leaves one freely', () => {
    const until = (ms: number) => [
      { name: 'Neutralizzato', until: new Date(NOW + ms).toISOString() },
    ];
    expect(tripOf(state({ effects: until(60_000) }), 'N1', NOW)).toMatchObject({
      ok: true,
      steps: [{ neutral: true, neutral_ok: true }],
    });
    expect(tripOf(state({ effects: until(-60_000) }), 'N1', NOW)).toMatchObject({
      ok: false,
      steps: [{ neutral_ok: false }],
    });
    expect(tripOf(state({}), 'N1', NOW)).toMatchObject({ ok: null, steps: [{ neutral_ok: null }] });
    expect(tripOf(state({ at: 'N1' }), 'M1', NOW)).toMatchObject({
      route: ['M1'],
      ok: true,
      steps: [{ neutral: false }],
    });
  });

  it('tells nothing of a way from a place not known, or for a player not known', () => {
    expect(tripOf(state({ at: null, held: { 'un sasso': { qty: 1 } } }), 'B2', NOW)).toMatchObject({
      from: null,
      route: ['B2'],
      routed: false,
      ok: null,
    });
    expect(tripOf(state({}), 'B1', NOW)).toMatchObject({ route: [], steps: [], ok: true });
    expect(tripOf(state({}), 'B2', NOW, 'nobody')).toMatchObject({
      player: 'nobody',
      from: null,
      ok: null,
    });
  });

  it('checks a guardian asked against those known made, by anyone', () => {
    const at = (guardians?: Record<string, boolean>) =>
      tripOf(
        state({
          at: 'N1',
          alignment: 'Neutrale',
          ...(guardians === undefined ? {} : { guardians }),
        }),
        'N2',
        NOW
      );
    expect(at({ N1: true })).toMatchObject({
      ok: true,
      steps: [{ guardians: ['N1'], guardians_ok: true }],
    });
    expect(at({ N1: false })).toMatchObject({ ok: false, steps: [{ guardians_ok: false }] });
    expect(at()).toMatchObject({ ok: null, steps: [{ guardians_ok: null }] });
    expect(tripOf(state({}), 'B2', NOW).steps[0]).toMatchObject({ guardians_ok: null });
    // A neutral place asks none of a faction's player, there with a ticket.
    expect(
      tripOf(
        state({
          at: 'N1',
          alignment: 'Bene',
          guardians: { N1: false },
          effects: [{ name: 'Neutralizzato', until: null }],
        }),
        'N2',
        NOW
      )
    ).toMatchObject({ ok: true, steps: [{ guardians: [], guardians_ok: null, neutral: false }] });
  });

  it('asks no ticket of a player of "Il Neutrale" for the neutral ladder', () => {
    expect(tripOf(state({ alignment: 'Neutrale' }), 'N1', NOW)).toMatchObject({
      ok: true,
      steps: [{ neutral: false, neutral_ok: null }],
    });
    expect(tripOf(state({ alignment: 'Bene' }), 'N1', NOW)).toMatchObject({
      ok: null,
      steps: [{ neutral: true }],
    });
  });
});
