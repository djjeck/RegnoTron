/**
 * Random homes for the map's tests: points in a 300 × 300 s square, each new one measured to 3
 * earlier ones (from a measured 4-clique), a sparse graph that fixes the plane up to rotation and
 * reflection. Times are rounded down, as the bot shows them.
 */
import { Rng } from '@megabottron1999/core/rng.ts';
import { type Distance, type Point } from '#src/map/fit.ts';

export function syntheticHomes(
  seed: number,
  n = 16
): { homes: Map<string, Point>; pairs: Distance[] } {
  const rng = new Rng(seed * 7919);
  const homes = new Map<string, Point>();
  const pairs: Distance[] = [];
  for (let i = 0; i < n; i++) {
    const name = `P${i}`;
    const home = { x: rng.next() * 300, y: rng.next() * 300 };
    const earlier = [...homes.keys()];
    const links = i < 4 ? earlier : [...earlier].sort(() => rng.next() - 0.5).slice(0, 3);
    for (const other of links)
      pairs.push({ a: other, b: name, d: Math.floor(distance(homes.get(other) as Point, home)) });
    homes.set(name, home);
  }
  return { homes, pairs };
}

export const distance = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y);
