/**
 * NorelecBot's game as a plugin (MegaBotTron1999's docs/bot-os-api.md §5): the plugin `norelec`, a parser. It holds
 * the game (modules/norelec/src/plugins/norelec-game.ts: the IRC parser and the game state) and
 * reads the game's channel into it through its handle on `irc`; it publishes each bot message on
 * the bus as `norelec.message` once the state has applied it, which writes the message to the event
 * log too, and reports each as read or unread (drift, P5). It keeps the players known to be
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
  type BusEvent,
  definePlugin,
  type LogEntry,
  type Plugin,
  type Reading,
} from '@megabottron1999/core';
import { z } from 'zod';
import { exportBotMessage, type ExportMessage } from '#src/export/export-parser.ts';
import { type BotMessage } from '#src/game/bot-message.ts';
import { type GameEvent } from '#src/game/events.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { stripZeroWidth } from '#src/transport/relay.ts';
import { type StoredAccounts, TelegramAccounts } from './norelec-accounts.ts';
import { type GameDeps, NorelecGame, type NoticeRecord } from './norelec-game.ts';

export const NORELEC = 'norelec';

/** A bot message on the bus: its text and its events (its time is the event's). */
export const MESSAGE_EVENT = 'norelec.message';
export const messageSchema = z.object({
  text: z.string(),
  events: z.array(z.looseObject({ kind: z.string() })),
});

/** A notice of the game state on the bus (modules/norelec/src/state/game-state.ts `Notice`). */
export const NOTICE_EVENT = 'norelec.notice';
export const noticeSchema = z.object({
  notice: z.looseObject({ kind: z.string(), player: z.string(), at: z.number() }),
});

/** A notice as the bus delivers it, in the form the game logged it. */
export function noticeOf(event: BusEvent): NoticeRecord {
  return { type: 'notice', t: event.t, notice: event['notice'] as NoticeRecord['notice'] };
}

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
  /** The game's IRC channel: the edge from `irc` reads it too. */
  channel: z
    .string()
    .regex(/^[#&]\S+$/u, 'expected an IRC channel')
    .describe("The game's IRC channel, where NorelecBot speaks; the edge from irc reads it"),
  /** The game account the owner plays, whose notices are printed; the IRC account's nick without. */
  self: z
    .string()
    .min(1)
    .optional()
    .describe("The game account whose notices are printed; the IRC account's own nick if unset"),
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
    version: '0.1.0',
    kinds: ['parser'],
    description: "NorelecBot's game: its messages read, and the game state they make",
    config: norelecConfig,
    inputs: {
      // It reads and never sends (MegaBotTron1999's bot-os.md D60), so a chat-in input alone.
      channel: {
        type: 'chat-in',
        network: 'irc',
        help: "NorelecBot's channel, read into the game: the edge reads the config's channel",
        bind: { node: IRC, reads: [] },
      },
    },
    games: { registers: [NORELEC] },
    events: { [MESSAGE_EVENT]: messageSchema, [NOTICE_EVENT]: noticeSchema },
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
    const handle = ctx.connector('channel');
    const channel = config.channel.toLowerCase();
    const deps: GameDeps = {
      // Only while the plugin does not run: running, the game publishes on the bus instead.
      log: {
        write: ({ type, t: _, ...fields }) => ctx.record(`${NORELEC}.${type}`, fields),
      },
      print: (line) => ctx.log.info(line),
      now: () => ctx.clock.now(),
      restS: config.restS,
      // Read at each notice: the IRC account's nick is known once it is connected.
      get self() {
        return config.self ?? handle.self() ?? '';
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
    /** The channel's lines heard before the history is replayed, which wait for it. */
    let waiting: ChannelLine[] | undefined = [];
    let ticking: ReturnType<typeof ctx.clock.setTimeout> | undefined;
    const tick = (): void => {
      ticking = ctx.clock.setTimeout(tick, TICK_MS);
      game.tick();
    };
    const offered: NorelecInterface = { state: { game: () => game } };
    return {
      interface: { state: { ...offered.state, status: () => ({ health: { ...game.health } }) } },
      start: () => {
        game.publish = (m) => {
          ctx.bus.publish(MESSAGE_EVENT, { text: m.text, events: m.events }, m.time);
          // Drift (P5): a message with a line no template knows is claimed but unread.
          const r = reading(m.text, m.events);
          if (r.kind === 'unread') ctx.drift.unread({ text: r.text, lines: r.lines, t: m.time });
          else ctx.drift.read(m.time);
          accounts.sync(game.state);
        };
        game.publishNotice = (r) => ctx.bus.publish(NOTICE_EVENT, { notice: r.notice }, r.t);
        off.push(
          handle.onMessage((m) => {
            if (m.chat.toLowerCase() !== channel) return;
            const line = { nick: m.sender, text: m.text, time: m.time, playback: m.playback };
            if (waiting === undefined) game.line(line);
            else waiting.push(line);
          }),
          handle.onStatus((s) => game.status(s.phase))
        );
        // The status the game first hears is the connector's at once.
        const now = handle.status();
        if (now.state !== 'closed') game.status(now.phase);
      },
      ready: () => {
        const since = ctx.clock.now() - config.historyHours * HOUR;
        const replayed = game.replay(messagesOf(ctx.events.read({ type: MESSAGE_EVENT, since })));
        if (replayed > 0) ctx.log.info(`replayed ${replayed} bot messages`);
        const heard = waiting ?? [];
        waiting = undefined;
        for (const line of heard) game.line(line);
        // The first tick once every plugin is ready, so that the plugins that play have taken up their
        // modes, and a simulator its facts, before anything is decided: at once if the
        // channel is up already (a simulator's), else after a tick's wait, which gives the
        // connection time to come up, as the client always waited.
        ticking = ctx.clock.setTimeout(tick, handle.status().state === 'connected' ? 0 : TICK_MS);
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

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [norelecPlugin];
