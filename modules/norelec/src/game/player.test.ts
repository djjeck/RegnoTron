import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.ts';
import { emojiKind, parseEmojiList, playerRef } from './player.ts';

describe('playerRef', () => {
  it('drops the @ and splits off a title', () => {
    expect(playerRef('@Alfa lo smarrito', '🎈[]')).toEqual({
      name: 'Alfa',
      title: 'lo smarrito',
      carried: ['🎈', null],
    });
  });

  it('has no carried list when the line gives none', () => {
    expect(playerRef('Alfa')).toEqual({ name: 'Alfa' });
  });
});

describe('parseEmojiList', () => {
  it('keeps multi-codepoint emoji whole and reads empty slots', () => {
    expect(parseEmojiList('[]🥷🏻🏴‍☠️[]⚡️')).toEqual([null, '🥷🏻', '🏴‍☠️', null, '⚡️']);
  });

  it('is empty for an empty list', () => {
    expect(parseEmojiList('')).toEqual([]);
  });
});

describe('emojiKind', () => {
  it('compares effects, not code points', () => {
    expect(emojiKind('⚡️')).toBe(emojiKind('⚡'));
    expect(emojiKind('🥷🏿')).toBe('🥷');
  });
});

describe('parseDuration', () => {
  it.each([
    ['58 secondi', 58],
    ['1 minuto e 40 secondi', 100],
    ['2 minuti', 120],
    ['1 ora e 5 minuti', 3900],
    ['9 ore, 20 minuti e 17 secondi', 33617],
  ])('%s = %i s', (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it('is null without a duration', () => {
    expect(parseDuration('tra poco')).toBeNull();
  });
});
