/**
 * NorelecBot's game, simulated: the true state of every player and of
 * @TheConquister37, the commands players send, and the bot's replies in its own wording
 * (docs/bot-protocol.md), so that the client reads them exactly as it reads the real bot. The rules
 * are those of docs/game-rules.md; the points it leaves open are `RuleOptions`, with a default.
 *
 * Time is given, never read: `command(time, player, text)` answers a command, `advance(time)` runs
 * what falls due (arrivals, returns, revealed dreams), and `nextAt()` says when the next thing
 * does. Both return the bot's messages, each with its time. Randomness comes from a seeded `Rng`.
 *
 * Its wording comes from the game's grammar, the library the parser reads with
 * (modules/norelec/src/game/: the pieces in wording.ts, the names in events.ts; P15), never from
 * the live `norelec` plugin.
 */
import { Rng } from '@megabottron1999/core/rng.ts';
import { CONQUISTER } from '#src/game/events.ts';
import { balls, duration, multiplier, named } from '#src/game/wording.ts';

const C = `@${CONQUISTER}`;
const S = 1000;
const CARRIED = 5;
const HOUSE = 10;

/** Emoji with a carried power: bought onto you when a slot is free (rules §5.3). */
const CARRIED_POWERS = ['🎈', '🚀', '⚡', '🦞', '🥷', '🏴‍☠️', '🔥', '⏳'];
/** Emoji that are thrown (rules §1.1). */
const THROWN = ['💣', '💩', '🇷🇺', '🇮🇱', '🧊', '💦', '☢️'];
/** Emoji with a power, which a 💣 can destroy. */
const POWERED = [...CARRIED_POWERS, '🥺', '🐶', '📮', '🔊', '🐔', '🦖', '🧂', ...THROWN];

/** A player as the bot writes a home or a target: `@Name` for a Telegram account. */
const handle = (p: { name: string; telegram: boolean }): string =>
  p.telegram ? `@${p.name}` : p.name;

/** An emoji's kind, for effects: no variation selector, no skin tone (rules §5.2). */
export const kind = (e: string): string => e.replace(/[︎️]|\p{Emoji_Modifier}/gu, '');

/** The points docs/game-rules.md leaves open, and the rule changes the arena can try. */
export interface RuleOptions {
  /** Base chance that a departure is a dream, and the tiredness curve after a return (§2.7). */
  dreamBase: number;
  dreamUnder10s: number;
  dreamUnder60s: number;
  /** The chance that a dreamt trip is ever revealed, and when after the arrival it would be. */
  dreamRevealed: number;
  dreamRevealS: [number, number];
  /** Balls found on the road (§2.6). */
  foundBalls: number;
  foundBallsRange: [number, number];
  /** The penalty after a resisted entry, and the lock that follows it (§3.4, §3.5). */
  penaltyS: number;
  lockS: [number, number];
  /** The freeze (§6), less 10% per 🔥 the target carries. */
  freezeMin: number;
  /** Whether a 🧊 a 📮 sends back freezes the thrower (unknown, §6). */
  bounceFreezes: boolean;
  /** Whether a throw at the holder needs a free carried slot, as a throw at a home does. */
  holderThrowNeedsSlot: boolean;
  /** The share of bombs that explode in the thrower's hand (§5.3). */
  defectiveBomb: number;
  /** Balls per second of unboosted distance (§4.1). */
  lootPerS: number;
}

export const DEFAULT_RULES: RuleOptions = {
  dreamBase: 0.066,
  dreamUnder10s: 0.91,
  dreamUnder60s: 0.48,
  dreamRevealed: 0.5,
  dreamRevealS: [21, 600],
  foundBalls: 0.033,
  foundBallsRange: [102, 498],
  penaltyS: 300,
  lockS: [45, 70],
  freezeMin: 30,
  bounceFreezes: false,
  holderThrowNeedsSlot: true,
  defectiveBomb: 0.1,
  lootPerS: 7,
};

export interface PlayerSetup {
  name: string;
  /** The home's position on the map, in seconds of unboosted travel (rules §2.2). */
  x: number;
  y: number;
  balls: number;
  carried?: string[];
  house?: string[];
  /** A Telegram account: commands name it `@Name`, and the bot writes it so as a home or a target. */
  telegram?: boolean;
}

export interface ArenaSetup {
  seed: number;
  /** When the game starts, in milliseconds. */
  start: number;
  players: PlayerSetup[];
  /** Who holds @TheConquister37 at the start, if anyone, and since when. */
  holder?: { name: string; since: number };
}

