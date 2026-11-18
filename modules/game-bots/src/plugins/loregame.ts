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
import { type Plugin } from '@megabottron1999/core';
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
/** The event of every player's profile the account reads, the owner's included (§5.5). */
export const PROFILE_EVENT = `${LOREGAME_PARSER}.profile`;
/** The event of every player's answer to `/allenati`, the owner's included (§5.3). */
export const TRAINING_EVENT = `${LOREGAME_PARSER}.training`;
/** The events of every player's turns and `/accumulo`, the owner's included (§6.1). */
export const PLAYER_TURN_EVENT = `${LOREGAME_PARSER}.playerTurn`;
export const PLAYER_ACCUMULO_EVENT = `${LOREGAME_PARSER}.playerAccumulo`;
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
    extra: z.number().optional().describe('trained: the "+N extra" a bonus added; 0 without'),
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
      [PLAYER_TURN_EVENT]: playerTurnEvent,
      [PLAYER_ACCUMULO_EVENT]: playerAccumuloEvent,
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
    const trained = new TrainingWatch(LOREGAMEBOT);
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
          ctx.bus.publish(LEVEL_UP_EVENT, { chat: m.chat, ...by, ...levelUp, ...old }, m.time);
      }
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
