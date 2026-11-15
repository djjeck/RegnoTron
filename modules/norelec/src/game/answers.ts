/**
 * NorelecBot's answers to a player's own commands (MegaBotTron1999's bot-os.md D98): which events
 * of a bot message answer which of the game's commands (docs/game-rules.md §1.1), in both forms
 * (`!raid Juno` on IRC, `/raid @Juno` on Telegram), with the status, the reason and, where the bot
 * states a time, when the command may go again.
 *
 * The channel is everyone's, so an event answers only when it is about the player the owner plays
 * (`self`): another player's departure answers nobody's `!raid` here. Each answer is a rule of
 * `ANSWER_RULES`, which the `norelec` plugin's manifest declares one by one (`answerDeclarations`),
 * and which its `norelec.answer` event names in its payload's `rule`.
 *
 * Only what the bot says at once is an answer: a dreamt departure, revealed minutes later
 * (game-rules.md §2.7), and an arrival's outcome are news, not answers. A banned player's
 * `COGLIONE` answers nothing: the game answers only some of their commands, and those late.
 */
import { type GameEvent } from './events.ts';

/**
 * A command in both of the game's forms, `!` on IRC and `/` on Telegram, so that an answer pairs
 * with a command sent to either chat (the core pairs it with the chat the bot answered in).
 */
const both = (...verbs: string[]): string[] => verbs.flatMap((v) => [`!${v}`, `/${v}`]);

/** The commands a trip starts (game-rules.md §1.1), as their first word. */
export const TRAVEL = both('raid', 'throw');
/** The house's commands: all refused on the way back (`shopAway`), which holds them all. */
export const SHOP = both('buy', 'take', 'store', 'move');

/**
 * The commands the game answers only in its group: sent in the owner's private chat with the bot,
 * they get no reply at all (when enabled), so an answer read there answers none of them, and a send
 * of one there waits its window and is `unanswered`.
 */
export const GROUP_ONLY = both('buy', 'raid', 'give', 'burn', 'avventura');

/**
 * One kind of answer: the commands it answers, and how. A rule names only the commands that can
 * draw it: the core pairs an answer with the oldest waiting send of any of them, so a command the
 * bot never answers (/buy in the private chat, which the game ignores) would otherwise take an
 * answer meant for a newer command, and the retry-loop guard would hold it back.
 */
export interface AnswerRule {
  commands: readonly string[];
  status: 'ok' | 'refused';
  /** Why: D98's `cooldown`, `missing`, `invalid`, or the game's own. */
  reason?: string;
  /** The commands its `retryAt` holds back, when not only its own. */
  holds?: readonly string[];
}

/**
 * Every answer the parser recognizes, by the name its event carries. The commands the live game
 * disabled (/give, /burn: `… è disattivato.`) are answered `refused`/`disabled` while it says so;
 * those it no longer answers at all (/avventura, since 10 Nov 2026) have no answer.
 */
export const ANSWER_RULES = {
  raid: { commands: both('raid'), status: 'ok' },
  throw: { commands: both('throw'), status: 'ok' },
  travelling: { commands: TRAVEL, status: 'refused', reason: 'travelling', holds: TRAVEL },
  frozen: { commands: TRAVEL, status: 'refused', reason: 'frozen', holds: TRAVEL },
  travelInvalid: { commands: TRAVEL, status: 'refused', reason: 'invalid' },
  raidInvalid: { commands: both('raid'), status: 'refused', reason: 'invalid' },
  throwInvalid: { commands: both('throw'), status: 'refused', reason: 'invalid' },
  throwMissing: { commands: both('throw'), status: 'refused', reason: 'missing' },
  carryMissing: { commands: both('take', 'store'), status: 'refused', reason: 'missing' },
  disabled: { commands: both('give', 'burn'), status: 'refused', reason: 'disabled' },
  nukeDisabled: { commands: both('buy', 'throw'), status: 'refused', reason: 'disabled' },
  back: { commands: both('back'), status: 'ok' },
  backInvalid: { commands: both('back'), status: 'refused', reason: 'invalid' },
  bought: { commands: both('buy'), status: 'ok' },
  moved: { commands: both('take', 'store', 'move'), status: 'ok' },
  buyMissing: { commands: both('buy'), status: 'refused', reason: 'missing' },
  buyInvalid: { commands: both('buy'), status: 'refused', reason: 'invalid' },
  slotLocked: { commands: both('buy'), status: 'refused', reason: 'locked' },
  slotRange: { commands: both('buy', 'move'), status: 'refused', reason: 'invalid' },
  takeMissing: { commands: both('take'), status: 'refused', reason: 'missing' },
  takeInvalid: { commands: both('take'), status: 'refused', reason: 'invalid' },
  carriedFull: { commands: both('take', 'throw'), status: 'refused', reason: 'invalid' },
  storeInvalid: { commands: both('store'), status: 'refused', reason: 'invalid' },
  moveMissing: { commands: both('move'), status: 'refused', reason: 'missing' },
  shopAway: { commands: SHOP, status: 'refused', reason: 'travelling', holds: SHOP },
  quoted: { commands: both('addquote'), status: 'ok' },
  quoteMissing: { commands: both('addquote'), status: 'refused', reason: 'missing' },
  collected: { commands: both('raccogli'), status: 'ok' },
  nothingToCollect: { commands: both('raccogli'), status: 'refused', reason: 'missing' },
} as const satisfies Record<string, AnswerRule>;