interface Trip {
  to: string;
  /** An emoji carried to throw, if any. */
  load?: string;
  departedAt: number;
  arriveAt: number;
  returnAt?: number;
  /** The balls it brings home. */
  loot: number;
  /** Turned back with `!back`: no arrival. */
  back: boolean;
}

/** One player as the game knows them: the truth the client's state is checked against. */
export interface Truth {
  name: string;
  telegram: boolean;
  x: number;
  y: number;
  balls: number;
  carried: (string | null)[];
  house: (string | null)[];
  at: 'home' | 'conquister' | 'trip';
  trip: Trip | undefined;
  lastReturnAt: number;
  frozenUntil: number;
  penaltyUntil: number;
  /** The chance, in %, that the next attempt pops this player's 🎈 (§3.3). */
  balloon: number;
  /** A fake entry during a penalty, to be revealed in the next entry (§3.6). */
  fakeEntry: boolean;
  /** When each raider last reached this house, for 🧂. */
  lastRaidBy: Map<string, number>;
  /** Ball fractions from 🐔 not yet paid, and when they were counted. */
  henAt: number;
  henRest: number;
}

export interface EngineMessage {
  time: number;
  text: string;
}

interface Due {
  at: number;
  seq: number;
  run: () => string[];
}

export class Engine {
  readonly rules: RuleOptions;
  private readonly rng: Rng;
  private readonly players = new Map<string, Truth>();
  private holderState: { name: string; since: number } | undefined;
  private lockedUntil = 0;
  private now = 0;
  private due: Due[] = [];
  private seq = 0;

