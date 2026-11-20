/**
 * Every player's turns at @LoreGameBot, as the `loregame` parser hears them (docs/game-bots.md
 * §6.1): the owner's and the group's. Pure, but for what a plugin hands it.
 *
 * The bot replies to a player's turn command with the turn, and names nobody, so the watch
 * remembers who sent each message it heard and whether it was a turn command, and names the
 * player of a reply from the message it replies to. The owner's are theirs, in private and in the
 * group. A player is known by their username, as the connector delivers it (`sender`): one without
 * a username is delivered as `''`, and is no one here.
 *
 * Players also play where the account cannot read (their private chat with the bot): the state
 * keeps what it saw as a floor, and tells a turn it missed by the bot's "too soon" to a player it
 * thought rested (src/loregame-state.ts).
 */
import { isPrivate, isTurnCommand } from '@megabottron1999/turns/turn-parser.ts';
import { type Heard } from '#src/bans.ts';
import { LOREGAMEBOT, type Outcome, parseLoreGameBot, TURN_COMMANDS } from '#src/replies.ts';

/** How many messages are remembered per watch. */
const KEPT = 5000;

/** A message heard: who sent it, the turn command it was, if one, and its command's word. */
interface Said {
  player: string;
  owner: boolean;
  command: string | undefined;
  /** Its first word if a command (`/equipaggia`), lower case, without the bot it is addressed to. */
  word: string | undefined;
}

/** A player's turn, as the bot answered it: a turn read, or a "too soon". */
export interface PlayerTurn {
  player: string;
  owner: boolean;
  /** The turn command it answered, by first word, lower case (`/avventura`, `/lore`, `/l`). */
  command: string;
  outcome: Outcome;
  /** The player's turn command's message id in its chat: what the bot replied to. */
  message: string;
  /** The bot's answer's message id, when the connector gave one. */
  answer: string | null;
}

/** A turn command's first word, lower case, without the bot it is addressed to. */
/** A command's first word, lower case, without `@<bot>`; none if not a command, or another bot's. */
function wordOf(text: string, bot: string): string | undefined {
  const m = /^(\/\w+)(?:@(\w+))?(?:\s|$)/u.exec(text.trim());
  if (m === null || (m[2] !== undefined && m[2].toLowerCase() !== bot)) return undefined;
  return (m[1] as string).toLowerCase();
}

const commandOf = (text: string, bot: string): string | undefined =>
  isTurnCommand(text, TURN_COMMANDS[LOREGAMEBOT], bot)
    ? (text.trim().split('@')[0] as string).toLowerCase()
    : undefined;

export class PlayerWatch {
  private readonly bot: string;
  private readonly said = new Map<string, Said>();

  constructor(bot: string = LOREGAMEBOT) {
    this.bot = bot.toLowerCase();
  }

  /**
   * The turn `m` answers, if it is the bot's reply to a player's turn command that reads as a
   * turn or a "too soon" (a ban, an error, an answer to another command: none). `self`: the
   * owner's username, once the account knows it.
   */
  hear(m: Heard, self: string | undefined): PlayerTurn | undefined {
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      const owner = m.own === true || isPrivate(m);
      const player = owner ? (self ?? '') : m.sender;
      if (m.id !== undefined && (player !== '' || owner))
        this.remember(`${m.chat}\n${m.id}`, {
          player,
          owner,
          command: commandOf(m.text, this.bot),
          word: wordOf(m.text, this.bot),
        });
      return undefined;
    }
    if (m.replyTo === undefined) return undefined;
    const to = this.said.get(`${m.chat}\n${m.replyTo}`);
    if (to?.command === undefined) return undefined;
    const outcome = parseLoreGameBot(m.text);
    if (outcome.kind !== 'gain' && outcome.kind !== 'nothing') return undefined;
    const player = to.owner ? (self ?? to.player) : to.player;
    return player === ''
      ? undefined
      : {
          player,
          owner: to.owner,
          command: to.command,
          outcome,
          message: m.replyTo,
          answer: m.id ?? null,
        };
  }

  /**
   * Whose message `id` of `chat` is, if the watch heard it (or the owner's account sent it): the
   * player a bot's reply to it is about. The owner's named `self`; one without a username, none.
   */
  whose(chat: string, id: string, self: string | undefined): Omit<Said, 'command'> | undefined {
    const said = this.said.get(`${chat}\n${id}`);
    if (said === undefined) return undefined;
    if (said.owner) return { player: self ?? said.player, owner: true, word: said.word };
    return said.player === '' ? undefined : { player: said.player, owner: false, word: said.word };
  }

  /** A command the owner's account sent (`actions.sent`), which it never hears come back. */
  sent(s: { chat: string; id?: string; command?: string }, self: string | undefined): void {
    if (s.id === undefined || s.command === undefined) return;
    this.remember(`${s.chat}\n${s.id}`, {
      player: self ?? '',
      owner: true,
      command: commandOf(s.command, this.bot),
      word: wordOf(s.command, this.bot),
    });
  }

  private remember(key: string, said: Said): void {
    this.said.delete(key);
    this.said.set(key, said);
    if (this.said.size > KEPT) this.said.delete(this.said.keys().next().value as string);
  }
}
