import { describe, expect, it } from 'vitest';
import { AccumuloWatch } from './accumulo.ts';
import { ANSWER_WINDOW_MS, BotClock, KEPT_ASKED, REPLAY_MS } from './answer-watch.ts';
import { type Heard } from './bans.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const GROUP = '-1001';
const HOUR = 3_600_000;
const SHORT = 'Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 7/20';
const USED =
  '🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore';
const CALM = 'Stai calmo maschio...';

let n = 100;
/** A message heard at `time`: a player's, in the group, unless it says otherwise. */
const said = (sender: string, text: string, time: number, m: Partial<Heard> = {}): Heard => ({
  chat: GROUP,
  sender,
  text,
  time,
  id: String(n++),
  ...m,
});
const bot = (text: string, time: number, m: Partial<Heard> = {}): Heard =>
  said('LoreGameBot', text, time, m);

describe("the bot's clock", () => {
  it('is now while the bot answers live, and stops while it is silent', () => {
    const c = new BotClock('LoreGameBot');
    expect(c.past(GROUP, T)).toBe(-Infinity);
    const lore = said('bob', '/lore', T);
    c.hear(lore);
    c.hear(bot('Hai ottenuto un sasso [B1]!', T + 1000, { replyTo: lore.id as string }));
    expect(c.past(GROUP, T)).toBe(1000);
    expect(c.replaying(GROUP)).toBe(false);
    // Players' messages move nothing: the bot is silent.
    c.hear(said('carol', '/lore', T + 5 * HOUR));
    expect(c.past(GROUP, T)).toBe(1000);
    // Another chat has a clock of its own.
    expect(c.past('@LoreGameBot', T)).toBe(-Infinity);
  });

  it('is the time of what the bot replies to, while it replays', () => {
    const c = new BotClock('LoreGameBot');
    const first = said('bob', '/lore', T);
    const second = said('carol', '/lore', T + HOUR);
    c.hear(first);
    c.hear(second);
    c.hear(bot(CALM, T + 5 * HOUR, { replyTo: first.id as string }));
    expect(c.replaying(GROUP)).toBe(true);
    expect(c.past(GROUP, T)).toBe(0);
    // A message of its own, mid-replay, tells nothing.
    c.hear(bot(USED, T + 5 * HOUR + 1000));
    expect(c.past(GROUP, T)).toBe(0);
    c.hear(bot(CALM, T + 5 * HOUR + 2000, { replyTo: second.id as string }));
    expect(c.past(GROUP, T)).toBe(HOUR);
    // Caught up: a reply within the minute is live again, and its own messages now.
    const fresh = said('dave', '/lore', T + 5 * HOUR + 3000);
    c.hear(fresh);
    c.hear(bot(CALM, T + 5 * HOUR + 4000, { replyTo: fresh.id as string }));
    expect(c.replaying(GROUP)).toBe(false);
    c.hear(bot(USED, T + 5 * HOUR + 9000));
    expect(c.past(GROUP, T)).toBe(5 * HOUR + 9000);
  });

  it('does not move on a message of its own after a silence, until a reply tells', () => {
    const c = new BotClock('LoreGameBot');
    // Its first words: nothing known yet, one after the other or not.
    c.hear(bot(USED, T));
    c.hear(bot(USED, T + 1000));
    expect(c.past(GROUP, T)).toBe(-Infinity);
    // A reply within the minute: live, and its own messages move the clock on.
    const lore = said('bob', '/lore', T + 2000);
    c.hear(lore);
    c.hear(bot(CALM, T + 3000, { replyTo: lore.id as string }));
    c.hear(bot(USED, T + 4000));
    expect(c.past(GROUP, T)).toBe(4000);
    // Silent past the minute: its next word of its own may be a replay's, and the next too.
    c.hear(bot(USED, T + 4001 + REPLAY_MS));
    c.hear(bot(USED, T + 5000 + REPLAY_MS));
    expect(c.past(GROUP, T)).toBe(4000);
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

  it('keeps at most KEPT_ASKED commands, the oldest given up first', () => {
    const w = new AccumuloWatch('LoreGameBot');
    for (let i = 0; i <= KEPT_ASKED; i++) w.answer(said(`p${i}`, '/acc', T + i), 'alice');
    expect(w.answer(bot(SHORT, T + HOUR), 'alice')).toMatchObject({ player: 'p1' });
  });
});
