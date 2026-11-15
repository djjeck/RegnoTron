import { describe, expect, it } from 'vitest';
import { BOT_MESSAGES } from '#test/bot-messages.ts';
import { ircBotMessage, type IrcLine, IrcParser, SPLIT_RISK_BYTES } from './irc-parser.ts';
import { fromIrc } from './relay.ts';

const RAID = 'Alfa parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.';

/** The lines of a Telegram message as the relay splits them: parts under 390 bytes, at lines. */
function relaySplit(lines: readonly string[]): string[] {
  const parts: string[] = [];
  let part = '';
  for (const l of lines.map((x) => `\u200b${x}`)) {
    const next = part === '' ? l : `${part} · ${l}`;
    if (part !== '' && new TextEncoder().encode(next).length >= 390) {
      parts.push(part);
      part = l;
    } else part = next;
  }
  return [...parts, part];
}

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
        text: '<N\u200borelecBot_> Alfa /burn è disattivato.',
        time: 0,
      })?.events.map((e) => e.kind)
    ).toEqual(['disabled']);
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

  it.each(BOT_MESSAGES)('$name: the same events, at once or after the join window', (f) => {
    const parser = new IrcParser();
    const out = [...parser.push(bot(onIrc(f.text, 1000).text, 1000)), ...parser.flush(1500)];
    expect(out).toHaveLength(1);
    expect(out[0]?.time).toBe(1000);
    expect(out[0]?.events.map((e) => e.kind)).toEqual(f.kinds);
  });

  it('reads a short message of known lines with its line, without waiting', () => {
    const parser = new IrcParser();
    const [m] = parser.push(bot(`\u200b${RAID}`, 1000));
    expect(m?.events.map((e) => e.kind)).toEqual(['depart']);
    expect(parser.flush(10_000)).toEqual([]);
  });

  it('joins the parts of a long message, as the relay splits it, and reads it after the window', () => {
    const rows = Array.from(
      { length: 10 },
      (_, i) => `${i + 1}) Giocatore${i} (🎈) — ${20 - i} ore`
    );
    const text = [
      "⚽ Classifica della palla: chi l'ha tenuta più a lungo",
      ...rows,
      "La palla ce l'ha Giocatore0 (🎈) da 1 minuto e 5 secondi: rubagliela con !raid Giocatore0.",
    ];
    const parts = relaySplit(text);
    expect(parts).toHaveLength(2);
    const parser = new IrcParser();
    expect(parser.push(bot(String(parts[0]), 1000))).toEqual([]);
    expect(parser.push(bot(String(parts[1]), 1100))).toEqual([]);
    expect(parser.flush(1100 + 399)).toEqual([]);
    const [m] = parser.flush(1500);
    expect(m?.events.map((e) => e.kind)).toEqual([
      'info',
      ...rows.map(() => 'ballRow'),
      'ballHolder',
    ]);
  });

  it('waits for the echo after a quote added, which completes it', () => {
    const added = 'Alfa hai aggiunto la citazione spendendo 1000 palle!';
    const parser = new IrcParser();
    expect(parser.push(bot(`\u200b${added}`, 1000))).toEqual([]);
    const [m] = parser.push(bot('\u200bUna citazione qualunque.', 1100));
    expect(m?.text).toBe(`${added}\nUna citazione qualunque.`);
    expect(m?.events.map((e) => e.kind)).toEqual(['quoteAdded']);
    // A quote added and its echo on one line are complete at once.
    const [whole] = new IrcParser().push(bot(`\u200b${added} · Una citazione qualunque.`, 2000));
    expect(whole?.events.map((e) => e.kind)).toEqual(['quoteAdded']);
  });

  it('waits for the join window on a line no template knows, or a long one', () => {
    const parser = new IrcParser();
    expect(parser.push(bot('Una riga che nessun modello conosce.', 1000))).toEqual([]);
    expect(parser.flush(1400)).toHaveLength(1);
    const long = `\u200b${RAID} · `.repeat(3);
    expect(new TextEncoder().encode(long).length).toBeGreaterThanOrEqual(SPLIT_RISK_BYTES);
    expect(parser.push(bot(long, 2000))).toEqual([]);
    expect(parser.flush(2400)[0]?.events).toHaveLength(3);
  });

  it('keeps messages apart when they are more than the join window apart', () => {
    const parser = new IrcParser(400);
    parser.push(bot('\u200bAlfa hai aggiunto la citazione spendendo 1000 palle!', 0));
    const [first, second] = parser.push(bot('\u200bBravo sei già in @Bravo!', 600));
    expect(first?.events.map((e) => e.kind)).toEqual(['quoteAdded']);
    // The second is complete with its line.
    expect(second?.events.map((e) => e.kind)).toEqual(['alreadyAt']);
    expect(parser.push({ nick: 'Regno', text: '<Alfa> ciao', time: 700, received: 700 })).toEqual(
      []
    );
    expect(parser.flush(10_000)).toEqual([]);
  });

  it('waits on the local clock only', () => {
    const parser = new IrcParser(400);
    // The server clock is a minute ahead of the local one: the message still closes 400 ms after
    // it was received.
    parser.push(bot('\u200bAlfa hai aggiunto la citazione spendendo 1000 palle!', 60_000, 0));
    expect(parser.flush(399)).toEqual([]);
    expect(parser.flush(400)).toHaveLength(1);
  });
});
