/**
 * The game's timers as the parser sees them, built only from the bot's messages: where each player
 * is, their trips, rest after a return and freezes, and the estimates a live reader needs at once
 * (balances, carried emoji, the 🎈's chances). Pure and replayable: messages and the clock come in,
 * notices come out, so a run can be replayed from its log or from an export.
 *
 * The game's record (houses, babies, the ⚽ and its hold times, bans, trips with their arrivals) is
 * the `norelec-state` plugin's (modules/norelec/src/plugins/norelec-state.ts), kept from the
 * parser's events: queried, not read from here.
 *
 * - `apply(message)` takes one bot message and returns the notices of what it says happened.
 * - `tick(now)` returns the notices of timers that ran out by `now`: call it before each message
 *   and from a clock.
 *
 * The rules behind the timers are in docs/game-rules.md: rest after a return §2.7, the freeze
 * and 🔥 §6.
 */
import { type BotMessage } from '#src/game/bot-message.ts';
import { type GameEvent } from '#src/game/events.ts';
import { emojiKind, type PlayerRef } from '#src/game/player.ts';
import { HenCount } from './hens.ts';

export type Location = 'home' | 'travelling' | 'unknown';

export interface Trip {
  to: string;
  departedAt: number;
  /** When the outward leg ends, from the departure line. */
  arriveAt: number;
  /** When the player is due home; known once the arrival line gives it. */
  returnAt?: number;
  /** What the trip carries (`🧊`), if anything. */
  load?: string;
  /** The balls on the road with the player, out of every balance: a theft's loot, to home. */
  carrying?: number;
  /** An arrival line was seen: the trip was real, not a dream. */
  arrived: boolean;
}

export interface PlayerState {
  name: string;
  location: Location;
  trip?: Trip;
  /** The carried emoji as last listed next to the name; `null` is an empty slot. */
  carried?: (string | null)[];
  balance?: { balls: number; at: number };
  /**
   * When the bot last stated the balance whole (a profile, a refusal that names it, a theft of
   * nothing): the 🐔 have paid in silence since (`hens`).
   */
  balanceReadAt?: number;
  /** The 🐔 in the house, as the log shows them (modules/norelec/src/state/hens.ts): a ball a minute each. */
  hens?: number;
  /**
   * The bot wrote the player with `@` at least once: a Telegram account (or an IRC nick linked to
   * one), which a command must name as `@Name`. The bot never writes an IRC-only player with `@`,
   * but often writes a Telegram one without it, so only `@` is evidence (docs/bot-protocol.md §2).
   */
  telegram?: true;
  /** Rest after the last return ends (a departure before it is likely a dream). */
  restUntil?: number;
  /** When the player last came home from a trip. */
  lastReturnAt?: number;
  /** When a bot line last named the player (a client may offer the recent ones as targets). */
  seenAt?: number;
  frozenUntil?: number;
  /**
   * The chance, in %, that the next attempt pops the player's 🎈, as the bot last stated it after
   * a resist, and 25 after a pop (rules §3.3). One counter per player: which of two 🎈 rolled is
   * not shown.
   */
  balloonChance?: number;
  /** Whether a 🎈 guards the house while the player is out, as raids on the empty house showed. */
  houseBalloon?: boolean;
  /** The last loot the player took from each victim, by victim. */
  loot?: Record<string, number>;
  /** The last one-way trip time the bot gave the player to each home, in seconds, by home. */
  tripS?: Record<string, number>;
  /**
   * Trips taken for dreams because no arrival came, whose dream line has not come yet. The bot
   * says a trip was dreamt minutes or an hour late, often during a later trip (rules §2.6): such a
   * line settles one of these, and leaves the trip under way alone.
   */
  unrevealedDreams?: number;
}

export type NoticeKind =
  | 'incomingRaid'
  | 'incomingThrow'
  | 'tripDreamt'
  | 'returnMissed'
  | 'restOver'
  | 'frozen'
  | 'freezeEnded'
  | 'bounced'
  | 'saltPaid'
  | 'unknownLine';

export interface Notice {
  kind: NoticeKind;
  /** When it happened, or when it will (an incoming raid's arrival). */
  at: number;
  /** The player it is about: the raided, the frozen, … */
  player: string;
  /** Who caused it, when someone else did (the raider, the thrower). */
  by?: string;
  detail?: string;
}

export interface GameStateOptions {
  /** Rest after a return before leaving again (rules §2.7: 60–120 s). */
  restS?: number;
  /**
   * How long after a trip's expected arrival a missing arrival line means a dream, and after its
   * expected return a missing return line means the player is home all the same.
   */
  dreamMarginS?: number;
}