  constructor(setup: ArenaSetup, rules: Partial<RuleOptions> = {}) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.rng = new Rng(setup.seed);
    for (const p of setup.players) {
      const carried: (string | null)[] = [...(p.carried ?? [])];
      const house: (string | null)[] = [...(p.house ?? [])];
      while (carried.length < CARRIED) carried.push(null);
      while (house.length < HOUSE) house.push(null);
      this.players.set(p.name, {
        name: p.name,
        telegram: p.telegram === true,
        x: p.x,
        y: p.y,
        balls: p.balls,
        carried,
        house,
        at: 'home',
        trip: undefined,
        lastReturnAt: Number.NEGATIVE_INFINITY,
        frozenUntil: 0,
        penaltyUntil: 0,
        balloon: 25,
        fakeEntry: false,
        lastRaidBy: new Map(),
        henAt: setup.start,
        henRest: 0,
      });
    }
    this.now = setup.start;
    if (setup.holder !== undefined) {
      this.holderState = { ...setup.holder };
      this.truth(setup.holder.name).at = 'conquister';
    }
  }

  /** The player's true state. */
  player(name: string): Readonly<Truth> {
    return this.truth(name);
  }

  get holder(): Readonly<{ name: string; since: number }> | undefined {
    return this.holderState;
  }

  /** The names of every player. */
  get names(): string[] {
    return [...this.players.keys()];
  }

  /** The copies of `emoji` in the game, exactly as written: carried, in houses, on the road. */
  copies(emoji: string): number {
    let n = 0;
    for (const p of this.players.values())
      for (const e of [...p.carried, ...p.house]) if (e === emoji) n++;
    return n;
  }

  /** The price of `emoji` now (rules §5.2). */
  price(emoji: string): number {
    if (emoji === '🎈') return 1000;
    if (kind(emoji) === '☢') return 1_000_000;
    return Math.floor(1000 * 1.5 ** this.copies(emoji));
  }

  /** The travel time between two homes, in seconds, before rockets. */
  distance(a: string, b: string): number {
    const p = this.truth(a);
    const q = this.truth(b);
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  /** When the next thing falls due, if anything does. */
  nextAt(): number | undefined {
    return this.due[0]?.at;
  }

  /** Runs everything due up to `time`, in order; the messages it produces. */
  advance(time: number): EngineMessage[] {
    const out: EngineMessage[] = [];
    while (this.due[0] !== undefined && this.due[0].at <= time) {
      const d = this.due.shift() as Due;
      this.now = d.at;
      const lines = d.run();
      if (lines.length > 0) out.push({ time: d.at, text: lines.join('\n') });
    }
    this.now = Math.max(this.now, time);
    return out;
  }

  /**
   * A command from `player` at `time` (IRC `!raid X` or Telegram `/raid X`): what falls due first,
   * then the bot's reply, if it gives one.
   */
  command(time: number, player: string, text: string): EngineMessage[] {
    const out = this.advance(time);
    const p = this.players.get(player);
    if (p === undefined) return out;
    this.settleHens(p);
    const [verb = '', ...args] = text.trim().replace(/^[!/]/u, '').split(/\s+/u);
    const lines = this.dispatch(p, verb.toLowerCase(), args, text.trim());
    if (lines.length > 0) out.push({ time, text: lines.join('\n') });
    return out;
  }

  private dispatch(p: Truth, verb: string, args: string[], text: string): string[] {
    if (/^We @?TheConquister37$/iu.test(text)) return this.enter(p);
    switch (verb) {
      case 'raid':
        return this.raid(p, args[0]);
      case 'throw':
        return this.throw(p, args[0], args[1]);
      case 'buy':
        return this.buy(p, args[0], args[1]);
      case 'take':
        return this.move(p, args[0], true, args[1]);
      case 'store':
        return this.move(p, args[0], false);
      case 'back':
        return this.back(p);
      case 'avventura':
        return this.enter(p);
      case 'profile':
      case 'profilo':
        return this.profile(args[0] === undefined ? p : this.named(args[0]));
      case 'house':
      case 'casa':
        return this.house(args[0] === undefined ? p : this.named(args[0]));
      case 'leaderboard':
      case 'classifica':
        return this.leaderboard();
      default:
        return [];
    }
  }

  // Travel

  private raid(p: Truth, target: string | undefined): string[] {
    const v = target === undefined ? undefined : this.named(target);
    const blocked = this.cannotLeave(p);
    if (blocked !== undefined) return blocked;
    if (v === undefined) return [`${p.name} non conosco nessun giocatore di nome ${target ?? ''}`];
    if (v === p) return [`${p.name} non puoi razziare te stesso.`];
    return this.depart(p, v, undefined);
  }

  /** Why `p` cannot set off now, as the bot says it, or undefined. */
  private cannotLeave(p: Truth): string[] | undefined {
    if (p.at === 'conquister')
      return [`${p.name} razzie e consegne partono da casa tua: esci prima da ${C} con !back.`];
    if (p.trip !== undefined)
      return [`${p.name} sei già in viaggio, torni tra ${duration(this.homeAt(p) - this.now)}.`];
    if (p.frozenUntil > this.now) return [this.frozenLine(p)];
    return undefined;
  }

  private frozenLine(p: Truth): string {
    return `${p.name} una 🧊 ti ha congelato: non puoi entrare in ${C} né partire per altri ${duration(p.frozenUntil - this.now)}.`;
  }

  private depart(p: Truth, v: Truth, load: string | undefined): string[] {
    const rockets = this.count(p.carried, '🚀');
    // The bot rounds down; the small term keeps 110 / 1.1 at 100.
    const oneWay = Math.floor(this.distance(p.name, v.name) / (1 + 0.1 * rockets) + 1e-9) * S;
    const sinceReturn = this.now - p.lastReturnAt;
    const dreamP =
      sinceReturn < 10 * S
        ? this.rules.dreamUnder10s
        : sinceReturn < 60 * S
          ? this.rules.dreamUnder60s
          : this.rules.dreamBase;
    const lines = [
      rockets > 0
        ? `🚀 ${p.name} parti per ${v.name}${load === undefined ? '' : ` con ${load} da consegnare`}: arrivi tra ${duration(oneWay)}. ${p.name} resta scoperto.`
        : `${p.name} parti per ${v.name}${load === undefined ? '' : ` con ${load} da consegnare`}: arrivi tra ${duration(oneWay)}. Casa tua resta scoperta.`,
    ];
    if (this.rng.chance(dreamP)) {
      // A dream: the player never leaves, and the bot may say so later (rules §2.6).
      if (this.rng.chance(this.rules.dreamRevealed)) {
        const [lo, hi] = this.rules.dreamRevealS;
        this.schedule(this.now + oneWay + this.rng.int(lo, hi) * S, () => [
          `${named(p.name, p.carried)} eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!`,
        ]);
      }
      return lines;
    }
    if (load !== undefined) this.takeOut(p, load);
    const trip: Trip = {
      to: v.name,
      departedAt: this.now,
      arriveAt: this.now + oneWay,
      loot: 0,
      back: false,
    };
    if (load !== undefined) trip.load = load;
    p.trip = trip;
    p.at = 'trip';
    if (this.rng.chance(this.rules.foundBalls)) {
      const found = this.rng.int(...this.rules.foundBallsRange);
      p.balls += found;
      lines.push(`Lungo la via trovi ${found} palle!`);
    }
    this.schedule(trip.arriveAt, () => this.arrive(p, v, trip));
    return lines;
  }

  /** Moves a load out of the house onto the player, if it is not carried already. */
  private takeOut(p: Truth, emoji: string): void {
    if (p.carried.includes(emoji)) return;
    const i = p.house.indexOf(emoji);
    const free = p.carried.indexOf(null);
    if (i >= 0 && free >= 0) {
      p.house[i] = null;
      p.carried[free] = emoji;
    }
  }

  private arrive(p: Truth, v: Truth, trip: Trip): string[] {
    if (p.trip !== trip || trip.back) return [];
    const oneWay = trip.arriveAt - trip.departedAt;
    trip.returnAt = this.now + oneWay;
    this.schedule(trip.returnAt, () => this.returnHome(p, trip));
    const back = `Torni in ${handle(p)} tra ${duration(oneWay)}.`;
    if (trip.load !== undefined) return this.deliver(p, v, trip.load, back);
    return this.rob(p, v, back, trip);
  }

  /** The checks of a raid on arrival, in the order of rules §4.2. */
  private rob(p: Truth, v: Truth, back: string, trip: Trip): string[] {
    const lines: string[] = [];
    this.settleHens(v);
    const away = v.at !== 'home' ? ', che non era a casa' : '';
    const frozen = v.frozenUntil > this.now;
    const ninjas = this.count(p.carried, '🥷');
    const alarms = this.count(v.house, '🔊');
    const sneaked = this.rng.chance(Math.max(0, 0.1 * ninjas - 0.1 * alarms));
    if (!sneaked && ninjas > 0 && alarms > 0)
      lines.push(`L'allarme di ${v.name} ti scopre: devi vedertela con le sue difese.`);
    const balloon =
      !frozen &&
      ((v.at === 'home' && this.count(v.carried, '🎈') > 0) || this.count(v.house, '🎈') > 0);
    let how: 'sneaked' | 'popped' | 'unguarded' = sneaked ? 'sneaked' : 'unguarded';
    if (!sneaked && balloon) {
      if (this.rng.chance(v.balloon / 100)) {
        how = 'popped';
        v.balloon = 25;
      } else {
        v.balloon = Math.min(100, v.balloon + 25);
        lines.push(
          `${named(p.name, p.carried)} il palloncino di ${named(v.name, v.carried)} ha resistito. Ora il palloncino ha il ${v.balloon}% di probabilità di essere bucato. ${back}`
        );
        return this.dinosaur(p, v, lines);
      }
    }
    if (!sneaked && this.rng.chance(0.1 * this.count(v.house, '🐶'))) {
      lines.push(
        `${named(p.name, p.carried)} il cane di ${named(v.name, v.carried)} ti ha intercettato: niente bottino. ${back}`
      );
      return this.dinosaur(p, v, lines);
    }
    const full = Math.min(Math.floor(this.rules.lootPerS * this.distance(p.name, v.name)), v.balls);
    const pity = Math.min(10, this.count(v.house, '🥺'));
    const loot = Math.floor((full * (10 - pity)) / 10);
    v.balls -= loot;
    trip.loot = loot;
    const who = named(p.name, p.carried);
    const victim = named(v.name, v.carried);
    lines.push(
      how === 'popped'
        ? `${who} hai bucato il palloncino di ${victim} e rubato ${balls(loot)}${away}! ${back}`
        : how === 'sneaked'
          ? `${who} scivoli di nascosto oltre le difese di ${victim} e rubi ${balls(loot)}${away}! ${back}`
          : `${who} hai rubato ${balls(loot)} a ${victim}${away}! ${back}`
    );
    if (pity > 0)
      lines.push(
        `${v.name} ti ha impietosito: gli rubi ${balls(loot)} invece di ${balls(full)} (${pity * 10}% in meno).`
      );
    this.salt(p, v, lines);
    this.pirate(p, v, lines);
    return this.dinosaur(p, v, lines);
  }

  private salt(p: Truth, v: Truth, lines: string[]): void {
    const last = v.lastRaidBy.get(p.name);
    v.lastRaidBy.set(p.name, this.now);
    const salt = this.count(v.house, '🧂');
    if (last === undefined || this.now - last > 300 * S || salt === 0) return;
    const pay = Math.floor((p.balls * Math.min(10, salt)) / 10);
    p.balls -= pay;
    v.balls += pay;
    v.lastRaidBy.delete(p.name);
    lines.push(
      `Ci torni troppo presto: il 🧂 di ${v.name} ti costa ${pay} palle, che vanno a lui.`
    );
  }

  private pirate(p: Truth, v: Truth, lines: string[]): void {
    const free = p.carried.indexOf(null);
    if (free < 0 || !this.rng.chance(0.1 * this.count(p.carried, '🏴‍☠️'))) return;
    const slots = v.house.flatMap((e, i) => (e !== null && e !== '🎈' ? [i] : []));
    if (slots.length === 0) return;
    const i = this.rng.pick(slots);
    const e = v.house[i] as string;
    v.house[i] = null;
    p.carried[free] = e;
    lines.push(
      `Arrembaggio: ti porti via anche ${e} da casa sua: ora hai con te ${p.carried.filter((c) => c !== null).join('')}.`
    );
  }

  private dinosaur(p: Truth, v: Truth, lines: string[]): string[] {
    if (!this.rng.chance(0.1 * this.count(v.house, '🦖'))) return lines;
    const slots = p.carried.flatMap((e, i) => (e !== null && e !== '🎈' ? [i] : []));
    if (slots.length === 0) return lines;
    const i = this.rng.pick(slots);
    lines.push(`Il 🦖 di ${v.name} ti mangia ${p.carried[i] as string}.`);
    p.carried[i] = null;
    return lines;
  }

  private deliver(p: Truth, v: Truth, load: string, back: string): string[] {
    const who = named(p.name, p.carried);
    const slot = p.carried.indexOf(load);
    if (slot >= 0) p.carried[slot] = null;
    if (this.rng.chance(0.1 * this.count(v.house, '📮'))) {
      const free = p.house.indexOf(null);
      if (free >= 0) p.house[free] = load;
      if (load === '🧊' && this.rules.bounceFreezes) this.freeze(p);
      return [
        `La cassetta di ${v.name} rispedisce ${load} al mittente: ${p.name} se la ritrova in casa. ${back}`,
      ];
    }
    if (load === '🧊') {
      return [
        `${who} congeli ${v.name}: per ${this.freeze(v)} minuti non può partire e, se lo cacciano, non può rientrare. ${back}`,
      ];
    }
    if (load === '💣') return [this.bomb(p, v, back)];
    return [`${who} la tua ${load} è arrivata a casa di ${v.name}: tra 9 ore si vedrà. ${back}`];
  }

  /** Freezes `v`: 30 minutes less 10% per 🔥; the minutes, as the bot states them since 23 Oct. */
  private freeze(v: Truth): number {
    const fire = this.count(v.carried, '🔥');
    const ms = this.rules.freezeMin * 60 * S * Math.max(0, 1 - 0.1 * fire);
    v.frozenUntil = this.now + ms;
    return Math.round(ms / 60 / S);
  }

  private bomb(p: Truth, v: Truth, back: string): string {
    const slots = [
      ...v.house.flatMap((e, i) =>
        e !== null && POWERED.includes(kind(e)) && e !== '🎈' ? [i] : []
      ),
    ];
    const who = named(p.name, p.carried);
    if (slots.length === 0)
      return `${who} la tua bomba esplode in casa di ${v.name} ma non trova niente da portarsi via. ${back}`;
    const i = this.rng.pick(slots);
    const e = v.house[i] as string;
    v.house[i] = null;
    return `${who} la tua bomba esplode in casa di ${v.name} e si porta via ${e}! ${back}`;
  }

  private returnHome(p: Truth, trip: Trip): string[] {
    if (p.trip !== trip) return [];
    p.trip = undefined;
    p.at = 'home';
    p.balls += trip.loot;
    p.lastReturnAt = this.now;
    const who = named(p.name, p.carried);
    if (trip.loot === 0)
      return [
        this.rng.pick([
          `${who} sei tornato in ${handle(p)}.`,
          `${who} rientri in ${handle(p)} a mani vuote.`,
        ]),
      ];
    return [
      this.rng.pick([
        `${who} torni in ${handle(p)} con ${trip.loot} palle.`,
        `${who} rientri in ${handle(p)} portando ${trip.loot} palle.`,
        `${who} eccoti di nuovo in ${handle(p)}, con ${trip.loot} palle in più.`,
        `${who} ${handle(p)} ti riaccoglie: hai con te ${trip.loot} palle.`,
      ]),
    ];
  }

  /** When `p` is due home. */
  private homeAt(p: Truth): number {
    const t = p.trip;
    if (t === undefined) return this.now;
    return t.returnAt ?? t.arriveAt + (t.arriveAt - t.departedAt);
  }

  // Throws

  private throw(p: Truth, target: string | undefined, emoji: string | undefined): string[] {
    const name = (target ?? '').replace(/^@/u, '');
    if (emoji === undefined || target === undefined) return [`${p.name} una emoji per volta.`];
    const has = p.carried.includes(emoji) || p.house.includes(emoji);
    if (!has) return [`${p.name} non hai ${emoji}, né con te né in casa.`];
    const needsSlot = !p.carried.includes(emoji) && p.carried.indexOf(null) < 0;
    if (name === CONQUISTER) {
      if (p.at === 'trip') return this.cannotLeave(p) ?? [];
      if (p.frozenUntil > this.now) return [this.frozenLine(p)];
      if (needsSlot && this.rules.holderThrowNeedsSlot) return [this.slotsFull(p, emoji)];
      return this.throwAtHolder(p, emoji);
    }
    const blocked = this.cannotLeave(p);
    if (blocked !== undefined) return blocked;
    const v = this.named(target);
    if (v === undefined) return [`${p.name} non conosco nessun giocatore di nome ${target}`];
    if (needsSlot) return [this.slotsFull(p, emoji)];
    return this.depart(p, v, emoji);
  }

  private slotsFull(p: Truth, emoji: string): string {
    return `${p.name} hai già ${CARRIED} emoji con te: per portare ${emoji} serve un posto libero. Rimetti qualcosa in casa con !store <emoji>.`;
  }

  private throwAtHolder(p: Truth, emoji: string): string[] {
    const h = this.holderState === undefined ? undefined : this.truth(this.holderState.name);
    // The bot's reply to a throw at an empty place has not been seen: a refusal it is known to use.
    if (h === undefined) return [`${p.name} non conosco nessun giocatore di nome ${C}`];
    this.removeOne(p, emoji);
    const who = named(p.name, p.carried);
    if (emoji === '🧊') {
      return [
        `${who} congeli ${h.name} in ${C}: per ${this.freeze(h)} minuti non può partire e, se lo cacciano, non può rientrare.`,
      ];
    }
    if (emoji === '💣') {
      const slots = h.carried.flatMap((e, i) =>
        e !== null && e !== '🎈' && POWERED.includes(kind(e)) ? [i] : []
      );
      if (slots.length === 0)
        return [
          `${who} la tua bomba esplode addosso a ${named(h.name, h.carried)} in ${C} ma non trova niente da portarsi via.`,
        ];
      const i = this.rng.pick(slots);
      const e = h.carried[i] as string;
      h.carried[i] = null;
      return [
        `${who} la tua bomba esplode addosso a ${h.name} in ${C} e si porta via ${e}: ora ${h.name} ha con sé ${h.carried.filter((c) => c !== null).join('') || 'niente'}.`,
      ];
    }
    return [`${who} la tua ${emoji} è arrivata addosso a ${h.name} in ${C}: tra 9 ore si vedrà.`];
  }

  private removeOne(p: Truth, emoji: string): void {
    const c = p.carried.indexOf(emoji);
    if (c >= 0) {
      p.carried[c] = null;
      return;
    }
    const h = p.house.indexOf(emoji);
    if (h >= 0) p.house[h] = null;
  }

  // @TheConquister37

  private enter(p: Truth): string[] {
    if (p.at === 'conquister') return [`${p.name} sei già in ${C}!`];
    if (p.trip !== undefined)
      return [
        `${p.name} sei per strada: non puoi entrare in ${C} prima di tornare in ${p.name}, tra ${duration(this.homeAt(p) - this.now)}.`,
      ];
    if (p.frozenUntil > this.now) return [this.frozenLine(p)];
    if (this.now < this.lockedUntil)
      return [`${p.name} ${C} è chiuso: qualcuno ha appena provato a entrare. Riprova tra poco.`];
    const h = this.holderState === undefined ? undefined : this.truth(this.holderState.name);
    const who = named(p.name, p.carried);
    // The silent penalty: a fake success, revealed in the next real entry (rules §3.4, §3.6).
    if (this.now < p.penaltyUntil) {
      p.fakeEntry = true;
      return h === undefined
        ? [`${who} sei in ${C}!`]
        : [
            `${who} hai bucato il palloncino di ${named(h.name, h.carried)}!`,
            `${p.name} sei in ${C}!`,
          ];
    }
    const lines: string[] = [];
    if (h !== undefined) {
      const guarded = h.frozenUntil <= this.now && this.count(h.carried, '🎈') > 0;
      if (guarded) {
        if (this.rng.chance(0.1 * this.count(p.carried, '🥷'))) {
          lines.push(
            `${who} scivoli di nascosto oltre il palloncino di ${named(h.name, h.carried)}!`
          );
        } else if (this.rng.chance(h.balloon / 100)) {
          h.balloon = 25;
          lines.push(`${who} hai bucato il palloncino di ${named(h.name, h.carried)}!`);
        } else {
          h.balloon = Math.min(100, h.balloon + 25);
          p.penaltyUntil = this.now + this.rules.penaltyS * S;
          this.lockedUntil = this.now + this.rng.int(...this.rules.lockS) * S;
          return [
            `${who} il palloncino di ${named(h.name, h.carried)} ha resistito e prendi una penalità. Ora il palloncino ha il ${h.balloon}% di probabilità di essere bucato.`,
          ];
        }
      }
      lines.push(`${p.name} hai cacciato ${handle(h)} da ${C}.`, this.pay(h).line);
      h.at = 'home';
    }
    this.holderState = { name: p.name, since: this.now };
    p.at = 'conquister';
    lines.push(`${p.name} sei in ${C}!`);
    for (const q of this.players.values())
      if (q.fakeEntry) {
        q.fakeEntry = false;
        lines.push(
          `${q.name} eri così stanco che hai solo sognato di entrare in ${C}: non ti sei mai mosso da casa!`
        );
      }
    return lines;
  }

  /** Pays the holder what they made (1 ball a second, +10% per ⚡, rules §3.2), and says so. */
  private pay(h: Truth): { made: number; line: string } {
    const bolts = this.count(h.carried, '⚡');
    const since = this.holderState?.since ?? this.now;
    const made = Math.floor(((this.now - since) / S) * (1 + 0.1 * bolts));
    h.balls += made;
    this.holderState = undefined;
    const x = Math.round((1 + 0.1 * bolts) * 10) / 10;
    return {
      made,
      line:
        bolts > 0
          ? `${h.name} hai guadagnato ${balls(made)} col ⚡ x${x}!`
          : `${h.name} hai guadagnato ${balls(made)}!`,
    };
  }

  /** The holder goes home, paid (`!back`, or a purchase from inside, rules §1.2). */
  private leave(p: Truth): string {
    const { made } = this.pay(p);
    p.at = 'home';
    return `${p.name} torni da ${C} in ${p.name} con ${made} palle.`;
  }

  private back(p: Truth): string[] {
    if (p.at === 'conquister') return [this.leave(p)];
    const t = p.trip;
    if (t === undefined) return [`${p.name} sei già in ${p.name}!`];
    if (t.returnAt !== undefined)
      return [`${p.name} sei già in viaggio, torni tra ${duration(t.returnAt - this.now)}.`];
    // Turning back takes as long as the way already travelled (rules §1.1).
    t.back = true;
    const elapsed = this.now - t.departedAt;
    t.returnAt = this.now + elapsed;
    this.schedule(t.returnAt, () => this.returnHome(p, t));
    return [`${p.name} lasci perdere e torni in ${handle(p)}: arrivi tra ${duration(elapsed)}.`];
  }

  // Buying and slots

  private buy(p: Truth, emoji: string | undefined, slotArg: string | undefined): string[] {
    if (emoji === undefined) return [`${p.name} una emoji per volta.`];
    if (p.trip !== undefined)
      return [
        `${p.name} sei sulla via del ritorno: le emoji si comprano da casa tua. Rientri tra ${duration(this.homeAt(p) - this.now)}.`,
      ];
    const lines: string[] = [];
    if (p.at === 'conquister') lines.push(this.leave(p));
    const n = this.copies(emoji);
    const price = this.price(emoji);
    if (p.balls < price)
      return [
        ...lines,
        `${p.name} ti servono ${price} palle per ${emoji} (ce ne sono già ${n} in giro, ne hai ${p.balls}).`,
      ];
    const wanted = slotArg === undefined ? undefined : Number(slotArg) - 1;
    const carriedSlot = CARRIED_POWERS.includes(kind(emoji)) ? p.carried.indexOf(null) : -1;
    const houseSlot =
      wanted !== undefined && wanted >= 0 && wanted < HOUSE ? wanted : p.house.indexOf(null);
    if (wanted === undefined && carriedSlot < 0 && houseSlot < 0)
      return [
        ...lines,
        `${p.name} hai già tutti i ${HOUSE} posti della casa pieni: scegli quale sostituire con !buy <emoji> <posto>. Nessun addebito.`,
      ];
    p.balls -= price;
    const copies = n > 0 ? ` (ce n'erano già ${n} in giro, prezzo ${multiplier(n)})` : '';
    if (wanted === undefined && carriedSlot >= 0) {
      p.carried[carriedSlot] = emoji;
      lines.push(
        `${named(p.name, p.carried)} hai speso ${price} palle: ${emoji} ora è con te${copies}.`
      );
    } else {
      p.house[houseSlot] = emoji;
      lines.push(
        `${named(p.name, p.carried)} hai speso ${price} palle: ${emoji} in casa nel posto ${houseSlot + 1}${copies}. Non dà nessun bonus: aspetta in casa finché non la usi.`
      );
    }
    return lines;
  }

  /** `!take E` / `!store E`; `!take E F` swaps F back into the house (rules §1.1). */
  private move(p: Truth, emoji: string | undefined, take: boolean, swap?: string): string[] {
    if (emoji === undefined) return [`${p.name} una emoji per volta.`];
    const from = take ? p.house : p.carried;
    const to = take ? p.carried : p.house;
    const i = from.indexOf(emoji);
    if (i < 0)
      return [take ? `${p.name} non hai ${emoji} in casa.` : `${p.name} non hai ${emoji} con te.`];
    const j = swap === undefined ? -1 : p.carried.indexOf(swap);
    if (take && j >= 0) {
      p.house[i] = swap as string;
      p.carried[j] = emoji;
      return [
        `${named(p.name, p.carried)} ${emoji} ora è con te al posto di ${swap as string}, che torna in casa: fatto.`,
      ];
    }
    const free = to.indexOf(null);
    if (free < 0)
      return take
        ? [this.slotsFull(p, emoji)]
        : [`${p.name} la casa è piena: libera un posto prima.`];
    from[i] = null;
    to[free] = emoji;
    return [`${named(p.name, p.carried)} ${emoji} ora è ${take ? 'con te' : 'in casa'}: fatto.`];
  }

  // State queries

  private profile(p: Truth | undefined): string[] {
    if (p === undefined) return [];
    const ranked = [...this.players.values()].sort((a, b) => b.balls - a.balls);
    const rank = ranked.indexOf(p) + 1;
    const carried = p.carried.filter((c) => c !== null).join('');
    const where =
      p.at === 'conquister'
        ? `in ${C}`
        : p.trip === undefined
          ? `a casa, in ${handle(p)}`
          : this.now < p.trip.arriveAt && !p.trip.back
            ? `in viaggio verso ${p.trip.to}: rientra tra ${duration(this.homeAt(p) - this.now)}`
            : `sulla via del ritorno da ${p.trip.to}: rientra tra ${duration(this.homeAt(p) - this.now)}`;
    return [
      p.name,
      `Con te: ${carried === '' ? 'niente' : carried}`,
      `${balls(p.balls)}, ${rank}° su ${ranked.length} in classifica`,
      where,
    ];
  }

  /** `/house [N]`: the slots in use, then each numbered slot, an empty one bare (bot-protocol). */
  private house(p: Truth | undefined): string[] {
    if (p === undefined) return [];
    const used = p.house.filter((e) => e !== null).length;
    const slots = p.house.map((e, i) => (e === null ? `${i + 1}` : `${i + 1} ${e}`));
    return [`Casa di ${p.name} (${used}/${HOUSE}):`, `${slots.join('  ')} ·`];
  }

  private leaderboard(): string[] {
    const ranked = [...this.players.values()].sort((a, b) => b.balls - a.balls).slice(0, 10);
    const lines = ['Classifica @TheConquister37'];
    ranked.forEach((p, i) =>
      lines.push(`${i + 1}) ${named(p.name, p.carried)} — ${balls(p.balls)}`)
    );
    const h = this.holderState;
    if (h !== undefined) lines.push(`In ${C} ora: ${named(h.name, this.truth(h.name).carried)}`);
    return lines;
  }

  // Helpers

  /**
   * The player a command names, as the bot reads it: `@Name` for a Telegram account, the bare name
   * for an IRC one; the other form names nobody (docs/bot-protocol.md §2).
   */
  private named(written: string): Truth | undefined {
    const p = this.players.get(written.replace(/^@/u, ''));
    return p !== undefined && written.startsWith('@') === p.telegram ? p : undefined;
  }

  private truth(name: string): Truth {
    const p = this.players.get(name);
    if (p === undefined) throw new Error(`no player ${name}`);
    return p;
  }

  private count(list: readonly (string | null)[], emoji: string): number {
    return list.filter((e) => e !== null && kind(e) === kind(emoji)).length;
  }

  /** 🐔 pay one ball a minute each, out or in (rules §5.3). */
  private settleHens(p: Truth): void {
    const hens = this.count(p.house, '🐔');
    const elapsed = this.now - p.henAt;
    p.henAt = this.now;
    if (hens === 0 || elapsed <= 0) return;
    const earned = (hens * elapsed) / 60_000 + p.henRest;
    p.balls += Math.floor(earned);
    p.henRest = earned - Math.floor(earned);
  }

  private schedule(at: number, run: () => string[]): void {
    const d: Due = { at, seq: this.seq++, run };
    const i = this.due.findIndex((x) => x.at > at || (x.at === at && x.seq > d.seq));
    if (i < 0) this.due.push(d);
    else this.due.splice(i, 0, d);
  }
}
