/**
 * A player's stats at @LoreGameBot, as `loregame-state` holds them now (docs/game-bots.md §6.1):
 * seeded by their last profile (src/profile.ts), each stat then moved by the commands the parser
 * reads (a turn, a training, a level-up), each with whether it is still exact and when it last
 * changed. The next profile is checked against them: a stat held exactly that the profile says
 * otherwise is a mismatch (`StatDrift`), and the profile seeds them again. Pure.
 *
 * A stat no command read moves (the equipment, the skills, …) is expected to stay as the profile
 * said, exactly: a mismatch then tells of a command the parser does not read yet.
 */

/** A stat now: its value, whether every change since the profile was seen, and when it changed. */
export interface Stat {
  value: unknown;
  exact: boolean;
  as_of: string;
}

export type Stats = Record<string, Stat>;

/** A stat held exactly that the next profile said otherwise. */
export interface StatDrift {
  stat: string;
  expected: unknown;
  said: unknown;
  at: string;
}

/** The mismatches kept per player, newest last. */
export const STATS_DRIFT_KEPT = 10;

/** A profile's stats, as the state keeps a profile (its effects with when they end). */
export const STATS = [
  'level',
  'xp',
  'episode',
  'coins',
  'location',
  'company',
  'alignment',
  'recipes',
  'obsession',
  'equipment',
  'skills',
  'effects',
  'titles',
] as const;

/** The stats a profile gives, exact, as of `at`. */
export function statsOf(profile: Record<string, unknown>, at: string): Stats {
  return Object.fromEntries(
    STATS.map((s) => [s, { value: structuredClone(profile[s] ?? null), exact: true, as_of: at }])
  );
}

/**
 * `stat` moved at `at`: its new value from the old (`f`), and still exact only if `known` (the
 * change is all of it). No stat before a profile: nothing to move.
 */
export function move(
  stats: Stats,
  stat: string,
  f: (value: unknown) => unknown,
  known: boolean,
  at: string
): Stats {
  const was = Object.hasOwn(stats, stat) ? stats[stat] : undefined;
  if (was === undefined) return stats;
  return { ...stats, [stat]: { value: f(was.value), exact: was.exact && known, as_of: at } };
}

/** `stat` set to `value` (as the bot said, exact), or left inexact with it. */
export function set(stats: Stats, stat: string, value: unknown, exact: boolean, at: string): Stats {
  if (!Object.hasOwn(stats, stat)) return stats;
  return { ...stats, [stat]: { value, exact, as_of: at } };
}

/** JSON with its keys sorted: two values that say the same, the same text. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x !== null && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : x
  );
}

/**
 * The effects a stat compares: their names, those not ended by `t` (an effect's end is the time
 * left the profile stated, to the second, so ends are not compared, only which still hold).
 */
function holding(effects: unknown, t: number): string[] {
  if (!Array.isArray(effects)) return [];
  return (effects as { name: string; until: string | null }[])
    .filter((e) => e.until === null || Date.parse(e.until) > t)
    .map((e) => e.name)
    .sort();
}

/** The stats held exactly that a new profile's (`said`, at `t`) say otherwise. */
export function mismatches(expected: Stats, said: Stats, t: number, at: string): StatDrift[] {
  const found: StatDrift[] = [];
  for (const stat of STATS) {
    const e = Object.hasOwn(expected, stat) ? expected[stat] : undefined;
    const s = Object.hasOwn(said, stat) ? said[stat] : undefined;
    if (e === undefined || s === undefined || !e.exact) continue;
    const [a, b] =
      stat === 'effects'
        ? [holding(e.value, t), holding(s.value, t)]
        : [e.value ?? null, s.value ?? null];
    if (canonical(a) !== canonical(b)) found.push({ stat, expected: a, said: b, at });
  }
  return found;
}
