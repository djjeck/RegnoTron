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
 * Any other outcome (a "too soon", a fight lost, the item lost) changes nothing: the state records
 * facts, and the parser has already read the reply. An item or a player may be named anything
 * (players write them), `__proto__` included, so both are read and written as own properties.
 */
import { type BusEvent } from '@megabottron1999/core';
import { type Announcement, type Mark } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import { BAN_EVENT, LOREGAME_PARSER, UNBAN_EVENT } from '#src/plugins/loregame.ts';

/** The plugin's id, and the namespace of its events (`loregame-state.changed`). */
export const LOREGAME_STATE = 'loregame-state';

/** The parser's events it applies: the owner's turns. */
export const CONSUMES: readonly string[] = [`${LOREGAME_PARSER}.turn`, BAN_EVENT, UNBAN_EVENT];

/** The paths of the state its node's panel draws first, and its card's line. */
export const PINS = ['inventory.held', 'owner.as_of'];

const date = z.string().nullable();

const ban = z.object({
  until: date.describe('Ends (none: the bot did not say)'),
  since: z.string().describe('Told'),
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
  inventory: z
    .object({
      held: z.number().describe('Items held'),
      items: z.record(z.string(), holding).describe('Items'),
    })
    .describe('Inventory'),
});

export type Holding = z.infer<typeof holding>;
export type Ban = z.infer<typeof ban>;
export type LoreState = z.infer<typeof stateSchema>;

/** The state a fresh instance starts from. */
export function initialState(): LoreState {
  return { owner: { as_of: null, name: null }, bans: {}, inventory: { held: 0, items: {} } };
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
  levelUp: z.looseObject({ items: z.array(reward) }).optional(),
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

/** The next state: an event's gains added to the inventory, a ban set or ended (pure). */
export function reduce(state: LoreState, e: BusEvent): LoreState {
  const withBans = reduceBans(state, e);
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
  return [...set, ...ended];
}

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
