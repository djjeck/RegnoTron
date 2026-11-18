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
 * **The accumulo** (docs/game-bots.md §5.2), a command a shell player plays: the parser declares
 * `/accumulo` with its mechanics (unlocked by the bot's word, its use ending `/lore`'s rest), and
 * a turn that finds it full carries the line
 * "🔋 /accumulo pronto!", which the outcome of `loregame.turn` has as `accumulo`; and the bot's
 * answer to the owner's `/accumulo` (in private, or the one that follows the command in the
 * group) is published as `loregame.accumulo`, for `loregame-state` to count against.
 *
 * **Bans** (docs/game-bots.md §5): the bot answers a banned player's every message with the ban.
 *
 * - To the owner's turn, it is an outcome (`banned`, with its `until`), declared a refusal that
 *   holds the bot's commands back until then (bot-os.md D98), not an `ok`.
 * - The parser also watches every message of the chats it reads for bans (`src/bans.ts`), the
 *   owner's and the group's players' (named by the message the bot replies to), and publishes
 *   `loregame.ban` and `loregame.unban` when one starts, changes or ends, `loregame-state` keeps
 *   them. While the owner is banned, its `state.rest` and `state.ready` say so (every command
 *   held), so that the shell's player, which asks its parser before each command, sends nothing.
 */
import { type Plugin } from '@megabottron1999/core';
import {
  type TurnOutcome,
  type TurnParserInterface,
  turnParserPlugin,
  type TurnReading,
} from '@megabottron1999/turns/turn-parser.ts';
import { z } from 'zod';
import {
  ACCUMULO_COMMANDS,
  ACCUMULO_MECHANICS,
  accumuloReading,
  AccumuloWatch,
  parseAccumulo,
} from '#src/accumulo.ts';
import { BanWatch } from '#src/bans.ts';
import { PlayerWatch } from '#src/players.ts';
import {
  LORE_COMMANDS,
  type LoreAccumulo,
  LOREGAMEBOT,
  loreRestMs,
  parseLoreGameBot,
  TURN_COMMANDS,
} from '#src/replies.ts';

export const LOREGAME_PARSER = 'loregame';
/** The turn's name (D140), by which the parser keys its readiness: its aliases follow it. */
const TURN = TURN_COMMANDS[LOREGAMEBOT][0] as string;
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
/** The store's document of the owner's last `/accumulo` the bot answered with no to a new one. */
const ACCUMULO_DOC = 'accumulo';

const parser: Plugin = turnParserPlugin({
  id: LOREGAME_PARSER,
  bot: LOREGAMEBOT,
  description: "@LoreGameBot's answers to the owner's turns: the items, the fights, and its rest",
  turnCommands: TURN_COMMANDS[LOREGAMEBOT],
  // The bot's other commands a shell player may play, with their mechanics (D132, D137): the
  // accumulo, by its full name, with `/acc` its alias (D140), as the bot takes both.
  commands: { '/accumulo': { ...ACCUMULO_MECHANICS, aliases: ['/acc'] } },
  read: (m): TurnReading => {
    // By its name, whichever alias was sent (D140).
    if (m.command === '/accumulo') {
      // The answer to the owner's /accumulo: used (the success), or a "too soon" of some kind.
      const said = parseAccumulo(m.text);
      if (said !== undefined) return accumuloReading(said);
      const outcome = parseLoreGameBot(m.text);
      // Banned: nothing spent; the ban holds every command (`state.ready`, below).
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
    holds: z
      .record(z.string(), z.number())
      .optional()
      .describe("used: the turn commands' rest, ended now (ms), for the outbox (D98, D132)"),
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
 * shell's parser cannot pair it: a use is the `ok`, and ends the turns' hold in the outbox
 * (`holds`); the rest are refusals.
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
  holdsAtFrom: 'holds',
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
        retryAtFrom: 'outcome.until',
        holds: formsOf(LORE_COMMANDS),
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
    /**
     * The owner's last /accumulo the bot answered with a use or a no, in any chat, by hand or not:
     * the shell's parser pairs only a reply to the command it knows, and the bot replies to none
     * in the group.
     */
    let spent = ctx.store.read<{ spent?: { t: number; result: string } }>(ACCUMULO_DOC)?.spent;
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
        // A use ends the turns' rest: told to the outbox with the answer (`holds`), for each of
        // the turn's forms, every name bare and addressed (D140).
        const holds =
          answer.result === 'used'
            ? {
                holds: Object.fromEntries(
                  formsOf(TURN_COMMANDS[LOREGAMEBOT]).map((c) => [c, m.time])
                ),
              }
            : {};
        ctx.bus.publish(ACCUMULO_EVENT, { chat: m.chat, ...answer, ...holds, ...old }, m.time);
        // "Already ready" spends nothing and says it is full: it holds nothing back.
        if (answer.result !== 'idle') {
          spent = { t: m.time, result: answer.result };
          ctx.store.write(ACCUMULO_DOC, { spent });
        }
      }
    });
    const turns = instance.interface as TurnParserInterface;
    const { rest, ready, lastTurn } = turns.state;
    /**
     * The owner used the accumulo since their last turn: the rest that turn started is over, as
     * the bot ended it, whether or not the shell's parser paired the answer (in the group it
     * cannot). Since when, if so.
     */
    const zeroed = (): number | undefined =>
      spent?.result === 'used' && spent.t >= (lastTurn()?.t ?? -Infinity) ? spent.t : undefined;
    /** Until when the owner is banned, if they are now. */
    const banned = (): number | undefined =>
      watch.until(BanWatch.owner(chat.self()), ctx.clock.now());
    return {
      ...instance,
      interface: {
        ...turns,
        actions: {
          ...turns.actions,
          // The account never hears its own sends: the watches learn of the player's here.
          sent: (sent: Parameters<TurnParserInterface['actions']['sent']>[0]) => {
            turns.actions.sent(sent);
            asked.sent(sent);
            players.sent(sent, chat.self());
          },
        },
        state: {
          ...turns.state,
          // While the owner is banned, the bot rests until the ban ends.
          rest: () => {
            const base = zeroed() === undefined ? rest() : undefined;
            const until = banned();
            return until === undefined || (base !== undefined && base.until >= until)
              ? base
              : { until, why: 'the owner is banned' };
          },
          // And every command is held until then, as the bot answers each with the ban (the
          // shell's player asks this before each command).
          ready: () => {
            const base = ready();
            const since = zeroed();
            // Keyed by the commands' names (D140): the turn's, and the accumulo's.
            const lore = base[TURN];
            if (since !== undefined && lore !== undefined && !lore.ready) {
              const { until: _u, why: _w, ...seen } = lore;
              base[TURN] = { ...seen, ready: true, since };
            }
            // Spent, or refused, since the bot last said it was full: not ready, whatever the
            // shell's parser paired (a use by hand, an answer in the group).
            const acc = base['/accumulo'];
            if (acc?.ready === true && spent !== undefined && spent.t >= (acc.since ?? -Infinity)) {
              const { since: _, ...seen } = acc;
              base['/accumulo'] = {
                ...seen,
                ready: false,
                why:
                  spent.result === 'used'
                    ? 'used since the bot said it was full'
                    : 'the bot said it is not full',
              };
            }
            const until = banned();
            if (until === undefined) return base;
            return Object.fromEntries(
              Object.entries(base).map(([command, r]) => {
                if (!r.ready && r.until !== undefined && r.until >= until) return [command, r];
                const { since: _, ...seen } = r;
                return [command, { ...seen, ready: false, until, why: 'the owner is banned' }];
              })
            );
          },
        },
      },
    };
  },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregamePlugin];
