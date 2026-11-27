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
 *   history. A ban is the account's, whatever the command: the owner's holds the readiness.
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
 *   uses it (a use: the turn's rest ended) or withdraws its unlock (not full, or under the level):
 *   never a time, only the bot's line on a turn unlocks it again; any player's shop listing uses
 *   `/negozio`, ready again at midnight in Italy (`resetsAt`); and the bot `down` holds every
 *   command until its health moves on. And a rule of the game's over the shell's readiness
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
import { ACCUMULO, ACCUMULO_MAX, ACCUMULO_MECHANICS } from '#src/accumulo.ts';
import { type Companies, type Company, companyOf, idOf, paged, quoted } from '#src/companies.ts';
import { GENERATORS } from '#src/generators.ts';
import { HEALTH_STATES } from '#src/health.ts';
import { initialSchedule, type Point, scheduled, type Via } from '#src/market.ts';
import {
  MEDIA_EVENT,
  type MediaEntry,
  mediaEntrySchema,
  mediaEventSchema,
  withMedia,
} from '#src/media.ts';
import {
  ladderOf,
  NEUTRAL_EFFECT,
  NEUTRAL_MS,
  NEUTRAL_TICKET,
  REQUIREMENTS_COMMANDS,
} from '#src/places.ts';
import {
  ACCUMULO_EVENT,
  BAN_EVENT,
  CASHOUT_EVENT,
  COMPANY_EVENT,
  EQUIPMENT_EVENT,
  GENERATED_EVENT,
  GIFT_EVENT,
  HEALTH_EVENT,
  INVENTORY_EVENT,
  INVEST_EVENT,
  INVESTMENTS_EVENT,
  LEVEL_UP_EVENT,
  LOREGAME_PARSER,
  LOREGAME_VOCABULARY,
  MARKET_EVENT,
  NEUTRAL_EVENT,
  PLAYER_ACCUMULO_EVENT,
  PLAYER_TURN_EVENT,
  PROFILE_EVENT,
  PURCHASE_EVENT,
  RECIPE_EVENT,
  RECIPE_MADE_EVENT,
  RECIPES_EVENT,
  RENAMED_EVENT,
  REQUIREMENTS_EVENT,
  SHOP_EVENT,
  SKILLS_EVENT,
  TRAINING_EVENT,
  TRAVEL_EVENT,
  UNBAN_EVENT,
  USED_EVENT,
} from '#src/plugins/loregame.ts';
import { levelForXp, xpForLevel } from '#src/profile.ts';
import { loreRestMs, type Outcome } from '#src/replies.ts';
import { SHOP, SHOP_MECHANICS, shopDayOf } from '#src/shop.ts';
import { skillLevels } from '#src/skills.ts';
import {
  mismatches,
  move,
  placed,
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
 * The season's start set (#18), as the node's config gives it (`season_start`): never published,
 * handed to the reducer by the node when it differs from the state's.
 */
export const SEASON_EVENT = `${LOREGAME_PARSER}.season`;

/**
 * Sightings of the exports (#19, tools/sightings-seed): each player's steps, first and last seen,
 * by their id; never published, handed to the reducer from its seed. They add to what is kept: a
 * sighting it holds already, or an earlier last, changes nothing.
 */
export const SIGHTINGS_EVENT = `${LOREGAME_PARSER}.sightings`;

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
  RENAMED_EVENT,
  SEASON_EVENT,
  SIGHTINGS_EVENT,
  NEUTRAL_EVENT,
  MARKET_EVENT,
  INVESTMENTS_EVENT,
  INVEST_EVENT,
  CASHOUT_EVENT,
  COMPANY_EVENT,
  SHOP_EVENT,
  PURCHASE_EVENT,
  GENERATED_EVENT,
  USED_EVENT,
  RECIPES_EVENT,
  RECIPE_EVENT,
  RECIPE_MADE_EVENT,
  // A picture fetched: the state's own, handed to its reducer, never published (src/media.ts).
  MEDIA_EVENT,
  HEALTH_EVENT,
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
  mechanics: {
    [ACCUMULO]: ACCUMULO_MECHANICS,
    [TRAINING]: TRAINING_MECHANICS,
    // It asks a place's name, the person's to choose: a player never plays it by default.
    [REQUIREMENTS_COMMANDS[0] as string]: { interactive: true },
    // Listed, it waits for the shop's next items, at midnight in Italy.
    [SHOP]: SHOP_MECHANICS,
  },
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

/** The key of the owner's ban among the readiness's holds. */
const BAN_HOLD = 'ban';
/** The key of the bot's outage among the readiness's holds (#13). */
const DOWN_HOLD = 'down';

/**
 * The facts this state knows besides the parser's answers, folded into the owner's readiness
 * (D141, pure): the owner's ban holds every command until it ends, or until the bot serves them
 * again; the bot's answer to the owner's `/accumulo`, wherever it came, uses it or withdraws its
 * unlock ("not yet", the level gate: no time, the bot's next line unlocks it); the owner's training, wherever it
 * came, starts its cooldown (a "too soon" replies to the command, which the shell pairs); and a
 * turn of the owner's without the accumulo's line withdraws its unlock: the bot's word that it is
 * not full, whatever the state believed (a use it did not hear, a start that knew nothing). Any
 * player's shop listing uses `/negozio`: the shop is the same for everyone, so the owner's would
 * tell nothing new until its items change. While the bot is `down` (its health, §5.16) every
 * command is held, with no end: a send would only join the backlog it replays. Not while
 * `suspect` (mostly a slow bot, and a send then confirms an outage sooner) nor `catching-up` (only
 * a reply to a command sent since it spoke again ends it, so a hold would wait on other players).
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
  if (e.type === SHOP_EVENT) return LORE_READINESS.succeed(r, SHOP, e.t);
  if (e.type === HEALTH_EVENT) {
    const state = e['state'];
    if (typeof state !== 'string' || !(HEALTH_STATES as readonly string[]).includes(state))
      return r;
    return LORE_READINESS.hold(
      r,
      DOWN_HOLD,
      state === 'down' ? { why: 'the bot is down' } : undefined
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
  // "Not yet" and the level gate withdraw its unlock, for no time: the turns it lacks come when
  // they are played, and only the bot's line on a turn, full (so at the level), unlocks it again.
  return result === 'short' || result === 'locked' ? LORE_READINESS.lock(r, ACCUMULO) : r;
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
  via: z
    .enum(['drop', 'level-up', 'listing', 'gift', 'purchase', 'generated', 'used', 'recipe'])
    .describe('By'),
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

/** A recipe as a player's list and answers tell it (§5.14). */
const playerRecipe = z.object({
  level: z.number().nullable().describe('Its level'),
  lacking: z
    .number()
    .nullable()
    .describe('How many items they lack for it, as last told; none if not known'),
  items: z
    .array(z.string())
    .nullable()
    .describe('The items they lack, as its answer named them; none if not known'),
  starred: z
    .boolean()
    .describe('Made by them already: marked [*] in their list, or a make of theirs seen since'),
  as_of: z.string().describe('Told'),
});

/** A player as the state sees them: what their turns and answers in the chats it reads say. */
const player = z.object({
  as_of: z.string().describe('Latest change'),
  name: z
    .string()
    .nullable()
    .describe('Their username, as last seen; none if not known (#17: kept by id, else by name)'),
  high_water: z
    .object({
      step: z.number().describe('The highest step: the number of a place code (B3: 3)'),
      code: z.string().describe("The place's code, its ladder's letter included (B3)"),
      as_of: z.string().describe('When they were last seen there'),
    })
    .nullable()
    .describe(
      'Their high-water mark (#18): the highest ladder step seen at since the season began, never lower; none yet'
    ),
  steps_seen: z
    .record(
      z.string(),
      z.object({
        first: z.string().describe('When first seen there'),
        last: z.string().describe('When last seen there'),
      })
    )
    .describe(
      'Each ladder step seen at, by its place code: when first and last (the mark is drawn from it, #19)'
    ),
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
  investments: z
    .record(
      z.string(),
      z.object({
        invested: z.number().nullable().describe('What they have in it; none if not known'),
        entry: z.number().nullable().describe('The value it was entered at; none if not told'),
        value: z.number().nullable().describe('What it was worth, as last told'),
        as_of: z.string().describe('Told'),
      })
    )
    .describe("Their open investments, by the company's id (`market`), as last told"),
  recipes: z
    .record(z.string(), playerRecipe)
    .describe('Their recipes, by name, as their list and answers last told'),
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

const viaSchema = z
  .enum(['update', 'forced', 'listing'])
  .describe("The bot's own update, one out of turn, or a market listed");
const pointSchema = z.object({
  t: z.string(),
  value: z.number(),
  change: z.number(),
  pct: z.number(),
  via: viaSchema,
});

const companySchema = z.object({
  name: z.string().describe('Its latest name, as the market writes it, emoji included'),
  names: z
    .array(z.object({ name: z.string(), since: z.string() }))
    .describe('Every name it had, each since when'),
  quote: z
    .object({
      value: z.number(),
      change: z.number().describe('Since the update before'),
      pct: z.number(),
      direction: z.enum(['up', 'down', 'flat']),
      via: viaSchema,
      as_of: z.string().describe('Told'),
    })
    .nullable()
    .describe('Its latest value'),
  page: z
    .object({
      size: z.number(),
      max: z.number(),
      leader: z.string(),
      power: z.number(),
      members: z.array(
        z.object({
          player: z.string(),
          faction: z.string(),
          level: z.number(),
          power: z.number(),
        })
      ),
      value: z.number(),
      profile: z.string().nullable(),
      as_of: z.string().describe('Told'),
    })
    .nullable()
    .describe('Its page (/azienda), as last shown'),
  as_of: z.string().describe('Latest change'),
});

const shopItemSchema = z.object({
  item: z.string(),
  rarity: z.string(),
  tags: z.array(z.string()),
  price: z.number().describe('In coins (₭)'),
});

const discoveredVia = z
  .enum(['drop', 'level-up', 'inventory', 'gift', 'place', 'shop', 'generated', 'recipe'])
  .describe(
    'How it was first seen: a turn, a level-up, an inventory, a gift, a place, the shop, a generator, a recipe'
  );
const catalogued = z.object({
  rarity: z.string(),
  tags: z.array(z.string()),
  first: z.string().describe('First seen'),
  via: discoveredVia,
});
export type Catalogued = z.infer<typeof catalogued>;

const ingredient = z.object({
  item: z.string(),
  rarity: z.string(),
  tags: z.array(z.string()),
  qty: z.number().nullable().describe('How many it takes; none if not known'),
});
const recipeSchema = z.object({
  level: z.number().nullable().describe('Its level'),
  ingredients: z.array(ingredient).describe('What it takes, as last told'),
  made: z
    .object({ item: z.string(), rarity: z.string(), tags: z.array(z.string()) })
    .nullable()
    .describe('What it gives, once seen made'),
  as_of: z.string().describe('Told'),
});
export type Recipe = z.infer<typeof recipeSchema>;

/** How many of the bot's outages the health keeps, the oldest dropped first. */
export const OUTAGES_KEPT = 20;
const healthSchema = z.object({
  state: z.enum(HEALTH_STATES),
  since: date.describe('Since when'),
  reason: z.string().describe('What moved it'),
  latency: z.number().nullable().describe("The bot's last reply's latency (ms)"),
  outages: z
    .array(
      z.object({
        start: z.string().describe('Suspected'),
        down: date.describe('Found down'),
        replay: date.describe('Its replay began'),
        end: date.describe('Answering again'),
      })
    )
    .describe('Each time it stopped answering, the latest last'),
});
export type HealthSection = z.infer<typeof healthSchema>;

/** The health of a fresh instance: answering, as far as it knows. */
export function initialHealth(): HealthSection {
  return { state: 'up', since: null, reason: 'nothing heard yet', latency: null, outages: [] };
}

/** The state's schema: its sections, each described for the panel. */
export const stateSchema = z.object({
  owner: z
    .object({
      as_of: date.describe('Latest change'),
      name: z.string().nullable().describe('Their username, once told (a ban, a profile)'),
      id: z.string().nullable().describe("Their stable id, the account's, once told (#17)"),
    })
    .describe('Owner'),
  bans: z.record(z.string(), ban).describe('Banned players'),
  season: z
    .object({
      since: date.describe("The season's start, as the owner set it (none: every sighting counts)"),
    })
    .describe('The season the high-water marks are of (#18)'),
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
          .describe('The items entering takes, one each, whichever way one comes'),
        guardians: z
          .array(z.string())
          .describe(
            'The places a guardian must have been made at, by anyone: a condition, not consumed'
          ),
        exits: z
          .array(z.object({ name: z.string(), code: z.string() }))
          .describe('Where one can go'),
        as_of: z.string().describe('Told'),
        requirements_as_of: z
          .string()
          .nullable()
          .describe(
            'When its level, items and guardians were last told (a statement, an arrival): none if never'
          ),
        media: z
          .array(mediaEntrySchema)
          .describe(
            'Its pictures, newest last: each its id (its bytes in the files), where it was seen'
          ),
      })
    )
    .describe(
      "The game's places, by code: what entering each takes, where one can go from it (as last told), and their pictures"
    ),
  guardians: z
    .record(z.string(), z.boolean())
    .describe(
      'Guardians made: by the code of a place a guardian is asked from, whether one has been made there (by anyone), as last told'
    ),
  market: z
    .object({
      as_of: date.describe('Latest change'),
      companies: z
        .record(z.string(), companySchema)
        .describe(
          "The companies there are, by id: each one's name (its latest, emoji included), its latest value, its page"
        ),
      schedule: z
        .object({
          last: date.describe('The latest update on schedule'),
          period_min: z.number().nullable().describe('The interval learned, in minutes'),
          gaps_min: z.array(z.number()).describe('The latest intervals seen, in minutes'),
          missed: z.array(z.string()).describe('The updates expected and not seen, latest last'),
          pending: date.describe(
            'The latest update off the schedule: the new one, if the next follows it'
          ),
        })
        .describe("The bot's updates: their interval, as their times tell, and those missed"),
    })
    .describe('Market'),
  market_history: z
    .object({
      series: z
        .record(z.string(), z.array(pointSchema))
        .describe("Each company there is's values through time, by id, oldest first"),
      gone: z
        .record(
          z.string(),
          companySchema.extend({
            gone: z.string().describe('Not quoted since'),
            points: z.array(pointSchema).describe('Its values through time, oldest first'),
          })
        )
        .describe(
          'The companies gone (deleted, closed, or missing for now), by id: as they were last, with their history; forgotten two weeks after their newest value'
        ),
    })
    .describe('Market history'),
  shop: z
    .object({
      day: date.describe('The day it sells for: the date in Italy, when it changes (YYYY-MM-DD)'),
      sagra: z.string().nullable().describe("The day's sagra, as the bot names it; none without"),
      items: z.array(shopItemSchema).describe("The day's items, in the listing's order"),
      as_of: date.describe('Last told'),
      bought: z
        .record(z.string(), z.array(z.string()))
        .describe("The day's items each player has bought, as their own listing marks them (✅)"),
      seen: z
        .record(
          z.string(),
          z.object({
            rarity: z.string(),
            tags: z.array(z.string()),
            first: z.string().describe('The first day it was seen on sale (YYYY-MM-DD)'),
            last: z.string().describe('The latest'),
            days: z.number().describe('The days it was seen on sale'),
          })
        )
        .describe('Every item the shop has been seen selling, by name'),
    })
    .describe('Shop'),
  catalogue: z
    .record(z.string(), catalogued)
    .describe(
      'Every item seen in the game, by name: its rarity and tags as last told, when and how first seen'
    ),
  recipes: z
    .record(z.string(), recipeSchema)
    .describe("The game's recipes, by name: their level, what they take and give, as last told"),
  health: healthSchema.describe("The bot's health: whether it is answering now"),
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
    owner: { as_of: null, name: null, id: null },
    bans: {},
    season: { since: null },
    accumulo: initialAccumulo(),
    players: {},
    inventory: initialInventory(),
    places: {},
    guardians: {},
    market: initialMarket(),
    market_history: { series: {}, gone: {} },
    shop: initialShop(),
    catalogue: {},
    recipes: {},
    health: initialHealth(),
  };
}

/** A shop nothing is known of. */
export function initialShop(): LoreState['shop'] {
  return { day: null, sagra: null, items: [], as_of: null, bought: {}, seen: {} };
}

/** A market nothing is known of. */
export function initialMarket(): LoreState['market'] {
  return { as_of: null, companies: {}, schedule: initialSchedule() };
}

/** An inventory nothing is known of. */
export function initialInventory(): Inventory {
  return { held: 0, items: {}, listed: null };
}

/** A player first heard of at `at`: nothing known yet. */
export function initialPlayer(at: string): Player {
  return {
    as_of: at,
    name: null,
    high_water: null,
    steps_seen: {},
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
    investments: {},
    recipes: {},
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
  if (e.type === PURCHASE_EVENT) {
    const b = purchaseSchema.safeParse(e);
    if (!b.success || (!b.data.owner && b.data.player === '')) return undefined;
    const { item, qty, rarity, tags } = b.data;
    return {
      whose: b.data.owner ? { owner: true } : { owner: false, player: b.data.player },
      gains: real([{ item, qty, rarity, tags, via: 'purchase' }]),
    };
  }
  if (e.type === GENERATED_EVENT || e.type === USED_EVENT) {
    const w = whoseOf(e);
    if (w === undefined) return undefined;
    const items =
      e.type === USED_EVENT
        ? (usedSchema.safeParse(e).data?.found ?? [])
        : [generatedSchema.safeParse(e).data?.gained].filter((g) => g != null);
    const via: Gain['via'] = e.type === USED_EVENT ? 'used' : 'generated';
    return {
      whose: w,
      gains: real(items.map(({ item, rarity, tags }) => ({ item, qty: 1, rarity, tags, via }))),
    };
  }
  if (e.type === RECIPE_MADE_EVENT) {
    const w = whoseOf(e);
    const d = recipeMadeSchema.safeParse(e);
    if (w === undefined || !d.success) return undefined;
    const { item, qty, rarity, tags } = d.data.made;
    return { whose: w, gains: real([{ item, qty, rarity, tags, via: 'recipe' }]) };
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
    const username = e['playerName'];
    if (said.data.owner === true && typeof username === 'string' && username !== '')
      name = username;
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
  return { ...state, owner: { ...state.owner, as_of: asIso(e.t), name }, bans };
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
    next = placed(next, { name: place.name, code: place.code }, at);
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
  const skills = skillLevels(r.data);
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
  const player = e['playerName'] ?? e['player'];
  if (e['owner'] !== true || typeof player !== 'string') return state;
  if (player === '' || isId(player) || player === state.owner.name) return state;
  return { ...state, owner: { ...state.owner, as_of: asIso(e.t), name: player } };
}

/** An item an event names, with its rarity: what the catalogue is fed. */
interface Named {
  item: string;
  rarity: string;
  tags: string[];
  via: Catalogued['via'];
}

/** Every item an event names with its rarity (§6, the catalogue), anyone's. */
function namedIn(e: BusEvent): Named[] {
  const of = (
    items: readonly { item: string; rarity: string; tags: string[] }[],
    via: Named['via']
  ) => items.map(({ item, rarity, tags }) => ({ item, rarity, tags, via }));
  if (e.type === LEVEL_UP_EVENT) {
    const u = levelUpSchema.safeParse(e);
    return u.success ? of(u.data.items, 'level-up') : [];
  }
  if (e.type === TURN_EVENT || e.type === PLAYER_TURN_EVENT) return of(turnGains(e), 'drop');
  if (e.type === INVENTORY_EVENT) {
    const l = listingSchema.safeParse(e);
    return l.success ? of(l.data.items, 'inventory') : [];
  }
  if (e.type === GIFT_EVENT) {
    const g = giftSchema.safeParse(e);
    return g.success && g.data.kind === 'item' && g.data.item !== undefined
      ? [{ item: g.data.item, rarity: g.data.rarity ?? '', tags: g.data.tags ?? [], via: 'gift' }]
      : [];
  }
  if (e.type === TRAVEL_EVENT) {
    const t = travelSchema.safeParse(e);
    return t.success ? of(t.data.consumed ?? [], 'place') : [];
  }
  if (e.type === REQUIREMENTS_EVENT) {
    const r = requirementsSchema.safeParse(e);
    return r.success ? of(r.data.items, 'place') : [];
  }
  if (e.type === SHOP_EVENT) {
    const l = shopListingSchema.safeParse(e);
    return l.success ? of(l.data.items, 'shop') : [];
  }
  if (e.type === PURCHASE_EVENT) {
    const b = purchaseSchema.safeParse(e);
    return b.success ? of([b.data], 'shop') : [];
  }
  if (e.type === USED_EVENT) return of(usedSchema.safeParse(e).data?.found ?? [], 'drop');
  if (e.type === RECIPE_EVENT) {
    const d = recipeNeedsSchema.safeParse(e);
    return d.success ? of([...d.data.lacking, ...d.data.held], 'recipe') : [];
  }
  if (e.type === RECIPE_MADE_EVENT) {
    const d = recipeMadeSchema.safeParse(e);
    return d.success ? of([...d.data.used, d.data.made], 'recipe') : [];
  }
  if (e.type === GENERATED_EVENT) {
    const g = generatedSchema.safeParse(e);
    if (!g.success) return [];
    const made =
      g.data.kind === 'item' && g.data.name !== null && g.data.code !== null
        ? [{ item: g.data.name, rarity: g.data.code, tags: [] }]
        : [];
    return of([...made, ...(g.data.gained === null ? [] : [g.data.gained])], 'generated');
  }
  return [];
}

/**
 * The catalogue after `found`, seen at `at`: an item new is added, one known takes the rarity and
 * tags told now; one told without its rarity (a gift's, at times) is added only if new, with none.
 */
export function withCatalogued(
  catalogue: LoreState['catalogue'],
  found: readonly Named[],
  at: string
): LoreState['catalogue'] {
  let next = catalogue;
  for (const f of found) {
    if (f.item === '') continue;
    const was = ownOf(next, f.item);
    if (was === undefined) {
      next = withKey(next, f.item, { rarity: f.rarity, tags: f.tags, first: at, via: f.via });
      continue;
    }
    if (f.rarity === '' || (was.rarity === f.rarity && sameTags(was.tags, f.tags))) continue;
    next = withKey(next, f.item, { ...was, rarity: f.rarity, tags: f.tags });
  }
  return next;
}

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * The catalogue as the state held its items before it kept one (the migration to 0.39.0): every
 * inventory's, the places', the shop's; each first seen when its section last told it, or `at`.
 */
export function catalogueOf(s: LoreState, at: string): LoreState['catalogue'] {
  const found: (Named & { t: string })[] = [];
  const via = (v: Holding['via']): Named['via'] =>
    v === 'listing' ? 'inventory' : v === 'purchase' ? 'shop' : v === 'used' ? 'drop' : v;
  const inventories = [s.inventory, ...Object.values(s.players).map((p) => p.inventory)];
  for (const inv of inventories)
    for (const [item, h] of Object.entries(inv.items))
      found.push({ item, rarity: h.rarity ?? '', tags: h.tags, via: via(h.via), t: h.date ?? at });
  for (const p of Object.values(s.places))
    for (const i of p.items) found.push({ ...i, via: 'place', t: p.as_of === '' ? at : p.as_of });
  for (const [item, x] of Object.entries(s.shop.seen))
    found.push({
      item,
      rarity: x.rarity,
      tags: x.tags,
      via: 'shop',
      t: `${x.first}T00:00:00.000Z`,
    });
  // The earliest first, so that each is first seen at its earliest.
  found.sort((x, y) => x.t.localeCompare(y.t));
  return found.reduce((c, f) => withCatalogued(c, [f], f.t), {} as LoreState['catalogue']);
}

/** Every item seen in the game, by name (§6). */
function reduceCatalogue(state: LoreState, e: BusEvent): LoreState {
  const found = namedIn(e);
  if (found.length === 0) return state;
  const catalogue = withCatalogued(state.catalogue, found, asIso(e.t));
  return catalogue === state.catalogue ? state : { ...state, catalogue };
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
  reduceNeutral,
  reduceMarket,
  reduceShop,
  reducePurchase,
  reduceGenerators,
  reduceRecipes,
  reduceCatalogue,
  reduceMedia,
  reduceHealth,
  reduceHighWater,
];

/** A ladder step: a place code of a ladder (B, M, N) and its number. `X` and others are none. */
export function stepOf(code: string): number | undefined {
  const m = /^[BMN](\d+)$/u.exec(code);
  return m === null ? undefined : Number(m[1]);
}

/** When a player was seen at a step: first and last (#19). */
export type Seen = { first: string; last: string };

/**
 * When a step's sightings count since `since` (#18, #19): from its first, or from the season's
 * start when it was first seen before it and seen again since; none if last seen before it.
 */
function countedFrom(seen: Seen, since: string | null): string | undefined {
  if (since === null) return seen.first;
  if (Date.parse(seen.last) < Date.parse(since)) return undefined;
  return Date.parse(seen.first) < Date.parse(since) ? since : seen.first;
}

/**
 * A player's high-water mark from the steps they were seen at (#18): the highest step seen at or
 * after `since` (all, without one), the latest seen of those at it; none if none.
 */
export function highWaterOf(
  seen: Record<string, Seen>,
  since: string | null
): Player['high_water'] {
  let best: Player['high_water'] = null;
  for (const [code, at] of Object.entries(seen)) {
    const step = stepOf(code);
    if (step === undefined || countedFrom(at, since) === undefined) continue;
    if (best === null || step > best.step || (step === best.step && at.last > best.as_of))
      best = { step, code, as_of: at.last };
  }
  return best;
}

/** A player's mark as of a time (#19): its step, its code, and since when they held it. */
export interface MarkAt {
  step: number;
  code: string;
  since: string;
}

/**
 * The mark a player held at `at` (ms; now, without one) this season (#19): the highest step first
 * seen this season at or before it, and when they first reached it; none before any.
 */
export function markAt(
  seen: Record<string, Seen>,
  since: string | null,
  at?: number
): MarkAt | null {
  let best: MarkAt | null = null;
  for (const [code, s] of Object.entries(seen)) {
    const step = stepOf(code);
    const from = countedFrom(s, since);
    if (step === undefined || from === undefined) continue;
    if (at !== undefined && Date.parse(from) > at) continue;
    if (best === null || step > best.step || (step === best.step && from < best.since))
      best = { step, code, since: from };
  }
  return best;
}

/** `seen` with `code` seen from `first` to `last`, each kept the earliest and latest (#19). */
function seenAt(seen: Record<string, Seen>, code: string, first: string, last: string) {
  const was = Object.hasOwn(seen, code) ? seen[code] : undefined;
  const next = {
    first: was === undefined || first < was.first ? first : was.first,
    last: was === undefined || last > was.last ? last : was.last,
  };
  return was !== undefined && was.first === next.first && was.last === next.last
    ? seen
    : withKey(seen, code, next);
}

/** The player `ref` names, by key (#17) or as the owner, with their steps seen merged with `steps`. */
function withSteps(
  state: LoreState,
  key: string,
  steps: Record<string, Seen>,
  at: string
): LoreState {
  const p = Object.hasOwn(state.players, key) ? (state.players[key] as Player) : initialPlayer(at);
  let steps_seen = p.steps_seen;
  for (const [code, s] of Object.entries(steps))
    if (stepOf(code) !== undefined) steps_seen = seenAt(steps_seen, code, s.first, s.last);
  if (steps_seen === p.steps_seen && Object.hasOwn(state.players, key)) return state;
  const high_water = highWaterOf(steps_seen, state.season.since);
  return { ...state, players: withKey(state.players, key, { ...p, steps_seen, high_water }) };
}

/** The place code an event sees its player at, if one (a turn, an arrival, a `/v`, a profile). */
export function sightingOf(e: BusEvent): string | undefined {
  const code = (p: unknown): string | undefined =>
    typeof p === 'object' && p !== null && typeof (p as { code?: unknown }).code === 'string'
      ? (p as { code: string }).code
      : undefined;
  if (e.type === PLAYER_TURN_EVENT) return code(outcomeOf(e)?.place);
  if (e.type === TRAVEL_EVENT) return e['kind'] === 'refused' ? undefined : code(e['place']);
  if (e.type === PROFILE_EVENT) return code(e['location']);
  return undefined;
}

/**
 * Each player's high-water mark (#18, docs/game-bots.md §6.1): a turn's place, an arrival, a `/v`
 * or a profile's whereabouts is a step they were seen at, kept by its code with when last seen; the
 * mark is the highest seen since the season's start. A new start draws every mark again from what
 * was seen, those seen before it left out.
 */
function reduceHighWater(state: LoreState, e: BusEvent): LoreState {
  if (e.type === SEASON_EVENT) {
    const since = typeof e['since'] === 'string' ? e['since'] : null;
    if (since === state.season.since) return state;
    const players = Object.fromEntries(
      Object.entries(state.players).map(([k, p]) => [
        k,
        { ...p, high_water: highWaterOf(p.steps_seen, since) },
      ])
    );
    return { ...state, season: { since }, players };
  }
  if (e.type === SIGHTINGS_EVENT) return reduceSightings(state, e);
  const code = sightingOf(e);
  if (code === undefined || stepOf(code) === undefined) return state;
  const player = e['player'];
  const key =
    typeof player === 'string' && player !== ''
      ? player
      : e['owner'] === true
        ? ownerKey(state)
        : null;
  if (key === null || key === '') return state;
  const at = asIso(e.t);
  return withSteps(state, key, { [code]: { first: at, last: at } }, at);
}

const sightingsSchema = z.looseObject({
  owner: z.string().nullable().optional(),
  players: z.record(
    z.string(),
    z.object({ steps: z.record(z.string(), z.object({ first: z.string(), last: z.string() })) })
  ),
});

/**
 * A seed's sightings merged (#19): each player's by their id, kept under it, or under the owner's
 * key for the owner's id (the owner's id then known). A player the state keeps by username alone is
 * matched once an event links the name to the id (`relink`), the two then merged.
 */
function reduceSightings(state: LoreState, e: BusEvent): LoreState {
  const r = sightingsSchema.safeParse(e);
  if (!r.success) return state;
  let s = state;
  const owner = r.data.owner ?? null;
  if (owner !== null && s.owner.id === null) {
    s = { ...s, owner: { ...s.owner, id: owner } };
    if (s.owner.name !== null) s = relink(s, { id: owner, name: s.owner.name });
  }
  for (const [id, p] of Object.entries(r.data.players)) {
    const key = id === owner || id === s.owner.id ? (ownerKey(s) ?? id) : (keyIn(s, id) ?? id);
    s = withSteps(s, key, p.steps, asIso(e.t));
  }
  return s;
}

/**
 * The bot's health, as the parser tells each change (src/health.ts): the state, and each outage, from
 * its suspicion to its end, with when it was found down and when its replay began. A suspicion that
 * ended at once is one too: the bot stopped answering for a minute while commands waited.
 */
function reduceHealth(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== HEALTH_EVENT) return state;
  const said = z.enum(HEALTH_STATES).safeParse(e['state']);
  if (!said.success) return state;
  const now = said.data;
  const at = asIso(e.t);
  const was = state.health;
  let outages = [...was.outages];
  const open =
    outages.at(-1)?.end === null ? (outages.pop() as HealthSection['outages'][number]) : undefined;
  if (now === 'up') {
    if (open !== undefined) outages.push({ ...open, end: at });
  } else {
    const o = open ?? { start: at, down: null, replay: null, end: null };
    outages.push({
      ...o,
      down: o.down ?? (now === 'down' ? at : null),
      replay: o.replay ?? (now === 'catching-up' ? at : null),
    });
  }
  outages = outages.slice(-OUTAGES_KEPT);
  const latency = e['latency'];
  return {
    ...state,
    health: {
      state: now,
      since: at,
      reason: typeof e['reason'] === 'string' ? e['reason'] : '',
      latency: typeof latency === 'number' ? latency : was.latency,
      outages,
    },
  };
}

export function reduce(state: LoreState, event: BusEvent): LoreState {
  const [linked, e, touched] = keyed(state, event);
  const next = named(
    STEPS.reduce((s, step) => step(s, e), linked),
    touched
  );
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

/**
 * Whether a players' key is a stable id (D167): digits, a chat's with a leading `-`. A username
 * never starts with one, so a key that is not an id is a name (#17).
 */
export const isId = (key: string): boolean => /^-?\d+$/u.test(key);

/** The owner's key among the players: their id once known, their username until then. */
export const ownerKey = (s: Pick<LoreState, 'owner'>): string | null => s.owner.id ?? s.owner.name;

/** Whether `who` (a key, an id or a username, any case) names the owner. */
export function isOwner(s: Pick<LoreState, 'owner'>, who: string): boolean {
  const lower = who.toLowerCase();
  return who === s.owner.id || (s.owner.name !== null && s.owner.name.toLowerCase() === lower);
}

/**
 * The key of the player `who` names (an id, or a username in any case): theirs if the state keeps
 * them (by key, or by the username they last had), none otherwise.
 */
export function keyIn(s: Pick<LoreState, 'players'>, who: string): string | undefined {
  if (Object.hasOwn(s.players, who)) return who;
  const lower = who.toLowerCase();
  return Object.entries(s.players).find(
    ([k, p]) => (p.name ?? (isId(k) ? null : k))?.toLowerCase() === lower
  )?.[0];
}

/** A person an event names (#17): their id, if known, and their username. */
interface Ref {
  id: string | null;
  name: string;
}

/** The person in fields `<role>Id` and `<role>Name` of `e`, or its older `<old>` field. */
function refOf(e: BusEvent, role: string, old: string): Ref | undefined {
  const name = e[`${role}Name`] ?? e[old];
  if (typeof name !== 'string') return undefined;
  const id = e[`${role}Id`];
  return { id: typeof id === 'string' && id !== '' ? id : null, name };
}

/**
 * The state with a player first kept by their username moved to their id, now that `ref` links
 * the two (#17: a lazy re-key), their ban too; their entry by id wins if both were kept.
 */
function relink(s: LoreState, ref: Ref): LoreState {
  if (ref.id === null || ref.name === '') return s;
  const lower = ref.name.toLowerCase();
  const byName = (rec: Record<string, unknown>): string | undefined =>
    Object.keys(rec).find((k) => !isId(k) && k.toLowerCase() === lower);
  let next = s;
  const k = byName(s.players);
  if (k !== undefined) {
    const named = s.players[k] as Player;
    const byId = Object.hasOwn(s.players, ref.id) ? (s.players[ref.id] as Player) : undefined;
    // Both kept: the later of the two, with every step either was seen at (a seed's, #19).
    let kept = byId === undefined || named.as_of > byId.as_of ? named : byId;
    if (byId !== undefined) {
      const other = kept === named ? byId : named;
      let steps_seen = kept.steps_seen;
      for (const [code, seen] of Object.entries(other.steps_seen))
        steps_seen = seenAt(steps_seen, code, seen.first, seen.last);
      kept = { ...kept, steps_seen, high_water: highWaterOf(steps_seen, s.season.since) };
    }
    next = { ...next, players: withKey(withoutKey(s.players, k), ref.id, kept) };
  }
  const b = byName(s.bans);
  if (b !== undefined) {
    const kept = Object.hasOwn(s.bans, ref.id) ? s.bans[ref.id] : s.bans[b];
    next = { ...next, bans: withKey(withoutKey(s.bans, b), ref.id, kept as Ban) };
  }
  const bought = s.shop.bought;
  const d = byName(bought);
  if (d !== undefined) {
    const kept = Object.hasOwn(bought, ref.id) ? bought[ref.id] : bought[d];
    const moved = withKey(withoutKey(bought, d), ref.id, kept as string[]);
    next = { ...next, shop: { ...next.shop, bought: moved } };
  }
  return next;
}

/** The key a person is kept by: their id if known, else their entry's, else their username. */
const keyFor = (s: LoreState, ref: Ref): string =>
  ref.id ?? (ref.name === '' ? '' : (keyIn(s, ref.name) ?? ref.name));

/**
 * The state and event as the reducers take them (#17): each person the event names (its player, a
 * gift's receiver) relinked to their id when it says it (`relink`), and the event's `player` and
 * `to` their key in the state; with the people it named, to keep their usernames (`named`). A
 * renaming moves a player kept by their old username to their id.
 */
function keyed(state: LoreState, e: BusEvent): [LoreState, BusEvent, Ref[]] {
  if (e.type === RENAMED_EVENT) {
    const id = e['playerId'];
    const before = e['previousName'];
    const after = e['playerName'];
    if (typeof id !== 'string') return [state, e, []];
    const s = typeof before === 'string' ? relink(state, { id, name: before }) : state;
    return [s, e, typeof after === 'string' ? [{ id, name: after }] : []];
  }
  const player = refOf(e, 'player', 'player');
  const to = e.type === GIFT_EVENT ? refOf(e, 'to', 'to') : undefined;
  let s = state;
  for (const r of [player, to]) if (r !== undefined) s = relink(s, r);
  // The owner's id, as soon as an event of theirs tells it: their entry is kept by it.
  const mine = e['owner'] === true ? player : e['toOwner'] === true ? to : undefined;
  if (mine?.id != null && mine.id !== s.owner.id) {
    const name = mine.name === '' ? s.owner.name : mine.name;
    s = relink(
      { ...s, owner: { ...s.owner, id: mine.id, name } },
      { id: mine.id, name: name ?? '' }
    );
  }
  return [
    s,
    {
      ...e,
      ...(player === undefined ? {} : { player: keyFor(s, player) }),
      ...(to === undefined ? {} : { to: keyFor(s, to) }),
    },
    [player, to].filter((r): r is Ref => r !== undefined && r.name !== ''),
  ];
}

/** The state with each player `refs` names keeping their username as last seen (#17). */
function named(s: LoreState, refs: readonly Ref[]): LoreState {
  let next = s;
  for (const r of refs) {
    const key = r.id ?? keyIn(next, r.name);
    if (key === undefined || !Object.hasOwn(next.players, key)) continue;
    const p = next.players[key] as Player;
    if (p.name !== r.name)
      next = { ...next, players: withKey(next.players, key, { ...p, name: r.name }) };
  }
  return next;
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
  requirements: z
    .looseObject({
      guardians: z.array(z.string()).optional(),
      met: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
});
/** What a requirements event says (the parser's `loregame.requirements`). */
const requirementsSchema = z.looseObject({
  place: placeOf,
  level: z.number().nullable(),
  items: z.array(placeItem),
  guardians: z.array(z.string()).optional(),
  met: z.array(z.string()).nullable().optional(),
});

/** A place as the state keeps it. */
type PlaceState = LoreState['places'][string];

/** A place the state knows, or one it knows nothing of yet, by its name. */
function placeIn(s: LoreState, place: { name: string; code: string }): PlaceState {
  const was = Object.hasOwn(s.places, place.code) ? s.places[place.code] : undefined;
  return (
    was ?? {
      name: place.name,
      level: null,
      items: [],
      guardians: [],
      exits: [],
      as_of: '',
      requirements_as_of: null,
      media: [],
    }
  );
}

/**
 * The state after a move or a place (docs/game-bots.md §5.9): a player arrived at a place, or told
 * where they are, is there (`location`, exact), and an arrival takes from their inventory the items
 * entering consumed, as the bot lists them, one each; a place's requirements, wherever the bot
 * states them, and where one can go from it, are the game's (`places`). Entering takes the place's
 * items whichever way one comes, up or down [M]: what an arrival consumed is what the place takes
 * now, none if it consumed none. A guardian a place asks is one made at another, by anyone
 * (`guardians`): a refusal or a `/requisiti` tells which are made, an arrival that all were. A
 * statement of requirements older than those held (`requirements_as_of`: a seed's, from the
 * exports) is not taken.
 */
function reducePlaces(state: LoreState, e: BusEvent): LoreState {
  const at = asIso(e.t);
  if (e.type === REQUIREMENTS_EVENT) {
    const r = requirementsSchema.safeParse(e);
    if (!r.success) return state;
    const { place, level, items, guardians, met } = r.data;
    const was = placeIn(state, place);
    if (was.requirements_as_of !== null && was.requirements_as_of > at) return state;
    const asked = guardians ?? [];
    return {
      ...state,
      places: {
        ...state.places,
        [place.code]: {
          ...was,
          name: place.name,
          level,
          items,
          guardians: asked,
          as_of: was.as_of > at ? was.as_of : at,
          requirements_as_of: at,
        },
      },
      // The guardians made, by anyone [M], where the block is split: codes, no key of Object's.
      ...(met === null || met === undefined || asked.length === 0
        ? {}
        : {
            guardians: {
              ...state.guardians,
              ...Object.fromEntries(asked.map((g) => [g, met.includes(g)])),
            },
          }),
    };
  }
  if (e.type !== TRAVEL_EVENT) return state;
  const r = travelSchema.safeParse(e);
  if (!r.success || r.data.player === '') return state;
  const d = r.data;
  let s = state;
  // The guardians made, by anyone [M]: a refusal tells, of those its place asks, which are
  // ("Hai già:") and which not yet ("Ti serve:"); an arrival, that all the place asked were.
  const asked =
    d.kind === 'refused'
      ? (d.requirements?.guardians ?? [])
      : d.kind === 'arrived'
        ? placeIn(s, d.place).guardians
        : [];
  const met = d.kind === 'refused' ? d.requirements?.met : asked;
  if (asked.length > 0 && met !== null && met !== undefined)
    // Codes, as the bot writes them (`[A-Z]+\d*`): no key of Object's.
    s = {
      ...s,
      guardians: {
        ...s.guardians,
        ...Object.fromEntries(asked.map((g) => [g, met.includes(g)])),
      },
    };
  if (d.kind === 'refused') return s;
  if (d.kind === 'here' && d.exits !== undefined) {
    const was = placeIn(s, d.place);
    s = {
      ...s,
      places: {
        ...s.places,
        [d.place.code]: {
          ...was,
          name: d.place.name,
          exits: d.exits.map((x) => ({ name: x.name, code: x.code })),
          as_of: at,
        },
      },
    };
  }
  if (d.kind === 'arrived') {
    const was = placeIn(s, d.place);
    s = {
      ...s,
      places: {
        ...s.places,
        [d.place.code]: {
          ...was,
          name: d.place.name,
          items: d.consumed ?? [],
          as_of: at,
          requirements_as_of: at,
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
        stats: placed(p.stats, { name: d.place.name, code: d.place.code }, at),
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
    const key = w.owner ? ownerKey(s) : w.player;
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

/** What a neutrality event says (the parser's `loregame.neutral`). */
const neutralSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  kind: z.enum(['neutralized', 'restored']),
});

/** A player's effects, as their stats hold them. */
type Effect = { name: string; until: string | null };

/**
 * The state after a neutrality (docs/game-bots.md §5.9): a ticket used is gone from its player's
 * inventory, and adds 10 hours to their "Neutralizzato" (from now, if none held); its end, told the
 * owner alone, takes it off, and a player in a neutral place is back in their faction's ladder, at
 * the same step [M]: there, not exactly (their next turn tells).
 */
/** `record` with `key` set to `value`, as an own property whatever the key (players name things). */
function withKey<V>(record: Record<string, V>, key: string, value: V): Record<string, V> {
  const next = { ...record };
  Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true });
  return next;
}

/** `record` without `key`. */
function withoutKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/** `record[key]`, if it is its own. */
const ownOf = <V>(record: Record<string, V>, key: string): V | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

const quoteSchema = z.object({
  company: z.string(),
  value: z.number(),
  change: z.number(),
  pct: z.number(),
  direction: z.enum(['up', 'down', 'flat']),
});
const marketSchema = z.looseObject({
  via: z.enum(['update', 'forced', 'listing']),
  quotes: z.array(quoteSchema),
});
const whoseSchema = z.looseObject({ player: z.string(), owner: z.boolean() });
const investmentsSchema = whoseSchema.extend({
  positions: z.array(
    z.object({ company: z.string(), invested: z.number(), value: z.number(), pct: z.number() })
  ),
});
const investSchema = whoseSchema.extend({
  company: z.string(),
  invested: z.number(),
  entry: z.number(),
  coins: z.number(),
});
const cashoutSchema = whoseSchema.extend({
  all: z.boolean(),
  positions: z.array(
    z.object({
      company: z.string(),
      amount: z.number(),
      cashed: z.number(),
      left: z.number().nullable(),
    })
  ),
});
const pageEventSchema = z.looseObject({
  name: z.string(),
  size: z.number(),
  max: z.number(),
  leaderName: z.string(),
  power: z.number(),
  members: z.array(
    z.object({ playerName: z.string(), faction: z.string(), level: z.number(), power: z.number() })
  ),
  value: z.number(),
  profile: z.string().nullable(),
});

/** The state's companies, as `src/companies.ts` works on them. */
const companiesOf = (s: LoreState): Companies => ({
  companies: s.market.companies,
  gone: s.market_history.gone,
  series: s.market_history.series,
});

/** The state with `c`'s companies, changed at `at`. */
const withCompanies = (s: LoreState, c: Companies, at: string | null): LoreState => ({
  ...s,
  market: { ...s.market, as_of: at ?? s.market.as_of, companies: c.companies },
  market_history: { series: c.series, gone: c.gone },
});

/**
 * The state after the market (docs/game-bots.md §5.11): each company (`src/companies.ts`: an id,
 * renames followed, those not quoted gone) its latest value and its series, from every update and
 * market listed, anyone's, each a whole listing; an update of the bot's own checked against the
 * schedule its times teach (one off it is out of turn, `forced`; the ones a jump skipped, missed);
 * a company's page; and a player's investments, by company id, as a listing shows them (all of
 * them, then), an investment and a withdrawal tell, with their coins (an investment says what is
 * left, exactly; a withdrawal adds what it cashed).
 */
function reduceMarket(state: LoreState, e: BusEvent): LoreState {
  const at = asIso(e.t);
  if (e.type === MARKET_EVENT) {
    const r = marketSchema.safeParse(e);
    if (!r.success) return state;
    let via: Via = r.data.via;
    let { schedule } = state.market;
    let c = companiesOf(state);
    if (via === 'update') {
      const next = scheduled(schedule, e.t);
      schedule = next.schedule;
      if (!next.on) via = 'forced';
      // The schedule moved (the bot's clock did): the update that started it was on it after all.
      const moved = next.moved;
      if (moved !== undefined) {
        const relabel = <T extends { via: Via }>(x: T, t: string): T =>
          t === moved && x.via === 'forced' ? { ...x, via: 'update' } : x;
        c = {
          ...c,
          series: Object.fromEntries(
            Object.entries(c.series).map(([id, points]) => [id, points.map((x) => relabel(x, x.t))])
          ),
          companies: Object.fromEntries(
            Object.entries(c.companies).map(([id, co]) => [
              id,
              co.quote === null ? co : { ...co, quote: relabel(co.quote, co.quote.as_of) },
            ])
          ),
        };
      }
    }
    // Every listing is the market's whole: a company it does not quote is gone.
    c = quoted(c, r.data.quotes, at, via, true, state.market.as_of);
    const latest =
      state.market.as_of !== null && Date.parse(state.market.as_of) > e.t ? state.market.as_of : at;
    const next = withCompanies(state, c, latest);
    return { ...next, market: { ...next.market, schedule } };
  }
  if (e.type === COMPANY_EVENT) {
    const r = pageEventSchema.safeParse(e);
    if (!r.success) return state;
    const { name, ...page } = r.data;
    const { size, max, leaderName: leader, power, value, profile } = page;
    // The page kept names its people by username, as the bot shows it.
    const members = page.members.map(({ playerName: player, faction, level, power: p }) => ({
      player,
      faction,
      level,
      power: p,
    }));
    return withCompanies(
      state,
      paged(companiesOf(state), name, { size, max, leader, power, members, value, profile }, at),
      null
    );
  }
  if (e.type !== INVESTMENTS_EVENT && e.type !== INVEST_EVENT && e.type !== CASHOUT_EVENT)
    return state;
  const w = whoseSchema.safeParse(e);
  if (!w.success || (!w.data.owner && w.data.player === '')) return state;
  const key = w.data.owner ? ownerKey(state) : (keyIn(state, w.data.player) ?? w.data.player);
  if (key === null) return state;
  let c = companiesOf(state);
  /** The id of the company the answer names: a new one if none fits. */
  const company = (name: string): string => {
    const made = idOf(c, name, at);
    c = made.companies;
    return made.id;
  };
  const p = playerOf(state, key) ?? initialPlayer(at);
  let { investments, stats } = p;
  if (e.type === INVESTMENTS_EVENT) {
    const r = investmentsSchema.safeParse(e);
    if (!r.success) return state;
    // The listing is every one open: the others are gone.
    investments = {};
    for (const x of r.data.positions) {
      const id = company(x.company);
      const was = ownOf(p.investments, id);
      investments = withKey(investments, id, {
        invested: x.invested,
        entry: was !== undefined && was.invested === x.invested ? was.entry : null,
        value: x.value,
        as_of: at,
      });
    }
  } else if (e.type === INVEST_EVENT) {
    const r = investSchema.safeParse(e);
    if (!r.success) return state;
    investments = withKey(investments, company(r.data.company), {
      invested: r.data.invested,
      entry: r.data.entry,
      value: r.data.invested,
      as_of: at,
    });
    stats = set(stats, 'coins', r.data.coins, true, at);
  } else {
    const r = cashoutSchema.safeParse(e);
    if (!r.success) return state;
    for (const x of r.data.positions) {
      const id = company(x.company);
      const was = ownOf(investments, id);
      investments =
        x.left === null
          ? withoutKey(investments, id)
          : withKey(investments, id, {
              invested:
                was?.invested === null || was === undefined
                  ? null
                  : Math.max(0, was.invested - x.amount),
              entry: was?.entry ?? null,
              value: x.left,
              as_of: at,
            });
      stats = move(stats, 'coins', (v) => Number(v) + x.cashed, true, at);
    }
    if (r.data.all) investments = {};
  }
  return {
    ...withCompanies(state, c, null),
    players: withKey(state.players, key, { ...p, as_of: at, investments, stats }),
  };
}

function reduceNeutral(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== NEUTRAL_EVENT) return state;
  const r = neutralSchema.safeParse(e);
  if (!r.success || r.data.player === '') return state;
  const d = r.data;
  const at = asIso(e.t);
  let s = state;
  if (playerOf(s, d.player) === null)
    s = { ...s, players: { ...s.players, [d.player]: initialPlayer(at) } };
  const p = playerOf(s, d.player) as Player;
  const effects = (v: unknown): Effect[] =>
    (Array.isArray(v) ? (v as Effect[]) : []).filter((f) => f.name !== NEUTRAL_EFFECT);
  let stats = p.stats;
  if (d.kind === 'neutralized') {
    const held = Object.hasOwn(stats, 'effects') ? stats['effects']?.value : undefined;
    const was = (Array.isArray(held) ? (held as Effect[]) : []).find(
      (f) => f.name === NEUTRAL_EFFECT && f.until !== null && Date.parse(f.until) > e.t
    );
    const until = asIso(
      Math.max(e.t, was === undefined ? e.t : Date.parse(was.until as string)) + NEUTRAL_MS
    );
    stats = move(
      stats,
      'effects',
      (v) => [...effects(v), { name: NEUTRAL_EFFECT, until }],
      true,
      at
    );
  } else {
    stats = move(stats, 'effects', effects, true, at);
    const location = Object.hasOwn(stats, 'location') ? stats['location'] : undefined;
    const here = location?.value as { code?: unknown } | null | undefined;
    const step = typeof here?.code === 'string' ? ladderOf(here.code) : undefined;
    const alignment = Object.hasOwn(stats, 'alignment') ? stats['alignment']?.value : undefined;
    const ladder = alignment === 'Bene' ? 'B' : alignment === 'Male' ? 'M' : undefined;
    if (step?.ladder === 'N')
      stats = move(
        stats,
        'location',
        (v) => {
          if (ladder === undefined) return v;
          const code = `${ladder}${step.step}`;
          return { name: Object.hasOwn(s.places, code) ? s.places[code]?.name : null, code };
        },
        false,
        at
      );
  }
  s = { ...s, players: { ...s.players, [d.player]: { ...p, as_of: at, stats } } };
  if (d.kind !== 'neutralized') return s;
  const whose: Whose = d.owner ? { owner: true } : { owner: false, player: d.player };
  const inv = inventoryOf(s, whose);
  const h = inv === undefined ? undefined : own(inv.items, NEUTRAL_TICKET);
  if (inv === undefined || h === undefined) return s;
  const items = withItem(inv.items, NEUTRAL_TICKET, {
    ...h,
    qty: Math.max(0, h.qty - 1),
    exact: h.exact && h.qty > 0,
    date: at,
  });
  return withInventory(s, whose, { ...inv, items, held: heldOf(items) }, at);
}

/**
 * A picture fetched (or recorded without its bytes) for an entity (src/media.ts): added to its list,
 * newest last; a place it shows is known by its name from then on, if it was not.
 */
function reduceMedia(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== MEDIA_EVENT) return state;
  const m = mediaEventSchema.safeParse(e);
  if (!m.success) return state;
  const { key, name, media } = m.data;
  const was = placeIn(state, { name, code: key });
  const next = withMedia(was.media, media);
  if (next.length === was.media.length) return state;
  return { ...state, places: { ...state.places, [key]: { ...was, media: next } } };
}

/** The entry of a picture kept, by its id, of whichever entity: none if no entity has it. */
export function mediaEntryOf(s: LoreState, id: string): MediaEntry | undefined {
  for (const p of Object.values(s.places)) {
    const found = p.media.find((m) => m.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Every place the state knows of, by code. */
export const placesOf = (s: LoreState): LoreState['places'] => s.places;

/**
 * The market now (docs/game-bots.md §5.11): the companies there are, by id, each its name and
 * latest value; and the bot's updates: the last on schedule, the interval learned, when the next is
 * due, and those missed.
 */
export function marketNow(s: LoreState): {
  as_of: string | null;
  companies: Record<string, { name: string } & Partial<Company['quote'] & object>>;
  schedule: LoreState['market']['schedule'] & { next: string | null };
} {
  const { last, period_min } = s.market.schedule;
  const next =
    last === null || period_min === null
      ? null
      : new Date(Date.parse(last) + period_min * 60_000).toISOString();
  return {
    as_of: s.market.as_of,
    companies: Object.fromEntries(
      Object.entries(s.market.companies).map(([id, c]) => [
        id,
        { name: c.name, ...(c.quote ?? {}) },
      ])
    ),
    schedule: { ...s.market.schedule, next },
  };
}

/**
 * Each company's values through time, by id, those there are (and those gone, with `gone`; one if
 * named: its id, or a name it has or had), oldest first, from `since` to `until` (ISO, both
 * included; all without); with its name and when it was gone, if it is (`gone`, none if not).
 */
export function marketHistory(
  s: LoreState,
  o: { company?: string; since?: string; until?: string; gone?: boolean } = {}
): Record<string, { name: string; gone: string | null; points: Point[] }> {
  const from = o.since === undefined ? -Infinity : Date.parse(o.since);
  const to = o.until === undefined ? Infinity : Date.parse(o.until);
  const c = companiesOf(s);
  const all: [string, { name: string; gone: string | null; points: Point[] }][] = [
    ...Object.entries(c.series).map(
      ([id, points]): [string, { name: string; gone: string | null; points: Point[] }] => [
        id,
        {
          name: (Object.hasOwn(c.companies, id) ? c.companies[id]?.name : undefined) ?? id,
          gone: null,
          points,
        },
      ]
    ),
    ...(o.gone === true || o.company !== undefined
      ? Object.entries(c.gone).map(
          ([id, g]): [string, { name: string; gone: string | null; points: Point[] }] => [
            id,
            { name: g.name, gone: g.gone, points: g.points },
          ]
        )
      : []),
  ];
  const named =
    o.company === undefined
      ? undefined
      : all.some(([id]) => id === o.company)
        ? o.company
        : (companyOf(c, o.company) ??
          Object.keys(c.gone).find((id) => c.gone[id]?.names.some((n) => n.name === o.company)));
  const out: Record<string, { name: string; gone: string | null; points: Point[] }> = {};
  for (const [id, h] of all) {
    if (o.company !== undefined && id !== named) continue;
    Object.defineProperty(out, id, {
      value: {
        ...h,
        points: h.points.filter((p) => Date.parse(p.t) >= from && Date.parse(p.t) <= to),
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** A player's investment, as `investmentsOf` gives it. */
export type MarketHolding = Player['investments'][string] & { company: string; now: number | null };

/**
 * A player's open investments (the owner's unless named), by company id, each with the company's
 * name and what it is worth at its latest value (`now`: what is invested, times that value over
 * the one it was entered at; none without both); null for a player the state does not know.
 */
export function investmentsOf(s: LoreState, player?: string): Record<string, MarketHolding> | null {
  const name = keyOfQuery(s, player);
  const p = name === null ? null : playerOf(s, name);
  if (p === null) return null;
  const out: Record<string, MarketHolding> = {};
  for (const [id, x] of Object.entries(p.investments)) {
    const co = Object.hasOwn(s.market.companies, id) ? s.market.companies[id] : undefined;
    const was = Object.hasOwn(s.market_history.gone, id) ? s.market_history.gone[id] : undefined;
    const value = co?.quote?.value;
    const now =
      x.invested === null || x.entry === null || x.entry === 0 || value === undefined
        ? null
        : Math.round((x.invested * value) / x.entry);
    Object.defineProperty(out, id, {
      value: { company: co?.name ?? was?.name ?? id, ...x, now },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Whether a guardian has been made at the place `code`, by anyone; none if never told. */
export const guardianMade = (s: LoreState, code: string): boolean | null =>
  Object.hasOwn(s.guardians, code) ? (s.guardians[code] ?? null) : null;

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
 * them (one at a time, so reaching the last saw them all; one without buttons is a page alone): with
 * the last, the listing is whole, and the inventory is it alone, every item exact, those it does not
 * list gone; an item held exactly that it says otherwise is a mismatch (`stats_drift`, `inventory`).
 * A filtered listing (`/i <text>`), a page whose buttons are not known (an export, a shell before
 * MegaBotTron1999 0.1.47), a chain whose first page was
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

/** A holder of an item, as `state.holders` answers: who (#17), how many, and whether exactly. */
export interface Holder {
  playerName: string;
  playerId: string | null;
  qty: number;
  exact: boolean;
}

/** A player kept under `key`, as a query names them (#17): their username and their id. */
export const whoIs = (key: string, p: Player): { playerName: string; playerId: string | null } => ({
  playerName: p.name ?? (isId(key) ? '' : key),
  playerId: isId(key) ? key : null,
});

/**
 * The key of the player a query names (an id, or a username in any case), the owner's if none:
 * theirs if the state keeps them, else the name as given.
 */
export function keyOfQuery(s: LoreState, player?: string): string | null {
  if (player === undefined || isOwner(s, player)) return ownerKey(s);
  return keyIn(s, player) ?? player;
}

/** Who holds an item, by its name, as the state knows: each player (the owner too) and how many. */
export function holdersOf(s: LoreState, item: string): Holder[] {
  const out: Holder[] = [];
  const mine = own(s.inventory.items, item);
  if (mine !== undefined && mine.qty > 0)
    out.push({
      playerName: s.owner.name ?? '',
      playerId: s.owner.id,
      qty: mine.qty,
      exact: mine.exact,
    });
  for (const [key, p] of Object.entries(s.players)) {
    if (key === ownerKey(s)) continue;
    const h = own(p.inventory.items, item);
    if (h !== undefined && h.qty > 0) out.push({ ...whoIs(key, p), qty: h.qty, exact: h.exact });
  }
  return out.sort((a, b) => b.qty - a.qty);
}

/** A player's inventory, the owner's unless named; null for a player the state does not know. */
export function inventoryOfPlayer(s: LoreState, player?: string): Inventory | null {
  if (player === undefined || isOwner(s, player)) return s.inventory;
  return playerOf(s, player)?.inventory ?? null;
}

const shopListingSchema = z.looseObject({
  player: z.string(),
  sagra: z.string().nullable(),
  items: z.array(shopItemSchema.extend({ bought: z.boolean() })),
});

/** Whether two lists of the shop's items are the same, in the same order. */
const sameItems = (a: LoreState['shop']['items'], b: LoreState['shop']['items']): boolean =>
  a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));

/**
 * A shop listing (§5.12): the day's items, the same for every player, as last told; the items its
 * player has bought that day, apart; and every item seen on sale. A listing of a day before the
 * one kept (told late) changes nothing.
 */
const listedSchema = z.object({
  item: z.string(),
  rarity: z.string(),
  tags: z.array(z.string()),
  level: z.object({ low: z.number(), high: z.number() }).nullable(),
});
/** What a generator's event says (the parser's `loregame.generated`). */
const generatedSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  kind: z.enum(['item', 'story', 'guardian', 'season', 'utility', 'equipment', 'blueprint']),
  name: z.string().nullable(),
  code: z.string().nullable(),
  gained: listedSchema.nullable(),
  reward: z.number(),
  cost: z.number(),
  removed: z.enum(['Bene', 'Male', 'Neutrale']).nullable(),
});
/** What an item used up says (the parser's `loregame.used`). */
const usedSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  item: z.string(),
  found: z.array(listedSchema),
});

/** Whose a player's event is: the owner's, or a player's by name; none for one unnamed. */
function whoseOf(e: BusEvent): Whose | undefined {
  const player = e['player'];
  if (e['owner'] === true) return { owner: true };
  return typeof player === 'string' && player !== '' ? { owner: false, player } : undefined;
}

/** `qty` of `item` less in `whose`'s inventory, at `at`, if they hold it: exact while it was, so many held. */
function used(s: LoreState, whose: Whose, item: string, at: string, qty = 1): LoreState {
  const inv = inventoryOf(s, whose);
  const h = inv === undefined ? undefined : own(inv.items, item);
  if (inv === undefined || h === undefined) return s;
  const items = withItem(inv.items, item, {
    ...h,
    qty: Math.max(0, h.qty - qty),
    exact: h.exact && h.qty >= qty,
    date: at,
  });
  return withInventory(s, whose, { ...inv, items, held: heldOf(items) }, at);
}

/**
 * A generator used (§5.13): one of its kind gone from its player's inventory, the coins it gave
 * and cost moved, a guardian made recorded at the place they are; a season made, every season
 * generator of its faction's players gone. An item `/usa` used up (the moving box): one gone. What
 * either gave reaches the inventory as a drop does (`reduce`).
 */
function reduceGenerators(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== GENERATED_EVENT && e.type !== USED_EVENT) return state;
  const whose = whoseOf(e);
  if (whose === undefined) return state;
  const at = asIso(e.t);
  const name = whose.owner ? ownerKey(state) : whose.player;
  let s = state;
  if (!whose.owner && playerOf(s, whose.player) === null)
    s = { ...s, players: withKey(s.players, whose.player, initialPlayer(at)) };
  if (e.type === USED_EVENT) {
    const u = usedSchema.safeParse(e);
    return u.success ? used(s, whose, u.data.item, at) : state;
  }
  const g = generatedSchema.safeParse(e);
  if (!g.success) return state;
  s = used(s, whose, GENERATORS[g.data.kind], at);
  const p = name === null ? null : playerOf(s, name);
  if (p !== null && name !== null) {
    const coins = g.data.reward - g.data.cost;
    const stats =
      coins === 0 ? p.stats : move(p.stats, 'coins', (v) => Number(v) + coins, true, at);
    s = { ...s, players: withKey(s.players, name, { ...p, as_of: at, stats }) };
    // A guardian is made where its player stands (§5.9): one made there now.
    const here = Object.hasOwn(p.stats, 'location')
      ? (p.stats['location']?.value as { code?: unknown } | null)
      : null;
    if (g.data.kind === 'guardian' && typeof here?.code === 'string')
      s = { ...s, guardians: withKey(s.guardians, here.code, true) };
  }
  const removed = g.data.removed;
  if (removed !== null)
    for (const [player, q] of Object.entries(s.players)) {
      const faction = Object.hasOwn(q.stats, 'alignment') ? q.stats['alignment']?.value : undefined;
      if (faction !== removed) continue;
      const w: Whose = player === ownerKey(s) ? { owner: true } : { owner: false, player };
      const inv = inventoryOf(s, w);
      const h = inv === undefined ? undefined : own(inv.items, GENERATORS.season);
      if (inv === undefined || h === undefined || h.qty === 0) continue;
      const items = withItem(inv.items, GENERATORS.season, { ...h, qty: 0, date: at });
      s = withInventory(s, w, { ...inv, items, held: heldOf(items) }, at);
    }
  return s;
}

const countedSchema = listedSchema.extend({ qty: z.number() });
/** What a recipe list says (the parser's `loregame.recipes`). */
const recipeListSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  recipes: z.array(
    z.object({
      name: z.string(),
      level: z.number(),
      lacking: z.number().nullable(),
      starred: z.boolean(),
    })
  ),
});
/** What a recipe's needs say (the parser's `loregame.recipe`). */
const recipeNeedsSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  name: z.string(),
  lacking: z.array(countedSchema),
  held: z.array(countedSchema),
});
/** What a recipe made says (the parser's `loregame.recipeMade`). */
const recipeMadeSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  used: z.array(countedSchema),
  made: countedSchema,
});

/**
 * The recipe a recipe made was (it names none): the one known to take the same items, or to give
 * the same; none if no one recipe is.
 */
export function recipeMadeOf(
  s: LoreState,
  used: readonly { item: string }[],
  made: { item: string }
): string | undefined {
  const key = (items: readonly { item: string }[]) =>
    JSON.stringify(items.map((i) => i.item).sort());
  const takes = key(used);
  const fits = Object.entries(s.recipes).filter(
    ([, r]) =>
      (r.ingredients.length > 0 && key(r.ingredients) === takes) || r.made?.item === made.item
  );
  return fits.length === 1 ? fits[0]?.[0] : undefined;
}

/**
 * The recipes (§5.14). A list sets the recipes the game has, by level, and the player's own, each
 * with how many items they lack (theirs is the whole list: those it does not name are gone). An
 * answer to `/ricetta <name>` tells what a recipe takes, and is evidence of its player's
 * inventory: each item held, exactly so many; each lacking, none (no item is both [M]). A recipe
 * made takes its items out (and its item in, as a drop, `reduce`), adds one to the player's
 * `recipes`, and, if it is known which recipe it was, tells what that takes and gives.
 */
function reduceRecipes(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== RECIPES_EVENT && e.type !== RECIPE_EVENT && e.type !== RECIPE_MADE_EVENT)
    return state;
  const whose = whoseOf(e);
  if (whose === undefined) return state;
  const at = asIso(e.t);
  const name = whose.owner ? ownerKey(state) : whose.player;
  let s = state;
  if (!whose.owner && playerOf(s, whose.player) === null)
    s = { ...s, players: withKey(s.players, whose.player, initialPlayer(at)) };
  /** The player's recipes, changed by `f`, and maybe their stats. */
  const theirs = (
    f: (r: Player['recipes']) => Player['recipes'],
    stats: (st: Player['stats']) => Player['stats'] = (st) => st
  ): void => {
    const p = name === null ? null : playerOf(s, name);
    if (p === null || name === null) return;
    const next = { ...p, as_of: at, recipes: f(p.recipes), stats: stats(p.stats) };
    s = { ...s, players: withKey(s.players, name, next) };
  };
  if (e.type === RECIPES_EVENT) {
    const d = recipeListSchema.safeParse(e);
    if (!d.success) return state;
    for (const r of d.data.recipes) {
      const was = ownOf(s.recipes, r.name);
      s = {
        ...s,
        recipes: withKey(s.recipes, r.name, {
          level: r.level,
          ingredients: was?.ingredients ?? [],
          made: was?.made ?? null,
          as_of: at,
        }),
      };
    }
    theirs((before) =>
      d.data.recipes.reduce<Player['recipes']>((mine, r) => {
        const was = ownOf(before, r.name);
        // The items named lacking last, while they lack as many still.
        const items = was?.items != null && was.items.length === r.lacking ? was.items : null;
        return withKey(mine, r.name, {
          level: r.level,
          lacking: r.lacking,
          items,
          starred: r.starred,
          as_of: at,
        });
      }, {})
    );
    return s;
  }
  if (e.type === RECIPE_EVENT) {
    const d = recipeNeedsSchema.safeParse(e);
    if (!d.success) return state;
    const known = ownOf(s.recipes, d.data.name);
    const need = (item: string) => known?.ingredients.find((i) => i.item === item)?.qty ?? null;
    // An item lacking is held none of, so it takes as many as are lacking.
    const ingredients = [
      ...d.data.lacking.map(({ item, rarity, tags, qty }) => ({ item, rarity, tags, qty })),
      ...d.data.held.map(({ item, rarity, tags }) => ({ item, rarity, tags, qty: need(item) })),
    ];
    s = {
      ...s,
      recipes: withKey(s.recipes, d.data.name, {
        level: known?.level ?? null,
        ingredients,
        made: known?.made ?? null,
        as_of: at,
      }),
    };
    theirs((r) => {
      const was = ownOf(r, d.data.name);
      return withKey(r, d.data.name, {
        level: was?.level ?? known?.level ?? null,
        lacking: d.data.lacking.length,
        items: d.data.lacking.map((l) => l.item),
        starred: was?.starred ?? false,
        as_of: at,
      });
    });
    const inv = inventoryOf(s, whose);
    if (inv === undefined) return s;
    let items = inv.items;
    for (const h of d.data.held) {
      const before = own(items, h.item);
      items = withItem(items, h.item, {
        qty: h.qty,
        exact: true,
        date: at,
        via: before?.via ?? 'listing',
        rarity: h.rarity,
        tags: h.tags,
        ...(h.level === null
          ? before?.level === undefined
            ? {}
            : { level: before.level }
          : { level: h.level }),
      });
    }
    for (const l of d.data.lacking) {
      const before = own(items, l.item);
      if (before !== undefined && (before.qty !== 0 || !before.exact))
        items = withItem(items, l.item, { ...before, qty: 0, exact: true, date: at });
    }
    return items === inv.items
      ? s
      : withInventory(s, whose, { ...inv, items, held: heldOf(items) }, at);
  }
  const d = recipeMadeSchema.safeParse(e);
  if (!d.success) return state;
  for (const u of d.data.used) s = used(s, whose, u.item, at, u.qty);
  const which = recipeMadeOf(s, d.data.used, d.data.made);
  const recipe = which === undefined ? undefined : ownOf(s.recipes, which);
  if (which !== undefined && recipe !== undefined) {
    const { item, rarity, tags } = d.data.made;
    s = {
      ...s,
      recipes: withKey(s.recipes, which, {
        ...recipe,
        ingredients: d.data.used.map(({ item, rarity, tags, qty }) => ({
          item,
          rarity,
          tags,
          qty,
        })),
        made: { item, rarity, tags },
        as_of: at,
      }),
    };
  }
  theirs(
    (r) => {
      if (which === undefined) return r;
      const was = ownOf(r, which);
      // Made: their list marks it `[*]` from now on (§5.14), until a list says otherwise. What
      // they lack now is not known: what it took may have been all they held.
      return withKey(r, which, {
        level: was?.level ?? recipe?.level ?? null,
        lacking: null,
        items: null,
        starred: true,
        as_of: at,
      });
    },
    (st) =>
      Object.hasOwn(st, 'recipes') ? move(st, 'recipes', (v) => Number(v) + 1, true, at) : st
  );
  return s;
}

/** The recipes the game has, as the state knows them. */
export const recipesOf = (s: LoreState): LoreState['recipes'] => s.recipes;

/**
 * A recipe, by its name or a part of it (as `/ricetta <name>`, ignoring case, when one recipe
 * alone has it), with a player's own (the owner's unless named); none if no one recipe is named so.
 */
export function recipeOf(
  s: LoreState,
  name: string,
  player?: string
): (Recipe & { name: string; player: Player['recipes'][string] | null }) | null {
  const part = name.toLowerCase();
  const named = Object.keys(s.recipes).filter((k) => k.toLowerCase().includes(part));
  const key =
    ownOf(s.recipes, name) === undefined ? (named.length === 1 ? named[0] : undefined) : name;
  const recipe = key === undefined ? undefined : ownOf(s.recipes, key);
  if (key === undefined || recipe === undefined) return null;
  const who = keyOfQuery(s, player);
  const p = who === null ? null : playerOf(s, who);
  return { name: key, ...recipe, player: p === null ? null : (ownOf(p.recipes, key) ?? null) };
}

/** What a purchase event says (the parser's `loregame.purchase`). */
const purchaseSchema = z.looseObject({
  player: z.string(),
  owner: z.boolean(),
  item: z.string(),
  rarity: z.string(),
  tags: z.array(z.string()),
  price: z.number(),
  qty: z.number(),
});

/**
 * A purchase at the shop (§5.12), as its listing's edits tell it: its price off the buyer's `coins`
 * (exact if they were). The item reaches their inventory as a drop does (`reduce`, `via:
 * 'purchase'`), and their listing, edited back, marks it bought for the day.
 */
function reducePurchase(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== PURCHASE_EVENT) return state;
  const b = purchaseSchema.safeParse(e);
  if (!b.success || (!b.data.owner && b.data.player === '')) return state;
  const key = b.data.owner ? ownerKey(state) : (keyIn(state, b.data.player) ?? b.data.player);
  if (key === null) return state;
  const at = asIso(e.t);
  const p = playerOf(state, key) ?? initialPlayer(at);
  const stats = move(p.stats, 'coins', (v) => Number(v) - b.data.price * b.data.qty, true, at);
  return { ...state, players: withKey(state.players, key, { ...p, as_of: at, stats }) };
}

