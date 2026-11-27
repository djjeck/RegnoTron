import { describe, expect, it } from 'vitest';
import { AccumuloWatch } from './accumulo.ts';
import { ANSWER_WINDOW_MS, BotClock, HOLD_MESSAGES, HOLD_MS, KEPT_ASKED } from './answer-watch.ts';
import { type Heard } from './bans.ts';
import { ForcedWatch, MarketWatch } from './market.ts';
import { TrainingWatch } from './training.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const GROUP = '-1001';
const HOUR = 3_600_000;
const SHORT = 'Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 7/20';
const USED =
  '🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore';
const CALM = 'Stai calmo maschio...';

let n = 100;
/** A message heard at `time`: a player's, in the group, unless it says otherwise. */
const said = (
  senderUsername: string,
  text: string,
  time: number,
  m: Partial<Heard> = {}
): Heard => ({
  chat: GROUP,
  senderUsername,
  text,
  time,
  id: String(n++),
  ...m,
});
const bot = (text: string, time: number, m: Partial<Heard> = {}): Heard =>
  said('LoreGameBot', text, time, m);

describe("the bot's clock", () => {
  it('is the time of what the bot replies to, however late, and stops while it is silent', () => {
    const c = new BotClock('LoreGameBot');
    expect(c.past(GROUP, T)).toBe(-Infinity);
    const lore = said('bob', '/lore', T);
    c.hear(lore);
    // Live, but slow: the reply tells how far it has answered, not when it said so.
    c.hear(bot('Hai ottenuto un sasso [B1]!', T + 30_000, { replyTo: lore.id as string }));
    expect(c.past(GROUP, T)).toBe(0);
    expect(c.replaying(GROUP)).toBe(false);
    // Players' messages move nothing: the bot is silent.
    c.hear(said('carol', '/lore', T + 5 * HOUR));
    expect(c.past(GROUP, T)).toBe(0);
    // Another chat has a clock of its own.
    expect(c.past('@LoreGameBot', T)).toBe(-Infinity);
  });

  it('tells a replay from a live reply, and never goes back', () => {
    const c = new BotClock('LoreGameBot');
    const first = said('bob', '/lore', T);
    const second = said('carol', '/lore', T + HOUR);
    c.hear(first);
    c.hear(second);
    c.hear(bot(CALM, T + 5 * HOUR, { replyTo: second.id as string }));
    expect(c.replaying(GROUP)).toBe(true);
    expect(c.past(GROUP, T)).toBe(HOUR);
    // A late reply to an older message leaves the clock where it was.
    c.hear(bot(CALM, T + 5 * HOUR + 1000, { replyTo: first.id as string }));
    expect(c.past(GROUP, T)).toBe(HOUR);
    // Caught up: a reply within the minute is live again.
    const fresh = said('dave', '/lore', T + 5 * HOUR + 3000);
    c.hear(fresh);
    c.hear(bot(CALM, T + 5 * HOUR + 4000, { replyTo: fresh.id as string }));
    expect(c.replaying(GROUP)).toBe(false);
    expect(c.past(GROUP, T)).toBe(5 * HOUR + 3000);
  });

  it('never moves on a message of its own, only once it is paired with its command', () => {
    const c = new BotClock('LoreGameBot');
    c.hear(bot(USED, T));
    const lore = said('bob', '/lore', T + 2000);
    c.hear(lore);
    c.hear(bot(CALM, T + 3000, { replyTo: lore.id as string }));
    c.hear(bot(USED, T + 40_000));
    expect(c.past(GROUP, T)).toBe(2000);
    c.answered(GROUP, T + 5000);
    expect(c.past(GROUP, T)).toBe(5000);
    // An older command answered leaves it where it was; in a new chat, it starts it.
    c.answered(GROUP, T + 1000);
    expect(c.past(GROUP, T)).toBe(5000);
    c.answered('-1002', T);
    expect(c.past('-1002', T)).toBe(0);
    expect(c.replaying('-1002')).toBe(false);
  });

  it("reads a reply to the owner's send, which it is told of", () => {
    const c = new BotClock('LoreGameBot');
    c.said(GROUP, '7', T);
    c.said(GROUP, undefined, T);
    c.hear(bot(CALM, T + 2 * HOUR, { replyTo: '7' }));
    expect(c.replaying(GROUP)).toBe(true);
  });
});

