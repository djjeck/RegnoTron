import { describe, expect, it } from 'vitest';
import {
  GENERATION_WAIT_MS,
  GenerationWatch,
  parseBox,
  parseGenerated,
  parseGenerationAsked,
} from './generators.ts';

// Invented names; the bot's own words are the game's.
const MADE = 'La tua idea si materializza... hai generato ';

describe('a generator’s confirmation', () => {
  it('reads what each kind is about to make, and what it costs', () => {
    expect(parseGenerationAsked("Stai per generare l'oggetto una pigna. Sei sicuro?")).toEqual({
      kind: 'item',
      name: 'una pigna',
      cost: 0,
    });
    expect(
      parseGenerationAsked("Stai per generare l'oggetto una pigna per la stagione X. Sei sicuro?")
    ).toMatchObject({ kind: 'item', name: 'una pigna' });
    expect(parseGenerationAsked('Stai per generare il guardiano Gino. Sei sicuro?')).toMatchObject({
      kind: 'guardian',
      name: 'Gino',
    });
    expect(parseGenerationAsked('Stai per generare la stagione Fango. Sei sicuro?')).toMatchObject({
      kind: 'season',
      name: 'Fango',
    });
    for (const story of [
      'Stai per generare una nuova storia che recita: …',
      'Stai per generare una storia [B3] per Il Bene che recita: …',
      'Stai per aggiungere una storia per la stagione Fango: …',
    ])
      expect(parseGenerationAsked(story)).toEqual({ kind: 'story', name: null, cost: 0 });
    expect(
      parseGenerationAsked("Stai per rendere usabile l'oggetto una pigna. Lo script …")
    ).toMatchObject({ kind: 'utility', name: 'una pigna' });
    expect(
      parseGenerationAsked(
        "Stai per assemblare l'equipaggiamento un mestolo. L'assemblaggio consuma il generatore e 1.500₭. Sei sicuro?"
      )
    ).toEqual({ kind: 'equipment', name: 'un mestolo', cost: 1500 });
    expect(
      parseGenerationAsked(
        "Stai per duplicare l'equipaggiamento un mestolo [M4] dal tuo inventario. Sei sicuro?"
      )
    ).toMatchObject({ kind: 'blueprint', name: 'un mestolo [M4]' });
    expect(
      parseGenerationAsked(
        'Stai per duplicare un equipaggiamento assemblato dal tuo inventario. Sei sicuro?'
      )
    ).toMatchObject({ kind: 'blueprint', name: null });
    expect(parseGenerationAsked('Stai per fare altro.')).toBeUndefined();
  });
});

describe('a generator’s outcome', () => {
  it('reads what each kind made, its reward and a season’s removal', () => {
    expect(parseGenerated(`${MADE}una pigna (3 - 5) [B2] [cibo]!\n\nHai ottenuto 1.000₭!`)).toEqual(
      {
        kind: 'item',
        name: 'una pigna',
        code: 'B2',
        gained: null,
        reward: 1000,
        removed: null,
      }
    );
    expect(parseGenerated(`${MADE}il guardiano Gino [L3]!`)).toMatchObject({
      kind: 'guardian',
      name: 'Gino',
      code: 'L3',
    });
    expect(
      parseGenerated(
        `${MADE}la stagione Fango [B4]!\n\nTutti i generatori di stagione de Il Bene 😇 sono stati rimossi!`
      )
    ).toMatchObject({ kind: 'season', name: 'Fango', code: 'B4', removed: 'Bene' });
    expect(parseGenerated(`${MADE}una nuova storia [🌍]!`)).toMatchObject({
      kind: 'story',
      code: '🌍',
    });
    expect(parseGenerated(`${MADE}una nuova storia [M2] per Il Male!`)).toMatchObject({
      kind: 'story',
      code: 'M2',
    });
    expect(parseGenerated('Script installato con successo!')).toMatchObject({ kind: 'utility' });
    expect(
      parseGenerated(
        'Il tuo equipaggiamento prende forma... hai assemblato e ottenuto 1x un mestolo [M4] [equipaggiabile 🗡]!'
      )
    ).toMatchObject({
      kind: 'equipment',
      name: 'un mestolo',
      gained: { item: 'un mestolo', rarity: 'M4', tags: ['equipaggiabile 🗡'], level: null },
    });
    expect(parseGenerated('Hai duplicato un mestolo [M4]!')).toMatchObject({
      kind: 'blueprint',
      gained: { item: 'un mestolo' },
    });
    expect(parseGenerated(`${MADE}qualcosa di strano`)).toBeUndefined();
    expect(parseGenerated('Ciao!')).toBeUndefined();
  });
});

