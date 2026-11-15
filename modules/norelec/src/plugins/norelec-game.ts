/**
 * NorelecBot's game as the `norelec` plugin reads it (modules/norelec/src/plugins/norelec.ts):
 * the IRC channel's lines into the IRC parser and the Telegram group's (and private chat's) messages
 * as they are, bot messages into the game state, the state's notices logged (or published) and the
 * ones about the owner printed, and the connection's health. The lines and the connection's steps
 * are the connectors' to log and print.
 *
 * **Both networks at once.** The relay copies the group to the channel and back, so a bot message
 * read on both is the same message twice: the first copy read is the one applied and published;
 * a copy from the other network within `DUPLICATE_MS` whose text (spacing and IRC's `·`
 * separators aside) is the first's, or a part of it (a long one IRC split), is dropped, its answers
 * to the owner's commands sent to that chat alone published. It
 * sends nothing: listeners (`onMessage`), such as a player's plugin, see each bot message after the state
 * has taken it, the replay's included (`replaying` tells them apart), `onCommand` listeners each
 * player's own command as it is sent, `onNotice` listeners each notice once logged, and `onTick`
 * listeners each tick of its clock, after it. The pieces come in from outside, so that tests and
 * the arena can run it on fakes.
 */
import { type ChannelLine } from '@megabottron1999/connectors/transport/transport.ts';
import { type BotMessage } from '#src/game/bot-message.ts';
import { type GameEvent } from '#src/game/events.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { playerRef } from '#src/game/player.ts';
import { type PlayerCommand, playerCommand } from '#src/game/player-command.ts';
import { GameState, type Notice } from '#src/state/game-state.ts';
import { ircBotMessage, IrcParser } from '#src/transport/irc-parser.ts';
import { RELAYS, stripZeroWidth, unwrap } from '#src/transport/relay.ts';

/** The network a bot message was read on. */
export type Source = 'irc' | 'telegram';

/** How far apart two copies of one bot message, one per network, may be read. */
export const DUPLICATE_MS = 60_000;

/** How soon after a banned player's command the game's `COGLIONE` answers it (seen within 2 s). */
export const BAN_REPLY_MS = 5000;

/** A Telegram message, as the plugin hands it to the game. */
export interface TelegramMessage {
  /** The sender's username, without `@` (`''` without one). */
  sender: string;
  text: string;
  time: number;
  /** The private chat with the game's bot, where its replies are about the owner alone. */
  private: boolean;
  /** Sent by the owner's own account. */
  own: boolean;
  /** Said while the instance was down (the connector's catch-up): read, never acted on. */
  playback: boolean;
}

/** A bot message as the game hands it on: where it was read, and whether it is a copy. */
export interface Read {
  source: Source;
  /** The other network's copy of a message already applied: its answers alone count. */
  duplicate: boolean;
  /** History: read and applied, never acted on (MegaBotTron1999's D83). */
  playback: boolean;
}

