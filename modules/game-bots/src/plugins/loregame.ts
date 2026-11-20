/**
 * The `loregame` parser plugin: @LoreGameBot's answers to the owner's turns, on the base of
 * @megabottron1999/turns/turn-parser.ts and the grammar of modules/game-bots/src/replies.ts.
 *
 * It replies to the command and names nobody: a reply to one of the owner's turns is read (an item,
 * a fight lost or the item lost, a "too soon", a reply cut off at Telegram's limit, each with its
 * place, fight and level-up), and one it cannot read is claimed and unread (drift).
 * In private, a reply to a message it does not know (a turn sent an instant before the actor
 * learnt its id) still counts when it reads as a turn's outcome. Its rest: 15 minutes, 30 after a
 * fight lost, or the wait it states.
 *
 * It reads, and keeps nothing of when a command may be played (MegaBotTron1999's bot-os.md D141):
 * that is `loregame-state`'s readiness, reduced from these events.
 *
 * **The accumulo** (docs/game-bots.md §5.2), a command a shell player plays: the parser names
 * `/accumulo` in its vocabulary, with `/acc` its alias (its mechanics are the state's), and a turn
 * that finds it full carries the line
 * "🔋 /accumulo pronto!", which the outcome of `loregame.turn` has as `accumulo`; and the bot's
 * answer to the owner's `/accumulo` (in private, or the one that follows the command in the
 * group) is published as `loregame.accumulo`, for `loregame-state` to count against.
 *
 * **The training** (docs/game-bots.md §5.3), `/allenati`, a command a shell player plays: named in
 * the vocabulary (its cooldown of a day is the state's mechanics), its answer read (a training, or
 * a "too soon" with the wait left); and every player's answer, the owner's included, published as
 * `loregame.training`, paired as the accumulo's are, since the bot's success replies to nothing.
 *
 * **Level-ups** (docs/game-bots.md §5.4): any message of the bot's that ends in one, whatever
 * brought it (a turn, a training, anything else), is published as `loregame.levelUp`, for the player
 * it is about: the owner's in private, else the sender of the message it replies to, else the player
 * whose training it paired. One the parser cannot place is no one's.
 *
 * **Profiles** (docs/game-bots.md §5.5): the answer to `/info`, `/me` or `/info <player>` names its
 * player on its first line, so any profile of the bot's, in any chat, is published as
 * `loregame.profile` for that player, the owner's when it names the account.
 *
 * **Skills and equipment** (docs/game-bots.md §5.6, §5.7): the `/abilita` menu and the answers to
 * `/equipaggia` that change or list the equipment, each the player's whose command it replies to,
 * as `loregame.skills` and `loregame.equipment`. The menu is followed as its buttons change it: the
 * parser asks for edits (MegaBotTron1999's D144), of the menu alone.
 *
 * **The inventory and the places** (docs/game-bots.md §5.8, §5.9): `/zaino` and `/i`, a page at a
 * time (its pages are its edits, its buttons tell which), as `loregame.inventory`; `/vai` and `/v`,
 * as `loregame.travel`; and any place's requirements the bot states, as `loregame.requirements`. A
 * neutralizing ticket used (its answer names its player) and, in private, the owner's neutrality
 * ended, as `loregame.neutral`.
 * A gift (`/give`, `/dai`, §5.10), paired with its giver as the accumulo's answers are, as
 * `loregame.gift`.
 *
 * **The market** (docs/game-bots.md §5.11): every company's value, from each update (the bot's own,
 * or one its developer forced) and each market listed, as `loregame.market`; and, paired with the
 * player's command as the accumulo's answers are, the investments a listing shows them
 * (`loregame.investments`), an investment (`loregame.invest`) and a withdrawal
 * (`loregame.cashout`); and any company's page (`/azienda`), as `loregame.company`.
 *
 * **The shop** (docs/game-bots.md §5.12): every listing of the shop's (`/negozio`, `/shop`), in any
 * chat, the player who asked named by it, as `loregame.shop`: the day's items, the same for everyone,
 * each marked bought or not by that player. A listing its buttons edit back into one is read again.
 *
 * **Bans** (docs/game-bots.md §5): the bot answers a banned player's every message with the ban.
 *
 * - To the owner's turn, it is an outcome (`banned`, with its `until`), declared a refusal
 *   (bot-os.md D98), not an `ok`; `loregame-state` holds the commands until it ends (the outbox
 *   holds nothing back, D142).
 * - The parser also watches every message of the chats it reads for bans (`src/bans.ts`), the
 *   owner's and the group's players' (named by the message the bot replies to), and publishes
 *   `loregame.ban` and `loregame.unban` when one starts, changes or ends, `loregame-state` keeps
 *   them, and holds every command of the owner's readiness while the owner is banned, so that the
 *   shell's player, which asks the state before each command, sends nothing.
 */
