import { describe, expect, it } from 'vitest';
import { italianWait, parseEpicLorelecBot, parseLoreGameBot } from './replies.ts';

describe('parseLoreGameBot', () => {
  it('reads the gain on the last line, after the story', () => {
    expect(
      parseLoreGameBot(
        'Lore - Il Bosco Inventato ⛅️ [B1]\n\nUna lunga storia, con [B1] dentro.\nHai ottenuto lo ZUCCOTTO 🥩 [B1]!'
      )
    ).toEqual({
      kind: 'gain',
      bot: 'LoreGameBot',
      item: 'lo ZUCCOTTO 🥩',
      rarity: 'B1',
      tags: [],
      sure: true,
    });
  });

  it('takes the last rarity as the rarity, and lower-case tags after it', () => {
    expect(
      parseLoreGameBot('Storia.\nHai ottenuto un costruttore di cose [X] [costruttore] [M1]!')
    ).toMatchObject({
      item: 'un costruttore di cose [X] [costruttore]',
      rarity: 'M1',
    });
    expect(parseLoreGameBot('Hai ottenuto un fischio di vapore [M1] [usabile]!')).toMatchObject({
      item: 'un fischio di vapore',
      tags: ['usabile'],
    });
    expect(
      parseLoreGameBot(
        'Hai ottenuto una mestola a forma di nuvola (0 - 1) [M1] [equipaggiabile 🗡]!'
      )
    ).toMatchObject({
      item: 'una mestola a forma di nuvola (0 - 1)',
      tags: ['equipaggiabile 🗡'],
    });
  });

  it('reads an item whose name spans lines', () => {
    expect(
      parseLoreGameBot('Storia.\nHai ottenuto 🌀🔺🌀\n🔸/avventura🔸\n🌀🔻🌀 [M1] [usabile]!')
    ).toMatchObject({
      kind: 'gain',
      item: '🌀🔺🌀\n🔸/avventura🔸\n🌀🔻🌀',
      rarity: 'M1',
    });
  });

  it('reads the outcomes that give nothing, accents decomposed or not', () => {
    const nothing = (text: string) => parseLoreGameBot(text);
    expect(nothing('Non e\u0300 passato abbastanza tempo! Riprova fra 3 secondi.')).toMatchObject({
      reason: 'cooldown',
    });
    expect(nothing('Non è passato abbastanza tempo! Riprova fra 5 minuti e 3 secondi.')).toEqual({
      kind: 'nothing',
      bot: 'LoreGameBot',
      reason: 'cooldown',
      retryMs: 303_000,
    });
    expect(
      nothing('Non è passato abbastanza tempo! Riprova fra 31 secondi.\n\nUna battuta qualunque.')
    ).toMatchObject({
      reason: 'cooldown',
    });
    expect(
      nothing(
        'Il combattimento inizia...\nX sconfigge alice [L1]!\n\nTorni a casa dolorante e a mani vuote...'
      )
    ).toMatchObject({ reason: 'defeated' });
    expect(
      nothing("Lo scontro dura a lungo...\n\nL'oggetto si perde nello scontro...")
    ).toMatchObject({ reason: 'lost' });
    expect(nothing('Stai calmo maschio...')).toMatchObject({ reason: 'calm' });
    expect(
      nothing(
        'Non sei registrato! Usa /registrami per registrarti o /help per informazioni sul gioco.'
      )
    ).toMatchObject({ reason: 'unregistered' });
  });

  it('keeps anything else as not understood, a level-up list included', () => {
    expect(parseLoreGameBot('È giunto il livello 5! 🎉\nOttieni:\n> 3 gettoni\n')).toEqual({
      kind: 'unknown',
      bot: 'LoreGameBot',
      text: 'È giunto il livello 5! 🎉\nOttieni:\n> 3 gettoni',
    });
    expect(parseLoreGameBot('Hai ottenuto qualcosa senza rarità')).toMatchObject({
      kind: 'unknown',
    });
  });
});

describe('italianWait', () => {
  it('reads the waits the bots state, and nothing else', () => {
    expect(italianWait('9 minuti e 29 secondi')).toBe(569_000);
    expect(italianWait('1 minuto e 1 secondo')).toBe(61_000);
    expect(italianWait('10 secondi')).toBe(10_000);
    expect(italianWait('4 ore e 58 minuti')).toBe(17_880_000);
    expect(italianWait('1 ora')).toBe(3_600_000);
    expect(italianWait('un po')).toBeUndefined();
  });
});

describe('parseEpicLorelecBot', () => {
  it("reads the count of a turn, after the day's lines, negative too", () => {
    expect(
      parseEpicLorelecBot(
        'Complimenti 78, Victor Esempio IL PRIMO, mi hai rotto il cazzo 53 volte!\n\nUna riga in più.'
      )
    ).toEqual({ kind: 'count', bot: 'EpicLorelecBot', count: 53 });
    expect(
      parseEpicLorelecBot(
        'Oggi è un giorno di prova!\nComplimenti 10, X del male 👿, mi hai rotto il cazzo -1 volta!'
      )
    ).toMatchObject({ count: -1 });
  });

  it('reads the cooldown, with a parenthesis before it or not, and ignores anything else', () => {
    expect(
      parseEpicLorelecBot(
        "Non e\u0300 passato abbastanza tempo dall'ultima rottura! Riprova fra 14 minuti e 57 secondi."
      )
    ).toEqual({ kind: 'nothing', bot: 'EpicLorelecBot', reason: 'cooldown', retryMs: 897_000 });
    expect(
      parseEpicLorelecBot(
        "(🎲 un inciso) Non è passato abbastanza tempo dall'ultima rottura! Riprova fra un po."
      )
    ).toEqual({ kind: 'nothing', bot: 'EpicLorelecBot', reason: 'cooldown' });
    expect(parseEpicLorelecBot('Turno 1\n\nBasi - 1000 HP')).toBeUndefined();
  });
});
