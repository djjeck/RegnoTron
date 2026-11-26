/**
 * NorelecBot's game as a plugin (MegaBotTron1999's docs/bot-os-api.md §5): the plugin `norelec`, a parser. It holds
 * the game (modules/norelec/src/plugins/norelec-game.ts: the IRC parser and the game state) and
 * reads into it the game's IRC channel, through its handle on `irc` (`channel`), and the game's
 * Telegram group and the owner's private chat with the bot, through a Telegram connector
 * (`telegram`), either or both; it publishes each bot message on the bus as `norelec.message` once
 * the state has applied it, which writes the message to the event log too, then each of its events
 * as `norelec.<kind>` (the `norelec-state` plugin's input), and reports each as read or unread
 * (drift, P5). A message the other network already gave is not published again (norelec-game.ts). A message complete with its line is
 * published inside the handler the shell calls with that line, the moment the shell counts as the
 * channel heard (bot-os.md D93) and pairs answers (D98); its events about the owner's account that
 * answer a command follow it as `norelec.answer`. It keeps the players known to be
 * Telegram accounts in its store (modules/norelec/src/plugins/norelec-accounts.ts), and publishes
 * the game's notices as `norelec.notice`.
 *
 * It makes the game at `create` and offers it to the plugins that use it (`state.game`), which
 * listen to it as they are made. At `ready`, once they are all in place, it replays
 * the last hours of the log through the game, which they hear with the state as it was at each
 * message (the channel's lines heard before wait for the replay), and from then on ticks the game on
 * its clock, first once every plugin is ready.
 */
import { IRC } from '@megabottron1999/connectors/plugins/irc.ts';
import { type ChannelLine } from '@megabottron1999/connectors/transport/transport.ts';
import {
  type ConnectorHandle,
  definePlugin,
  type LogEntry,
  type Plugin,
  type Reading,
} from '@megabottron1999/core';
import { z } from 'zod';
import { exportBotMessage, type ExportMessage } from '#src/export/export-parser.ts';
import { ANSWER_RULES, answerDeclarations, answerOf } from '#src/game/answers.ts';
import { type BotMessage } from '#src/game/bot-message.ts';
import { EVENT_KINDS, type GameEvent } from '#src/game/events.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { RELAYS, stripZeroWidth } from '#src/transport/relay.ts';
import { type StoredAccounts, TelegramAccounts } from './norelec-accounts.ts';
import { type GameDeps, NorelecGame, type TelegramMessage } from './norelec-game.ts';

export const NORELEC = 'norelec';

/** A bot message on the bus: its text and its events (its time is the event's). */
export const MESSAGE_EVENT = 'norelec.message';
export const messageSchema = z.object({
  text: z.string(),
  events: z.array(z.looseObject({ kind: z.string() })),
  /** The network it was read on. */
  source: z.enum(['irc', 'telegram']).optional(),
  /** History: a message said while the instance was down, read at its catch-up (D83). */
  playback: z.boolean().optional(),
});

/**
 * Each event of a bot message, on its own: `norelec.<kind>` (`norelec.theft`, `norelec.ballTaken`),
 * the event's fields, with the owner's account (`self`) and, for history, `playback`. Not for
 * `info` and `unknown`, which say nothing of the game's state.
 */
export const KIND_EVENTS: readonly string[] = EVENT_KINDS.filter(
  (k) => k !== 'info' && k !== 'unknown'
);
export const kindSchema = z.looseObject({
  kind: z.string(),
  line: z.string(),
  self: z.string().optional(),
  playback: z.boolean().optional(),
});

/** A notice of the game state on the bus (modules/norelec/src/state/game-state.ts `Notice`). */
export const NOTICE_EVENT = 'norelec.notice';
export const noticeSchema = z.object({
  notice: z.looseObject({ kind: z.string(), player: z.string(), at: z.number() }),
});

/**
 * NorelecBot's answer to a command of the owner's account (modules/norelec/src/game/answers.ts):
 * published with its message, one per event of the message that answers, and declared in the
 * manifest's `answers`, so that the core pairs it with the command sent (MegaBotTron1999's
 * bot-os.md D98).
 */