/**
 * The balls a player has, as far as the state knows: their balance, plus those on the road with them,
 * which no balance holds. Undefined while the balance is not known.
 */
export function ballsOf(p: Pick<PlayerState, 'balance' | 'trip'>): number | undefined {
  return p.balance === undefined ? undefined : p.balance.balls + (p.trip?.carrying ?? 0);
}

/**
 * The `n` players with the most balls (`ballsOf`), richest first (ties by name), leaving out those
 * in `except` and those whose balance is not known.
 */
export function richest(
  state: Pick<GameState, 'players'>,
  n: number,
  except: readonly string[] = []
): string[] {
  const ranked: { name: string; balls: number }[] = [];
  for (const p of state.players.values()) {
    const balls = ballsOf(p);
    if (balls !== undefined && !except.includes(p.name)) ranked.push({ name: p.name, balls });
  }
  ranked.sort((a, b) => b.balls - a.balls || a.name.localeCompare(b.name));
  return ranked.slice(0, n).map((p) => p.name);
}

/**
 * The `n` players a bot line named most recently, within `windowMs` of `now`, latest first: those
 * active lately, whatever their balance.
 */
export function recent(
  state: Pick<GameState, 'players'>,
  now: number,
  windowMs: number,
  n: number,
  except: readonly string[] = []
): string[] {
  return [...state.players.values()]
    .filter((p) => p.seenAt !== undefined && now - p.seenAt <= windowMs && !except.includes(p.name))
    .sort((a, b) => (b.seenAt ?? 0) - (a.seenAt ?? 0) || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((p) => p.name);
}

/**
 * How a command names `name`: `@Name` for a Telegram account, the bare name otherwise. The bot
 * refuses the other form either way ("non conosco nessun giocatore di nome …").
 */
export function address(
  state: { readonly players: ReadonlyMap<string, { readonly telegram?: true }> },
  name: string
): string {
  return state.players.get(name)?.telegram === true ? `@${name}` : name;
}

const SECOND = 1000;

export class GameState {
  readonly players = new Map<string, PlayerState>();
  private readonly henCount = new HenCount();
  private readonly restMs: number;
  private readonly dreamMarginMs: number;

  constructor(options: GameStateOptions = {}) {
    this.restMs = (options.restS ?? 90) * SECOND;
    this.dreamMarginMs = (options.dreamMarginS ?? 120) * SECOND;
  }

  /** The state of a player, created on first mention. */
  player(name: string): PlayerState {
    let p = this.players.get(name);
    if (p === undefined) {
      p = { name, location: 'unknown' };
      this.players.set(name, p);
    }
    return p;
  }

  /** The notices of the timers that ran out by `now`, each given once. */
  tick(now: number): Notice[] {
    const out: Notice[] = [];
    for (const p of this.players.values()) {
      const trip = p.trip;
      if (trip !== undefined && !trip.arrived && now > trip.arriveAt + this.dreamMarginMs) {
        out.push({ kind: 'tripDreamt', at: trip.arriveAt, player: p.name, detail: trip.to });
        delete p.trip;
        p.location = 'home';
        p.unrevealedDreams = (p.unrevealedDreams ?? 0) + 1;
      }
      // A return line never read (a connection dead without knowing it: 4 Nov, 02:26–02:32 UTC):
      // home all the same once its time is well past, or the run waits for it forever.
      if (
        trip?.arrived === true &&
        trip.returnAt !== undefined &&
        now > trip.returnAt + this.dreamMarginMs &&
        p.trip === trip
      ) {
        out.push({ kind: 'returnMissed', at: trip.returnAt, player: p.name, detail: trip.to });
        delete p.trip;
        p.location = 'home';
        p.lastReturnAt = trip.returnAt;
        p.restUntil = trip.returnAt + this.restMs;
      }
      if (p.restUntil !== undefined && now >= p.restUntil) {
        out.push({ kind: 'restOver', at: p.restUntil, player: p.name });
        delete p.restUntil;
      }
      if (p.frozenUntil !== undefined && now >= p.frozenUntil) {
        out.push({ kind: 'freezeEnded', at: p.frozenUntil, player: p.name });
        delete p.frozenUntil;
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** Takes one bot message; returns the notices of what it says happened. */
  apply(message: BotMessage): Notice[] {
    const out: Notice[] = [];
    const t = message.time;
    for (const e of message.events) {
      for (const name of e.telegram ?? []) this.player(name).telegram = true;
      if (e.kind === 'refused') this.unknownName(e.reason);
      for (const ref of refs(e)) {
        if (ref.carried !== undefined) this.carry(ref.name, ref.carried);
        this.player(ref.name).seenAt = t;
      }
      this.event(e, t, out);
      // The 🏴‍☠️ takes an emoji from the victim's house onto the raider's carried slots.
      if (e.kind === 'pirate' && e.player !== undefined && e.carried !== undefined)
        this.carry(e.player.name, e.carried);
    }
    this.henCount.apply(message.events);
    for (const [name, hens] of this.henCount.entries()) this.player(name).hens = hens;
    return out;
  }

  private event(e: GameEvent, t: number, out: Notice[]): void {
    switch (e.kind) {
      case 'balloonHeld': {
        const victim = this.player(e.victim.name);
        victim.balloonChance = e.nextChance;
        if (victim.location !== 'home' && victim.location !== 'unknown') victim.houseBalloon = true;
        this.arrived(e.player.name, t, e.seconds);
        return;
      }
      case 'theft': {
        const victim = this.player(e.victim.name);
        if (e.how === 'popped') victim.balloonChance = 25;
        // While the victim is frozen its house 🎈 does not defend: an unguarded house then tells
        // nothing about it.
        const frozen = (victim.frozenUntil ?? 0) > t;
        if (e.victimAway && e.how !== 'sneaked' && !frozen)
          victim.houseBalloon = e.how === 'popped';
        const thief = this.player(e.player.name);
        thief.loot = { ...thief.loot, [victim.name]: e.balls };
        this.arrived(e.player.name, t, e.seconds);
        if (thief.trip !== undefined) thief.trip.carrying = e.balls;
        // A theft of nothing finds the victim empty, whatever the estimate said.
        if (e.balls === 0) this.readBalance(victim.name, 0, t);
        else this.addBalance(victim.name, -e.balls, t);
        return;
      }
      case 'depart': {
        const p = this.player(e.player.name);
        const trip: Trip = {
          to: e.to.name,
          departedAt: t,
          arriveAt: t + e.seconds * SECOND,
          arrived: false,
        };
        if (e.load !== undefined) {
          trip.load = e.load;
          this.offPlayer(p.name, e.load);
        }
        p.trip = trip;
        p.tripS = { ...p.tripS, [e.to.name]: e.seconds };
        p.location = 'travelling';
        delete p.restUntil;
        const notice: Notice = {
          kind: e.load === undefined ? 'incomingRaid' : 'incomingThrow',
          at: trip.arriveAt,
          player: e.to.name,
          by: p.name,
        };
        if (e.load !== undefined) notice.detail = e.load;
        out.push(notice);
        return;
      }
      case 'bombAtHome':
      case 'dog':
      case 'bombDefective':
      case 'throwUndelivered':
        this.arrived(e.player.name, t, e.seconds);
        return;
      case 'throwDelivered':
        this.arrived(e.player.name, t);
        return;
      case 'freezeDelivered': {
        this.arrived(e.player.name, t);
        const target = this.player(e.target.name);
        const fire = (target.carried ?? []).filter(
          (c) => c !== null && emojiKind(c) === '🔥'
        ).length;
        // The line states the real length since 23 Oct; before, the base, less 10% per 🔥.
        const share = e.actual ? 1 : Math.max(0, 1 - 0.1 * fire);
        target.frozenUntil = t + e.minutes * 60 * SECOND * share;
        out.push({ kind: 'frozen', at: t, player: target.name, by: e.player.name });
        return;
      }
      case 'frozen':
        this.player(e.player.name).frozenUntil = t + e.seconds * SECOND;
        return;
      case 'bounced':
        out.push({
          kind: 'bounced',
          at: t,
          player: e.thrower.name,
          by: e.victim.name,
          detail: e.emoji,
        });
        if (e.seconds !== undefined) this.arrived(e.thrower.name, t, e.seconds);
        return;
      case 'returnHome':
      case 'lostAtFork': {
        const p = this.player(e.player.name);
        p.location = 'home';
        delete p.trip;
        p.restUntil = t + this.restMs;
        p.lastReturnAt = t;
        if (e.kind === 'returnHome' && e.balls !== undefined) this.addBalance(p.name, e.balls, t);
        return;
      }
      case 'turnBack': {
        const p = this.player(e.player.name);
        if (p.trip !== undefined) {
          p.trip.arrived = true;
          p.trip.returnAt = t + e.seconds * SECOND;
        }
        return;
      }
      case 'dreamDepart': {
        const p = this.player(e.player.name);
        // A late line about an earlier trip, already taken for a dream: the trip under way is real.
        if ((p.unrevealedDreams ?? 0) > 0) {
          p.unrevealedDreams = (p.unrevealedDreams ?? 0) - 1;
          return;
        }
        if (p.trip?.arrived === true) return;
        if (p.trip !== undefined)
          out.push({ kind: 'tripDreamt', at: t, player: p.name, detail: p.trip.to });
        delete p.trip;
        p.location = 'home';
        return;
      }
      case 'profile': {
        const p = this.player(e.player.name);
        this.readBalance(p.name, e.balls, t);
        if (e.carried !== undefined) this.carry(p.name, e.carried);
        if (e.at?.kind === 'home') p.location = 'home';
        return;
      }
      case 'tooPoor':
        // A refused purchase states the balance ("ne hai M").
        if (e.have !== undefined) this.readBalance(e.player.name, e.have, t);
        return;
      case 'bought':
        this.addBalance(e.player.name, -e.balls, t);
        return;
      case 'saltPaid': {
        // The raider pays the victim (rules §4.2).
        if (e.player !== undefined) this.addBalance(e.player.name, -e.balls, t);
        this.addBalance(e.victim.name, e.balls, t);
        const notice: Notice = {
          kind: 'saltPaid',
          at: t,
          player: e.victim.name,
          detail: `${e.balls}`,
        };
        if (e.player !== undefined) notice.by = e.player.name;
        out.push(notice);
        return;
      }
      case 'foundBalls':
        if (e.player !== undefined) this.addBalance(e.player.name, e.balls, t);
        return;
      case 'bagCollected':
        this.addBalance(e.player.name, e.balls, t);
        return;
      case 'quoteAdded':
        this.addBalance(e.player.name, -e.balls, t);
        return;
      case 'unknown':
        out.push({ kind: 'unknownLine', at: t, player: '', detail: e.line });
        return;
      default:
        return;
    }
  }

  /**
   * "non conosco nessun giocatore di nome X": the bot knows a known player under the other form, so
   * a bare name is a Telegram account's, and `@Name` an IRC player's (4 Nov: a `!give` to a bare
   * name was refused, the run having forgotten since a restart that the player is on Telegram).
   */
  private unknownName(reason: string): void {
    const named = /^non conosco nessun giocatore di nome (@?)([^\s.]+)/u.exec(reason);
    if (named === null) return;
    const [, at, name = ''] = named;
    const p = this.players.get(name);
    if (p === undefined) return;
    if (at === '') p.telegram = true;
    else delete p.telegram;
  }

  /** A trip's arrival: the trip was real; the return leg takes `seconds` if given. */
  private arrived(name: string, t: number, seconds?: number): void {
    const p = this.player(name);
    if (p.trip === undefined) p.trip = { to: '', departedAt: t, arriveAt: t, arrived: true };
    p.trip.arrived = true;
    if (seconds !== undefined) p.trip.returnAt = t + seconds * SECOND;
  }

  /** The carried emoji as listed next to the name. */
  private carry(name: string, carried: (string | null)[]): void {
    this.player(name).carried = carried;
  }

  /** An emoji thrown leaves with its player: from the carried slots if there (rules §6). */
  private offPlayer(name: string, emoji: string): void {
    const p = this.player(name);
    const i = (p.carried ?? []).findIndex((c) => c !== null && emojiKind(c) === emojiKind(emoji));
    if (p.carried !== undefined && i >= 0) p.carried[i] = null;
  }

  /** The bot stated `name`'s balance whole. */
  private readBalance(name: string, balls: number, t: number): void {
    const p = this.player(name);
    p.balance = { balls, at: t };
    p.balanceReadAt = t;
  }

  private addBalance(name: string, delta: number, t: number): void {
    const p = this.player(name);
    if (p.balance !== undefined) p.balance = { balls: Math.max(0, p.balance.balls + delta), at: t };
  }
}

/** Every player an event names. */
function refs(e: GameEvent): PlayerRef[] {
  const out: PlayerRef[] = [];
  for (const k of ['player', 'to', 'victim', 'target', 'thrower', 'father', `from`] as const) {
    const v = (e as Partial<Record<typeof k, unknown>>)[k];
    if (typeof v === 'object' && v !== null && 'name' in v) out.push(v as PlayerRef);
  }
  return out;
}
