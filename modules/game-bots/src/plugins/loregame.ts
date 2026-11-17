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
 * **Bans** (docs/game-bots.md §5): the bot answers a banned player's every message with the ban.
 *
 * - To the owner's turn, it is an outcome (`banned`, with its `until`), declared a refusal that
 *   holds the bot's commands back until then (bot-os.md D98), not an `ok`.
 * - The parser also watches every message of the chats it reads for bans (`src/bans.ts`), the
 *   owner's and the group's players' (named by the message the bot replies to), and publishes
 *   `loregame.ban` and `loregame.unban` when one starts, changes or ends, `loregame-state` keeps
 *   them. While the owner is banned, its `state.rest` says so, so that the shell's turn-actor,
 *   which asks its parser as it wakes, sends nothing.
 */
import { type Plugin } from '@megabottron1999/core';
import {
  type TurnParserInterface,
  turnParserPlugin,
  type TurnReading,
} from '@megabottron1999/turns/turn-parser.ts';
import { z } from 'zod';
import { BanWatch } from '#src/bans.ts';
import {
  LORE_COMMANDS,
  LORE_DEFEAT_REST_MS,
  LOREGAMEBOT,
  type Outcome,
  parseLoreGameBot,
  TURN_COMMANDS,
  TURN_REST_MS,
} from '#src/replies.ts';

export const LOREGAME_PARSER = 'loregame';
/** The events that tell a player's ban started or changed, and ended. */
export const BAN_EVENT = `${LOREGAME_PARSER}.ban`;
export const UNBAN_EVENT = `${LOREGAME_PARSER}.unban`;
/** The store's document of the bans it knows. */
const BANS_DOC = 'bans';

/** The rest a turn's outcome starts. */
function restOf(o: Outcome): number | undefined {
  if (o.kind === 'gain') return TURN_REST_MS;
  if (o.kind !== 'nothing') return undefined;
  if (o.reason === 'defeated') return LORE_DEFEAT_REST_MS;
  if (o.reason === 'lost') return TURN_REST_MS;
  // The ending is cut off, but a fight lost shows in the line before it.
  if (o.reason === 'truncated')
    return o.fight?.result === 'lost' ? LORE_DEFEAT_REST_MS : TURN_REST_MS;
  if (o.reason === 'cooldown') return o.retryMs;
  return undefined;
}

const parser: Plugin = turnParserPlugin({
  id: LOREGAME_PARSER,
  bot: LOREGAMEBOT,
  description: "@LoreGameBot's answers to the owner's turns: the items, the fights, and its rest",
  turnCommands: TURN_COMMANDS[LOREGAMEBOT],
  read: (m): TurnReading => {
    if (!m.answers && !(m.private && m.replies)) return undefined;
    const outcome = parseLoreGameBot(m.text);
    if (outcome.kind === 'unknown') return m.answers ? { unread: true } : undefined;
    const restMs = restOf(outcome);
    return restMs === undefined ? { outcome } : { outcome, restMs };
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

/** The parser, with the bans it watches for, beside the turns it reads. */
export const loregamePlugin: Plugin = {
  manifest: {
    ...parser.manifest,
    events: {
      ...parser.manifest.events,
      [BAN_EVENT]: banEvent,
      [UNBAN_EVENT]: unbanEvent,
    },
    // The ban comes first: any other outcome of a turn is an `ok`.
    answers: [
      {
        event: `${LOREGAME_PARSER}.turn`,
        commands: [...TURN_COMMANDS[LOREGAMEBOT]],
        when: { 'outcome.kind': 'banned' },
        status: 'refused',
        reason: 'banned',
        retryAtFrom: 'outcome.until',
        holds: [...LORE_COMMANDS],
      },
      ...(parser.manifest.answers ?? []),
    ],
  },
  create: async (ctx) => {
    const instance = await parser.create(ctx);
    const chat = ctx.connector('chat');
    const watch = new BanWatch(
      LOREGAMEBOT,
      ctx.store.read<{ bans: [string, number][] }>(BANS_DOC)?.bans
    );
    chat.onMessage((m) => {
      const news = watch.hear(m, chat.self());
      if (news === undefined) return;
      const old = m.playback ? { playback: true as const } : {};
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
    });
    const turns = instance.interface as TurnParserInterface;
    const rest = turns.state.rest;
    return {
      ...instance,
      interface: {
        ...turns,
        state: {
          ...turns.state,
          // While the owner is banned, the bot rests until the ban ends.
          rest: () => {
            const base = rest();
            const now = ctx.clock.now();
            const until = watch.until(BanWatch.owner(chat.self()), now);
            return until === undefined || (base !== undefined && base.until >= until)
              ? base
              : { until, why: 'the owner is banned' };
          },
        },
      },
    };
  },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregamePlugin];
