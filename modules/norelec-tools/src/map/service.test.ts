import { parseMessage } from '@regnotron/norelec/game/parse-message.ts';
import { GameState } from '@regnotron/norelec/state/game-state.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Drawn } from './draw.ts';
import { type Distance } from './fit.ts';
import { type MapLayout } from './layout.ts';
import { type Overlay } from './render.ts';
import {
  type Documents,
  type MapRecord,
  MapService,
  type MapServiceOptions,
  type Players,
  playersFrom,
} from './service.ts';

const T0 = Date.UTC(2026, 9, 23, 8, 0, 0);
const NONE: Players = { rockets: () => 0, balls: () => undefined };

/** A store in memory, which keeps each document as its JSON, as the core's store does. */
class MemoryDocuments implements Documents {
  readonly docs = new Map<string, string>();
  read<T>(name: string): T | undefined {
    const text = this.docs.get(name);
    return text === undefined ? undefined : (JSON.parse(text) as T);
  }
  write(name: string, value: unknown): void {
    this.docs.set(name, JSON.stringify(value));
  }
}
const depart = (time: number, from: string, to: string, seconds: number) => {
  const text = `${from} parti per ${to}: arrivi tra ${seconds} secondi. Casa tua resta scoperta.`;
  return { time, text, events: parseMessage(text) };
};

/** A drawing that places every player of the pairs, and remembers what it was asked. */
function fakeDraw(answer?: (pairs: readonly Distance[]) => Drawn) {
  const calls: { pairs: Distance[]; overlay: Overlay; previous?: MapLayout }[] = [];
  const draw = (
    pairs: readonly Distance[],
    overlay: Overlay,
    previous?: MapLayout
  ): Promise<Drawn> => {
    calls.push({
      pairs: [...pairs],
      overlay,
      ...(previous === undefined ? {} : { previous }),
    });
    if (answer !== undefined) return Promise.resolve(answer(pairs));
    const names = [...new Set(pairs.flatMap((p) => [p.a, p.b]))].sort();
    const layout: MapLayout = {
      homes: names.map((name, i) => ({ name, pairs: 2, at: { x: i, y: 0 } })),
      unplaced: [],
      links: pairs.map((p): [string, string] => [p.a, p.b]),
      maxError: 0.2,
    };
    return Promise.resolve({
      accepted: true,
      maxError: 0.2,
      layout,
      png: new Uint8Array([calls.length]),
    });
  };
  return { draw, calls };
}