import { type Inbound, type Plugin } from '@megabottron1999/core';
import {
  isPrivate,
  type SentCommand,
  type TurnOutcome,
  type TurnParserInterface,
  turnParserPlugin,
  type TurnReading,
} from '@megabottron1999/turns/turn-parser.ts';
import { z } from 'zod';
import {
  ACCUMULO,
  ACCUMULO_COMMANDS,
  accumuloReading,
  AccumuloWatch,
  parseAccumulo,
} from '#src/accumulo.ts';
import { BanWatch } from '#src/bans.ts';
import { parseEquip } from '#src/equipment.ts';
import { GiftWatch } from '#src/gifts.ts';
import { pageOf, parseInventory } from '#src/inventory.ts';
import {
  CASHOUT_COMMANDS,
  ForcedWatch,
  INVEST_COMMANDS,
  MARKET_COMMANDS,
  MarketWatch,
  parseMarket,
} from '#src/market.ts';
import { parseNeutrality, parseTravel, placeRequirements, type Requirements } from '#src/places.ts';
import { PlayerWatch } from '#src/players.ts';
import { parseProfile } from '#src/profile.ts';
import {
  type LoreAccumulo,
  LOREGAMEBOT,
  loreRestMs,
  parseLoreGameBot,
  splitLevelUp,
  TURN_COMMANDS,
} from '#src/replies.ts';
import { parseShop, type ShopListing } from '#src/shop.ts';
import { parseSkillMenu } from '#src/skills.ts';
import {
  parseTraining,
  TRAINING,
  TRAINING_COMMANDS,
  trainingReading,
  TrainingWatch,
} from '#src/training.ts';

export const LOREGAME_PARSER = 'loregame';
/**
 * @LoreGameBot's vocabulary (MegaBotTron1999's D140, D141): its turn, by its own command first and
 * its aliases after; the accumulo, by its full name, with `/acc` its alias, as the bot takes
 * both; and the training. The parser's, and given to `loregame-state`'s readiness too.
 */
export const LOREGAME_VOCABULARY = {
  bot: LOREGAMEBOT,
  turnCommands: TURN_COMMANDS[LOREGAMEBOT],
  commands: {
    [ACCUMULO]: { aliases: ACCUMULO_COMMANDS.slice(1) },
    [TRAINING]: { aliases: TRAINING_COMMANDS.slice(1) },
  },
};
/** Every form of `names` a player may send (D139, D140): each bare, then addressed to the bot. */
const formsOf = (names: readonly string[]): string[] => [
  ...names,
  ...names.map((c) => `${c}@${LOREGAMEBOT}`),
];
/** The events that tell a player's ban started or changed, and ended. */
export const BAN_EVENT = `${LOREGAME_PARSER}.ban`;
export const UNBAN_EVENT = `${LOREGAME_PARSER}.unban`;
/** The event that tells how the bot answered the owner's `/accumulo`. */
export const ACCUMULO_EVENT = `${LOREGAME_PARSER}.accumulo`;
/** The event of every player's level-up the parser can place, the owner's included (§5.4). */
export const LEVEL_UP_EVENT = `${LOREGAME_PARSER}.levelUp`;
/** The commands whose answers name nobody, and the events of every player's (§5.6, §5.7). */
const SKILLS_COMMAND = '/abilita';
const EQUIP_COMMAND = '/equipaggia';
export const SKILLS_EVENT = `${LOREGAME_PARSER}.skills`;
const INVENTORY_COMMAND = '/zaino';
const INVENTORY_ALIAS = '/i';
/** The inventory listings remembered, to name a later page's player. */
const KEPT_LISTINGS = 200;
const TRAVEL_COMMAND = '/vai';
const TRAVEL_ALIAS = '/v';
/** The events of every player's move or place (§5.9), and of every place's requirements. */
export const TRAVEL_EVENT = `${LOREGAME_PARSER}.travel`;
export const REQUIREMENTS_EVENT = `${LOREGAME_PARSER}.requirements`;
/** The event of every player's gift (`/give`, `/dai`, §5.10). */
export const GIFT_EVENT = `${LOREGAME_PARSER}.gift`;
/** The event of a player neutralized by a ticket, or of the owner's neutrality ended (§5.9). */
export const NEUTRAL_EVENT = `${LOREGAME_PARSER}.neutral`;
/** The event of every player's inventory listing, or page of one (§5.8). */
export const INVENTORY_EVENT = `${LOREGAME_PARSER}.inventory`;
export const EQUIPMENT_EVENT = `${LOREGAME_PARSER}.equipment`;
/** The event of every player's profile the account reads, the owner's included (§5.5). */
export const PROFILE_EVENT = `${LOREGAME_PARSER}.profile`;
/** The event of every player's answer to `/allenati`, the owner's included (§5.3). */
export const TRAINING_EVENT = `${LOREGAME_PARSER}.training`;
/** The events of every player's turns and `/accumulo`, the owner's included (§6.1). */
export const PLAYER_TURN_EVENT = `${LOREGAME_PARSER}.playerTurn`;
export const PLAYER_ACCUMULO_EVENT = `${LOREGAME_PARSER}.playerAccumulo`;
/** The market's events (§5.11): the values; a player's investments, investment, withdrawal; a company. */
export const MARKET_EVENT = `${LOREGAME_PARSER}.market`;
export const INVESTMENTS_EVENT = `${LOREGAME_PARSER}.investments`;
export const INVEST_EVENT = `${LOREGAME_PARSER}.invest`;
export const CASHOUT_EVENT = `${LOREGAME_PARSER}.cashout`;
export const COMPANY_EVENT = `${LOREGAME_PARSER}.company`;
/** The event of every shop listing (§5.12), whoever asked. */
export const SHOP_EVENT = `${LOREGAME_PARSER}.shop`;
/** The store's document of the bans it knows. */
const BANS_DOC = 'bans';

/** A ban, as an answer to a command other than the turn: nothing spent, every command held. */
const bannedReading = (until: number): TurnReading => ({
  outcome: { kind: 'nothing', bot: LOREGAMEBOT, reason: 'cooldown', banned: until } as TurnOutcome,
});

