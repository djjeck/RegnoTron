/**
 * The owner's state at @LoreGameBot, as the `loregame-state` plugin keeps it: its schema (the
 * sections the node's panel draws), the state a fresh instance starts from, the events it applies,
 * the reducer, and the freshness each event gives. Pure logic only (the shell's `statePlugin`,
 * docs/bot-os-api.md §5, does the rest).
 *
 * It reads `loregame.turn`, the owner's turns the `loregame` parser publishes (`src/replies.ts`
 * says what an outcome holds). So far:
 *
 * - **The inventory**, an estimate, since nothing here lists it yet (`/zaino` is paginated and
 *   comes later): what a turn gains adds to it, with the count (`2x`), and so does each item a
 *   level-up gives (`levelUp.items`). A holding is `exact: false` until a whole listing says
 *   otherwise. What a turn can take away or move (a `/usa`, a `/dai`) is not read yet, so a count
 *   only ever rises, and is a floor, not the truth.
 * - **A turn cut off** at Telegram's limit (`truncated`) may have gained an item the reply lost: it
 *   changes no count, and marks the inventory `uncertain`.
 *
 * - **The bans**, of every player the parser heard of, the owner's and the group's (src/bans.ts):
 *   `loregame.ban` sets a player's ban with when it ends (`until`; none if the bot does not say),
 *   `loregame.unban` ends it (the bot served them again: it lifts bans early), and one past its end
 *   is dropped at the next event, by that event's time. The state keeps who is banned, not a
 *   history. A ban is the account's, whatever the command: an actor asks `bannedUntil` as it wakes.
 *
 * - **The accumulo** (src/accumulo.ts): the turns taken since it was last emptied, counted here
 *   (`count`), against what the bot says of it: the line a turn carries while it is full, and its
 *   answer to `/accumulo` (`loregame.accumulo`: the bot's own counter, a use, "already ready"). The
 *   count is an estimate, `exact` once the bot's counter or a use has set it; **`ready` is the
 *   bot's word alone**, never the count's. Where the two disagree the state keeps `drift`, and
 *   announces it: the bot's counter is not our count, a full accumulo is announced before (or
 *   not when) we count it so, or it stops being full without a use seen. The bot's word wins.
 *
 * Any other outcome (a "too soon", a fight lost, the item lost) changes nothing: the state records
 * facts, and the parser has already read the reply. An item or a player may be named anything
 * (players write them), `__proto__` included, so both are read and written as own properties.
 */
import { type BusEvent } from '@megabottron1999/core';
import { type Announcement, type Mark } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import { ACCUMULO_MAX } from '#src/accumulo.ts';
import { ACCUMULO_EVENT, BAN_EVENT, LOREGAME_PARSER, UNBAN_EVENT } from '#src/plugins/loregame.ts';

/** The plugin's id, and the namespace of its events (`loregame-state.changed`). */
export const LOREGAME_STATE = 'loregame-state';

/** The parser's events it applies: the owner's turns. */
const TURN_EVENT = `${LOREGAME_PARSER}.turn`;
export const CONSUMES: readonly string[] = [TURN_EVENT, BAN_EVENT, UNBAN_EVENT, ACCUMULO_EVENT];

/** The paths of the state its node's panel draws first, and its card's line. */
export const PINS = ['inventory.held', 'owner.as_of'];

const date = z.string().nullable();

const ban = z.object({
  until: date.describe('Ends (none: the bot did not say)'),
  since: z.string().describe('Told'),
});

/** The disagreements between our count and the bot's word kept, newest last. */
const DRIFT_KEPT = 10;

const driftKinds = ['count', 'early', 'late', 'lapsed', 'not_ready', 'used_early'] as const;

const drift = z.object({
  kind: z.enum(driftKinds).describe('Which signals disagree'),
  at: z.string().describe('Told'),
  counted: z.number().describe('Turns we counted'),
  said: z.number().nullable().describe("The bot's counter, if it gave one"),
  max: z.number().describe('Turns it needs: as the bot said, else the usual'),
});

const accumulo = z.object({
  as_of: date.describe('Latest change'),
  count: z.number().describe('Turns since it was last emptied'),
  exact: z.boolean().describe('Set by the bot, not only counted'),
  max: z.number().nullable().describe('Turns it needs, as the bot said'),
  ready: z.boolean().describe('Full, as the bot said'),
  used_at: date.describe('Last used'),
  locked: z.number().nullable().describe('The level it asks, while the bot refuses it'),
  drift: z.array(drift).describe('Latest disagreements'),
});

const holding = z.object({
  qty: z.number().describe('Count'),
  exact: z.boolean().describe('Exact'),
  date: date.describe('Set'),
  via: z.enum(['drop', 'level-up']).describe('By'),
  rarity: z.string().nullable().describe('Rarity'),
  tags: z.array(z.string()).describe('Tags'),
});

