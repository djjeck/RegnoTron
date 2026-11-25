/**
 * The bot's answers to one of its commands, out of everything the `loregame` parser hears, for a
 * command the bot answers in the group with a message of its own rather than a reply (docs/game-bots.md
 * §5.2, §5.3: `/accumulo`, a training's success). Pure, but for what a plugin hands it.
 *
 * The shell's parser pairs an answer with a send when it replies to it, or, in private, when it is
 * the first after it; in the group it cannot pair a message of the bot's own. The bot answers its
 * commands in order, within seconds [M], so a watch keeps the commands waiting for an answer (any
 * player's in the group, as it hears them, and the owner's, as the player tells the parser) and
 * gives each answer to the command it belongs to: the one it replies to, else the oldest waiting in
 * that chat. It therefore needs the group's chat edge to deliver every sender.
 *
 * The wait is counted on the bot's clock (`BotClock`), not the time's: the bot goes down for minutes
 * to days, then answers everything it missed, in order, the replies to the commands they answer
 * (docs/game-bots.md §5.15). A command waits while the bot is silent, and is given up only once the
 * bot has answered past it.
 */
import { isPrivate } from '@megabottron1999/turns/turn-parser.ts';
import { type Heard } from '#src/bans.ts';

/** How long a command waits for its answer, on the bot's clock: it answers within seconds [M]. */
export const ANSWER_WINDOW_MS = 10_000;

/**
 * An answer later than this after its command was held back: replayed after an outage, or a
 * stall. 98% of answers come within 2 s [M] (docs/game-bots.md §5.15).
 */
export const REPLAY_MS = 60_000;

/** How many commands a watch keeps waiting, the oldest given up first: the bot may stay down days. */
export const KEPT_ASKED = 1000;

/** How many of the others' messages a clock remembers the time of, to read the bot's replies. */
const KEPT_HEARD = 5000;

/**
 * How far the bot has answered in each chat, from what it says: its clock. A reply tells it
 * exactly, the time of the message it replies to; a message of its own, now, while the bot is live
 * (its clock current at its last word, a moment before), and nothing otherwise: while it replays
 * (its last reply came more than `REPLAY_MS` after its message), or after a silence (more than
 * `REPLAY_MS` since its last word there, or its first heard), until a reply tells. Silent, the clock
 * stops. Pure, but for what a plugin hands it.
 */
export class BotClock {
  private readonly bot: string;
  private readonly heard = new Map<string, number>();
  private readonly chats = new Map<string, { clock: number; last: number; replaying: boolean }>();

  constructor(bot: string) {
    this.bot = bot.toLowerCase();
  }

  /** A message heard, anyone's: the others' remembered, the bot's read. */
  hear(m: Heard): void {
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      this.said(m.chat, m.id, m.time);
      return;
    }
    const c = this.chats.get(m.chat);
    const to = m.replyTo === undefined ? undefined : this.heard.get(`${m.chat}\n${m.replyTo}`);
    if (to !== undefined) {
      const replaying = m.time - to > REPLAY_MS;
      const clock = Math.max(c?.clock ?? -Infinity, replaying ? to : m.time);
      this.chats.set(m.chat, { clock, last: m.time, replaying });
      return;
    }
    if (c === undefined) {
      // Its first word heard here, as after a silence: it may be a replay.
      this.chats.set(m.chat, { clock: -Infinity, last: m.time, replaying: false });
      return;
    }
    // Live: its clock was current at its last word, and that was a moment ago.
    const live = !c.replaying && m.time - c.last <= REPLAY_MS && c.last - c.clock <= REPLAY_MS;
    this.chats.set(m.chat, {
      clock: live ? Math.max(c.clock, m.time) : c.clock,
      last: m.time,
      replaying: c.replaying,
    });
  }

  /** A message the owner's account sent (`actions.sent`), which it never hears come back. */
  said(chat: string, id: string | undefined, time: number): void {
    if (id === undefined) return;
    const key = `${chat}\n${id}`;
    this.heard.delete(key);
    this.heard.set(key, time);
    if (this.heard.size > KEPT_HEARD) this.heard.delete(this.heard.keys().next().value as string);
  }

  /** How long the bot has answered past `time` in `chat`: negative or `-Infinity` if not yet. */
  past(chat: string, time: number): number {
    return (this.chats.get(chat)?.clock ?? -Infinity) - time;
  }

  /** Whether the bot is replaying in `chat`: its last reply came long after its message. */
  replaying(chat: string): boolean {
    return this.chats.get(chat)?.replaying ?? false;
  }
}

/** What a watch is told of its command. */
export interface AnswerWatchSpec<R> {
  /** The bot, by username. */
  bot: string;
  /** The command's names, as a player types them (bare, or addressed to the bot). */
  commands: readonly string[];
  /** The answer `text` is, if it is one: the whole message. */
  parse(text: string): R | undefined;
  /** The command takes arguments (`/dai bob sasso`): it is its first word. */
  args?: boolean;
  /**
   * Whether an answer in private, with no command known to be waiting (sent before the parser
   * started, or from elsewhere), is the owner's all the same: by default, yes. An answer the bot
   * gives other commands too (a level gate) is not.
   */
  ownerless?(reply: R): boolean;
}

/** A command heard, waiting for its answer. */
interface Asked {
  chat: string;
  id: string | undefined;
  /** Who asked: the owner, or a player by username. */
  owner: boolean;
  player: string;
  time: number;
}

