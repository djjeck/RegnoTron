/**
 * The `loregame-state` plugin: the owner's state at @LoreGameBot, kept by MegaBotTron1999's
 * `statePlugin` (its docs/bot-os-api.md §5, bot-os.md D72) from the `loregame` parser's turns, with
 * the reducer of `src/loregame-state.ts`, which says what it keeps and how.
 *
 * - **Its input:** `events`, required, bound to the `loregame` parser's events output (the
 *   namespace `loregame`): `loregame.turn`. It resumes from its cursor in the event log, so nothing
 *   is applied twice, and the turns the parser published while it was down are applied at its next
 *   start.
 * - **Its sections:** `owner` (when its state last changed, and the owner's name in the bans),
 *   `bans` (the banned players, with when each ban ends) and `inventory` (an estimate: the items
 *   the turns gained, `exact` once a listing says so).
 * - **Freshness:** a turn that gains is a `delta` of the inventory; one cut off at Telegram's limit
 *   is an `uncertain` one.
 * - **Its interface:** `state.get`, `state.freshness`, `state.count({ name })` (how many of an
 *   item the owner holds), `state.held()` (every item held, with its count), `state.ban({ player? })`
 *   (a player's ban, the owner's unless named; `bannedUntil` in `src/bans.ts` is the actor's
 *   helper over it) and `state.bans()` (every banned player).
 * - **The accumulo** (`state.accumulo()`, `accumuloReady` in `src/accumulo.ts` is the actor's
 *   check): the turns counted since it was last emptied, the bot's word that it is full (`ready`),
 *   and the `drift` between the two. `loregame-state.accumuloReady`, `accumuloUsed` and
 *   `accumuloDrift` announce each change from live news.
 * - **The players** (`state.player({ name })`): every player's turns the account reads, the
 *   owner's included, kept by username: their name and level in the game, their turns seen, those a
 *   "too soon" told of (played in their private chat, which the account does not read), their rest
 *   and their accumulo, each a floor of what they did (src/players.ts).
 * - **Its events:** `loregame-state.banned` (a player's ban set or changed, with its end and
 *   whether they are the owner) and `loregame-state.unbanned` (ended: `lifted`, as the bot served
 *   them again, or `expired`), each for any player, from live news alone (not history).
 * - **Its config:** `pin`, by default `inventory.held` (how many items the owner holds) and
 *   `owner.as_of` (when it last changed), the line of its card.
 *
 * It never sends, and announces each change as `loregame-state.changed`, the sections changed; an
 * event its reducer refuses is recorded as `loregame-state.refused`.
 */
import { type Plugin } from '@megabottron1999/core';
import { statePlugin } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import {
  type Accumulo,
  accumuloOf,
  announce,
  banOf,
  CONSUMES,
  freshness,
  held,
  initialAccumulo,
  initialState,
  LOREGAME_STATE,
  type LoreState,
  PINS,
  playerOf,
  reduce,
  stateSchema,
} from '#src/loregame-state.ts';

/** What a migration works on: a staged copy of the plugin's store. */
interface Store {
  read<T>(name: string): T | undefined;
  write(name: string, value: unknown): void;
}

/** The state, as `statePlugin` keeps it: an object of sections. */
type Kept = LoreState & Record<string, unknown>;

