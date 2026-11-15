/**
 * The typed events of NorelecBot's game, one per line of a bot message
 * (docs/bot-protocol.md §3). The parser (parse-line.ts, parse-message.ts) produces them; the
 * game state consumes them. An optional `player` on a kind whose line names
 * no player is the player the message is about, filled in by parse-message.ts.
 */
import { type PlayerRef } from './player.ts';

/**
 * The place, closed since the ⚽ version (9 Nov 2026): the bot still names it in a few lines (a
 * freeze's, the refusal of /avventura while it answered that).
 */
export const CONQUISTER = 'TheConquister37';

/** The fields of each event kind. */
export interface EventFields {
  // Travel
  depart: {
    player: PlayerRef;
    to: PlayerRef;
    seconds: number;
    /** What the trip carries: an emoji to throw. */
    load?: string;
    rocket: boolean;
  };
  alreadyTravelling: { player: PlayerRef; seconds: number };
  turnBack: { player: PlayerRef; home: string; seconds: number };
  foundBalls: { balls: number; player?: PlayerRef };
  dreamDepart: { player: PlayerRef };
  forkAsked: object;
  lostAtFork: { player: PlayerRef; home: string };
  returnHome: { player: PlayerRef; home: string; balls?: number };
  buyingAway: { player: PlayerRef; seconds: number };
  // Arrival at a home
  theft: {
    player: PlayerRef;
    victim: PlayerRef;
    balls: number;
    victimAway: boolean;
    how: 'popped' | 'unguarded' | 'sneaked';
    seconds: number;
  };
  balloonHeld: { player: PlayerRef; victim: PlayerRef; nextChance: number; seconds: number };
  dog: { player: PlayerRef; victim: PlayerRef; seconds: number };
  pity: {
    victim: PlayerRef;
    balls: number;
    insteadOf: number;
    percent: number;
    player?: PlayerRef;
  };
  alarm: { victim: PlayerRef; player?: PlayerRef };
  dinosaur: { victim: PlayerRef; eaten: string; player?: PlayerRef };
  /** The raider takes `emoji` from the victim's house; `carried`: their slots after it, if listed. */
  pirate: { emoji: string; carried?: (string | null)[]; player?: PlayerRef };
  /**
   * The ⚽ taken from its holder by a theft (the line after the theft's): `player` the thief,
   * `from` the holder robbed, both from the theft (parse-message.ts).
   */
  ballTaken: { player?: PlayerRef; from?: PlayerRef };
  throwDelivered: { player: PlayerRef; emoji: string; to: PlayerRef };
  /** A bomb that went off in the thrower's hand: what it took, if they carried anything. */
  bombDefective: { player: PlayerRef; destroyed?: string; seconds: number };
  /** A 📮 sent a throw back to the thrower's home (docs/game-rules.md §5.3). */
  bounced: { victim: PlayerRef; emoji: string; thrower: PlayerRef; seconds?: number };
  throwUndelivered: { player: PlayerRef; to: PlayerRef; emoji: string; seconds: number };
  /**
   * A 🧊 that froze its target at their home. One wording states the freeze's real length, 🔥
   * included (`actual`); the other (`non può entrare in @TheConquister37 né partire`, the live one)
   * the base 30 minutes.
   */
  freezeDelivered: {
    player: PlayerRef;
    target: PlayerRef;
    minutes: number;
    actual: boolean;
  };
  frozen: { player: PlayerRef; seconds: number };
  milestone: { player: PlayerRef; raids: number };
  /**
   * A 💦's baby born in `player`'s house (the father, the thrower): it takes a slot, the emoji
   * there (`replaced`) gone when the house was full, and locks it (docs/game-rules.md §5.3).
   */
  born: { player: PlayerRef; father: PlayerRef; emoji: string; female: boolean; replaced?: string };
  /** A baby (or what it grew into) left `player`'s house: its slot is free again. */
  babyGone: { player: PlayerRef; emoji: string };
  /** `/back` (or a trip) to where the player is already. */
  alreadyAt: { player: PlayerRef; place: string };
  // Buying and slots
  /**
   * A purchase, at the price it states (`balls`: 0 for `hai preso gratis`): into the house's
   * `slot`, where `replaced` was (destroyed), or carried; `count`: the copies of it the player then
   * holds there, when the bot says (`Ora ne hai N in casa`).
   */
  bought: {
    player: PlayerRef;
    balls: number;
    emoji: string;
    carried: boolean;
    slot?: number;
    replaced?: string;
    count?: number;
  };
  /** A purchase refused for its price: the price asked, and the balance, when stated. */
  tooPoor: { player: PlayerRef; price: number; emoji: string; have?: number };
  /** A purchase refused: the slot holds a baby (`emoji`), which cannot be replaced. */
  slotLocked: { player: PlayerRef; slot: number; emoji: string };
  /** A command the game no longer has (`/give`, `/burn`, `☢️`, `@TheConquister37`): refused. */
  disabled: { player: PlayerRef; what: string };
  /**
   * The game's one reply to a banned player (`COGLIONE`): `player`, the banned one, is named by
   * the norelec plugin from the command it answers, when it saw it.
   */
  banned: { player?: PlayerRef };
  houseFull: { player: PlayerRef };
  carriedFull: { player: PlayerRef; emoji: string };
  retiredCommand: { player: PlayerRef; replacement: string };
  // State queries
  /** A row of /leaderboard, the ⚽'s: the total time held; `holding`, the holder's (`⚽`). */
  ballRow: { rank: number; player: PlayerRef; seconds: number; holding: boolean };
  /** /leaderboard's last line: who holds the ⚽, and for how long so far. */
  ballHolder: { player: PlayerRef; seconds: number };
  /** A `/take` (`carried`) or `/store`; `swapped`: the carried emoji a `/take` sent home in its place. */
  moved: { player: PlayerRef; emoji: string; carried: boolean; swapped?: string };
  /** A `/move`: the whole house after it, empty slots null. */
  rearranged: { player: PlayerRef; slots: (string | null)[] };
  saltPaid: { victim: PlayerRef; balls: number; player?: PlayerRef };
  /** A wanderer drops a bag of balls: the first to answer `/raccogli` (`!raccogli`) takes it. */
  bagDropped: { near: PlayerRef };
  bagCollected: { player: PlayerRef; balls: number };
  /** The bot declined a command (wrong place, too poor, no such player, …): nothing happened. */
  refused: { player: PlayerRef; reason: string };
  quoteAdded: { player: PlayerRef; balls: number };
  bombAtHome: { player: PlayerRef; victim: PlayerRef; destroyed?: string; seconds: number };
  /** A /profile reply, read whole (parse-message.ts). */
  profile: {
    player: PlayerRef;
    balls: number;
    rank: number;
    at?:
      | { kind: 'home'; home: string }
      | { kind: 'travelling' | 'returning'; to: string; seconds: number };
    carried?: (string | null)[];
    /** The 🐔 in the house, from the income line (`2 🐔: 120 palle all'ora`), when there is one. */
    hens?: number;
  };
  /** A /house reply, read whole (parse-message.ts): the ten slots, empty ones null. */
  house: { player: PlayerRef; slots: (string | null)[] };
  /** A known line that changes no state: headers, explanations, announcements, listings. */
  info: object;
  /** A line no template matches: new wording, or a message kind not modelled yet. */
  unknown: object;
}

