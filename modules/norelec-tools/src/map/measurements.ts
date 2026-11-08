/**
 * The measured travel times between homes (docs/game-rules.md §2.2), from the departures the client
 * sees. A departure always starts from the player's home, so "N parti per X: arrivi tra T" is the
 * time between N's and X's homes; times are symmetric, so a pair is unordered. Pure and
 * serialisable: the map service keeps it in the volume.
 *
 * Rockets: the departure line does not say whether the player carries 🚀 (on IRC it never has the
 * "🚀" form of docs/bot-protocol.md), but each carried 🚀 makes the trip 10% faster (§2.3). So a
 * trip is taken with the rockets its player carried, as the game state last saw them listed next
 * to the name, and its base time is the time shown × (1 + 0.1 × 🚀). A trip of a player whose
 * emoji the state has not seen is left out.
 *
 * Rounding: the bot shows whole seconds, so one pair can show N one time and N + 1 another. A pair
 * keeps the lowest and highest base time seen, and its distance is their midpoint. A trip that
 * would spread them by more than the rounding allows (1 s, or the trip's speed-up of it, 1.2 s with
 * two rockets) means a player has moved (the September mishaps teleported players): every older
 * pair of either player is dropped and the new time is kept. Unless another count of rockets
 * explains it: someone carried one rocket more or less than last seen (bought or used since they
 * were listed). Then the pair stands and the trip is left out, or, if the pair rests on one trip
 * alone, which may be the stale one, the trip replaces it; either way, no other pair is dropped.
 *
 * Traffic: a pair also keeps, each way, the times of the last `ROAD_WINDOW_MS`'s trips that
 * reached their destination (`arrived`, told by the map service), from which `roadLevel` tells
 * how busy the road is that way, for its width on the map.
 */
import { type BotMessage } from '@regnotron/norelec/game/bot-message.ts';
import { CONQUISTER } from '@regnotron/norelec/game/events.ts';
import { emojiKind } from '@regnotron/norelec/game/player.ts';

/** One pair of homes, in seconds of travel without rockets. */
export interface Pair {
  /** The two players, in code-point order. */
  a: string;
  b: string;
  /** The lowest and highest base time seen. */
  lo: number;
  hi: number;
  /** How far apart `lo` and `hi` may be: the largest rounding of the trips taken. */
  slack: number;
  trips: number;
  /** Milliseconds since the epoch of the first and last trip within the spread. */
  first: number;
  last: number;
  /**
   * When the trips of the last `ROAD_WINDOW_MS` that reached their destination arrived: from `a`
   * to `b`, and from `b` to `a`.
   */
  toB: number[];
  toA: number[];
}

/** How far back a road's traffic counts. */
export const ROAD_WINDOW_MS = 3 * 24 * 3_600_000;

/**
 * The trips in the window from which a road is one level busier, from level 0: about ×3.5 apart,
 * as traffic spans 1 to some 200 trips; 40, a quarter of a script's, is the busiest level.
 */
export const ROAD_LEVELS = [3, 10, 40];

/**
 * How busy a road is one way, 0 to `ROAD_LEVELS.length`, from its arrivals (`toB` or `toA`) in
 * the window ending `now`.
 */
export function roadLevel(arrivals: readonly number[], now: number): number {
  const trips = arrivals.filter((t) => t > now - ROAD_WINDOW_MS).length;
  return ROAD_LEVELS.filter((n) => trips >= n).length;
}

/** The arrivals in the window ending `time`, with `time` added. */
const recentWith = (recent: readonly number[], time: number): number[] =>
  [...recent, time].filter((t) => t > time - ROAD_WINDOW_MS).sort((x, y) => x - y);

/** One departure between two homes. */
export interface Trip {
  from: string;
  to: string;
  /** The time the bot showed, and the 🚀 the player carried. */
  seconds: number;
  rockets: number;
  time: number;
}