describe('a watch across an outage', () => {
  it('keeps the commands waiting while the bot is silent, and pairs the replay in order', () => {
    const w = new AccumuloWatch('LoreGameBot');
    // Bob asks, the bot is down; hours later Carol asks too.
    w.answer(said('bob', '/acc', T), 'alice');
    const lore = said('dave', '/lore', T + HOUR);
    w.answer(lore, 'alice');
    w.answer(said('carol', '/acc', T + 3 * HOUR), 'alice');
    // Back: the replay, in order. Dave's turn first, then Bob's answer, of its own.
    expect(w.answer(bot(CALM, T + 5 * HOUR, { replyTo: lore.id as string }), 'alice')).toBe(
      undefined
    );
    // Bob asked before Dave: the bot answered past him. His answer never came.
    expect(w.answer(bot(USED, T + 5 * HOUR + 1000), 'alice')).toEqual({
      player: 'carol',
      owner: false,
      reply: { result: 'used' },
      asked: T + 3 * HOUR,
      replayed: true,
    });
  });

  it("gives Bob his answer when the replay comes first: the bot's clock had not moved", () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.answer(said('bob', '/acc', T), 'alice');
    w.answer(said('carol', '/acc', T + 3 * HOUR), 'alice');
    expect(w.answer(bot(SHORT, T + 5 * HOUR), 'alice')).toMatchObject({
      player: 'bob',
      asked: T,
      replayed: true,
    });
    expect(w.answer(bot(USED, T + 5 * HOUR + 1000), 'alice')).toMatchObject({
      player: 'carol',
      replayed: true,
    });
  });

  it('marks nothing replayed that came within the minute', () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.answer(said('bob', '/acc', T), 'alice');
    expect(w.answer(bot(SHORT, T + 2000), 'alice')).toEqual({
      player: 'bob',
      owner: false,
      reply: { result: 'short', count: 7, max: 20 },
      asked: T,
    });
  });

  it('gives up a command once the bot answers live past it', () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.sent({ chat: GROUP, id: '7', t: T, command: '/acc' });
    expect(w.ownerWaiting(GROUP)).toEqual(['#7']);
    const lore = said('bob', '/lore', T + ANSWER_WINDOW_MS + 1);
    w.answer(lore, 'alice');
    w.answer(
      bot('Hai ottenuto un sasso [B1]!', T + ANSWER_WINDOW_MS + 2, { replyTo: lore.id as string }),
      'alice'
    );
    expect(w.ownerWaiting(GROUP)).toEqual([]);
  });

  it('pairs an answer that comes long after its command, the bot live but slow', () => {
    const w = new AccumuloWatch('LoreGameBot');
    const lore = said('alice', '/lore', T - 20_000);
    w.answer(lore, 'alice');
    w.answer(
      bot('Hai ottenuto un sasso [B1]!', T - 19_000, { replyTo: lore.id as string }),
      'alice'
    );
    w.sent({ chat: GROUP, id: '7', t: T, command: '/accumulo' });
    expect(w.answer(bot(USED, T + 22_000), 'alice')).toEqual({
      player: 'alice',
      owner: true,
      reply: { result: 'used' },
      asked: T,
    });
  });

  it('pairs slow answers in order, the first not giving up the second', () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.sent({ chat: GROUP, id: '7', t: T, command: '/acc' });
    w.answer(said('bob', '/acc', T + 3000), 'alice');
    expect(w.answer(bot(USED, T + 22_000), 'alice')).toMatchObject({ owner: true, asked: T });
    expect(w.answer(bot(SHORT, T + 40_000), 'alice')).toMatchObject({
      player: 'bob',
      asked: T + 3000,
    });
  });

  it('keeps at most KEPT_ASKED commands, the oldest given up first', () => {
    const w = new AccumuloWatch('LoreGameBot');
    for (let i = 0; i <= KEPT_ASKED; i++) w.answer(said(`p${i}`, '/acc', T + i), 'alice');
    expect(w.answer(bot(SHORT, T + HOUR), 'alice')).toMatchObject({ player: 'p1' });
  });
});