function reduceShop(state: LoreState, e: BusEvent): LoreState {
  if (e.type !== SHOP_EVENT) return state;
  const parsed = shopListingSchema.safeParse(e);
  if (!parsed.success) return state;
  const listing = parsed.data;
  const day = shopDayOf(e.t);
  const was = state.shop;
  if (was.day !== null && day < was.day) return state;
  const at = asIso(e.t);
  const items = listing.items.map(({ item, rarity, tags, price }) => ({
    item,
    rarity,
    tags,
    price,
  }));
  const newDay = was.day !== day;
  let seen = was.seen;
  for (const i of items) {
    const before = ownOf(seen, i.item);
    if (before !== undefined && before.last === day && before.rarity === i.rarity) continue;
    seen = withKey(seen, i.item, {
      rarity: i.rarity,
      tags: i.tags,
      first: before?.first ?? day,
      last: day,
      days: (before?.days ?? 0) + (before?.last === day ? 0 : 1),
    });
  }
  const bought = withKey(
    newDay ? {} : was.bought,
    listing.player,
    listing.items.filter((i) => i.bought).map((i) => i.item)
  );
  return {
    ...state,
    shop: {
      day,
      sagra: listing.sagra,
      items: !newDay && sameItems(was.items, items) ? was.items : items,
      as_of: at,
      bought,
      seen,
    },
  };
}

