/**
 * The `norelec-state` plugin: the game's record (modules/norelec/src/state/record.ts), kept by
 * MegaBotTron1999's `statePlugin` (its docs/bot-os-api.md §5, bot-os.md D72) from the `norelec`
 * parser's per-kind events, `norelec.<kind>`. The parser makes sense of the bot's messages; this
 * keeps what they say, across restarts, and answers the scripts' questions.
 *
 * - **Its input:** `events`, bound to the `norelec` parser's events output (the namespace
 *   `norelec`). It resumes from its cursor in the event log, so nothing is applied twice.
 * - **Its interface:** the state plugin's `state.get` and `state.freshness`, and its queries:
 *   `player({ name })`, `house({ name })` (the slots, those babies lock and until when),
 *   `trip({ name })` (from, to, start, expected arrival and return), `ball({ at? })` (the holder
 *   and every player's time held, as /leaderboard counts it), `held({ name, at? })`,
 *   `babies({ name? })` (each birth, the stages seen and when, when it is due to leave, and when
 *   it went), `banned()`, `price({ emoji })`.
 * - **What the game does on its own** (record.ts `settleDue`): a baby 9 h after a 💦 delivered, its
 *   departure 96 h after its birth, a trip's return; overdue by 10 minutes with no line, applied
 *   at the next event, as the game applied it.
 * - **Its store** is at version 1: the one migration gives each baby kept its departure time.
 * - **What happened** (D83), new facts only, never a correction (a leaderboard that shows another
 *   holder than the record had settles it silently), and nothing for an event played back or read
 *   at the catch-up: `ballMoved` (the ⚽ changed hands, for anyone), and about the owner's account
 *   (`self`): `raided`, `thrownAt`, `ballTaken` (the ⚽ taken from them) and `slotLocked` (a baby
 *   born in their house took a slot).
 */
import { type BusEvent, type MigrationStore, type Plugin } from '@megabottron1999/core';
import { type Announcement, STATE_DOC, statePlugin } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import {
  babiesOf,
  ballTotals,
  type GameRecord,
  heldSeconds,
  houseOf,
  initialRecord,
  leavesOf,
  recordSchema,
  reduceRecord,
  tripOf,
} from '#src/state/record.ts';

export const NORELEC_STATE = 'norelec-state';

/** The parser's events it applies. */
export const CONSUMES = [
  'depart',
  'theft',
  'balloonHeld',
  'dog',
  'bombAtHome',
  'bombDefective',
  'throwUndelivered',
  'throwDelivered',
  'freezeDelivered',
  'bounced',
  'turnBack',
  'returnHome',
  'lostAtFork',
  'dreamDepart',
  'profile',
  'house',
  'rearranged',
  'bought',
  'tooPoor',
  'quoteAdded',
  'refused',
  'moved',
  'slotLocked',
  'born',
  'babyGone',
  'banned',
  'disabled',
  'ballTaken',
  'ballRow',
  'ballHolder',
].map((k) => `norelec.${k}`);

const name = z.object({ name: z.string() });
const by = z.string().optional().describe('Who did it, when the bot named them');

/** Its events (D83). */
export const STATE_EVENTS = {
  ballMoved: z
    .object({ from: z.string().optional(), to: z.string() })
    .describe('The ⚽ changed hands: taken by `to`'),
  raided: z
    .object({
      by: z.string(),
      outcome: z.enum(['stolen', 'held', 'dog']),
      balls: z.number().optional(),
    })
    .describe("The owner's home raided: robbed, or held by the 🎈 or the 🐶"),
  thrownAt: z
    .object({ by, emoji: z.string() })
    .describe('Something thrown at the owner arrived (a 💣, a 🧊, a 💦, …)'),
  ballTaken: z.object({ by: z.string() }).describe('The ⚽ taken from the owner'),
  slotLocked: z
    .object({
      slot: z.number().optional(),
      emoji: z.string(),
      by,
      replaced: z.string().optional(),
    })
    .describe("A baby born in the owner's house took a slot, locked until it goes"),
};

const nameOf = (v: unknown): string | undefined =>
  typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string'
    ? (v as { name: string }).name
    : undefined;

