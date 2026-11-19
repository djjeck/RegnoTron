import { describe, expect, it } from 'vitest';
import {
  ForcedWatch,
  initialSchedule,
  MarketWatch,
  parseMarket,
  type Point,
  scheduled,
  SERIES_KEPT,
  withPoint,
} from './market.ts';

// Invented companies and players; the bot's own words are the game's.
const MARKET = '📈 Mercato Fazionario 📉';

describe('the market', () => {
  it('reads an update: each company, its value, its change and its direction', () => {
    expect(
      parseMarket(
        `${MARKET} aggiornato!\n\n↗ Pinco Spa 🍕: 1.150 (+50, +4.55%)\n↘ Pallino & Co ⚓️: 56 (-44, -44.00%)\n→ Tizio Srl: 100 (0, 0.00%)`
      )
    ).toEqual({
      kind: 'update',
      quotes: [
        { company: 'Pinco Spa 🍕', value: 1150, change: 50, pct: 4.55, direction: 'up' },
        { company: 'Pallino & Co ⚓️', value: 56, change: -44, pct: -44, direction: 'down' },
        { company: 'Tizio Srl', value: 100, change: 0, pct: 0, direction: 'flat' },
      ],
    });
  });

  it('reads the market with the asker’s investments, none, or none told', () => {
    expect(
      parseMarket(
        [
          MARKET,
          '',
          '↘ Pinco Spa 🍕: 113 (-1, -0.88%)',
          '',
          'I tuoi investimenti',
          '> Pinco Spa 🍕: 800 ₭ investiti, valore 874 ₭ (+9.25%)',
          '',
          'Totale investito: 800 ₭',
          'Valore attuale: 1.874 ₭ (+9.25%)',
        ].join('\n')
      )
    ).toEqual({
      kind: 'market',
      quotes: [{ company: 'Pinco Spa 🍕', value: 113, change: -1, pct: -0.88, direction: 'down' }],
      positions: [{ company: 'Pinco Spa 🍕', invested: 800, value: 874, pct: 9.25 }],
      total: { invested: 800, value: 1874, pct: 9.25 },
    });
    expect(
      parseMarket(`${MARKET}\n\n→ Tizio Srl: 100 (0, 0.00%)\n\nNon hai investimenti attivi.`)
    ).toMatchObject({ kind: 'market', positions: [], total: null });
    expect(parseMarket(`${MARKET}\n\nNessuna azienda quotata.`)).toEqual({
      kind: 'market',
      quotes: [],
      positions: null,
      total: null,
    });
    // A line it cannot read: not the market.
    expect(parseMarket(`${MARKET}\n\nqualcosa\n\nNon hai investimenti attivi.`)).toBeUndefined();
    expect(parseMarket(`${MARKET}\n\n→ Tizio Srl: 100 (0, 0.00%)`)).toBeUndefined();
  });

  it('reads an investment and a withdrawal, of a part or of all', () => {
    expect(
      parseMarket(
        'Hai puntato 1.000 ₭ su Pinco Spa 🍕.\nTotale investito: 1.000 ₭ al valore iniziale 83.\nTi rimangono 0 ₭.'
      )
    ).toEqual({
      kind: 'invest',
      company: 'Pinco Spa 🍕',
      amount: 1000,
      invested: 1000,
      entry: 83,
      coins: 0,
    });
    expect(
      parseMarket(
        'Hai riscosso 500 ₭ da Pinco Spa 🍕.\nIncasso: 500 ₭ (0.00%).\nValore rimasto: 400 ₭.'
      )
    ).toEqual({
      kind: 'cashout',
      company: 'Pinco Spa 🍕',
      amount: 500,
      cashed: 500,
      pct: 0,
      left: 400,
    });
    expect(parseMarket('Hai riscosso 50 ₭ da Tizio Srl.\nIncasso: 50 ₭ (-23.00%).')).toMatchObject({
      kind: 'cashout',
      left: null,
      pct: -23,
    });
    expect(
      parseMarket(
        `Hai riscosso tutti gli investimenti dal ${MARKET}.\n\n> Tizio Srl: 419 ₭ investiti, incasso 429 ₭\n\nTotale ritirato: 419 ₭\nIncasso totale: 429 ₭ (+2.39%)`
      )
    ).toEqual({
      kind: 'cashout-all',
      positions: [{ company: 'Tizio Srl', invested: 419, cashed: 429 }],
      invested: 419,
      cashed: 429,
      pct: 2.39,
    });
  });

  it('reads a company’s page: its leader, its members, its value', () => {
    const page = [
      'Azienda Pinco Spa (2/20)',
      '',
      '👑 Alice',
      '',
      '⚔️ 2.303',
      '',
      '👥 2 membri',
      '',
      '- 😇 Alice [L6] (1.640 ⚔️)',
      '',
      '- 👿 Bob [L4] (663 ⚔️)',
      '',
      '📈 Valore: 81',
    ];
    expect(parseMarket(page.join('\n'))).toEqual({
      kind: 'company',
      name: 'Pinco Spa',
      size: 2,
      max: 20,
      leader: 'Alice',
      power: 2303,
      members: [
        { player: 'Alice', faction: '😇', level: 6, power: 1640 },
        { player: 'Bob', faction: '👿', level: 4, power: 663 },
      ],
      value: 81,
      profile: null,
    });
    expect(parseMarket([...page, 'Profilo: SAFE'].join('\n'))).toMatchObject({ profile: 'SAFE' });
    expect(parseMarket([...page, 'Profilo: SAFE', 'altro'].join('\n'))).toBeUndefined();
    expect(parseMarket(page.slice(0, -1).join('\n'))).toBeUndefined();
    expect(parseMarket('Azienda non trovata!')).toBeUndefined();
  });

  it('reads none of a message whose lines it cannot all read', () => {
    const quote = '→ Tizio Srl: 100 (0, 0.00%)';
    for (const text of [
      `${MARKET} aggiornato!\n\n${quote}\naltro`,
      `${MARKET}\n\nNessuna azienda quotata.\n\nNon hai investimenti attivi.\naltro`,
      `${MARKET}\n\n${quote}\n\nI tuoi investimenti\n> Tizio Srl: 1 ₭ investiti, valore 1 ₭ (0.00%)\n\nTotale investito: 1 ₭`,
      `Hai riscosso tutti gli investimenti dal ${MARKET}.\n\n> Tizio Srl: 1 ₭ investiti, incasso 1 ₭\n\nTotale ritirato: 1 ₭`,
      'Azienda Tizio Srl (1/20)\n\n👑 bob',
      'Azienda Tizio Srl (1/20)\n\n👑 bob\n\n⚔️ 5\n\n👥 1 membri\n\n- 😇 bob [L1] (5 ⚔️)',
    ])
      expect(parseMarket(text)).toBeUndefined();
    // A market of no company quoted, and the asker's investments: none.
    expect(
      parseMarket(`${MARKET}\n\nNessuna azienda quotata.\n\nNon hai investimenti attivi.`)
    ).toMatchObject({ quotes: [], positions: [] });
  });

  it('pairs each answer with the command waiting, and an update made out of turn with its own', () => {
    const watch = new MarketWatch('LoreGameBot', ['/punta', '/investi'], ['invest']);
    const at = (sender: string, text: string, time: number, chat = '-100') => ({
      chat,
      sender,
      text,
      time,
      id: String(time),
    });
    expect(watch.answer(at('bob', '/investi 30 Pinco', 0), 'alice')).toBeUndefined();
    expect(
      watch.answer(
        at(
          'LoreGameBot',
          'Hai puntato 30 ₭ su Pinco Spa 🍕.\nTotale investito: 30 ₭ al valore iniziale 101.\nTi rimangono 82 ₭.',
          1000
        ),
        'alice'
      )
    ).toMatchObject({ player: 'bob', owner: false, reply: { kind: 'invest', amount: 30 } });
    // Another kind of the market's answers is not this watch's.
    expect(
      watch.answer(
        at('LoreGameBot', 'Hai riscosso 5 ₭ da Tizio Srl.\nIncasso: 5 ₭ (0.00%).', 2000),
        'alice'
      )
    ).toBeUndefined();
    const forced = new ForcedWatch('LoreGameBot');
    const update = `${MARKET} aggiornato!\n\n→ Tizio Srl: 100 (0, 0.00%)`;
    // The bot's own update, with no command waiting: not forced, in private too.
    expect(forced.answer(at('LoreGameBot', update, 0, '@LoreGameBot'), 'alice')).toBeUndefined();
    forced.answer(at('carol', '/aggiornaborsa', 5000), 'alice');
    expect(forced.answer(at('LoreGameBot', update, 6000), 'alice')).toMatchObject({
      player: 'carol',
    });
  });
});

