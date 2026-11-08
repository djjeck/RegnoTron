/**
 * The map behind `/map`: the measurements, fed with the bot's messages as they come, and the
 * last map drawn from them, both kept as documents of the `norelec-map` plugin's store, so that a restart neither forgets the trips nor draws again. On the first start without them, the measurements are rebuilt
 * from the event log.
 *
 * - The map is drawn again only when what it depends on changes (`Measurements.key`: the pairs and
 *   their times), once the trips have been quiet for `settleMs`, or at once when asked for while
 *   out of date. One drawing at a time; a change during one is drawn after it.
 * - A drawing whose fit is not good keeps the previous map, logged once per set of
 *   measurements. A pair whose time changes means a player moved: the older pairs of both are
 *   dropped (measurements.ts), and that is logged too. Nobody is told: the bot only ever sends
 *   the map, in answer to `/map`.
 * - The photo is uploaded once: Telegram's `file_id` for it is kept, and sent again until the map
 *   changes.
 */
import { type BotMessage } from '@regnotron/norelec/game/bot-message.ts';
import { type GameState } from '@regnotron/norelec/state/game-state.ts';
import { type Drawn } from './draw.ts';
import { type Distance, type Point } from './fit.ts';
import { AMBIGUOUS_S, type MapLayout } from './layout.ts';
import {
  type Change,
  distanceOf,
  Measurements,
  type Pair,
  rocketsIn,
  type RocketsOf,
  tripsIn,
} from './measurements.ts';
import { holdingTier, MAP_STYLE, type Overlay } from './render.ts';

/** A record of the map in the event log. */
export interface MapRecord {
  type: 'map';
  t: number;
  event: 'moved' | 'drawn' | 'rejected' | 'failed';
  detail: string;
}

/** The map as `/map` sends it: by `fileId` once uploaded, else the PNG. */
export interface MapPhoto {
  key: string;
  png: Buffer;
  fileId?: string;
}

/** Where the measurements and the map are kept: a plugin's store (@megabottron1999/core/store.ts). */
export interface Documents {
  read<T = unknown>(name: string): T | undefined;
  write(name: string, value: unknown): void;
}

export interface MapServiceOptions {
  /** Where the measurements and the map are kept. */
  documents: Documents;
  /** Draws the map, off the event loop (worker.ts). */
  draw: (pairs: readonly Distance[], overlay: Overlay, previous?: MapLayout) => Promise<Drawn>;
  log: (r: MapRecord) => void;
  now: () => number;
  /**
   * The live game state's players, whose holdings the map reads again whenever it is asked for:
   * the state knows balances that no message naming the player has shown the map since (those of
   * the restart's replay, say).
   */
  players?: Players;
  /** Quiet after a change before drawing; 0 for never on its own. */
  settleMs?: number;
}

/**
 * The format of the kept measurements: any other, such as the times kept before rockets counted
 * (format 1, without `version`), before the roads' traffic (2) or before the players' holdings (3),
 * is dropped and the measurements rebuilt from the event log.
 */
export const MEASUREMENTS_VERSION = 4;

interface StoredMeasurements {
  version: number;
  /** Each player's tier of holdings (`holdingTier`), as last seen. */
  holdings: Record<string, number>;
  /**
   * The time of the last trip taken, or of the backfill: only later messages count, so that
   * nothing is counted twice. Messages without a trip do not move it, so they cost no write.
   */
  through: number;
  pairs: Pair[];
}

interface StoredMap {
  key: string;
  /** The look it was drawn in (`MAP_STYLE`): an older one is drawn again. */
  style?: number;
  layout: MapLayout;
  fileId?: string;
}

export const SETTLE_MS = 60_000;

/** What calls a trip off before it arrives. */
const CALLED_OFF = new Set(['turnBack', 'dreamDepart', 'lostAtFork']);
/** The documents: the measurements, the map's layout and file id, and its photo (in base64). */
export const MEASUREMENTS = 'measurements';
export const MAP = 'map';
export const PHOTO = 'photo';

/** The photo's document. */
export interface StoredPhoto {
  png: string;
}

export class MapService {
  private readonly o: MapServiceOptions;
  private measurements: Measurements;
  private through: number;
  private map: StoredMap | undefined;
  private png: Buffer | undefined;
  /** The key of the last drawing refused, so that the owner is told once. */
  private refused: string | undefined;
  private drawing: Promise<void> | undefined;
  /**
   * The trips on the road, by player, until they arrive: in memory only, so a restart loses those
   * then on the road, a few trips of traffic.
   */
  private readonly onTheRoad = new Map<string, { to: string; eta: number }>();
  /** Each player's tier of holdings, as last seen. */
  private holdings: Record<string, number>;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(o: MapServiceOptions) {
    this.o = o;
    const read = o.documents.read<StoredMeasurements>(MEASUREMENTS);
    const kept = read?.version === MEASUREMENTS_VERSION ? read : undefined;
    this.measurements = new Measurements(kept?.pairs ?? []);
    this.holdings = { ...kept?.holdings };
    this.through = kept?.through ?? Number.NEGATIVE_INFINITY;
    this.map = o.documents.read<StoredMap>(MAP);
    const photo = o.documents.read<StoredPhoto>(PHOTO);
    if (typeof photo?.png === 'string') this.png = Buffer.from(photo.png, 'base64');
    else this.map = undefined;
  }

