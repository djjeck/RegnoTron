import { describe, expect, it } from 'vitest';
import { BanWatch, type Heard, Senders } from './bans.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const HOUR = 3_600_000;
const GROUP = '-1001';
const END = 'Sei stato bannato fino al 06/11/2026, 18:00:00.';
const BANNED_UNTIL = Date.parse('2026-11-06T17:00:00Z');

let n = 0;
/** A message heard: a player's, in the group, unless it says otherwise. */
const said = (senderUsername: string, text: string, m: Partial<Heard> = {}): Heard => ({
  chat: GROUP,
  senderUsername,
  text,
  time: T,
  id: String(n++),
  ...m,
});
/** The bot's reply to a message, in the group. */
const reply = (to: Heard, text: string, m: Partial<Heard> = {}): Heard =>
  said('LoreGameBot', text, { replyTo: to.id as string, ...m });

describe('the senders it remembers', () => {
  it('names the sender of a message, and forgets the oldest', () => {
    const s = new Senders();
    s.remember(GROUP, '1', 'bob');
    expect(s.of(GROUP, '1')).toBe('bob');
    expect(s.of('-1002', '1')).toBeUndefined();
    for (let i = 2; i < 5002; i++) s.remember(GROUP, String(i), 'carol');
    expect(s.of(GROUP, '1')).toBeUndefined();
    expect(s.of(GROUP, '5001')).toBe('carol');
  });
});

describe('the bans it watches', () => {
  it('names a banned player from the message the bot replies to, once however many replies', () => {
    const w = new BanWatch('LoreGameBot');
    const first = said('bob', '/lore');
    expect(w.hear(first, 'alice')).toBeUndefined();
    expect(w.hear(reply(first, END), 'alice')).toEqual({
      type: 'ban',
      player: 'bob',
      until: BANNED_UNTIL,
      owner: false,
    });
    // Every message of a banned player gets the ban: the same news is none.
    const more = said('bob', 'Ma perché?');
    w.hear(more, 'alice');
    expect(w.hear(reply(more, END), 'alice')).toBeUndefined();
    expect(w.until('bob', T)).toBe(BANNED_UNTIL);
    expect(w.until('bob', BANNED_UNTIL)).toBeUndefined();
    expect(w.until('carol', T)).toBeUndefined();
    // A later ban is news again.
    const again = said('bob', '/l');
    w.hear(again, 'alice');
    expect(
      w.hear(reply(again, 'Sei stato bannato fino al 07/11/2026, 18:00:00.'), 'alice')
    ).toMatchObject({ type: 'ban', until: BANNED_UNTIL + 24 * HOUR });
  });

  it('ends a ban when the bot serves the player again, and not before, nor for others', () => {
    const w = new BanWatch('LoreGameBot');
    const a = said('bob', '/lore');
    w.hear(a, 'alice');
    w.hear(reply(a, END), 'alice');
    const c = said('carol', '/lore');
    w.hear(c, 'alice');
    // Served: a turn's outcome, or a "too soon", ends only the ban of whom it replies to.
    expect(w.hear(reply(c, 'Hai ottenuto un sasso [B1]!'), 'alice')).toBeUndefined();
    // Not understood is no proof of anything.
    const b = said('bob', '/lore');
    w.hear(b, 'alice');
    expect(w.hear(reply(b, 'Boh'), 'alice')).toBeUndefined();
    expect(w.until('bob', T)).toBe(BANNED_UNTIL);
    const later = said('bob', '/lore', { time: T + HOUR });
    w.hear(later, 'alice');
    expect(
      w.hear(
        reply(later, 'Non è passato abbastanza tempo! Riprova fra 5 minuti.', { time: T + HOUR }),
        'alice'
      )
    ).toEqual({ type: 'unban', player: 'bob', owner: false });
    expect(w.until('bob', T)).toBeUndefined();
    // Once over, no news: the player's served again at every turn.
    expect(w.hear(reply(later, 'Hai ottenuto un sasso [B1]!'), 'alice')).toBeUndefined();
  });

  it('says nothing of a ban already over by the message’s time, nor of a reply it cannot place', () => {
    const w = new BanWatch('LoreGameBot');
    const a = said('bob', '/lore', { time: T + 9 * HOUR });
    w.hear(a, 'alice');
    expect(w.hear(reply(a, END, { time: T + 9 * HOUR }), 'alice')).toBeUndefined();
    // Whose message it replies to is not known (older than what it heard, or no reply at all).
    expect(w.hear(said('LoreGameBot', END, { replyTo: '999999' }), 'alice')).toBeUndefined();
    expect(w.hear(said('LoreGameBot', END), 'alice')).toBeUndefined();
    // A message of another chat, or an id with no sender, is no one's.
    w.hear(said('', '/lore', { id: '5' }), 'alice');
    expect(w.hear(said('LoreGameBot', END, { replyTo: '5' }), 'alice')).toBeUndefined();
    expect(w.entries()).toEqual([]);
  });

  it('knows the owner in private, whoever the bot replies to, and by their messages in the group', () => {
    const w = new BanWatch('loregamebot');
    const dm = { chat: '@LoreGameBot', private: true };
    expect(w.hear(said('LoreGameBot', END, dm), 'alice')).toEqual({
      type: 'ban',
      player: 'alice',
      until: BANNED_UNTIL,
      owner: true,
    });
    // The owner's own messages in the group are theirs, whatever its sender says.
    const mine = said('', '/lore', { own: true });
    w.hear(mine, 'alice');
    expect(
      w.hear(reply(mine, 'Sei stato bannato fino al 07/11/2026, 18:00:00.'), 'alice')
    ).toMatchObject({
      player: 'alice',
      owner: true,
    });
    // The account's name not known yet: the shell's name for it.
    const w2 = new BanWatch('LoreGameBot');
    expect(w2.hear(said('LoreGameBot', END, dm), undefined)).toMatchObject({
      player: 'me',
      owner: true,
    });
    expect(BanWatch.owner('alice')).toBe('alice');
    // What it kept comes back.
    expect(new BanWatch('LoreGameBot', w.entries()).until('alice', T)).toBe(
      BANNED_UNTIL + 24 * HOUR
    );
  });

  it('serves a player named like a prototype’s key', () => {
    const w = new BanWatch('LoreGameBot');
    const a = said('__proto__', '/lore');
    w.hear(a, 'alice');
    expect(w.hear(reply(a, END), 'alice')).toMatchObject({ type: 'ban', player: '__proto__' });
    expect(w.until('__proto__', T)).toBe(BANNED_UNTIL);
    expect(w.until('constructor', T)).toBeUndefined();
  });
});
