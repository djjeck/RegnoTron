/**
 * How far a player can climb at @LoreGameBot now (docs/game-bots.md §5.9, §6): from where they are,
 * up their faction's ladder, a step at a time, as far as their level, the guardians made and their
 * inventory let them, each step's items taken from a copy of it. Pure.
 *
 * - **Their ladder** is their faction's (`Bene` → `B`, `Male` → `M`, `Neutrale` → `N`), from their
 *   profile's `alignment`; **where they are** is their `location`.
 * - **On their ladder,** at step `s` (maybe below the highest they ever entered: players go down to
 *   play a lower place's turns), they walk up from `s`: each step entered again takes its items
 *   again [M], so a player who spent their items is stuck below where they were.
 * - **Off it** (a faction's player on the neutral ladder, with a ticket), they walk back first: the
 *   shortest way, through the exits the bot listed (`/v`) and the neutral ladder's steps, to a
 *   place of their own ladder (`N1` → `B1`, `N2` → `B2`; `N3` through `N2`). Each place on the way
 *   is entered as any other. Neutrality is not checked (when it ends, the bot throws them out to
 *   their own ladder anyway); a neutral place asks no guardian of a faction's player [M].
 * - **Each step's entry:** the place's level against their profile's (**not checked when theirs is
 *   unknown**: the level is known of few players, and where they stand already bounds it; a place
 *   whose level was never told, an arrival's alone, is taken to ask its step's, as every place told
 *   does [M]), each
 *   guardian it asks made (by anyone), and its items, one each, from the copy of their inventory.
 * - **It stops** at the first step they cannot enter (`next`, with what they lack), at the top of
 *   the ladder as far as the state knows its places (no `next`), or on something unknown
 *   (`unknown`): the step's requirements never told, a guardian not known made or not, or no way
 *   back to their ladder.
 */
import {
  guardianMade,
  inventoryOfPlayer,
  type LoreState,
  placesOf,
  statOf,
} from '#src/loregame-state.ts';
import { ladderOf } from '#src/places.ts';
import { type TripItem } from '#src/trips.ts';

/** The ladder of each faction, as the profile names it. */
const LADDERS: Readonly<Record<string, string>> = { Bene: 'B', Male: 'M', Neutrale: 'N' };

/** Why a walk could not be told to its end. */
export type ReachUnknown =
  'player' | 'alignment' | 'location' | 'way back' | 'requirements' | 'guardian';

/** The step a walk stopped at: what entering it takes that the player would lack. */
export interface ReachNext {
  code: string;
  name: string | null;
  /** The level it asks: as told, else its step's (`level_told` false). */
  level: number;
  level_told: boolean;
  /** Their level is enough; none if either is unknown. */
  level_ok: boolean | null;
  /** The items it takes that they would lack after the walk, one entry per item missing. */
  lacking: TripItem[];
  /** Of those, the ones the state cannot be sure they lack (an inventory not listed, or not exact). */
  unsure: TripItem[];
  /** The guardians it asks that are known not made. */
  guardians: string[];
}

/** How far a player can climb now. */
export interface Reach {
  player: string | null;
  /** Their faction's ladder (`B`, `M`, `N`); none if their alignment is not known. */
  ladder: string | null;
  /** Where they are; none if not known. */
  from: string | null;
  /** Their profile's level; none if not known (no step's level is checked then). */
  level: number | null;
  /** The places the walk enters, in order: the way back to their ladder, then up it. */
  path: string[];
  /** K: the highest step of their ladder they can be at now; none if they cannot get back to it. */
  reached: { code: string; step: number } | null;
  /** K + 1, where the walk stopped, if a place is known there (or the step back it stopped at). */
  next: ReachNext | null;
  /** The ladder has no place above K that the state knows of. */
  top: boolean;
  /** Why the walk stopped short of telling; none when it is told. */
  unknown: ReachUnknown | null;
  /** The items the walk took that the state does not hold an exact count of. */
  unsure: TripItem[];
}

type Places = LoreState['places'];

/**
 * The shortest way from `from` (off the ladder `own`) to a place of it, through the exits told and
 * each ladder's next and previous steps, its places all known; none if there is none.
 */
function wayBack(places: Places, from: string, own: string): string[] | undefined {
  const back = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift() as string;
    const told = Object.hasOwn(places, at) ? (places[at]?.exits ?? []).map((x) => x.code) : [];
    const step = ladderOf(at);
    const near =
      step === undefined ? [] : [step.step - 1, step.step + 1].map((n) => `${step.ladder}${n}`);
    for (const next of [...told, ...near]) {
      if (back.has(next) || !Object.hasOwn(places, next)) continue;
      back.set(next, at);
      if (ladderOf(next)?.ladder === own) {
        const way = [next];
        for (let c = at; c !== from; c = back.get(c) as string) way.unshift(c);
        return way;
      }
      queue.push(next);
    }
  }
  return undefined;
}

