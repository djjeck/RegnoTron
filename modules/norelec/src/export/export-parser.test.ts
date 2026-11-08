import { describe, expect, it } from 'vitest';
import { BOT_MESSAGES } from '#test/bot-messages.ts';
import { exportBotMessage, parseExportDate } from './export-parser.ts';

const DATE = '20.10.2026 22:16:35 UTC-04:00';
const TIME = Date.UTC(2026, 9, 21, 2, 16, 35);

describe('exportBotMessage', () => {
  it.each(BOT_MESSAGES)('$name', ({ text, kinds }) => {
    const m = exportBotMessage({ date: DATE, sender: 'NorelecBot', text });
    expect(m?.time).toBe(TIME);
    expect(m?.events.map((e) => e.kind)).toEqual(kinds);
  });

  it('reads a bot line relayed from IRC, in the IRC form', () => {
    const m = exportBotMessage({
      date: DATE,
      sender: 'Regno',
      text: '<NorelecBot_> \u200bAlfa sei in @TheConquister37! · \u200bBravo sei già in @Bravo!',
    });
    expect(m?.events.map((e) => e.kind)).toEqual(['entered', 'alreadyAt']);
  });

  it('ignores other senders, relayed or not, and undated messages', () => {
    expect(exportBotMessage({ date: DATE, sender: 'Alfa', text: 'ciao' })).toBeNull();
    expect(
      exportBotMessage({ date: DATE, sender: 'Regno', text: '<Alfa> !raid Bravo' })
    ).toBeNull();
    expect(exportBotMessage({ date: null, sender: 'NorelecBot', text: 'x' })).toBeNull();
    expect(exportBotMessage({ date: DATE, sender: null, text: 'x' })).toBeNull();
    expect(exportBotMessage({ date: 'ieri', sender: 'NorelecBot', text: 'x' })).toBeNull();
  });
});

describe('parseExportDate', () => {
  it('honours the offset', () => {
    expect(parseExportDate(DATE)).toBe(TIME);
    expect(parseExportDate('21.10.2026 04:16:35 UTC+02:00')).toBe(TIME);
  });
});
