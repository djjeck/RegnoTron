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
 * - **The training** (src/training.ts): the owner's success in any chat (`loregame.training`, which
 *   the shell cannot pair in the group) starts its cooldown in the readiness, and a level-up it
 *   brings adds its items to the inventory, as a turn's does. Every player's trainings are kept with
 *   the players (§6.1 of docs/game-bots.md).
 *
 * - **The owner's readiness** (MegaBotTron1999's bot-os.md D141): when each of the bot's commands
 *   may be played, which a shell player asks before each, in the section `readiness` the shell's
 *   `ReadinessModel` (`LORE_READINESS`) reduces from the parser's events, with the accumulo's
 *   mechanics (src/accumulo.ts); and the facts this state knows besides, folded in by
 *   `foldReadiness`: the owner's ban holds every command until it ends, and the bot's answer to the
 *   owner's `/accumulo` in any chat (`loregame.accumulo`, which the shell cannot pair in the group)
 *   uses it (a use: the turn's rest ended) or withdraws its unlock (not full, or under the level,
 *   which also holds it for `LOCKED_RETRY_MS`).
 *
 * Any other outcome (a "too soon", a fight lost, the item lost) changes nothing: the state records
 * facts, and the parser has already read the reply. An item or a player may be named anything
 * (players write them), `__proto__` included, so both are read and written as own properties.
 */
import { type BusEvent } from '@megabottron1999/core';
import { ReadinessModel, type ReadinessState } from '@megabottron1999/turns/readiness.ts';
import { type Announcement, type Mark } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import { ACCUMULO, ACCUMULO_MAX, ACCUMULO_MECHANICS, LOCKED_RETRY_MS } from '#src/accumulo.ts';
import {
  ACCUMULO_EVENT,
  BAN_EVENT,
  LOREGAME_PARSER,
  LOREGAME_VOCABULARY,
  PLAYER_ACCUMULO_EVENT,
  PLAYER_TURN_EVENT,
  TRAINING_EVENT,
  UNBAN_EVENT,
} from '#src/plugins/loregame.ts';
import { loreRestMs, type Outcome } from '#src/replies.ts';
import { TRAINING, TRAINING_COOLDOWN_MIN, TRAINING_MECHANICS } from '#src/training.ts';

/** The plugin's id, and the namespace of its events (`loregame-state.changed`). */
export const LOREGAME_STATE = 'loregame-state';

/**
 * The parser's events it applies: the owner's turns, the bans, the accumulo, the trainings, every
 * player's.
 */
const TURN_EVENT = `${LOREGAME_PARSER}.turn`;
export const CONSUMES: readonly string[] = [
  TURN_EVENT,
  BAN_EVENT,
  UNBAN_EVENT,
  ACCUMULO_EVENT,
  PLAYER_TURN_EVENT,
  PLAYER_ACCUMULO_EVENT,
  TRAINING_EVENT,
];

/**
 * The owner's readiness at @LoreGameBot (D141): the parser's vocabulary, and the accumulo's and the
 * training's mechanics, declared here, on the state's side.
 */
export const LORE_READINESS = new ReadinessModel({
  parser: { id: LOREGAME_PARSER, ...LOREGAME_VOCABULARY },
  mechanics: { [ACCUMULO]: ACCUMULO_MECHANICS, [TRAINING]: TRAINING_MECHANICS },
});

/** The key of the owner's ban, and of the level gate, among the readiness's holds. */
const BAN_HOLD = 'ban';
const LEVEL_HOLD = 'level';

/**
 * The facts this state knows besides the parser's answers, folded into the owner's readiness
 * (D141, pure): the owner's ban holds every command until it ends, or until the bot serves them
 * again; the bot's answer to the owner's `/accumulo`, wherever it came, uses it or withdraws its
 * unlock (the level gate also holding it for `LOCKED_RETRY_MS`); the owner's training, wherever it
 * came, starts its cooldown (a "too soon" replies to the command, which the shell pairs).
 */
