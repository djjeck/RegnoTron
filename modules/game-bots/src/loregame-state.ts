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
 *   level-up of the owner's gives (`loregame.levelUp`, whatever brought it). A holding is `exact: false` until a whole listing says
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
 *   the shell cannot pair in the group) starts its cooldown in the readiness. Every player's
 *   trainings are kept with the players (§6.1 of docs/game-bots.md).
 *
 * - **Levels and XP** (§5.4, §6.1): a level-up is an event of its own (`loregame.levelUp`), whatever
 *   brought it: it sets a player's level, opens their accumulo at its level, and gives the owner its
 *   items. The XP the account sees a player gain (the "+N" of a fight won, of a training) is
 *   counted, and each level-up records how much was seen since the last one: the ground for
 *   expecting the next, once the profile tells the thresholds.
 *
 * - **The owner's readiness** (MegaBotTron1999's bot-os.md D141): when each of the bot's commands
 *   may be played, which a shell player asks before each, in the section `readiness` the shell's
 *   `ReadinessModel` (`LORE_READINESS`) reduces from the parser's events, with the accumulo's
 *   mechanics (src/accumulo.ts); and the facts this state knows besides, folded in by
 *   `foldReadiness`: the owner's ban holds every command until it ends, and the bot's answer to the
 *   owner's `/accumulo` in any chat (`loregame.accumulo`, which the shell cannot pair in the group)
 *   uses it (a use: the turn's rest ended) or withdraws its unlock (not full, or under the level,
 *   which also holds it for `LOCKED_RETRY_MS`). And a rule of the game's over the shell's readiness
 *   (`LoreReadinessModel`): `/accumulo` is legal only while the turn rests, which is when the bot
 *   takes it.
 *
 * Any other outcome (a "too soon", a fight lost, the item lost) changes nothing: the state records
 * facts, and the parser has already read the reply. An item or a player may be named anything
 * (players write them), `__proto__` included, so both are read and written as own properties.
 */
import { type BusEvent } from '@megabottron1999/core';
import {
  type Readiness,
  ReadinessModel,
  type ReadinessState,
} from '@megabottron1999/turns/readiness.ts';
import { type Announcement, type Mark } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import { ACCUMULO, ACCUMULO_MAX, ACCUMULO_MECHANICS, LOCKED_RETRY_MS } from '#src/accumulo.ts';
import {
  ACCUMULO_EVENT,
  BAN_EVENT,
  EQUIPMENT_EVENT,
  GIFT_EVENT,
  INVENTORY_EVENT,
  LEVEL_UP_EVENT,
  LOREGAME_PARSER,
  LOREGAME_VOCABULARY,
  PLAYER_ACCUMULO_EVENT,
  PLAYER_TURN_EVENT,
  PROFILE_EVENT,
  REQUIREMENTS_EVENT,
  SKILLS_EVENT,
  TRAINING_EVENT,
  TRAVEL_EVENT,
  UNBAN_EVENT,
} from '#src/plugins/loregame.ts';
import { levelForXp, xpForLevel } from '#src/profile.ts';
import { loreRestMs, type Outcome } from '#src/replies.ts';
import {
  mismatches,
  move,
  set,
  skillsBought,
  type StatDrift,
  type Stats,
  STATS_DRIFT_KEPT,
  statsOf,
} from '#src/stats.ts';
import { TRAINING, TRAINING_COOLDOWN_MIN, TRAINING_MECHANICS } from '#src/training.ts';

/** The plugin's id, and the namespace of its events (`loregame-state.changed`). */
export const LOREGAME_STATE = 'loregame-state';

/**
 * The parser's events it applies: the owner's turns, the bans, the accumulo, the trainings, the
 * level-ups, the profiles, the skills menus and the equipment, every player's.
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
  LEVEL_UP_EVENT,
  PROFILE_EVENT,
  SKILLS_EVENT,
  EQUIPMENT_EVENT,
  INVENTORY_EVENT,
  TRAVEL_EVENT,
  REQUIREMENTS_EVENT,
  GIFT_EVENT,
];

/**
 * The owner's readiness at @LoreGameBot (D141): the parser's vocabulary, and the accumulo's and the
 * training's mechanics, declared here, on the state's side.
 */
export class LoreReadinessModel extends ReadinessModel {
  /**
   * Each command's readiness at `now`, the shell's, with the game's rule over `/accumulo`: it is
   * legal only while the turn rests (docs/game-bots.md §5.2). The bot refuses it otherwise, "La
   * lore è già pronta!", and spends nothing: there is no rest to end.
   */
  override ready(state: ReadinessState, now: number): Record<string, Readiness> {
    const r = super.ready(state, now);
    const accumulo = r[ACCUMULO];
    if (accumulo?.ready === true && r[this.turn]?.ready === true) {
      const { since: _, ...seen } = accumulo;
      r[ACCUMULO] = { ...seen, ready: false, why: `${this.turn} is not resting: nothing to end` };
    }
    return r;
  }
}

export const LORE_READINESS = new LoreReadinessModel({
  parser: { id: LOREGAME_PARSER, ...LOREGAME_VOCABULARY },
  mechanics: { [ACCUMULO]: ACCUMULO_MECHANICS, [TRAINING]: TRAINING_MECHANICS },
});

/**
 * The turn's rest ended at `t`, by a use of the accumulo: the game's rule, which no declared
 * effect carries (so that the player derives no condition from one). Pure.
 */
function endRest(r: ReadinessState, t: number): ReadinessState {
  const turn = LORE_READINESS.turn;
  const was = r.commands[turn];
  if (was?.readyAt === undefined || was.readyAt <= t) return r;
  return {
    ...r,
    commands: {
      ...r.commands,
      [turn]: { ...was, readyAt: t, why: `${was.why ?? 'held'}, cut by ${ACCUMULO}` },
    },
  };
}

/** The key of the owner's ban, and of the level gate, among the readiness's holds. */
const BAN_HOLD = 'ban';
const LEVEL_HOLD = 'level';

/**
 * The facts this state knows besides the parser's answers, folded into the owner's readiness
 * (D141, pure): the owner's ban holds every command until it ends, or until the bot serves them
 * again; the bot's answer to the owner's `/accumulo`, wherever it came, uses it or withdraws its
 * unlock (the level gate also holding it for `LOCKED_RETRY_MS`); the owner's training, wherever it
 * came, starts its cooldown (a "too soon" replies to the command, which the shell pairs); and a
 * turn of the owner's without the accumulo's line withdraws its unlock: the bot's word that it is
 * not full, whatever the state believed (a use it did not hear, a start that knew nothing).
 */
