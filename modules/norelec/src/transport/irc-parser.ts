/**
 * The live-side parser: lines of the game's channel, as an IRC client receives them, into bot messages.
 *
 * On IRC NorelecBot posts each message as one line of its own nick, its lines joined by " · " and
 * each player's name after a zero-width space (docs/bot-protocol.md §1.2; seen live on 22 Oct).
 * A long message is split over several lines (the leaderboard, a profile, an entry and its
 * quote), the parts following each other within about 120 ms, while separate messages are usually
 * 600 ms or more apart (22 Oct). So a bot line within `joinMs` of the previous one, by `server-time`,
 * continues its message; two messages that come closer are joined, and parse-message.ts reads a
 * profile joined after another message from the profile's name on. `fromIrc` then restores the Telegram form, and the same core as the export
 * side (modules/norelec/src/export/export-parser.ts) reads it, so that both stay in step. Bot
 * lines the relay carries (`<Regno> <NorelecBot_> …`, as in September) are read the same way.
 *
 * A message that cannot be the first part of a split one is complete with its line, at once
 * (`standsAlone`): short (the relay splits only past about 390 bytes, so a part under
 * `SPLIT_RISK_BYTES` is the last unless the next line would be longer than any of the game's), of
 * known lines, and of no kind that runs over several lines (a listing, the leaderboard, a profile,
 * a house, an entry before its quote). So the bot's answers to commands, single short lines, are
 * read as they arrive, not a join window later.
 *
 * Pure: each line comes with its `server-time` and the local time it was received; any other
 * message is complete when another line arrives, or when `flush(now)` finds it waited `joinMs` on
 * the local clock. The two clocks are never compared with each other.
 */
import { BOT_NAME, type BotMessage } from '#src/game/bot-message.ts';
import { type EventKind, type GameEvent } from '#src/game/events.ts';
import { parseLine } from '#src/game/parse-line.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { fromIrc, IRC_LINE_SEPARATOR, unwrap } from './relay.ts';

/** A line of the channel. */
export interface IrcLine {
  nick: string;
  text: string;
  /** Milliseconds since the epoch: the line's `server-time`, not the time it was read. */
  time: number;
}

/** A channel line as received. */
export interface ReceivedLine extends IrcLine {
  /** The local time it was received, in milliseconds. */
  received: number;
}

/**
 * The IRC line's size, in UTF-8 bytes, from which a message may be the first part of a split one:
 * the relay splits at about 390, so a shorter first part means a next line of more than about 190
 * bytes, longer than the game's own lines (an entry's quote, which can be, is waited for).
 */
export const SPLIT_RISK_BYTES = 200;

/** The kinds the bot's next IRC line may continue: they are read whole, over several lines. */
const CONTINUED = new Set<EventKind>([
  'unknown',
  'info',
  'leaderboardRow',
  'holderIs',
  'profile',
  'house',
]);

const UTF8 = new TextEncoder();

/**
 * Whether a message, so far `irc` on the channel (its parts as they came), is complete as it is:
 * see the module's comment. An entry is, once its quote (a line no template knows, after it) came.
 */
export function standsAlone(irc: string, m: BotMessage): boolean {
  if (UTF8.encode(irc).length >= SPLIT_RISK_BYTES) return false;
  if (m.events.length === 0 || m.events.some((e) => CONTINUED.has(e.kind))) return false;
  return !m.events.some((e) => e.kind === 'entered') || quoteCame(m.text, m.events);
}

/** Whether a line no template knows, the random quote, follows the entry in `text`. */
function quoteCame(text: string, events: readonly GameEvent[]): boolean {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const entry = events.find((e) => e.kind === 'entered')?.line;
  return lines
    .slice(lines.findIndex((l) => l === entry) + 1)
    .some((l) => parseLine(l).kind === 'unknown');
}

/** Joins the parts of the bot's long messages, and reads each message once complete. */
export class IrcParser {
  private readonly joinMs: number;
  private parts: string[] = [];
  private start = 0;
  private lastServer = 0;
  private lastReceived = 0;

  constructor(joinMs = 400) {
    this.joinMs = joinMs;
  }

  /** Takes one line; returns the bot messages it completes, oldest first. */
  push(line: ReceivedLine): BotMessage[] {
    const { author, text } = unwrap(line.nick, line.text);
    const bot = BOT_NAME.test(author);
    const continues = bot && this.parts.length > 0 && line.time - this.lastServer <= this.joinMs;
    const done = continues ? [] : this.close();
    if (bot) {
      if (this.parts.length === 0) this.start = line.time;
      this.parts.push(text);
      this.lastServer = line.time;
      this.lastReceived = line.received;
      // Complete with this line already: read now, not a join window later.
      const now = this.read();
      if (standsAlone(this.parts.join(IRC_LINE_SEPARATOR), now)) {
        this.parts = [];
        return [...done, now];
      }
    }
    return done;
  }

  /** The pending message, if it has waited `joinMs` since its last part (local clock). */
  flush(now: number): BotMessage[] {
    return now - this.lastReceived >= this.joinMs ? this.close() : [];
  }

  private close(): BotMessage[] {
    if (this.parts.length === 0) return [];
    const m = this.read();
    this.parts = [];
    return [m];
  }

  /** The pending message, as its parts so far read. */
  private read(): BotMessage {
    const body = fromIrc(this.parts.join(IRC_LINE_SEPARATOR));
    return { time: this.start, text: body, events: parseMessage(body) };
  }
}

/** The bot message a single channel line is, or null when it is not the bot's. */
export function ircBotMessage(line: IrcLine): BotMessage | null {
  const { author, text } = unwrap(line.nick, line.text);
  if (!BOT_NAME.test(author)) return null;
  const body = fromIrc(text);
  return { time: line.time, text: body, events: parseMessage(body) };
}
