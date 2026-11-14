/**
 * NorelecBot's answers to a player's own commands (MegaBotTron1999's bot-os.md D98): which events
 * of a bot message answer which of the game's commands (docs/game-rules.md §1.1), as IRC sends them
 * (`!raid Juno`), with the status, the reason and, where the bot states a time, when the command
 * may go again.
 *
 * The channel is everyone's, so an event answers only when it is about the player the owner plays
 * (`self`): another player's departure answers nobody's `!raid` here. Each answer is a rule of
 * `ANSWER_RULES`, which the `norelec` plugin's manifest declares one by one (`answerDeclarations`),
 * and which its `norelec.answer` event names in its payload's `rule`.
 *
 * Only what the bot says at once is an answer: a dreamt departure or entry, revealed minutes later
 * (game-rules.md §2.7, §3.6), and an arrival's outcome are news, not answers.
 */
import { CONQUISTER, type GameEvent } from './events.ts';

/** The commands a trip starts (game-rules.md §1.1), as their first word on IRC. */
export const TRAVEL = ['!raid', '!give', '!throw'];
/** Entering @TheConquister37. */
export const ENTER = ['!avventura'];
/** The house's commands. */
export const SHOP = ['!buy', '!take', '!store', '!move'];

/** One kind of answer: the commands it answers, and how. */
export interface AnswerRule {
  commands: readonly string[];
  status: 'ok' | 'refused';
  /** Why: D98's `cooldown`, `missing`, `invalid`, or the game's own. */
  reason?: string;
  /** The commands its `retryAt` holds back, when not only its own. */
  holds?: readonly string[];
}

/**
 * The penalty after a failed entry when the bot does not state it, in seconds: about 5 minutes,
 * as measured (game-rules.md §3.4).
 */
export const ENTRY_PENALTY_S = 300;

/** Every answer the parser recognizes, by the name its event carries. */
export const ANSWER_RULES = {
  raid: { commands: ['!raid'], status: 'ok' },
  give: { commands: ['!give'], status: 'ok' },
  throw: { commands: ['!throw'], status: 'ok' },
  travelling: {
    commands: [...TRAVEL, ...ENTER],
    status: 'refused',
    reason: 'travelling',
    holds: [...TRAVEL, ...ENTER],
  },
  frozen: {
    commands: [...TRAVEL, ...ENTER],
    status: 'refused',
    reason: 'frozen',
    holds: [...TRAVEL, ...ENTER],
  },
  inConquister: { commands: TRAVEL, status: 'refused', reason: 'in-conquister' },
  travelInvalid: { commands: TRAVEL, status: 'refused', reason: 'invalid' },
  carryMissing: {
    commands: ['!give', '!throw', '!store', '!burn'],
    status: 'refused',
    reason: 'missing',
  },
  giveMissing: { commands: ['!give'], status: 'refused', reason: 'missing' },
  giveInvalid: { commands: ['!give', '!burn'], status: 'refused', reason: 'invalid' },
  entered: { commands: ENTER, status: 'ok' },
  entryHeld: { commands: ENTER, status: 'ok', reason: 'penalty' },
  gatekeeper: { commands: ENTER, status: 'ok', reason: 'riddle' },
  locked: { commands: ENTER, status: 'refused', reason: 'locked' },
  penalty: { commands: ENTER, status: 'refused', reason: 'cooldown' },
  enterInvalid: { commands: ENTER, status: 'refused', reason: 'invalid' },
  passed: { commands: ['!parola'], status: 'ok' },
  doorClosed: {
    commands: ['!parola'],
    status: 'refused',
    reason: 'invalid',
    holds: [...ENTER, '!parola'],
  },
  back: { commands: ['!back'], status: 'ok' },
  backInvalid: { commands: ['!back'], status: 'refused', reason: 'invalid' },
  bought: { commands: ['!buy'], status: 'ok' },
  moved: { commands: ['!take', '!store', '!move'], status: 'ok' },
  buyMissing: { commands: ['!buy'], status: 'refused', reason: 'missing' },
  shopAway: { commands: SHOP, status: 'refused', reason: 'travelling', holds: SHOP },
  shopInvalid: { commands: SHOP, status: 'refused', reason: 'invalid' },
  shopMissing: { commands: SHOP, status: 'refused', reason: 'missing' },
  burned: { commands: ['!burn'], status: 'ok' },
  quoted: { commands: ['!addquote'], status: 'ok' },
  quoteMissing: { commands: ['!addquote'], status: 'refused', reason: 'missing' },
  collected: { commands: ['!raccogli'], status: 'ok' },
  nothingToCollect: { commands: ['!raccogli'], status: 'refused', reason: 'missing' },
} as const satisfies Record<string, AnswerRule>;