/** A message's text for comparing copies: no spacing, no IRC separators. */
const copyKey = (text: string): string => text.replace(/[\s·]+/gu, '');

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
  /** The relay's IRC nicks, whose `<nick> text` lines are unwrapped; relay.ts `RELAYS` if unset. */
  relays?: readonly string[];
  /** The game bot's Telegram username, without `@`: `NorelecBot` if unset. */
  bot?: string;
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
  publish: ((m: BotMessage, read: Read) => void) | undefined;
  /**
   * Takes each notice in place of the log, likewise: the `norelec` plugin's, which publishes it on
   * the bus as `norelec.notice`.
   */
  publishNotice: ((r: NoticeRecord) => void) | undefined;
  private readonly deps: GameDeps;
  private replayingNow = false;
  private readonly parser: IrcParser;
  private waiters: Waiter[] = [];
  private readonly listeners: ((m: BotMessage) => void)[] = [];
  private readonly commandListeners: ((c: PlayerCommand) => void)[] = [];
  private readonly noticeListeners: ((r: NoticeRecord) => void)[] = [];
  private readonly tickListeners: (() => void)[] = [];
  /** The bot messages read lately, for telling the other network's copies (`DUPLICATE_MS`). */
  private recent: { key: string; source: Source; time: number }[] = [];
  /** The players' latest commands, for naming whom a `COGLIONE` answers. */
  private commands: PlayerCommand[] = [];

  constructor(deps: GameDeps) {
    this.deps = deps;
    this.parser = new IrcParser(400, deps.relays ?? RELAYS);
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
    for (const m of this.parser.push({ ...line, received: this.deps.now() }))
      this.message(m, 'irc');
    const { author, text } = unwrap(line.nick, line.text, this.deps.relays ?? RELAYS);
    this.command(playerCommand(line.time, author, text));
  }

  /**
   * A message of the game's Telegram group, or of the owner's private chat with its bot: the bot's,
   * read whole (Telegram keeps a message whole), its events about nobody in a private chat the
   * owner's; anyone else's, a player's command (the owner's own, the owner's account's; a player
   * is named by their username, as the bot names Telegram players). Its caption, for a message
   * with a file. An edit is not read again.
   */
  telegram(m: TelegramMessage): void {
    const bot = (this.deps.bot ?? 'NorelecBot').replace(/^@/u, '').toLowerCase();
    // The relay's copy of an IRC line (`<nick> text`): an IRC player's command, or the bot's IRC
    // line, read as the IRC side reads it (and so a copy of the bot's own Telegram message).
    const relayed = m.own ? undefined : unwrap(m.sender, m.text, this.deps.relays ?? RELAYS);
    if (relayed?.relayed === true) {
      if (m.playback) return;
      const line = ircBotMessage({ nick: relayed.author, text: relayed.text, time: m.time });
      if (line !== null) this.message(line, 'irc');
      else this.command(playerCommand(m.time, relayed.author, relayed.text));
      return;
    }
    if (!m.own && m.sender.toLowerCase() === bot) {
      if (!m.playback) this.health.lastLine = m.time;
      const text = stripZeroWidth(m.text);
      const events = parseMessage(text);
      if (m.private && this.deps.self !== '') own(events, this.deps.self);
      this.message({ time: m.time, text, events }, 'telegram', m.playback);
      return;
    }
    if (m.playback) return;
    this.health.lastLine = m.time;
    const player = m.own ? this.deps.self : m.sender;
    if (player !== '') this.command(playerCommand(m.time, player, m.text));
  }

  private command(command: PlayerCommand | null): void {
    if (command === null) return;
    this.commands = [...this.commands.slice(-19), command];
    for (const listener of this.commandListeners) listener(command);
  }

  /**
   * The clock: completes a bot message that waited for the join window (most are complete with
   * their line, in `line`), and fires due timers.
   */
  tick(): void {
    const now = this.deps.now();
    for (const m of this.parser.flush(now)) this.message(m, 'irc');
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

  private message(m: BotMessage, source: Source, playback = false): void {
    this.banned(m);
    const read: Read = { source, duplicate: this.duplicate(m, source), playback };
    if (read.duplicate) {
      this.publish?.(m, read);
      return;
    }
    if (!playback) this.health.lastBotMessage = m.time;
    // Applied before it is logged, so that whoever hears of it from the bus sees the state with
    // it; its notices are logged after it, as they always were.
    const ticked = this.state.tick(m.time);
    const applied = this.state.apply(m);
    if (this.publish === undefined)
      this.deps.log.write({ type: 'message', t: m.time, text: m.text, events: m.events });
    else this.publish(m, read);
    this.notices(ticked);
    if (playback) return;
    this.notices(applied);
    for (const w of [...this.waiters]) if (w.match(m)) w.done(m);
    for (const listener of this.listeners) listener(m);
  }

  /**
   * Whether `m` is the other network's copy of a message read lately (see the module's comment);
   * if not, it is remembered as read.
   */
  private duplicate(m: BotMessage, source: Source): boolean {
    const key = copyKey(m.text);
    this.recent = this.recent.filter((r) => Math.abs(m.time - r.time) <= DUPLICATE_MS);
    const copy = this.recent.find(
      (r) => r.source !== source && key !== '' && (r.key.includes(key) || key.includes(r.key))
    );
    if (copy !== undefined) return true;
    this.recent.push({ key, source, time: m.time });
    return false;
  }

  /** A `COGLIONE` names the player whose command it answers: the latest, just before it. */
  private banned(m: BotMessage): void {
    for (const e of m.events) {
      if (e.kind !== 'banned' || e.player !== undefined) continue;
      const by = this.commands.findLast((c) => c.time <= m.time && m.time - c.time <= BAN_REPLY_MS);
      if (by !== undefined) e.player = playerRef(by.player);
    }
  }

  private notices(notices: Notice[]): void {
    for (const n of notices) {
      const record = { type: 'notice' as const, t: n.at, notice: n };
      if (this.publishNotice === undefined) this.deps.log.write(record);
      else this.publishNotice(record);
      for (const listener of this.noticeListeners) listener(record);
      const mine = n.player === this.deps.self || n.by === this.deps.self;
      if (mine || n.kind === 'unknownLine') this.deps.print(describe(n));
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

/**
 * The events of a reply in the owner's private chat with the bot that name nobody: the owner's
 * (a `COGLIONE` there answers the owner's own command).
 */
function own(events: GameEvent[], self: string): void {
  for (const e of events)
    if ((e.kind === 'banned' || e.kind === 'ballTaken') && e.player === undefined)
      e.player = playerRef(self.replace(/^@/u, ''));
}
