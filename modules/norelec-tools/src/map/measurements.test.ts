import { parseMessage } from '@regnotron/norelec/game/parse-message.ts';
import { describe, expect, it } from 'vitest';
import {
  distanceOf,
  Measurements,
  ROAD_WINDOW_MS,
  type RocketsOf,
  type Trip,
  tripsIn,
} from './measurements.ts';

const T0 = Date.UTC(2026, 9, 23, 8, 0, 0);
const msg = (time: number, text: string) => ({ time, text, events: parseMessage(text) });
const trip = (from: string, to: string, seconds: number, rockets = 0, time = T0): Trip => ({
  from,
  to,
  seconds,
  rockets,
  time,
});
const NONE: RocketsOf = () => 0;
const raid = (who: string, to: string, d: string) =>
  `${who} parti per ${to}: arrivi tra ${d}. Casa tua resta scoperta.`;

describe('tripsIn', () => {
  it('reads a departure as a trip between two homes, with the rockets its player carries', () => {
    expect(tripsIn(msg(T0, raid('Alfa', 'Beta', '2 minuti e 16 secondi')), NONE)).toEqual([
      { from: 'Alfa', to: 'Beta', seconds: 136, rockets: 0, time: T0 },
    ]);
    const twoRockets: RocketsOf = (p) => (p === 'Alfa' ? 2 : undefined);
    expect(tripsIn(msg(T0, raid('Alfa', 'Beta', '2 minuti e 5 secondi')), twoRockets)).toEqual([
      { from: 'Alfa', to: 'Beta', seconds: 125, rockets: 2, time: T0 },
    ]);
    expect(
      tripsIn(
        msg(
          T0,
          'Alfa parti per Beta con 🧊 da consegnare: arrivi tra 1 minuto. Casa tua resta scoperta.'
        ),
        NONE
      )
    ).toEqual([{ from: 'Alfa', to: 'Beta', seconds: 60, rockets: 0, time: T0 }]);
  });

  it('leaves out a player whose rockets are unknown, other lines and trips to Conquister', () => {
    const unknown: RocketsOf = () => undefined;
    expect(tripsIn(msg(T0, raid('Alfa', 'Beta', '1 minuto')), unknown)).toEqual([]);
    expect(tripsIn(msg(T0, 'Alfa sei già in viaggio, torni tra 40 secondi.'), NONE)).toEqual([]);
    expect(tripsIn(msg(T0, raid('Alfa', 'TheConquister37', '1 minuto')), NONE)).toEqual([]);
  });

  it('counts at least one rocket on a 🚀 line', () => {
    const line = '🚀 Alfa parti per Beta: arrivi tra 1 minuto e 22 secondi. Alfa resta scoperto.';
    expect(tripsIn(msg(T0, line), () => undefined)).toMatchObject([{ rockets: 1 }]);
    expect(tripsIn(msg(T0, line), () => 2)).toMatchObject([{ rockets: 2 }]);
  });
});