export function foldReadiness(r: ReadinessState, e: BusEvent): ReadinessState {
  if (e.type === TURN_EVENT) {
    const o = outcomeOf(e);
    // A turn says it only when whole (one cut off lost its line) and not quoting it (a story's).
    const whole = o?.place !== undefined && !(o.kind === 'nothing' && o.reason === 'truncated');
    return whole && o.accumulo === undefined ? LORE_READINESS.lock(r, ACCUMULO) : r;
  }
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
  // A use ends the turn's rest, the game's rule.
  if (result === 'used') return endRest(LORE_READINESS.succeed(r, ACCUMULO, e.t), e.t);
  // "Already ready" is refused: there was no rest to end, nothing is spent, and the accumulo stays
  // full. It is illegal until the turn rests (`LoreReadinessModel`), so it holds nothing back here.
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

const holding = z.object({
  qty: z.number().describe('Count'),
  exact: z.boolean().describe('Exact'),
  date: date.describe('Set'),
  via: z.enum(['drop', 'level-up', 'listing', 'gift']).describe('By'),
  rarity: z.string().nullable().describe('Rarity'),
  tags: z.array(z.string()).describe('Tags'),
  level: z
    .object({ low: z.number(), high: z.number() })
    .nullable()
    .optional()
    .describe("An equippable item's level range, as a listing gave it"),
});

/** An inventory: its items, by name, how many are held, and when a whole listing last set it. */
const inventorySchema = z.object({
  held: z.number().describe('Items held'),
  items: z.record(z.string(), holding).describe('Items'),
  listed: date.describe('Listed whole (/zaino, every page): every item exact then'),
});

/** An equipped item: its name and level range. */
const equippedSchema = z
  .object({
    item: z.string(),
    level: z.object({ low: z.number(), high: z.number() }).nullable(),
  })
  .nullable();

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
  xp: z
    .object({
      seen: z.number().describe('XP seen gained, net (turns, fights, trainings)'),
      since_level: z
        .number()
        .nullable()
        .describe('XP seen since their last level-up seen (none: no level-up seen yet)'),
      level_ups: z
        .array(
          z.object({
            level: z.number().describe('The level reached'),
            at: z.string().describe('When'),
            xp: z
              .number()
              .nullable()
              .describe('XP seen since the level-up before (none: that one was not seen)'),
          })
        )
        .describe('The latest level-ups seen'),
    })
    .describe('XP'),
  profile: z
    .object({
      as_of: z.string().describe('Given'),
      company: z.string().nullable().describe('Company'),
      level: z.number().describe('Level'),
      xp: z.number().describe('XP (⚔️)'),
      progress: z.number().nullable().describe('Towards the next level (%)'),
      alignment: z.enum(['Bene', 'Male', 'Neutrale']).describe('Alignment'),
      episode: z.number().describe('Episodes: the turns they took'),
      recipes: z.number().nullable().describe('Recipes completed'),
      coins: z.number().describe('Coins (₭)'),
      obsession: z
        .object({ item: z.string(), count: z.number() })
        .nullable()
        .describe('Obsessed with'),
      equipment: z
        .object({ armour: equippedSchema, amulet: equippedSchema, weapon: equippedSchema })
        .describe('Equipped'),
      skills: z.record(z.string(), z.number()).describe('Skills, by name: their level (1–5)'),
      effects: z
        .array(z.object({ name: z.string(), until: date.describe('Ends, as the time left says') }))
        .describe('Effects'),
      titles: z.array(z.string()).describe('Titles'),
      location: z
        .object({ name: z.string(), code: z.string() })
        .nullable()
        .describe('Where they are'),
      unread: z.array(z.string()).describe('Lines the grammar could not read'),
    })
    .nullable()
    .describe('Their last profile (/info), as the bot gave it'),
  stats: z
    .record(
      z.string(),
      z.object({
        value: z.unknown(),
        exact: z.boolean().describe('Every change since the profile was seen'),
        as_of: z.string().describe('Changed'),
      })
    )
    .describe(
      'Their stats now: the last profile’s, moved by each command read since (none before a profile)'
    ),
  inventory: inventorySchema.describe(
    "Their inventory (the owner's is the state's own `inventory`, kept apart)"
  ),
  listing: z
    .object({
      chat: z.string(),
      message: z.string(),
      items: z.record(z.string(), holding),
      cut: z.boolean(),
    })
    .nullable()
    .describe('The pages of their inventory listing read so far, from its first'),
  gear: z
    .record(
      z.string(),
      z.object({
        slot: z.enum(['armour', 'amulet', 'weapon']),
        level: z.object({ low: z.number(), high: z.number() }).nullable(),
      })
    )
    .describe('Their equippable items seen, by name: the slot each goes in, and its level range'),
  stats_drift: z
    .array(
      z.object({
        stat: z.string(),
        expected: z.unknown(),
        said: z.unknown(),
        at: z.string().describe('Told'),
      })
    )
    .describe('The latest stats held exactly that the next profile said otherwise'),
});

/** The level-ups kept per player, newest last. */
const LEVEL_UPS_KEPT = 10;

/** The state's schema: its sections, each described for the panel. */
export const stateSchema = z.object({
  owner: z
    .object({
      as_of: date.describe('Latest change'),
      name: z.string().nullable().describe('Their username, once told (a ban, a profile)'),
    })
    .describe('Owner'),
  bans: z.record(z.string(), ban).describe('Banned players'),
  accumulo: accumulo.describe('Accumulo'),
  players: z.record(z.string(), player).describe('Players'),
  inventory: inventorySchema.describe('Inventory'),
  places: z
    .record(
      z.string(),
      z.object({
        name: z.string(),
        level: z.number().nullable().describe('The level it asks'),
        items: z
          .array(
            z.object({
              item: z.string(),
              rarity: z.string(),
              tags: z.array(z.string()),
              level: z.object({ low: z.number(), high: z.number() }).nullable(),
            })
          )
          .describe('The items entering takes, one each'),
        exits: z
          .array(z.object({ name: z.string(), code: z.string() }))
          .describe('Where one can go'),
        as_of: z.string().describe('Told'),
      })
    )
    .describe("The game's places, by code: what entering each takes, and where one can go from it"),
});