describe('a company’s series, and the bot’s schedule', () => {
  const T = Date.parse('2026-11-01T00:00:00Z');
  const H = 3_600_000;
  const at = (ms: number) => new Date(T + ms).toISOString();
  const point = (ms: number, value: number, via: Point['via'] = 'update'): Point => ({
    t: at(ms),
    value,
    change: 0,
    pct: 0,
    via,
  });

  it('keeps each point in its place, once, and a listing only when it tells something new', () => {
    let s = withPoint([], point(6 * H, 100));
    s = withPoint(s, point(0, 90)); // history told late: before it
    s = withPoint(s, point(6 * H + 30_000, 100)); // the same update heard again
    s = withPoint(s, point(7 * H, 100, 'listing')); // the value the point before holds
    s = withPoint(s, point(8 * H, 104, 'listing'));
    expect(s.map((p) => [p.t, p.value, p.via])).toEqual([
      [at(0), 90, 'update'],
      [at(6 * H), 100, 'update'],
      [at(8 * H), 104, 'listing'],
    ]);
    // An update told late, the same as the one just after it: once.
    expect(withPoint(s, point(6 * H - 60_000, 100))).toHaveLength(3);
    // The oldest go past the most kept.
    let long: Point[] = [];
    for (let i = 0; i <= SERIES_KEPT; i++) long = withPoint(long, point(i * H, i));
    expect(long).toHaveLength(SERIES_KEPT);
    expect(long[0]?.value).toBe(1);
  });

  it('learns the interval from the updates’ times, marks those a jump skipped, and one off it', () => {
    let s = initialSchedule();
    const tell = (ms: number) => {
      const r = scheduled(s, T + ms);
      s = r.schedule;
      return r.on;
    };
    // Not yet learnt: each is on schedule.
    for (const h of [0, 6, 12, 18]) expect(tell(h * H)).toBe(true);
    expect(s).toMatchObject({ period_min: 360, last: at(18 * H), missed: [] });
    // The same update again, and one told late: nothing moves.
    expect(tell(18 * H + 60_000)).toBe(true);
    expect(tell(6 * H)).toBe(true);
    expect(tell(7 * H)).toBe(false);
    expect(s.last).toBe(at(18 * H));
    // Off the schedule: out of turn.
    expect(tell(20 * H + 45 * 60_000)).toBe(false);
    expect(s.last).toBe(at(18 * H));
    // Two missed, the third on schedule (a few minutes late).
    expect(tell(36 * H + 3 * 60_000)).toBe(true);
    expect(s).toMatchObject({ last: at(36 * H + 3 * 60_000), missed: [at(24 * H), at(30 * H)] });
  });

  it('learns the interval most seen, not one seen once, nor the same update’s echo', () => {
    let s = initialSchedule();
    const tell = (minutes: number) => (s = scheduled(s, T + minutes * 60_000).schedule);
    // 360 three times, 300 once: 360.
    for (const m of [0, 360, 660, 1020, 1380]) tell(m);
    expect(s.period_min).toBe(360);
    // A gap of under 2.5 minutes is no interval, past the echo's 2.
    s = { ...initialSchedule(), last: at(0), gaps_min: [2, 2, 2] };
    tell(500);
    expect(s.period_min).toBeNull();
  });

  it('moves with the bot’s clock: an update off the schedule the next follows by an interval', () => {
    let s = initialSchedule();
    for (const h of [0, 6, 12, 18]) s = scheduled(s, T + h * H).schedule;
    // An hour later than the schedule, as summer time ends: out of turn, kept as maybe the new one.
    const first = scheduled(s, T + 25 * H);
    expect(first).toMatchObject({ on: false, schedule: { last: at(18 * H), pending: at(25 * H) } });
    // The next an interval after it: the schedule moved, from the first.
    const next = scheduled(first.schedule, T + 31 * H);
    expect(next).toEqual({
      on: true,
      moved: at(25 * H),
      schedule: expect.objectContaining({ last: at(31 * H), pending: null }) as unknown,
    });
    expect(scheduled(next.schedule, T + 37 * H)).toMatchObject({
      on: true,
      schedule: { missed: [] },
    });
    // One out of turn that the next does not follow by an interval: nothing moves.
    const odd = scheduled(next.schedule, T + 33 * H);
    expect(scheduled(odd.schedule, T + 35 * H)).toMatchObject({
      on: false,
      schedule: { last: at(31 * H), pending: at(35 * H) },
    });
  });
});
