import { describe, expect, it } from 'vitest';
import { stripZeroWidth, unwrap } from './relay.ts';

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
