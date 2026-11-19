import { type Inbound } from '@megabottron1999/core';
import { initialPlayer, initialState } from '@regnotron/game-bots/loregame-state.ts';
import { describe, expect, it } from 'vitest';
import { seedOf, usernames } from './seed.ts';

// Invented players and companies.
const at = (id: number, sender: string, text: string, replyTo?: number): Inbound => ({
  account: 'telegram:alice',
  network: 'telegram',
  chat: '-1001',
  sender,
  text,
  time: id * 1000,
  id: String(id),
  playback: true,
  ...(replyTo === undefined ? {} : { replyTo: String(replyTo) }),
});
const profile = (username: string) =>
  `👤 ${username}\n\n👥 Nessuna azienda\n\nLivello 1 (0 ⚔️)\n\nIl Bene 😇\nEpisodio 1\n0 ₭`;

describe('the market’s seed', () => {
  it('names each player by the username their own profile tells', () => {
    const names = usernames(
      [
        at(1, 'Bob Rossi', '/info'),
        at(2, 'LoreGameBot', profile('bob_r'), 1),
        // Another's profile asked for: not the asker's.
        at(3, 'Carol', '/info dave'),
        at(4, 'LoreGameBot', profile('dave'), 3),
        at(5, 'Carol', '/me@LoreGameBot'),
        at(6, 'LoreGameBot', profile('carol99'), 5),
        // The first told wins.
        at(7, 'Bob Rossi', '/me'),
        at(8, 'LoreGameBot', profile('someone'), 7),
      ],
      'LoreGameBot'
    );
    expect([...names]).toEqual([
      ['Bob Rossi', 'bob_r'],
      ['Carol', 'carol99'],
    ]);
  });

  it('keeps the market and the companies whole, and each investing player by username', () => {
    const s = initialState();
    const position = { invested: 10, entry: 100, value: 12, as_of: '2026-05-18T16:00:00.000Z' };
    s.players = {
      'Bob Rossi': { ...initialPlayer(position.as_of), investments: { 'Pinco Spa 🍕': position } },
      Stranger: { ...initialPlayer(position.as_of), investments: { 'Tizio Srl': position } },
      Idle: initialPlayer(position.as_of),
    };
    expect(seedOf(s, new Map([['Bob Rossi', 'bob_r']]))).toEqual({
      market: s.market,
      companies: s.companies,
      players: {
        bob_r: { investments: { 'Pinco Spa 🍕': position } },
        Stranger: { investments: { 'Tizio Srl': position } },
      },
    });
  });
});
