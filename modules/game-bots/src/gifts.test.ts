import { describe, expect, it } from 'vitest';
import { GiftWatch, parseGift } from './gifts.ts';

describe('/give and /dai', () => {
  it('reads items and coins sent, the receiver as the giver typed them', () => {
    expect(parseGift('Hai inviato 2x un sasso [B1] a bob!')).toEqual({
      kind: 'item',
      to: 'bob',
      qty: 2,
      item: 'un sasso',
      rarity: 'B1',
      tags: [],
      level: null,
    });
    expect(
      parseGift('[N] Hai inviato 1x un mestolo (2 - 6) [M2] [equipaggiabile 🗡] a @BoB!')
    ).toMatchObject({
      to: 'BoB',
      item: 'un mestolo',
      level: { low: 2, high: 6 },
      tags: ['equipaggiabile 🗡'],
    });
    expect(parseGift('Hai inviato 30 monete a @bob!')).toEqual({
      kind: 'coins',
      to: 'bob',
      coins: 30,
    });
    expect(parseGift("Non possiedi l'oggetto!")).toBeUndefined();
    expect(parseGift('Hai inviato tutto a bob!')).toBeUndefined();
  });

  it('gives each answer, a message of its own, to the command waiting', () => {
    const w = new GiftWatch('LoreGameBot');
    const T = Date.parse('2026-11-06T12:00:00Z');
    w.answer({ chat: '-1001', sender: 'carol', text: '/dai bob sasso', time: T, id: '1' }, 'alice');
    expect(
      w.answer(
        {
          chat: '-1001',
          sender: 'LoreGameBot',
          text: 'Hai inviato 1x un sasso [B1] a bob!',
          time: T + 1000,
        },
        'alice'
      )
    ).toMatchObject({ player: 'carol', owner: false, reply: { to: 'bob', qty: 1 } });
  });
});