describe('Measurements', () => {
  it('keeps a pair unordered, counting its repeats', () => {
    const m = new Measurements();
    expect(m.add(trip('Beta', 'Alfa', 50)).kind).toBe('new');
    expect(m.add(trip('Alfa', 'Beta', 50, 0, T0 + 1000)).kind).toBe('repeat');
    expect(m.pairs()).toEqual([
      {
        a: 'Alfa',
        b: 'Beta',
        lo: 50,
        hi: 50,
        slack: 1,
        trips: 2,
        first: T0,
        last: T0 + 1000,
        toB: [],
        toA: [],
      },
    ]);
  });

  it('times a trip from the middle of what the rounded times allow', () => {
    const m = new Measurements();
    expect(m.baseS('Alfa', 'Beta')).toBeUndefined();
    // One trip shown as 50 s: the true time is in [50, 51).
    m.add(trip('Alfa', 'Beta', 50));
    expect(m.baseS('Beta', 'Alfa')).toBe(50.5);
    // 50 and 51 seen: in [51, 51).
    m.add(trip('Beta', 'Alfa', 51));
    expect(m.baseS('Alfa', 'Beta')).toBe(51);
  });

  it('takes a trip with rockets at its base time', () => {
    const m = new Measurements();
    m.add(trip('Alfa', 'Beta', 125, 2));
    // 125 s with two 🚀 is 150 s without: the same pair, within the rounding.
    expect(m.add(trip('Alfa', 'Beta', 150)).kind).toBe('repeat');
    expect(distanceOf(m.pairs()[0] as never)).toBe(150);
  });

  it('puts a pair seen at N and N + 1 at N + 0.5', () => {
    const m = new Measurements();
    m.add(trip('Alfa', 'Beta', 48));
    expect(m.add(trip('Alfa', 'Beta', 49)).kind).toBe('widened');
    expect(m.key(T0)).toBe('Alfa Beta 48.5 0/0');
    expect(m.add(trip('Alfa', 'Beta', 48)).kind).toBe('repeat');
  });

  it("drops both players' older pairs when a time moves beyond the rounding", () => {
    const m = new Measurements();
    m.add(trip('Alfa', 'Beta', 50));
    m.add(trip('Alfa', 'Gamma', 60));
    m.add(trip('Beta', 'Delta', 70));
    m.add(trip('Gamma', 'Delta', 80));
    const change = m.add(trip('Beta', 'Alfa', 52, 0, T0 + 1000));
    expect(change.kind).toBe('moved');
    if (change.kind !== 'moved') return;
    expect(change.was).toBe(50);
    expect(change.dropped.map((p) => `${p.a}-${p.b}`)).toEqual([
      'Alfa-Beta',
      'Alfa-Gamma',
      'Beta-Delta',
    ]);
    expect(m.key(T0)).toBe('Alfa Beta 52 0/0\nDelta Gamma 80 0/0');
  });

  it('leaves out a time that another count of rockets explains, rather than take it for a move', () => {
    const m = new Measurements();
    m.add(trip('Alfa', 'Beta', 150));
    m.add(trip('Alfa', 'Beta', 150));
    m.add(trip('Alfa', 'Gamma', 60));
    // 136 s is 150 s with one 🚀 the state had not seen: not a move.
    expect(m.add(trip('Alfa', 'Beta', 136)).kind).toBe('stale');
    expect(m.key(T0)).toBe('Alfa Beta 150 0/0\nAlfa Gamma 60 0/0');
  });

  it('replaces a pair of one trip that another count of rockets explains, dropping nothing', () => {
    const m = new Measurements();
    // The first trip had a 🚀 the state had not seen: 136 s taken as the base time.
    m.add(trip('Alfa', 'Beta', 136));
    m.add(trip('Alfa', 'Gamma', 60));
    const change = m.add(trip('Beta', 'Alfa', 150));
    expect(change).toMatchObject({ kind: 'corrected', was: 136 });
    expect(m.key(T0)).toBe('Alfa Beta 150 0/0\nAlfa Gamma 60 0/0');
  });

  it('allows a trip with rockets its wider rounding, and no more', () => {
    const m = new Measurements();
    m.add(trip('Alfa', 'Beta', 150));
    // 126 s with two 🚀 is 151.2 s: within the 1.2 s that rounding allows.
    expect(m.add(trip('Alfa', 'Beta', 126, 2)).kind).toBe('widened');
    // 153 s: no count of rockets brings it within the rounding of 150–151.2 s.
    expect(m.add(trip('Alfa', 'Beta', 153)).kind).toBe('moved');
  });

  it('keys the map by the distances only, and survives a JSON round trip', () => {
    const m = new Measurements();
    m.add(trip('Gamma', 'Alfa', 60));
    m.add(trip('Alfa', 'Beta', 50));
    const key = m.key(T0);
    expect(key).toBe('Alfa Beta 50 0/0\nAlfa Gamma 60 0/0');
    m.add(trip('Alfa', 'Beta', 50, 0, T0 + 5000));
    expect(m.key(T0)).toBe(key);
    const copy = new Measurements(
      JSON.parse(JSON.stringify(m.pairs())) as ReturnType<typeof m.pairs>
    );
    expect(copy.pairs()).toEqual(m.pairs());
  });

  it('tells how busy a road is each way from the arrivals of the last 3 days, and keys the map by it', () => {
    const m = new Measurements();
    m.add(trip('Alfa', 'Beta', 50));
    m.add(trip('Alfa', 'Gamma', 60));
    expect(m.arrived('Beta', 'Alfa', T0)).toBe(true);
    expect(m.arrived('Alfa', 'Delta', T0)).toBe(false);
    expect(m.roads(T0)).toEqual({});
    for (let i = 1; i <= 10; i++) m.arrived('Alfa', 'Beta', T0 + i * 1000);
    expect(m.roads(T0 + 10_000)).toEqual({ 'Alfa Beta': 2 });
    expect(m.key(T0 + 10_000)).toBe('Alfa Beta 50 2/0\nAlfa Gamma 60 0/0');
    for (let i = 1; i < 40; i++) m.arrived('Beta', 'Alfa', T0 + i * 1000);
    expect(m.roads(T0 + 40_000)).toEqual({ 'Alfa Beta': 2, 'Beta Alfa': 3 });
    // Three days on, the road is quiet again.
    expect(m.roads(T0 + ROAD_WINDOW_MS + 40_000)).toEqual({});
  });
});
