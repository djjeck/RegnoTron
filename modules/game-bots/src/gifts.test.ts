import { describe, expect, it } from 'vitest';
import { GIFT_ECHO_MS, GiftWatch, parseGift, parseReceived } from './gifts.ts';

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
    // One coin is "una moneta".
    expect(parseGift('[N] Hai inviato una moneta a bob!')).toEqual({
      kind: 'coins',
      to: 'bob',
      coins: 1,
    });
    expect(parseGift('Hai inviato 1 moneta a bob!')).toBeUndefined();
    expect(parseGift("Non possiedi l'oggetto!")).toBeUndefined();
    expect(parseGift('Hai inviato tutto a bob!')).toBeUndefined();
  });

  it('gives each answer, a message of its own, to the command waiting', () => {
    const w = new GiftWatch('LoreGameBot');
    const T = Date.parse('2026-11-06T12:00:00Z');
    w.answer(
      { chat: '-1001', senderUsername: 'carol', text: '/dai bob sasso', time: T, id: '1' },
      'alice'
    );
    expect(
      w.answer(
        {
          chat: '-1001',
          senderUsername: 'LoreGameBot',
          text: 'Hai inviato 1x un sasso [B1] a bob!',
          time: T + 1000,
        },
        'alice'
      )
    ).toMatchObject({ player: 'carol', owner: false, reply: { to: 'bob', qty: 1 } });
  });

  it('reads a gift received, as the receiver is told it in private', () => {
    expect(parseReceived('[N] Hai ricevuto 2x un mestolo (2 - 6) [M2] [usabile] da Bob!')).toEqual({
      from: 'Bob',
      gift: {
        kind: 'item',
        to: '',
        qty: 2,
        item: 'un mestolo',
        rarity: 'M2',
        tags: ['usabile'],
        level: { low: 2, high: 6 },
      },
    });
    expect(parseReceived('[N] Hai ricevuto 40 monete da @bob!')).toEqual({
      from: 'bob',
      gift: { kind: 'coins', to: '', coins: 40 },
    });
    expect(parseReceived('[N] Hai ricevuto una moneta da bob!')).toEqual({
      from: 'bob',
      gift: { kind: 'coins', to: '', coins: 1 },
    });
    expect(parseReceived('Hai ricevuto un rispetto!')).toBeUndefined();
    expect(parseGift('[N] Hai ricevuto 40 monete da bob!')).toBeUndefined();
  });
});