  /**
   * The base time between two homes in seconds, for timing a trip: the pair's own trips if any were
   * seen (`Measurements.baseS`), else the distance between their places on the map last drawn, the
   * map's distances being the midpoints of the rounded times, so half a second short (measurements.ts).
   * A home with two spots counts only if every spot gives the same time within `AMBIGUOUS_S`.
   */
  baseS(a: string, b: string): number | undefined {
    const measured = this.measurements.baseS(a, b);
    if (measured !== undefined) return measured;
    const homes = this.map?.layout.homes ?? [];
    const spots = (n: string): Point[] => {
      const h = homes.find((x) => x.name === n);
      return h === undefined ? [] : [h.at, ...(h.other === undefined ? [] : [h.other])];
    };
    const ds = spots(a).flatMap((p) => spots(b).map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
    if (ds.length === 0 || Math.max(...ds) - Math.min(...ds) > AMBIGUOUS_S) return undefined;
    return ds.reduce((x, y) => x + y, 0) / ds.length + 0.5;
  }

  /** Whether the measurements were kept: if not, `backfill` from the event log first. */
  get hasMeasurements(): boolean {
    return this.through !== Number.NEGATIVE_INFINITY;
  }

  /**
   * Bot messages from before, oldest first: their trips, with the 🚀 and balls that `players` knows
   * as each message comes (a game state the messages are replayed through).
   */
  backfill(messages: Iterable<BotMessage>, players: Players): void {
    for (const m of messages) this.take(m, players, false);
    this.through = Math.max(this.through, this.o.now());
    this.save();
  }

  /** One bot message, as it comes, after the game state took it. */
  observe(m: BotMessage, players: Players): void {
    if (this.take(m, players, true)) this.save();
  }

  /** The current map, drawn first if out of date; undefined until there is one. */
  async photo(): Promise<MapPhoto | undefined> {
    this.syncHoldings();
    if (!this.current()) await this.refresh();
    if (this.map === undefined || this.png === undefined) return undefined;
    return {
      key: this.map.key,
      png: this.png,
      ...(this.map.fileId === undefined ? {} : { fileId: this.map.fileId }),
    };
  }

  /** Telegram's id for the photo of `key`, once uploaded. */
  uploaded(key: string, fileId: string): void {
    if (this.map?.key !== key) return;
    this.map.fileId = fileId;
    this.o.documents.write(MAP, this.map);
  }

  /** Draws the map if the measurements changed since the last one; one drawing at a time. */
  refresh(): Promise<void> {
    this.drawing ??= this.drawWhileStale().finally(() => {
      this.drawing = undefined;
    });
    return this.drawing;
  }

  /** Stops the timer of a drawing to come. */
  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Takes a message's trips; whether it had any, and so the measurements are to be saved. */
  /**
   * Takes a message's trips, and the arrivals of those on the road; whether anything was taken,
   * and so the measurements are to be saved.
   */
  private take(m: BotMessage, players: Players, live: boolean): boolean {
    if (m.time <= this.through) return false;
    let taken = false;
    // Trips whose time is up, and that nothing called off, reached their destination.
    for (const [player, trip] of this.onTheRoad)
      if (trip.eta <= m.time) {
        this.onTheRoad.delete(player);
        if (this.measurements.arrived(player, trip.to, trip.eta)) taken = true;
      }
    const trips = tripsIn(m, players.rockets);
    let changed = false;
    for (const trip of trips) {
      const change = this.measurements.add(trip);
      if (change.kind !== 'repeat' && change.kind !== 'stale') changed = true;
      if (change.kind === 'moved') this.moved(change);
      this.onTheRoad.set(trip.from, { to: trip.to, eta: trip.time + trip.seconds * 1000 });
    }
    // A turn-back, a dreamt departure or a fork lost: that trip never arrives.
    for (const e of m.events)
      if (CALLED_OFF.has(e.kind) && 'player' in e && e.player !== undefined)
        this.onTheRoad.delete(e.player.name);
    // The holdings of the players the message names, as the state now has them.
    for (const name of namedIn(m)) {
      const balls = players.balls(name);
      if (balls === undefined) continue;
      const tier = holdingTier(balls);
      if (this.holdings[name] !== tier) {
        this.holdings[name] = tier;
        taken = true;
      }
    }
    if (changed && live) this.settle();
    if (trips.length > 0) taken = true;
    if (taken) this.through = m.time;
    return taken;
  }

  private moved(change: Extract<Change, { kind: 'moved' }>): void {
    const { a, b } = change.pair;
    const detail =
      `${a} ↔ ${b} took ${distanceOf(change.pair)} s, ${change.was} s before: one of them moved; ` +
      `dropped ${change.dropped.length} older pairs of theirs`;
    this.o.log({ type: 'map', t: change.pair.last, event: 'moved', detail });
  }

  private settle(): void {
    const ms = this.o.settleMs ?? SETTLE_MS;
    if (ms === 0) return;
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, ms);
    this.timer.unref?.();
  }