const parser: Plugin = turnParserPlugin({
  id: LOREGAME_PARSER,
  description: "@LoreGameBot's answers to the owner's turns: the items, the fights, and its rest",
  ...LOREGAME_VOCABULARY,
  read: (m): TurnReading => {
    // By its name, whichever alias was sent (D140).
    if (m.command === ACCUMULO || m.command === TRAINING) {
      // The answer to the owner's /accumulo (used, the success, or a "too soon" of some kind), or
      // to their /allenati (a training, or a "too soon").
      if (m.command === ACCUMULO) {
        const said = parseAccumulo(m.text);
        if (said !== undefined) return accumuloReading(said);
      } else {
        const said = parseTraining(m.text);
        if (said !== undefined) return trainingReading(said);
      }
      const outcome = parseLoreGameBot(m.text);
      // Banned: nothing spent; the ban holds every command (`loregame-state`'s readiness).
      return outcome.kind === 'banned' ? bannedReading(outcome.until) : { unread: true };
    }
    if (!m.answers && !(m.private && m.replies)) return undefined;
    const outcome = parseLoreGameBot(m.text);
    if (outcome.kind === 'unknown') return m.answers ? { unread: true } : undefined;
    const restMs = loreRestMs(outcome);
    // The bot's own line (one copy: a story may quote it) says the accumulo is full.
    const full = (outcome as { accumulo?: LoreAccumulo }).accumulo?.sure === true;
    return {
      outcome,
      ...(restMs === undefined ? {} : { restMs }),
      ...(full ? { unlocks: ['/accumulo'] } : {}),
    };
  },
});

const player = z
  .string()
  .describe('The player, as the group names them; the owner: their username');
