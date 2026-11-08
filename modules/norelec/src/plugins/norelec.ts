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
  type MigrationStore,
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

/** Where the Telegram accounts were kept before the core, in the data volume's root. */
export const LEGACY_ACCOUNTS_FILE = 'telegram.json';
/** The store's document of the Telegram accounts. */
export const ACCOUNTS = 'accounts';

export interface NorelecOptions {
  /** The game's IRC channel, where NorelecBot speaks. */
  channel: string;
  /** What the game logs to, prints to and reads the time from, and the account the client plays. */
  game: GameDeps;
  /**
   * The bot messages of the whole log, oldest first: read once, when the store keeps no Telegram
   * accounts (a fresh instance).
   */
  logged?: () => readonly { time: number; text: string }[];
  /** The bot messages of the last hours, oldest first: replayed at `ready`, a restart's memory. */
  history?: () => readonly { time: number; text: string }[];
}

/**
 * The plugin, on the game's channel. Its running instance offers the game to the wiring as its
 * `service` too, for the app's parts not yet plugins (the health, the map, the control).
 */
export function norelecPlugin(options: NorelecOptions): Plugin {
  const { channel } = options;
  return definePlugin({
    manifest: {
      id: NORELEC,
      version: '0.1.0',
      kinds: ['parser'],
      description: "NorelecBot's game: its messages read, and the game state they make",
      inputs: {
        channel: {
          type: 'chat',
          network: 'irc',
          help: "NorelecBot's channel, read into the game",
          bind: { node: IRC, reads: [channel], sends: [channel] },
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
      state: {
        migrations: [
          (store: MigrationStore) => {
            store.adopt(LEGACY_ACCOUNTS_FILE, ACCOUNTS);
          },
        ],
      },
    },
    create: (ctx) => {
      const game = new NorelecGame(options.game);
      const accounts = new TelegramAccounts({
        read: () => ctx.store.read<StoredAccounts>(ACCOUNTS),
        write: (value) => ctx.store.write(ACCOUNTS, value),
      });
      // A fresh instance learns them from the whole log, once.
      if (!accounts.kept) {
        const logged = options.logged?.() ?? [];
        accounts.backfill(
          logged.map(({ time, text }) => ({ time, text, events: parseMessage(text) }))
        );
        ctx.log.info(
          `${accounts.list().length} Telegram accounts in ${logged.length} logged bot messages`
        );
      }
      accounts.apply(game.state);
      accounts.sync(game.state);
      const handle = ctx.connector('channel');
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
        service: game,
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
          const history = options.history?.() ?? [];
          const replayed = game.replay(history);
          if (replayed > 0)
            options.game.print(
              `${new Date(options.game.now()).toISOString().slice(11, 19)}  replayed ${replayed} bot messages`
            );
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
}