export function foldReadiness(r: ReadinessState, e: BusEvent): ReadinessState {
  if ((e.type === BAN_EVENT || e.type === UNBAN_EVENT) && e['owner'] === true) {
    const until = e['until'];
    return LORE_READINESS.hold(
      r,
      BAN_HOLD,
      e.type === UNBAN_EVENT
        ? undefined
        : {
            ...(typeof until === 'number' ? { until } : {}),
            why: 'the owner is banned',
          }
    );
  }
  if (e.type === TRAINING_EVENT)
    return e['owner'] === true && e['result'] === 'trained'
      ? LORE_READINESS.succeed(r, TRAINING, e.t)
      : r;
  if (e.type !== ACCUMULO_EVENT) return r;
  const result = e['result'];
  if (result === 'used') return LORE_READINESS.succeed(r, ACCUMULO, e.t);
  // "Already ready" spends nothing and says it is full: it holds nothing back.
  if (result !== 'short' && result !== 'locked') return r;
  const locked = LORE_READINESS.lock(r, ACCUMULO);
  return result === 'short'
    ? locked
    : LORE_READINESS.hold(locked, LEVEL_HOLD, {
        until: e.t + LOCKED_RETRY_MS,
        why: 'under the level the bot asks',
        commands: [ACCUMULO],
      });
}

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

/** A player as the state sees them: what their turns and answers in the chats it reads say. */
const player = z.object({
  as_of: z.string().describe('Latest change'),
  game: z
    .object({
      name: z.string().nullable().describe('Their name in the game, as a fight names them'),
      level: z.number().nullable().describe('Their level, as a fight or a level-up says'),
    })
    .describe('In the game'),
  turns: z.number().describe('Turns seen'),
  unseen: z.number().describe('Turns a "too soon" told of, played where the account does not read'),
  unseen_uses: z
    .number()
    .describe('Uses of the accumulo a turn told of, coming before the rest was over'),
  double_turns: z
    .number()
    .describe('A turn within a minute of the last, which the bot answered as a turn'),
  last_turn: date.describe('Last turn seen'),
  last_command: z.string().nullable().describe('The turn command of the last turn seen'),
  rest_until: date.describe('Rests until, as their last turn or "too soon" says'),
  accumulo: accumulo.describe('Accumulo'),
  training: z
    .object({
      seen: z.number().describe('Trainings seen'),
      unseen: z
        .number()
        .describe('Trainings a "too soon" told of, played where the account does not read'),
      last: date.describe('Last training seen'),
      until: date.describe('The next one waits until, as their last training or "too soon" says'),
    })
    .describe('Training'),
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
  players: z.record(z.string(), player).describe('Players'),
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
export type Player = z.infer<typeof player>;
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
    players: {},
    inventory: { held: 0, items: {} },
  };
}

/** A player first heard of at `at`: nothing known yet. */
export function initialPlayer(at: string): Player {
  return {
    as_of: at,
    game: { name: null, level: null },
    turns: 0,
    unseen: 0,
    unseen_uses: 0,
    double_turns: 0,
    last_turn: null,
    last_command: null,
    rest_until: null,
    accumulo: initialAccumulo(),
    training: initialTraining(),
  };
}

/** A player's training, nothing known. */
export function initialTraining(): Player['training'] {
  return { seen: 0, unseen: 0, last: null, until: null };
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
  fight: z
    .looseObject({ player: z.object({ name: z.string(), level: z.number() }).optional() })
    .optional(),
  retryMs: z.number().optional(),
});

function outcomeOf(e: BusEvent): z.infer<typeof outcomeSchema> | undefined {
  const o = outcomeSchema.safeParse(e['outcome']);
  return o.success ? o.data : undefined;
}

/** What a player's training event says (the parser's `loregame.training`). */
const trainingSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  result: z.enum(['trained', 'soon']),
  retryMs: z.number().optional(),
  levelUp: z.looseObject({ level: z.number().optional(), items: z.array(reward) }).optional(),
});

/**
 * The items an event gains for the owner: a turn's drop and level-up, a training's level-up; none
 * for anything else.
 */
