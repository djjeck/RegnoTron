import { describe, expect, it } from 'vitest';
import { type Heard } from './bans.ts';
import {
  DOWN_MS,
  HealthWatch,
  PROBE_COMMAND,
  PROBE_WAIT_MS,
  SLOW_DOWN_MS,
  SUSPECT_MS,
} from './health.ts';

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

  it('is slow when the probe is answered, and up again at a fresh reply', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.hear(said('bob', '/lore', T));
    h.tick(T + SUSPECT_MS);
    // The probe, sent by the owner's player; the bot answers it in private.
    h.sent({ chat: DM, id: '7', t: T + SUSPECT_MS + 1000, command: PROBE_COMMAND });
    expect(h.due()).toBe(T + SUSPECT_MS + 1000 + PROBE_WAIT_MS);
    expect(h.hear(bot('Profilo', T + SUSPECT_MS + 3000, { chat: DM, replyTo: '7' }))).toEqual({
      state: 'slow',
      since: T + SUSPECT_MS + 3000,
      reason: 'the probe was answered in 2 s',
      latency: 2000,
    });
    // Late replies in the group: still slow. A fresh one: up.
    expect(answered(h, T + 2 * 60_000, 2 * 60_000)).toBeUndefined();
    expect(h.current().state).toBe('slow');
    expect(answered(h, T + 5 * 60_000, 1000)).toMatchObject({
      state: 'up',
      reason: 'a reply in 1 s',
    });
  });

  it('takes the probe the owner sends by hand, in private, of its own', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.hear(said('bob', '/lore', T));
    h.tick(T + SUSPECT_MS);
    // In the group it is no probe.
    h.hear(said('alice', '/info', T + SUSPECT_MS, { own: true }));
    h.hear(said('alice', '/info', T + SUSPECT_MS + 1000, { own: true, chat: DM }));
    expect(h.hear(bot('Profilo', T + SUSPECT_MS + 6000, { chat: DM }))).toMatchObject({
      state: 'slow',
      reason: 'the probe was answered in 5 s',
    });
  });

  it('is down when the probe goes unanswered, and a probe sent before a suspicion is none', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.sent({ chat: DM, id: '6', t: T, command: PROBE_COMMAND });
    h.tick(T + SUSPECT_MS);
    expect(h.current().state).toBe('suspect');
    h.sent({ chat: DM, id: '7', t: T + SUSPECT_MS, command: PROBE_COMMAND });
    expect(h.tick(T + SUSPECT_MS + PROBE_WAIT_MS)).toMatchObject({
      state: 'down',
      reason: 'the probe went unanswered for 120 s',
    });
    expect(h.due()).toBeUndefined();
  });

  it('is down after five minutes of silence without a probe, slow after fifteen', () => {
    const h = new HealthWatch('LoreGameBot', undefined, T);
    h.sent({ chat: GROUP, id: '5', t: T });
    expect(h.tick(T + SUSPECT_MS)?.state).toBe('suspect');
    expect(h.due()).toBe(T + DOWN_MS);
    expect(h.tick(T + DOWN_MS)).toMatchObject({
      state: 'down',
      reason: 'silent for 300 s while a command waited',
    });
    const s = new HealthWatch('LoreGameBot', undefined, T);
    s.hear(said('bob', '/lore', T));
    s.tick(T + SUSPECT_MS);
    s.sent({ chat: DM, id: '7', t: T + SUSPECT_MS, command: PROBE_COMMAND });
    s.hear(bot('Profilo', T + SUSPECT_MS + 1000, { chat: DM }));
    const t = T + SUSPECT_MS + 2000;
    s.hear(said('bob', '/lore', t));
    expect(s.due()).toBe(t + SLOW_DOWN_MS);
    expect(s.tick(t + SLOW_DOWN_MS)).toMatchObject({
      state: 'down',
      reason: 'silent for 900 s, though the probe was answered',
    });
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
