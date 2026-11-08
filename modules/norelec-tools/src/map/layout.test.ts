import { describe, expect, it } from 'vitest';
import { distance, syntheticHomes } from '#test/homes.ts';
import { type Distance, errorsOf, type Fit, fitHomes, type FitResult, type Point } from './fit.ts';
import { AMBIGUOUS_S, circleIntersections, fixedOnly, layoutMap, procrustes } from './layout.ts';

// Full fits of several seeds, slow under coverage.
const FULL_FIT_TIMEOUT = 60_000;

/** Exact distances between given homes, rounded to a tenth. */
const measure = (homes: Record<string, Point>, links: string[]): Distance[] =>
  links.map((l) => {
    const [a, b] = l.split('-') as [string, string];
    return { a, b, d: Math.round(distance(homes[a] as Point, homes[b] as Point) * 10) / 10 };
  });

/** A fit that puts every home where it is. */
const exact = (homes: Record<string, Point>, pairs: Distance[], seed = 1): Fit => {
  const positions = new Map(Object.entries(homes).map(([n, p]) => [n, { ...p }]));
  return { seed, positions, ...errorsOf(positions, pairs) };
};
const result = (...good: Fit[]): FitResult => ({ best: good[0] as Fit, good, accepted: true });

/** A square of four homes, every pair measured. */
const SQUARE = {
  A: { x: 0, y: 0 },
  B: { x: 100, y: 0 },
  C: { x: 100, y: 100 },
  D: { x: 0, y: 100 },
};
const SQUARE_LINKS = ['A-B', 'A-C', 'A-D', 'B-C', 'B-D', 'C-D'];

describe('circleIntersections', () => {
  it('finds the two spots at the given distances, and none from one point', () => {
    const spots = circleIntersections({ x: 0, y: 0 }, 50, { x: 60, y: 0 }, 50);
    expect(spots?.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))).toEqual([
      { x: 30, y: 40 },
      { x: 30, y: -40 },
    ]);
    expect(circleIntersections({ x: 1, y: 1 }, 5, { x: 1, y: 1 }, 5)).toBeUndefined();
  });
});

describe('procrustes', () => {
  it('undoes a rotation and a reflection', () => {
    const from = new Map(Object.entries(SQUARE));
    const to = new Map(
      [...from].map(([n, p]) => [n, { x: -p.y * 0.6 - p.x * 0.8 + 5, y: p.x * 0.6 - p.y * 0.8 }])
    );
    // (x, y) → reflected and rotated: check every corner lands on its image.
    const flipped = new Map([...to].map(([n, p]) => [n, { x: p.x, y: -p.y }]));
    for (const target of [to, flipped]) {
      const map = procrustes(from, target, [...from.keys()]);
      for (const [n, p] of from)
        expect(distance(map(p), target.get(n) as Point)).toBeLessThan(1e-9);
    }
  });
});