function gainsOf(e: BusEvent): Gain[] {
  if (e.type === TRAINING_EVENT) {
    const t = trainingSchema.safeParse(e);
    if (!t.success || !t.data.owner || t.data.result !== 'trained') return [];
    return (t.data.levelUp?.items ?? [])
      .map((r): Gain => ({ ...r, via: 'level-up' }))
      .filter((g) => g.qty > 0 && g.item !== '');
  }
  if (e.type !== TURN_EVENT) return [];
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

/**
 * The accumulo after a training of the owner's: a level-up that reaches the level the gate names
 * opens it, as a turn's does.
 */
function afterTraining(a: Accumulo, e: BusEvent): Accumulo {
  const t = trainingSchema.safeParse(e);
  const level = t.success && t.data.owner ? t.data.levelUp?.level : undefined;
  return a.locked !== null && level !== undefined && level >= a.locked
    ? { ...a, as_of: asIso(e.t), locked: null, count: 0, exact: false }
    : a;
}

/**
 * The state after an event, as to the accumulo: a turn charges it, the bot's answer sets it, a
 * training's level-up may open it.
 */
function reduceAccumulo(state: LoreState, e: BusEvent): LoreState {
  const a =
    e.type === TURN_EVENT
      ? afterTurn(state.accumulo, e)
      : e.type === ACCUMULO_EVENT
        ? afterReply(state.accumulo, e)
        : e.type === TRAINING_EVENT
          ? afterTraining(state.accumulo, e)
          : state.accumulo;
  if (a === state.accumulo) return state;
  return { ...state, owner: { ...state.owner, as_of: asIso(e.t) }, accumulo: a };
}

/** The level that unlocks the accumulo [M] (its gate: "Devi essere almeno di livello 4!"). */
const ACCUMULO_LEVEL = 4;
/** How soon after a turn another may be answered as a turn of its own [M]: within a minute. */
const DOUBLE_MS = 60_000;
/** How much sooner than the rest we predicted a turn must come to tell of a use of the accumulo. */
const EARLY_MS = 2 * 60_000;

/** What a player's event names: whose. */
const playerEventSchema = z.looseObject({ player: z.string() });

/**
 * A player after a turn of theirs, or a "too soon": a turn counted, their rest, their name and
 * level in the game, their accumulo charged; a "too soon" while we held them rested tells of a turn
 * played where the account does not read (their private chat), which charged their accumulo and
 * leaves its count a floor.
 */
function playerAfterTurn(p: Player, e: BusEvent): Player {
  const o = outcomeOf(e);
  if (o === undefined) return p;
  const at = asIso(e.t);
  if (o.kind === 'nothing' && o.reason === 'cooldown') {
    const rested = p.rest_until === null || Date.parse(p.rest_until) <= e.t;
    const missed = rested && p.last_turn !== null;
    return {
      ...p,
      as_of: at,
      ...(o.retryMs === undefined ? {} : { rest_until: asIso(e.t + o.retryMs) }),
      ...(missed
        ? {
            unseen: p.unseen + 1,
            accumulo: { ...p.accumulo, count: p.accumulo.count + 1, exact: false },
          }
        : {}),
    };
  }
  if (o.place === undefined) return p;
  const restMs = loreRestMs(o as unknown as Outcome);
  const fought = o.fight?.player;
  const level = o.levelUp?.level ?? fought?.level ?? p.game.level;
  let accumulo = p.accumulo;
  // A turn well before the rest we predicted, with the accumulo full: it was used where we did
  // not hear (their private chat), so it starts again from 0 before this turn. Not full, the rest
  // was ended otherwise (an item), and the accumulo is not touched.
  const command = typeof e['command'] === 'string' ? e['command'] : null;
  // A turn within a minute of the last: the bot answers it as a turn at times [M] (most often a
  // /lore after an /avventura; docs/game-bots.md §2), so it tells of no use.
  // (A use the account heard since explains it first.)
  const usedSince =
    accumulo.used_at !== null && p.last_turn !== null && accumulo.used_at >= p.last_turn;
  const double = !usedSince && p.last_turn !== null && e.t - Date.parse(p.last_turn) <= DOUBLE_MS;
  const full =
    accumulo.ready || (accumulo.exact && accumulo.count >= (accumulo.max ?? ACCUMULO_MAX));
  const early =
    !double &&
    full &&
    p.last_turn !== null &&
    p.rest_until !== null &&
    Date.parse(p.rest_until) - e.t > EARLY_MS &&
    (accumulo.used_at === null || accumulo.used_at < p.last_turn);
  if (early)
    accumulo = { ...accumulo, count: 0, exact: true, ready: false, used_at: at, locked: null };
  // Below level 4 nothing charges it [M]: a level known from a fight or a level-up says so.
  if (level !== null && level < ACCUMULO_LEVEL && accumulo.locked === null)
    accumulo = { ...accumulo, locked: ACCUMULO_LEVEL, count: 0, exact: true, ready: false };
  else if (
    level !== null &&
    level >= ACCUMULO_LEVEL &&
    accumulo.locked !== null &&
    o.levelUp === undefined
  )
    accumulo = { ...accumulo, locked: null, exact: false };
  return {
    ...p,
    as_of: at,
    game: { name: fought?.name ?? p.game.name, level },
    turns: p.turns + 1,
    ...(early ? { unseen_uses: p.unseen_uses + 1 } : {}),
    ...(double ? { double_turns: p.double_turns + 1 } : {}),
    last_turn: at,
    last_command: command ?? p.last_command,
    rest_until: restMs === undefined ? p.rest_until : asIso(e.t + restMs),
    accumulo: afterTurn(accumulo, e),
  };
}

/** How much later than the wait we predicted a training "too soon" may end, and agree. */
const TRAINING_SLACK_MS = 2 * 60_000;

/**
 * A player after their training, or a "too soon" to it: a training counted, with its wait of a day,
 * and a level-up's level; a "too soon" whose wait ends well after the one we predicted tells of a
 * training played where the account does not read (their private chat).
 */
function playerAfterTraining(p: Player, e: BusEvent): Player {
  const t = trainingSchema.safeParse(e);
  if (!t.success) return p;
  const at = asIso(e.t);
  const was = p.training;
  if (t.data.result === 'trained')
    return {
      ...p,
      as_of: at,
      game: { ...p.game, level: t.data.levelUp?.level ?? p.game.level },
      training: {
        ...was,
        seen: was.seen + 1,
        last: at,
        until: asIso(e.t + TRAINING_COOLDOWN_MIN * 60_000),
      },
    };
  if (t.data.retryMs === undefined) return p;
  // The bot's wait ends well after the one we predicted: a training since, which we did not see.
  const end = e.t + t.data.retryMs;
  const missed =
    was.last !== null && (was.until === null || end - Date.parse(was.until) > TRAINING_SLACK_MS);
  return {
    ...p,
    as_of: at,
    training: {
      ...was,
      ...(missed ? { unseen: was.unseen + 1 } : {}),
      until: asIso(e.t + t.data.retryMs),
    },
  };
}

/** The state after an event, as to the players: any player's turn, `/accumulo` or training. */
function reducePlayers(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== PLAYER_TURN_EVENT && e.type !== PLAYER_ACCUMULO_EVENT && e.type !== TRAINING_EVENT)
    return state;
  const said = playerEventSchema.safeParse(e);
  if (!said.success || said.data.player === '') return state;
  const name = said.data.player;
  const at = asIso(e.t);
  const known = Object.hasOwn(state.players, name);
  const before = known ? (state.players[name] as Player) : initialPlayer(at);
  let after = before;
  if (e.type === PLAYER_TURN_EVENT) after = playerAfterTurn(before, e);
  else if (e.type === TRAINING_EVENT) after = playerAfterTraining(before, e);
  else {
    const a = afterReply(before.accumulo, e);
    if (a !== before.accumulo) after = { ...before, as_of: at, accumulo: a };
  }
  if (after === before && known) return state;
  return { ...state, players: { ...state.players, [name]: after } };
}

/** The next state: an event's gains added to the inventory, a ban set or ended (pure). */
export function reduce(state: LoreState, e: BusEvent): LoreState {
  const withBans = reducePlayers(reduceAccumulo(reduceBans(state, e), e), e);
  // The inventory is the owner's: their turns and trainings alone, not another player's.
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

/** A player as the state keeps them, by username; none if never heard of. */
export const playerOf = (s: LoreState, name: string): Player | null =>
  Object.hasOwn(s.players, name) ? (s.players[name] as Player) : null;

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
  const o = e.type === TURN_EVENT ? outcomeOf(e) : undefined;
  if (o?.kind === 'nothing' && o.reason === 'truncated') marks['inventory'] = 'uncertain';
  return marks;
}

/** How many of each item the owner holds, as the state estimates it. */
export function held(s: LoreState): Record<string, number> {
  return Object.fromEntries(
    Object.entries(s.inventory.items).flatMap(([n, h]) => (h.qty > 0 ? [[n, h.qty]] : []))
  );
}