describe('/paga, and refusals', () => {
  const T = Date.parse('2026-11-06T12:00:00Z');
  const GROUP = '-1001';
  const hear = (
    w: GiftWatch,
    senderUsername: string,
    text: string,
    at: number,
    id: string,
    replyTo?: string
  ) =>
    w.answer(
      {
        chat: GROUP,
        senderUsername,
        text,
        time: T + at,
        id,
        ...(replyTo === undefined ? {} : { replyTo }),
      },
      'alice'
    );

  it("pairs a coin gift with its /paga, in reply to the receiver's message", () => {
    const w = new GiftWatch('LoreGameBot');
    hear(w, 'dave', 'grazie per il sasso', 0, '1');
    hear(w, 'carol', '/paga 15', 1000, '2', '1');
    expect(hear(w, 'LoreGameBot', '[N] Hai inviato 15 monete a dave!', 2000, '3')).toMatchObject({
      player: 'carol',
      owner: false,
      toOwner: false,
      reply: { kind: 'coins', coins: 15, to: 'dave' },
    });
    // One coin, its answer and the owner's echo alike: "una moneta".
    hear(w, 'carol', '/paga 1', 1500, '6', '1');
    expect(hear(w, 'LoreGameBot', '[N] Hai inviato una moneta a dave!', 1800, '7')).toMatchObject({
      player: 'carol',
      reply: { kind: 'coins', coins: 1, to: 'dave' },
    });
    // Named, addressed to the bot.
    hear(w, 'carol', '/paga@LoreGameBot @dave 4', 3000, '4');
    expect(hear(w, 'LoreGameBot', '[N] Hai inviato 4 monete a dave!', 4000, '5')).toMatchObject({
      player: 'carol',
      reply: { coins: 4 },
    });
  });

  it("ends a refused command's wait: a later answer is the next player's", () => {
    const w = new GiftWatch('LoreGameBot');
    hear(w, 'carol', '/paga dave 500', 0, '1');
    expect(hear(w, 'LoreGameBot', 'Non hai abbastanza soldi!', 500, '2', '1')).toBeUndefined();
    // Erin pays within 10 s of Carol's command: the answer is Erin's, not the refused Carol's.
    hear(w, 'erin', '/paga 7', 3000, '3', '99');
    expect(hear(w, 'LoreGameBot', '[N] Hai inviato 7 monete a dave!', 4000, '4')).toMatchObject({
      player: 'erin',
      reply: { coins: 7 },
    });
    // The same for an item's refusal.
    hear(w, 'carol', '/dai dave', 10_000, '5');
    expect(hear(w, 'LoreGameBot', 'Formato non valido!', 10_200, '6', '5')).toBeUndefined();
    hear(w, 'erin', '/dai dave sasso', 11_000, '7');
    expect(
      hear(w, 'LoreGameBot', 'Hai inviato 1x un sasso [B1] a dave!', 12_000, '8')
    ).toMatchObject({ player: 'erin' });
    // Nothing is left waiting for a stray answer.
    expect(
      hear(w, 'LoreGameBot', 'Hai inviato 1x un sasso [B1] a dave!', 13_000, '9')
    ).toBeUndefined();
  });
});