describe('pairing an outcome with its confirmation', () => {
  const T = Date.parse('2026-11-06T12:00:00Z');
  const bob = { player: 'bob', owner: false };
  const carol = { player: 'carol', owner: false };

  it('by the name it repeats, or the oldest story waiting in the chat', () => {
    const w = new GenerationWatch();
    expect(w.asked({ chat: 'g', text: 'Ciao' }, bob, T)).toBe(false);
    w.asked({ chat: 'g', text: "Stai per generare l'oggetto una pigna. Sei sicuro?" }, bob, T);
    w.asked({ chat: 'g', text: "Stai per generare l'oggetto un sasso. Sei sicuro?" }, carol, T);
    w.asked({ chat: 'g', text: 'Stai per generare una nuova storia che recita: …' }, carol, T);
    w.asked({ chat: 'g', text: 'Stai per generare una nuova storia che recita: …' }, bob, T + 1);
    expect(w.answer({ chat: 'g', text: `${MADE}un sasso [B1]!` }, T + 2)).toMatchObject({
      player: 'carol',
      name: 'un sasso',
    });
    expect(w.answer({ chat: 'g', text: `${MADE}una nuova storia [B1]!` }, T + 3)).toMatchObject({
      player: 'carol',
    });
    expect(w.answer({ chat: 'g', text: `${MADE}una nuova storia [B1]!` }, T + 4)).toMatchObject({
      player: 'bob',
    });
    // Another chat's, or none waiting: no one's.
    expect(w.answer({ chat: 'h', text: `${MADE}una pigna [B1]!` }, T + 5)).toBeUndefined();
    expect(w.answer({ chat: 'g', text: 'Ciao' }, T + 5)).toBeUndefined();
    // A confirmation left too long is forgotten.
    expect(
      w.answer({ chat: 'g', text: `${MADE}una pigna [B1]!` }, T + GENERATION_WAIT_MS + 1)
    ).toBeUndefined();
  });

  it('an equipment or a blueprint by the name it starts with, its cost carried', () => {
    const w = new GenerationWatch();
    w.asked(
      {
        chat: 'g',
        text: "Stai per assemblare l'equipaggiamento un mestolo. L'assemblaggio consuma il generatore e 500₭. Sei sicuro?",
      },
      bob,
      T
    );
    w.asked(
      { chat: 'g', text: 'Stai per duplicare un equipaggiamento assemblato dal tuo inventario.' },
      carol,
      T
    );
    expect(
      w.answer(
        {
          chat: 'g',
          text: 'Il tuo equipaggiamento prende forma... hai assemblato e ottenuto 1x un mestolo [M4]!',
        },
        T + 1
      )
    ).toMatchObject({ player: 'bob', cost: 500 });
    expect(w.answer({ chat: 'g', text: 'Hai duplicato un sasso [B1]!' }, T + 2)).toMatchObject({
      player: 'carol',
      cost: 0,
    });
  });
});

describe('the moving box', () => {
  it('reads whose it was and what it held, a name over lines', () => {
    expect(
      parseBox(
        'bob, apri lo scatolone 📦 e trovi:\n> una pigna [B1]\n> un mestolo\nlungo (2 - 4) [M4] [equipaggiabile 🗡]'
      )
    ).toEqual({
      player: 'bob',
      found: [
        { item: 'una pigna', rarity: 'B1', tags: [], level: null },
        {
          item: 'un mestolo\nlungo',
          rarity: 'M4',
          tags: ['equipaggiabile 🗡'],
          level: { low: 2, high: 4 },
        },
      ],
    });
    expect(parseBox('bob, apri lo scatolone 📦 e trovi:')).toBeUndefined();
    expect(parseBox('bob, apri lo scatolone 📦 e trovi:\nniente')).toBeUndefined();
    expect(parseBox('bob, apri lo scatolone 📦 e trovi:\n> una pigna')).toBeUndefined();
    expect(parseBox('Ciao')).toBeUndefined();
  });
});
