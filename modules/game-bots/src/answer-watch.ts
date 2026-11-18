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
 */
import { isPrivate } from '@megabottron1999/turns/turn-parser.ts';
import { type Heard } from '#src/bans.ts';

/** How long a command waits for its answer: the bot answers within seconds [M]. */
export const ANSWER_WINDOW_MS = 10_000;

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

  constructor(spec: AnswerWatchSpec<R>) {
    this.spec = spec;
    this.bot = spec.bot.toLowerCase();
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
  }

  /**
   * The owner's commands waiting for an answer in `chat` at `time` (within the window): what the
   * parser logs the bot's messages against, there (src/plugins/loregame.ts).
   */
  ownerWaiting(chat: string, time: number): string[] {
    return this.asked
      .filter((a) => a.owner && a.chat === chat && time - a.time <= ANSWER_WINDOW_MS)
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
    this.asked = this.asked.filter((a) => m.time - a.time <= ANSWER_WINDOW_MS);
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
      return player === '' && !command.owner ? undefined : { player, owner: command.owner, reply };
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