export type Holding = z.infer<typeof holding>;
export type Inventory = z.infer<typeof inventorySchema>;
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
    inventory: initialInventory(),
    places: {},
  };
}

/** An inventory nothing is known of. */
export function initialInventory(): Inventory {
  return { held: 0, items: {}, listed: null };
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
    xp: initialXp(),
    profile: null,
    stats: {},
    inventory: initialInventory(),
    listing: null,
    gear: {},
    stats_drift: [],
  };
}

/** A player's XP, nothing seen. */
export function initialXp(): Player['xp'] {
  return { seen: 0, since_level: null, level_ups: [] };
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
  place: z.looseObject({}).optional(),
  accumulo: z.object({ ready: z.boolean(), sure: z.boolean() }).optional(),
  fight: z
    .looseObject({
      result: z.string().optional(),
      player: z.object({ name: z.string(), level: z.number() }).optional(),
      learned: z.number().optional(),
    })
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
  learned: z.number().optional(),
  extra: z.number().optional(),
});

/** What a profile event says (the parser's `loregame.profile`). */
const profileSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  company: z.string().nullable(),
  level: z.number(),
  xp: z.number(),
  progress: z.number().nullable(),
  alignment: z.enum(['Bene', 'Male', 'Neutrale']),
  episode: z.number(),
  recipes: z.number().nullable(),
  coins: z.number(),
  obsession: z.object({ item: z.string(), count: z.number() }).nullable(),
  equipment: z.object({ armour: equippedSchema, amulet: equippedSchema, weapon: equippedSchema }),
  skills: z.record(z.string(), z.number()),
  effects: z.array(z.object({ name: z.string(), leftMs: z.number().nullable() })),
  titles: z.array(z.string()),
  location: z.object({ name: z.string(), code: z.string() }).nullable(),
  unread: z.array(z.string()),
});

/** What a level-up event says (the parser's `loregame.levelUp`). */
const levelUpSchema = z.looseObject({
  coins: z.number().optional(),
  skillPoints: z.number().optional(),
  player: z.string(),
  owner: z.boolean(),
  level: z.number(),
  items: z.array(reward),
});

/** Whose inventory an event moves: the owner's (the state's own), or another player's. */
type Whose = { owner: true } | { owner: false; player: string };

/**
 * The items an event gains, and whose: a turn's drop, a level-up's items (whatever brought it), the
 * owner's or another player's; none for anything else. The owner's turn is told twice (its
 * `loregame.turn` and its `loregame.playerTurn`): it counts from the first.
 */
function gainsOf(e: BusEvent): { whose: Whose; gains: Gain[] } | undefined {
  const real = (gains: Gain[]) => gains.filter((g) => g.qty > 0 && g.item !== '');
  if (e.type === LEVEL_UP_EVENT) {
    const u = levelUpSchema.safeParse(e);
    if (!u.success || (!u.data.owner && u.data.player === '')) return undefined;
    return {
      whose: u.data.owner ? { owner: true } : { owner: false, player: u.data.player },
      gains: real(u.data.items.map((r): Gain => ({ ...r, via: 'level-up' }))),
    };
  }
  if (e.type === PLAYER_TURN_EVENT) {
    const player = e['player'];
    if (e['owner'] === true || typeof player !== 'string' || player === '') return undefined;
    const gains = turnGains(e);
    return gains.length === 0 ? undefined : { whose: { owner: false, player }, gains };
  }
  if (e.type !== TURN_EVENT) return undefined;
  const gains = turnGains(e);
  return gains.length === 0 ? undefined : { whose: { owner: true }, gains };
}

/** What a turn dropped. */
function turnGains(e: BusEvent): Gain[] {
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
  // Under the level the accumulo is not charged; the level-up that reaches it opens it
  // (`afterLevelUp`), after the turn that brought it, which charges nothing.
  if (a.locked !== null) return a;
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

/** The accumulo after a level-up: one that reaches the level its gate names opens it, empty. */
function afterLevelUp(a: Accumulo, level: number, t: number): Accumulo {
  return a.locked !== null && level >= a.locked
    ? { ...a, as_of: asIso(t), locked: null, count: 0, exact: false }
    : a;
}

/**
 * The state after an event, as to the accumulo: a turn charges it, the bot's answer sets it, a
 * level-up of the owner's may open it.
 */
function reduceAccumulo(state: LoreState, e: BusEvent): LoreState {
  const a =
    e.type === TURN_EVENT
      ? afterTurn(state.accumulo, e)
      : e.type === ACCUMULO_EVENT
        ? afterReply(state.accumulo, e)
        : e.type === LEVEL_UP_EVENT
          ? ownerLevelUp(state.accumulo, e)
          : state.accumulo;
  if (a === state.accumulo) return state;
  return { ...state, owner: { ...state.owner, as_of: asIso(e.t) }, accumulo: a };
}

/** The owner's accumulo after a level-up event, theirs or another player's (which changes none). */
function ownerLevelUp(a: Accumulo, e: BusEvent): Accumulo {
  const u = levelUpSchema.safeParse(e);
  return u.success && u.data.owner ? afterLevelUp(a, u.data.level, e.t) : a;
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
            // A turn unseen (one at least): what it moved, we cannot tell.
            stats: ['xp', 'episode', 'location', 'level'].reduce(
              (st, stat) =>
                move(st, stat, (v) => (stat === 'episode' ? Number(v) + 1 : v), false, at),
              p.stats
            ),
          }
        : {}),
    };
  }
  if (o.place === undefined) return p;
  const restMs = loreRestMs(o as unknown as Outcome);
  const fought = o.fight?.player;
  // A fight's line names the level before a level-up the turn brings (`loregame.levelUp`, after).
  const level = fought?.level ?? p.game.level;
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
  else if (level !== null && level >= ACCUMULO_LEVEL && accumulo.locked !== null)
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
    xp: gained(p.xp, turnXp(o)[0]),
    stats: afterTurnStats(p.stats, o, at),
  };
}

/**
 * A player's stats after a turn of theirs: its XP (§5.4), one more episode, the place it was in
 * (where the profile says they are: the last turn's place in all 31 of the owner's [M]), and the
 * level the XP makes, when it is exact.
 */
