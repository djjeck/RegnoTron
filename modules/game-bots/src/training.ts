/**
 * @LoreGameBot's training, `/allenati` (docs/game-bots.md §5.3), as the `loregame` parser reads it.
 * Pure, but for what a plugin hands it.
 *
 * A training succeeds once a day: 24 hours after the last success [M], the bot answering any
 * `/allenati` before then with the wait left, to the second. It answers in two ways:
 *
 * - **The success** is a message of its own, in private and in the group alike, not a reply to the
 *   command: "🏋🏼 Ti sei allenato[ nella palestra di <faction>]! Hai imparato qualcosa di
 *   nuovo... (+N)", then, at times, "💪🏻 +N extra" and a level-up. So in the group the shell's
 *   parser cannot pair it, and `TrainingWatch` (`src/answer-watch.ts`) does.
 * - **"Too soon"** replies to the command: "Non è passato abbastanza tempo dal tuo ultimo
 *   allenamento! Riprova fra …" (not the turn's "Non è passato abbastanza tempo!").
 */
import { type CommandMechanics } from '@megabottron1999/turns/readiness.ts';
import { type TurnOutcome, type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import { AnswerWatch, type PlayerAnswer } from '#src/answer-watch.ts';
import { LOREGAMEBOT, type LoreLevelUp, retryOf, splitLevelUp } from '#src/replies.ts';

/** The training's command, as the parser declares it. */
export const TRAINING = '/allenati';
/** Its names, as a player types them. */
export const TRAINING_COMMANDS: readonly string[] = [TRAINING];

/** How long after a success the next one may come [M]: a day, to the second. */
export const TRAINING_COOLDOWN_MIN = 24 * 60;

/**
 * Its mechanics, declared on the state's side (`loregame-state`'s readiness, MegaBotTron1999's
 * bot-os.md D132, D141): a cooldown of a day after each success. A "too soon" holds it for the
 * wait the bot states.
 */
export const TRAINING_MECHANICS: CommandMechanics = { cooldownMin: TRAINING_COOLDOWN_MIN };

/** What @LoreGameBot answers to `/allenati`. */
export type TrainingReply =
  /**
   * Trained: what it `learned` (the "+N"), the `extra` a bonus adds ("💪🏻 +N extra"; 0 without),
   * the gym it trained in (its faction's, none without one), and the level-up it brought.
   */
  | {
      result: 'trained';
      gym: string | null;
      learned: number;
      extra: number;
      levelUp?: LoreLevelUp;
    }
  /** Not yet: the wait left, as the bot states it, in ms. */
  | { result: 'soon'; retryMs: number };

const TRAINED =
  /^🏋🏼 Ti sei allenato(?: nella palestra di (.+?))?! Hai imparato qualcosa di nuovo\.\.\. \(\+(\d+)\)(?:\n+💪🏻 \+(\d+) extra)?$/u;
const SOON = /^Non è passato abbastanza tempo dal tuo ultimo allenamento! Riprova fra /u;

/** An answer to `/allenati`, if `raw` is one: the whole message (a level-up may end it). */
export function parseTraining(raw: string): TrainingReply | undefined {
  const whole = raw.normalize('NFC').trim();
  if (SOON.test(whole)) {
    const retryMs = retryOf(whole);
    return retryMs === undefined ? undefined : { result: 'soon', retryMs };
  }
  const { text, levelUp } = splitLevelUp(whole);
  const m = TRAINED.exec(text);
  if (m === null) return undefined;
  return {
    result: 'trained',
    gym: m[1] ?? null,
    learned: Number(m[2]),
    extra: m[3] === undefined ? 0 : Number(m[3]),
    ...(levelUp === undefined ? {} : { levelUp }),
  };
}

/**
 * What the bot's answer to the owner's `/allenati` is to the shell's parser: a training is the
 * success (its cooldown, the state's mechanics); "too soon" holds it for the wait it states.
 */
export function trainingReading(t: TrainingReply): Exclude<TurnReading, undefined> {
  if (t.result === 'soon')
    return {
      outcome: {
        kind: 'nothing',
        bot: LOREGAMEBOT,
        reason: 'cooldown',
        retryMs: t.retryMs,
      } as TurnOutcome,
      restMs: t.retryMs,
    };
  const { result: _, ...trained } = t;
  return { outcome: { kind: 'training', bot: LOREGAMEBOT, ...trained } as TurnOutcome };
}

/** A player's answer to `/allenati`: whose, and what the bot said. */
export type PlayerTraining = PlayerAnswer<TrainingReply>;

/** The `/allenati` answers, out of everything the parser hears (`src/answer-watch.ts`). */
export class TrainingWatch extends AnswerWatch<TrainingReply> {
  constructor(bot: string) {
    super({ bot, commands: TRAINING_COMMANDS, parse: parseTraining });
  }
}
