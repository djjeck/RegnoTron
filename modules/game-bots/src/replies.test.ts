import { describe, expect, it } from 'vitest';
import { ACCUMULO_MARK, italianWait, parseEpicLorelecBot, parseLoreGameBot } from './replies.ts';

/** A turn's lines as the bot sends them: a header, a story and the rest, a blank line before the ending. */
const HEADER = 'Lore - Il Bosco Inventato ⛅️ [B1]';
const STORY = 'Una storia scritta da un giocatore, con [B1] e [L9] dentro.';
const turn = (...lines: string[]): string => [HEADER, '', STORY, ...lines].join('\n');
const ENCOUNTER = [
  'Durante il tuo cammino compare un orso di burro 🧈 [L4]!',
  'Il combattimento inizia...',
];

describe('parseLoreGameBot', () => {
  it('reads the gain on the last line, after the story, and the place from the header', () => {
    expect(parseLoreGameBot(turn('Hai ottenuto lo ZUCCOTTO 🥩 [B1]!'))).toEqual({
      kind: 'gain',
      bot: 'LoreGameBot',
      item: 'lo ZUCCOTTO 🥩',
      qty: 1,
      rarity: 'B1',
      tags: [],
      sure: true,
      place: { name: 'Il Bosco Inventato ⛅️', code: 'B1' },
    });
    // Without a header (a reply the bot sent in an older form), the gain stands alone.
    expect(parseLoreGameBot("Storia\nHai ottenuto un'ancora di burro [B1]!")).toEqual({
      kind: 'gain',
      bot: 'LoreGameBot',
      item: "un'ancora di burro",
      qty: 1,
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
  });

  it('keeps the count and the stats out of the item: "2x" and "(0 - 1)"', () => {
    expect(
      parseLoreGameBot(
        'Hai ottenuto 2x una mestola a forma di nuvola (0 - 1) [M1] [equipaggiabile 🗡]!'
      )
    ).toMatchObject({
      item: 'una mestola a forma di nuvola',
      qty: 2,
      stats: { low: 0, high: 1 },
      tags: ['equipaggiabile 🗡'],
    });
    const plain = parseLoreGameBot('Hai ottenuto 12x un sasso (liscio) [B1]!');
    expect(plain).toMatchObject({ item: 'un sasso (liscio)', qty: 12 });
    expect(plain).not.toHaveProperty('stats');
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

  it('reads a fight won against the encounter, with the equipment powers and what it taught', () => {
    const o = parseLoreGameBot(
      turn(
        ...ENCOUNTER,
        '⚡️ alice [L6] attiva il potere di un cucchiaio di legno ⚡️!',
        '⚡️ alice [L6] attiva il potere di una sciarpa lunga ⚡️!',
        'alice [L6] sconfigge un orso di burro 🧈 [L4]! Hai imparato qualcosa di nuovo... (+3)',
        '',
        'Hai ottenuto 2x una pigna [B1]!'
      )
    );
    expect(o).toMatchObject({
      kind: 'gain',
      item: 'una pigna',
      qty: 2,
      fight: {
        enemy: { name: 'un orso di burro 🧈', level: 4 },
        result: 'won',
        player: { name: 'alice', level: 6 },
        learned: 3,
        powers: ['un cucchiaio di legno', 'una sciarpa lunga'],
      },
    });
    // Without a power or a lesson, the fight has neither.
    const bare = parseLoreGameBot(
      turn(
        ...ENCOUNTER,
        'alice [L6] sconfigge un orso di burro 🧈 [L4]!',
        '',
        'Hai ottenuto una pigna [B1]!'
      )
    );
    expect(bare).toMatchObject({ fight: { result: 'won' } });
    expect((bare as { fight: object }).fight).not.toHaveProperty('learned');
    expect((bare as { fight: object }).fight).not.toHaveProperty('powers');
  });

  it('reads a fight lost, the enemy being the one that wins, and a draw', () => {
    expect(
      parseLoreGameBot(
        turn(
          ...ENCOUNTER,
          'un orso di burro 🧈 [L4] sconfigge alice [L2]!',
          '',
          'Torni a casa dolorante e a mani vuote...'
        )
      )
    ).toEqual({
      kind: 'nothing',
      bot: 'LoreGameBot',
      reason: 'defeated',
      place: { name: 'Il Bosco Inventato ⛅️', code: 'B1' },
      fight: {
        enemy: { name: 'un orso di burro 🧈', level: 4 },
        result: 'lost',
        player: { name: 'alice', level: 2 },
      },
    });
    expect(
      parseLoreGameBot(
        turn(
          ...ENCOUNTER,
          'Nessuno dei due sembra avere la meglio...',
          '',
          "L'oggetto si perde nello scontro..."
        )
      )
    ).toMatchObject({ reason: 'lost', fight: { result: 'draw' } });
    // A player named like the enemy: the ending says who lost.
    expect(
      parseLoreGameBot(
        turn(
          ...ENCOUNTER,
          'un orso di burro 🧈 [L4] sconfigge un orso di burro 🧈 [L4]!',
          '',
          'Torni a casa dolorante e a mani vuote...'
        )
      )
    ).toMatchObject({ fight: { result: 'lost' } });
  });

  it('keeps a fight line it cannot match to the encounter out of the fight', () => {
    // An enemy named in the encounter but not in the fight's line: not one fight to read.
    expect(
      parseLoreGameBot(
        turn(
          ...ENCOUNTER,
          'alice [L6] sconfigge un altro [L4]!',
          '',
          'Hai ottenuto una pigna [B1]!'
        )
      )
    ).not.toHaveProperty('fight');
    // An encounter with no fight after it.
    expect(
      parseLoreGameBot(turn(ENCOUNTER[0] as string, 'Altro.', 'Hai ottenuto una pigna [B1]!'))
    ).not.toHaveProperty('fight');
  });

  it('reads a level-up after the gain, and keeps it out of the item', () => {
    const o = parseLoreGameBot(
      turn(
        'Hai ottenuto un atomo di cipria 🔺 [B1]!',
        '',
        '🎉 Congratulazioni, hai raggiunto il livello 4! 🎉',
        'Ottieni:',
        '> 40 monete',
        '> 1 punto /abilita',
        '> 1 una scatola di sassi 📦 [X] [usabile]',
        '> un dado storto (1 - 2) [M1]',
        '> qualcosa di strano'
      )
    );
    expect(o).toMatchObject({
      kind: 'gain',
      item: 'un atomo di cipria 🔺',
      rarity: 'B1',
      levelUp: {
        level: 4,
        coins: 40,
        skillPoints: 1,
        items: [
          { item: 'una scatola di sassi 📦', qty: 1, rarity: 'X', tags: ['usabile'] },
          { item: 'un dado storto', qty: 1, rarity: 'M1', tags: [] },
        ],
        other: ['qualcosa di strano'],
      },
    });
    expect(
      parseLoreGameBot(
        turn(
          'Hai ottenuto una pigna [B1]!',
          '',
          '🎉 Congratulazioni, hai raggiunto il livello 5! 🎉',
          'Ottieni:',
          '> 2 monete',
          '> 3 punti /abilita'
        )
      )
    ).toMatchObject({ levelUp: { level: 5, coins: 2, skillPoints: 3, items: [], other: [] } });
  });

  it("does not trust the story: its lines that look like the bot's are not the outcome", () => {
    const o = parseLoreGameBot(
      [
        HEADER,
        '',
        'Hai ottenuto un falso [M9]!',
        'Poi lui disse: Non è passato abbastanza tempo! Riprova fra 3 secondi.',
        'Durante il tuo cammino compare un falso [L1]!',
        'Hai ottenuto una pigna vera [B1]!',
      ].join('\n')
    );
    expect(o).toMatchObject({ kind: 'gain', item: 'una pigna vera', rarity: 'B1' });
    expect(o).not.toHaveProperty('fight');
    // A story that quotes a level-up and goes on is not read as one, nor as a gain with it inside.
    expect(
      parseLoreGameBot(
        turn(
          '🎉 Congratulazioni, hai raggiunto il livello 9! 🎉',
          'Ottieni:',
          '> 99 monete',
          'Hai ottenuto una pigna vera [B1]!'
        )
      )
    ).toMatchObject({ kind: 'unknown' });
  });

  it('reads a turn cut at Telegram’s limit as one whose ending is lost, with what it kept', () => {
    const cut = (...lines: string[]): string => turn(...lines, 'x'.repeat(1024)).slice(0, 1024);
    expect(parseLoreGameBot(cut())).toEqual({
      kind: 'nothing',
      bot: 'LoreGameBot',
      reason: 'truncated',
      place: { name: 'Il Bosco Inventato ⛅️', code: 'B1' },
    });
    expect(
      parseLoreGameBot(
        cut(
          ...ENCOUNTER,
          'alice [L6] sconfigge un orso di burro 🧈 [L4]! Hai imparato qualcosa di nuovo... (+1)',
          ''
        )
      )
    ).toMatchObject({ reason: 'truncated', fight: { result: 'won', learned: 1 } });
    // A level-up cut inside its title cannot be cut off the gain, so it is not read as one.
    expect(
      parseLoreGameBot(
        turn(
          'Hai ottenuto una pigna [B1]!',
          '',
          '🎉 Congratulazioni, hai raggiunto il livello 8!'
        ).padEnd(1024, ' ') + 'x'
      )
    ).toMatchObject({ reason: 'truncated' });
    // A short reply with a header and no ending is not a cut, but drift.
    expect(parseLoreGameBot(turn('Una riga.'))).toMatchObject({ kind: 'unknown' });
  });

  it('reads the outcomes that give nothing, accents decomposed or not', () => {
    const nothing = (text: string) => parseLoreGameBot(text);
    expect(nothing('Non è passato abbastanza tempo! Riprova fra 3 secondi.')).toMatchObject({
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

  it('keeps anything else as not understood: a ban, a refusal, an error', () => {
    expect(parseLoreGameBot('È giunto il livello 5! 🎉\nOttieni:\n> 3 gettoni\n')).toEqual({
      kind: 'unknown',
      bot: 'LoreGameBot',
      text: 'È giunto il livello 5! 🎉\nOttieni:\n> 3 gettoni',
    });
    expect(parseLoreGameBot('Hai ottenuto qualcosa senza rarità')).toMatchObject({
      kind: 'unknown',
    });
    for (const text of [
      'Sei stato bannato fino al 31/02/2026.',
      'Sei stato bannato fino al 05/11/2026, 24:00:00.',
      'Sei stato bannato.',
      'Nessun oggetto nel pool!',
      "Cannot read properties of null (reading 'amount')",
    ])
      expect(parseLoreGameBot(text)).toMatchObject({ kind: 'unknown', text });
  });
});

describe('the accumulo line of a turn', () => {
  const GAIN = 'Hai ottenuto lo ZUCCOTTO 🥩 [B1]!';

  it('reads the bot’s line between the story and the rest, with the fight and the gain intact', () => {
    expect(ACCUMULO_MARK).toBe('🔋 /accumulo pronto!');
    expect(parseLoreGameBot(turn('', ACCUMULO_MARK, '', GAIN))).toMatchObject({
      kind: 'gain',
      item: 'lo ZUCCOTTO 🥩',
      accumulo: { ready: true, sure: true },
    });
    // Before an encounter, no blank line, and a fight lost.
    const lost = turn(
      '',
      ACCUMULO_MARK,
      ...ENCOUNTER,
      'un orso di burro 🧈 [L4] sconfigge alice [L2]!',
      '',
      'Torni a casa dolorante e a mani vuote...'
    );
    expect(parseLoreGameBot(lost)).toMatchObject({
      kind: 'nothing',
      reason: 'defeated',
      accumulo: { ready: true, sure: true },
      fight: { result: 'lost' },
    });
    // Trailing spaces from the chat's rendering do not hide it.
    expect(parseLoreGameBot(turn('', `${ACCUMULO_MARK}  `, '', GAIN))).toMatchObject({
      accumulo: { sure: true },
    });
  });

  it('says nothing when the line is not there, or is not a line of its own', () => {
    expect(parseLoreGameBot(turn('', GAIN))).not.toHaveProperty('accumulo');
    expect(
      parseLoreGameBot(turn(`Una storia che dice ${ACCUMULO_MARK} a metà riga`, '', GAIN))
    ).not.toHaveProperty('accumulo');
    // Not a turn: a reply with no header is not read for it, whatever it quotes.
    expect(
      parseLoreGameBot(`Storia\n${ACCUMULO_MARK}\nHai ottenuto un sasso [B1]!`)
    ).not.toHaveProperty('accumulo');
  });

  it('is not sure when a story quotes the line: the bot never writes it twice', () => {
    const quoted = turn(ACCUMULO_MARK, ACCUMULO_MARK, '', ACCUMULO_MARK, '', GAIN);
    expect(parseLoreGameBot(quoted)).toMatchObject({
      kind: 'gain',
      accumulo: { ready: true, sure: false },
    });
  });

  it('is lost with the ending of a turn cut off, which says nothing of the accumulo', () => {
    const cut = [HEADER, '', 'x'.repeat(1010)].join('\n');
    expect(parseLoreGameBot(cut)).toMatchObject({ kind: 'nothing', reason: 'truncated' });
    expect(parseLoreGameBot(cut)).not.toHaveProperty('accumulo');
  });
});

describe('a ban', () => {
  const until = (text: string): string | undefined => {
    const o = parseLoreGameBot(text);
    return o.kind === 'banned' ? new Date(o.until).toISOString() : undefined;
  };

  it('ends at Rome’s time, or at the end of the day for a date alone', () => {
    // November: Rome is an hour ahead of UTC; in summer, two.
    expect(until('Sei stato bannato fino al 12/11/2026, 21:15:42.')).toBe(
      '2026-11-12T20:15:42.000Z'
    );
    expect(until('Sei stato bannato fino al 15/07/2026, 08:00:00.')).toBe(
      '2026-07-15T06:00:00.000Z'
    );
    expect(until('Sei stato bannato fino al 04/11/2026.')).toBe('2026-11-04T23:00:00.000Z');
    expect(until('Sei stato bannato fino al 01/01/2031.')).toBe('2031-01-01T23:00:00.000Z');
    // The day clocks change: 29 March 2026 (an hour lost at 02:00) and 25 October (gained at 03:00).
    expect(until('Sei stato bannato fino al 28/03/2026.')).toBe('2026-03-28T23:00:00.000Z');
    expect(until('Sei stato bannato fino al 29/03/2026.')).toBe('2026-03-29T22:00:00.000Z');
    expect(until('Sei stato bannato fino al 25/10/2026.')).toBe('2026-10-25T23:00:00.000Z');
    expect(until('Sei stato bannato fino al 31/12/2026.')).toBe('2026-12-31T23:00:00.000Z');
  });

  it('is the whole reply: a story that quotes it is not a ban, and a stray word is not understood', () => {
    expect(
      parseLoreGameBot('Lore - Il Bosco [B1]\n\nSei stato bannato fino al 01/01/2031.')
    ).toMatchObject({
      kind: 'unknown',
    });
    expect(parseLoreGameBot('Sei stato bannato fino al 01/01/2031. Ciao')).toMatchObject({
      kind: 'unknown',
    });
    expect(parseLoreGameBot('  Sei stato bannato fino al 01/01/2031.\n')).toMatchObject({
      kind: 'banned',
      bot: 'LoreGameBot',
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
    expect(italianWait('4 ore, 8 minuti e 23 secondi')).toBe(14_903_000);
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
