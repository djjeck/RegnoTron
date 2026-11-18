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
 * so `AccumuloWatch` (`src/answer-watch.ts`) pairs each answer with the oldest command waiting, the
 * way the bot answers them (measured over 5,400 answers: 99.8% within 10 seconds, and the counter then follows the
 * player's own turns in 99% of the readings).
 */
import { type CommandMechanics } from '@megabottron1999/turns/readiness.ts';
import { type TurnOutcome, type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import { AnswerWatch, isCommandOf, type PlayerAnswer } from '#src/answer-watch.ts';
import { LOREGAMEBOT, TURN_REST_MS } from '#src/replies.ts';

/** The commands of the accumulo, as a player types them (`/acc` is the one they use most). */
export const ACCUMULO_COMMANDS: readonly string[] = ['/accumulo', '/acc'];

/**
 * What the accumulo needs before the bot states otherwise [M]: 20 turns. The Stoccaggio skill
 * (`/abilita`) lowers it, to 19 and 17 in the exports, and every counter the bot gives states it.
 */
export const ACCUMULO_MAX = 20;

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
  return isCommandOf(text, ACCUMULO_COMMANDS, bot);
}

/** A player's answer to `/accumulo`: whose, and what the bot said. */
export type PlayerAccumulo = PlayerAnswer<AccumuloReply>;

/**
 * The `/accumulo` answers, out of everything the parser hears (`src/answer-watch.ts`). The level
 * gate is every command's, so in private it counts only as the answer to a command waiting.
 */
export class AccumuloWatch extends AnswerWatch<AccumuloReply> {
  constructor(bot: string) {
    super({
      bot,
      commands: ACCUMULO_COMMANDS,
      parse: parseAccumulo,
      ownerless: (reply) => reply.result !== 'locked',
    });
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
 * (the accumulo spent, and the rest of the next `/lore` ended: its mechanics' effect, in the state
 * alone, D141, D142); any other
 * answer is a "too soon" (`nothing`, `cooldown`), no success, holding `/accumulo` back as long as
 * it can say: "not yet" for the turns still needed at the bot's rest each, the level gate for
 * `LOCKED_RETRY_MS`, "already ready" (full, nothing to zero, nothing spent) not at all.
 */
export function accumuloReading(a: AccumuloReply): Exclude<TurnReading, undefined> {
  const outcome = (o: Record<string, unknown>): TurnOutcome =>
    ({ bot: LOREGAMEBOT, ...o }) as TurnOutcome;
  if (a.result === 'used') return { outcome: outcome({ kind: 'accumulo', result: 'used' }) };
  const tooSoon = outcome({ kind: 'nothing', reason: 'cooldown', ...a });
  if (a.result === 'idle') return { outcome: tooSoon };
  if (a.result === 'locked') return { outcome: tooSoon, restMs: LOCKED_RETRY_MS };
  return { outcome: tooSoon, restMs: Math.max(a.max - a.count, 1) * TURN_REST_MS };
}
