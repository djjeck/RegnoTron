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
 * - **Inventories and places:** `state.inventory({ player? })` and `state.holders({ item })`
 *   (every player's items, and who holds one); `state.places()` (each place's level, items and
 *   guardians asked, when those were told, and its exits; a seed's, tools/media-seed, taken at
 *   the next start where those held are older, or none), `state.guardians()` (the places a guardian has been made at,
 *   by anyone, as told), `state.trip({ to, player?, at? })` (a trip planned before it is made:
 *   its way, and what each step takes of the player, src/trips.ts) and `state.reach({ player? })`
 *   (how far a player can climb now, src/reach.ts).
 * - **The market** (docs/game-bots.md §5.11): `state.market()` (the companies there are, by id, each
 *   its name and latest value; and the bot's updates' schedule as their times teach it, the next
 *   due, those missed), `state.marketHistory({ company?, since?, until? })` (each company's values
 *   through time: those there are, and those gone, kept two weeks after their newest value) and `state.investments({ player? })` (a player's open
 *   investments, by company id, each worth now); each company's page in `market.companies`.
 *   `loregame-state.marketUpdated` announces each update, live. A seed of the
 *   market's history (tools/market-seed) is taken once, by the migration to 0.35.0, if its store
 *   holds one (`market-seed`).
 * - **The shop** (docs/game-bots.md §5.12): `state.shop({ player?, at? })` (the day's items, the same for
 *   everyone, each marked bought by the player, the owner unless named; and whether the day is
 *   today's) and `state.shopSeen()` (every item seen on sale, its first and latest day).
 *   `loregame-state.shopChanged` announces a new day's items, or the day's told otherwise, with
 *   those never seen on sale before, live.
 * - **The catalogue** (docs/game-bots.md §6): `state.catalogue()`, every item seen in the game, by
 *   name, its rarity and tags, when and how first seen; `loregame-state.itemsDiscovered` announces
 *   those seen for the first time, live. Seeded, by the migration to 0.39.0, from the state's items.
 * - **The recipes** (docs/game-bots.md §5.14): `state.recipes()` (the game's, each one's level,
 *   what it takes and gives) and `state.recipe({ name, player? })` (one, by a part of its name, with
 *   a player's own: how many items they lack, and which). Added, none known, by the migration to
 *   0.44.0.
 * - **The pictures** (docs/game-bots.md §6.2, src/media.ts): each place's `media`, newest last,
 *   fetched once, at its first sight heard live (its creation card, else an arrival or a `/v`),
 *   through `photo`, an optional input bound to the account's `telegram-user` node (members
 *   `actions.photo`, MegaBotTron1999's D151); without it, each sight's source is kept, no bytes. The
 *   bytes are the node's files (D149), `sha256-<hex>`, the same picture kept once; `state.media({ id
 *   })` answers them. A seed of the exports' (tools/media-seed, `media-seed` in its store) is taken
 *   at the next start. The lists were added, empty, by the migration to 0.45.0.
 * - **Its events:** `loregame-state.banned` (a player's ban set or changed, with its end and
 *   whether they are the owner) and `loregame-state.unbanned` (ended: `lifted`, as the bot served
 *   them again, or `expired`), each for any player, from live news alone (not history).
 * - **Its config:** `pin`, by default `inventory.held` (how many items the owner holds) and
 *   `owner.as_of` (when it last changed), the line of its card.
 *
 * It never sends, and announces each change as `loregame-state.changed`, the sections changed; an
 * event its reducer refuses is recorded as `loregame-state.refused`.
 */
import {
  type BusEvent,
  type EventHandler,
  type FetchPhoto,
  type Instance,
  type MediaResult,
  mediaResultSchema,
  type Plugin,
  type PluginContext,
  sniffMime,
} from '@megabottron1999/core';
import { type ReadinessState } from '@megabottron1999/turns/readiness.ts';
import { statePlugin } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import { ACCUMULO } from '#src/accumulo.ts';
import { companiesFromNames, type CompanyPage, type Gone, idOf, purged } from '#src/companies.ts';
import {
  type Accumulo,
  accumuloOf,
  announce,
  banOf,
  catalogueOf,
  CONSUMES,
  foldReadiness,
  freshness,
  held,
  holdersOf,
  initialAccumulo,
  initialInventory,
  initialMarket,
  initialPlayer,
  initialShop,
  initialState,
  initialTraining,
  initialXp,
  inventoryOfPlayer,
  investmentsOf,
  LORE_READINESS,
  LOREGAME_STATE,
  type LoreState,
  marketHistory,
  marketNow,
  mediaEntryOf,
  PINS,
  placesOf,
  playerOf,
  profileOf,
  recipeOf,
  recipesOf,
  reduce,
  shopOf,
  stateSchema,
  statOf,
} from '#src/loregame-state.ts';
import { type Point } from '#src/market.ts';
import {
  imageSize,
  MEDIA_EVENT,
  type MediaEntry,
  mediaEntrySchema,
  mediaFileOf,
  mediaIdOf,
  type Sight,
  sightOf,
  wantsPicture,
} from '#src/media.ts';
import { LOREGAME_PARSER, REQUIREMENTS_EVENT } from '#src/plugins/loregame.ts';
import { reachOf } from '#src/reach.ts';
import { statsOf } from '#src/stats.ts';
import { tripOf } from '#src/trips.ts';

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
    "The owner's state at @LoreGameBot: the inventory the turns gained, the accumulo, the players' bans, every player's turns, rest, accumulo, trainings, level and XP, the places and their pictures, the market and the shop",
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
    marketUpdated: z
      .object({
        via: z
          .enum(['update', 'forced'])
          .describe("The bot's own update, or one out of turn (its developer's, or off schedule)"),
        quotes: z
          .array(
            z.looseObject({
              id: z.string().describe("The company's id"),
              company: z.string().describe('Its name now'),
              value: z.number(),
              change: z.number(),
              pct: z.number(),
              direction: z.string(),
            })
          )
          .describe('Each company, its value now, and its change since the update before'),
        gone: z
          .array(z.object({ id: z.string(), company: z.string() }))
          .describe('The companies it no longer quotes: gone'),
      })
      .describe('The market was updated: every company quoted anew'),
    shopChanged: z
      .object({
        day: z.string().nullable().describe('The day it sells for, in Italy (YYYY-MM-DD)'),
        sagra: z.string().nullable().describe("The day's sagra; none on an ordinary day"),
        items: z
          .array(
            z.object({
              item: z.string(),
              rarity: z.string(),
              tags: z.array(z.string()),
              price: z.number(),
            })
          )
          .describe("The day's items"),
        new: z.array(z.string()).describe('Those never seen on sale before'),
      })
      .describe("The shop sells other items: a new day's, or the day's told otherwise"),
    itemsDiscovered: z
      .object({
        items: z.array(
          z.object({
            item: z.string(),
            rarity: z.string(),
            tags: z.array(z.string()),
            via: z.string().describe('How: drop, level-up, inventory, gift, place, shop'),
          })
        ),
      })
      .describe('Items seen in the game for the first time'),
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
    // 0.26.0 keeps every player's inventory, and when one was listed whole: added, nothing known
    // of another player's, the owner's listed never.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      const players = (kept.state['players'] ?? {}) as Record<string, Record<string, unknown>>;
      const inventory = (kept.state['inventory'] ?? { held: 0, items: {} }) as Record<
        string,
        unknown
      >;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          inventory: { listed: null, ...inventory },
          players: Object.fromEntries(
            Object.entries(players).map(([name, p]) => [
              name,
              { inventory: initialInventory(), listing: null, ...p },
            ])
          ),
        },
      });
    },
    // 0.27.0 keeps the game's places: added, none known.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined || kept.state['places'] !== undefined) return;
      store.write('state', { ...kept, state: { ...kept.state, places: {} } });
    },
    // 0.30.0 keeps each place's guardians asked (a condition, not an item): none known of those
    // kept; the next requirements told say.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const places = kept?.state?.['places'] as Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || places === undefined) return;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          places: Object.fromEntries(
            Object.entries(places).map(([code, p]) => [code, { guardians: [], ...p }])
          ),
        },
      });
    },
    // 0.31.0 knows which guardians each player has, of those a place asks: added, none known.
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
            Object.entries(players).map(([name, p]) => [name, { guardians: {}, ...p }])
          ),
        },
      });
    },
    // 0.32.0 knows a guardian asked is one made by anyone, not by the player [M]: the guardians
    // made kept by place, those each player was told folded in (one made if any was told so).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      const players = (kept.state['players'] ?? {}) as Record<string, Record<string, unknown>>;
      const made: Record<string, boolean> = {};
      for (const p of Object.values(players))
        for (const [code, had] of Object.entries((p['guardians'] ?? {}) as Record<string, boolean>))
          Object.defineProperty(made, code, {
            value: had || (Object.hasOwn(made, code) && made[code] === true),
            enumerable: true,
            writable: true,
            configurable: true,
          });
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          guardians: { ...made, ...((kept.state['guardians'] ?? {}) as Record<string, boolean>) },
          players: Object.fromEntries(
            Object.entries(players).map(([name, { guardians: _, ...p }]) => [name, p])
          ),
        },
      });
    },
    // 0.34.0 holds /accumulo for no time: its unlock alone, the bot's line, says when. A hold kept
    // from before (a "not yet" for the turns lacking at 15 minutes each, the level gate's 6 hours)
    // is dropped.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const r = kept?.state?.['readiness'] as ReadinessState | undefined;
      if (kept?.state === undefined || r === undefined) return;
      const commands = { ...r.commands };
      const was = commands[ACCUMULO];
      if (was !== undefined) {
        const { readyAt: _, why: __, ...rest } = was;
        commands[ACCUMULO] = rest;
      }
      const { level: ___, ...holds } = r.holds;
      store.write('state', {
        ...kept,
        state: { ...kept.state, readiness: { ...r, commands, holds } },
      });
    },
    // 0.35.0 keeps the market, the companies and every player's investments: added, from the seed
    // its store holds if one was put there before it started (`market-seed`, the history the
    // exports tell: tools/market-seed), else none known.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      const seed = store.read<{
        market?: unknown;
        market_history?: unknown;
        companies?: unknown;
        players?: Record<string, { investments?: unknown }>;
      }>('market-seed');
      const players = (kept.state['players'] ?? {}) as Record<string, Record<string, unknown>>;
      const invested = seed?.players ?? {};
      const at = new Date().toISOString();
      const all: Record<string, Record<string, unknown>> = { ...players };
      for (const name of Object.keys(invested))
        if (!Object.hasOwn(all, name))
          Object.defineProperty(all, name, {
            value: initialPlayer(at) as unknown as Record<string, unknown>,
            enumerable: true,
            writable: true,
            configurable: true,
          });
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          // As 0.35.0 kept it (by name), or a seed's (by id, 0.36.0's, with its history).
          market: kept.state['market'] ??
            seed?.market ?? {
              as_of: null,
              quotes: {},
              series: {},
              schedule: initialMarket().schedule,
            },
          ...(seed?.market_history === undefined ? {} : { market_history: seed.market_history }),
          companies: kept.state['companies'] ?? seed?.companies ?? {},
          players: Object.fromEntries(
            Object.entries(all).map(([name, p]) => [
              name,
              {
                investments: Object.hasOwn(invested, name)
                  ? (invested[name]?.investments ?? {})
                  : {},
                ...p,
              },
            ])
          ),
        },
      });
    },
    // 0.36.0 keeps the companies by id, their renames followed, those gone apart with their history
    // (`market_history`), their pages within: a market kept by name is replayed so, and each
    // player's investments named by the company's id.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined) return;
      const { companies: pages, ...rest } = kept.state as {
        companies?: Record<string, CompanyPage>;
        market?: {
          as_of: string | null;
          quotes?: unknown;
          series?: Record<string, Point[]>;
          schedule: unknown;
        };
        players?: Record<string, { investments?: Record<string, unknown> }>;
      } & Record<string, unknown>;
      const market = rest.market;
      if (market === undefined || market.quotes === undefined) {
        store.write('state', {
          ...kept,
          state: { market_history: { series: {}, gone: {} }, ...rest },
        });
        return;
      }
      let c = companiesFromNames(market.series ?? {}, pages ?? {});
      const at = market.as_of ?? new Date().toISOString();
      const players = Object.fromEntries(
        Object.entries(rest.players ?? {}).map(([name, p]) => {
          const investments: Record<string, unknown> = {};
          for (const [company, x] of Object.entries(p.investments ?? {})) {
            const made = idOf(c, company, at);
            c = made.companies;
            Object.defineProperty(investments, made.id, {
              value: x,
              enumerable: true,
              writable: true,
              configurable: true,
            });
          }
          return [name, { ...p, investments }];
        })
      );
      store.write('state', {
        ...kept,
        state: {
          ...rest,
          players,
          market: { as_of: market.as_of, companies: c.companies, schedule: market.schedule },
          market_history: { series: c.series, gone: c.gone },
        },
      });
    },
    // 0.37.0 keeps a company gone with its history, out of the series of those there are, and
    // forgets it two weeks after its newest value.
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const market = kept?.state?.['market'] as { as_of: string | null } | undefined;
      const history = kept?.state?.['market_history'] as
        | { series: Record<string, Point[]>; gone: Record<string, Record<string, unknown>> }
        | undefined;
      if (kept?.state === undefined || history === undefined) return;
      const series = { ...history.series };
      const gone: Record<string, Gone> = {};
      for (const [id, g] of Object.entries(history.gone)) {
        Object.defineProperty(gone, id, {
          value: { points: Object.hasOwn(series, id) ? series[id] : [], ...g },
          enumerable: true,
          writable: true,
          configurable: true,
        });
        delete series[id];
      }
      const c =
        market?.as_of == null
          ? { gone }
          : purged({ companies: {}, gone, series: {} }, market.as_of);
      store.write('state', {
        ...kept,
        state: { ...kept.state, market_history: { series, gone: c.gone } },
      });
    },
    // 0.38.0 keeps the shop: added, nothing known (from the next listing).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined || kept.state['shop'] !== undefined) return;
      store.write('state', { ...kept, state: { ...kept.state, shop: initialShop() } });
    },
    // 0.39.0 keeps a catalogue of every item seen: seeded from the items the state holds (every
    // inventory, the places, the shop's history).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined || kept.state['catalogue'] !== undefined) return;
      const s = { ...initialState(), ...kept.state } as LoreState;
      store.write('state', {
        ...kept,
        state: { ...kept.state, catalogue: catalogueOf(s, new Date().toISOString()) },
      });
    },
    // 0.44.0 keeps the recipes, the game's and each player's: added, none known (from the next
    // list or answer).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      if (kept?.state === undefined || kept.state['recipes'] !== undefined) return;
      const players = (kept.state['players'] ?? {}) as Record<string, Record<string, unknown>>;
      const migrated = Object.entries(players).map(([name, p]) => [
        name,
        { ...p, recipes: p['recipes'] ?? {} },
      ]);
      store.write('state', {
        ...kept,
        state: { ...kept.state, players: Object.fromEntries(migrated), recipes: {} },
      });
    },
    // 0.45.0 keeps each place's pictures: added, none known (from its next sight, or a seed).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const places = kept?.state?.['places'] as Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || places === undefined) return;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          places: Object.fromEntries(
            Object.entries(places).map(([code, p]) => [code, { ...p, media: p['media'] ?? [] }])
          ),
        },
      });
    },
    // 0.46.0 keeps when each place's requirements were told, apart from its exits: those it holds
    // as of its latest change, a place none were told of none (a seed's then taken).
    (store: Store) => {
      const kept = store.read<{ state?: Record<string, unknown> }>('state');
      const places = kept?.state?.['places'] as Record<string, Record<string, unknown>> | undefined;
      if (kept?.state === undefined || places === undefined) return;
      const told = (p: Record<string, unknown>): boolean =>
        (p['level'] ?? null) !== null ||
        ((p['items'] as unknown[] | undefined) ?? []).length > 0 ||
        ((p['guardians'] as unknown[] | undefined) ?? []).length > 0;
      store.write('state', {
        ...kept,
        state: {
          ...kept.state,
          places: Object.fromEntries(
            Object.entries(places).map(([code, p]) => [
              code,
              {
                ...p,
                requirements_as_of: p['requirements_as_of'] ?? (told(p) ? p['as_of'] : null),
              },
            ])
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
    inventory: {
      help: "A player's inventory (the owner's unless named): each item's count, rarity, tags and whether it is exact, and when a whole listing (/zaino) last set it; none for a player the state does not know",
      input: z.object({ player: z.string().optional() }),
      output: z.looseObject({ held: z.number(), listed: z.string().nullable() }).nullable(),
      run: (s, input: { player?: string }) => inventoryOfPlayer(s, input.player),
    },
    places: {
      help: "The game's places, by code: the level and the items entering each takes, one each, where one can go from it, and its pictures (`media`, newest last: each its id, for `media({ id })`, its kind, type and size, and where it was seen)",
      output: z.record(z.string(), z.looseObject({ name: z.string() })),
      run: (s) => placesOf(s),
    },
    guardians: {
      help: 'The guardians made, by the code of the place a guardian is asked from ("Almeno un guardiano generato da"): whether one has been made there by anyone, as last told',
      output: z.record(z.string(), z.boolean()),
      run: (s) => s.guardians,
    },
    market: {
      help: "The market now: the companies there are, by id, each its name (emoji included) and latest value, its change and direction, how it was told, and when; and the bot's updates, the interval their times teach, the last on schedule, the next due, and those missed",
      output: z.looseObject({ as_of: z.string().nullable() }),
      run: (s) => marketNow(s),
    },
    marketHistory: {
      help: "Each company's values through time, by id: those there are (those gone too with `gone`, kept two weeks after their newest value; one if named: its id, or a name it has or had), with its name and when it was gone (if it is), its points oldest first, between `since` and `until` (ISO; all without): each point's time, value, change, percentage, and how it was told (`update`, `forced`, `listing`)",
      input: z.object({
        company: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        gone: z.boolean().optional(),
      }),
      output: z.record(
        z.string(),
        z.object({
          name: z.string(),
          gone: z.string().nullable(),
          points: z.array(z.looseObject({ t: z.string(), value: z.number() })),
        })
      ),
      run: (s, input: { company?: string; since?: string; until?: string; gone?: boolean }) =>
        marketHistory(s, input),
    },
    investments: {
      help: "A player's open investments (the owner's unless named), by the company's id: its name, what is invested, the value it was entered at, its worth as last told, and `now`, its worth at the company's latest value; none for a player the state does not know",
      input: z.object({ player: z.string().optional() }),
      output: z.record(z.string(), z.looseObject({ now: z.number().nullable() })).nullable(),
      run: (s, input: { player?: string }) => investmentsOf(s, input.player),
    },
    shop: {
      help: "The shop's items for its day (the same for every player; `today`: its day is today's, in Italy), each with its rarity, tags and price, and whether the player (the owner unless named) has bought it, as their own listing of the day marked it (none: not known). `at` (ISO) is when `today` is told of, now by default",
      input: z.object({ player: z.string().optional(), at: z.string().optional() }),
      output: z.looseObject({
        day: z.string().nullable(),
        today: z.boolean(),
        items: z.array(z.looseObject({ item: z.string(), bought: z.boolean().nullable() })),
      }),
      run: (s, input: { player?: string; at?: string }) =>
        shopOf(s, input.at === undefined ? Date.now() : Date.parse(input.at), input.player),
    },
    shopSeen: {
      help: 'Every item the shop has been seen selling, by name: its rarity and tags, its first and latest day on sale (YYYY-MM-DD, in Italy), and on how many days',
      output: z.record(z.string(), z.looseObject({ first: z.string(), last: z.string() })),
      run: (s) => s.shop.seen,
    },
    catalogue: {
      help: 'Every item seen in the game, by name: its rarity and tags as last told, and when and how it was first seen (drop, level-up, inventory, gift, place, shop, generated)',
      output: z.record(z.string(), z.looseObject({ rarity: z.string(), first: z.string() })),
      run: (s) => s.catalogue,
    },
    recipes: {
      help: "The game's recipes, by name: each one's level, what it takes (each item's rarity, tags and how many, none if not known) and what it gives (once seen made), as any player's list and answers last told",
      output: z.record(z.string(), z.looseObject({ ingredients: z.array(z.unknown()) })),
      run: (s) => recipesOf(s),
    },
    recipe: {
      help: "A recipe, by its name or a part of it (as /ricetta, ignoring case, when one recipe alone has it): what it takes and gives, and a player's own (the owner's unless named): how many items they lack and which, as last told; none if no one recipe is named so",
      input: z.object({ name: z.string(), player: z.string().optional() }),
      output: z.looseObject({ name: z.string(), player: z.unknown() }).nullable(),
      run: (s, input: { name: string; player?: string }) => recipeOf(s, input.name, input.player),
    },
    trip: {
      help: 'A trip planned (the owner\'s unless a player is named) to a place, by its code: the way from where they are through the places known, and each step\'s level, the items it takes (one each, up or down alike) and those they are known to lack or not known to hold, the guardians it asks and whether one has been made at each (by anyone; a neutral place asks none of a ticket holder), and for a neutral place whether "Neutralizzato" holds (not asked of "Il Neutrale"); ok true, false, or none when it cannot be told. `at` (ISO) is when, now by default',
      input: z.object({ to: z.string(), player: z.string().optional(), at: z.string().optional() }),
      output: z.looseObject({ to: z.string(), ok: z.boolean().nullable() }),
      run: (s, input: { to: string; player?: string; at?: string }) =>
        tripOf(
          s,
          input.to,
          input.at === undefined ? Date.now() : Date.parse(input.at),
          input.player
        ),
    },
    reach: {
      help: "How far a player (the owner unless named) can climb now: from where they are (back to their faction's ladder first, if on the neutral one), up it a step at a time, each step's level (unchecked when theirs or its is unknown), guardians made and items taken from a copy of their inventory. `reached` is K, the highest step of their ladder they can be at; `next` the step they stopped at, with what they would lack; `top` when no place above is known; `unknown` why the walk could not be told (player, alignment, location, way back, requirements, guardian)",
      input: z.object({ player: z.string().optional() }),
      output: z.looseObject({
        player: z.string().nullable(),
        ladder: z.string().nullable(),
        from: z.string().nullable(),
        level: z.number().nullable(),
        path: z.array(z.string()),
        reached: z.object({ code: z.string(), step: z.number() }).nullable(),
        next: z.looseObject({ code: z.string() }).nullable(),
        top: z.boolean(),
        unknown: z.string().nullable(),
      }),
      run: (s, input: { player?: string }) => reachOf(s, input.player),
    },
    holders: {
      help: 'Who holds an item, by its exact name: each player the state knows of (the owner too), with how many and whether it is exact, most first',
      input: z.object({ item: z.string() }),
      output: z.array(z.object({ player: z.string(), qty: z.number(), exact: z.boolean() })),
      run: (s, input: { item: string }) => holdersOf(s, input.item),
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

/** Its input to the account's `photo` (MegaBotTron1999's D151): optional, its edge the leave. */
export const PHOTO_INPUT = 'photo';
/**
 * The document a seed of the exports is put in (tools/media-seed): the places' pictures and their
 * requirements, taken at the next start.
 */
export const MEDIA_SEED = 'media-seed';

/**
 * What a seed holds: each place's pictures, and each picture's bytes (base64), by id; and each
 * place's requirements as last told in the exports (`as_of`), if any (0.46.0's seeds).
 */
const seedSchema = z.object({
  places: z.record(z.string(), z.object({ name: z.string(), media: z.array(mediaEntrySchema) })),
  files: z.record(z.string(), z.string()),
  requirements: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        level: z.number().nullable(),
        items: stateSchema.shape.places.valueType.shape.items,
        guardians: z.array(z.string()),
        as_of: z.iso.datetime(),
      })
    )
    .optional(),
});
export type MediaSeed = z.infer<typeof seedSchema>;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The account's `photo`, as its input gives it. */
interface Photos {
  actions: { photo: FetchPhoto };
}

/**
 * The state's pictures, around the shell's state (`base`): it hears the parser's events as the
 * state does, and, once the state has applied one that shows an entity still wanting its picture
 * (src/media.ts's `sightOf`, `wantsPicture`), fetches it through `photo`, one at a time, keeps its
 * bytes in the files, and hands the entry to the state's reducer as a `loregame.media` event, never
 * published. Live alone: the catch-up from the event log fetches nothing (a message may be gone).
 */
async function create(ctx: PluginContext): Promise<Instance> {
  /** The state's own handler of the parser's events, which applies one. */
  let deliver: EventHandler | undefined;
  let live = false;
  /** The places whose picture is being fetched. */
  const fetching = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  const bus = Object.create(ctx.bus, {
    subscribe: {
      value: (pattern: string, handler: EventHandler) => {
        if (pattern === LOREGAME_PARSER) deliver = handler;
        return ctx.bus.subscribe(pattern, (e, at) => {
          handler(e, at);
          if (live) sight(e);
        });
      },
    },
  }) as PluginContext['bus'];
  const inner = await base.create(Object.create(ctx, { bus: { value: bus } }) as PluginContext);
  const reads = inner.interface?.state as Record<string, (input?: unknown) => unknown>;
  const places = (): LoreState['places'] =>
    (reads['get']?.({ path: 'places' }) ?? {}) as LoreState['places'];

  /** An entry for the entity `s` shows, handed to the state's reducer. */
  const give = (s: Sight, media: MediaEntry): void => {
    if (!live) return;
    const { entity, key, name } = s;
    deliver?.({ type: MEDIA_EVENT, t: Date.parse(s.at), entity, key, name, media }, undefined);
  };
  const sourceOf = (s: Sight): MediaEntry['source'] => ({
    chat: s.chat,
    message: s.message,
    via: s.via,
    at: s.at,
  });

  /** Fetches the picture `s` shows, keeps its bytes, and gives its entry. */
  const fetch = async (s: Sight, photo: Photos, none: boolean): Promise<void> => {
    const source = sourceOf(s);
    const unknown = (why: string): void => {
      ctx.log.warn(`the picture of ${s.entity} ${s.key} (message ${s.message}): ${why}`);
      if (none) give(s, { id: null, kind: 'unknown', source });
    };
    let r: Awaited<ReturnType<FetchPhoto>>;
    try {
      r = await photo.actions.photo({ chat: s.chat, message: s.message });
    } catch (e) {
      unknown(message(e));
      return;
    }
    if (!r.ok) {
      unknown(r.error);
      return;
    }
    if (r.media === null) {
      give(s, { id: null, kind: 'other', source });
      return;
    }
    const { data, mime } = r.media;
    const id = mediaIdOf(data);
    const file = mediaFileOf(id) as string;
    try {
      if (!ctx.store.files.list().some((f) => f.name === file))
        ctx.store.files.write(file, data, { type: mime });
    } catch (e) {
      unknown(`not kept: ${message(e)}`);
      return;
    }
    const size = imageSize(data);
    const width = r.media.width ?? size?.width;
    const height = r.media.height ?? size?.height;
    give(s, {
      id,
      kind: 'image',
      mime,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      source,
    });
  };

  /** An event the state has applied: the entity it shows, if it still wants its picture. */
  const sight = (e: BusEvent): void => {
    const s = sightOf(e);
    if (s === undefined || fetching.has(s.key)) return;
    const all = places();
    const media = Object.hasOwn(all, s.key) ? (all[s.key]?.media ?? []) : [];
    if (!wantsPicture(media)) return;
    const none = media.length === 0;
    const photo = ctx.useOptional<Photos>(PHOTO_INPUT);
    if (photo === undefined) {
      // No edge: where it was seen first, without its bytes.
      if (none) give(s, { id: null, kind: 'unknown', source: sourceOf(s) });
      return;
    }
    fetching.add(s.key);
    queue = queue.then(() => fetch(s, photo, none)).finally(() => fetching.delete(s.key));
  };

  /** A seed of pictures in its store (tools/media-seed): taken, then removed. */
  const seed = (): void => {
    const kept = ctx.store.read(MEDIA_SEED);
    if (kept === undefined) return;
    const r = seedSchema.safeParse(kept);
    if (!r.success) {
      ctx.log.warn(`${MEDIA_SEED} not taken: ${r.error.message}`);
      return;
    }
    const written = new Set(ctx.store.files.list().map((f) => f.name));
    let files = 0;
    for (const [id, base64] of Object.entries(r.data.files)) {
      const data = Uint8Array.from(Buffer.from(base64, 'base64'));
      const file = mediaFileOf(id);
      if (file === undefined || mediaIdOf(data) !== id) {
        ctx.log.warn(`${MEDIA_SEED}: ${id} is not its bytes' id, left out`);
        continue;
      }
      if (written.has(file)) continue;
      try {
        ctx.store.files.write(file, data, { type: sniffMime(data) ?? 'application/octet-stream' });
      } catch (e) {
        ctx.log.warn(`${MEDIA_SEED}: ${id} not kept: ${message(e)}`);
        continue;
      }
      written.add(file);
      files += 1;
    }
    let entries = 0;
    for (const [key, place] of Object.entries(r.data.places))
      for (const m of place.media) {
        // An image whose bytes it does not hold is left out.
        if (m.id !== null && !written.has(mediaFileOf(m.id) ?? '')) continue;
        entries += 1;
        give({ entity: 'place', key, name: place.name, ...m.source }, m);
      }
    // Each place's requirements, as of when told: the state keeps those told since, if any.
    const told = Object.entries(r.data.requirements ?? {});
    const before = places();
    for (const [code, q] of told)
      deliver?.(
        {
          type: REQUIREMENTS_EVENT,
          t: Date.parse(q.as_of),
          chat: '',
          place: { name: q.name, code },
          level: q.level,
          items: q.items,
          guardians: q.guardians,
          met: null,
        },
        undefined
      );
    const after = places();
    const taken = told.filter(
      ([code]) => (Object.hasOwn(before, code) ? before[code] : undefined) !== after[code]
    ).length;
    // Once the state that took it is kept: its save is a microtask the entries queued before.
    queueMicrotask(() => ctx.store.remove(MEDIA_SEED));
    ctx.log.info(
      `${MEDIA_SEED} taken: ${entries} picture(s) of places, ${files} file(s) new, ${taken} of ${told.length} place(s)' requirements`
    );
  };

  /** A picture's bytes, by its id (the core's `Media`, D153): none if not kept; why not, never thrown. */
  const media = (input: { id: string }): MediaResult => {
    const file = mediaFileOf(input.id);
    if (file === undefined) return { ok: false, error: `not a picture's id: ${input.id}` };
    try {
      const kept = ctx.store.files.read(file);
      if (kept === undefined) return { ok: true, media: null };
      const data = new Uint8Array(kept.buffer, kept.byteOffset, kept.byteLength);
      const entry = mediaEntryOf({ places: places() } as LoreState, input.id);
      const size = imageSize(data);
      const width = entry?.width ?? size?.width;
      const height = entry?.height ?? size?.height;
      return {
        ok: true,
        media: {
          data,
          mime: entry?.mime ?? sniffMime(data) ?? 'application/octet-stream',
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
        },
      };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  };

  return {
    ...inner,
    async start() {
      await inner.start?.();
      live = true;
      seed();
    },
    async stop() {
      live = false;
      await queue;
      await inner.stop?.();
    },
    interface: { ...inner.interface, state: { ...inner.interface?.state, media } },
  };
}

export const loregameStatePlugin: Plugin = {
  manifest: {
    ...base.manifest,
    config,
    inputs: {
      ...base.manifest.inputs,
      [PHOTO_INPUT]: {
        type: 'interface',
        members: ['actions.photo'],
        optional: true,
        help: "The account's photos (telegram-user, D151): each picture fetched once, at its first sight; without it, where it was seen, no bytes",
      },
    },
    interface: {
      ...base.manifest.interface,
      state: {
        ...base.manifest.interface?.state,
        media: {
          help: "A picture's bytes, by its id (sha256:<hex>, as the places' `media` give it): its data, type and size; none if not kept",
          input: z.object({ id: z.string() }),
          output: mediaResultSchema,
        },
      },
    },
  },
  create,
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregameStatePlugin];