/** The state's schema: its sections, each described for the panel. */
export const stateSchema = z.object({
  owner: z
    .object({
      as_of: date.describe('Latest change'),
      name: z.string().nullable().describe('Name in the bans, once told'),
    })
    .describe('Owner'),
  bans: z.record(z.string(), ban).describe('Banned players'),
  accumulo: accumulo.describe('Accumulo'),
  inventory: z
    .object({
      held: z.number().describe('Items held'),
      items: z.record(z.string(), holding).describe('Items'),
    })
    .describe('Inventory'),
});

export type Holding = z.infer<typeof holding>;
export type Ban = z.infer<typeof ban>;
export type Accumulo = z.infer<typeof accumulo>;
export type Drift = z.infer<typeof drift>;
export type LoreState = z.infer<typeof stateSchema>;

/** The accumulo of a fresh instance: nothing known, none counted. */
export function initialAccumulo(): Accumulo {
  return {
    as_of: null,
    count: 0,
    exact: false,
    max: null,
    ready: false,
    used_at: null,
    locked: null,
    drift: [],
  };
}

/** The state a fresh instance starts from. */
export function initialState(): LoreState {
  return {
    owner: { as_of: null, name: null },
    bans: {},
    accumulo: initialAccumulo(),
    inventory: { held: 0, items: {} },
  };
}

/** What a turn brought into the inventory: one item, how many, and by what. */
interface Gain {
  item: string;
  qty: number;
  rarity: string;
  tags: string[];
  via: Holding['via'];
}

const reward = z.object({
  item: z.string(),
  qty: z.number(),
  rarity: z.string(),
  tags: z.array(z.string()),
});
/** The parts of a turn's outcome the state reads (the parser's `Outcome`, which carries more). */
const outcomeSchema = z.looseObject({
  kind: z.string(),
  reason: z.string().optional(),
  item: z.string().optional(),
  qty: z.number().optional(),
  rarity: z.string().optional(),
  tags: z.array(z.string()).optional(),
  levelUp: z.looseObject({ level: z.number().optional(), items: z.array(reward) }).optional(),
  place: z.looseObject({}).optional(),
  accumulo: z.object({ ready: z.boolean(), sure: z.boolean() }).optional(),
});

function outcomeOf(e: BusEvent): z.infer<typeof outcomeSchema> | undefined {
  const o = outcomeSchema.safeParse(e['outcome']);
  return o.success ? o.data : undefined;
}

/** The items an event gains, none for anything that is not a turn that gave one. */
function gainsOf(e: BusEvent): Gain[] {
  const o = outcomeOf(e);
  if (o === undefined) return [];
  const gains: Gain[] = [];
  if (o.kind === 'gain' && o.item !== undefined && o.item !== '')
    gains.push({
      item: o.item,
      qty: o.qty ?? 1,
      rarity: o.rarity ?? '',
      tags: o.tags ?? [],
      via: 'drop',
    });
  for (const r of o.levelUp?.items ?? []) gains.push({ ...r, via: 'level-up' });
  return gains.filter((g) => g.qty > 0 && g.item !== '');
}

const own = (items: Record<string, Holding>, name: string): Holding | undefined =>
  Object.hasOwn(items, name) ? items[name] : undefined;

/** What a ban or an unban event says (the parser's, `src/plugins/loregame.ts`). */
const banEventSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean().optional(),
  until: z.number().optional(),
});

const asIso = (ms: number): string => new Date(ms).toISOString();

/**
 * The state after an event, as to the bans: a ban set or ended, and every ban that ended by the
 * event's time dropped (the state is a pure function of its events, so time is theirs).
 */
function reduceBans(state: LoreState, e: BusEvent): LoreState {
  const kept = Object.entries(state.bans).filter(
    ([, b]) => b.until === null || Date.parse(b.until) > e.t
  );
  let bans = kept.length === Object.keys(state.bans).length ? state.bans : Object.fromEntries(kept);
  let name = state.owner.name;
  const said = e.type === BAN_EVENT || e.type === UNBAN_EVENT ? banEventSchema.safeParse(e) : null;
  if (said?.success === true) {
    const { player, until } = said.data;
    if (said.data.owner === true) name = player;
    if (e.type === UNBAN_EVENT) {
      if (Object.hasOwn(bans, player))
        bans = Object.fromEntries(Object.entries(bans).filter(([p]) => p !== player));
    } else if (until === undefined || until > e.t) {
      const end = until === undefined ? null : asIso(until);
      if (!Object.hasOwn(bans, player) || bans[player]?.until !== end)
        bans = { ...bans, [player]: { until: end, since: asIso(e.t) } };
    }
  }
  if (bans === state.bans && name === state.owner.name) return state;
  return { ...state, owner: { as_of: asIso(e.t), name }, bans };
}