describe('layoutMap', () => {
  it('gives a two-link player both spots, and leaves out a one-link player', () => {
    const homes = { ...SQUARE, X: { x: 50, y: 160 }, Y: { x: -80, y: -10 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'C-X', 'D-X', 'A-Y']);
    const map = layoutMap(pairs, result(exact(homes, pairs)));
    expect(map.unplaced).toEqual(['Y']);
    expect(map.homes.map((h) => h.name)).toEqual(['A', 'C', 'D', 'B', 'X']);
    expect(map.links).toHaveLength(8);
    const x = map.homes.find((h) => h.name === 'X');
    expect(x?.across).toEqual(['C', 'D']);
    // The spots mirror each other across CD: both at 60 s from C and D's line, on either side.
    const c = map.homes.find((h) => h.name === 'C')?.at as Point;
    const d = map.homes.find((h) => h.name === 'D')?.at as Point;
    const side = (p: Point) => ((d.x - c.x) * (p.y - c.y) - (d.y - c.y) * (p.x - c.x)) / 100;
    expect(side(x?.at as Point)).toBeCloseTo(-side(x?.other as Point), 0);
    expect(Math.abs(side(x?.at as Point))).toBeCloseTo(60, 0);
    // Core homes have one spot.
    expect(map.homes.filter((h) => h.other !== undefined).map((h) => h.name)).toEqual(['X']);
  });

  it('unplaces players left with one pair once others are unplaced', () => {
    // Z reaches the map only through Y, which reaches it through A alone.
    const homes = { ...SQUARE, Y: { x: -80, y: -10 }, Z: { x: -150, y: 30 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'A-Y', 'Y-Z']);
    expect(layoutMap(pairs, result(exact(homes, pairs))).unplaced).toEqual(['Y', 'Z']);
  });

  it('keeps one spot for each corner of a lone triangle', () => {
    const homes = { A: { x: 0, y: 0 }, B: { x: 100, y: 0 }, C: { x: 30, y: 70 } };
    const pairs = measure(homes, ['A-B', 'B-C', 'A-C']);
    const map = layoutMap(pairs, result(exact(homes, pairs)));
    expect(map.homes.every((h) => h.other === undefined)).toBe(true);
  });

  it('gives a core player that two good fits disagree on the other spot', () => {
    const homes = { ...SQUARE, X: { x: 50, y: 160 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'C-X', 'D-X', 'A-X']);
    const elsewhere = { ...homes, X: { x: 50, y: 150 } };
    const map = layoutMap(pairs, result(exact(homes, pairs), exact(elsewhere, pairs, 2)));
    const x = map.homes.find((h) => h.name === 'X');
    // X is in the core it is aligned on, so the gap is a little under the 10 s it was moved.
    expect(distance(x?.at as Point, x?.other as Point)).toBeGreaterThan(AMBIGUOUS_S);
    expect(map.homes.filter((h) => h.other !== undefined).map((h) => h.name)).toEqual(['X']);
  });

  it('aligns the good fits on what they agree on, so that a part folded elsewhere marks itself only', () => {
    const homes = { ...SQUARE, X: { x: 50, y: 160 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'C-X', 'D-X', 'A-X']);
    // A fit with X 120 s away would pull an alignment on all five off for the square too.
    const folded = { ...homes, X: { x: 50, y: 40 - 120 } };
    const map = layoutMap(pairs, result(exact(homes, pairs), exact(folded, pairs, 2)));
    expect(map.homes.filter((h) => h.other !== undefined).map((h) => h.name)).toEqual(['X']);
  });

  it('unplaces two players hinged on one, which good fits put anywhere around it', () => {
    const homes = { ...SQUARE, Y: { x: -80, y: -10 }, Z: { x: -60, y: 60 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'A-Y', 'A-Z', 'Y-Z']);
    // The same triangle, swung around A by 90°.
    const swung = { ...homes, Y: { x: 10, y: -80 }, Z: { x: -60, y: -60 } };
    const map = layoutMap(pairs, result(exact(homes, pairs), exact(swung, pairs, 2)));
    expect(map.unplaced).toEqual(['Y', 'Z']);
    expect(map.links).toHaveLength(6);
  });

  it('centres the first map on the core, its two best-measured players along +x', () => {
    const homes = { ...SQUARE, X: { x: 50, y: 160 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'C-X', 'D-X', 'A-X', 'B-X']);
    const map = layoutMap(pairs, result(exact(homes, pairs)));
    // Every home has 4 pairs: A and B, by name, lie along +x.
    const at = (n: string) => map.homes.find((h) => h.name === n)?.at as Point;
    expect(at('A').y).toBeCloseTo(at('B').y, 5);
    expect(at('B').x).toBeGreaterThan(at('A').x);
    const all = map.homes.map((h) => h.at);
    expect(all.reduce((s, p) => s + p.x, 0) / all.length).toBeCloseTo(0, 0);
    expect(all.reduce((s, p) => s + p.y, 0) / all.length).toBeCloseTo(0, 0);
  });

  it(
    'keeps the previous orientation in a refit with one more pair',
    () => {
      const { homes, pairs } = syntheticHomes(3, 12);
      const first = layoutMap(pairs, fitHomes(pairs));
      // A previous map turned by 90° and mirrored, so that the rule alone would not give it back.
      const turn = (p: Point): Point => ({ x: p.y, y: p.x });
      const previous = {
        ...first,
        homes: first.homes.map((h) => ({ ...h, at: turn(h.at) })),
      };
      const p0 = homes.get('P0') as Point;
      const p11 = homes.get('P11') as Point;
      const more = [...pairs, { a: 'P0', b: 'P11', d: Math.floor(distance(p0, p11)) }];
      const again = layoutMap(more, fitHomes(more), previous);
      const fixed = again.homes.filter((h) => h.other === undefined);
      expect(fixed.length).toBeGreaterThan(8);
      for (const h of fixed) {
        const before = previous.homes.find((x) => x.name === h.name);
        expect(distance(h.at, before?.at as Point)).toBeLessThan(2);
      }
    },
    FULL_FIT_TIMEOUT
  );
});

describe('fixedOnly', () => {
  it('keeps the fixed homes, and lists a home with two spots among the unplaced', () => {
    const homes = { ...SQUARE, X: { x: 50, y: 160 }, Y: { x: -80, y: -10 } };
    const pairs = measure(homes, [...SQUARE_LINKS, 'C-X', 'D-X', 'A-Y']);
    const map = fixedOnly(layoutMap(pairs, result(exact(homes, pairs))));
    expect(map.homes.map((h) => h.name)).toEqual(['A', 'C', 'D', 'B']);
    expect(map.unplaced).toEqual(['X', 'Y']);
    expect(map.links).toHaveLength(6);
  });
});