/** What a trip changed: a repeat within the spread changes no distance; widening it does. */
export type Change =
  | { kind: 'new'; pair: Pair }
  | { kind: 'repeat'; pair: Pair }
  | { kind: 'widened'; pair: Pair }
  /** The time fits the pair with another count of 🚀: the trip is left out. */
  | { kind: 'stale'; pair: Pair }
  /** The same, of a pair of one trip: the trip replaced it. */
  | { kind: 'corrected'; pair: Pair; was: number }
  | { kind: 'moved'; pair: Pair; was: number; dropped: Pair[] };

/** The 🚀 a player carries, as last seen; undefined when their emoji were never listed. */
export type RocketsOf = (player: string) => number | undefined;

/** The 🚀 among carried emoji. */
export const rocketsIn = (carried: readonly (string | null)[]): number =>
  carried.filter((c) => c !== null && emojiKind(c) === '🚀').length;

/** A distance's midpoint, to the tenth of a second. */
export const distanceOf = (p: Pair): number => Math.round(((p.lo + p.hi) / 2) * 10) / 10;

/** The trips between two homes in a bot message: its departures, of players whose 🚀 are known. */
export function tripsIn(m: BotMessage, rocketsOf: RocketsOf): Trip[] {
  const out: Trip[] = [];
  for (const e of m.events) {
    if (e.kind !== 'depart') continue;
    const from = e.player.name;
    const to = e.to.name;
    if (to === CONQUISTER || from === to || e.seconds <= 0) continue;
    // The line's own emoji, when it lists them, else the state's; a 🚀 line has at least one.
    const listed = e.player.carried === undefined ? rocketsOf(from) : rocketsIn(e.player.carried);
    const rockets = e.rocket ? Math.max(1, listed ?? 1) : listed;
    if (rockets === undefined) continue;
    out.push({ from, to, seconds: e.seconds, rockets, time: m.time });
  }
  return out;
}

/** A road's name, one way, in `Measurements.roads`: from, then to. */
export const roadKey = (from: string, to: string): string => `${from} ${to}`;

const keyOf = (x: string, y: string): string => (x < y ? `${x}\n${y}` : `${y}\n${x}`);
const tenth = (v: number): number => Math.round(v * 10) / 10;

export class Measurements {
  private readonly byKey = new Map<string, Pair>();

  constructor(pairs: readonly Pair[] = []) {
    for (const p of pairs) this.byKey.set(keyOf(p.a, p.b), { ...p });
  }

  /** Takes one trip. */
  add(trip: Trip): Change {
    const key = keyOf(trip.from, trip.to);
    const known = this.byKey.get(key);
    const speed = 1 + 0.1 * trip.rockets;
    const base = tenth(trip.seconds * speed);
    if (known !== undefined) {
      const lo = Math.min(known.lo, base);
      const hi = Math.max(known.hi, base);
      const slack = Math.max(known.slack, speed);
      if (hi - lo <= slack + 1e-9) {
        const widened = lo !== known.lo || hi !== known.hi;
        Object.assign(known, { lo, hi, slack, trips: known.trips + 1 });
        known.first = Math.min(known.first, trip.time);
        known.last = Math.max(known.last, trip.time);
        return { kind: widened ? 'widened' : 'repeat', pair: { ...known } };
      }
    }
    if (known !== undefined && known.trips > 1 && fitsWithOtherRockets(known, trip))
      return { kind: 'stale', pair: { ...known } };
    const [a, b] = trip.from < trip.to ? [trip.from, trip.to] : [trip.to, trip.from];
    const pair: Pair = {
      a,
      b,
      lo: base,
      hi: base,
      slack: speed,
      trips: 1,
      first: trip.time,
      last: trip.time,
      toB: [],
      toA: [],
    };
    if (known === undefined) {
      this.byKey.set(key, pair);
      return { kind: 'new', pair: { ...pair } };
    }
    if (fitsWithOtherRockets(known, trip)) {
      this.byKey.set(key, pair);
      return { kind: 'corrected', pair: { ...pair }, was: distanceOf(known) };
    }
    // One of the two has moved, and nothing tells which: neither's older pairs can be trusted.
    const dropped: Pair[] = [];
    for (const [k, p] of this.byKey)
      if (p.a === a || p.b === a || p.a === b || p.b === b) {
        dropped.push(p);
        this.byKey.delete(k);
      }
    this.byKey.set(key, pair);
    return {
      kind: 'moved',
      pair: { ...pair },
      was: distanceOf(known),
      dropped: sortPairs(dropped),
    };
  }