/** The shop now, as `state.shop` answers it. */
export interface ShopNow {
  day: string | null;
  sagra: string | null;
  as_of: string | null;
  /** Its day is today's, in Italy: what it lists is on sale now. */
  today: boolean;
  /** Each item, `bought` by the player asked about (none: not known). */
  items: (z.infer<typeof shopItemSchema> & { bought: boolean | null })[];
}

/**
 * The shop now (§5.12): its day's items, each marked bought or not by `player` (the owner unless
 * named; none when their listing of the day was not read), and whether its day is today's at `now`.
 */
export function shopOf(s: LoreState, now: number, player?: string): ShopNow {
  const who = keyOfQuery(s, player) ?? '';
  const mine = ownOf(s.shop.bought, who);
  return {
    day: s.shop.day,
    sagra: s.shop.sagra,
    as_of: s.shop.as_of,
    today: s.shop.day !== null && s.shop.day === shopDayOf(now),
    items: s.shop.items.map((i) => ({
      ...i,
      bought: mine === undefined ? null : mine.includes(i.item),
    })),
  };
}

/** What a state tells of a change in its bans, as `loregame-state` announces it. */
export function announce(before: LoreState, after: LoreState, e: BusEvent): Announcement[] {
  const owner = (key: string): boolean => key === ownerKey(after);
  /** Who a ban's key is (#17): their username, as last seen, and their id. */
  const who = (s: LoreState, key: string) => {
    const p = Object.hasOwn(s.players, key) ? (s.players[key] as Player) : null;
    if (p !== null) return whoIs(key, p);
    if (key === ownerKey(s)) return { playerName: s.owner.name ?? '', playerId: s.owner.id };
    return { playerName: isId(key) ? '' : key, playerId: isId(key) ? key : null };
  };
  // A ban moved from a player's name to their id (`relink`) is the same ban.
  const moved = (key: string): string | undefined => {
    const name = who(after, key).playerName.toLowerCase();
    return Object.keys(before.bans).find((k) => !isId(k) && k.toLowerCase() === name);
  };
  const same = (key: string, b: Ban): boolean => {
    const was = Object.hasOwn(before.bans, key) ? key : moved(key);
    return was !== undefined && before.bans[was]?.until === b.until;
  };
  const set = Object.entries(after.bans).flatMap(([player, b]) =>
    same(player, b)
      ? []
      : [
          {
            type: 'banned',
            payload: { ...who(after, player), until: b.until, owner: owner(player) },
          },
        ]
  );
  const relinked = new Set(Object.keys(after.bans).map(moved));
  const ended = Object.keys(before.bans).flatMap((player) =>
    Object.hasOwn(after.bans, player) || relinked.has(player)
      ? []
      : [
          {
            type: 'unbanned',
            payload: {
              ...who(before, player),
              owner: player === ownerKey(before),
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
    ...announceMarket(before, after, e),
    ...announceShop(before, after),
    ...announceDiscovered(before, after),
  ];
}

/** The items seen for the first time: their name, rarity and tags, and how. */
function announceDiscovered(before: LoreState, after: LoreState): Announcement[] {
  if (before.catalogue === after.catalogue) return [];
  const found = Object.entries(after.catalogue)
    .filter(([item]) => !Object.hasOwn(before.catalogue, item))
    .map(([item, c]) => ({ item, rarity: c.rarity, tags: c.tags, via: c.via }));
  return found.length === 0 ? [] : [{ type: 'itemsDiscovered', payload: { items: found } }];
}

/**
 * The shop's items changed (a new day, or the same day's list told otherwise): its day, its sagra,
 * its items, and those never seen on sale before (`new`).
 */
function announceShop(before: LoreState, after: LoreState): Announcement[] {
  if (before.shop.items === after.shop.items && before.shop.day === after.shop.day) return [];
  return [
    {
      type: 'shopChanged',
      payload: {
        day: after.shop.day,
        sagra: after.shop.sagra,
        items: after.shop.items,
        new: after.shop.items
          .filter((i) => !Object.hasOwn(before.shop.seen, i.item))
          .map((i) => i.item),
      },
    },
  ];
}

/**
 * An update of the market (the bot's own, or one out of turn) that changed it: the values it
 * quoted, and how it came. A market listed to a player is not an update.
 */
function announceMarket(before: LoreState, after: LoreState, e: BusEvent): Announcement[] {
  if (e.type !== MARKET_EVENT || e['via'] === 'listing' || before.market === after.market)
    return [];
  const at = asIso(e.t);
  const companies = Object.entries(after.market.companies).filter(([, c]) => c.quote?.as_of === at);
  if (companies.length === 0) return [];
  return [
    {
      type: 'marketUpdated',
      payload: {
        via: companies[0]?.[1].quote?.via ?? e['via'],
        quotes: companies.map(([id, c]) => ({ id, company: c.name, ...(c.quote as object) })),
        gone: Object.entries(after.market_history.gone)
          .filter(([id, c]) => c.gone === at && !Object.hasOwn(before.market_history.gone, id))
          .map(([id, c]) => ({ id, company: c.name })),
      },
    },
  ];
}

/** Each stat a snapshot (a profile, the skills menu, the slots listed) said otherwise of. */
function announceStats(before: LoreState, after: LoreState, e: BusEvent): Announcement[] {
  const ref = refOf(e, 'player', 'player');
  const name = ref === undefined ? undefined : (ref.id ?? ref.name);
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
      playerName: ref?.name ?? '',
      playerId: ref?.id ?? null,
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
export const playerOf = (s: LoreState, name: string): Player | null => {
  const key = keyIn(s, name);
  return key === undefined ? null : (s.players[key] as Player);
};

/**
 * A player's last profile (the owner's unless named), whole, or one stat of it by its dotted path
 * (`level`, `coins`, `skills.Stoccaggio`, `equipment.weapon.level`): null if the state holds no
 * profile of theirs, or the profile has no such stat. Read as own properties only (players name
 * skills and items: `__proto__` is a name like any other).
 */
export function profileOf(s: LoreState, player?: string, stat?: string): unknown {
  const name = keyOfQuery(s, player);
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
  const name = keyOfQuery(s, player);
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

/** The accumulo as the state keeps it (`state.accumulo()`). */
export const accumuloOf = (s: LoreState): Accumulo => s.accumulo;

/** The ban of a player (the owner, unless named), if the state holds one: it may have ended by now. */
export function banOf(s: LoreState, player?: string): Ban | null {
  const name = keyOfQuery(s, player);
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
