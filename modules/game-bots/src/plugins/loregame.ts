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
import {
  type LoreAccumulo,
  LOREGAMEBOT,
  loreRestMs,
  parseLoreGameBot,
  TURN_COMMANDS,
} from '#src/replies.ts';

export const LOREGAME_PARSER = 'loregame';
/**
 * @LoreGameBot's vocabulary (MegaBotTron1999's D140, D141): its turn, by its own command first and
 * its aliases after, and the accumulo, by its full name, with `/acc` its alias, as the bot takes
 * both. The parser's, and given to `loregame-state`'s readiness too.
 */
export const LOREGAME_VOCABULARY = {
  bot: LOREGAMEBOT,
  turnCommands: TURN_COMMANDS[LOREGAMEBOT],
  commands: { [ACCUMULO]: { aliases: ACCUMULO_COMMANDS.slice(1) } },
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
/** The events of every player's turns and `/accumulo`, the owner's included (§6.1). */
export const PLAYER_TURN_EVENT = `${LOREGAME_PARSER}.playerTurn`;
export const PLAYER_ACCUMULO_EVENT = `${LOREGAME_PARSER}.playerAccumulo`;
/** The store's document of the bans it knows. */
const BANS_DOC = 'bans';

const parser: Plugin = turnParserPlugin({
  id: LOREGAME_PARSER,
  description: "@LoreGameBot's answers to the owner's turns: the items, the fights, and its rest",
  ...LOREGAME_VOCABULARY,
  read: (m): TurnReading => {
    // By its name, whichever alias was sent (D140).
    if (m.command === ACCUMULO) {
      // The answer to the owner's /accumulo: used (the success), or a "too soon" of some kind.
      const said = parseAccumulo(m.text);
      if (said !== undefined) return accumuloReading(said);
      const outcome = parseLoreGameBot(m.text);
      // Banned: nothing spent; the ban holds every command (`loregame-state`'s readiness).
      if (outcome.kind === 'banned')
        return {
          outcome: {
            kind: 'nothing',
            bot: LOREGAMEBOT,
            reason: 'cooldown',
            banned: outcome.until,
          } as TurnOutcome,
        };
      return { unread: true };
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

/** The parser, with the bans and the accumulo it watches for, beside the turns it reads. */
export const loregamePlugin: Plugin = {
  manifest: {
    ...parser.manifest,
    events: {
      ...parser.manifest.events,
      [BAN_EVENT]: banEvent,
      [UNBAN_EVENT]: unbanEvent,
      [ACCUMULO_EVENT]: accumuloEvent,
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
    chat.onMessage((m) => {
      const old = m.playback ? { playback: true as const } : {};
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
      if (answer !== undefined) {
        // `loregame-state` reduces it into the owner's readiness, in any chat (D141): a use ends
        // the turns' rest there, and nowhere else (D142).
        ctx.bus.publish(ACCUMULO_EVENT, { chat: m.chat, ...answer, ...old }, m.time);
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
            players.sent(sent, chat.self());
          },
        },
      },
    };
  },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregamePlugin];
