import { GameState } from '@regnotron/norelec/state/game-state.ts';
import { describe, expect, it } from 'vitest';
import {
  type ClockRecord,
  type ClockState,
  footerFor,
  initialClock,
  isQuiet,
  NuclearClock,
  REPEAT_MS,
} from './nuclear-clock.ts';

const H = 3_600_000;
/** 13:00 in Italy (CET, UTC+1, after 25 Oct). */
const NOON = Date.UTC(2026, 9, 28, 12, 0);
/** 00:30 in Italy, the next night. */
const NIGHT = Date.UTC(2026, 9, 28, 23, 30);
/** 08:00 in Italy, that morning. */
const MORNING = Date.UTC(2026, 9, 29, 7, 0);
const FOOTER = 'Messaggio offerto da /aggiornamento_della_protezione_civile@ExampleBot';

/** A clock on a game state where Juno holds `balls`, with what it posts, keeps and logs. */
function clock(balls: number, kept?: ClockState) {
  const state = new GameState();
  state.player('Juno').balance = { balls, at: 0 };
  let now = NOON;
  const posts: string[] = [];
  const saves: ClockState[] = [];
  const logs: ClockRecord[] = [];
  let fail = false;
  let on = true;
  const c = new NuclearClock({
    state,
    ...(kept === undefined ? {} : { kept }),
    enabled: () => on,
    post: (text) => {
      if (fail) return Promise.reject(new Error('403: bot was kicked'));
      posts.push(text);
      return Promise.resolve();
    },
    footer: () => Promise.resolve(FOOTER),
    save: (s) => saves.push(structuredClone(s)),
    log: (r) => logs.push(r),
    now: () => now,
  });
  /** Juno now holds `n`, at `t`; the clock checks. */
  const set = async (n: number, t = now) => {
    now = t;
    state.player('Juno').balance = { balls: n, at: t };
    c.check();
    await new Promise((r) => setTimeout(r, 0));
  };
  return {
    c,
    state,
    posts,
    saves,
    logs,
    set,
    events: () => logs.map((l) => `${l.event} ${l.detail}`),
    failing: () => void (fail = true),
    turn: (to: boolean) => void (on = to),
  };
}

