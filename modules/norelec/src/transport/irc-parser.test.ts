import { describe, expect, it } from 'vitest';
import { BOT_MESSAGES } from '#test/bot-messages.ts';
import { ircBotMessage, type IrcLine, IrcParser } from './irc-parser.ts';
import { fromIrc } from './relay.ts';

/**
 * A Telegram message of the bot as IRC shows it (seen live, 22 Oct): one line from the nick
 * NorelecBot, its non-blank lines joined by " · ", a zero-width space before each line's first
 * word (where the bot puts the player's name).
 */
function onIrc(text: string, time: number): IrcLine {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return { nick: 'NorelecBot', text: lines.map((l) => `\u200b${l}`).join(' · '), time };
}

describe('ircBotMessage', () => {
  it.each(BOT_MESSAGES)('$name: the same events as the export side', ({ text, kinds }) => {
    const m = ircBotMessage(onIrc(text, 1000));
    expect(m?.time).toBe(1000);
    expect(m?.events.map((e) => e.kind)).toEqual(kinds);
  });

  it('reads the player without the anti-ping space', () => {
    const m = ircBotMessage({
      nick: 'NorelecBot',
      text: '\u200balice lasci perdere e torni in alice: arrivi tra 23 secondi.',
      time: 0,
    });
    expect(m?.events[0]).toMatchObject({
      kind: 'turnBack',
      player: { name: 'alice' },
      seconds: 23,
    });
  });

  it('reads a profile, which IRC joins into one line', () => {
    const m = ircBotMessage({
      nick: 'NorelecBot',
      text: '\u200balice · Con te: niente · 0 palle, 24° su 37 in classifica · a casa, in alice · 📜 con noi da 2 giorni',
      time: 0,
    });
    expect(m?.events).toMatchObject([
      { kind: 'profile', player: { name: 'alice' }, balls: 0, rank: 24 },
    ]);
  });

  it('reads bot lines the relay carries, and ignores everyone else', () => {
    expect(
      ircBotMessage({
        nick: 'Regno',
        text: '<N\u200borelecBot_> Alfa sei in @TheConquister37!',
        time: 0,
      })?.events.map((e) => e.kind)
    ).toEqual(['entered']);
    expect(ircBotMessage({ nick: 'Regno', text: '<alice> /raid Juno', time: 0 })).toBeNull();
    expect(ircBotMessage({ nick: 'Bravo', text: '!raid Alfa', time: 0 })).toBeNull();
  });
});

describe('fromIrc', () => {
  it('restores line breaks and drops zero-width characters and empty parts', () => {
    expect(fromIrc('\u200bAlfa sei in @TheConquister37! ·  · Una citazione')).toBe(
      'Alfa sei in @TheConquister37!\nUna citazione'
    );
  });
});

describe('IrcParser', () => {
  const bot = (text: string, time: number, received = time) => ({
    nick: 'NorelecBot',
    text,
    time,
    received,
  });

  it.each(BOT_MESSAGES)('$name: the same events, split or not', ({ text, kinds }) => {
    const parser = new IrcParser();
    const line = onIrc(text, 1000);
    // As the relay splits a long message: the parts at line boundaries, within the join window.
    const parts = line.text.split(' · ');
    const half = Math.ceil(parts.length / 2);
    const out = [
      ...parser.push(bot(parts.slice(0, half).join(' · '), 1000)),
      ...(half < parts.length
        ? parser.push(bot('\u200b' + parts.slice(half).join(' · '), 1100))
        : []),
    ];
    expect(out).toEqual([]);
    expect(parser.flush(1100)).toEqual([]);
    const [m] = parser.flush(1500);
    expect(m?.time).toBe(1000);
    expect(m?.events.map((e) => e.kind)).toEqual(kinds);
  });

  it('keeps messages apart when they are more than the join window apart', () => {
    const parser = new IrcParser(400);
    parser.push(bot('\u200bAlfa sei in @TheConquister37!', 0));
    const [first] = parser.push(bot('\u200bBravo sei già in @Bravo!', 600));
    expect(first?.events.map((e) => e.kind)).toEqual(['entered']);
    const [second] = parser.push({ nick: 'Regno', text: '<Alfa> ciao', time: 700, received: 700 });
    expect(second?.events.map((e) => e.kind)).toEqual(['alreadyAt']);
    expect(parser.flush(10_000)).toEqual([]);
  });

  it('waits on the local clock only', () => {
    const parser = new IrcParser(400);
    // The server clock is a minute ahead of the local one: the message still closes 400 ms after
    // it was received.
    parser.push(bot('\u200bAlfa sei in @TheConquister37!', 60_000, 0));
    expect(parser.flush(399)).toEqual([]);
    expect(parser.flush(400)).toHaveLength(1);
  });
});