export type AnswerRuleName = keyof typeof ANSWER_RULES;

/** A generic refusal (`refused`), by the start of its reason, into its rule. */
const REFUSAL_RULES: [RegExp, AnswerRuleName][] = [
  [/^sei in viaggio:/u, 'travelling'],
  [/^non conosco nessun giocatore/u, 'travelInvalid'],
  [/^una emoji per volta/u, 'travelInvalid'],
  [/^non puoi razziare te stesso/u, 'raidInvalid'],
  [/^\S+ non si lancia:/u, 'throwInvalid'],
  [/^\S+ non ha posti liberi/u, 'throwInvalid'],
  [/^non hai \S+, né con te né in casa\./u, 'throwMissing'],
  [/^non hai \S+ con te\./u, 'carryMissing'],
  [/^non hai \S+ in casa/u, 'takeMissing'],
  [/^\S+ è già con te/u, 'takeInvalid'],
  [/^hai già \d+ emoji con te/u, 'carriedFull'],
  [/^la casa è piena/u, 'storeInvalid'],
  [/^nel posto \d+ della casa non c'è/u, 'moveMissing'],
  [/^nel posto \d+ c'è già/u, 'buyInvalid'],
  [/^la posizione si sceglie solo/u, 'buyInvalid'],
  [/^i posti della casa vanno da/u, 'slotRange'],
  [/^ti servono \d+ palle per aggiungere/u, 'quoteMissing'],
  [/^qui non c'è niente da raccogliere/u, 'nothingToCollect'],
];

/** An event read as an answer: its rule, and when its commands may go again, if the bot says. */
export interface ReadAnswer {
  rule: AnswerRuleName;
  retryAt?: number;
}

const later = (t: number, seconds: number): number => t + seconds * 1000;

/** The answer `e`, of a bot message at `t`, is when its player is `self`; undefined if none. */
export function answerOf(e: GameEvent, self: string, t: number): ReadAnswer | undefined {
  if (!('player' in e) || e.player === undefined) return undefined;
  if (e.player.name.toLowerCase() !== self.replace(/^@/u, '').toLowerCase()) return undefined;
  switch (e.kind) {
    case 'depart':
      return { rule: e.load === undefined ? 'raid' : 'throw' };
    case 'alreadyTravelling':
      return { rule: 'travelling', retryAt: later(t, e.seconds) };
    case 'frozen':
      return { rule: 'frozen', retryAt: later(t, e.seconds) };
    case 'alreadyAt':
      return { rule: 'backInvalid' };
    case 'turnBack':
      return { rule: 'back' };
    case 'bought':
      return { rule: 'bought' };
    case 'moved':
    case 'rearranged':
      return { rule: 'moved' };
    case 'tooPoor':
      return { rule: 'buyMissing' };
    case 'slotLocked':
      return { rule: 'slotLocked' };
    case 'disabled':
      return /^[/!]/u.test(e.what)
        ? { rule: 'disabled' }
        : e.what.startsWith('☢')
          ? { rule: 'nukeDisabled' }
          : undefined;
    case 'houseFull':
      return { rule: 'buyInvalid' };
    case 'carriedFull':
      return { rule: 'carriedFull' };
    case 'buyingAway':
      return { rule: 'shopAway', retryAt: later(t, e.seconds) };
    case 'quoteAdded':
      return { rule: 'quoted' };
    case 'bagCollected':
      return { rule: 'collected' };
    case 'refused': {
      const rule = REFUSAL_RULES.find(([re]) => re.test(e.reason))?.[1];
      return rule === undefined ? undefined : { rule };
    }
    default:
      return undefined;
  }
}

/**
 * The manifest's `answers` (bot-os-api.md §2): one declaration per rule, over the event `event`,
 * whose payload names the rule (`rule`) and may hold `retryAt`. An answer read in the private chat
 * (`private: true`) answers none of the group's own commands (`GROUP_ONLY`): a rule that names one
 * is declared for the group (`unless` private) and, for its other commands, for the private chat.
 */
export function answerDeclarations(event: string) {
  return Object.entries(ANSWER_RULES).flatMap(([name, r]: [string, AnswerRule]) => {
    const how = {
      status: r.status,
      ...(r.reason === undefined ? {} : { reason: r.reason }),
      retryAtFrom: 'retryAt',
      ...(r.holds === undefined ? {} : { holds: [...r.holds] }),
    };
    const anywhere = r.commands.filter((c) => !GROUP_ONLY.includes(c));
    if (anywhere.length === r.commands.length)
      return [{ event, commands: [...r.commands], when: { rule: name }, ...how }];
    return [
      { event, commands: [...r.commands], when: { rule: name }, unless: { private: true }, ...how },
      ...(anywhere.length === 0
        ? []
        : [{ event, commands: anywhere, when: { rule: name, private: true }, ...how }]),
    ];
  });
}
