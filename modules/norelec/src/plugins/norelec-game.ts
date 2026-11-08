/**
 * NorelecBot's game as the `norelec` plugin reads it (modules/norelec/src/plugins/norelec.ts):
 * the channel's lines into the IRC parser, bot messages into the game state, the state's notices
 * logged (or published) and the ones that matter printed, and the connection's health. The
 * channel's lines and the connection's steps are the `irc` plugin's to log and print. It
 * sends nothing: listeners (`onMessage`), such as a player's plugin, see each bot message after the state
 * has taken it, the replay's included (`replaying` tells them apart), `onCommand` listeners each
 * player's own command as it is sent, `onNotice` listeners each notice once logged, and `onTick`
 * listeners each tick of its clock, after it. The pieces come in from outside, so that tests and
 * the arena can run it on fakes.
 */
import { type ChannelLine } from '@megabottron1999/connectors/transport/transport.ts';
import { type BotMessage } from '#src/game/bot-message.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { type PlayerCommand, playerCommand } from '#src/game/player-command.ts';
import { GameState, type Notice } from '#src/state/game-state.ts';
import { IrcParser } from '#src/transport/irc-parser.ts';
import { unwrap } from '#src/transport/relay.ts';

/** A record the game writes, under the type the event log maps to `norelec.*`. */
export type GameRecord =
  | { type: 'message'; t: number; text: string; events: unknown[] }
  | { type: 'notice'; t: number; notice: Notice };

/** A notice of the game state, as logged. */
export type NoticeRecord = Extract<GameRecord, { type: 'notice' }>;

export interface GameDeps {
  log: { write(record: GameRecord): void };
  /** Where notices are printed. */
  print: (line: string) => void;
  now: () => number;
  restS: number;
  /** The account the client plays: the notices about it are printed. */
  self: string;
}

/** A wait for a bot message, from `NorelecGame.waitForMessage`. */
export interface Wait {
  /** The first matching message, or undefined after the timeout or a cancel. */
  reply: Promise<BotMessage | undefined>;
  cancel: () => void;
}

interface Waiter {
  match: (m: BotMessage) => boolean;
  done: (m: BotMessage | undefined) => void;
}

export interface Health {
  connected: boolean;
  /** Time of the last live (not played back) channel line, if any. */
  lastLine?: number;
  lastBotMessage?: number;
}

