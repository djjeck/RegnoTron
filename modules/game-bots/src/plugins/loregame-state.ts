/**
 * The `loregame-state` plugin: the owner's state at @LoreGameBot, kept by MegaBotTron1999's
 * `statePlugin` (its docs/bot-os-api.md §5, bot-os.md D72) from the `loregame` parser's turns, with
 * the reducer of `src/loregame-state.ts`, which says what it keeps and how.
 *
 * - **Its inputs:** `events`, required, bound to the `loregame` parser's events output (the
 *   namespace `loregame`): its turns, sends, answers, bans, accumulo and trainings. It resumes from its cursor
 *   in the event log, so nothing is applied twice, and what the parser published while it was down
 *   is applied at its next start. `parser`, required, bound to the `loregame` parser's interface:
 *   the sends a shell player tells it of, handed on (MegaBotTron1999's bot-os.md D141).
 * - **The owner's readiness** (D141): each of @LoreGameBot's commands' readiness, the section
 *   `readiness`, which a shell player binds to (`state.ready`, `state.commands`, `state.bot`,
 *   `actions.sent`): reduced from the parser's events by the shell, with the accumulo's and the
 *   training's mechanics, and the owner's ban, their `/accumulo` answers and their trainings folded
 *   in (`foldReadiness`), so no wrapper of the parser's patches it.
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
 *   "too soon" told of (played in their private chat, which the account does not read), their rest,
 *   their accumulo, their trainings, their XP and level-ups, their last profile
 *   (`state.profile({ player?, stat? })`: whole, or one stat by its dotted path), and their stats
 *   now (`state.stat({ player?, stat })`: the profile's, moved by each command read since, each with
 *   whether it is still exact), each a floor of what they did (src/players.ts, src/stats.ts). A
 *   profile that says otherwise of a stat held exactly is announced as `loregame-state.statsDrift`.
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
import { type ReadinessState } from '@megabottron1999/turns/readiness.ts';
import { statePlugin } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import {
  type Accumulo,
  accumuloOf,
  announce,
  banOf,
  CONSUMES,
  foldReadiness,
  freshness,
  held,
  initialAccumulo,
  initialState,
  initialTraining,
  initialXp,
  LORE_READINESS,
  LOREGAME_STATE,
  type LoreState,
  PINS,
  playerOf,
  profileOf,
  reduce,
  stateSchema,
  statOf,
} from '#src/loregame-state.ts';
import { statsOf } from '#src/stats.ts';

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
    "The owner's state at @LoreGameBot: the inventory the turns gained, the accumulo, the players' bans, and every player's turns, rest, accumulo, trainings, level and XP",
  schema: stateSchema,
  initial: initialState() as Kept,
  consumes: CONSUMES,
  // The owner's readiness, the parser's events reduced by the shell (D141); and the facts this
  // state knows besides, folded in.
  readiness: LORE_READINESS,
  reduce: (state, event) => {
    const next = reduce(state, event) as Kept;
    const r = next['readiness'] as ReadinessState;
    const folded = foldReadiness(r, event);
    return folded === r ? next : { ...next, readiness: folded };
  },
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
    statsDrift: z
      .object({
        player: z.string(),
        owner: z.boolean(),
        stat: z.string(),
        expected: z.unknown().describe('What the state held, exactly'),
        said: z.unknown().describe('What the profile said'),
      })
      .describe("A player's profile says otherwise of a stat the state held exactly"),
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
    // 0.16.0 kept no readiness: the section is added, nothing known yet (from the next event).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined || kept.state['readiness'] !== undefined) return;
      store.write('state', {
        ...kept,
        state: { ...kept.state, readiness: LORE_READINESS.initial() },
      });
    },
    // 0.18.0 kept no trainings: each player's is added, nothing known (from their next one).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const players = kept?.state?.['players'] as
        Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || players === undefined) return;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          players: Object.fromEntries(
            Object.entries(players).map(([name, p]) => [
              name,
              { training: initialTraining(), ...p },
            ])
          ),
        },
      });
    },
    // 0.19.0 kept no XP: each player's is added, nothing seen (from their next gain or level-up).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const players = kept?.state?.['players'] as
        Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || players === undefined) return;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          players: Object.fromEntries(
            Object.entries(players).map(([name, p]) => [name, { xp: initialXp(), ...p }])
          ),
        },
      });
    },
    // 0.22.0 kept no profiles, and XP without its total: each player's added, none known.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const players = kept?.state?.['players'] as
        Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || players === undefined) return;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          players: Object.fromEntries(
            Object.entries(players).map(([name, p]) => [
              name,
              {
                profile: null,
                ...p,
                xp: { total: null, exact: false, ...(p['xp'] as object | undefined) },
              },
            ])
          ),
        },
      });
    },
    // 0.23.0 holds each player's stats now, seeded by their profile (its XP total moved into
    // them), and their mismatches: added, the XP's total and exactness dropped from `xp`.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const players = kept?.state?.['players'] as
        Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || players === undefined) return;
      const migrated = Object.entries(players).map(([name, p]) => {
        const { total, exact, ...xp } = (p['xp'] ?? {}) as Record<string, unknown>;
        const profile = p['profile'] as Record<string, unknown> | null | undefined;
        const stats =
          profile === null || profile === undefined
            ? {}
            : statsOf(profile, String(profile['as_of']));
        if (typeof total === 'number' && Object.hasOwn(stats, 'xp'))
          stats['xp'] = { value: total, exact: exact === true, as_of: String(profile?.['as_of']) };
        return [name, { stats, stats_drift: [], ...p, xp }];
      });
      store.write('state', {
        ...kept,
        state: { ...kept.state, players: Object.fromEntries(migrated) },
      });
    },
    // 0.24.0 knows each player's gear: added, learnt from the equipment of their profile.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const players = kept?.state?.['players'] as
        Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || players === undefined) return;
      const gearOf = (p: Record<string, unknown>): Record<string, unknown> => {
        const worn = (p['profile'] as { equipment?: Record<string, unknown> } | null)?.equipment;
        const gear: Record<string, unknown> = {};
        for (const [slot, w] of Object.entries(worn ?? {}))
          if (w !== null && typeof w === 'object' && 'item' in w)
            Object.defineProperty(gear, String((w as { item: unknown }).item), {
              value: { slot, level: (w as { level?: unknown }).level ?? null },
              enumerable: true,
              writable: true,
              configurable: true,
            });
        return gear;
      };
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          players: Object.fromEntries(
            Object.entries(players).map(([name, p]) => [name, { gear: gearOf(p), ...p }])
          ),
        },
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
      help: 'A player as the turns and answers the account reads tell (by username): their name and level in the game, their turns seen and unseen, their rest, their accumulo, their trainings, the XP seen and their level-ups; none if never heard of',
      input: z.object({ name: z.string() }),
      output: z.looseObject({ turns: z.number(), unseen: z.number() }).nullable(),
      run: (s, input: { name: string }) => playerOf(s, input.name),
    },
    stat: {
      help: "A player's stat now (the owner's unless named), by its dotted path (xp, level, episode, coins, location, skills.Stoccaggio): its value, whether every change since their last profile was seen, and when it changed; none before a profile",
      input: z.object({ player: z.string().optional(), stat: z.string() }),
      output: z.object({ value: z.unknown(), exact: z.boolean(), as_of: z.string() }).nullable(),
      run: (s, input: { player?: string; stat: string }) => statOf(s, input.stat, input.player),
    },
    profile: {
      help: "A player's last profile (/info), the owner's unless named: whole, or one stat by its dotted path (level, xp, coins, skills.Stoccaggio, equipment.weapon.level); none if not known",
      input: z.object({ player: z.string().optional(), stat: z.string().optional() }),
      output: z.unknown(),
      run: (s, input: { player?: string; stat?: string }) => profileOf(s, input.player, input.stat),
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