/** How far `player` (the owner unless named) can climb now, as the state knows them. */
export function reachOf(s: LoreState, player?: string): Reach {
  const places = placesOf(s);
  const name = player ?? s.owner.name;
  const stat = (path: string) => (name === null ? null : statOf(s, path, name));
  const alignment = stat('alignment')?.value;
  const ladder = typeof alignment === 'string' ? (LADDERS[alignment] ?? null) : null;
  const here = stat('location')?.value as { code?: unknown } | null | undefined;
  const from = typeof here?.code === 'string' ? here.code : null;
  const lv = stat('level')?.value;
  const level = typeof lv === 'number' ? lv : null;
  const reach: Reach = {
    player: name,
    ladder,
    from,
    level,
    path: [],
    reached: null,
    next: null,
    top: false,
    unknown: null,
    unsure: [],
  };
  if (name === null) return { ...reach, unknown: 'player' };
  if (ladder === null) return { ...reach, unknown: 'alignment' };
  const at = from === null ? undefined : ladderOf(from);
  if (from === null || at === undefined) return { ...reach, unknown: 'location' };

  // A copy of their inventory, taken from as the walk enters each place.
  const inv = inventoryOfPlayer(s, name);
  const left = new Map<string, { qty: number; exact: boolean }>(
    Object.entries(inv?.items ?? {}).map(([n, h]) => [n, { qty: h.qty, exact: h.exact }])
  );
  const listed = inv !== null && inv.listed !== null;

  /** Enters `code`: true if it can, else the walk's end is set. */
  const enter = (code: string): boolean => {
    const place = Object.hasOwn(places, code) ? places[code] : undefined;
    if (place?.requirements_as_of == null) {
      reach.unknown = 'requirements';
      reach.next = {
        code,
        name: place?.name ?? null,
        level: ladderOf(code)?.step as number,
        level_told: false,
        level_ok: null,
        lacking: [],
        unsure: [],
        guardians: [],
      };
      return false;
    }
    const asks = place.level ?? (ladderOf(code)?.step as number);
    const level_ok = level === null ? null : level >= asks;
    const told = { level: asks, level_told: place.level !== null };
    // A neutral place asks no guardian of a faction's player [M].
    const asked = ladderOf(code)?.ladder === 'N' && ladder !== 'N' ? [] : place.guardians;
    const made = asked.map((g) => [g, guardianMade(s, g)] as const);
    const lacking: TripItem[] = [];
    const unsure: TripItem[] = [];
    const took: TripItem[] = [];
    const after = new Map(left);
    for (const item of place.items) {
      const h = after.get(item.item);
      if (h !== undefined && h.qty >= 1) {
        after.set(item.item, { ...h, qty: h.qty - 1 });
        if (!h.exact) took.push(item);
        continue;
      }
      lacking.push(item);
      // Sure they lack it: a count held exactly, or a listing that named none of it.
      if (!(h === undefined ? listed : h.exact)) unsure.push(item);
    }
    const guardians = made.filter(([, m]) => m === false).map(([g]) => g);
    if (level_ok === false || lacking.length > 0 || guardians.length > 0) {
      reach.next = {
        code,
        name: place.name,
        ...told,
        level_ok,
        lacking,
        unsure,
        guardians,
      };
      return false;
    }
    if (made.some(([, m]) => m === null)) {
      reach.unknown = 'guardian';
      reach.next = {
        code,
        name: place.name,
        ...told,
        level_ok,
        lacking,
        unsure,
        guardians,
      };
      return false;
    }
    for (const [n, h] of after) left.set(n, h);
    reach.unsure.push(...took);
    reach.path.push(code);
    return true;
  };

  let step = at.step;
  if (at.ladder !== ladder) {
    const way = wayBack(places, from, ladder);
    if (way === undefined) return { ...reach, unknown: 'way back' };
    for (const code of way) if (!enter(code)) return reach;
    step = ladderOf(way[way.length - 1] as string)?.step as number;
  }
  reach.reached = { code: `${ladder}${step}`, step };
  for (;;) {
    const code = `${ladder}${step + 1}`;
    if (!Object.hasOwn(places, code)) return { ...reach, top: true };
    if (!enter(code)) return reach;
    step += 1;
    reach.reached = { code, step };
  }
}
