/**
 * What a fit of the homes (fit.ts) tells for certain, oriented for drawing (docs/game-rules.md
 * §2.2). Distances fix a map only up to rotation and reflection, and fix a home only if enough
 * pairs reach it:
 *
 * - A player with fewer than 2 pairs to the placed players is unplaced: a circle of spots fits.
 *   Removing one can leave another with fewer, so this repeats until none is left.
 * - A player with exactly 2, to A and B, has two spots, mirror images across the line AB (the
 *   circles' intersections), unless A and B are all the rest of the map.
 * - The others, the core, are fixed when the plane is over-determined, and the check is
 *   empirical: every good fit is aligned to the best on the core players they agree on, and a
 *   core player found more than `AMBIGUOUS_S` away in some good fit has two spots too, the other
 *   one from that fit. A
 *   two-link player found away from both its spots (two players hinged on one) is unplaced.
 *
 * Orientation: the first map is centred on the core's centroid, with the core's two players with
 * the most pairs along +x; a later map is aligned to the previous one on the core players they share,
 * so that it does not spin or flip between refits.
 */
import { type Distance, type FitResult, type Point } from './fit.ts';

/** How far apart, in seconds, two good fits may put a core player before it counts as ambiguous. */
export const AMBIGUOUS_S = 2;

export interface Home {
  name: string;
  /** Measured pairs, placed players or not. */
  pairs: number;
  at: Point;
  /** The other spot that fits as well, if any. */
  other?: Point;
  /** For a two-link player, the two players it is measured to, whose line mirrors its spots. */
  across?: [string, string];
}

export interface MapLayout {
  /** Placed homes, most pairs first, then by name. */
  homes: Home[];
  /** Players with too few pairs to place, by name. */
  unplaced: string[];
  /** The measured pairs between placed homes. */
  links: [string, string][];
  /** The fit's largest error, in seconds. */
  maxError: number;
}

export function layoutMap(
  pairs: readonly Distance[],
  fit: FitResult,
  previous?: MapLayout
): MapLayout {
  const degree = new Map<string, number>();
  for (const { a, b } of pairs) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  // Prune the players reached by fewer than 2 pairs among those left.
  const placed = new Set(degree.keys());
  for (let pruned = true; pruned;) {
    pruned = false;
    for (const n of placed)
      if (pairs.filter((p) => linksTo(p, n) && placed.has(other(p, n))).length < 2) {
        placed.delete(n);
        pruned = true;
      }
  }
  const linksOf = (n: string): Distance[] =>
    pairs.filter((p) => linksTo(p, n) && placed.has(other(p, n)));
  const core = [...placed].filter((n) => linksOf(n).length >= 3);
  const best = fit.best.positions;

  const homes: Home[] = [];
  for (const name of placed) {
    const home: Home = { name, pairs: degree.get(name) ?? 0, at: { ...(best.get(name) as Point) } };
    const links = linksOf(name);
    if (links.length === 2 && placed.size > 3) {
      const [l1, l2] = links as [Distance, Distance];
      const a = other(l1, name);
      const b = other(l2, name);
      const spots = circleIntersections(best.get(a) as Point, l1.d, best.get(b) as Point, l2.d);
      if (spots !== undefined) {
        const [s1, s2] = spots;
        const near = dist(s1, home.at) <= dist(s2, home.at);
        home.at = near ? s1 : s2;
        home.other = near ? s2 : s1;
        home.across = a < b ? [a, b] : [b, a];
      }
    }
    homes.push(home);
  }

  // The empirical check: where else the other good fits put each player.
  if (core.length >= 2)
    for (const f of fit.good) {
      if (f === fit.best) continue;
      const align = consensusProcrustes(f.positions, best, core);
      for (const home of homes) {
        const there = align(f.positions.get(home.name) as Point);
        const away = dist(there, home.at);
        if (away <= AMBIGUOUS_S) continue;
        if (home.across === undefined) {
          if (home.other === undefined || away > dist(home.other, home.at)) home.other = there;
        } else if (dist(there, home.other as Point) > AMBIGUOUS_S) placed.delete(home.name);
      }
    }
  const kept = homes.filter((h) => placed.has(h.name));

  // Orientation.
  const shared =
    previous === undefined
      ? []
      : core.filter((n) => previous.homes.some((h) => h.name === n && h.other === undefined));
  let orient: (p: Point) => Point;
  if (previous !== undefined && shared.length >= 2) {
    const before = new Map(previous.homes.map((h) => [h.name, h.at]));
    orient = procrustes(best, before, shared);
  } else orient = firstOrientation(best, core.length >= 2 ? core : [...placed], degree);
  for (const home of kept) {
    home.at = round(orient(home.at));
    if (home.other !== undefined) home.other = round(orient(home.other));
  }

  kept.sort((x, y) => y.pairs - x.pairs || cmp(x.name, y.name));
  return {
    homes: kept,
    unplaced: [...degree.keys()].filter((n) => !placed.has(n)).sort(cmp),
    links: pairs
      .filter((p) => placed.has(p.a) && placed.has(p.b))
      .map((p): [string, string] => (p.a < p.b ? [p.a, p.b] : [p.b, p.a]))
      .sort((x, y) => cmp(x.join(' '), y.join(' '))),
    maxError: fit.best.maxError,
  };
}

/**
 * Centred on the centroid of `names`, rotated so that the two of them with the most pairs (then by
 * name) lie along +x, the first to the left.
 */
