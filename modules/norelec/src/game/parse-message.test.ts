import { describe, expect, it } from 'vitest';
import { BOT_MESSAGES } from '#test/bot-messages.ts';
import { mentions } from './bot-message.ts';
import { parseHouse, parseMessage, parseProfile } from './parse-message.ts';

describe('parseMessage', () => {
  it.each(BOT_MESSAGES)('$name', ({ text, kinds }) => {
    expect(parseMessage(text).map((e) => e.kind)).toEqual(kinds);
  });

  it("gives the message's player to lines that name none", () => {
    const [, found] = parseMessage(
      'Alfa parti per Bravo: arrivi tra 58 secondi. Casa tua resta scoperta.\nLungo la via trovi 210 palle!'
    );
    expect(found).toMatchObject({ kind: 'foundBalls', balls: 210, player: { name: 'Alfa' } });
  });

  it('gives a line the player of the action just before it', () => {
    const fixture = BOT_MESSAGES.find((f) => f.name === 'an entry and a theft in one message');
    const pity = parseMessage(fixture?.text ?? '').find((e) => e.kind === 'pity');
    expect(pity).toMatchObject({ player: { name: 'Charlie' } });
  });

  it('leaves a line without a player alone when the message names none', () => {
    expect(parseMessage('Lungo la via trovi 210 palle!')[0]).not.toHaveProperty('player');
  });

  it('skips the quote of an entry when the blank line before it is lost', () => {
    const events = parseMessage(
      'Alfa sei in @TheConquister37!\nUna citazione qualunque.\nAncora citazione.'
    );
    expect(events.map((e) => e.kind)).toEqual(['entered']);
  });

  it('keeps unknown lines outside entry messages', () => {
    expect(parseMessage('Una riga nuova del bot.').map((e) => e.kind)).toEqual(['unknown']);
  });
});

describe('parseHouse', () => {
  it('reads the slots, empty ones null, several to a line', () => {
    expect(
      parseMessage('Casa di Alfa (6/10):\n1 ®️  2 🧊  3 💣  4 🧊  5\n6\n7 🧂  8 🎈  9\n10 ·')
    ).toEqual([
      {
        kind: 'house',
        line: 'Casa di Alfa (6/10):',
        player: { name: 'Alfa' },
        slots: ['®️', '🧊', '💣', '🧊', null, null, '🧂', '🎈', null, null],
      },
    ]);
    expect(
      parseHouse(
        'Casa di Bravo (10/10):\n1 🎈  2 📮  3 🐶  4 👶  5 🔥  6 🦐  7 📮  8 🔊  9 🔥  10 🌀'
      )
    ).toMatchObject({ player: { name: 'Bravo' }, slots: { 9: '🌀' } });
    expect(parseHouse('Alfa sei in @TheConquister37!')).toBeNull();
  });

  it('reads a house reply joined after a profile, and what comes after it, on their own', () => {
    // The IRC side joined the two replies (3 Nov): the house was lost inside the profile.
    const events = parseMessage(
      [
        'alice',
        'Con te: 🏴‍☠️⚡🚀🎈',
        '3561 palle, 3° su 40 in classifica',
        "1 🐔: 60 palle all'ora",
        'a casa, in @alice',
        '26 citazioni',
        'Casa di Sigma_Nova (1/10):',
        '1 🧊  2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10 ·',
        'Alfa sei in @TheConquister37!',
      ].join('\n')
    );
    expect(events.map((e) => e.kind)).toEqual(['profile', 'house', 'entered']);
    expect(events[0]).toMatchObject({ player: { name: 'alice' }, balls: 3561, hens: 1 });
    expect(events[1]).toMatchObject({
      player: { name: 'Sigma_Nova' },
      slots: { 0: '🧊', 1: null },
    });
  });
});

describe('parseProfile', () => {
  it('reads a player at home', () => {
    expect(
      parseProfile('Alfa\nCon te: 🥷🎈[]\n740 palle, 5° su 37 in classifica\na casa, in @Alfa')
    ).toMatchObject({
      kind: 'profile',
      player: { name: 'Alfa' },
      balls: 740,
      rank: 5,
      at: { kind: 'home', home: 'Alfa' },
      carried: ['🥷', '🎈', null],
      telegram: ['Alfa'],
    });
  });

  it('reads a player on a trip, and one coming back', () => {
    expect(
      parseProfile(
        'Alfa\nCon te: niente\n1 palla, 9° su 37 in classifica\nin viaggio verso Bravo: rientra tra 2 minuti e 11 secondi'
      )
    ).toMatchObject({ carried: [], at: { kind: 'travelling', to: 'Bravo', seconds: 131 } });
    expect(
      parseProfile(
        'Alfa\n1 palla, 9° su 37 in classifica\nin viaggio verso Bravo: rientra tra 2 minuti'
      )
    ).not.toHaveProperty('telegram');
    expect(
      parseProfile(
        'Alfa\n2 palle, 1° su 3 in classifica\nsulla via del ritorno da @Bravo: rientra tra 40 secondi'
      )
    ).toMatchObject({
      at: { kind: 'returning', to: 'Bravo', seconds: 40 },
      telegram: ['Bravo'],
    });
    // The holder's line names the place, not a player.
    expect(
      parseProfile('Alfa\n2 palle, 1° su 3 in classifica\nin @TheConquister37 da 4 minuti')
    ).not.toHaveProperty('telegram');
  });

  it('starts at the name, when another message was joined before it', () => {
    expect(
      parseProfile('Bravo torni in Bravo con 5 palle.\nAlfa\n7 palle, 2° su 3 in classifica')
    ).toMatchObject({ player: { name: 'Alfa' }, balls: 7 });
  });

  it('is null for anything else', () => {
    expect(parseProfile('Alfa sei in @TheConquister37!')).toBeNull();
  });
});

describe('mentions', () => {
  it('finds a player named by any event', () => {
    const m = (text: string) => ({ time: 0, text, events: parseMessage(text) });
    expect(
      mentions(
        m('Juno (🎈) hai rubato 641 palle a alice (🎈)! Torni in Juno tra 58 secondi.'),
        'alice'
      )
    ).toBe(true);
    expect(mentions(m('Juno sei in @TheConquister37!'), 'alice')).toBe(false);
  });
});