function afterTurnStats(stats: Stats, o: z.infer<typeof outcomeSchema>, at: string): Stats {
  const [n, known] = turnXp(o);
  let next = move(stats, 'xp', (v) => Number(v) + n, known, at);
  next = move(next, 'episode', (v) => Number(v) + 1, true, at);
  const place = o.place as { name?: unknown; code?: unknown } | undefined;
  if (typeof place?.name === 'string' && typeof place.code === 'string')
    next = set(next, 'location', { name: place.name, code: place.code }, true, at);
  return levelled(next, at);
}

/** The level the XP makes, when the XP is exact and makes more than the level held. */
function levelled(stats: Stats, at: string): Stats {
  const xp = Object.hasOwn(stats, 'xp') ? stats['xp'] : undefined;
  const level = Object.hasOwn(stats, 'level') ? stats['level'] : undefined;
  if (xp?.exact !== true || level === undefined) return stats;
  const made = levelForXp(Number(xp.value));
  return made > Number(level.value) ? set(stats, 'level', made, level.exact, at) : stats;
}

/**
 * The XP a turn gives [M] (docs/game-bots.md §5.4): 1, plus a fight won's "+N", less 2 for a fight
 * lost; and whether that is all of it (a draw, or a turn cut off before its fight's end, is not
 * known to give the same).
 */
function turnXp(o: z.infer<typeof outcomeSchema>): [number, boolean] {
  const fight = o.fight?.result;
  if (fight === 'won') return [1 + (o.fight?.learned ?? 0), true];
  if (fight === 'lost') return [-1, true];
  if (fight === undefined) return [1, !(o.kind === 'nothing' && o.reason === 'truncated')];
  return [1, false];
}

/** XP gained (`n`, a loss if negative): the XP seen, and since the last level-up. */
function gained(xp: Player['xp'], n: number): Player['xp'] {
  if (n === 0) return xp;
  return {
    ...xp,
    seen: xp.seen + n,
    since_level: xp.since_level === null ? null : xp.since_level + n,
  };
}

/**
 * A player after their profile: the profile kept, each stat as it says, the effects' time left as
 * when they end; their stats checked against it (each held exactly and said otherwise, a mismatch
 * kept in `stats_drift`) and seeded from it again, exact; their level set from it, and their
 * accumulo opened or closed at the level its gate names.
 */
function playerAfterProfile(p: Player, e: BusEvent): Player {
  const r = profileSchema.safeParse(e);
  if (!r.success) return p;
  const at = asIso(e.t);
  const d = r.data;
  const accumulo =
    d.level < ACCUMULO_LEVEL && p.accumulo.locked === null
      ? { ...p.accumulo, locked: ACCUMULO_LEVEL, count: 0, exact: true, ready: false }
      : afterLevelUp(p.accumulo, d.level, e.t);
  const profile: NonNullable<Player['profile']> = {
    as_of: at,
    company: d.company,
    level: d.level,
    xp: d.xp,
    progress: d.progress,
    alignment: d.alignment,
    episode: d.episode,
    recipes: d.recipes,
    coins: d.coins,
    obsession: d.obsession,
    equipment: d.equipment,
    skills: d.skills,
    effects: d.effects.map((f) => ({
      name: f.name,
      until: f.leftMs === null ? null : asIso(e.t + f.leftMs),
    })),
    titles: d.titles,
    location: d.location,
    unread: d.unread,
  };
  const said = statsOf(profile, at);
  return {
    ...checked(p, said, e.t, at),
    as_of: at,
    game: { ...p.game, level: d.level },
    accumulo,
    profile,
    gear: learnt(p.gear, profile.equipment),
  };
}

/**
 * A player after a snapshot of some of their stats (a profile, the skills menu, the slots listed):
 * each held exactly that it says otherwise kept as a mismatch, then those it says seeded from it,
 * exact; the others kept as they were.
 */
function checked(p: Player, said: Stats, t: number, at: string): Player {
  const explained = bought(p.stats, said);
  const found: StatDrift[] = mismatches(p.stats, explained.said, t, at).filter(
    (d) => !explained.stats.includes(d.stat)
  );
  said = explained.said;
  return {
    ...p,
    stats: { ...p.stats, ...said },
    stats_drift:
      found.length === 0 ? p.stats_drift : [...p.stats_drift, ...found].slice(-STATS_DRIFT_KEPT),
  };
}

/**
 * The skills a snapshot says that points spent with the menu's buttons explain (docs/game-bots.md
 * §5.6): levels only raised, as many as the points left fell (a menu, which says them), or no more
 * than the points held (a profile, which does not, and then has them spent). Those are no
 * mismatch; anything else is.
 */
function bought(expected: Stats, said: Stats): { said: Stats; stats: string[] } {
  const n = skillsBought(expected, said);
  const points = Object.hasOwn(expected, 'skill_points') ? expected['skill_points'] : undefined;
  if (n === undefined || n === 0 || points?.exact !== true) return { said, stats: [] };
  const held = Number(points.value);
  const left = Object.hasOwn(said, 'skill_points') ? said['skill_points'] : undefined;
  if (left !== undefined)
    return held - Number(left.value) === n
      ? { said, stats: ['skills', 'skill_points'] }
      : { said, stats: [] };
  if (n > held) return { said, stats: [] };
  const skills = said['skills'] as Stats[string];
  return {
    // The points it spent, from those held: what it explains, not what it says.
    said: { ...said, skill_points: { value: held - n, exact: true, as_of: skills.as_of } },
    stats: ['skills', 'skill_points'],
  };
}

type Gear = Player['gear'];
type Worn = NonNullable<Player['profile']>['equipment'];
const SLOT_NAMES = ['armour', 'amulet', 'weapon'] as const;

