import { describe, expect, it } from 'vitest';
import { parseTravel, placeRequirements } from './places.ts';

// Invented places and items; the bot's own words are the game's.
describe('/vai and /v', () => {
  it('reads an arrival, and the items entering took', () => {
    expect(parseTravel('WOOSH! Sei arrivato alla Stagione Il Bosco Inventato ⛅️ [B1]!')).toEqual({
      kind: 'arrived',
      place: { name: 'Il Bosco Inventato ⛅️', code: 'B1' },
      consumed: [],
    });
    expect(
      parseTravel(
        [
          'WOOSH! Sei arrivato alla Stagione La Valle Finta 🌄 [M5]!',
          '',
          'Per entrare, hai consumato i seguenti oggetti',
          '> un sasso [M4]',
          '> un nome',
          'su due righe [M4] [usabile]',
          '> un mestolo (2 - 6) [M3] [equipaggiabile 🗡]',
        ].join('\n')
      )
    ).toMatchObject({
      kind: 'arrived',
      consumed: [
        { item: 'un sasso', rarity: 'M4', tags: [], level: null },
        { item: 'un nome\nsu due righe', tags: ['usabile'] },
        { item: 'un mestolo', level: { low: 2, high: 6 } },
      ],
    });
  });

  it('reads where one is: its requirements, and where one can go', () => {
    expect(
      parseTravel(
        [
          'Ti trovi nella stagione La Valle Finta 🌄 [M5]',
          '',
          "Requisiti d'accesso (oggetti consumati all'arrivo)",
          '> Livello 5',
          '> un sasso [M4]',
          '',
          'Puoi andare in:',
          '> 🔒 Il Monte Finto 🗻 [M6]',
          '> Il Bosco Inventato ⛅️ [B1]',
        ].join('\n')
      )
    ).toEqual({
      kind: 'here',
      place: { name: 'La Valle Finta 🌄', code: 'M5' },
      requirements: {
        level: 5,
        items: [{ item: 'un sasso', rarity: 'M4', tags: [], level: null }],
      },
      exits: [
        { name: 'Il Monte Finto 🗻', code: 'M6', locked: true },
        { name: 'Il Bosco Inventato ⛅️', code: 'B1', locked: false },
      ],
    });
    expect(
      parseTravel(
        'Ti trovi nella stagione Il Bosco Inventato ⛅️ [B1]\n\nNessuna stagione disponibile!'
      )
    ).toMatchObject({ requirements: null, exits: [] });
  });

  it('reads a refusal, and a place’s requirements wherever the bot states them', () => {
    const block = [
      "Requisiti d'accesso per Il Monte Finto 🗻 [M6] (oggetti consumati all'arrivo)",
      '> Livello 6',
      'Ti serve:',
      '> una pigna [M5]',
      'Hai già:',
      '> un sasso [M4]',
    ].join('\n');
    expect(parseTravel(`Non hai accesso a Il Monte Finto 🗻 [M6]!\n\n${block}`)).toMatchObject({
      kind: 'refused',
      place: { code: 'M6' },
      requirements: { level: 6, items: [{ item: 'una pigna' }, { item: 'un sasso' }] },
    });
    expect(
      placeRequirements(
        `Hai generato qualcosa!\n\nLa modalità d'accesso alla stagione [M6] è cambiata!\n${block}`
      )
    ).toMatchObject([
      { place: { name: 'Il Monte Finto 🗻', code: 'M6' }, requirements: { level: 6 } },
    ]);
    expect(parseTravel('Stagione non trovata!')).toBeUndefined();
  });
});
