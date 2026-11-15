import { describe, expect, it } from 'vitest';
import { fromIrc, isRelay, stripZeroWidth, unwrap } from './relay.ts';

describe('unwrap', () => {
  it('unwraps an IRC line relayed to Telegram', () => {
    expect(unwrap('Regno', '<Alfa> !raid Bravo')).toEqual({
      author: 'Alfa',
      text: '!raid Bravo',
      relayed: true,
    });
  });

  it('unwraps a Telegram line relayed to IRC, dropping the anti-ping space and the reply quote', () => {
    expect(
      unwrap('Regno', '<N\u200borelecBot> [Re A\u200blfa: /raid @Bra…] Alfa parti per Bravo')
    ).toEqual({
      author: 'NorelecBot',
      text: 'Alfa parti per Bravo',
      relayed: true,
    });
  });

  it("keeps the relay's own notices", () => {
    expect(unwrap('Regno', "Lost connection to '#lobby' on 'irc.example.net'")).toMatchObject({
      author: 'Regno',
      relayed: false,
    });
    expect(unwrap('Regno', '* Alfa saluta')).toMatchObject({ author: 'Regno' });
  });

  it("unwraps the relay's other nick, and only the nicks it is given", () => {
    expect(unwrap('Regno_', '<A\u200blfa> /raid @Bravo')).toMatchObject({
      author: 'Alfa',
      relayed: true,
    });
    expect(unwrap('regno', '<Alfa> /back').relayed).toBe(true);
    expect(unwrap('Regno', '<Alfa> /back', ['Ponte']).relayed).toBe(false);
    expect(unwrap('Ponte', '<Alfa> /back', ['Ponte']).author).toBe('Alfa');
    expect(isRelay('Regno__')).toBe(false);
  });

  it('leaves other senders alone', () => {
    expect(unwrap('Alfa', '<Bravo> no')).toEqual({
      author: 'Alfa',
      text: '<Bravo> no',
      relayed: false,
    });
  });
});

describe('stripZeroWidth', () => {
  it('removes zero-width characters', () => {
    expect(stripZeroWidth('A\u200blfa\u2060')).toBe('Alfa');
  });
});

describe('fromIrc', () => {
  const known = (l: string): boolean => /^Alfa \(🐶\) \S+ ora è con te: .*$|^Bravo parti/u.test(l);

  it('splits the separator back into lines', () => {
    expect(fromIrc('\u200bAlfa · Con te: niente')).toBe('Alfa\nCon te: niente');
  });

  it('keeps an emoji named `·` inside its line, when the line is known only whole', () => {
    const line = 'Alfa (🐶) · ora è con te: ora ne hai 1 con te.';
    expect(fromIrc(line)).toBe('Alfa (🐶)\nora è con te: ora ne hai 1 con te.');
    expect(fromIrc(line, known)).toBe(line);
    expect(fromIrc(`Bravo parti · ${line}`, known)).toBe(`Bravo parti\n${line}`);
    // A new line that starts with a capital is never joined.
    expect(fromIrc('Alfa (🐶) · Ora è con te: x', known)).toBe('Alfa (🐶)\nOra è con te: x');
  });
});