describe('an answer heard before its command (#16)', () => {
  /** A message with the id given: the group's ids grow with each message. */
  const at = (
    senderUsername: string,
    text: string,
    time: number,
    id: string,
    m: Partial<Heard> = {}
  ) => said(senderUsername, text, time, { id, ...m });

  it("pairs the owner's own command heard after its answer, by their ids", () => {
    const w = new AccumuloWatch('LoreGameBot');
    // The answer (#11) comes first, then the owner's command (#10), in the same second.
    expect(w.answer(at('LoreGameBot', SHORT, T, '11'), 'alice')).toBeUndefined();
    expect(w.takeLate()).toEqual([]);
    expect(w.answer(at('alice', '/acc', T, '10', { own: true }), 'alice')).toBeUndefined();
    const late = w.takeLate();
    expect(late).toEqual([
      {
        message: expect.objectContaining({ id: '11', chat: GROUP }) as unknown,
        answer: {
          player: 'alice',
          owner: true,
          reply: { result: 'short', count: 7, max: 20 },
          asked: T,
        },
      },
    ]);
    expect(w.takeLate()).toEqual([]);
    // Paired, the command waits no more: the next answer is no one's.
    expect(w.answer(at('LoreGameBot', SHORT, T + 500, '12'), 'alice')).toBeUndefined();
    expect(w.takeLate()).toEqual([]);
  });

  it("pairs any player's, and only a command that came before the answer", () => {
    const w = new TrainingWatch('LoreGameBot');
    const TRAINED = '🏋🏼 Ti sei allenato! Hai imparato qualcosa di nuovo... (+10)';
    w.answer(at('LoreGameBot', TRAINED, T, '21'), 'alice');
    // A command after the answer (#22) is not its own: it waits for its answer.
    w.answer(at('bob', '/allenati', T, '22'), 'alice');
    expect(w.takeLate()).toEqual([]);
    w.answer(at('carol', '/allenati', T + 100, '20'), 'alice');
    expect(w.takeLate()).toMatchObject([{ message: { id: '21' }, answer: { player: 'carol' } }]);
    // Bob's still waits, and gets the next answer.
    expect(w.answer(at('LoreGameBot', TRAINED, T + 1000, '23'), 'alice')).toMatchObject({
      player: 'bob',
    });
  });

  it("pairs a market's answer, but never holds an update", () => {
    const w = new MarketWatch('LoreGameBot', ['/punta'], ['invest']);
    const INVEST =
      'Hai puntato 30 ₭ su Pinco Spa 🍕.\nTotale investito: 30 ₭ al valore iniziale 101.\nTi rimangono 82 ₭.';
    w.answer(at('LoreGameBot', INVEST, T, '31'), 'alice');
    w.answer(at('bob', '/punta 30 pinco', T, '30'), 'alice');
    expect(w.takeLate()).toMatchObject([
      { message: { id: '31' }, answer: { player: 'bob', reply: { kind: 'invest', amount: 30 } } },
    ]);
    const f = new ForcedWatch('LoreGameBot');
    f.answer(
      at(
        'LoreGameBot',
        '📈 Mercato Fazionario 📉 aggiornato!\n\n→ Tizio Srl: 50 (0, 0.00%)',
        T,
        '41'
      ),
      'alice'
    );
    f.answer(at('bob', '/aggiornaborsa', T, '40'), 'alice');
    expect(f.takeLate()).toEqual([]);
  });

  it('ends the wait of a command whose refusal came first', () => {
    const w = new AccumuloWatch('LoreGameBot');
    // Bob's command is refused before the account hears it: the refusal replies to it.
    w.answer(
      at('LoreGameBot', 'Devi essere almeno di livello quattro!', T, '51', { replyTo: '50' }),
      'alice'
    );
    w.answer(at('bob', '/acc', T, '50'), 'alice');
    w.answer(at('carol', '/acc', T + 1000, '52'), 'alice');
    // The next answer is Carol's: Bob's command was answered.
    expect(w.answer(at('LoreGameBot', SHORT, T + 2000, '53'), 'alice')).toMatchObject({
      player: 'carol',
    });
    expect(w.takeLate()).toEqual([]);
  });

  it("gives up a held answer past its time or its messages: no one's, as before", () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.answer(at('LoreGameBot', SHORT, T, '61'), 'alice');
    w.answer(at('alice', '/acc', T + HOLD_MS + 1, '60', { own: true }), 'alice');
    expect(w.takeLate()).toEqual([]);
    const v = new AccumuloWatch('LoreGameBot');
    v.answer(at('LoreGameBot', SHORT, T, '71'), 'alice');
    for (let i = 0; i < HOLD_MESSAGES; i++) v.answer(at('dave', 'ciao', T + 10, `8${i}`), 'alice');
    v.answer(at('alice', '/acc', T + 20, '70', { own: true }), 'alice');
    expect(v.takeLate()).toEqual([]);
    // In private, an answer with no command is the owner's at once, and never held.
    const p = new AccumuloWatch('LoreGameBot');
    expect(
      p.answer(at('LoreGameBot', SHORT, T, '91', { chat: '@LoreGameBot', private: true }), 'alice')
    ).toMatchObject({ owner: true });
    p.answer(
      at('alice', '/acc', T, '90', { chat: '@LoreGameBot', private: true, own: true }),
      'alice'
    );
    expect(p.takeLate()).toEqual([]);
  });

  it('compares the times where an id is missing, and pairs a command the player told of', () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.answer({ chat: GROUP, senderUsername: 'LoreGameBot', text: SHORT, time: T }, 'alice');
    w.answer({ chat: GROUP, senderUsername: 'bob', text: '/acc', time: T }, 'alice');
    expect(w.takeLate()).toMatchObject([{ answer: { player: 'bob' } }]);
    w.answer({ chat: GROUP, senderUsername: 'LoreGameBot', text: SHORT, time: T + 5000 }, 'alice');
    w.answer({ chat: GROUP, senderUsername: 'bob', text: '/acc', time: T + 5001 }, 'alice');
    expect(w.takeLate()).toEqual([]);
    const s = new AccumuloWatch('LoreGameBot');
    s.answer(at('LoreGameBot', SHORT, T + 6000, '101'), 'alice');
    s.sent({ chat: GROUP, id: '100', t: T + 6000, command: '/acc' });
    expect(s.takeLate()).toMatchObject([{ answer: { owner: true, player: 'alice' } }]);
  });
});