/** The gear known, with each item worn in `equipment` learnt: its slot and its level range. */
function learnt(gear: Gear, equipment: Worn): Gear {
  let next = gear;
  for (const slot of SLOT_NAMES) {
    const worn = equipment[slot];
    if (worn === null) continue;
    const was = Object.hasOwn(next, worn.item) ? next[worn.item] : undefined;
    if (was?.slot === slot && JSON.stringify(was.level) === JSON.stringify(worn.level)) continue;
    next = { ...next };
    Object.defineProperty(next, worn.item, {
      value: { slot, level: worn.level },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next;
}

/** The slot an item's tag says it goes in ("equipaggiabile 🗡"), if one does. */
function slotOfTags(tags: readonly string[]): (typeof SLOT_NAMES)[number] | undefined {
  for (const t of tags) {
    if (!t.startsWith('equipaggiabile ')) continue;
    if (t.includes('🗡')) return 'weapon';
    if (t.includes('🩺')) return 'amulet';
    if (t.includes('🛡') || t.includes('🥋')) return 'armour';
  }
  return undefined;
}

/** What a skills menu event says (the parser's `loregame.skills`). */
const skillsSchema = z.looseObject({
  skills: z.array(z.object({ name: z.string(), level: z.number() })),
  points: z.number(),
});

/** A player after their skills menu: their skills and points left, checked, then seeded. */
function playerAfterSkills(p: Player, e: BusEvent): Player {
  const r = skillsSchema.safeParse(e);
  if (!r.success) return p;
  const at = asIso(e.t);
  const skills: Record<string, number> = {};
  for (const s of r.data.skills)
    if (s.level > 0)
      Object.defineProperty(skills, s.name, {
        value: s.level,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return {
    ...checked(
      p,
      {
        skills: { value: skills, exact: true, as_of: at },
        skill_points: { value: r.data.points, exact: true, as_of: at },
      },
      e.t,
      at
    ),
    as_of: at,
  };
}

/** What an equipment event says (the parser's `loregame.equipment`). */
const equipSchema = z.looseObject({
  kind: z.enum(['equipped', 'removed', 'listing']),
  item: z.string().optional(),
  removed: z.string().nullable().optional(),
  equipment: z
    .object({ armour: equippedSchema, amulet: equippedSchema, weapon: equippedSchema })
    .optional(),
});

/**
 * A player after an answer to their `/equipaggia`: the slots listed, checked and seeded; an item
 * equipped in the slot of the one it replaced, else in the slot their gear or their drops' tags
 * say it goes in, with the level range their gear knows; an item taken off, its slot emptied. A
 * slot or a range the state cannot tell leaves the equipment not exact.
 */
function playerAfterEquip(p: Player, e: BusEvent, inventory: LoreState['inventory']): Player {
  const r = equipSchema.safeParse(e);
  if (!r.success) return p;
  const at = asIso(e.t);
  const d = r.data;
  if (d.kind === 'listing' && d.equipment !== undefined)
    return {
      ...checked(p, { equipment: { value: d.equipment, exact: true, as_of: at } }, e.t, at),
      as_of: at,
      gear: learnt(p.gear, d.equipment),
    };
  const held = Object.hasOwn(p.stats, 'equipment') ? p.stats['equipment'] : undefined;
  if (held === undefined || d.item === undefined) return p;
  const worn = held.value as Worn;
  const where = (item: string) => SLOT_NAMES.find((s) => worn[s]?.item === item);
  if (d.kind === 'removed') {
    const slot = where(d.item);
    return {
      ...p,
      as_of: at,
      stats: set(
        p.stats,
        'equipment',
        slot === undefined ? worn : { ...worn, [slot]: null },
        held.exact && slot !== undefined,
        at
      ),
    };
  }
  const known = Object.hasOwn(p.gear, d.item) ? p.gear[d.item] : undefined;
  const holding = Object.hasOwn(inventory.items, d.item) ? inventory.items[d.item] : undefined;
  const slot =
    (d.removed === null || d.removed === undefined ? undefined : where(d.removed)) ??
    known?.slot ??
    (holding === undefined ? undefined : slotOfTags(holding.tags));
  return {
    ...p,
    as_of: at,
    stats: set(
      p.stats,
      'equipment',
      slot === undefined
        ? worn
        : { ...worn, [slot]: { item: d.item, level: known?.level ?? null } },
      held.exact && slot !== undefined && known !== undefined,
      at
    ),
  };
}

/**
 * A player after a level-up, whatever brought it: their level, their accumulo opened at its level,
 * and the XP seen since the last level-up recorded with it (none if that one was not seen).
 */
function playerAfterLevelUp(p: Player, e: BusEvent): Player {
  const u = levelUpSchema.safeParse(e);
  if (!u.success) return p;
  const at = asIso(e.t);
  const { level } = u.data;
  // The bot's word on the level; its coins; and they hold its threshold at least [M]: XP short of
  // it missed a gain.
  let stats = set(p.stats, 'level', level, true, at);
  stats = move(stats, 'coins', (v) => Number(v) + (u.data.coins ?? 0), true, at);
  stats = move(stats, 'skill_points', (v) => Number(v) + (u.data.skillPoints ?? 0), true, at);
  const xp = Object.hasOwn(stats, 'xp') ? stats['xp'] : undefined;
  if (xp !== undefined && Number(xp.value) < xpForLevel(level))
    stats = set(stats, 'xp', xpForLevel(level), false, at);
  return {
    ...p,
    as_of: at,
    game: { ...p.game, level },
    accumulo: afterLevelUp(p.accumulo, level, e.t),
    stats,
    xp: {
      ...p.xp,
      since_level: 0,
      level_ups: [...p.xp.level_ups, { level, at, xp: p.xp.since_level }].slice(-LEVEL_UPS_KEPT),
    },
  };
}

/** How much later than the wait we predicted a training "too soon" may end, and agree. */
const TRAINING_SLACK_MS = 2 * 60_000;

/**
 * A player after their training, or a "too soon" to it: a training counted, with its wait of a day,
 * and the XP it gave; a "too soon" whose wait ends well after the one we predicted tells of a
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
      // The "+N" is the XP it gives, Calistenico's extra included [M] (docs/game-bots.md §5.3).
      xp: gained(p.xp, t.data.learned ?? 0),
      stats: levelled(
        move(p.stats, 'xp', (v) => Number(v) + (t.data.learned ?? 0), true, at),
        at
      ),
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

/**
 * The state after an event, as to the players: any player's turn, `/accumulo`, training or
 * level-up.
 */
function reducePlayers(state: LoreState, e: BusEvent): LoreState {
  if (
    e.type !== PLAYER_TURN_EVENT &&
    e.type !== PLAYER_ACCUMULO_EVENT &&
    e.type !== TRAINING_EVENT &&
    e.type !== LEVEL_UP_EVENT &&
    e.type !== PROFILE_EVENT &&
    e.type !== SKILLS_EVENT &&
    e.type !== EQUIPMENT_EVENT
  )
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
  else if (e.type === LEVEL_UP_EVENT) after = playerAfterLevelUp(before, e);
  else if (e.type === PROFILE_EVENT) after = playerAfterProfile(before, e);
  else if (e.type === SKILLS_EVENT) after = playerAfterSkills(before, e);
  else if (e.type === EQUIPMENT_EVENT)
    // Their inventory's tags tell an item's slot: the owner's is the state's own.
    after = playerAfterEquip(before, e, e['owner'] === true ? state.inventory : before.inventory);
  else {
    const a = afterReply(before.accumulo, e);
    if (a !== before.accumulo) after = { ...before, as_of: at, accumulo: a };
  }
  if (after === before && known) return state;
  return { ...state, players: { ...state.players, [name]: after } };
}

/** The owner's username, as any event of theirs names them (a profile, a listing, a turn). */
function reduceOwner(state: LoreState, e: BusEvent): LoreState {
  const player = e['player'];
  if (e['owner'] !== true || typeof player !== 'string') return state;
  if (player === '' || player === state.owner.name) return state;
  return { ...state, owner: { as_of: asIso(e.t), name: player } };
}

/** The next state: an event's gains added to the inventory, a ban set or ended (pure). */
/** The reducer's steps, in order: each a part of the state, after an event. */
const STEPS: readonly ((s: LoreState, e: BusEvent) => LoreState)[] = [
  reduceBans,
  reduceOwner,
  reduceAccumulo,
  reducePlayers,
  reduceListing,
  reducePlaces,
  reduceGift,
];

export function reduce(state: LoreState, e: BusEvent): LoreState {
  const next = STEPS.reduce((s, step) => step(s, e), state);
  // Each inventory: the owner's drops and level-ups in theirs, another player's in theirs.
  const gained = gainsOf(e);
  if (gained === undefined || gained.gains.length === 0) return next;
  const at = asIso(e.t);
  const inv = inventoryOf(next, gained.whose);
  if (inv === undefined) return next;
  let items = inv.items;
  for (const g of gained.gains) {
    const before = own(items, g.item);
    items = withItem(items, g.item, {
      qty: (before?.qty ?? 0) + g.qty,
      // An item none of: none held, if the inventory was listed whole since.
      exact: before?.exact ?? inv.listed !== null,
      date: at,
      via: g.via,
      rarity: g.rarity === '' ? (before?.rarity ?? null) : g.rarity,
      tags: g.tags,
      ...(before?.level === undefined ? {} : { level: before.level }),
    });
  }
  return withInventory(next, gained.whose, { ...inv, items, held: heldOf(items) }, at);
}

/** How many items an inventory holds: those of a count above none. */
const heldOf = (items: Record<string, Holding>): number =>
  Object.values(items).filter((h) => h.qty > 0).length;

/** Items with `name` set to `h`, as an own property whatever the name (`__proto__` too). */
function withItem(
  items: Record<string, Holding>,
  name: string,
  h: Holding
): Record<string, Holding> {
  const next = { ...items };
  Object.defineProperty(next, name, {
    value: h,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
}

/** A player's inventory: the owner's, the state's own; another's, theirs, if the state knows them. */
function inventoryOf(s: LoreState, whose: Whose): Inventory | undefined {
  return whose.owner ? s.inventory : playerOf(s, whose.player)?.inventory;
}

/** The state with a player's inventory `inv`, changed at `at`. */
function withInventory(s: LoreState, whose: Whose, inv: Inventory, at: string): LoreState {
  if (whose.owner) return { ...s, owner: { ...s.owner, as_of: at }, inventory: inv };
  const p = playerOf(s, whose.player);
  if (p === null) return s;
  return { ...s, players: { ...s.players, [whose.player]: { ...p, as_of: at, inventory: inv } } };
}

const placeItem = z.object({
  item: z.string(),
  rarity: z.string(),
  tags: z.array(z.string()),
  level: z.object({ low: z.number(), high: z.number() }).nullable(),
});
const placeOf = z.object({ name: z.string(), code: z.string() });
/** What a move event says (the parser's `loregame.travel`). */
const travelSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  kind: z.enum(['arrived', 'here', 'refused']),
  place: placeOf,
  consumed: z.array(placeItem).optional(),
  exits: z.array(placeOf.extend({ locked: z.boolean() })).optional(),
});
/** What a requirements event says (the parser's `loregame.requirements`). */
const requirementsSchema = z.looseObject({
  place: placeOf,
  level: z.number().nullable(),
  items: z.array(placeItem),
});

/**
 * The state after a move or a place (docs/game-bots.md §5.9): a player arrived at a place, or told
 * where they are, is there (`location`, exact), and an arrival takes from their inventory the items
 * entering consumed, as the bot lists them, one each; a place's requirements, wherever the bot
 * states them, and where one can go from it, are the game's (`places`).
 */
function reducePlaces(state: LoreState, e: BusEvent): LoreState {
  const at = asIso(e.t);
  if (e.type === REQUIREMENTS_EVENT) {
    const r = requirementsSchema.safeParse(e);
    if (!r.success) return state;
    const { place, level, items } = r.data;
    const was = Object.hasOwn(state.places, place.code) ? state.places[place.code] : undefined;
    return {
      ...state,
      places: {
        ...state.places,
        [place.code]: { name: place.name, level, items, exits: was?.exits ?? [], as_of: at },
      },
    };
  }
  if (e.type !== TRAVEL_EVENT) return state;
  const r = travelSchema.safeParse(e);
  if (!r.success || r.data.player === '' || r.data.kind === 'refused') return state;
  const d = r.data;
  let s = state;
  if (d.kind === 'here' && d.exits !== undefined) {
    const was = Object.hasOwn(s.places, d.place.code) ? s.places[d.place.code] : undefined;
    s = {
      ...s,
      places: {
        ...s.places,
        [d.place.code]: {
          name: d.place.name,
          level: was?.level ?? null,
          items: was?.items ?? [],
          exits: d.exits.map((x) => ({ name: x.name, code: x.code })),
          as_of: at,
        },
      },
    };
  }
  const p = playerOf(s, d.player) ?? initialPlayer(at);
  s = {
    ...s,
    players: {
      ...s.players,
      [d.player]: {
        ...p,
        as_of: at,
        stats: set(p.stats, 'location', { name: d.place.name, code: d.place.code }, true, at),
      },
    },
  };
  const consumed = d.consumed ?? [];
  if (consumed.length === 0) return s;
  const whose: Whose = d.owner ? { owner: true } : { owner: false, player: d.player };
  const inv = inventoryOf(s, whose);
  if (inv === undefined) return s;
  let items = inv.items;
  for (const c of consumed) {
    const h = own(items, c.item);
    // One taken; an item the state held none of leaves its count at none, and not exact.
    if (h === undefined) continue;
    items = withItem(items, c.item, {
      ...h,
      qty: Math.max(0, h.qty - 1),
      exact: h.exact && h.qty > 0,
      date: at,
    });
  }
  return withInventory(s, whose, { ...inv, items, held: heldOf(items) }, at);
}

/** What a gift event says (the parser's `loregame.gift`). */
const giftSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  kind: z.enum(['item', 'coins']),
  to: z.string(),
  toOwner: z.boolean(),
  item: z.string().optional(),
  qty: z.number().optional(),
  rarity: z.string().optional(),
  tags: z.array(z.string()).optional(),
  level: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
  coins: z.number().optional(),
});

/**
 * The state after a gift (docs/game-bots.md §5.10): the items leave the giver's inventory and
 * reach the receiver's, or the coins the one's coins and the other's; the receiver known by their
 * name whatever its case (the giver types it), a player first heard of so.
 */
function reduceGift(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== GIFT_EVENT) return state;
  const r = giftSchema.safeParse(e);
  if (!r.success) return state;
  const d = r.data;
  const at = asIso(e.t);
  let s = state;
  const named = (n: string): string =>
    Object.keys(s.players).find((k) => k.toLowerCase() === n.toLowerCase()) ?? n;
  const giver: Whose | undefined = d.owner
    ? { owner: true }
    : d.player === ''
      ? undefined
      : { owner: false, player: named(d.player) };
  const receiver: Whose = d.toOwner ? { owner: true } : { owner: false, player: named(d.to) };
  for (const w of [giver, receiver])
    if (w !== undefined && !w.owner && playerOf(s, w.player) === null)
      s = { ...s, players: { ...s.players, [w.player]: initialPlayer(at) } };
  /** A player's coins moved by `n`, their stats' (the owner's, by their name once known). */
  const coins = (w: Whose, n: number): void => {
    const key = w.owner ? s.owner.name : w.player;
    const p = key === null ? null : playerOf(s, key);
    if (p === null || key === null) return;
    const stats = move(p.stats, 'coins', (v) => Number(v) + n, true, at);
    s = { ...s, players: { ...s.players, [key]: { ...p, as_of: at, stats } } };
  };
  if (d.kind === 'coins') {
    const n = d.coins ?? 0;
    if (giver !== undefined) coins(giver, -n);
    coins(receiver, n);
    return s;
  }
  if (d.item === undefined || d.qty === undefined) return s;
  const item = d.item;
  const n = d.qty;
  if (giver !== undefined) {
    const inv = inventoryOf(s, giver);
    const h = inv === undefined ? undefined : own(inv.items, item);
    if (inv !== undefined && h !== undefined) {
      const items = withItem(inv.items, item, {
        ...h,
        qty: Math.max(0, h.qty - n),
        exact: h.exact && h.qty >= n,
        date: at,
      });
      s = withInventory(s, giver, { ...inv, items, held: heldOf(items) }, at);
    }
  }
  const inv = inventoryOf(s, receiver);
  if (inv === undefined) return s;
  const h = own(inv.items, item);
  const items = withItem(inv.items, item, {
    qty: (h?.qty ?? 0) + n,
    exact: h?.exact ?? inv.listed !== null,
    date: at,
    via: 'gift',
    rarity: d.rarity ?? h?.rarity ?? null,
    tags: d.tags ?? h?.tags ?? [],
    ...(d.level === undefined ? {} : { level: d.level }),
  });
  return withInventory(s, receiver, { ...inv, items, held: heldOf(items) }, at);
}

/** Every place the state knows of, by code. */
export const placesOf = (s: LoreState): LoreState['places'] => s.places;

/** What an inventory listing event says (the parser's `loregame.inventory`). */
const listingSchema = z.looseObject({
  chat: z.string(),
  player: z.string(),
  owner: z.boolean(),
  filter: z.string().nullable(),
  items: z.array(
    z.object({
      item: z.string(),
      qty: z.number(),
      rarity: z.string(),
      tags: z.array(z.string()),
      level: z.object({ low: z.number(), high: z.number() }).nullable(),
    })
  ),
  cut: z.boolean(),
  page: z.object({ first: z.boolean(), last: z.boolean() }).nullable(),
  message: z.string().nullable(),
});

/**
 * The state after an inventory listing, or a page of one (docs/game-bots.md §5.8): each item it
 * lists held exactly as it says. Its pages are read in turn, from the first, as its buttons turn
 * them (one at a time, so reaching the last saw them all): with the last, the listing is whole, and
 * the inventory is it alone, every item exact, those it does not list gone; an item held exactly
 * that it says otherwise is a mismatch (`stats_drift`, `inventory`). A filtered listing (`/i
 * <text>`), a page with no buttons (an export, a shell before D145), a chain whose first page was
 * not read, or an item cut between two pages, is a part: exact for what it lists, and no more. An
 * empty inventory has no pages: it is whole.
 */
function reduceListing(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== INVENTORY_EVENT) return state;
  const r = listingSchema.safeParse(e);
  if (!r.success || r.data.player === '') return state;
  const d = r.data;
  const at = asIso(e.t);
  const whose: Whose = d.owner ? { owner: true } : { owner: false, player: d.player };
  let s = state;
  if (playerOf(s, d.player) === null)
    s = { ...s, players: { ...s.players, [d.player]: initialPlayer(at) } };
  const p = playerOf(s, d.player) as Player;
  const inv = inventoryOf(s, whose) as Inventory;
  let page: Record<string, Holding> = {};
  for (const i of d.items)
    page = withItem(page, i.item, {
      qty: i.qty,
      exact: true,
      date: at,
      via: 'listing',
      rarity: i.rarity,
      tags: i.tags,
      level: i.level,
    });
  let items = inv.items;
  for (const [name, h] of Object.entries(page)) items = withItem(items, name, h);
  // The pages of a whole listing, from its first.
  let listing = p.listing;
  const paged = d.filter === null && d.page !== null && d.message !== null;
  if (paged && d.page?.first === true)
    listing = { chat: d.chat, message: d.message as string, items: page, cut: d.cut };
  else if (paged && listing?.chat === d.chat && listing.message === d.message) {
    let all = listing.items;
    for (const [name, h] of Object.entries(page)) all = withItem(all, name, h);
    listing = { ...listing, items: all, cut: listing.cut || d.cut };
  } else if (paged) listing = null;
  const empty = d.filter === null && d.page === null && d.items.length === 0 && !d.cut;
  const whole = empty
    ? page
    : paged && d.page?.last === true && listing !== null && !listing.cut
      ? listing.items
      : undefined;
  let found: StatDrift[] = [];
  let listed = inv.listed;
  if (whole !== undefined) {
    found = inventoryDrift(inv, whole, at);
    items = whole;
    listed = at;
    listing = null;
  }
  const next = withInventory(s, whose, { held: heldOf(items), items, listed }, at);
  const after = playerOf(next, d.player) as Player;
  return {
    ...next,
    players: {
      ...next.players,
      [d.player]: {
        ...after,
        listing: whole === undefined ? listing : null,
        stats_drift:
          found.length === 0
            ? after.stats_drift
            : [...after.stats_drift, ...found].slice(-STATS_DRIFT_KEPT),
      },
    },
  };
}

/**
 * The items held exactly (or known none of, the inventory listed whole since) that a whole listing
 * says otherwise of: one mismatch, `inventory`, the counts each expected and said.
 */
function inventoryDrift(inv: Inventory, whole: Record<string, Holding>, at: string): StatDrift[] {
  const expected: Record<string, number> = {};
  const said: Record<string, number> = {};
  const names = new Set([
    ...Object.keys(inv.items),
    ...(inv.listed === null ? [] : Object.keys(whole)),
  ]);
  for (const name of names) {
    const was = own(inv.items, name);
    if (was !== undefined && !was.exact) continue;
    if (was === undefined && inv.listed === null) continue;
    const now = own(whole, name)?.qty ?? 0;
    const then = was?.qty ?? 0;
    if (now === then) continue;
    Object.defineProperty(expected, name, { value: then, enumerable: true });
    Object.defineProperty(said, name, { value: now, enumerable: true });
  }
  return Object.keys(expected).length === 0 ? [] : [{ stat: 'inventory', expected, said, at }];
}

/** Who holds an item, by its name, as the state knows: each player (the owner too) and how many. */
export function holdersOf(
  s: LoreState,
  item: string
): { player: string; qty: number; exact: boolean }[] {
  const out: { player: string; qty: number; exact: boolean }[] = [];
  const mine = own(s.inventory.items, item);
  if (mine !== undefined && mine.qty > 0)
    out.push({ player: s.owner.name ?? '', qty: mine.qty, exact: mine.exact });
  for (const [name, p] of Object.entries(s.players)) {
    if (name === s.owner.name) continue;
    const h = own(p.inventory.items, item);
    if (h !== undefined && h.qty > 0) out.push({ player: name, qty: h.qty, exact: h.exact });
  }
  return out.sort((a, b) => b.qty - a.qty);
}

/** A player's inventory, the owner's unless named; null for a player the state does not know. */
export function inventoryOfPlayer(s: LoreState, player?: string): Inventory | null {
  if (player === undefined || player === s.owner.name) return s.inventory;
  return playerOf(s, player)?.inventory ?? null;
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
  return [
    ...set,
    ...ended,
    ...announceAccumulo(before.accumulo, after.accumulo, e),
    ...announceStats(before, after, e),
  ];
}

/** Each stat a snapshot (a profile, the skills menu, the slots listed) said otherwise of. */
function announceStats(before: LoreState, after: LoreState, e: BusEvent): Announcement[] {
  const name = e['player'];
  const snapshot =
    e.type === PROFILE_EVENT ||
    e.type === SKILLS_EVENT ||
    e.type === EQUIPMENT_EVENT ||
    e.type === INVENTORY_EVENT;
  if (!snapshot || typeof name !== 'string') return [];
  // A profile's mismatches carry its time; one already told (a profile at the same second) is not
  // told again.
  const at = asIso(e.t);
  const told = new Set(
    (playerOf(before, name)?.stats_drift ?? []).filter((d) => d.at === at).map((d) => d.stat)
  );
  const fresh = (playerOf(after, name)?.stats_drift ?? []).filter(
    (d) => d.at === at && !told.has(d.stat)
  );
  return fresh.map((d) => ({
    type: 'statsDrift',
    payload: {
      player: name,
      owner: e['owner'] === true,
      stat: d.stat,
      expected: d.expected,
      said: d.said,
    },
  }));
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

/**
 * A player's last profile (the owner's unless named), whole, or one stat of it by its dotted path
 * (`level`, `coins`, `skills.Stoccaggio`, `equipment.weapon.level`): null if the state holds no
 * profile of theirs, or the profile has no such stat. Read as own properties only (players name
 * skills and items: `__proto__` is a name like any other).
 */
export function profileOf(s: LoreState, player?: string, stat?: string): unknown {
  const name = player ?? s.owner.name;
  const profile = name === null ? null : (playerOf(s, name)?.profile ?? null);
  if (profile === null || stat === undefined || stat === '') return profile;
  let at: unknown = profile;
  for (const key of stat.split('.')) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key)) return null;
    at = (at as Record<string, unknown>)[key];
  }
  return at ?? null;
}

/**
 * A player's stat now (the owner's unless named), by its dotted path (`xp`, `coins`,
 * `skills.Stoccaggio`): its value there, whether it is exact, and when it changed; null before a
 * profile, or for a stat it does not hold. Own properties only.
 */
export function statOf(
  s: LoreState,
  stat: string,
  player?: string
): { value: unknown; exact: boolean; as_of: string } | null {
  const name = player ?? s.owner.name;
  const stats = name === null ? undefined : playerOf(s, name)?.stats;
  const [head, ...path] = stat.split('.');
  if (stats === undefined || head === undefined || !Object.hasOwn(stats, head)) return null;
  const held = stats[head] as { value: unknown; exact: boolean; as_of: string };
  let at: unknown = held.value;
  for (const key of path) {
    if (typeof at !== 'object' || at === null || !Object.hasOwn(at, key)) return null;
    at = (at as Record<string, unknown>)[key];
  }
  return { value: at ?? null, exact: held.exact, as_of: held.as_of };
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
