import { describe, expect, it } from 'vitest';
import { type Heard } from './bans.ts';
import { PlayerWatch } from './players.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const GROUP = '-1001';
// Invented places and items; the bot's own phrases are the game's.
const TURN = 'Lore - Il Bosco Inventato ⛅️ [B1]\n\nUna storia.\nHai ottenuto un sasso [B1]!';
const SOON = 'Non è passato abbastanza tempo! Riprova fra 5 minuti.';

let n = 0;
const said = (senderUsername: string, text: string, m: Partial<Heard> = {}): Heard => ({
  chat: GROUP,
  senderUsername,
  text,
  time: T,
  id: String(n++),
  ...m,
});
const reply = (to: Heard, text: string, m: Partial<Heard> = {}): Heard =>
  said('LoreGameBot', text, { chat: to.chat, replyTo: to.id as string, ...m });

describe('whose turn the bot answered', () => {
  it('names the player of a turn command the bot replied to, the owner theirs', () => {
    const w = new PlayerWatch();
    const bob = said('bob', '/lore@LoreGameBot');
    expect(w.hear(bob, 'alice')).toBeUndefined();
    expect(w.hear(reply(bob, TURN), 'alice')).toMatchObject({
      player: 'bob',
      owner: false,
      outcome: { kind: 'gain', item: 'un sasso' },
    });
    // The owner, in the group by hand, and in private: theirs, by their username.
    const mine = said('alice', '/l', { own: true });
    w.hear(mine, 'alice');
    expect(w.hear(reply(mine, SOON), 'alice')).toMatchObject({
      player: 'alice',
      owner: true,
      outcome: { kind: 'nothing', reason: 'cooldown' },
    });
    const dm = said('alice', '/avventura', { chat: '@LoreGameBot', private: true, own: true });
    w.hear(dm, 'alice');
    expect(w.hear(reply(dm, TURN, { private: true }), 'alice')).toMatchObject({
      player: 'alice',
      owner: true,
    });
  });

  it('names no one for a reply to another command, a message it did not hear, or no username', () => {
    const w = new PlayerWatch();
    const zaino = said('bob', '/zaino');
    w.hear(zaino, 'alice');
    expect(w.hear(reply(zaino, TURN), 'alice')).toBeUndefined();
    expect(w.hear(said('LoreGameBot', TURN, { replyTo: 'unheard' }), 'alice')).toBeUndefined();
    expect(w.hear(said('LoreGameBot', TURN), 'alice')).toBeUndefined();
    // A sender the connector gives no username is no one.
    const { senderUsername: _, ...nameless } = said('', '/lore', { senderId: '7' });
    w.hear(nameless, 'alice');
    expect(w.hear(reply(nameless, TURN), 'alice')).toBeUndefined();
    // A ban, or something it cannot read, is no turn.
    const carol = said('carol', '/lore');
    w.hear(carol, 'alice');
    expect(w.hear(reply(carol, 'Sei stato bannato fino al 07/11/2026.'), 'alice')).toBeUndefined();
    const dave = said('dave', '/lore');
    w.hear(dave, 'alice');
    expect(w.hear(reply(dave, 'Manda un’immagine valida!'), 'alice')).toBeUndefined();
    // The owner before the account knows their username: no one either.
    const mine = said('alice', '/lore', { own: true });
    w.hear(mine, undefined);
    expect(w.hear(reply(mine, TURN), undefined)).toBeUndefined();
  });

  it('forgets the oldest messages', () => {
    const w = new PlayerWatch();
    const first = said('bob', '/lore');
    w.hear(first, 'alice');
    for (let i = 0; i < 5000; i++) w.hear(said('carol', 'ciao'), 'alice');
    expect(w.hear(reply(first, TURN), 'alice')).toBeUndefined();
  });
});
