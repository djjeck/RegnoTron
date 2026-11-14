/**
 * The automatic `/nuclear_warning` in the game's group: the count of
 * modules/norelec-tools/src/clock/nuclear-warning.ts, posted when the balls in the game cross a
 * multiple of 50,000 upwards.
 *
 * - Only upwards: falling below a threshold is not a crossing, but crossing it again afterwards is.
 * - The same threshold is posted at most once in 12 hours; a higher one is posted at once. When a
 *   check finds several crossed, it is about the highest.
 * - Between 00:00 and 08:00 Italian time nothing is posted: the highest threshold crossed waits for
 *   08:00, and is posted then only if the total is still at or above it. The 12 hours count from the
 *   post.
 * - The post ends with a footer naming the command, so that players can ask for it: the alias that
 *   matches its title, `/aggiornamento_della_protezione_civile`.
 * - It posts only while the owner turns it on (the `nuclearClock` setting, off by default). While
 *   off it still follows the level, so turning it on posts nothing for a crossing made before, and
 *   a threshold waiting for the morning is dropped.
 *
 * What it remembers is kept in the `nuclear-clock` plugin's store: the level the total was last
 * at, when each threshold was posted, a threshold waiting for the morning, and the balances the
 * game state knew. A restart replays only the last hours of the log, so the balances are put back
 * into the game state, each unless the replay has a newer one; a threshold crossed while the client
 * was down is posted on the first check. The first start, with nothing kept, takes the level as it
 * is and posts nothing.
 */
import { type GameState } from '@regnotron/norelec/state/game-state.ts';
import { countBalls, formatWarning } from './nuclear-warning.ts';

/** The steps of the total that are posted. */
export const STEP = 50_000;

/** The least time between two posts of the same threshold. */
export const REPEAT_MS = 12 * 3_600_000;

/** Italian time: the quiet hours end at 08:00 there. */
const QUIET_UNTIL_HOUR = 8;
const romeHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Whether `t` falls between 00:00 and 08:00 in Italy. */
export const isQuiet = (t: number): boolean => Number(romeHour.format(t)) < QUIET_UNTIL_HOUR;

/** What the clock keeps across restarts. */
export interface ClockState {
  /** How many steps the total was at, when last checked. */
  level: number;
  /** When each threshold, in balls, was last posted. */
  posted: Record<string, number>;
  /** The highest threshold crossed during the quiet hours, waiting for 08:00. */
  pending?: number;
  /** The balances the game state knew, by player. */
  balances: Record<string, { balls: number; at: number }>;
}

/** A record of the clock in the event log. */
export interface ClockRecord {
  type: 'nuclear';
  t: number;
  event: 'posted' | 'held' | 'skipped' | 'failed';
  detail: string;
}

type State = Pick<GameState, 'players' | 'player'>;

/** The level and balances of `state` now, as a first start keeps them: nothing to post. */
export function initialClock(state: Pick<GameState, 'players'>): ClockState {
  return {
    level: Math.floor(countBalls(state).total / STEP),
    posted: {},
    balances: balancesOf(state),
  };
}

function balancesOf(state: Pick<GameState, 'players'>): ClockState['balances'] {
  const out: ClockState['balances'] = {};
  for (const p of state.players.values()) if (p.balance !== undefined) out[p.name] = p.balance;
  return out;
}

export interface NuclearClockOptions {
  /** The live game state, whose balances are counted. */
  state: State;
  /** What was kept; left out on a first start. */
  kept?: ClockState;
  /** Whether to post: the owner's `nuclearClock` setting. */
  enabled: () => boolean;
  /** Posts the warning, in Markdown, in the group. */
  post: (text: string) => Promise<void>;
  /** The footer, which names the command in the form that reaches the bot. */
  footer: () => Promise<string>;
  save: (state: ClockState) => void;
  log: (r: ClockRecord) => void;
  now: () => number;
}

export class NuclearClock {
  private readonly o: NuclearClockOptions;
  private readonly kept: ClockState;
  private saved = '';

  constructor(o: NuclearClockOptions) {
    this.o = o;
    if (o.kept === undefined) this.kept = initialClock(o.state);
    else {
      this.kept = { ...o.kept, posted: { ...o.kept.posted } };
      for (const [name, balance] of Object.entries(o.kept.balances)) {
        const p = o.state.player(name);
        if (p.balance === undefined || p.balance.at < balance.at) p.balance = { ...balance };
      }
    }
    this.save();
  }

  /** What is kept now. */
  get state(): Readonly<ClockState> {
    return this.kept;
  }

  /** Looks at the total: after each bot message, and every minute for the end of the night. */
  check(): void {
    const now = this.o.now();
    const count = countBalls(this.o.state);
    const level = Math.floor(count.total / STEP);
    let due = level > this.kept.level ? level * STEP : undefined;
    this.kept.level = level;
    if (!this.o.enabled()) delete this.kept.pending;
    else if (isQuiet(now)) {
      if (due !== undefined && due > (this.kept.pending ?? 0)) {
        this.kept.pending = due;
        this.o.log({ type: 'nuclear', t: now, event: 'held', detail: `${due} until 08:00` });
      }
    } else {
      const pending = this.kept.pending;
      delete this.kept.pending;
      // The night's threshold, if the total is still there, unless a higher one is crossed now.
      if (pending !== undefined && count.total >= pending && pending > (due ?? 0)) due = pending;
      if (due !== undefined) this.consider(due, now, count);
    }
    // A post older than the repeat counts no more.
    for (const [threshold, t] of Object.entries(this.kept.posted))
      if (now - t >= REPEAT_MS) delete this.kept.posted[threshold];
    this.kept.balances = balancesOf(this.o.state);
    this.save();
  }

  private consider(threshold: number, now: number, count: ReturnType<typeof countBalls>): void {
    const last = this.kept.posted[threshold];
    if (last !== undefined && now - last < REPEAT_MS) {
      const ago = Math.round((now - last) / 60_000);
      this.o.log({
        type: 'nuclear',
        t: now,
        event: 'skipped',
        detail: `${threshold} posted ${ago} min ago`,
      });
      return;
    }
    this.kept.posted[threshold] = now;
    const detail = `${threshold}: ${count.total} balls`;
    this.o
      .footer()
      .then((footer) => this.o.post(formatWarning(count, footer)))
      .then(
        () => this.o.log({ type: 'nuclear', t: now, event: 'posted', detail }),
        (e: unknown) =>
          this.o.log({
            type: 'nuclear',
            t: now,
            event: 'failed',
            detail: `${detail}: ${String(e)}`,
          })
      );
  }

  private save(): void {
    const json = JSON.stringify(this.kept);
    if (json === this.saved) return;
    this.saved = json;
    this.o.save(this.kept);
  }
}

/**
 * The footer of the automatic post, which names the command by the alias that matches the post's
 * title. The bot has privacy mode on and is not an admin of the group, so Telegram delivers it a
 * bare command only if it was the last bot to speak there: the footer names it with the bot's
 * username (`username`, once connected), which always reaches it. Once the bot is an admin
 * (`admin`, the `telegram-bot` connector's `isAdmin`), every message reaches it and the bare command does too.
 */
export function footerFor(admin: boolean, username: string | undefined): string {
  return `Messaggio offerto da /aggiornamento_della_protezione_civile${admin || username === undefined ? '' : `@${username}`}`;
}