/** The game: feed it lines and clock ticks. */
export class NorelecGame {
  readonly state: GameState;
  readonly health: Health = { connected: false };
  /**
   * Takes each bot message once the state has applied it, in place of the log: the `norelec`
   * plugin's, which publishes it on the bus (and so logs it) while the plugin runs. Without it, the
   * game logs the message itself.
   */
  publish: ((m: BotMessage) => void) | undefined;
  /**
   * Takes each notice in place of the log, likewise: the `norelec` plugin's, which publishes it on
   * the bus as `norelec.notice`.
   */
  publishNotice: ((r: NoticeRecord) => void) | undefined;
  private readonly deps: GameDeps;
  private replayingNow = false;
  private readonly parser = new IrcParser();
  private waiters: Waiter[] = [];
  private readonly listeners: ((m: BotMessage) => void)[] = [];
  private readonly commandListeners: ((c: PlayerCommand) => void)[] = [];
  private readonly noticeListeners: ((r: NoticeRecord) => void)[] = [];
  private readonly tickListeners: (() => void)[] = [];

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.state = new GameState({ restS: deps.restS });
  }

  /**
   * Feeds bot messages already logged (`EventLog.messagesSince`) through the state and the
   * listeners, as a restart's memory, reading each text with today's parser. Nothing is logged,
   * printed, or waited for.
   */
  replay(messages: readonly { time: number; text: string }[]): number {
    this.replayingNow = true;
    try {
      for (const { time, text } of messages) {
        const m = { time, text, events: parseMessage(text) };
        this.state.tick(time);
        this.state.apply(m);
        for (const listener of this.listeners) listener(m);
      }
    } finally {
      this.replayingNow = false;
    }
    this.state.tick(this.deps.now());
    return messages.length;
  }

  /** Whether the listeners hear the replay of the history, old news, rather than the channel. */
  get replaying(): boolean {
    return this.replayingNow;
  }

  /** Calls `listener` with every bot message, after the state took it, in order of subscription. */
  onMessage(listener: (m: BotMessage) => void): void {
    this.listeners.push(listener);
  }

  /** Calls `listener` with every player's command, as it is sent, before the bot answers it. */
  onCommand(listener: (c: PlayerCommand) => void): void {
    this.commandListeners.push(listener);
  }

  /** Calls `listener` with every notice, once logged (not those of a replay). */
  onNotice(listener: (r: NoticeRecord) => void): void {
    this.noticeListeners.push(listener);
  }

  /** Calls `listener` after every tick of the clock: a player's plugin decides then. */
  onTick(listener: () => void): void {
    this.tickListeners.push(listener);
  }

  /** A channel line. Played-back lines are ignored (the `irc` plugin logs them all). */
  line(line: ChannelLine): void {
    if (line.playback) return;
    this.health.lastLine = line.time;
    for (const m of this.parser.push({ ...line, received: this.deps.now() })) this.message(m);
    const { author, text } = unwrap(line.nick, line.text);
    const command = playerCommand(line.time, author, text);
    if (command !== null) for (const listener of this.commandListeners) listener(command);
  }

  /** The clock: completes a bot message whose parts have all arrived, and fires due timers. */
  tick(): void {
    const now = this.deps.now();
    for (const m of this.parser.flush(now)) this.message(m);
    this.notices(this.state.tick(now));
    for (const listener of this.tickListeners) listener();
  }

  /** Waits up to `timeoutMs` for the next bot message that `match` accepts. */
  waitForMessage(match: (m: BotMessage) => boolean, timeoutMs: number): Wait {
    let waiter: Waiter | undefined;
    const reply = new Promise<BotMessage | undefined>((resolve) => {
      const timer = setTimeout(() => finish(undefined), timeoutMs);
      const finish = (m: BotMessage | undefined): void => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(m);
      };
      waiter = { match, done: finish };
      this.waiters.push(waiter);
    });
    return { reply, cancel: () => waiter?.done(undefined) };
  }

  /**
   * The connection's status, as IRC's steps name it, kept in the health (the `irc` plugin logs
   * and prints it).
   */
  status(status: string): void {
    if (status === 'joined') this.health.connected = true;
    if (status === 'closed' || status === 'connecting') this.health.connected = false;
  }

  private message(m: BotMessage): void {
    this.health.lastBotMessage = m.time;
    // Applied before it is logged, so that whoever hears of it from the bus sees the state with
    // it; its notices are logged after it, as they always were.
    const ticked = this.state.tick(m.time);
    const applied = this.state.apply(m);
    if (this.publish === undefined)
      this.deps.log.write({ type: 'message', t: m.time, text: m.text, events: m.events });
    else this.publish(m);
    this.notices(ticked);
    this.notices(applied);
    for (const w of [...this.waiters]) if (w.match(m)) w.done(m);
    for (const listener of this.listeners) listener(m);
  }

  private notices(notices: Notice[]): void {
    for (const n of notices) {
      const record = { type: 'notice' as const, t: n.at, notice: n };
      if (this.publishNotice === undefined) this.deps.log.write(record);
      else this.publishNotice(record);
      for (const listener of this.noticeListeners) listener(record);
      const mine = n.player === this.deps.self || n.by === this.deps.self;
      if (mine || n.kind === 'holderChanged' || n.kind === 'unknownLine')
        this.deps.print(describe(n));
    }
  }
}

const clock = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

/** A notice as one line of text. */
export function describe(n: Notice): string {
  const by = n.by === undefined ? '' : ` by ${n.by}`;
  const detail = n.detail === undefined ? '' : ` (${n.detail})`;
  return `${clock(n.at)}  ${n.kind} ${n.player}${by}${detail}`;
}
