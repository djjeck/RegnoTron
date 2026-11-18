/**
 * @LoreGameBot's accumulo, as the `loregame` parser reads it and an actor asks about it
 * (docs/game-bots.md §5.2). Pure, but for what a plugin hands it.
 *
 * The accumulo charges by one at each `/lore` turn, and when it holds as many as it needs (20, less
 * with the Stoccaggio skill) `/accumulo` zeroes the rest before the next `/lore`. The bot tells its
 * state in two ways, and this module reads both:
 *
 * - **A turn** carries the line "🔋 /accumulo pronto!" while the accumulo is full
 *   (`parseLoreGameBot`, `src/replies.ts`: `accumulo` in the outcome).
 * - **`/accumulo`** answers with the counter ("Il tuo accumulo: 7/20") or uses it
 *   (`parseAccumulo`, below).
 *
 * The answer to `/accumulo` does not say whose it is. In private it is the owner's; in the group it
 * is a message of its own that follows the command (not a reply to it, since 7 Feb 2026 [M]),
 * so `AccumuloWatch` pairs each answer with the oldest command waiting, the way the bot answers
 * them (measured over 5,400 answers: 99.8% within 10 seconds, and the counter then follows the
 * player's own turns in 99% of the readings).
 */
import { type CommandMechanics } from '@megabottron1999/turns/readiness.ts';
import {
  isPrivate,
  type TurnOutcome,
  type TurnReading,
} from '@megabottron1999/turns/turn-parser.ts';
import { type Heard } from '#src/bans.ts';
import { LOREGAMEBOT, TURN_REST_MS } from '#src/replies.ts';

/** The commands of the accumulo, as a player types them (`/acc` is the one they use most). */
export const ACCUMULO_COMMANDS: readonly string[] = ['/accumulo', '/acc'];

/**
 * What the accumulo needs before the bot states otherwise [M]: 20 turns. The Stoccaggio skill
 * (`/abilita`) lowers it, to 19 and 17 in the exports, and every counter the bot gives states it.
 */
export const ACCUMULO_MAX = 20;

/** How long a command waits for its answer: the bot answers within seconds [M]. */
export const ANSWER_WINDOW_MS = 10_000;

/** What @LoreGameBot answers to `/accumulo`. */
export type AccumuloReply =
  /** Not yet: it holds `count` of the `max` it needs. */
  | { result: 'short'; count: number; max: number }
  /** "La lore è già pronta!": it is full but there is no rest to zero, so nothing is spent. */
  | { result: 'idle'; count: number; max: number }
  /** Used: the rest of the next `/lore` is zeroed, and the accumulo starts again from 0. */
  | { result: 'used' }
  /** "Devi essere almeno di livello 4!": the player is under the level (the gate is any command's). */
  | { result: 'locked'; level: number };

const COUNTER = String.raw`\s+Il tuo accumulo: (\d+)/(\d+)`;
const SHORT = new RegExp(String.raw`^Accumulo non ancora sufficiente!${COUNTER}$`, 'u');
const IDLE = new RegExp(String.raw`^La lore è già pronta!${COUNTER}$`, 'u');
const USED =
  /^🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! \/lore$/u;
const LOCKED = /^Devi essere almeno di livello (\d+)!$/u;

/**
 * An answer to `/accumulo`, if `raw` is one: the whole message, since a story may quote any of it
 * (these are the bot's own messages, not turns). The level gate is every command's, so it counts
 * only where the command it answers is known (`AccumuloWatch`).
 */
export function parseAccumulo(raw: string): AccumuloReply | undefined {
  const text = raw.normalize('NFC').trim();
  for (const [re, result] of [
    [SHORT, 'short'],
    [IDLE, 'idle'],
  ] as const) {
    const m = re.exec(text);
    if (m !== null && Number(m[2]) > 0) return { result, count: Number(m[1]), max: Number(m[2]) };
  }
  if (USED.test(text)) return { result: 'used' };
  const gate = LOCKED.exec(text);
  return gate === null ? undefined : { result: 'locked', level: Number(gate[1]) };
}

/** Whether `text` is the accumulo's command, bare or addressed to `bot`. */
export function isAccumuloCommand(text: string, bot: string): boolean {
  const m = /^(\/\w+)(?:@(\w+))?$/u.exec(text.trim());
  if (m === null) return false;
  if (m[2] !== undefined && m[2].toLowerCase() !== bot.toLowerCase()) return false;
  return ACCUMULO_COMMANDS.includes((m[1] as string).toLowerCase());
}

/** An accumulo command heard, waiting for its answer. */
interface Asked {
  chat: string;
  id: string | undefined;
  /** Who asked: the owner (theirs is the one `hear` keeps), or a player by username. */
  owner: boolean;
  player: string;
  time: number;
}

/** A player's answer to `/accumulo`: whose, and what the bot said. */
export interface PlayerAccumulo {
  player: string;
  owner: boolean;
  reply: AccumuloReply;
}

/**
 * The `/accumulo` answers, out of everything the parser hears. It keeps the commands that wait for
 * an answer (any player's in the group, as it hears them) and gives each answer to the command it
 * belongs to: the one it replies to, else the oldest waiting in that chat.
 */
export class AccumuloWatch {
  private readonly bot: string;
  private asked: Asked[] = [];

  constructor(bot: string) {
    this.bot = bot.toLowerCase();
  }

