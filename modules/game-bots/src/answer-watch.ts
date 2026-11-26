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
 *
 * The account may hear the owner's own command in the group after the bot's answer to it, in the
 * same second (#16): a bot message that found no command (an answer of its own, or a reply to a
 * command not heard) is held a moment (`HOLD_MS`, `HOLD_MESSAGES`), and a command heard then pairs
 * with it as if it had come first; its pairing is given by `takeLate`, with the answer's message.
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

/**
 * How long, on the messages' times, a bot message that found no command is held for one heard late
 * (#16): the account heard the owner's own command after its answer by 4 to 62 ms [M].
 */
export const HOLD_MS = 2_000;

/** How many more messages of its chat a held message waits, at most. */
export const HOLD_MESSAGES = 5;

/** How many held messages a watch keeps, the oldest given up first. */
const KEPT_HELD = 50;

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
  /**
   * Whether an answer that found no command waiting, in a group, is held for one heard late (#16):
   * by default, yes. Not for an answer that is news to everyone as it comes (a market's update).
   */
  hold?: boolean;
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

/** An answer paired late: with a command heard after it (#16). */
export interface LateAnswer<R> {
  /** The bot's message that answered: its chat, id and time are the answer's. */
  message: Heard;
  answer: PlayerAnswer<R>;
}

/** A bot message held for a command heard late: what it said (none: a refusal, a reply). */
interface Held<R> {
  m: Heard;
  reply: R | undefined;
  /** How many messages of its chat were heard since. */
  after: number;
}

/**
 * Whether the command `a` came before the bot's message `m`, in its chat: by their ids, which grow
 * per chat on Telegram, or by their times where either has none.
 */
function before(a: { id: string | undefined; time: number }, m: Heard): boolean {
  const digits = /^\d+$/u;
  if (a.id !== undefined && m.id !== undefined && digits.test(a.id) && digits.test(m.id))
    return BigInt(a.id) < BigInt(m.id);
  return a.time <= m.time;
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
  private held: Held<R>[] = [];
  private late: LateAnswer<R>[] = [];
  /** The owner's username, as last told (`answer`): a late pairing names them so. */
  protected self: string | undefined;
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
    if (this.claim(a)) return;
    this.asked.push(a);
    if (this.asked.length > KEPT_ASKED) this.asked.shift();
  }

  /**
   * A command heard after the bot's message that answered it (#16): the reply to it, or an answer
   * of its own whose message came after it. Paired, it waits no more (a refusal ends it too).
   */
  private claim(a: Asked): boolean {
    const i = this.held.findIndex(
      (h) =>
        h.m.chat === a.chat &&
        (h.m.replyTo === undefined ? h.reply !== undefined && before(a, h.m) : h.m.replyTo === a.id)
    );
    if (i < 0) return false;
    const [h] = this.held.splice(i, 1) as [Held<R>];
    const answer = h.reply === undefined ? undefined : this.whose(a, h.reply, h.m.time);
    if (answer !== undefined) this.late.push({ message: h.m, answer });
    return true;
  }

  /** The answers paired late since last asked, each with the bot's message it was (#16). */
  takeLate(): LateAnswer<R>[] {
    const late = this.late;
    this.late = [];
    return late;
  }

  /** The answer `reply` to `command`, said at `time`: whose, if a player's or the owner's. */
  private whose(command: Asked, reply: R, time: number): PlayerAnswer<R> | undefined {
    const player = command.owner ? (this.self ?? '') : command.player;
    if (player === '' && !command.owner) return undefined;
    const late = time - command.time > REPLAY_MS ? { replayed: true as const } : {};
    return { player, owner: command.owner, reply, asked: command.time, ...late };
  }

  /** Holds the bot's message `m`, which found no command, for one heard late (#16). */
  private hold(m: Heard, reply: R | undefined): void {
    if (this.spec.hold === false || isPrivate(m)) return;
    this.held.push({ m, reply, after: 0 });
    if (this.held.length > KEPT_HELD) this.held.shift();
  }

  /** Ages the held messages of `m`'s chat by `m`, and gives up those past their bounds. */
  private age(m: Heard): void {
    this.held = this.held.filter((h) => {
      if (h.m.chat !== m.chat) return true;
      h.after += 1;
      return h.after <= HOLD_MESSAGES && m.time - h.m.time <= HOLD_MS;
    });
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
    this.self = self;
    this.clock.hear(m);
    this.asked = this.asked.filter((a) => !this.past(a));
    this.age(m);
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
    const whose = (command: Asked, reply: R): PlayerAnswer<R> | undefined =>
      this.whose(command, reply, m.time);
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
    // A reply to a command not heard yet: held, in case it is heard late (#16).
    if (m.replyTo !== undefined) this.hold(m, reply);
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
    // it is. In the group it is no one's, unless its command is heard in a moment (#16).
    if (inPrivate)
      return (this.spec.ownerless?.(reply) ?? true)
        ? { player: self ?? '', owner: true, reply }
        : undefined;
    if (m.replyTo === undefined) this.hold(m, reply);
    return undefined;
  }
}
