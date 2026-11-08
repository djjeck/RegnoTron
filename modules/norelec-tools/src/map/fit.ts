/**
 * Fits the players' homes to a plane from the travel times between them (docs/game-rules.md §2.2):
 * stochastic stress minimisation. Each home starts at a random point of a 300 × 300 × 300 s cube;
 * each pass moves both ends of every pair along their line, towards the measured time, by a rate
 * that falls over the passes. The third axis is squeezed linearly to nothing over the first half of
 * the passes: a fit made in the plane alone folds part of the map over itself and stays there (on
 * sparse random graphs, 7% of seeds reached the true map), while through the third axis the fold
 * can open (30%). One run can still stop in a local minimum, so `fitHomes` runs several seeds and
 * keeps the best. Positions are in seconds of travel without rockets.
 */
import { Rng } from '@megabottron1999/core/rng.ts';

export interface Point {
  x: number;
  y: number;
}

/** A measured distance between two homes, in seconds. */
export interface Distance {
  a: string;
  b: string;
  d: number;
}

export interface Fit {
  seed: number;
  positions: Map<string, Point>;
  /** The largest and the median of |fitted − measured| over the pairs, in seconds. */
  maxError: number;
  medianError: number;
}

export const PASSES = 20_000;
/** The passes over which the third axis is squeezed to nothing. */
const FLATTEN = PASSES / 2;
const CUBE = 300;

interface Point3 extends Point {
  z: number;
}

/** One seeded run. */
export function fitOnce(pairs: readonly Distance[], seed: number): Fit {
  const names = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
  const rng = new Rng(seed);
  const pos = new Map<string, Point3>(
    names.map((n) => [n, { x: rng.next() * CUBE, y: rng.next() * CUBE, z: rng.next() * CUBE }])
  );
  const points = [...pos.values()];
  const ends = pairs.map((p) => ({ p: pos.get(p.a) as Point3, q: pos.get(p.b) as Point3, d: p.d }));
  for (let it = 0; it < PASSES; it++) {
    const rate = 0.05 * (1 - it / PASSES) + 0.0005;
    for (const { p, q, d } of ends) {
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const dz = p.z - q.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = (rate * (len - d)) / len / 2;
      p.x -= f * dx;
      p.y -= f * dy;
      p.z -= f * dz;
      q.x += f * dx;
      q.y += f * dy;
      q.z += f * dz;
    }
    // z(it) = z₀ · (1 − it / FLATTEN), then 0.
    const squeeze = it < FLATTEN - 1 ? (FLATTEN - it - 1) / (FLATTEN - it) : 0;
    for (const p of points) p.z *= squeeze;
  }
  const flat = new Map([...pos].map(([n, p]) => [n, { x: p.x, y: p.y }]));
  return { seed, positions: flat, ...errorsOf(flat, pairs) };
}

/** How far fitted positions are from the measured distances. */
export function errorsOf(
  positions: ReadonlyMap<string, Point>,
  pairs: readonly Distance[]
): { maxError: number; medianError: number } {
  const abs = pairs
    .map(({ a, b, d }) => {
      const p = positions.get(a) as Point;
      const q = positions.get(b) as Point;
      return Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - d);
    })
    .sort((x, y) => x - y);
  return { maxError: abs.at(-1) ?? 0, medianError: abs[Math.floor(abs.length / 2)] ?? 0 };
}

export interface FitOptions {
  /** Seeds always run, from 1. */
  minSeeds?: number;
  /** Seeds at most, when fewer than `goodFits` are good. */
  maxSeeds?: number;
  /** How many good fits to look for. */
  goodFits?: number;
  /** The largest error, in seconds, of a good fit: about the bot's rounding down to the second. */
  maxError?: number;
}

export const DEFAULT_FIT = { minSeeds: 12, maxSeeds: 48, goodFits: 4, maxError: 1 };

export interface FitResult {
  /** The fit with the lowest max error. */
  best: Fit;
  /** Every fit within `maxError`, best first. */
  good: Fit[];
  /** Whether the best fit is good, that is, whether the map can be drawn. */
  accepted: boolean;
}

/**
 * Runs seeds 1, 2, … until both `minSeeds` have run and `goodFits` are good, or `maxSeeds` have
 * run, and keeps the best.
 */
export function fitHomes(pairs: readonly Distance[], options: FitOptions = {}): FitResult {
  const o = { ...DEFAULT_FIT, ...options };
  const fits: Fit[] = [];
  let good = 0;
  for (let seed = 1; seed <= o.maxSeeds; seed++) {
    if (seed > o.minSeeds && good >= o.goodFits) break;
    const fit = fitOnce(pairs, seed);
    fits.push(fit);
    if (fit.maxError <= o.maxError) good++;
  }
  fits.sort((x, y) => x.maxError - y.maxError || x.seed - y.seed);
  const best = fits[0] as Fit;
  return {
    best,
    good: fits.filter((f) => f.maxError <= o.maxError),
    accepted: best.maxError <= o.maxError,
  };
}
