import { describe, expect, it } from 'vitest';
import { syntheticHomes as synthetic } from '#test/homes.ts';
import { fitHomes, fitOnce, type Point } from './fit.ts';

// Full fits of several seeds, slow under coverage.
const FULL_FIT_TIMEOUT = 60_000;

describe('fitHomes', () => {
  it(
    'recovers random homes up to rotation and reflection, across graphs',
    () => {
      for (const seed of [1, 2, 3]) {
        const { homes, pairs } = synthetic(seed);
        const r = fitHomes(pairs);
        expect(r.accepted).toBe(true);
        expect(r.best.maxError).toBeLessThanOrEqual(1);
        expect(r.good.length).toBeGreaterThanOrEqual(1);
        // Congruent point sets have the same distances, measured or not. An unmeasured one adds up
        // the roundings of the pairs between its ends, so it can be off by a few seconds.
        const names = [...homes.keys()];
        for (const a of names)
          for (const b of names) {
            const p = homes.get(a) as Point;
            const q = homes.get(b) as Point;
            const f = r.best.positions.get(a) as Point;
            const g = r.best.positions.get(b) as Point;
            expect(
              Math.abs(Math.hypot(f.x - g.x, f.y - g.y) - Math.hypot(p.x - q.x, p.y - q.y))
            ).toBeLessThan(5);
          }
      }
    },
    FULL_FIT_TIMEOUT
  );

  it('refuses times that no plane fits', () => {
    // A triangle that breaks the triangle inequality.
    const pairs = [
      { a: 'A', b: 'B', d: 10 },
      { a: 'B', b: 'C', d: 10 },
      { a: 'A', b: 'C', d: 100 },
    ];
    const r = fitHomes(pairs, { minSeeds: 2, maxSeeds: 3 });
    expect(r.accepted).toBe(false);
    expect(r.good).toEqual([]);
    expect(r.best.maxError).toBeGreaterThan(1);
  });

  it('stops after the minimum of seeds once enough fits are good', () => {
    const pairs = [{ a: 'A', b: 'B', d: 50 }];
    expect(fitHomes(pairs, { minSeeds: 2, goodFits: 1 }).good.map((f) => f.seed)).toEqual([1, 2]);
  });

  it('repeats a seed exactly', () => {
    const { pairs } = synthetic(4, 6);
    expect(fitOnce(pairs, 5).positions).toEqual(fitOnce(pairs, 5).positions);
  });
});