  /**
   * A trip that reached its destination at `time`, for the road's traffic; whether the pair is
   * known (one dropped meanwhile, by a move, is not).
   */
  arrived(from: string, to: string, time: number): boolean {
    const known = this.byKey.get(keyOf(from, to));
    if (known === undefined) return false;
    if (from === known.a) known.toB = recentWith(known.toB, time);
    else known.toA = recentWith(known.toA, time);
    return true;
  }

  /** Every pair, sorted by its players. */
  /**
   * The base time between two homes, in seconds, as well as the trips seen tell it, for timing a
   * trip rather than drawing it: each shown time is rounded down, so the true time is at least the
   * highest seen and less than the lowest plus one rounding (`slack`), and this is the middle of
   * that. Undefined for a pair never seen.
   */
  baseS(a: string, b: string): number | undefined {
    const p = this.byKey.get(keyOf(a, b));
    if (p === undefined) return undefined;
    return Math.max(p.hi, (p.hi + p.lo + p.slack) / 2);
  }

  pairs(): Pair[] {
    return sortPairs([...this.byKey.values()].map((p) => ({ ...p })));
  }

  /**
   * What the map depends on at `now`: each pair, its distance and how busy its road is each way,
   * sorted, one per line. Two sets with the same key give the same map; trips and dates otherwise only
   * change its log line.
   */
  key(now: number): string {
    return this.pairs()
      .map(
        (p) => `${p.a} ${p.b} ${distanceOf(p)} ${roadLevel(p.toB, now)}/${roadLevel(p.toA, now)}`
      )
      .join('\n');
  }

  /** How busy each road is at `now` each way, by `roadKey(from, to)`, the quiet ways left out. */
  roads(now: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.byKey.values()) {
      const toB = roadLevel(p.toB, now);
      const toA = roadLevel(p.toA, now);
      if (toB > 0) out[roadKey(p.a, p.b)] = toB;
      if (toA > 0) out[roadKey(p.b, p.a)] = toA;
    }
    return out;
  }
}

/**
 * Whether `trip` and `pair` agree within the rounding if one of them was taken with one 🚀 more or
 * less than counted (one bought or used since the player's emoji were last listed): the trip, or
 * the pair (as when its one trip was).
 */
function fitsWithOtherRockets(pair: Pair, trip: Trip): boolean {
  const agree = (lo: number, hi: number, base: number, slack: number): boolean =>
    Math.max(hi, base) - Math.min(lo, base) <= slack + 1e-9;
  const now = tenth(trip.seconds * (1 + 0.1 * trip.rockets));
  const counted = Math.round((pair.slack - 1) * 10);
  for (const off of [-1, 1]) {
    const k = trip.rockets + off;
    if (k >= 0 && agree(pair.lo, pair.hi, tenth(trip.seconds * (1 + 0.1 * k)), pair.slack))
      return true;
    // The pair's times taken back to the shown ones, then sped up by one 🚀 more or less.
    const j = counted + off;
    if (pair.trips !== 1 || j < 0) continue;
    const speed = (1 + 0.1 * j) / pair.slack;
    if (agree(tenth(pair.lo * speed), tenth(pair.hi * speed), now, pair.slack)) return true;
  }
  return false;
}

function sortPairs(pairs: Pair[]): Pair[] {
  return pairs.sort((x, y) => (x.a === y.a ? cmp(x.b, y.b) : cmp(x.a, y.a)));
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