export type AnswerRuleName = keyof typeof ANSWER_RULES;

/** A generic refusal (`refused`), by the start of its reason, into its rule. */
const REFUSAL_RULES: [RegExp, AnswerRuleName][] = [
  [/^sei in viaggio:/u, 'travelling'],
  [/^non conosco nessun giocatore/u, 'travelInvalid'],
  [/^non puoi razziare te stesso/u, 'travelInvalid'],
  [/^una emoji per volta/u, 'travelInvalid'],
  [/^a @TheConquister37 non si porta/u, 'travelInvalid'],
  [/^\S+ non si lancia:/u, 'travelInvalid'],
  [/^non hai \S+(?: con te|, né con te né in casa)\./u, 'carryMissing'],
  [/^hai solo \d+ palle a disposizione/u, 'giveMissing'],
  [/^non puoi regalare a te stesso/u, 'giveInvalid'],
  [/^indica un numero di palle/u, 'giveInvalid'],
  [/^non hai \S+ in casa/u, 'shopMissing'],
  [/^nel posto \d+ della casa non c'è/u, 'shopMissing'],
  [/^la casa è piena/u, 'shopInvalid'],
  [/^nel posto \d+ c'è già/u, 'shopInvalid'],
  [/^hai già \d+ emoji con te/u, 'shopInvalid'],
  [/^\S+ è già con te/u, 'shopInvalid'],
  [/^la posizione si sceglie solo/u, 'shopInvalid'],
  [/^\S+ non ha posti liberi/u, 'shopInvalid'],
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
      return { rule: e.gift ? 'give' : e.load === undefined ? 'raid' : 'throw' };
    case 'throwDelivered':
      return e.atHolder ? { rule: 'throw' } : undefined;
    case 'bombAtHolder':
      return { rule: 'throw' };
    case 'alreadyTravelling':
      return { rule: 'travelling', retryAt: later(t, e.seconds) };
    case 'onTheRoad':
      return { rule: 'travelling', retryAt: later(t, e.seconds) };
    case 'frozen':
      return { rule: 'frozen', retryAt: later(t, e.seconds) };
    case 'raidFromConquister':
      return { rule: 'inConquister' };
    case 'entered':
      return { rule: 'entered' };
    case 'entryHeld':
      return { rule: 'entryHeld', retryAt: later(t, e.penaltyS ?? ENTRY_PENALTY_S) };
    case 'gatekeeperAsks':
      return { rule: 'gatekeeper' };
    case 'gatekeeperPasses':
      return { rule: 'passed' };
    case 'doorClosed':
      return { rule: 'doorClosed', retryAt: later(t, e.seconds) };
    case 'locked':
      return { rule: 'locked' };
    case 'penaltyLeft':
      return { rule: 'penalty', retryAt: later(t, e.seconds) };
    case 'alreadyAt':
      return { rule: e.place === CONQUISTER ? 'enterInvalid' : 'backInvalid' };
    case 'turnBack':
    case 'leftConquister':
      return { rule: 'back' };
    case 'bought':
      return { rule: 'bought' };
    case 'moved':
      return { rule: 'moved' };
    case 'tooPoor':
      return { rule: 'buyMissing' };
    case 'houseFull':
    case 'carriedFull':
      return { rule: 'shopInvalid' };
    case 'buyingAway':
      return { rule: 'shopAway', retryAt: later(t, e.seconds) };
    case 'burned':
      return { rule: 'burned' };
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
 * whose payload names the rule (`rule`) and may hold `retryAt`.
 */
export function answerDeclarations(event: string) {
  return Object.entries(ANSWER_RULES).map(([name, r]: [string, AnswerRule]) => ({
    event,
    commands: [...r.commands],
    when: { rule: name },
    status: r.status,
    ...(r.reason === undefined ? {} : { reason: r.reason }),
    retryAtFrom: 'retryAt',
    ...(r.holds === undefined ? {} : { holds: [...r.holds] }),
  }));
}