const base = statePlugin<Kept>({
  id: LOREGAME_STATE,
  description:
    "The owner's state at @LoreGameBot: the inventory the turns gained, the accumulo, the players' bans, and every player's turns, rest and accumulo",
  schema: stateSchema,
  initial: initialState() as Kept,
  consumes: CONSUMES,
  reduce: (state, event) => reduce(state, event) as Kept,
  freshness,
  events: {
    banned: z
      .object({
        player: z.string(),
        until: z.string().nullable().describe('When the ban ends (ISO); none: not stated'),
        owner: z.boolean().describe('The player is the owner of the account'),
      })
      .describe("A player's ban, new or changed"),
    unbanned: z
      .object({
        player: z.string(),
        owner: z.boolean(),
        reason: z
          .enum(['lifted', 'expired'])
          .describe('Served again by the bot, or its end passed'),
      })
      .describe("A player's ban ended"),
    accumuloReady: z
      .object({
        count: z.number().describe('Turns we counted'),
        max: z.number().nullable().describe('Turns it needs, as the bot said'),
        via: z.enum(['turn', 'reading']).describe("A turn's line, or the bot's own counter"),
      })
      .describe('The bot said the accumulo is full: it can be used'),
    accumuloUsed: z
      .object({
        turns: z.number().describe('Turns counted since the last use'),
        exact: z.boolean().describe('The count was set by the bot, not only counted'),
      })
      .describe('The accumulo was used: the next /lore has no rest'),
    accumuloDrift: z
      .object({
        kind: z.enum(['count', 'early', 'late', 'lapsed', 'not_ready', 'used_early']),
        counted: z.number(),
        said: z.number().nullable(),
        max: z.number(),
      })
      .describe("Our count and the bot's word disagree about the accumulo"),
  },
  announce,
  migrations: [
    // 0.4.0 kept no bans: the section is added, empty.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      const owner = (kept.state['owner'] ?? {}) as Record<string, unknown>;
      store.write('state', {
        ...kept,
        state: { ...kept.state, owner: { name: null, ...owner }, bans: kept.state['bans'] ?? {} },
      });
    },
    // 0.5.0 kept no accumulo: the section is added, with nothing known (the count starts now).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      store.write('state', {
        ...kept,
        state: { ...kept.state, accumulo: kept.state['accumulo'] ?? initialAccumulo() },
      });
    },
    // 0.9.0 kept no players: the section is added, empty (each is known from their next turn).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      store.write('state', {
        ...kept,
        state: { ...kept.state, players: kept.state['players'] ?? {} },
      });
    },
  ],
  queries: {
    ban: {
      help: "A player's ban (the owner's unless named), when it ends: none if the state holds none; it may have ended by now",
      input: z.object({ player: z.string().optional() }),
      output: z.object({ until: z.string().nullable(), since: z.string() }).nullable(),
      run: (s, input: { player?: string }) => banOf(s, input.player),
    },
    accumulo: {
      help: "The owner's accumulo: the turns counted, the bot's word that it is full (`ready`), and where the two disagreed",
      output: z.looseObject({
        as_of: z.string().nullable(),
        count: z.number(),
        exact: z.boolean(),
        max: z.number().nullable(),
        ready: z.boolean(),
        used_at: z.string().nullable(),
        locked: z.number().nullable(),
        drift: z.array(z.looseObject({ kind: z.string(), at: z.string() })),
      }),
      run: (s): Accumulo => accumuloOf(s),
    },
    player: {
      help: 'A player as the turns and answers the account reads tell (by username): their name and level in the game, their turns seen and unseen, their rest, their accumulo; none if never heard of',
      input: z.object({ name: z.string() }),
      output: z.looseObject({ turns: z.number(), unseen: z.number() }).nullable(),
      run: (s, input: { name: string }) => playerOf(s, input.name),
    },
    bans: {
      help: 'Every banned player, with when their ban ends and when it was told',
      output: z.record(z.string(), z.object({ until: z.string().nullable(), since: z.string() })),
      run: (s) => s.bans,
    },
    count: {
      help: 'How many of an item the owner holds, as the state estimates it',
      input: z.object({ name: z.string() }),
      output: z.number(),
      run: (s, input: { name: string }) => {
        const all = held(s);
        return Object.hasOwn(all, input.name) ? (all[input.name] as number) : 0;
      },
    },
    held: {
      help: 'Every item the owner holds, with its count',
      output: z.record(z.string(), z.number()),
      run: (s) => held(s),
    },
  },
});

/** Its node's config: the state plugin's, with the pins the owner wants first by default. */
type Config = z.ZodObject<{ pin: z.ZodDefault<z.ZodArray> }>;
const config = (base.manifest.config as Config).extend({
  pin: (base.manifest.config as Config).shape.pin
    .unwrap()
    .default(PINS)
    .describe(
      'Paths of the state (dotted: inventory.held) drawn first in its panel; the first two make the line on its card'
    ),
});

export const loregameStatePlugin: Plugin = {
  ...base,
  manifest: { ...base.manifest, config },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregameStatePlugin];