/** What the bot answered to the owner's `/accumulo` (the parser's `loregame.accumulo`). */
const replySchema = z.looseObject({
  result: z.enum(['short', 'idle', 'used', 'locked']),
  count: z.number().optional(),
  max: z.number().optional(),
  level: z.number().optional(),
});

/**
 * The accumulo with the disagreements it found added, the oldest forgotten. A disagreement that
 * repeats the last of its kind (the same counts, the same maximum) is not news: a player whose
 * Stoccaggio lowers the maximum has the bot's line at 19 against our 20 at every cycle, and says
 * so once.
 */
function withDrift(a: Accumulo, at: string, ...found: Omit<Drift, 'at' | 'max'>[]): Accumulo {
  const max = a.max ?? ACCUMULO_MAX;
  const news = found.filter((d) => {
    const last = a.drift.findLast((x) => x.kind === d.kind);
    return last?.counted !== d.counted || last.said !== d.said || last.max !== max;
  });
  if (news.length === 0) return a;
  return { ...a, drift: [...a.drift, ...news.map((d) => ({ ...d, at, max }))].slice(-DRIFT_KEPT) };
}

/**
 * Whether the bot's counter `said` disagrees with ours: when ours is exact, any other number; when
 * it is only counted from where we started, only a lower one (a count we missed turns of is
 * lower than the truth, never higher).
 */
const disagrees = (a: Accumulo, said: number): boolean =>
  a.exact ? said !== a.count : said < a.count;

/** The accumulo after a turn of the owner's: one more charge, and what the turn says of it. */
function afterTurn(a: Accumulo, e: BusEvent): Accumulo {
  const o = outcomeOf(e);
  // A reply that is no turn (a "too soon", a ban) charges nothing: only a turn has a place.
  if (o?.place === undefined) return a;
  const at = asIso(e.t);
  if (a.locked !== null) {
    // Under the level the accumulo is not charged; the level that reaches it opens it, and that
    // turn charges nothing.
    return o.levelUp?.level !== undefined && o.levelUp.level >= a.locked
      ? { ...a, as_of: at, locked: null, count: 0, exact: false }
      : a;
  }
  const count = a.count + 1;
  const max = a.max ?? ACCUMULO_MAX;
  const charged: Accumulo = { ...a, as_of: at, count };
  // A turn cut off lost the line along with the ending: it says nothing of the accumulo.
  if (o.kind === 'nothing' && o.reason === 'truncated') return charged;
  if (o.accumulo?.sure === true) {
    // Full, the bot says. It tells so before we count it so: the bot's word stands.
    const early = a.exact && !a.ready && count < max;
    return withDrift(
      { ...charged, ready: true },
      at,
      ...(early ? [{ kind: 'early' as const, counted: count, said: null }] : [])
    );
  }
  // A line quoted by a story (more than one) tells nothing either way.
  if (o.accumulo !== undefined) return charged;
  if (a.ready)
    // Full before and not now, and no use seen: it was used from somewhere we did not hear, so
    // this turn is the first after it, as far as we know.
    return withDrift({ ...charged, ready: false, count: 1, exact: false }, at, {
      kind: 'lapsed',
      counted: count,
      said: null,
    });
  return a.exact && count === max
    ? withDrift(charged, at, { kind: 'late', counted: count, said: null })
    : charged;
}

/** The accumulo after the bot's answer to the owner's `/accumulo`. */
function afterReply(a: Accumulo, e: BusEvent): Accumulo {
  const r = replySchema.safeParse(e);
  if (!r.success) return a;
  const at = asIso(e.t);
  const { result, count, max, level } = r.data;
  // Under the level nothing charges it: it is empty, whatever we counted before we knew.
  if (result === 'locked')
    return level === undefined
      ? a
      : { ...a, as_of: at, locked: level, count: 0, exact: true, ready: false };
  if (result === 'used') {
    const early = a.exact && !a.ready && a.count < (a.max ?? ACCUMULO_MAX);
    return withDrift(
      { ...a, as_of: at, count: 0, exact: true, ready: false, used_at: at, locked: null },
      at,
      ...(early ? [{ kind: 'used_early' as const, counted: a.count, said: null }] : [])
    );
  }
  if (count === undefined || max === undefined) return a;
  const found: Omit<Drift, 'at' | 'max'>[] = [];
  if (disagrees(a, count)) found.push({ kind: 'count', counted: a.count, said: count });
  // "Not yet" while we hold it full: the line we trusted was a story's, or the accumulo was used.
  if (result === 'short' && a.ready)
    found.push({ kind: 'not_ready', counted: a.count, said: count });
  const known: Accumulo = {
    ...a,
    as_of: at,
    count,
    exact: true,
    max,
    ready: result === 'idle',
    locked: null,
  };
  return withDrift(known, at, ...found);
}

