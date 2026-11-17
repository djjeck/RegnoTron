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
 * Any other outcome (a "too soon", a fight lost, the item lost) changes nothing: the state records
 * facts, and the parser has already read the reply. An item may be named anything (players write
 * them), `__proto__` included, so the holdings are read and written as own properties.
 */
import { type BusEvent } from '@megabottron1999/core';
import { type Mark } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import { LOREGAME_PARSER } from '#src/plugins/loregame.ts';

/** The plugin's id, and the namespace of its events (`loregame-state.changed`). */
export const LOREGAME_STATE = 'loregame-state';

/** The parser's events it applies: the owner's turns. */
export const CONSUMES: readonly string[] = [`${LOREGAME_PARSER}.turn`];

/** The paths of the state its node's panel draws first, and its card's line. */
export const PINS = ['inventory.held', 'owner.as_of'];

const date = z.string().nullable();

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
  owner: z.object({ as_of: date.describe('Latest change') }).describe('Owner'),
  inventory: z
    .object({
      held: z.number().describe('Items held'),
      items: z.record(z.string(), holding).describe('Items'),
    })
    .describe('Inventory'),
});

export type Holding = z.infer<typeof holding>;
export type LoreState = z.infer<typeof stateSchema>;

/** The state a fresh instance starts from. */
export function initialState(): LoreState {
  return { owner: { as_of: null }, inventory: { held: 0, items: {} } };
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

/** The next state: an event's gains added to the inventory (pure; a turn of no gain: the same state). */
export function reduce(state: LoreState, e: BusEvent): LoreState {
  const gains = gainsOf(e);
  if (gains.length === 0) return state;
  const at = new Date(e.t).toISOString();
  let items = state.inventory.items;
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
    owner: { as_of: at },
    inventory: { held: Object.values(items).filter((h) => h.qty > 0).length, items },
  };
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
