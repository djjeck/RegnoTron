/**
 * The typed events of NorelecBot's game, one per line of a bot message
 * (docs/bot-protocol.md §3). The parser (parse-line.ts, parse-message.ts) produces them; the
 * game state consumes them. An optional `player` on a kind whose line names
 * no player is the player the message is about, filled in by parse-message.ts.
 */
import { type PlayerRef } from './player.ts';

/** Where a trip goes, or where a player is: a home (named after its owner) or the place. */
export const CONQUISTER = 'TheConquister37';

/** The fields of each event kind. */
export interface EventFields {
  // Travel
  depart: {
    player: PlayerRef;
    to: PlayerRef;
    seconds: number;
    /** What the trip carries: an emoji to throw or give, or `500 palle`. */
    load?: string;
    /** The load is a gift (balls, or an emoji "da regalare"), not a throw. */
    gift: boolean;
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
  giftDelivered: {
    player: PlayerRef;
    to: PlayerRef;
    balls?: number;
    emoji?: string;
    seconds: number;
  };
  throwDelivered: { player: PlayerRef; emoji: string; to: PlayerRef; atHolder: boolean };
  bombAtHolder: { player: PlayerRef; holder: PlayerRef; destroyed?: string };
  bombDefective: { player: PlayerRef; destroyed: string; seconds: number };
  /** A 📮 sent a throw back to the thrower's home (docs/game-rules.md §5.3). */
  bounced: { victim: PlayerRef; emoji: string; thrower: PlayerRef; seconds?: number };
  throwUndelivered: { player: PlayerRef; to: PlayerRef; emoji: string; seconds: number };
  nuke: { player: PlayerRef; target?: PlayerRef };
  /**
   * A 🧊 that froze its target: at their home (after a trip) or at @TheConquister37 (instant).
   * Since 23 Oct the line states the freeze's real length, 🔥 included (`actual`); before, it
   * stated the base 30 minutes.
   */
  freezeDelivered: {
    player: PlayerRef;
    target: PlayerRef;
    minutes: number;
    atHolder: boolean;
    actual: boolean;
  };
  frozen: { player: PlayerRef; seconds: number };
  milestone: { player: PlayerRef; raids: number };
  // @TheConquister37
  balloonPopped: { player: PlayerRef; holder: PlayerRef };
  sneakedPast: { player: PlayerRef; holder: PlayerRef };
  ousted: { player: PlayerRef; holder: PlayerRef };
  holderPaid: { player: PlayerRef; balls: number; multiplier?: number };
  entered: { player: PlayerRef };
  entryHeld: { player: PlayerRef; holder: PlayerRef; nextChance: number; penaltyS?: number };
  dreamEntry: { player: PlayerRef };
  locked: { player: PlayerRef };
  gatekeeperAsks: { player?: PlayerRef; question: string };
  gatekeeperPasses: { player: PlayerRef };
  doorClosed: { seconds: number; player?: PlayerRef };
  alreadyAt: { player: PlayerRef; place: string };
  onTheRoad: { player: PlayerRef; home: string; seconds: number };
  leftConquister: { player: PlayerRef; home: string; balls: number };
  penaltyLeft: { player: PlayerRef; seconds: number };
  raidFromConquister: { player: PlayerRef };
  lobster: { emoji: string; player?: PlayerRef };
  // Buying and slots
  bought: {
    player: PlayerRef;
    balls: number;
    emoji: string;
    carried: boolean;
    slot?: number;
    /** Copies of the emoji in the game before this one, when the bot says ("ce n'erano già N"). */
    copiesBefore?: number;
  };
  tooPoor: { player: PlayerRef; price: number; emoji: string; copies?: number; have?: number };
  houseFull: { player: PlayerRef };
  carriedFull: { player: PlayerRef; emoji: string };
  retiredCommand: { player: PlayerRef; replacement: string };
  // State queries
  leaderboardRow: { rank: number; player: PlayerRef; balls: number; quotes: number };
  holderIs: { player: PlayerRef };
  /** A `/take` (`carried`) or `/store`; `swapped`: the carried emoji a `/take` sent home in its place. */
  moved: { player: PlayerRef; emoji: string; carried: boolean; swapped?: string };
  burned: { player: PlayerRef; what: string };
  saltPaid: { victim: PlayerRef; balls: number; player?: PlayerRef };
  /** A wanderer drops a bag of balls: the first to answer `/raccogli` (`!raccogli`) takes it. */
  bagDropped: { near: PlayerRef };
  bagCollected: { player: PlayerRef; balls: number };
  /** The bot declined a command (wrong place, too poor, no such player, …): nothing happened. */
  refused: {
    player: PlayerRef;
    reason: string;
    /** The balance a refused gift states (`hai solo N palle a disposizione`). */
    have?: number;
  };
  quoteAdded: { player: PlayerRef; balls: number };
  bombAtHome: { player: PlayerRef; victim: PlayerRef; destroyed?: string; seconds: number };
  /** A /profile reply, read whole (parse-message.ts). */
  profile: {
    player: PlayerRef;
    balls: number;
    rank: number;
    at?:
      | { kind: 'home'; home: string }
      | { kind: 'conquister' }
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

/**
 * One event, with the line it was read from, and the players the line writes with `@`, if any:
 * Telegram accounts, which a command must name with `@` (docs/bot-protocol.md §2).
 */
export type GameEvent = {
  [K in EventKind]: { kind: K; line: string; telegram?: string[] } & EventFields[K];
}[EventKind];

/** The event of a given kind. */
export type EventOf<K extends EventKind> = Extract<GameEvent, { kind: K }>;
