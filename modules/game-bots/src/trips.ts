/**
 * A trip at @LoreGameBot, planned before it is made (docs/game-bots.md §5.9): the way from where a
 * player is to a place, and what each step of it takes, as `loregame-state` knows the places, the
 * player's level, effects and inventory now. Pure.
 *
 * The game's rules, as the exports show them [M]:
 *
 * - **Each place entered takes its items**, one each, whichever way one comes, up or down; the bot
 *   refuses a player who lacks one (or the level), going down too. A place's items change as the
 *   players generate (a requirement added for a faction's place), so each is as last told.
 * - **A guardian asked** ("Almeno un guardiano [generato da] [<code>]") is a condition the state
 *   cannot check yet: a step that asks one is not known to be open.
 * - **The ladders:** each place leads to the next and the one before of its own ladder (`M3` to
 *   `M2` and `M4`); some neutral places (`N1`, `N2`, …) to the same step of the factions' ladders.
 *   The exits the bot lists (`/v`) are kept; a ladder's next step is assumed where none were told.
 * - **A neutral place** is open to a faction's player only while "Neutralizzato" lasts (a ticket).
 */
import { inventoryOfPlayer, type LoreState, placesOf, statOf } from '#src/loregame-state.ts';
import { ladderOf, NEUTRAL_EFFECT } from '#src/places.ts';

/** An item a step takes, as the place lists it. */
export type TripItem = LoreState['places'][string]['items'][number];

/** A step of a trip: a place entered, and what entering it takes of the player. */
export interface TripStep {
  code: string;
  name: string | null;
  /** When its requirements were last told; none if never (what it takes is then unknown). */
  as_of: string | null;
  level: number | null;
  /** The player's level is enough; none if either is unknown. */
  level_ok: boolean | null;
  /** The items it takes, one each. */
  takes: TripItem[];
  /** Of those, the ones the player is known not to hold (the steps before taken theirs). */
  missing: TripItem[];
  /** Of those, the ones the state cannot tell they hold (an inventory not listed, or not exact). */
  unsure: TripItem[];
  /** The places a guardian of theirs must come from: not checked. */
  guardians: string[];
  /** A neutral place entered from a faction's: "Neutralizzato" must hold. */
  neutral: boolean;
  /** It holds; none if not a neutral step, or their effects are not known. */
  neutral_ok: boolean | null;
}

/** A trip planned: its way, its steps, and whether it can be made. */
export interface Trip {
  player: string | null;
  /** Where the player is (their `location`); none if not known. */
  from: string | null;
  to: string;
  /** The places on the way, `to` last; just `to` when the way is not known. */
  route: string[];
  /** A way through the places known was found (or `to` is next to `from`). */
  routed: boolean;
  steps: TripStep[];
  /** Every step is known open; false when one is known closed; none when it cannot be told. */
  ok: boolean | null;
}

/** The places next to `code`: its exits as told, and its ladder's next and previous steps. */
function neighbours(places: LoreState['places'], code: string, to: string): string[] {
  const told = Object.hasOwn(places, code) ? (places[code]?.exits ?? []).map((x) => x.code) : [];
  const step = ladderOf(code);
  const ladder =
    step === undefined
      ? []
      : [`${step.ladder}${step.step - 1}`, `${step.ladder}${step.step + 1}`].filter(
          (c) => c !== `${step.ladder}0` && (c === to || Object.hasOwn(places, c))
        );
  return [...new Set([...told, ...ladder])];
}

/** The shortest way from `from` to `to` through the places known, `to` last; none if there is none. */
function route(places: LoreState['places'], from: string, to: string): string[] | undefined {
  if (from === to) return [];
  const back = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift() as string;
    for (const next of neighbours(places, at, to)) {
      if (back.has(next)) continue;
      back.set(next, at);
      if (next === to) {
        const way = [to];
        for (let c = at; c !== from; c = back.get(c) as string) way.unshift(c);
        return way;
      }
      queue.push(next);
    }
  }
  return undefined;
}

/**
 * The trip of a player (the owner unless named) to the place `to` (its code), at `now`: its way
 * from where they are, and each step's level, items, guardians and neutrality checked against what
 * the state holds of them; the items one step takes are not there for the next.
 */
export function tripOf(s: LoreState, to: string, now: number, player?: string): Trip {
  const places = placesOf(s);
  const name = player ?? s.owner.name;
  const stat = (path: string) => (name === null ? null : statOf(s, path, name));
  const here = stat('location')?.value as { code?: unknown } | null | undefined;
  const from = typeof here?.code === 'string' ? here.code : null;
  const way = from === null ? undefined : route(places, from, to);
  const level = stat('level')?.value;
  const effects = stat('effects');
  const neutralized =
    effects === null
      ? null
      : (Array.isArray(effects.value)
          ? (effects.value as { name: string; until: string | null }[])
          : []
        ).some((f) => f.name === NEUTRAL_EFFECT && (f.until === null || Date.parse(f.until) > now));
  const inv = name === null ? null : inventoryOfPlayer(s, player);
  const used = new Map<string, number>();
  let prev = from;
  const steps = (way ?? [to]).map((code): TripStep => {
    const place = Object.hasOwn(places, code) ? places[code] : undefined;
    const known = place !== undefined && place.as_of !== '' ? place : undefined;
    const takes = known?.items ?? [];
    const missing: TripItem[] = [];
    const unsure: TripItem[] = [];
    for (const item of takes) {
      const h =
        inv === null || !Object.hasOwn(inv.items, item.item) ? undefined : inv.items[item.item];
      const left = (h?.qty ?? 0) - (used.get(item.item) ?? 0);
      used.set(item.item, (used.get(item.item) ?? 0) + 1);
      const sure = h === undefined ? inv !== null && inv.listed !== null : h.exact;
      if (left >= 1 && (h?.exact ?? false)) continue;
      (sure ? missing : unsure).push(item);
    }
    const neutral =
      ladderOf(code)?.ladder === 'N' && (prev === null || ladderOf(prev)?.ladder !== 'N');
    prev = code;
    const asks = known?.level ?? null;
    return {
      code,
      name: place?.name ?? null,
      as_of: known?.as_of ?? null,
      level: asks,
      level_ok: asks === null || typeof level !== 'number' ? null : level >= asks,
      takes,
      missing,
      unsure,
      guardians: known?.guardians ?? [],
      neutral,
      neutral_ok: neutral ? neutralized : null,
    };
  });
  const closed = steps.some(
    (t) => t.level_ok === false || t.missing.length > 0 || t.neutral_ok === false
  );
  const unknown =
    way === undefined ||
    steps.some(
      (t) =>
        t.as_of === null ||
        t.level_ok === null ||
        t.unsure.length > 0 ||
        t.guardians.length > 0 ||
        (t.neutral && t.neutral_ok === null)
    );
  return {
    player: name,
    from,
    to,
    route: way ?? [to],
    routed: way !== undefined,
    steps,
    ok: closed ? false : unknown ? null : true,
  };
}