describe('MapService', () => {
  let documents: MemoryDocuments;
  let records: MapRecord[];
  const open = (draw: MapServiceOptions['draw'], settleMs = 0) =>
    new MapService({
      documents,
      draw,
      log: (r) => records.push(r),
      now: () => T0 + 10 * 60_000,
      settleMs,
    });

  beforeEach(() => {
    documents = new MemoryDocuments();
    records = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("times a pair never measured from the map's places, unless a spot is ambiguous", async () => {
    const layout = (homes: MapLayout['homes']): Drawn => ({
      accepted: true,
      maxError: 0.2,
      layout: { homes, unplaced: [], links: [], maxError: 0.2 },
      png: new Uint8Array([1]),
    });
    const map = open(
      fakeDraw(() =>
        layout([
          { name: 'Alfa', pairs: 3, at: { x: 0, y: 0 } },
          { name: 'Beta', pairs: 3, at: { x: 30, y: 40 } },
          { name: 'Gamma', pairs: 2, at: { x: 0, y: 60 }, other: { x: 0, y: 61 } },
          { name: 'Delta', pairs: 2, at: { x: 100, y: 0 }, other: { x: -100, y: 0 } },
        ])
      ).draw
    );
    map.observe(depart(T0, 'Alfa', 'Gamma', 70), NONE);
    expect(map.baseS('Alfa', 'Beta')).toBeUndefined();
    await map.photo();
    // Measured: the pair's own trips win.
    expect(map.baseS('Gamma', 'Alfa')).toBe(70.5);
    // Not measured: 50 s on the map, and half a second for the rounding.
    expect(map.baseS('Beta', 'Alfa')).toBe(50.5);
    // Two spots 1 s apart in distance: their mean; two spots far apart: no estimate.
    expect(map.baseS('Beta', 'Gamma')).toBeCloseTo(
      (Math.hypot(30, 20) + Math.hypot(30, 21)) / 2 + 0.5
    );
    expect(map.baseS('Alfa', 'Delta')).toBe(100.5);
    expect(map.baseS('Beta', 'Delta')).toBeUndefined();
    expect(map.baseS('Alfa', 'Nobody')).toBeUndefined();
  });

  it('draws once for the same measurements, and again for a new pair', async () => {
    const { draw, calls } = fakeDraw();
    const map = open(draw);
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    map.observe(depart(T0 + 1000, 'Beta', 'Gamma', 60), NONE);
    const first = await map.photo();
    expect(calls).toHaveLength(1);
    expect(records[0]?.detail).toBe(
      '3 homes from 2 pairs (trips 2026-10-23 to 2026-10-23), 0.2 s off at most'
    );
    expect([...(first?.png ?? [])]).toEqual([1]);
    // A repeat trip changes no distance.
    map.observe(depart(T0 + 2000, 'Alfa', 'Beta', 50), NONE);
    expect((await map.photo())?.key).toBe(first?.key);
    expect(calls).toHaveLength(1);
    // A new pair does, and the drawing keeps the previous orientation.
    map.observe(depart(T0 + 3000, 'Gamma', 'Alfa', 70), NONE);
    const second = await map.photo();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.previous?.homes.map((h) => h.name)).toEqual(['Alfa', 'Beta', 'Gamma']);
    expect(second?.key).not.toBe(first?.key);
    expect(records.map((r) => r.event)).toEqual(['drawn', 'drawn']);
  });

  it("draws again when a pair's time changes, and logs that someone moved", async () => {
    const { draw, calls } = fakeDraw();
    const map = open(draw);
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    map.observe(depart(T0 + 1000, 'Gamma', 'Delta', 40), NONE);
    await map.photo();
    map.observe(depart(T0 + 2000, 'Beta', 'Alfa', 60), NONE);
    expect(records.at(-1)).toEqual({
      type: 'map',
      event: 'moved',
      t: T0 + 2000,
      detail:
        'Alfa ↔ Beta took 60 s, 50 s before: one of them moved; dropped 1 older pairs of theirs',
    });
    await map.photo();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.pairs).toEqual([
      { a: 'Alfa', b: 'Beta', d: 60 },
      { a: 'Delta', b: 'Gamma', d: 40 },
    ]);
  });

  it('keeps the previous map when the fit is refused, and logs it once', async () => {
    let accept = true;
    const ok = fakeDraw();
    const map = open((pairs, overlay, previous) =>
      accept
        ? ok.draw(pairs, overlay, previous)
        : Promise.resolve({ accepted: false, maxError: 33.4 })
    );
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    const first = await map.photo();
    accept = false;
    map.observe(depart(T0 + 1000, 'Beta', 'Gamma', 60), NONE);
    expect((await map.photo())?.key).toBe(first?.key);
    expect((await map.photo())?.key).toBe(first?.key);
    expect(records.map((r) => r.event)).toEqual(['drawn', 'rejected']);
    expect(records[1]?.detail).toBe(
      'no fit within the rounding (best 33.4 s off) for 2 pairs; the map stays as it was'
    );
  });

  it('has no map until a home can be placed, and logs a drawing that fails', async () => {
    const empty = open(() =>
      Promise.resolve({
        accepted: true,
        maxError: 0,
        layout: { homes: [], unplaced: ['Alfa', 'Beta'], links: [], maxError: 0 },
        png: new Uint8Array(),
      })
    );
    expect(await empty.photo()).toBeUndefined();
    empty.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    expect(await empty.photo()).toBeUndefined();
    const broken = open(() => Promise.reject(new Error('worker died')));
    broken.observe(depart(T0 + 1000, 'Gamma', 'Delta', 50), NONE);
    expect(await broken.photo()).toBeUndefined();
    expect(records).toMatchObject([{ event: 'failed', detail: 'Error: worker died' }]);
  });

  it('keeps the measurements, the map and its file id across a restart', async () => {
    const { draw, calls } = fakeDraw();
    const map = open(draw);
    expect(map.hasMeasurements).toBe(false);
    map.backfill([depart(T0, 'Alfa', 'Beta', 50), depart(T0 + 1000, 'Alfa', 'Beta', 50)], NONE);
    expect(map.hasMeasurements).toBe(true);
    const photo = await map.photo();
    map.uploaded('another key', 'ignored');
    map.uploaded(photo?.key as string, 'file-1');
    const again = open(draw);
    expect(again.hasMeasurements).toBe(true);
    expect(await again.photo()).toMatchObject({ key: photo?.key, fileId: 'file-1' });
    expect(calls).toHaveLength(1);
    // Messages up to the backfill's end were taken already: a replay counts nothing twice.
    again.observe(depart(T0 + 1000, 'Gamma', 'Delta', 50), NONE);
    expect((await again.photo())?.key).toBe(photo?.key);
  });

  it('writes the measurements only for a message with a trip', () => {
    const map = open(fakeDraw().draw);
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    const kept = documents.docs.get('measurements');
    documents.docs.delete('measurements');
    const text = 'Alfa sei già in viaggio, torni tra 40 secondi.';
    map.observe({ time: T0 + 1000, text, events: parseMessage(text) }, NONE);
    expect(documents.docs.has('measurements')).toBe(false);
    map.observe(depart(T0 + 2000, 'Alfa', 'Beta', 50), NONE);
    expect(documents.read('measurements')).toMatchObject({
      through: T0 + 2000,
      pairs: [{ a: 'Alfa', b: 'Beta', trips: 2 }],
    });
    expect(kept).toContain('"trips":1');
  });

  it('draws again a map kept from an older look', async () => {
    const { draw, calls } = fakeDraw();
    const map = open(draw);
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    await map.photo();
    const kept = documents.read<Record<string, unknown>>('map') ?? {};
    delete kept['style'];
    documents.write('map', kept);
    await open(draw).photo();
    expect(calls).toHaveLength(2);
  });

  it('counts on a road only the trips that reached their destination', async () => {
    const { draw, calls } = fakeDraw();
    const map = open(draw);
    const at = (s: number) => T0 + s * 1000;
    const msg = (t: number, text: string) => ({ time: t, text, events: parseMessage(text) });
    // Alfa raids Beta 3 times: one arrives, one turns back, one is dreamt.
    map.observe(depart(at(0), 'Alfa', 'Beta', 50), NONE);
    map.observe(depart(at(100), 'Alfa', 'Beta', 50), NONE);
    map.observe(msg(at(110), 'Alfa lasci perdere e torni in Alfa: arrivi tra 10 secondi.'), NONE);
    const dream =
      'Alfa parti per Beta: arrivi tra 50 secondi. Casa tua resta scoperta.\n' +
      'Alfa eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!';
    map.observe(msg(at(200), dream), NONE);
    // Gamma raids Delta 3 times, all of them arriving: a busier road.
    for (const s of [300, 400, 500]) map.observe(depart(at(s), 'Gamma', 'Delta', 50), NONE);
    map.observe(msg(at(600), 'Gamma (🎈) sei tornato in @Gamma.'), NONE);
    await map.photo();
    expect(calls[0]?.overlay.roads).toEqual({ 'Gamma Delta': 1 });
    const kept = documents.read('measurements') as {
      pairs: { a: string; toB: number[]; toA: number[] }[];
    };
    // Alfa → Beta, and Gamma → Delta, which is from b to a.
    expect(kept.pairs.map((p) => [p.a, p.toB.length, p.toA.length])).toEqual([
      ['Alfa', 1, 0],
      ['Delta', 0, 3],
    ]);
  });

  it('rebuilds measurements kept in an older format', () => {
    documents.write('measurements', {
      through: T0,
      pairs: [{ a: 'Alfa', b: 'Beta', seconds: 50 }],
    });
    expect(open(fakeDraw().draw).hasMeasurements).toBe(false);
  });

  it("counts the rockets a game state last saw in a player's hands", () => {
    const state = new GameState();
    const players = playersFrom(state);
    expect(players.rockets('Alfa')).toBeUndefined();
    const text = 'Alfa (🚀🎈🚀) sei tornato in @Alfa.';
    state.apply({ time: T0, text, events: parseMessage(text) });
    expect(players.rockets('Alfa')).toBe(2);
    const map = open(fakeDraw().draw);
    map.observe(depart(T0 + 1000, 'Alfa', 'Beta', 125), players);
    // 125 s with two 🚀 is kept as 150 s without.
    const kept = documents.read('measurements') as {
      pairs: { lo: number }[];
    };
    expect(kept.pairs.map((p) => p.lo)).toEqual([150]);
  });

  it('draws each home by its tier of holdings, again when one changes tier', async () => {
    const { draw, calls } = fakeDraw();
    const state = new GameState();
    const players = playersFrom(state);
    const map = open(draw);
    // A profile, as the bot sends it: one message of several lines.
    const say = (t: number, text: string) => {
      const m = { time: t, text, events: parseMessage(text) };
      state.apply(m);
      map.observe(m, players);
    };
    // Alfa's emoji, so that the state knows the rockets of the trip.
    say(T0 - 1000, 'Alfa (🎈) sei tornato in @Alfa.');
    say(T0, 'Alfa parti per Beta: arrivi tra 50 secondi. Casa tua resta scoperta.');
    say(T0 + 100_000, `Alfa\n60000 palle, 1° su 9 in classifica\na casa, in @Alfa`);
    await map.photo();
    expect(calls[0]?.overlay.holdings).toEqual({ Alfa: 2 });
    // Unchanged tier, no drawing; a new one, a drawing.
    say(T0 + 200_000, `Alfa\n61000 palle, 1° su 9 in classifica\na casa, in @Alfa`);
    await map.photo();
    expect(calls).toHaveLength(1);
    say(T0 + 300_000, `Alfa\n900 palle, 3° su 9 in classifica\na casa, in @Alfa`);
    await map.photo();
    expect(calls[1]?.overlay.holdings).toEqual({ Alfa: 0 });
    // Kept across a restart.
    const key = (await map.photo())?.key;
    expect((await open(draw).photo())?.key).toBe(key);
    expect(calls).toHaveLength(2);
  });

  it("reads the homes' holdings again from the live state when asked for the map", async () => {
    const { draw, calls } = fakeDraw();
    const first = open(draw);
    first.backfill([depart(T0, 'Alfa', 'Beta', 50)], {
      rockets: () => 0,
      balls: (p) => (p === 'Alfa' ? 60_000 : undefined),
    });
    await first.photo();
    expect(calls[0]?.overlay.holdings).toEqual({ Alfa: 2 });
    // After a restart the state knows Alfa gave everything away, though no message said so since.
    const live: Players = { rockets: () => 0, balls: (p) => (p === 'Alfa' ? 0 : undefined) };
    const again = new MapService({
      documents,
      draw,
      log: () => undefined,
      now: () => T0 + 10 * 60_000,
      settleMs: 0,
      players: live,
    });
    await again.photo();
    expect(calls[1]?.overlay.holdings).toEqual({ Alfa: 0 });
  });

  it('logs a move found in the backfill', () => {
    const map = open(fakeDraw().draw);
    map.backfill([depart(T0, 'Alfa', 'Beta', 50), depart(T0 + 1000, 'Alfa', 'Beta', 52)], NONE);
    expect(records.map((r) => r.event)).toEqual(['moved']);
  });

  it('draws on its own once the trips have been quiet for a while', async () => {
    vi.useFakeTimers();
    const { draw, calls } = fakeDraw();
    const map = open(draw, 60_000);
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    await vi.advanceTimersByTimeAsync(30_000);
    map.observe(depart(T0 + 30_000, 'Beta', 'Gamma', 60), NONE);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1);
    // A change stopped before its time draws nothing.
    map.observe(depart(T0 + 100_000, 'Gamma', 'Delta', 60), NONE);
    map.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(1);
  });

  it('draws a change that came during a drawing right after it', async () => {
    const { draw, calls } = fakeDraw();
    const slow = (pairs: readonly Distance[], overlay: Overlay, previous?: MapLayout) => {
      // The first drawing sees a new trip arrive while it runs.
      if (calls.length === 0) map.observe(depart(T0 + 5000, 'Gamma', 'Delta', 60), NONE);
      return draw(pairs, overlay, previous);
    };
    const map = open(slow);
    map.observe(depart(T0, 'Alfa', 'Beta', 50), NONE);
    const photo = await map.photo();
    expect(calls).toHaveLength(2);
    expect(records.at(-1)?.detail).toMatch(/^4 homes from 2 pairs/u);
  });
});