/** What an applied event means for the owner, and the ⚽'s moves: news, never corrections. */
export function announce(before: GameRecord, after: GameRecord, event: BusEvent): Announcement[] {
  const kind = event.type.slice(event.type.indexOf('.') + 1);
  const self = after.self;
  const player = nameOf(event['player']);
  const out: Announcement[] = [];
  if (kind === 'ballTaken' && player !== undefined) {
    const from = nameOf(event[`from`]) ?? before.ball.holder?.name;
    if (from !== player)
      out.push({
        type: 'ballMoved',
        payload: { ...(from === undefined ? {} : { from }), to: player },
      });
    if (self !== null && from === self && player !== self)
      out.push({ type: 'ballTaken', payload: { by: player } });
  }
  if (self === null) return out;
  const victim = nameOf(event['victim']);
  const outcome = { theft: 'stolen', balloonHeld: 'held', dog: 'dog' }[kind];
  if (outcome !== undefined && victim === self && player !== undefined) {
    const balls = event['balls'];
    out.push({
      type: 'raided',
      payload: { by: player, outcome, ...(typeof balls === 'number' ? { balls } : {}) },
    });
  }
  const target =
    kind === 'throwDelivered'
      ? nameOf(event['to'])
      : kind === 'freezeDelivered'
        ? nameOf(event['target'])
        : kind === 'bombAtHome'
          ? victim
          : undefined;
  if (target === self) {
    const emoji = kind === 'freezeDelivered' ? '🧊' : kind === 'bombAtHome' ? '💣' : event['emoji'];
    out.push({
      type: 'thrownAt',
      payload: { ...(player === undefined ? {} : { by: player }), emoji: String(emoji) },
    });
  }
  if (kind === 'born' && player === self) {
    const baby = after.babies.at(-1);
    const father = nameOf(event['father']);
    out.push({
      type: 'slotLocked',
      payload: {
        ...(baby?.slot === undefined ? {} : { slot: baby.slot }),
        emoji: String(event['emoji']),
        ...(father === undefined ? {} : { by: father }),
        ...(typeof event['replaced'] === 'string' ? { replaced: event['replaced'] } : {}),
      },
    });
  }
  return out;
}

/**
 * The store's migrations (MegaBotTron1999's docs/bot-os-api.md §4.2): 0 → 1 gives each baby kept
 * the time it is due to leave (`leaves`), from its birth or its stages.
 */
export const MIGRATIONS = [
  (store: MigrationStore): void => {
    const kept = store.read<{ state?: GameRecord }>(STATE_DOC);
    if (kept?.state === undefined) return;
    kept.state.babies = kept.state.babies.map((b) => {
      const leaves = leavesOf(b);
      return leaves === undefined ? b : { ...b, leaves };
    });
    store.write(STATE_DOC, kept);
  },
];

const at = z.number().optional().describe('The time to count to (ms); the last event’s if unset');

/** The time of the record's last event, for the queries that count time held. */
const lastT = (s: GameRecord): number => Math.max(s.ball.holder?.since ?? 0, s.ball.readAt ?? 0);

export const norelecStatePlugin: Plugin = statePlugin<GameRecord & Record<string, unknown>>({
  id: NORELEC_STATE,
  version: '0.1.0',
  description:
    "NorelecBot's game, kept: houses, babies and locks, trips, the ⚽ and its hold times, bans",
  schema: recordSchema,
  initial: initialRecord() as GameRecord & Record<string, unknown>,
  consumes: CONSUMES,
  reduce: (state, event) => reduceRecord(state, event) as GameRecord & Record<string, unknown>,
  events: STATE_EVENTS,
  announce,
  migrations: MIGRATIONS,
  queries: {
    player: {
      help: 'A player as last seen: house, carried emoji, trip, balls from /profile, banned',
      input: name,
      output: z.unknown(),
      run: (s, input: { name: string }) => s.players[input.name] ?? null,
    },
    house: {
      help: "A player's house: its slots (empty ones null), the slots babies lock and until when (`locks`), when read",
      input: name,
      output: z.unknown(),
      run: (s, input: { name: string }) => houseOf(s, input.name) ?? null,
    },
    trip: {
      help: "A player's trip under way: from, to, start, arriveAt and returnAt (ms), 🚀 carried",
      input: name,
      output: z.unknown(),
      run: (s, input: { name: string }) => tripOf(s, input.name) ?? null,
    },
    ball: {
      help: 'The ⚽: its holder and since when, and every player’s time held (s), most first',
      input: z.object({ at }),
      output: z.unknown(),
      run: (s, input: { at?: number }) => ({
        holder: s.ball.holder ?? null,
        totals: ballTotals(s, input.at ?? lastT(s)),
      }),
    },
    held: {
      help: 'The seconds a player held the ⚽, the hold under way included',
      input: name.extend({ at }),
      output: z.number(),
      run: (s, input: { name: string; at?: number }) =>
        heldSeconds(s, input.name, input.at ?? lastT(s)),
    },
    babies: {
      help: 'The babies seen (of one house, or all): birth, slot, stages seen and when, when due to leave, gone',
      input: z.object({ name: z.string().optional() }),
      output: z.unknown(),
      run: (s, input: { name?: string }) => babiesOf(s, input.name),
    },
    banned: {
      help: 'The players the game bans, with since when',
      output: z.record(z.string(), z.number()),
      run: (s) =>
        Object.fromEntries(
          Object.entries(s.players).flatMap(([n, p]) =>
            p.banned === undefined ? [] : [[n, p.banned]]
          )
        ),
    },
    price: {
      help: 'The price of an emoji (or `quote`), as the bot last stated it; null if never',
      input: z.object({ emoji: z.string() }),
      output: z.unknown(),
      run: (s, input: { emoji: string }) => s.prices[input.emoji] ?? null,
    },
  },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [norelecStatePlugin];