export const ANSWER_EVENT = 'norelec.answer';
const ruleNames = Object.keys(ANSWER_RULES) as [keyof typeof ANSWER_RULES];
export const answerSchema = z.object({
  /** Which answer (`ANSWER_RULES`), which the manifest's declarations match. */
  rule: z.enum(ruleNames),
  status: z.enum(['ok', 'refused']),
  /** The owner's game account, which the event is about. */
  player: z.string(),
  /** When its commands may go again, as the bot says (ms): for a reader; nothing holds them. */
  retryAt: z.number().optional(),
  /** The event of the message that answers. */
  event: z.looseObject({ kind: z.string() }),
});

/** What the plugin offers the plugins that use it (bot-os-api.md §2 `interface`). */
export interface NorelecInterface {
  state: { game(): NorelecGame };
}

/** How often the game's clock ticks: a complete bot message is read within half a second. */
export const TICK_MS = 250;

/**
 * The parser contract (@megabottron1999/core/drift.ts) for one of NorelecBot's messages: read,
 * or unread when a line of it matches no template (new wording, or a kind not modelled yet), with
 * those lines.
 */
export function reading(text: string, events: readonly GameEvent[]): Reading<GameEvent> {
  const lines = events.filter((e) => e.kind === 'unknown').map((e) => e.line);
  return lines.length === 0
    ? { kind: 'read', events: [...events] }
    : { kind: 'unread', text, lines, events: [...events] };
}

/** The parser contract over a Telegram export's row: not the bot's, or its message read. */
export function readExportRow(row: ExportMessage): Reading<GameEvent> {
  const m = exportBotMessage(row);
  return m === null ? { kind: 'not-mine' } : reading(m.text, m.events);
}

/** The parser contract over an event log's record: a bot message (`norelec.message`), read again. */
export function readLogged(r: LogEntry): Reading<GameEvent> {
  if (r.type !== MESSAGE_EVENT || typeof r['text'] !== 'string') return { kind: 'not-mine' };
  const text = stripZeroWidth(r['text']);
  return reading(text, parseMessage(text));
}

/** A bot message as the bus delivers it. */
export function botMessageOf(event: { t: number; text?: unknown; events?: unknown }): BotMessage {
  return { time: event.t, text: String(event.text), events: event.events as GameEvent[] };
}

/** The store's document of the Telegram accounts. */
export const ACCOUNTS = 'accounts';

/** An hour, in ms. */
export const HOUR = 3_600_000;