/** A player's answer: whose, and what the bot said. */
export interface PlayerAnswer<R> {
  /** The player by username; the owner's, `self` (`''` until the account knows it). */
  player: string;
  owner: boolean;
  reply: R;
  /** When its command was sent (ms), if a command was known to wait. */
  asked?: number;
  /** It came more than `REPLAY_MS` after its command: replayed after an outage, or a stall. */
  replayed?: true;
}

/**
 * Whether `text` is one of `commands`, bare or addressed to `bot`: alone, or with its arguments
 * after it when `args` (a gift names its receiver and its item).
 */
export function isCommandOf(
  text: string,
  commands: readonly string[],
  bot: string,
  args = false
): boolean {
  const m = (args ? /^(\/\w+)(?:@(\w+))?(?:\s|$)/u : /^(\/\w+)(?:@(\w+))?$/u).exec(text.trim());
  if (m === null) return false;
  if (m[2] !== undefined && m[2].toLowerCase() !== bot.toLowerCase()) return false;
  return commands.includes((m[1] as string).toLowerCase());
}

export class AnswerWatch<R> {
  private readonly bot: string;
  private readonly spec: AnswerWatchSpec<R>;
  private asked: Asked[] = [];
  private readonly clock: BotClock;

  constructor(spec: AnswerWatchSpec<R>) {
    this.spec = spec;
    this.bot = spec.bot.toLowerCase();
    this.clock = new BotClock(spec.bot);
  }

  /** Whether the bot has answered past `a`'s window, on its clock: it will not answer it now. */
  private past(a: Asked): boolean {
    return this.clock.past(a.chat, a.time) > ANSWER_WINDOW_MS;
  }

  /** Whether `text` is the watch's command, bare or addressed to its bot. */
  isCommand(text: string): boolean {
    return isCommandOf(text, this.spec.commands, this.bot, this.spec.args === true);
  }

  /**
   * A command the owner's account sent, as the shell's player tells its parser (`actions.sent`):
   * the account never hears its own sends come back, so the watch would not know it waits.
   */
  sent(s: { chat: string; id?: string; t: number; command?: string }): void {
    this.clock.said(s.chat, s.id, s.t);
    if (s.command === undefined || !this.isCommand(s.command)) return;
    this.wait({ chat: s.chat, id: s.id, owner: true, player: '', time: s.t });
  }

  /**
   * A command waiting for its answer, once: the same send told again (each player of the account
   * tells its state of another's, D140; the account may hear its own back) is not a second command.
   */
  private wait(a: Asked): void {
    if (a.id !== undefined && this.asked.some((x) => x.chat === a.chat && x.id === a.id)) return;
    this.asked.push(a);
    if (this.asked.length > KEPT_ASKED) this.asked.shift();
  }

  /**
   * The owner's commands waiting for an answer in `chat` (within the window, on the bot's clock):
   * what the parser logs the bot's messages against, there (src/plugins/loregame.ts).
   */
  ownerWaiting(chat: string): string[] {
    return this.asked
      .filter((a) => a.owner && a.chat === chat && !this.past(a))
      .map((a) => `#${a.id ?? '?'}`);
  }

  /** The owner's answer, if `m` is the bot's answer to the owner's command. */
  hear(m: Heard): R | undefined {
    const a = this.answer(m, undefined);
    return a?.owner === true ? a.reply : undefined;
  }

  /**
   * Any player's answer, if `m` is the bot's answer to a player's command: the owner's named
   * `self` (their username once the account knows it), a player without a username no one's.
   */
  answer(m: Heard, self: string | undefined): PlayerAnswer<R> | undefined {
    this.clock.hear(m);
    this.asked = this.asked.filter((a) => !this.past(a));
    const inPrivate = isPrivate(m);
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      if (this.isCommand(m.text)) {
        const owner = m.own === true || inPrivate;
        this.wait({
          chat: m.chat,
          id: m.id,
          owner,
          player: owner ? '' : m.sender,
          time: m.time,
        });
      }
      return undefined;
    }
    const whose = (command: Asked, reply: R): PlayerAnswer<R> | undefined => {
      const player = command.owner ? (self ?? '') : command.player;
      if (player === '' && !command.owner) return undefined;
      const late = m.time - command.time > REPLAY_MS ? { replayed: true as const } : {};
      return { player, owner: command.owner, reply, asked: command.time, ...late };
    };
    // A reply to a command waiting ends its wait, whatever it says (a ban, a gate).
    const to =
      m.replyTo === undefined
        ? -1
        : this.asked.findIndex((a) => a.chat === m.chat && a.id === m.replyTo);
    const reply = this.spec.parse(m.text);
    if (to >= 0) {
      const [command] = this.asked.splice(to, 1) as [Asked];
      return reply === undefined ? undefined : whose(command, reply);
    }
    if (reply === undefined) return undefined;
    if (m.replyTo === undefined) {
      // A message of its own: the oldest command waiting in that chat is the one it answers.
      const next = this.asked.findIndex((a) => a.chat === m.chat);
      if (next >= 0) {
        const [command] = this.asked.splice(next, 1) as [Asked];
        return whose(command, reply);
      }
    }
    // No command known to be waiting: in private it is the owner's all the same, when it says what
    // it is. In the group it is no one's.
    return inPrivate && (this.spec.ownerless?.(reply) ?? true)
      ? { player: self ?? '', owner: true, reply }
      : undefined;
  }
}
