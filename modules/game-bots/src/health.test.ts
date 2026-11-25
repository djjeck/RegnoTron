import { describe, expect, it } from 'vitest';
import { type Heard } from './bans.ts';
import { ANSWER_WAIT_MS, DOWN_MS, HealthWatch, SUSPECT_MS } from './health.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const GROUP = '-1001';
const DM = '@LoreGameBot';
const HOUR = 3_600_000;
const GAIN = 'Hai ottenuto un sasso [B1]!';
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
/** A player's command, and the bot's reply to it `lag` later: the health after the reply. */
const answered = (h: HealthWatch, t: number, lag: number, text = GAIN) => {
  const c = said('bob', '/lore', t);
  h.hear(c);
  return h.hear(bot(text, t + lag, { replyTo: c.id as string }));
};

describe("the bot's health", () => {
  it('is up while the bot answers live, its latency kept', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    expect(h.current()).toMatchObject({ state: 'up', since: T });
    expect(answered(h, T, 1000)).toBeUndefined();
    expect(h.current()).toMatchObject({ state: 'up', latency: 1000 });
    // Nothing waits: no tick can move it.
    expect(h.due()).toBeUndefined();
    expect(h.tick(T + HOUR)).toBeUndefined();
    // A late reply, the bot otherwise live, is no outage.
    expect(answered(h, T + HOUR, 3 * 60_000)).toBeUndefined();
    expect(h.current()).toMatchObject({ state: 'up', latency: 3 * 60_000 });
  });

  it("waits only on its bot's commands: not another bot's, nor words", () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    expect(h.isCommand('/lore@LoreGameBot')).toBe(true);
    expect(h.isCommand('/give bob sasso')).toBe(true);
    expect(h.isCommand('/lore@OtherBot')).toBe(false);
    expect(h.isCommand('/dai bob sasso')).toBe(false);
    expect(h.isCommand('ciao')).toBe(false);
    h.hear(said('bob', '/raid', T));
    h.hear(said('bob', 'ciao', T));
    expect(h.due()).toBeUndefined();
  });

  it('is suspect after a minute of silence while a command waits, the oldest', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.hear(said('bob', '/lore', T));
    h.hear(said('carol', '/avventura', T + 30_000));
    expect(h.due()).toBe(T + SUSPECT_MS);
    expect(h.tick(T + SUSPECT_MS - 1)).toBeUndefined();
    expect(h.tick(T + SUSPECT_MS)).toEqual({
      state: 'suspect',
      since: T + SUSPECT_MS,
      reason: 'silent for 60 s while a command waited',
    });
    // Any word of the bot's ends the wait: a command answered or lost, it spoke.
    const live = new HealthWatch('LoreGameBot', undefined, T);
    live.hear(said('bob', '/lore', T));
    live.hear(bot('Un messaggio qualunque', T + 1000));
    expect(live.tick(T + SUSPECT_MS)).toBeUndefined();
  });

  it('is up again when a command sent while suspect is answered fresh: in private, any word', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.hear(said('bob', '/lore', T));
    h.tick(T + SUSPECT_MS);
    // A probe, a send of the owner's account another node made; the bot's next word there answers it.
    h.sent({ chat: DM, id: '7', t: T + SUSPECT_MS + 1000, command: '/info' });
    expect(h.due()).toBe(T + SUSPECT_MS + 1000 + ANSWER_WAIT_MS);
    expect(h.hear(bot('Profilo', T + SUSPECT_MS + 3000, { chat: DM }))).toEqual({
      state: 'up',
      since: T + SUSPECT_MS + 3000,
      reason: 'a reply in 2 s',
      latency: 2000,
    });
    // The owner's own, by hand, in private: the same.
    const hand = new HealthWatch('LoreGameBot', undefined, T);
    hand.hear(said('bob', '/lore', T));
    hand.tick(T + SUSPECT_MS);
    hand.hear(said('alice', '/info', T + SUSPECT_MS + 1000, { own: true, chat: DM }));
    expect(hand.hear(bot('Profilo', T + SUSPECT_MS + 6000, { chat: DM }))).toMatchObject({
      state: 'up',
      reason: 'a reply in 5 s',
    });
  });

  it('is down when a command sent while suspect goes unanswered, whoever sent it', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    // Sent before the suspicion: it waits, but tests nothing.
    h.sent({ chat: DM, id: '6', t: T, command: '/info' });
    h.tick(T + SUSPECT_MS);
    expect(h.current().state).toBe('suspect');
    expect(h.due()).toBe(T + DOWN_MS);
    h.hear(said('carol', '/lore', T + SUSPECT_MS + 1000));
    expect(h.tick(T + SUSPECT_MS + 1000 + ANSWER_WAIT_MS)).toMatchObject({
      state: 'down',
      reason: 'a command sent while suspect went unanswered for 120 s',
    });
    expect(h.due()).toBeUndefined();
  });

  it('is down after five minutes of silence, nothing sent since the suspicion', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.sent({ chat: GROUP, id: '5', t: T });
    expect(h.tick(T + SUSPECT_MS)?.state).toBe('suspect');
    expect(h.tick(T + DOWN_MS)).toMatchObject({
      state: 'down',
      reason: 'silent for 300 s while a command waited',
    });
  });

  it('reads a word of the bot in private after no send of the owner as no reply', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.hear(said('bob', '/lore', T));
    h.tick(T + SUSPECT_MS);
    expect(
      h.hear(bot('Un messaggio qualunque', T + SUSPECT_MS + 1000, { chat: DM }))
    ).toMatchObject({
      state: 'catching-up',
      reason: 'the bot speaks again, replying to nothing it can place',
    });
  });

  it('starts from nothing known when it kept a state it no longer tells (0.50.0’s slow)', () => {
    const h = new HealthWatch(
      'LoreGameBot',
      { health: { state: 'slow' as 'up', since: T, reason: 'old' }, lastWord: null },
      T + HOUR
    );
    expect(h.current()).toEqual({ state: 'up', since: T + HOUR, reason: 'nothing heard yet' });
  });

  it('catches up through a replay in bursts, and is up only at a fresh reply', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    const before = said('bob', '/lore', T);
    h.hear(before);
    h.tick(T + SUSPECT_MS);
    h.tick(T + DOWN_MS);
    expect(h.current().state).toBe('down');
    // A burst: the replay's replies, hours late.
    expect(h.hear(bot(CALM, T + 10 * HOUR, { replyTo: before.id as string }))).toMatchObject({
      state: 'catching-up',
      reason: 'the bot replies again, 36000 s late',
      latency: 10 * HOUR,
    });
    // Silent again, a command waiting: down again.
    h.hear(said('carol', '/lore', T + 10 * HOUR + 1000));
    expect(h.tick(T + 10 * HOUR + 1000 + DOWN_MS)?.state).toBe('down');
    // A message of its own, back: catching up, and still so at a late reply.
    expect(h.hear(bot('Un messaggio qualunque', T + 13 * HOUR))).toMatchObject({
      state: 'catching-up',
      reason: 'the bot speaks again, replying to nothing it can place',
    });
    expect(answered(h, T + 13 * HOUR, 2 * 60_000)).toBeUndefined();
    expect(h.hear(bot('Un messaggio qualunque', T + 13 * HOUR + 3 * 60_000))).toBeUndefined();
    expect(answered(h, T + 14 * HOUR, 500)).toMatchObject({ state: 'up', latency: 500 });
  });

  it('is up at once when the bot answers fresh after a short stall', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.hear(said('bob', '/lore', T));
    h.tick(T + SUSPECT_MS);
    expect(answered(h, T + 70_000, 2000)?.state).toBe('up');
  });

  it('keeps its health and the last word across a restart', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    expect(h.kept()).toEqual({ health: h.current(), lastWord: null });
    h.hear(said('bob', '/lore', T));
    h.tick(T + SUSPECT_MS);
    h.tick(T + DOWN_MS);
    h.hear(bot('Un messaggio qualunque', T + HOUR));
    const back = new HealthWatch('LoreGameBot', h.kept(), T + 2 * HOUR);
    expect(back.current()).toEqual(h.current());
    expect(back.kept().lastWord).toBe(T + HOUR);
    // A command sent before the bot's last word waits for nothing.
    back.hear(said('bob', '/lore', T + HOUR - 1000));
    expect(back.due()).toBeUndefined();
  });
});