/** Its configuration: what the owner sets on its node. */
export const norelecConfig = z.object({
  /** The game's IRC channel: the edge from `irc` reads it too. Unset: Telegram alone is read. */
  channel: z
    .string()
    .regex(/^[#&]\S+$/u, 'expected an IRC channel')
    .optional()
    .describe("The game's IRC channel, where NorelecBot speaks; the edge from irc reads it"),
  /** The game bot's Telegram username: its messages in the group and the private chat. */
  bot: z
    .string()
    .regex(/^@?\w+$/u, 'expected a Telegram username')
    .default('NorelecBot')
    .describe(
      "The game bot's Telegram username, whose messages the telegram edge reads as the bot's"
    ),
  /** The game account the owner plays, whose notices are printed; the IRC account's nick without. */
  self: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The game account whose notices are printed and whose events answer the owner's commands; the IRC account's own nick if unset"
    ),
  /**
   * The relay's IRC nicks: their `<nick> text` lines are a Telegram player's (or the bot's), and
   * unwrapped. The relay took `Regno_` on 11 Nov 2026, reconnecting while `Regno` was still held.
   */
  relays: z
    .array(z.string().min(1))
    .min(1)
    .default([...RELAYS])
    .describe("The relay's IRC nicks, whose <nick> text lines carry the Telegram side"),
  /** Rest after a return, in seconds. */
  restS: z.number().int().min(0).default(90).describe('Rest after a return, in seconds'),
  /** The hours of bot messages replayed from the event log at `ready`, a restart's memory. */
  historyHours: z
    .number()
    .min(0)
    .default(6)
    .describe('Hours of bot messages replayed from the event log at a start'),
});
export type NorelecConfig = z.output<typeof norelecConfig>;

/** The bot messages among the event log's records, oldest first, as the transport hands them. */
export function messagesOf(records: readonly LogEntry[]): { time: number; text: string }[] {
  const out: { time: number; text: string }[] = [];
  for (const r of records)
    if (r.type === MESSAGE_EVENT && typeof r['text'] === 'string')
      out.push({ time: r.t, text: stripZeroWidth(r['text']) });
  return out;
}

/**
 * The plugin, built from its config alone (MegaBotTron1999's docs/bot-os-api.md §7.2): it reads the
 * channel its edge from `irc` reads, and the game's history from the event log (`ctx.events`).
 */
export const norelecPlugin: Plugin = definePlugin({
  manifest: {
    id: NORELEC,
    kinds: ['parser'],
    description: "NorelecBot's game: its messages read, and the game state they make",
    config: norelecConfig,
    inputs: {
      // It reads and never sends (MegaBotTron1999's bot-os.md D60), so a chat-in input alone.
      channel: {
        type: 'chat-in',
        network: 'irc',
        when: { config: 'channel' },
        help: "NorelecBot's channel, read into the game: the edge reads the config's channel",
        bind: { node: IRC, reads: [] },
      },
      // The game's Telegram group and the owner's private chat with the bot: the chats its edge
      // reads.
      telegram: {
        type: 'chat-in',
        network: 'telegram',
        optional: true,
        help: "The game's Telegram group and the private chat with its bot, read into the game",
      },
    },
    games: { registers: [NORELEC] },
    events: {
      [MESSAGE_EVENT]: messageSchema,
      [NOTICE_EVENT]: noticeSchema,
      [ANSWER_EVENT]: answerSchema,
      ...Object.fromEntries(KIND_EVENTS.map((k) => [`${NORELEC}.${k}`, kindSchema])),
    },
    // The bot's answers to the owner's commands on the channel (D98).
    answers: answerDeclarations(ANSWER_EVENT),
    interface: {
      state: {
        game: {
          help: 'the game: its state, and every bot message, command, notice and tick as it comes',
          output: z.custom<NorelecGame>((v) => v instanceof NorelecGame),
        },
        // The owner's: whether the channel is read, and when the bot last spoke.
        status: {
          help: "the channel's health: connected, the last line and the last bot message",
          output: z.object({ health: z.record(z.string(), z.unknown()) }),
        },
      },
    },
    // A no-op, for a layout no store holds any more: kept because the stores are at version 1, and
    // the shell refuses a store at a version above its plugin's count of migrations.
    state: { migrations: [() => {}] },
  },
  create: (ctx) => {
    const config = ctx.config as NorelecConfig;
    const irc = config.channel === undefined ? undefined : ctx.connector('channel');
    const channel = config.channel?.toLowerCase();
    const telegram = optionalConnector(ctx, 'telegram');
    if (irc === undefined && telegram === undefined)
      ctx.log.warn('no channel and no telegram edge: nothing of the game is read');
    const deps: GameDeps = {
      // Only while the plugin does not run: running, the game publishes on the bus instead.
      log: {
        write: ({ type, t: _, ...fields }) => ctx.record(`${NORELEC}.${type}`, fields),
      },
      print: (line) => ctx.log.info(line),
      now: () => ctx.clock.now(),
      restS: config.restS,
      relays: config.relays,
      bot: config.bot,
      // Read at each notice: the account's name is known once it is connected.
      get self() {
        return config.self ?? irc?.self() ?? telegram?.self() ?? '';
      },
    };
    const game = new NorelecGame(deps);
    const accounts = new TelegramAccounts({
      read: () => ctx.store.read<StoredAccounts>(ACCOUNTS),
      write: (value) => ctx.store.write(ACCOUNTS, value),
    });
    // A fresh instance learns them from the whole log, once.
    if (!accounts.kept) {
      const logged = messagesOf(ctx.events.read({ type: MESSAGE_EVENT }));
      accounts.backfill(
        logged.map(({ time, text }) => ({ time, text, events: parseMessage(text) }))
      );
      ctx.log.info(
        `${accounts.list().length} Telegram accounts in ${logged.length} logged bot messages`
      );
    }
    accounts.apply(game.state);
    accounts.sync(game.state);
    const off: (() => void)[] = [];
    /** The lines and messages heard before the history is replayed, which wait for it. */
    let waiting: (ChannelLine | TelegramMessage)[] | undefined = [];
    let ticking: ReturnType<typeof ctx.clock.setTimeout> | undefined;
    const tick = (): void => {
      ticking = ctx.clock.setTimeout(tick, TICK_MS);
      game.tick();
    };
    const offered: NorelecInterface = { state: { game: () => game } };
    return {
      interface: { state: { ...offered.state, status: () => ({ health: { ...game.health } }) } },
      start: () => {
        game.publish = (m, read) => {
          const self = deps.self;
          const playback = read.playback ? { playback: true } : {};
          if (!read.duplicate) {
            ctx.bus.publish(
              MESSAGE_EVENT,
              { text: m.text, events: m.events, source: read.source, ...playback },
              m.time
            );
            // Each event on its own, for the state, after the message.
            for (const e of m.events)
              if (KIND_EVENTS.includes(e.kind))
                ctx.bus.publish(
                  `${NORELEC}.${e.kind}`,
                  { ...e, ...(self === '' ? {} : { self }), ...playback },
                  m.time
                );
          }
          // Its answers to the owner's commands, after it: whoever hears one finds the state with
          // the message applied. A copy's too: they answer the commands sent to its chat.
          for (const event of self === '' || read.playback ? [] : m.events) {
            const a = answerOf(event, self, m.time);
            if (a === undefined) continue;
            const { status } = ANSWER_RULES[a.rule];
            // Read in the private chat, it answers none of the commands the game ignores there.
            ctx.bus.publish(
              ANSWER_EVENT,
              { ...a, status, player: self, event, ...(read.private ? { private: true } : {}) },
              m.time
            );
          }
          if (read.duplicate) return;
          // Drift (P5): a message with a line no template knows is claimed but unread.
          const r = reading(m.text, m.events);
          if (r.kind === 'unread') ctx.drift.unread({ text: r.text, lines: r.lines, t: m.time });
          else ctx.drift.read(m.time);
          accounts.sync(game.state);
        };
        game.publishNotice = (r) => ctx.bus.publish(NOTICE_EVENT, { notice: r.notice }, r.t);
        if (irc !== undefined) {
          off.push(
            irc.onMessage((m) => {
              if (m.chat.toLowerCase() !== channel) return;
              const line = {
                nick: m.senderUsername ?? '',
                text: m.text,
                time: m.time,
                playback: m.playback,
              };
              if (waiting === undefined) game.line(line);
              else waiting.push(line);
            }),
            irc.onStatus((s) => game.status(s.phase))
          );
          // The status the game first hears is the connector's at once.
          const now = irc.status();
          if (now.state !== 'closed') game.status(now.phase);
        }
        if (telegram !== undefined) {
          off.push(
            telegram.onMessage((m) => {
              const message = {
                sender: m.senderUsername ?? '',
                text: m.text,
                time: m.time,
                private: m.private === true,
                own: m.own === true,
                playback: m.playback,
              };
              if (waiting === undefined) game.telegram(message);
              else waiting.push(message);
            })
          );
          // Without IRC, the Telegram connector's status is the channel's health.
          if (irc === undefined) {
            off.push(telegram.onStatus((s) => game.status(statusOf(s.state))));
            game.status(statusOf(telegram.status().state));
          }
        }
      },
      ready: () => {
        const since = ctx.clock.now() - config.historyHours * HOUR;
        const replayed = game.replay(messagesOf(ctx.events.read({ type: MESSAGE_EVENT, since })));
        if (replayed > 0) ctx.log.info(`replayed ${replayed} bot messages`);
        const heard = waiting ?? [];
        waiting = undefined;
        for (const line of heard) {
          if ('nick' in line) game.line(line);
          else game.telegram(line);
        }
        // The first tick once every plugin is ready, so that the plugins that play have taken up their
        // modes, and a simulator its facts, before anything is decided: at once if the
        // channel is up already (a simulator's), else after a tick's wait, which gives the
        // connection time to come up, as the client always waited.
        const up = (irc ?? telegram)?.status().state === 'connected';
        ticking = ctx.clock.setTimeout(tick, up ? 0 : TICK_MS);
      },
      stop: () => {
        for (const f of off.splice(0)) f();
        ctx.clock.clearTimeout(ticking);
        game.publish = undefined;
        game.publishNotice = undefined;
      },
    };
  },
});

/** The handle on an optional chat-in input, or undefined while no edge binds it. */
function optionalConnector(
  ctx: { connector(port: string): ConnectorHandle },
  port: string
): ConnectorHandle | undefined {
  try {
    return ctx.connector(port);
  } catch {
    return undefined;
  }
}

/** A connector's state as the game's health hears IRC's steps. */
const statusOf = (state: string): string =>
  state === 'connected' ? 'joined' : state === 'closed' ? 'closed' : 'connecting';

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [norelecPlugin];