describe("the owner's gifts, once whichever of their messages come", () => {
  const T = Date.parse('2026-11-06T12:00:00Z');
  const GROUP = '-1001';
  const DM = '@LoreGameBot';
  /** A watch, and what each message fed to it gave: a gift, or nothing. */
  const watch = () => {
    const w = new GiftWatch('LoreGameBot');
    let n = 1;
    const feed = (
      chat: string,
      senderUsername: string,
      text: string,
      at: number,
      m: { own?: boolean } = {}
    ) => {
      const priv = chat === DM ? { private: true } : {};
      return w.answer(
        { chat, senderUsername, text, time: T + at, id: String(n++), ...priv, ...m },
        'alice'
      );
    };
    return { w, feed };
  };
  const SENT = '[N] Hai inviato 1x un mestolo (2 - 6) [M2] [equipaggiabile 🗡] a @Bob!';

  it("gives the owner's gift in the group once, its echo in private after it or before", () => {
    const { feed } = watch();
    feed(GROUP, 'alice', '/dai @Bob mestolo', 0, { own: true });
    expect(feed(GROUP, 'LoreGameBot', SENT, 1000)).toMatchObject({
      player: 'alice',
      owner: true,
      toOwner: false,
      reply: { to: 'Bob', qty: 1, item: 'un mestolo' },
    });
    expect(feed(DM, 'LoreGameBot', SENT.replace('@Bob', 'bob'), 3000)).toBeUndefined();
    // The echo first: it is the gift, and the group's answer, paired with the command, its echo.
    feed(GROUP, 'alice', '/dai @Bob mestolo', 10_000, { own: true });
    expect(feed(DM, 'LoreGameBot', SENT, 11_000)).toMatchObject({ owner: true, toOwner: false });
    expect(feed(GROUP, 'LoreGameBot', SENT, 12_000)).toBeUndefined();
  });

  it('gives two like gifts in a row twice, each answer paired with one notice', () => {
    const { feed } = watch();
    feed(GROUP, 'alice', '/dai @Bob mestolo', 0, { own: true });
    feed(GROUP, 'alice', '/dai @Bob mestolo', 500, { own: true });
    const heard = [
      feed(GROUP, 'LoreGameBot', SENT, 1000),
      feed(GROUP, 'LoreGameBot', SENT, 1500),
      feed(DM, 'LoreGameBot', SENT, 2000),
      feed(DM, 'LoreGameBot', SENT, 2500),
    ];
    expect(heard.map((g) => g !== undefined)).toEqual([true, true, false, false]);
    // Other players' gifts have no echo: two alike are two.
    feed(GROUP, 'carol', '/dai dave sasso', 10_000);
    feed(GROUP, 'carol', '/dai dave sasso', 10_100);
    expect(
      feed(GROUP, 'LoreGameBot', 'Hai inviato 1x un sasso [B1] a dave!', 11_000)
    ).toBeDefined();
    expect(
      feed(GROUP, 'LoreGameBot', 'Hai inviato 1x un sasso [B1] a dave!', 11_100)
    ).toBeDefined();
  });

  it('gives a gift played in private, or heard once, once; a notice long after is another', () => {
    const { feed } = watch();
    // Played in private: its answer alone.
    feed(DM, 'alice', '/dai bob 30', 0, { own: true });
    expect(feed(DM, 'LoreGameBot', '[N] Hai inviato 30 monete a bob!', 1000)).toMatchObject({
      owner: true,
      reply: { kind: 'coins', coins: 30 },
    });
    // Were the bot to echo it there too, the echo would be dropped.
    expect(feed(DM, 'LoreGameBot', '[N] Hai inviato 30 monete a bob!', 2000)).toBeUndefined();
    // A notice with no answer (the command unknown): the gift all the same.
    expect(feed(DM, 'LoreGameBot', '[N] Hai inviato 5 monete a bob!', 3000)).toMatchObject({
      owner: true,
      reply: { coins: 5 },
    });
    // An answer and a notice apart by more than the window: two gifts.
    feed(GROUP, 'alice', '/dai bob 30', 100_000, { own: true });
    expect(feed(GROUP, 'LoreGameBot', 'Hai inviato 30 monete a bob!', 101_000)).toBeDefined();
    expect(
      feed(DM, 'LoreGameBot', '[N] Hai inviato 30 monete a bob!', 102_000 + GIFT_ECHO_MS)
    ).toBeDefined();
  });

  it('gives a gift the owner received once: its answer in the group, its notice in private', () => {
    const { feed } = watch();
    const GOT = '[N] Hai ricevuto 1x un sasso [B1] da Bob!';
    feed(GROUP, 'bob', '/dai alice sasso', 0);
    expect(
      feed(GROUP, 'LoreGameBot', 'Hai inviato 1x un sasso [B1] a @Alice!', 1000)
    ).toMatchObject({ player: 'bob', owner: false, toOwner: true });
    expect(feed(DM, 'LoreGameBot', GOT, 3000)).toBeUndefined();
    // The notice first, the giver named alike or not (an export names them by display name).
    expect(feed(DM, 'LoreGameBot', GOT, 10_000)).toMatchObject({
      player: 'Bob',
      owner: false,
      toOwner: true,
      reply: { kind: 'item', to: 'alice', qty: 1, item: 'un sasso' },
    });
    feed(GROUP, 'Bob Rossi', '/dai alice sasso', 10_500);
    expect(
      feed(GROUP, 'LoreGameBot', 'Hai inviato 1x un sasso [B1] a alice!', 11_000)
    ).toBeUndefined();
    // Given in private: the notice alone is the gift, coins too.
    expect(feed(DM, 'LoreGameBot', '[N] Hai ricevuto 40 monete da carol!', 20_000)).toMatchObject({
      player: 'carol',
      toOwner: true,
      reply: { kind: 'coins', coins: 40, to: 'alice' },
    });
    // A notice is the bot's, in private: forwarded to the group, or written by a player, it is not.
    expect(feed(GROUP, 'LoreGameBot', GOT, 30_000)).toBeUndefined();
    expect(feed(DM, 'alice', GOT, 31_000, { own: true })).toBeUndefined();
  });
});