describe('NuclearClock', () => {
  it('takes the level as it is on a first start, and posts nothing', async () => {
    const k = clock(695_000);
    expect(k.saves).toEqual([
      { level: 13, posted: {}, balances: { Juno: { balls: 695_000, at: 0 } } },
    ]);
    await k.set(699_999);
    expect(k.posts).toEqual([]);
    expect(k.c.state.level).toBe(13);
  });

  it('posts each multiple of 50,000 crossed upwards, with the footer', async () => {
    const k = clock(695_000);
    await k.set(700_000);
    expect(k.posts).toHaveLength(1);
    expect(k.posts[0]).toMatch(/^\*\*AGGIORNAMENTO DELLA PROTEZIONE CIVILE\*\*\n/u);
    expect(k.posts[0]).toContain('Ci sono 700.000 palle in circolazione.');
    expect(k.posts[0]?.endsWith(`\n\n${FOOTER}`)).toBe(true);
    // Going down is no crossing; a higher threshold is posted at once.
    await k.set(640_000);
    await k.set(760_000, NOON + H);
    expect(k.posts).toHaveLength(2);
    expect(k.events()).toEqual(['posted 700000: 700000 balls', 'posted 750000: 760000 balls']);
    expect(k.c.state.posted).toEqual({ 700000: NOON, 750000: NOON + H });
  });

  it('posts nothing while off, and nothing for a crossing made then once on again', async () => {
    const k = clock(695_000);
    k.turn(false);
    await k.set(710_000);
    expect(k.posts).toEqual([]);
    k.turn(true);
    await k.set(720_000);
    expect(k.posts).toEqual([]);
    await k.set(750_000);
    expect(k.events()).toEqual(['posted 750000: 750000 balls']);
  });

  it('drops the night threshold if turned off before the morning', async () => {
    const k = clock(695_000);
    await k.set(700_000, NIGHT);
    k.turn(false);
    await k.set(700_000, NIGHT + H);
    expect(k.c.state.pending).toBeUndefined();
    k.turn(true);
    await k.set(700_000, MORNING);
    expect(k.posts).toEqual([]);
  });

  it('posts once for several thresholds crossed at a time, about the highest', async () => {
    const k = clock(10_000);
    await k.set(160_000);
    expect(k.events()).toEqual(['posted 150000: 160000 balls']);
  });

  it('posts the same threshold again only 12 hours after', async () => {
    const k = clock(695_000);
    // From 10:00 in Italy, so that 12 hours later is not yet the night.
    const t0 = NOON - 3 * H;
    await k.set(700_000, t0);
    await k.set(699_000, t0 + H);
    await k.set(701_000, t0 + 2 * H);
    expect(k.posts).toHaveLength(1);
    await k.set(699_000, t0 + REPEAT_MS - 1);
    await k.set(701_000, t0 + REPEAT_MS);
    expect(k.events()).toEqual([
      'posted 700000: 700000 balls',
      'skipped 700000 posted 120 min ago',
      'posted 700000: 701000 balls',
    ]);
  });

  it('holds a crossing of the night until 08:00 in Italy, with the numbers then', async () => {
    const k = clock(695_000);
    await k.set(710_000, NIGHT);
    await k.set(760_000, NIGHT + H);
    await k.set(755_000, NIGHT + 2 * H);
    expect(k.posts).toEqual([]);
    expect(k.c.state.pending).toBe(750_000);
    await k.set(755_000, MORNING - 60_000);
    expect(k.posts).toEqual([]);
    await k.set(755_000, MORNING);
    expect(k.events()).toEqual([
      'held 700000 until 08:00',
      'held 750000 until 08:00',
      'posted 750000: 755000 balls',
    ]);
    expect(k.posts[0]).toContain('Ci sono 755.000 palle in circolazione.');
    expect(k.c.state.pending).toBeUndefined();
  });

  it('drops the night threshold if the total fell back below it by 08:00', async () => {
    const k = clock(695_000);
    await k.set(710_000, NIGHT);
    await k.set(690_000, NIGHT + H);
    await k.set(690_000, MORNING);
    expect(k.posts).toEqual([]);
    expect(k.c.state.pending).toBeUndefined();
  });

  it('posts a higher crossing at 08:00 instead of the night threshold', async () => {
    const k = clock(695_000);
    await k.set(710_000, NIGHT);
    await k.set(810_000, MORNING);
    expect(k.events()).toEqual(['held 700000 until 08:00', 'posted 800000: 810000 balls']);
  });

  it('puts the kept balances back, unless the game state has newer ones, and posts what was missed', async () => {
    const kept: ClockState = {
      level: 13,
      posted: { 650000: NOON - H },
      balances: {
        Juno: { balls: 1, at: -1 },
        Gianpier: { balls: 249_845, at: 5 },
      },
    };
    const k = clock(460_000, kept);
    expect(k.state.player('Juno').balance).toEqual({ balls: 460_000, at: 0 });
    expect(k.state.player('Gianpier').balance).toEqual({ balls: 249_845, at: 5 });
    k.c.check();
    await new Promise((r) => setTimeout(r, 0));
    expect(k.events()).toEqual(['posted 700000: 709845 balls']);
    expect(k.saves.at(-1)?.balances).toEqual({
      Juno: { balls: 460_000, at: 0 },
      Gianpier: { balls: 249_845, at: 5 },
    });
    // Posts older than the repeat are forgotten.
    await k.set(460_000, NOON + REPEAT_MS - H);
    expect(Object.keys(k.c.state.posted)).toEqual(['700000']);
  });

  it('saves only what changed', async () => {
    const k = clock(10_000);
    await k.set(10_000);
    expect(k.saves).toHaveLength(2);
    await k.set(10_000);
    expect(k.saves).toHaveLength(2);
    await k.set(11_000);
    expect(k.saves).toHaveLength(3);
  });

  it('reports a post that fails', async () => {
    const k = clock(695_000);
    k.failing();
    await k.set(700_000);
    expect(k.events()).toEqual(['failed 700000: 700000 balls: Error: 403: bot was kicked']);
  });
});

describe('initialClock', () => {
  it('keeps the level and the balances, with nothing posted', () => {
    const state = new GameState();
    state.player('Juno').balance = { balls: 422_865, at: 1 };
    state.player('Gianpier').balance = { balls: 249_845, at: 2 };
    state.player('Nobody');
    expect(initialClock(state)).toEqual({
      level: 13,
      posted: {},
      balances: { Juno: { balls: 422_865, at: 1 }, Gianpier: { balls: 249_845, at: 2 } },
    });
  });
});

describe('isQuiet', () => {
  it('is quiet from 00:00 to 08:00 in Italy, in winter and in summer time', () => {
    expect(isQuiet(Date.UTC(2026, 9, 28, 22, 59))).toBe(false); // 23:59 CET
    expect(isQuiet(Date.UTC(2026, 9, 28, 23, 0))).toBe(true); // 00:00 CET
    expect(isQuiet(Date.UTC(2026, 9, 29, 6, 59))).toBe(true); // 07:59 CET
    expect(isQuiet(Date.UTC(2026, 9, 29, 7, 0))).toBe(false); // 08:00 CET
    expect(isQuiet(Date.UTC(2026, 9, 20, 5, 59))).toBe(true); // 07:59 CEST
    expect(isQuiet(Date.UTC(2026, 9, 20, 6, 0))).toBe(false); // 08:00 CEST
  });
});

describe('footerFor', () => {
  it('names the bot unless it is an admin of the group, or its name is not known yet', () => {
    const bare = 'Messaggio offerto da /aggiornamento_della_protezione_civile';
    expect(footerFor(false, 'ExampleBot')).toBe(FOOTER);
    expect(footerFor(true, 'ExampleBot')).toBe(bare);
    expect(footerFor(false, undefined)).toBe(bare);
  });
});
