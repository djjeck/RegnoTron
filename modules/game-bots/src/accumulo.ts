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
import { isPrivate } from '@megabottron1999/turns/turn-parser.ts';
import { type Heard } from '#src/bans.ts';
import { TURN_REST_MS } from '#src/replies.ts';

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
  /** The owner's: its answer is the one to keep. */
  owner: boolean;
  time: number;
}

/**
 * The owner's `/accumulo` answers, out of everything the parser hears. It keeps the commands that
 * wait for an answer (any player's in the group, as it hears them) and gives each answer to the
 * command it belongs to: the one it replies to, else the oldest waiting in that chat.
 */
export class AccumuloWatch {
  private readonly bot: string;
  private asked: Asked[] = [];

  constructor(bot: string) {
    this.bot = bot.toLowerCase();
  }

  /** The owner's answer, if `m` is the bot's answer to the owner's accumulo command. */
  hear(m: Heard): AccumuloReply | undefined {
    this.asked = this.asked.filter((a) => m.time - a.time <= ANSWER_WINDOW_MS);
    const inPrivate = isPrivate(m);
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      if (isAccumuloCommand(m.text, this.bot))
        this.asked.push({
          chat: m.chat,
          id: m.id,
          owner: m.own === true || inPrivate,
          time: m.time,
        });
      return undefined;
    }
    // A reply to a command waiting ends its wait, whatever it says (a ban, a gate).
    const to =
      m.replyTo === undefined
        ? -1
        : this.asked.findIndex((a) => a.chat === m.chat && a.id === m.replyTo);
    const reply = parseAccumulo(m.text);
    if (to >= 0) {
      const [command] = this.asked.splice(to, 1) as [Asked];
      return reply !== undefined && command.owner ? reply : undefined;
    }
    if (reply === undefined) return undefined;
    if (m.replyTo === undefined) {
      // A message of its own: the oldest command waiting in that chat is the one it answers.
      const next = this.asked.findIndex((a) => a.chat === m.chat);
      if (next >= 0) {
        const [command] = this.asked.splice(next, 1) as [Asked];
        return command.owner ? reply : undefined;
      }
    }
    // No command known to be waiting: in private it is the owner's all the same (a command sent
    // before the parser started, or from elsewhere), when it says what it is; the level gate is
    // any command's. In the group it is no one's.
    return inPrivate && reply.result !== 'locked' ? reply : undefined;
  }
}

/** What an actor uses of the accumulo section: whether it may use it now. */
export interface AccumuloView {
  ready: boolean;
  locked: number | null;
  count: number;
  exact: boolean;
  max: number | null;
  as_of: string | null;
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
export function accumuloReady(view: Pick<AccumuloView, 'ready' | 'locked'>): boolean {
  return view.ready && view.locked === null;
}

/** How soon a turn-actor asks again while the accumulo cannot go: the bot's pace is minutes. */
export const POLL_MS = 4 * 60_000;
/** How long it waits behind a level or a ban with no end: a lock only lifts when the bot says so. */
export const WAIT_MS = 60 * 60_000;
/**
 * The longest it sleeps for a count that says the accumulo is far from full: a count that missed
 * turns would be late for the bot's own word, so it looks again at least this often.
 */
export const LOOK_AGAIN_MS = 30 * 60_000;

/** Until when a turn-actor holds `/accumulo` back, and why. */
export interface AccumuloRest {
  until: number;
  why: string;
}

/**
 * Whether `/accumulo` may go at `now`, in the terms of a turn-actor's parser (`state.rest`: until
 * when to wait, none to go): the shell's actor plays any command, and asks this before it sends.
 *
 * - **Banned**: until the ban ends (an hour at a time if it states no end), since the bot answers
 *   every command of a banned player with the ban.
 * - **Under the level**: an hour at a time. Nothing lifts it but the bot's own word (a counter, or
 *   a turn that levels up), so an owner who has levelled up elsewhere answers `/accumulo` once by
 *   hand.
 * - **Not full** (the bot's word, not our count): a few minutes at a time; longer when the count is
 *   exact and cannot be full yet, the bot resting 15 minutes between turns, but never beyond
 *   `LOOK_AGAIN_MS`.
 * - **Full, but no rest to zero**: `/accumulo` would be answered "La lore è già pronta!" and spend
 *   nothing, so it waits for the next `/lore` to rest. `loreRests`: the parser says the bot rests.
 */
export function accumuloRest(
  view: AccumuloView,
  at: { now: number; banUntil: number | undefined; loreRests: boolean }
): AccumuloRest | undefined {
  const { now } = at;
  if (at.banUntil !== undefined)
    return {
      until: Number.isFinite(at.banUntil) ? at.banUntil : now + WAIT_MS,
      why: 'the owner is banned',
    };
  if (view.locked !== null)
    return { until: now + WAIT_MS, why: `the accumulo needs level ${view.locked}` };
  if (!view.ready) {
    // The turns it still needs, each at least a rest after the last one the state heard.
    const left = Math.max((view.max ?? ACCUMULO_MAX) - view.count, 1);
    const earliest =
      view.exact && view.as_of !== null ? Date.parse(view.as_of) + left * TURN_REST_MS : 0;
    return {
      until: Math.max(now + POLL_MS, Math.min(earliest, now + LOOK_AGAIN_MS)),
      why: 'the accumulo is not full',
    };
  }
  return at.loreRests
    ? undefined
    : { until: now + POLL_MS, why: 'the next /lore is not resting: nothing to zero' };
}