const banEvent = z
  .object({
    chat: z.string(),
    player,
    until: z.number().describe('When the ban ends, as the bot states it (ms)'),
    owner: z.boolean().describe('The player is the owner of the account'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's ban, new or changed, as @LoreGameBot said it");
const unbanEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean(),
    playback: z.literal(true).optional(),
  })
  .describe(
    'A banned player served again by @LoreGameBot: their ban is over (it lifts them early)'
  );

const accumuloEvent = z
  .object({
    chat: z.string(),
    result: z
      .enum(['short', 'idle', 'used', 'locked'])
      .describe(
        'Not yet, full but nothing to zero, used (the next /lore has no rest), or under the level'
      ),
    count: z.number().optional().describe("The bot's counter: turns since the last use"),
    max: z.number().optional().describe('How many turns it needs, as the bot states it'),
    level: z.number().optional().describe('locked: the level it asks'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("How @LoreGameBot answered the owner's /accumulo");

const trainingEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    result: z.enum(['trained', 'soon']).describe('Trained, or too soon'),
    gym: z.string().nullable().optional().describe("trained: the faction's gym, none without one"),
    learned: z.number().optional().describe('trained: the "+N" it taught'),
    extra: z
      .number()
      .optional()
      .describe('trained: how much of the "+N" Calistenico added ("+N extra"); 0 without'),
    levelUp: z
      .looseObject({ level: z.number() })
      .optional()
      .describe("trained: the level-up it brought, as a turn's (src/replies.ts's LoreLevelUp)"),
    retryMs: z.number().optional().describe('soon: the wait left, as the bot states it (ms)'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("How @LoreGameBot answered a player's /allenati: any player's the account reads");

const levelUpEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    level: z.number().describe('The level reached'),
    coins: z.number().describe('The coins it gives'),
    skillPoints: z.number().describe('The /abilita points it gives'),
    items: z
      .array(
        z.object({
          item: z.string(),
          qty: z.number(),
          rarity: z.string(),
          tags: z.array(z.string()),
        })
      )
      .describe('The items it gives'),
    other: z.array(z.string()).describe('Lines of its list read as none of the above'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's level-up, whatever brought it: any player's the account can place");

const equipped = z
  .object({
    item: z.string(),
    level: z.object({ low: z.number(), high: z.number() }).nullable(),
  })
  .nullable();
const profileEvent = z
  .object({
    chat: z.string(),
    player: player.describe('The player it names, by username'),
    owner: z.boolean().describe('It names the account'),
    company: z.string().nullable(),
    level: z.number(),
    xp: z.number().describe('"⚔️": the XP they hold'),
    progress: z.number().nullable().describe("The bar's percentage towards the next level"),
    alignment: z.enum(['Bene', 'Male', 'Neutrale']),
    episode: z.number().describe('"Episodio": the turns they took'),
    recipes: z.number().nullable(),
    coins: z.number(),
    obsession: z.object({ item: z.string(), count: z.number() }).nullable(),
    equipment: z.object({ armour: equipped, amulet: equipped, weapon: equipped }),
    skills: z.record(z.string(), z.number()).describe('By name, their level (1–5)'),
    effects: z.array(z.object({ name: z.string(), leftMs: z.number().nullable() })),
    titles: z.array(z.string()),
    location: z.object({ name: z.string(), code: z.string() }).nullable(),
    unread: z.array(z.string()).describe('Its lines the grammar could not read'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe(
    "A player's profile (/info, /me), as @LoreGameBot gave it: any player's the account reads"
  );

const skillsEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    skills: z
      .array(
        z.object({
          name: z.string(),
          level: z.number().describe('0 (Ø) to its max'),
          max: z.number(),
          effect: z
            .object({ value: z.number(), unit: z.enum(['%', '']), what: z.string() })
            .describe('What it gives at its level, as the bot states it'),
        })
      )
      .describe('Every skill the menu lists, those at no level too'),
    points: z.number().describe('"Punti disponibili": the points left to spend'),
    edited: z
      .literal(true)
      .optional()
      .describe('The menu as a button pressed changed it (an edit, MegaBotTron1999 D144)'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe(
    "A player's skills menu (/abilita), as @LoreGameBot gave it, before any button pressed"
  );
const placeSchema = z.object({ name: z.string(), code: z.string() });
const requiredItem = z.object({
  item: z.string(),
  rarity: z.string(),
  tags: z.array(z.string()),
  level: z.object({ low: z.number(), high: z.number() }).nullable(),
});
const travelEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    kind: z
      .enum(['arrived', 'here', 'refused'])
      .describe('Arrived at `place`, is at it (/v), or was refused it'),
    place: placeSchema,
    consumed: z
      .array(requiredItem)
      .optional()
      .describe('arrived: the items entering took, one each'),
    requirements: z
      .object({
        level: z.number().nullable(),
        items: z.array(requiredItem),
        guardians: z.array(z.string()),
        met: z
          .array(z.string())
          .nullable()
          .describe(
            'refused: the guardians already made, by anyone ("Hai già:"); none if not told'
          ),
      })
      .nullable()
      .optional()
      .describe("here, refused: the place's requirements"),
    exits: z
      .array(placeSchema.extend({ locked: z.boolean() }))
      .optional()
      .describe('here: where they can go, each locked to them or not'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's move (/vai) or place (/v), as @LoreGameBot answered it");
const requirementsEvent = z
  .object({
    chat: z.string(),
    place: placeSchema,
    level: z.number().nullable().describe('The level it asks'),
    items: z.array(requiredItem).describe('The items it takes at the arrival, one each'),
    guardians: z
      .array(z.string())
      .describe(
        '"Almeno un guardiano [generato da] [<code>]": one made there by anyone, consumed by none'
      ),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A place's requirements, wherever @LoreGameBot states them");
const neutralEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    kind: z
      .enum(['neutralized', 'restored'])
      .describe('A ticket used (10 hours more of "Neutralizzato"), or the neutrality ended'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's neutrality, as @LoreGameBot told it (a ticket used; its end, in private)");
const giftEvent = z
  .object({
    chat: z.string(),
    player: player.describe('Who gave it'),
    owner: z.boolean().describe('The giver is the owner of the account'),
    kind: z.enum(['item', 'coins']),
    to: z.string().describe('Who received it, as the giver named them'),
    toOwner: z.boolean().describe('The receiver is the owner of the account'),
    item: z.string().optional(),
    qty: z.number().optional(),
    rarity: z.string().optional(),
    tags: z.array(z.string()).optional(),
    level: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
    coins: z.number().optional(),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's gift of items or coins (/give, /dai), as @LoreGameBot answered it");
const inventoryEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    filter: z.string().nullable().describe("/i's filter; none for the whole inventory"),
    items: z
      .array(
        z.object({
          item: z.string(),
          qty: z.number(),
          rarity: z.string(),
          tags: z.array(z.string()),
          level: z.object({ low: z.number(), high: z.number() }).nullable(),
        })
      )
      .describe("This page's items"),
    cut: z.boolean().describe('An item cut between this page and another, not read'),
    page: z
      .object({ first: z.boolean(), last: z.boolean() })
      .nullable()
      .describe('Which page its ◀️ ▶️ buttons say it is; none without them'),
    message: z.string().nullable().describe("The listing's message: its pages are its edits"),
    edited: z.literal(true).optional().describe('A page its buttons turned (an edit, D144)'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's inventory (/zaino, /i), or a page of it, as @LoreGameBot listed it");
const equipmentEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    kind: z
      .enum(['equipped', 'removed', 'listing'])
      .describe('An item equipped (replacing `removed`), taken off, or the slots listed'),
    item: z.string().optional(),
    removed: z.string().nullable().optional(),
    equipment: z
      .object({ armour: equipped, amulet: equipped, weapon: equipped })
      .optional()
      .describe('listing: the three slots'),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("What @LoreGameBot's answer to a player's /equipaggia changed, or listed");

const back = z.literal(true).optional().describe('Read from history, not news: act on none');
const quote = z.object({
  company: z.string().describe('As the market names it, its emoji included'),
  value: z.number(),
  change: z.number().describe('Since the update before'),
  pct: z.number(),
  direction: z.enum(['up', 'down', 'flat']),
});
const marketEvent = z
  .object({
    chat: z.string(),
    via: z
      .enum(['update', 'forced', 'listing'])
      .describe("The bot's own update, one its developer forced, or a market listed to a player"),
    quotes: z.array(quote),
    playback: back,
  })
  .describe("The market's values, as @LoreGameBot quoted them");
const investmentsEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    positions: z
      .array(
        z.object({ company: z.string(), invested: z.number(), value: z.number(), pct: z.number() })
      )
      .describe('Every investment they have open; none: `[]`'),
    total: z
      .object({ invested: z.number(), value: z.number(), pct: z.number() })
      .nullable()
      .describe('Their totals; none with nothing open'),
    playback: back,
  })
  .describe("A player's open investments, as the market listed them to them (/mercato, /borsa)");
const investEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    company: z.string(),
    amount: z.number().describe('Put in now'),
    invested: z.number().describe('All they have in it now'),
    entry: z.number().describe('The value it was entered at'),
    coins: z.number().describe('What they have left'),
    playback: back,
  })
  .describe("A player's investment (/punta, /investi), as @LoreGameBot answered it");
const cashoutEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    all: z.boolean().describe('Every investment withdrawn at once'),
    positions: z
      .array(
        z.object({
          company: z.string(),
          amount: z.number().describe('Of what was invested'),
          cashed: z.number(),
          left: z
            .number()
            .nullable()
            .describe('What is still invested there, at its value; none: all taken'),
        })
      )
      .describe('Each investment withdrawn'),
    playback: back,
  })
  .describe("A player's withdrawal (/riscuoti, /ritira), as @LoreGameBot answered it");
const companyEvent = z
  .object({
    chat: z.string(),
    name: z.string().describe('As its page names it: without its emoji'),
    size: z.number(),
    max: z.number(),
    leader: z.string(),
    power: z.number().describe('Its combat level, its members summed'),
    members: z.array(
      z.object({
        player: z.string(),
        faction: z.string().describe('Its emoji: 😇, 👿, 👤'),
        level: z.number(),
        power: z.number(),
      })
    ),
    value: z.number(),
    profile: z.string().nullable(),
    playback: back,
  })
  .describe("A company's page (/azienda), as @LoreGameBot showed it");

const shopEvent = z
  .object({
    chat: z.string(),
    player: player.describe('Who asked, as the listing names them'),
    owner: z.boolean().describe('The player is the owner of the account'),
    sagra: z
      .string()
      .nullable()
      .describe('The day\'s sagra, as the bot names it ("della pigna"); none on an ordinary day'),
    items: z
      .array(
        z.object({
          item: z.string(),
          rarity: z.string(),
          tags: z.array(z.string()),
          price: z.number().describe('In coins (₭)'),
          bought: z.boolean().describe('The player who asked has already bought it (✅)'),
        })
      )
      .describe("The day's items, in the listing's order: the same for every player"),
    edited: z.literal(true).optional().describe('A listing its buttons edited (D144)'),
    playback: back,
  })
  .describe("What @LoreGameBot's shop sells today (/negozio, /shop), as listed to a player");

const playerTurnEvent = z
  .object({
    chat: z.string(),
    player,
    owner: z.boolean().describe('The player is the owner of the account'),
    command: z.string().describe('The turn command it answered (/avventura, /lore, /l)'),
    outcome: z
      .looseObject({ kind: z.string(), bot: z.string() })
      .describe("The turn as the parser reads it (src/replies.ts's Outcome), or a 'too soon'"),
    playback: z.literal(true).optional().describe('Read from history, not news: act on none'),
  })
  .describe("A player's turn, as @LoreGameBot answered it: any player's the account reads");
const playerAccumuloEvent = accumuloEvent
  .extend({ player, owner: z.boolean().describe('The player is the owner of the account') })
  .describe("How @LoreGameBot answered a player's /accumulo: any player's the account reads");

/**
 * What the bot's answer to the owner's `/accumulo` tells a node that sent it (D98), as the parser's
 * own watch pairs it, in private or in the group, where the bot replies to no command and the
 * shell's parser cannot pair it: a use is the `ok`, the rest are refusals. They hold nothing back
 * (D142): the turns' rest it ends is `loregame-state`'s.
 */
const ACCUMULO_ANSWERS = (
  [
    ['used', 'ok', 'used'],
    ['idle', 'refused', 'idle'],
    ['short', 'refused', 'not_ready'],
    ['locked', 'refused', 'locked'],
  ] as const
).map(([result, status, reason]) => ({
  event: ACCUMULO_EVENT,
  commands: formsOf(ACCUMULO_COMMANDS),
  when: { result },
  status,
  reason,
}));

/**
 * What the bot's answer to the owner's `/allenati` tells a node that sent it (D98), paired by the
 * parser's own watch, as the accumulo's: a training is the `ok`, "too soon" a refusal.
 */
const TRAINING_ANSWERS = (
  [
    ['trained', 'ok', 'trained'],
    ['soon', 'refused', 'cooldown'],
  ] as const
).map(([result, status, reason]) => ({
  event: TRAINING_EVENT,
  commands: formsOf(TRAINING_COMMANDS),
  when: { result, owner: true },
  status,
  reason,
}));

/** The parser, with the bans, the accumulo and the training it watches for, beside the turns. */
export const loregamePlugin: Plugin = {
  manifest: {
    ...parser.manifest,
    events: {
      ...parser.manifest.events,
      [BAN_EVENT]: banEvent,
      [UNBAN_EVENT]: unbanEvent,
      [ACCUMULO_EVENT]: accumuloEvent,
      [TRAINING_EVENT]: trainingEvent,
      [LEVEL_UP_EVENT]: levelUpEvent,
      [PROFILE_EVENT]: profileEvent,
      [SKILLS_EVENT]: skillsEvent,
      [EQUIPMENT_EVENT]: equipmentEvent,
      [INVENTORY_EVENT]: inventoryEvent,
      [TRAVEL_EVENT]: travelEvent,
      [GIFT_EVENT]: giftEvent,
      [NEUTRAL_EVENT]: neutralEvent,
      [REQUIREMENTS_EVENT]: requirementsEvent,
      [PLAYER_TURN_EVENT]: playerTurnEvent,
      [PLAYER_ACCUMULO_EVENT]: playerAccumuloEvent,
      [MARKET_EVENT]: marketEvent,
      [INVESTMENTS_EVENT]: investmentsEvent,
      [INVEST_EVENT]: investEvent,
      [CASHOUT_EVENT]: cashoutEvent,
      [COMPANY_EVENT]: companyEvent,
      [SHOP_EVENT]: shopEvent,
    },
    // The ban comes first: any other outcome of a turn is an `ok`.
    answers: [
      {
        event: `${LOREGAME_PARSER}.turn`,
        commands: formsOf(TURN_COMMANDS[LOREGAMEBOT]),
        when: { 'outcome.kind': 'banned' },
        status: 'refused',
        reason: 'banned',
      },
      ...(parser.manifest.answers ?? []),
      ...ACCUMULO_ANSWERS,
      ...TRAINING_ANSWERS,
    ],
  },
  create: async (ctx) => {
    const instance = await parser.create(ctx);
    const chat = ctx.connector('chat');
    const watch = new BanWatch(
      LOREGAMEBOT,
      ctx.store.read<{ bans: [string, number][] }>(BANS_DOC)?.bans
    );
    const asked = new AccumuloWatch(LOREGAMEBOT);
    const players = new PlayerWatch(LOREGAMEBOT);
    /** Whose each inventory listing is, by its message, as its first page named them. */
    const listings = new Map<string, string>();
    /**
     * An inventory listing (`/zaino`, `/i`), a page of it, or a page its buttons turned (an edit,
     * D144): published for its player, as its first page names them, or as the first page of the same
     * message did, or as the command it replies to tells; with its page, as its buttons say (D145).
     */
    const listed = (m: Inbound, self: string | undefined): void => {
      const listing = parseInventory(m.text);
      if (listing === undefined) return;
      const key = `${m.chat}\n${m.id ?? ''}`;
      const player =
        listing.player ??
        listings.get(key) ??
        (answerTo(m, INVENTORY_COMMAND, self) ?? answerTo(m, INVENTORY_ALIAS, self))?.player;
      if (player === undefined || player === '') return;
      if (m.id !== undefined) {
        listings.delete(key);
        listings.set(key, player);
        if (listings.size > KEPT_LISTINGS) listings.delete(listings.keys().next().value as string);
      }
      ctx.bus.publish(
        INVENTORY_EVENT,
        {
          chat: m.chat,
          player,
          owner: self !== undefined && player.toLowerCase() === self.toLowerCase(),
          filter: listing.filter,
          items: listing.items,
          cut: listing.cut,
          page: pageOf(m.buttons),
          message: m.id ?? null,
          ...(m.edited === undefined ? {} : { edited: true as const }),
          ...(m.playback ? { playback: true as const } : {}),
        },
        m.edited ?? m.time
      );
    };
    /**
     * Whose answer `m` is when it is the bot's to a command `word` (the skills menu, an answer to
     * /equipaggia): the player's whose message it replies to, if that message was the command; in
     * private, the owner's. None for one replying to anything else.
     */
    const answerTo = (
      m: Inbound,
      word: string,
      self: string | undefined
    ): { player: string; owner: boolean } | undefined => {
      const w = m.replyTo === undefined ? undefined : players.whose(m.chat, m.replyTo, self);
      if (w !== undefined)
        return w.word === word ? { player: w.player, owner: w.owner } : undefined;
      return isPrivate(m) ? { player: self ?? '', owner: true } : undefined;
    };
    /** A shop listing (§5.12), published for the player it names, at `t`. */
    const shop = (m: Inbound, self: string | undefined, t: number): void => {
      const listing: ShopListing | undefined = parseShop(m.text);
      if (listing === undefined) return;
      ctx.bus.publish(
        SHOP_EVENT,
        {
          chat: m.chat,
          ...listing,
          owner: self !== undefined && listing.player.toLowerCase() === self.toLowerCase(),
          ...(m.edited === undefined ? {} : { edited: true as const }),
          ...(m.playback ? { playback: true as const } : {}),
        },
        t
      );
    };
    const trained = new TrainingWatch(LOREGAMEBOT);
    const gifts = new GiftWatch(LOREGAMEBOT);
    const marketAsked = new MarketWatch(LOREGAMEBOT, MARKET_COMMANDS, ['market']);
    const invests = new MarketWatch(LOREGAMEBOT, INVEST_COMMANDS, ['invest']);
    const cashouts = new MarketWatch(LOREGAMEBOT, CASHOUT_COMMANDS, ['cashout', 'cashout-all']);
    const forced = new ForcedWatch(LOREGAMEBOT);
    /**
     * The market (§5.11): every message heard by each watch (a player's command waits; the bot's
     * answer is paired); the values quoted, anyone's; what is a player's, theirs.
     */
    const market = (m: Inbound, self: string | undefined): void => {
      const old = m.playback ? { playback: true as const } : {};
      const listed = marketAsked.answer(m, self);
      const invested = invests.answer(m, self);
      const cashed = cashouts.answer(m, self);
      const force = forced.answer(m, self);
      if (m.own === true || m.sender.toLowerCase() !== LOREGAMEBOT.toLowerCase()) return;
      const r = parseMarket(m.text);
      if (r === undefined) return;
      const who = (a: { player: string; owner: boolean } | undefined) =>
        a === undefined || a.player === '' ? undefined : { player: a.player, owner: a.owner };
      if (r.kind === 'update' || r.kind === 'market') {
        // Every company there is, none when none is quoted: one not quoted is gone.
        if (r.quotes.length > 0 || r.kind === 'market')
          ctx.bus.publish(
            MARKET_EVENT,
            {
              chat: m.chat,
              via: r.kind === 'market' ? 'listing' : force === undefined ? 'update' : 'forced',
              quotes: r.quotes,
              ...old,
            },
            m.time
          );
        const of = who(listed);
        if (r.kind === 'market' && r.positions !== null && of !== undefined)
          ctx.bus.publish(
            INVESTMENTS_EVENT,
            { chat: m.chat, ...of, positions: r.positions, total: r.total, ...old },
            m.time
          );
        return;
      }
      if (r.kind === 'invest') {
        const of = who(invested);
        if (of === undefined) return;
        const { kind: _, ...made } = r;
        ctx.bus.publish(INVEST_EVENT, { chat: m.chat, ...of, ...made, ...old }, m.time);
        return;
      }
      if (r.kind === 'cashout' || r.kind === 'cashout-all') {
        const of = who(cashed);
        if (of === undefined) return;
        const positions =
          r.kind === 'cashout'
            ? [{ company: r.company, amount: r.amount, cashed: r.cashed, left: r.left }]
            : r.positions.map((p) => ({
                company: p.company,
                amount: p.invested,
                cashed: p.cashed,
                left: null,
              }));
        ctx.bus.publish(
          CASHOUT_EVENT,
          { chat: m.chat, ...of, all: r.kind === 'cashout-all', positions, ...old },
          m.time
        );
        return;
      }
      const { kind: _, ...page } = r;
      ctx.bus.publish(COMPANY_EVENT, { chat: m.chat, ...page, ...old }, m.time);
    };
    chat.onMessage((m) => {
      const old = m.playback ? { playback: true as const } : {};
      // While an owner's /accumulo or /allenati waits for its answer, each message of the bot's in
      // that chat is logged (its id, a reply or not, never its text), with what the watch made of
      // it: an answer the parser does not pair shows whether it arrived at all.
      const bots = m.own !== true && m.sender.toLowerCase() === LOREGAMEBOT.toLowerCase();
      const waiting = bots
        ? [...asked.ownerWaiting(m.chat, m.time), ...trained.ownerWaiting(m.chat, m.time)]
        : [];
      const news = watch.hear(m, chat.self());
      if (news !== undefined) {
        if (news.type === 'ban')
          ctx.bus.publish(
            BAN_EVENT,
            { chat: m.chat, player: news.player, until: news.until, owner: news.owner, ...old },
            m.time
          );
        else
          ctx.bus.publish(
            UNBAN_EVENT,
            { chat: m.chat, player: news.player, owner: news.owner, ...old },
            m.time
          );
        ctx.store.write(BANS_DOC, { bans: watch.entries() });
      }
      const self = chat.self();
      const turn = players.hear(m, self);
      if (turn !== undefined)
        ctx.bus.publish(PLAYER_TURN_EVENT, { chat: m.chat, ...turn, ...old }, m.time);
      const any = asked.answer(m, self);
      if (any !== undefined && any.player !== '')
        ctx.bus.publish(
          PLAYER_ACCUMULO_EVENT,
          { chat: m.chat, player: any.player, owner: any.owner, ...any.reply, ...old },
          m.time
        );
      const answer = any?.owner === true ? any.reply : undefined;
      const logHeard = (made: string): void =>
        ctx.log.info(
          `heard the bot's #${m.id ?? '?'} in ${m.chat} (${m.replyTo === undefined ? 'standalone' : `replying to #${m.replyTo}`}) while ${waiting.join(', ')} waited: ${made}`
        );
      if (answer !== undefined) {
        // `loregame-state` reduces it into the owner's readiness, in any chat (D141): a use ends
        // the turns' rest there, and nowhere else (D142).
        ctx.bus.publish(ACCUMULO_EVENT, { chat: m.chat, ...answer, ...old }, m.time);
      }
      // Any player's training, the owner's in any chat: `loregame-state` folds the owner's success
      // into the readiness (the shell pairs it in private alone).
      const training = trained.answer(m, self);
      if (waiting.length > 0)
        logHeard(
          any !== undefined
            ? `/accumulo ${any.reply.result}, ${any.owner ? 'the owner' : any.player}'s`
            : training !== undefined
              ? `/allenati ${training.reply.result}, ${training.owner ? 'the owner' : training.player}'s`
              : 'no answer of theirs'
        );
      if (training !== undefined) {
        const { player: who, owner, reply } = training;
        ctx.bus.publish(
          TRAINING_EVENT,
          { chat: m.chat, player: who, owner, ...reply, ...old },
          m.time
        );
      }
      market(m, self);
      // A gift, its giver's (the answer names the receiver alone, and replies to nothing, §5.10).
      const gift = gifts.answer(m, self);
      if (gift !== undefined) {
        const { player: giver, owner: mine, reply } = gift;
        ctx.bus.publish(
          GIFT_EVENT,
          {
            chat: m.chat,
            player: giver,
            owner: mine,
            ...reply,
            toOwner: self !== undefined && reply.to.toLowerCase() === self.toLowerCase(),
            ...old,
          },
          m.time
        );
      }
      // A profile, its player's: it names them (§5.5).
      const profile = bots ? parseProfile(m.text) : undefined;
      if (profile !== undefined)
        ctx.bus.publish(
          PROFILE_EVENT,
          {
            chat: m.chat,
            ...profile,
            owner: self !== undefined && profile.player.toLowerCase() === self.toLowerCase(),
            ...old,
          },
          m.time
        );
      // A level-up, whatever brought it, for the player the message is about (§5.4).
      if (m.own !== true && m.sender.toLowerCase() === LOREGAMEBOT.toLowerCase()) {
        const { levelUp } = splitLevelUp(m.text.normalize('NFC'));
        const by = isPrivate(m)
          ? { player: self ?? '', owner: true }
          : m.replyTo !== undefined
            ? players.whose(m.chat, m.replyTo, self)
            : training === undefined
              ? undefined
              : { player: training.player, owner: training.owner };
        if (levelUp !== undefined && by !== undefined)
          ctx.bus.publish(
            LEVEL_UP_EVENT,
            { chat: m.chat, player: by.player, owner: by.owner, ...levelUp, ...old },
            m.time
          );
        // The skills menu and the answers to /equipaggia name nobody: they reply to the player's
        // command, which they are about only if it was that command (a refusal like "Non possiedi
        // l'oggetto!" is other commands' too, and is not read).
        const to = (word: string) => answerTo(m, word, self);
        const menu = parseSkillMenu(m.text);
        const menuOf = menu === undefined ? undefined : to(SKILLS_COMMAND);
        if (menu !== undefined && menuOf !== undefined)
          ctx.bus.publish(SKILLS_EVENT, { chat: m.chat, ...menuOf, ...menu, ...old }, m.time);
        const equip = parseEquip(m.text);
        const equipOf = equip === undefined ? undefined : to(EQUIP_COMMAND);
        if (equip !== undefined && equipOf !== undefined)
          ctx.bus.publish(EQUIPMENT_EVENT, { chat: m.chat, ...equipOf, ...equip, ...old }, m.time);
        listed(m, self);
        shop(m, self, m.time);
        // Neutrality (§5.9): a ticket's answer names its player; its end is told the owner alone, in
        // private.
        const neutral = parseNeutrality(m.text);
        const neutralOf =
          neutral?.kind === 'neutralized'
            ? {
                player: neutral.player,
                owner: self !== undefined && neutral.player.toLowerCase() === self.toLowerCase(),
              }
            : neutral?.kind === 'restored' && isPrivate(m)
              ? { player: self ?? '', owner: true }
              : undefined;
        if (neutral !== undefined && neutralOf !== undefined)
          ctx.bus.publish(
            NEUTRAL_EVENT,
            { chat: m.chat, ...neutralOf, kind: neutral.kind, ...old },
            m.time
          );
        // A move or a place (/vai, /v), the player's whose command it replies to; and any place's
        // requirements the bot states, whoever asked (they are the game's).
        const travel = parseTravel(m.text);
        const traveller =
          travel === undefined ? undefined : (to(TRAVEL_COMMAND) ?? to(TRAVEL_ALIAS));
        if (travel !== undefined && traveller !== undefined)
          ctx.bus.publish(TRAVEL_EVENT, { chat: m.chat, ...traveller, ...travel, ...old }, m.time);
        const here = travel?.kind === 'here' && travel.requirements !== null ? [travel] : [];
        for (const r of [
          ...here.map((h) => ({ place: h.place, requirements: h.requirements as Requirements })),
          ...placeRequirements(m.text),
        ]) {
          // What the player has of them is theirs, on the move: the place's are the game's.
          const { met: _, ...requirements } = r.requirements;
          ctx.bus.publish(
            REQUIREMENTS_EVENT,
            { chat: m.chat, place: r.place, ...requirements, ...old },
            m.time
          );
        }
      }
    });
    // The skills menu, as its buttons change it (D144): the bot edits the menu at each point spent.
    // An edit of a menu replying to a player's /abilita is that player's menu now, published at the
    // edit's time; every other edit is ignored, as the game ignores them (a command edited is not
    // played again). A shell before D144 offers no edits: the next menu or profile tells instead.
    chat.onEdit?.((m) => {
      if (m.own === true || m.sender.toLowerCase() !== LOREGAMEBOT.toLowerCase()) return;
      listed(m, chat.self());
      shop(m, chat.self(), m.edited ?? m.time);
      const menu = parseSkillMenu(m.text);
      const of = menu === undefined ? undefined : answerTo(m, SKILLS_COMMAND, chat.self());
      if (menu === undefined || of === undefined) return;
      ctx.bus.publish(
        SKILLS_EVENT,
        { chat: m.chat, ...of, ...menu, edited: true, ...(m.playback ? { playback: true } : {}) },
        m.edited ?? m.time
      );
    });
    const turns = instance.interface as TurnParserInterface;
    return {
      ...instance,
      interface: {
        actions: {
          // The account never hears its own sends: the watches learn of the player's here, as the
          // parser does, to pair their answers.
          sent: (sent: SentCommand) => {
            turns.actions.sent(sent);
            asked.sent(sent);
            trained.sent(sent);
            gifts.sent(sent);
            for (const w of [marketAsked, invests, cashouts]) w.sent(sent);
            if (asked.isCommand(sent.command ?? '') || trained.isCommand(sent.command ?? ''))
              ctx.log.info(
                `waits for the answer to ${sent.command} #${sent.id ?? '?'} in ${sent.chat}`
              );
            players.sent(sent, chat.self());
          },
        },
      },
    };
  },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregamePlugin];