  /**
   * A command the owner's account sent, as the shell's player tells its parser (`actions.sent`):
   * the account never hears its own sends come back, so the watch would not know it waits.
   */
  sent(s: { chat: string; id?: string; t: number; command?: string }): void {
    if (s.command === undefined || !isAccumuloCommand(s.command, this.bot)) return;
    this.asked.push({ chat: s.chat, id: s.id, owner: true, player: '', time: s.t });
  }

  /** The owner's answer, if `m` is the bot's answer to the owner's accumulo command. */
  hear(m: Heard): AccumuloReply | undefined {
    const a = this.answer(m, undefined);
    return a?.owner === true ? a.reply : undefined;
  }

  /**
   * Any player's answer, if `m` is the bot's answer to a player's accumulo command: the owner's
   * named `self` (their username once the account knows it), a player without a username no
   * one's.
   */
  answer(m: Heard, self: string | undefined): PlayerAccumulo | undefined {
    this.asked = this.asked.filter((a) => m.time - a.time <= ANSWER_WINDOW_MS);
    const inPrivate = isPrivate(m);
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      if (isAccumuloCommand(m.text, this.bot)) {
        const owner = m.own === true || inPrivate;
        this.asked.push({
          chat: m.chat,
          id: m.id,
          owner,
          player: owner ? '' : m.sender,
          time: m.time,
        });
      }
      return undefined;
    }
    const whose = (command: Asked, reply: AccumuloReply): PlayerAccumulo | undefined => {
      const player = command.owner ? (self ?? '') : command.player;
      return player === '' && !command.owner ? undefined : { player, owner: command.owner, reply };
    };
    // A reply to a command waiting ends its wait, whatever it says (a ban, a gate).
    const to =
      m.replyTo === undefined
        ? -1
        : this.asked.findIndex((a) => a.chat === m.chat && a.id === m.replyTo);
    const reply = parseAccumulo(m.text);
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
    // No command known to be waiting: in private it is the owner's all the same (a command sent
    // before the parser started, or from elsewhere), when it says what it is; the level gate is
    // any command's. In the group it is no one's.
    return inPrivate && reply.result !== 'locked'
      ? { player: self ?? '', owner: true, reply }
      : undefined;
  }
}

/** What an actor uses of the accumulo section: whether it may use it now. */
export interface AccumuloView {
  ready: boolean;
  locked: number | null;
}

/** What an actor uses of `loregame-state`: the accumulo. */
export interface AccumuloInterface {
  state: { accumulo(): AccumuloView };
}

/** The members of the contract, as an actor's input names them. */
export const ACCUMULO_MEMBERS = ['state.accumulo'];

/**
 * Whether to send `/accumulo` now: only when the bot said the accumulo is full (a turn's line, or
 * a counter at its maximum), never because the owner's own count says so. The count is the
 * estimate the state checks the bot against (`drift`); the bot's word is the permission.
 *
 * ```ts
 * if (accumuloReady(ctx.use<AccumuloInterface>('state').state.accumulo())) await send('/accumulo');
 * ```
 */
export function accumuloReady(view: AccumuloView): boolean {
  return view.ready && view.locked === null;
}

/** The command a shell player plays, as the parser declares it (its first word). */
export const ACCUMULO = '/accumulo';

/**
 * Its mechanics, declared on the state's side (`loregame-state`'s readiness, MegaBotTron1999's
 * bot-os.md D132, D137, D141): it waits for the bot's word that it is full (`unlock`, named by the
 * parser's reading of a turn that carries the line, never matched on the text, which a story may
 * quote), and its success ends the rest of the next `/lore` (`effects`). From that effect the
 * shell's player derives its policy: played only while `/lore` rests, which is when it gains a
 * turn.
 */
export const ACCUMULO_MECHANICS: CommandMechanics = {
  unlock: {},
  effects: [{ command: '/lore', clear: true }],
};

/** How long the level gate holds `/accumulo` back: nothing tells when the owner levels up. */
export const LOCKED_RETRY_MS = 6 * 60 * 60_000;

/**
 * What the bot's answer to the owner's `/accumulo` is to the shell's parser: a use is the success
 * (the accumulo spent, and the rest of the next `/lore` ended: its mechanics' effect in the state,
 * and announced, so that the outbox's cooldown on the turn ends too, D98, D141); any other
 * answer is a "too soon" (`nothing`, `cooldown`), no success, holding `/accumulo` back as long as
 * it can say: "not yet" for the turns still needed at the bot's rest each, the level gate for
 * `LOCKED_RETRY_MS`, "already ready" (full, nothing to zero, nothing spent) not at all.
 */
export function accumuloReading(a: AccumuloReply): Exclude<TurnReading, undefined> {
  const outcome = (o: Record<string, unknown>): TurnOutcome =>
    ({ bot: LOREGAMEBOT, ...o }) as TurnOutcome;
  if (a.result === 'used')
    return {
      outcome: outcome({ kind: 'accumulo', result: 'used' }),
      effects: [{ command: '/lore', clear: true }],
    };
  const tooSoon = outcome({ kind: 'nothing', reason: 'cooldown', ...a });
  if (a.result === 'idle') return { outcome: tooSoon };
  if (a.result === 'locked') return { outcome: tooSoon, restMs: LOCKED_RETRY_MS };
  return { outcome: tooSoon, restMs: Math.max(a.max - a.count, 1) * TURN_REST_MS };
}