export type EventKind = keyof EventFields;

/** Every kind, for whoever needs them at runtime (the norelec plugin's per-kind events). */
export const EVENT_KINDS = [
  'depart',
  'alreadyTravelling',
  'turnBack',
  'foundBalls',
  'dreamDepart',
  'forkAsked',
  'lostAtFork',
  'returnHome',
  'buyingAway',
  'theft',
  'ballTaken',
  'balloonHeld',
  'dog',
  'pity',
  'alarm',
  'dinosaur',
  'pirate',
  'throwDelivered',
  'bombDefective',
  'bounced',
  'throwUndelivered',
  'freezeDelivered',
  'frozen',
  'milestone',
  'born',
  'babyGone',
  'alreadyAt',
  'bought',
  'tooPoor',
  'slotLocked',
  'disabled',
  'banned',
  'houseFull',
  'carriedFull',
  'retiredCommand',
  'ballRow',
  'ballHolder',
  'moved',
  'rearranged',
  'saltPaid',
  'bagDropped',
  'bagCollected',
  'refused',
  'quoteAdded',
  'bombAtHome',
  'profile',
  'house',
  'info',
  'unknown',
] as const satisfies readonly EventKind[];

/** A compile-time check that `EVENT_KINDS` lists every kind. */
export const ALL_KINDS: Exclude<EventKind, (typeof EVENT_KINDS)[number]> extends never
  ? true
  : false = true;

/**
 * One event, with the line it was read from, and the players the line writes with `@`, if any:
 * Telegram accounts, which a command must name with `@` (docs/bot-protocol.md §2).
 */
export type GameEvent = {
  [K in EventKind]: { kind: K; line: string; telegram?: string[] } & EventFields[K];
}[EventKind];

/** The event of a given kind. */
export type EventOf<K extends EventKind> = Extract<GameEvent, { kind: K }>;
