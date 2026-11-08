/**
 * The game as the client sees it, built only from the bot's messages:
 * where each player is, the timers that matter (trips, rest after a return, penalty, freeze), who
 * holds @TheConquister37, and the 🧊 in the game. Pure and replayable: messages and the clock come
 * in, notices come out, so a run can be replayed from its log or from an export.
 *
 * - `apply(message)` takes one bot message and returns the notices of what it says happened.
 * - `tick(now)` returns the notices of timers that ran out by `now`: call it before each message
 *   and from a clock.
 *
 * The rules behind the timers are in docs/game-rules.md: rest after a return §2.7, the silent
 * penalty and fake entries §3.4, the freeze and 🔥 §6.
 */
import { type BotMessage } from '#src/game/bot-message.ts';
import { CONQUISTER, type GameEvent } from '#src/game/events.ts';
import { emojiKind, type PlayerRef } from '#src/game/player.ts';
import { HenCount } from './hens.ts';

export type Location = 'home' | 'travelling' | 'conquister' | 'unknown';

export interface Trip {
  to: string;
  departedAt: number;
  /** When the outward leg ends, from the departure line. */
  arriveAt: number;
  /** When the player is due home; known once the arrival line gives it. */
  returnAt?: number;
  /** What the trip carries (`🧊`, `500 palle`), if anything. */
  load?: string;
  /**
   * The balls on the road with the player, out of every balance: a gift's, from departure to
   * delivery or back home, and a theft's loot, from the theft to home.
   */
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
   * When the bot last stated the balance whole (a leaderboard, a profile, a refusal that names it, a
   * theft of nothing): the 🐔 have paid in silence since (`hens`).
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
  /** The penalty after a failed entry ends (an entry before it is fake). */
  penaltyUntil?: number;
  frozenUntil?: number;
  /**
   * The 🧊 the player holds, in the house or carried, as far as the bot has shown: those of the last
   * `/house` and those carried, copies bought or carried off with 🏴‍☠️, less those that froze
   * someone; never fewer than the carried emoji list.
   */
  ice?: number;
  /**
   * The chance, in %, that the next attempt pops the player's 🎈, as the bot last stated it after
   * a resist, and 25 after a pop (rules §3.3). One counter per player: which of two 🎈 rolled is
   * not shown.
   */
  balloonChance?: number;
  /**
   * The house's slots as the player's last /house showed them, empty ones null, kept up to date
   * with what the log shows leaving or entering it: an emoji a 🏴‍☠️ carried off, a `/store` or
   * `/take`, a purchase. Forgotten when something changed it that the log does not name (a 💣
   * there, a gift), so that it is read again.
   */
  house?: (string | null)[];
  /** When that /house was read. */
  houseAt?: number;
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
  | 'incomingGift'
  | 'tripDreamt'
  | 'returnMissed'
  | 'restOver'
  | 'penaltyOver'
  | 'frozen'
  | 'freezeEnded'
  | 'holderChanged'
  | 'fakeEntry'
  | 'bounced'
  | 'saltPaid'
  | 'unknownLine';

export interface Notice {
  kind: NoticeKind;
  /** When it happened, or when it will (an incoming raid's arrival). */
  at: number;
  /** The player it is about: the raided, the frozen, the new holder, … */
  player: string;
  /** Who caused it, when someone else did (the raider, the thrower). */
  by?: string;
  detail?: string;
}

export interface GameStateOptions {
  /** Rest after a return before leaving again (rules §2.7: 60–120 s). */
  restS?: number;
  /** The penalty after a failed entry, when the bot does not say (rules §3.4). */
  penaltyS?: number;
  /**
   * How long after a trip's expected arrival a missing arrival line means a dream, and after its
   * expected return a missing return line means the player is home all the same.
   */
  dreamMarginS?: number;
}

/** The base price of an emoji, and the escalation per copy in the game (rules §5.2). */
export const icePrice = (copies: number): number => Math.floor(1000 * 1.5 ** copies);

/** The price of `emoji` with `copies` in the game: 🎈 is always 1000, ☢️ 1,000,000 (rules §5.2). */
export function emojiPrice(emoji: string, copies: number): number {
  if (emoji === '🎈') return 1000;
  if (emoji.startsWith('☢')) return 1_000_000;
  return icePrice(copies);
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

/** The copies in the game that a price paid or asked shows. */
const copiesAt = (price: number): number => Math.round(Math.log(price / 1000) / Math.log(1.5));

const SECOND = 1000;

export class GameState {
  readonly players = new Map<string, PlayerState>();
  holder: { name: string; since: number } | undefined;
  /**
   * The copies of each emoji in the game, as last learned from the bot (purchases and their
   * prices, refusals that state the count) and kept as copies are thrown, destroyed or eaten. Keyed
   * by the emoji exactly as written: ⚡ and ⚡️ have separate counters (rules §5.2).
   */
  readonly copies = new Map<string, { n: number; at: number }>();
  private readonly henCount = new HenCount();
  private readonly restMs: number;
  private readonly penaltyMs: number;
  private readonly dreamMarginMs: number;

  constructor(options: GameStateOptions = {}) {
    this.restMs = (options.restS ?? 90) * SECOND;
    this.penaltyMs = (options.penaltyS ?? 300) * SECOND;
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

  /** 🧊 copies in the game, if known. */
  get iceCopies(): { n: number; at: number } | undefined {
    return this.copies.get('🧊');
  }

  set iceCopies(value: { n: number; at: number } | undefined) {
    if (value === undefined) this.copies.delete('🧊');
    else this.copies.set('🧊', value);
  }

  /** The price of `emoji` now, if its count is known (🎈 and ☢️ always are). */
  price(emoji: string): number | undefined {
    if (emoji === '🎈' || emoji.startsWith('☢')) return emojiPrice(emoji, 0);
    const c = this.copies.get(emoji);
    return c === undefined ? undefined : emojiPrice(emoji, c.n);
  }

  /** The 🧊 price now, if the count is known. */
  icePrice(): number | undefined {
    return this.price('🧊');
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
      if (p.penaltyUntil !== undefined && now >= p.penaltyUntil) {
        out.push({ kind: 'penaltyOver', at: p.penaltyUntil, player: p.name });
        delete p.penaltyUntil;
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
    const ousters = new Set(
      message.events.flatMap((e) => (e.kind === 'ousted' ? [e.player.name] : []))
    );
    for (const e of message.events) {
      for (const name of e.telegram ?? []) this.player(name).telegram = true;
      if (e.kind === 'refused') {
        this.unknownName(e.reason);
        if (e.have !== undefined) this.readBalance(e.player.name, e.have, t);
      }
      for (const ref of refs(e)) {
        if (ref.carried !== undefined) this.carry(ref.name, ref.carried);
        if (ref.name !== CONQUISTER) this.player(ref.name).seenAt = t;
      }
      this.event(e, t, ousters, out);
      this.countCopies(e, t);
      if (e.kind === 'pirate') {
        // The 🏴‍☠️ takes the emoji from the house of the theft's victim, in the same message, onto
        // the raider's carried slots.
        const theft = message.events.find((x) => x.kind === 'theft');
        if (theft !== undefined) this.leaveHouse(theft.victim.name, e.emoji);
        if (emojiKind(e.emoji) === '🧊') {
          if (e.player !== undefined) this.addIce(e.player.name, 1);
          if (theft !== undefined) this.addIce(theft.victim.name, -1);
        }
        if (e.player !== undefined && e.carried !== undefined) this.carry(e.player.name, e.carried);
      }
    }
    this.capBelowLeaderboard(message.events, t);
    this.henCount.apply(message.events);
    for (const [name, hens] of this.henCount.entries()) this.player(name).hens = hens;
    return out;
  }

  /**
   * A leaderboard, ranks 1 to n in order of balance, has set the balances of its players: anyone
   * else holds no more than its last row, so a balance known above that, gone stale, comes down to
   * it. Rows missing in the middle prove nothing about a player left out.
   */
  private capBelowLeaderboard(events: readonly GameEvent[], t: number): void {
    const rows = events.flatMap((e) => (e.kind === 'leaderboardRow' ? [e] : []));
    const last = rows.at(-1);
    if (last === undefined || rows.some((r, i) => r.rank !== i + 1)) return;
    const listed = new Set(rows.map((r) => r.player.name));
    for (const p of this.players.values())
      if (!listed.has(p.name) && p.balance !== undefined && p.balance.balls > last.balls)
        p.balance = { balls: last.balls, at: t };
  }

  private event(e: GameEvent, t: number, ousters: Set<string>, out: Notice[]): void {
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
      case 'balloonPopped':
        this.player(e.holder.name).balloonChance = 25;
        return;
      case 'depart': {
        const p = this.player(e.player.name);
        const trip: Trip = {
          to: e.to.name,
          departedAt: t,
          arriveAt: t + e.seconds * SECOND,
          arrived: false,
        };
        if (e.load !== undefined) trip.load = e.load;
        // A gift of balls leaves the giver at departure (rules §1, /give) and reaches the
        // recipient on delivery (`giftDelivered`), or comes back with the giver if turned back
        // (`returnHome`, "con le tue N palle ancora in tasca").
        const given = e.gift ? /^(\d+) palle$/u.exec(e.load ?? '') : null;
        if (given !== null) {
          this.addBalance(p.name, -Number(given[1]), t);
          trip.carrying = Number(given[1]);
        } else if (e.load !== undefined) this.offPlayer(p.name, e.load);
        p.trip = trip;
        p.tripS = { ...p.tripS, [e.to.name]: e.seconds };
        p.location = 'travelling';
        delete p.restUntil;
        const notice: Notice = {
          kind: e.load === undefined ? 'incomingRaid' : e.gift ? 'incomingGift' : 'incomingThrow',
          at: trip.arriveAt,
          player: e.to.name,
          by: p.name,
        };
        if (e.load !== undefined) notice.detail = e.load;
        out.push(notice);
        return;
      }
      case 'giftDelivered':
        if (e.balls !== undefined) this.addBalance(e.to.name, e.balls, t);
        if (e.emoji !== undefined) delete this.player(e.to.name).house;
        this.arrived(e.player.name, t, e.seconds);
        delete this.player(e.player.name).trip?.carrying;
        return;
      case 'bombAtHome':
        // What it destroyed may have been in the house: read it again.
        if (e.destroyed !== undefined) delete this.player(e.victim.name).house;
        this.arrived(e.player.name, t, e.seconds);
        return;
      case 'dog':
      case 'bombDefective':
      case 'throwUndelivered':
        this.arrived(e.player.name, t, e.seconds);
        return;
      case 'throwDelivered':
        if (!e.atHolder) this.arrived(e.player.name, t);
        return;
      case 'freezeDelivered': {
        // A throw at the holder is instant: no trip to end.
        if (!e.atHolder) this.arrived(e.player.name, t);
        const target = this.player(e.target.name);
        const fire = (target.carried ?? []).filter(
          (c) => c !== null && emojiKind(c) === '🔥'
        ).length;
        // The line states the real length since 23 Oct; before, the base, less 10% per 🔥.
        const share = e.actual ? 1 : Math.max(0, 1 - 0.1 * fire);
        target.frozenUntil = t + e.minutes * 60 * SECOND * share;
        out.push({ kind: 'frozen', at: t, player: target.name, by: e.player.name });
        this.addIce(e.player.name, -1);
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
      case 'entered':
        this.entered(e.player.name, t, ousters, out);
        return;
      case 'ousted': {
        const ousted = this.player(e.holder.name);
        ousted.location = 'home';
        return;
      }
      case 'holderIs':
        this.setHolder(e.player.name, t, out);
        return;
      case 'leftConquister': {
        const p = this.player(e.player.name);
        p.location = 'home';
        if (this.holder?.name === p.name) this.holder = undefined;
        this.addBalance(p.name, e.balls, t);
        return;
      }
      case 'entryHeld':
        this.player(e.holder.name).balloonChance = e.nextChance;
        this.player(e.player.name).penaltyUntil =
          t + (e.penaltyS === undefined ? this.penaltyMs : e.penaltyS * SECOND);
        return;
      case 'holderPaid':
        this.addBalance(e.player.name, e.balls, t);
        return;
      case 'leaderboardRow':
        this.readBalance(e.player.name, e.balls, t);
        return;
      case 'profile': {
        const p = this.player(e.player.name);
        this.readBalance(p.name, e.balls, t);
        if (e.carried !== undefined) this.carry(p.name, e.carried);
        if (e.at?.kind === 'home') p.location = 'home';
        if (e.at?.kind === 'conquister') this.setHolder(p.name, t, out);
        return;
      }
      case 'house': {
        // The 🧊 in the house, and those carried as the last profile or move showed them.
        const p = this.player(e.player.name);
        p.house = e.slots;
        p.houseAt = t;
        const ice = (slots: readonly (string | null)[] | undefined): number =>
          (slots ?? []).filter((c) => c !== null && emojiKind(c) === '🧊').length;
        p.ice = ice(e.slots) + ice(p.carried);
        return;
      }
      case 'tooPoor':
        // A refused purchase states the balance ("ne hai M"): balls spent where the log cannot see
        // (another chat, a gift) would otherwise leave it too high, and the purchase retried.
        if (e.have !== undefined) this.readBalance(e.player.name, e.have, t);
        return;
      case 'bought': {
        this.addBalance(e.player.name, -e.balls, t);
        if (emojiKind(e.emoji) === '🧊') this.addIce(e.player.name, 1);
        // Into the house slot the bot names, else the house as last read is out of date.
        const p = this.player(e.player.name);
        if (e.carried) return;
        if (p.house !== undefined && e.slot !== undefined && e.slot <= p.house.length)
          p.house[e.slot - 1] = e.emoji;
        else delete p.house;
        return;
      }
      case 'moved':
        // `/take` empties the emoji's house slot, or fills it with the one it swaps; `/store` takes
        // a free one, which the bot does not name.
        if (e.carried) {
          this.leaveHouse(e.player.name, e.emoji);
          if (e.swapped !== undefined) this.enterHouse(e.player.name, e.swapped);
        } else this.enterHouse(e.player.name, e.emoji);
        return;
      case 'houseFull':
        // The house as last read had room: it is out of date, and to be read again.
        delete this.player(e.player.name).house;
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
      case 'burned': {
        const burnt = /^(\d+) palle$/u.exec(e.what);
        if (burnt !== null) this.addBalance(e.player.name, -Number(burnt[1]), t);
        else {
          // From the house or the carried slots, the line does not say: both to be read again.
          const p = this.player(e.player.name);
          delete p.house;
          if ((p.carried ?? []).some((c) => c !== null && emojiKind(c) === emojiKind(e.what)))
            delete p.carried;
        }
        return;
      }
      case 'nuke':
        // On a home, its player starts again from nothing; on the place, everyone (rules §5.3).
        if (e.target !== undefined) this.readBalance(e.target.name, 0, t);
        else for (const p of this.players.values()) this.readBalance(p.name, 0, t);
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

  /** An entry; fake when the place had another holder and this message ousts nobody (rules §3.4). */
  private entered(name: string, t: number, ousters: Set<string>, out: Notice[]): void {
    if (this.holder !== undefined && this.holder.name !== name && !ousters.has(name)) {
      out.push({ kind: 'fakeEntry', at: t, player: name, detail: this.holder.name });
      return;
    }
    this.setHolder(name, t, out);
  }

  private setHolder(name: string, t: number, out: Notice[]): void {
    if (this.holder?.name === name) return;
    if (this.holder !== undefined) this.player(this.holder.name).location = 'home';
    this.holder = { name, since: t };
    this.player(name).location = 'conquister';
    out.push({ kind: 'holderChanged', at: t, player: name });
  }

  /** A trip's arrival: the trip was real; the return leg takes `seconds` if given. */
  private arrived(name: string, t: number, seconds?: number): void {
    const p = this.player(name);
    if (p.trip === undefined) p.trip = { to: '', departedAt: t, arriveAt: t, arrived: true };
    p.trip.arrived = true;
    if (seconds !== undefined) p.trip.returnAt = t + seconds * SECOND;
  }

  /** Keeps the count of copies in the game: what a purchase or refusal shows, less what is used up. */
  private countCopies(e: GameEvent, t: number): void {
    const less = (emoji: string | undefined): void => {
      const c = emoji === undefined ? undefined : this.copies.get(emoji);
      if (emoji !== undefined && c !== undefined)
        this.copies.set(emoji, { n: Math.max(0, c.n - 1), at: t });
    };
    switch (e.kind) {
      case 'bought':
        if (e.emoji !== '🎈')
          this.copies.set(e.emoji, { n: (e.copiesBefore ?? copiesAt(e.balls)) + 1, at: t });
        return;
      case 'tooPoor':
        if (e.emoji !== '🎈') this.copies.set(e.emoji, { n: e.copies ?? copiesAt(e.price), at: t });
        return;
      case 'freezeDelivered':
        less('🧊');
        return;
      case 'throwDelivered':
        less(e.emoji);
        return;
      case 'bombAtHolder':
      case 'bombAtHome':
      case 'bombDefective':
        less('💣');
        less(e.destroyed);
        return;
      case 'dinosaur':
        less(e.eaten);
        return;
      case 'burned':
        less(e.what);
        return;
      default:
        return;
    }
  }

  /**
   * The carried emoji as listed next to the name: the 🧊 among them are held, so the count is at
   * least theirs, even before a `/house` shows the rest (after a restart, say).
   */
  private carry(name: string, carried: (string | null)[]): void {
    const p = this.player(name);
    p.carried = carried;
    const ice = carried.filter((c) => c !== null && emojiKind(c) === '🧊').length;
    if (ice > (p.ice ?? 0)) p.ice = ice;
  }

  /**
   * An emoji thrown or given leaves with its player: from the carried slots if there, else from
   * the house, from which the bot takes it (rules §6).
   */
  private offPlayer(name: string, emoji: string): void {
    const p = this.player(name);
    const i = (p.carried ?? []).findIndex((c) => c !== null && emojiKind(c) === emojiKind(emoji));
    if (p.carried !== undefined && i >= 0) p.carried[i] = null;
    else this.leaveHouse(name, emoji);
  }

  /** `emoji` left the house as last read: its slot is empty, or the house is unknown again. */
  private leaveHouse(name: string, emoji: string): void {
    const p = this.player(name);
    const i = (p.house ?? []).findIndex((c) => c !== null && emojiKind(c) === emojiKind(emoji));
    if (p.house !== undefined && i >= 0) p.house[i] = null;
    else delete p.house;
  }

  /** `emoji` went into the house as last read, in a slot the bot did not name: the first free one. */
  private enterHouse(name: string, emoji: string): void {
    const p = this.player(name);
    const i = (p.house ?? []).indexOf(null);
    if (p.house !== undefined && i >= 0) p.house[i] = emoji;
    else delete p.house;
  }

  private addIce(name: string, delta: number): void {
    const p = this.player(name);
    p.ice = Math.max(0, (p.ice ?? 0) + delta);
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
  for (const k of ['player', 'to', 'victim', 'holder', 'target', 'thrower'] as const) {
    const v = (e as Partial<Record<typeof k, unknown>>)[k];
    if (typeof v === 'object' && v !== null && 'name' in v) out.push(v as PlayerRef);
  }
  return out;
}