function firstOrientation(
  positions: ReadonlyMap<string, Point>,
  names: readonly string[],
  degree: ReadonlyMap<string, number>
): (p: Point) => Point {
  if (names.length === 0) return (p) => p;
  const c = centroid(names.map((n) => positions.get(n) as Point));
  const [first, second] = [...names].sort(
    (x, y) => (degree.get(y) ?? 0) - (degree.get(x) ?? 0) || cmp(x, y)
  );
  if (second === undefined) return (p) => ({ x: p.x - c.x, y: p.y - c.y });
  const p1 = positions.get(first as string) as Point;
  const p2 = positions.get(second) as Point;
  const angle = -Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (p) => {
    const x = p.x - c.x;
    const y = p.y - c.y;
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  };
}

/**
 * `procrustes` on the players two fits agree on. Each triple of `names` gives an alignment; the one
 * that the most of `names` agree with (within `AMBIGUOUS_S`) is aligned again on those. A part of
 * the map that a fit folds elsewhere would otherwise pull the alignment of everyone else with it,
 * or even flip it.
 */
function consensusProcrustes(
  from: ReadonlyMap<string, Point>,
  to: ReadonlyMap<string, Point>,
  names: readonly string[]
): (p: Point) => Point {
  if (names.length <= 3) return procrustes(from, to, names);
  const agree = (align: (p: Point) => Point): string[] =>
    names.filter((n) => dist(align(from.get(n) as Point), to.get(n) as Point) <= AMBIGUOUS_S);
  let best: string[] = [];
  for (let i = 0; i < names.length && best.length < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let k = j + 1; k < names.length; k++) {
        const on = agree(procrustes(from, to, [names[i], names[j], names[k]] as string[]));
        if (on.length > best.length) best = on;
      }
  return procrustes(from, to, best.length >= 3 ? best : names);
}

/**
 * The rotation and optional reflection (2D Procrustes, in complex numbers) that best maps `from`
 * onto `to` on the given names, both centred: rot = exp(i · arg Σ conj(z) · w), with z or conj(z),
 * whichever leaves the smaller residual.
 */
export function procrustes(
  from: ReadonlyMap<string, Point>,
  to: ReadonlyMap<string, Point>,
  names: readonly string[]
): (p: Point) => Point {
  const cz = centroid(names.map((n) => from.get(n) as Point));
  const cw = centroid(names.map((n) => to.get(n) as Point));
  const zs = names.map((n) => sub(from.get(n) as Point, cz));
  const ws = names.map((n) => sub(to.get(n) as Point, cw));
  let best: { residual: number; map: (p: Point) => Point } | undefined;
  for (const mirror of [false, true]) {
    const flip = (p: Point): Point => (mirror ? { x: p.x, y: -p.y } : p);
    // Σ conj(z) · w
    let re = 0;
    let im = 0;
    zs.forEach((z0, i) => {
      const z = flip(z0);
      const w = ws[i] as Point;
      re += z.x * w.x + z.y * w.y;
      im += z.x * w.y - z.y * w.x;
    });
    const len = Math.hypot(re, im) || 1;
    const rot = { x: re / len, y: im / len };
    const map = (p: Point): Point => {
      const z = flip(sub(p, cz));
      return { x: z.x * rot.x - z.y * rot.y + cw.x, y: z.x * rot.y + z.y * rot.x + cw.y };
    };
    const residual = names.reduce(
      (s, n) => s + dist(map(from.get(n) as Point), to.get(n) as Point) ** 2,
      0
    );
    if (best === undefined || residual < best.residual - 1e-9) best = { residual, map };
  }
  return (best as { map: (p: Point) => Point }).map;
}

/**
 * The two points at distance `dA` from A and `dB` from B: with L = |B − A|, u = (B − A) / L,
 * t = (dA² − dB² + L²) / 2L and h = √max(dA² − t², 0), they are A + u·t ± u⊥·h. None if A = B.
 */
export function circleIntersections(
  A: Point,
  dA: number,
  B: Point,
  dB: number
): [Point, Point] | undefined {
  const L = dist(A, B);
  if (L === 0) return undefined;
  const u = { x: (B.x - A.x) / L, y: (B.y - A.y) / L };
  const t = (dA * dA - dB * dB + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(dA * dA - t * t, 0));
  const m = { x: A.x + u.x * t, y: A.y + u.y * t };
  return [
    { x: m.x - u.y * h, y: m.y + u.x * h },
    { x: m.x + u.y * h, y: m.y - u.x * h },
  ];
}

const linksTo = (p: Distance, n: string): boolean => p.a === n || p.b === n;
const other = (p: Distance, n: string): string => (p.a === n ? p.b : p.a);
const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);
const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y });
const round = (p: Point): Point => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

function centroid(points: readonly Point[]): Point {
  const n = points.length || 1;
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

/**
 * The map as `/map` draws it: only the homes the times fix. A home with two spots, mirrored or
 * left apart by the good fits, waits among the unplaced for the trips that settle it.
 */
export function fixedOnly(layout: MapLayout): MapLayout {
  const fixed = layout.homes.filter((h) => h.other === undefined);
  const names = new Set(fixed.map((h) => h.name));
  return {
    homes: fixed,
    unplaced: [
      ...layout.unplaced,
      ...layout.homes.filter((h) => !names.has(h.name)).map((h) => h.name),
    ].sort(cmp),
    links: layout.links.filter(([a, b]) => names.has(a) && names.has(b)),
    maxError: layout.maxError,
  };
}