  /** The homes' tiers as the live state has them now, where it knows them; saved if changed. */
  private syncHoldings(): void {
    const players = this.o.players;
    if (players === undefined) return;
    let changed = false;
    for (const p of this.measurements.pairs())
      for (const name of [p.a, p.b]) {
        const balls = players.balls(name);
        if (balls === undefined) continue;
        const tier = holdingTier(balls);
        if (this.holdings[name] !== tier) {
          this.holdings[name] = tier;
          changed = true;
        }
      }
    if (changed) this.save();
  }

  /** The holdings of the players with a measured pair, the ones the map can show. */
  private homesHoldings(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.measurements.pairs())
      for (const name of [p.a, p.b])
        if (this.holdings[name] !== undefined) out[name] = this.holdings[name];
    return out;
  }

  /** What the map depends on at `now`: the measurements, and the tiers of the homes' holdings. */
  private key(now: number): string {
    const tiers = Object.entries(this.homesHoldings())
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
      .map(([name, tier]) => `${name} ${tier}`);
    return [this.measurements.key(now), ...tiers].join('\n');
  }

  /** Whether the map kept is of the measurements as they are, in today's look. */
  private current(): boolean {
    return this.map?.key === this.key(this.o.now()) && this.map.style === MAP_STYLE;
  }

  private async drawWhileStale(): Promise<void> {
    for (;;) {
      const t = this.o.now();
      const key = this.key(t);
      if (this.current() || key === this.refused) return;
      const pairs = this.measurements.pairs();
      let drawn: Drawn;
      try {
        drawn = await this.o.draw(
          pairs.map((p) => ({ a: p.a, b: p.b, d: distanceOf(p) })),
          { roads: this.measurements.roads(t), holdings: this.homesHoldings() },
          this.map?.layout
        );
      } catch (e) {
        this.o.log({ type: 'map', t, event: 'failed', detail: String(e) });
        this.refused = key;
        return;
      }
      if (!drawn.accepted) {
        const detail = `no fit within the rounding (best ${drawn.maxError.toFixed(1)} s off) for ${pairs.length} pairs; the map stays as it was`;
        this.o.log({ type: 'map', t, event: 'rejected', detail });
        this.refused = key;
      } else if (drawn.layout.homes.length === 0) {
        // Too few trips to place anyone: nothing to draw yet.
        this.refused = key;
      } else {
        this.png = Buffer.from(drawn.png);
        this.map = { key, style: MAP_STYLE, layout: drawn.layout };
        this.o.documents.write(PHOTO, { png: this.png.toString('base64') } satisfies StoredPhoto);
        this.o.documents.write(MAP, this.map);
        this.o.log({
          type: 'map',
          t,
          event: 'drawn',
          detail: summary(drawn.layout, pairs, drawn.maxError),
        });
      }
      if (this.key(this.o.now()) === key) return;
    }
  }

  private save(): void {
    this.o.documents.write(MEASUREMENTS, {
      version: MEASUREMENTS_VERSION,
      through: this.through,
      pairs: this.measurements.pairs(),
      holdings: this.holdings,
    } satisfies StoredMeasurements);
  }
}

/** What the map needs to know of the players, from the game state. */
export interface Players {
  /** The 🚀 a player carries, as last seen listed next to the name. */
  rockets: RocketsOf;
  /** The balls a player holds, as far as the bot has shown; undefined if never. */
  balls: (player: string) => number | undefined;
}

/** `Players` as a game state knows them. */
export function playersFrom(state: Pick<GameState, 'players'>): Players {
  return {
    rockets: (player) => {
      const carried = state.players.get(player)?.carried;
      return carried === undefined ? undefined : rocketsIn(carried);
    },
    balls: (player) => state.players.get(player)?.balance?.balls,
  };
}

/** The players a message's events name: any field that is a player. */
function namedIn(m: BotMessage): Set<string> {
  const out = new Set<string>();
  for (const e of m.events)
    for (const v of Object.values(e))
      if (typeof v === 'object' && v !== null && 'name' in v && typeof v.name === 'string')
        out.add(v.name);
  return out;
}

/** What a map rests on and leaves out, for the log: the photo carries no caption. */
export function summary(layout: MapLayout, pairs: readonly Pair[], maxError: number): string {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const first = day(Math.min(...pairs.map((p) => p.first)));
  const last = day(Math.max(...pairs.map((p) => p.last)));
  const unplaced =
    layout.unplaced.length === 0 ? '' : `; no place yet: ${layout.unplaced.join(', ')}`;
  return `${layout.homes.length} homes from ${pairs.length} pairs (trips ${first} to ${last}), ${maxError.toFixed(1)} s off at most${unplaced}`;
}