/** The state after an event, as to the accumulo: a turn charges it, the bot's answer sets it. */
function reduceAccumulo(state: LoreState, e: BusEvent): LoreState {
  const a =
    e.type === TURN_EVENT
      ? afterTurn(state.accumulo, e)
      : e.type === ACCUMULO_EVENT
        ? afterReply(state.accumulo, e)
        : state.accumulo;
  if (a === state.accumulo) return state;
  return { ...state, owner: { ...state.owner, as_of: asIso(e.t) }, accumulo: a };
}

/** The next state: an event's gains added to the inventory, a ban set or ended (pure). */
export function reduce(state: LoreState, e: BusEvent): LoreState {
  const withBans = reduceAccumulo(reduceBans(state, e), e);
  const gains = gainsOf(e);
  if (gains.length === 0) return withBans;
  const at = asIso(e.t);
  let items = withBans.inventory.items;
  for (const g of gains) {
    const before = own(items, g.item);
    items = {
      ...items,
      [g.item]: {
        qty: (before?.qty ?? 0) + g.qty,
        exact: before?.exact ?? false,
        date: at,
        via: g.via,
        rarity: g.rarity === '' ? (before?.rarity ?? null) : g.rarity,
        tags: g.tags,
      },
    };
  }
  return {
    ...withBans,
    owner: { ...withBans.owner, as_of: at },
    inventory: { held: Object.values(items).filter((h) => h.qty > 0).length, items },
  };
}

/** What a state tells of a change in its bans, as `loregame-state` announces it. */
export function announce(before: LoreState, after: LoreState, e: BusEvent): Announcement[] {
  const owner = (player: string): boolean => player === after.owner.name;
  const set = Object.entries(after.bans).flatMap(([player, b]) =>
    Object.hasOwn(before.bans, player) && before.bans[player]?.until === b.until
      ? []
      : [{ type: 'banned', payload: { player, until: b.until, owner: owner(player) } }]
  );
  const ended = Object.keys(before.bans).flatMap((player) =>
    Object.hasOwn(after.bans, player)
      ? []
      : [
          {
            type: 'unbanned',
            payload: {
              player,
              owner: owner(player),
              reason: e.type === UNBAN_EVENT ? 'lifted' : 'expired',
            },
          },
        ]
  );
  return [...set, ...ended, ...announceAccumulo(before.accumulo, after.accumulo, e)];
}

/** What a change of the accumulo tells: it is full, it was used, and each new disagreement. */
function announceAccumulo(before: Accumulo, after: Accumulo, e: BusEvent): Announcement[] {
  const told: Announcement[] = [];
  if (!before.ready && after.ready)
    told.push({
      type: 'accumuloReady',
      payload: {
        count: after.count,
        max: after.max,
        via: e.type === ACCUMULO_EVENT ? 'reading' : 'turn',
      },
    });
  if (after.used_at !== null && after.used_at !== before.used_at)
    told.push({
      type: 'accumuloUsed',
      payload: { turns: before.count, exact: before.exact },
    });
  const seen = new Set(before.drift.map((d) => `${d.kind}@${d.at}`));
  for (const d of after.drift)
    if (!seen.has(`${d.kind}@${d.at}`))
      told.push({
        type: 'accumuloDrift',
        payload: { kind: d.kind, counted: d.counted, said: d.said, max: d.max },
      });
  return told;
}

/** The accumulo as the state keeps it, for an actor to read before it sends `/accumulo`. */
export const accumuloOf = (s: LoreState): Accumulo => s.accumulo;

/** The ban of a player (the owner, unless named), if the state holds one: it may have ended by now. */
export function banOf(s: LoreState, player?: string): Ban | null {
  const name = player ?? s.owner.name;
  return name !== null && Object.hasOwn(s.bans, name) ? (s.bans[name] ?? null) : null;
}

/**
 * The freshness an event gives the sections it touched: a `delta` of each it changed, and for a
 * turn cut off, an `uncertain` inventory (it may have gained what the reply lost).
 */
export function freshness(e: BusEvent, changed: readonly string[]): Partial<Record<string, Mark>> {
  const marks: Partial<Record<string, Mark>> = Object.fromEntries(
    changed.map((c): [string, Mark] => [c, 'delta'])
  );
  const o = outcomeOf(e);
  if (o?.kind === 'nothing' && o.reason === 'truncated') marks['inventory'] = 'uncertain';
  return marks;
}

/** How many of each item the owner holds, as the state estimates it. */
export function held(s: LoreState): Record<string, number> {
  return Object.fromEntries(
    Object.entries(s.inventory.items).flatMap(([n, h]) => (h.qty > 0 ? [[n, h.qty]] : []))
  );
}
