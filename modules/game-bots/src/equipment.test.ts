import { describe, expect, it } from 'vitest';
import { parseEquip } from './equipment.ts';

describe('the answers to /equipaggia', () => {
  it('reads an item equipped, one replacing another, and one taken off', () => {
    expect(parseEquip('Hai equipaggiato una spatola!')).toEqual({
      kind: 'equipped',
      item: 'una spatola',
      removed: null,
    });
    expect(parseEquip('Hai rimosso un mestolo!\nHai equipaggiato una spatola!')).toEqual({
      kind: 'equipped',
      item: 'una spatola',
      removed: 'un mestolo',
    });
    expect(parseEquip('Hai rimosso un mestolo!')).toEqual({ kind: 'removed', item: 'un mestolo' });
  });

  it('reads the slots it lists without an item', () => {
    expect(
      parseEquip(
        [
          'Formato non valido! /equipaggia {oggetto}',
          '',
          'Armatura 🛡 - una pentola (2 - 6)',
          'Amuleto 🩺 - (vuoto)',
          'Arma 🗡 - un mestolo (4)',
        ].join('\n')
      )
    ).toEqual({
      kind: 'listing',
      equipment: {
        armour: { item: 'una pentola', level: { low: 2, high: 6 } },
        amulet: null,
        weapon: { item: 'un mestolo', level: { low: 4, high: 4 } },
      },
    });
  });

  it('reads no refusal: they change nothing, and other commands share them', () => {
    for (const t of [
      "Non possiedi l'oggetto!",
      'Non hai il livello necessario per equipaggiare questo oggetto!',
      "L'oggetto non è equipaggiabile!",
      'Hai già equipaggiato questo oggetto!',
      'Troppi oggetti trovati con quel nome (un)\n  - un mestolo (4) [B1] [equipaggiabile 🗡]',
      'Hai equipaggiato una spatola!\nUna riga in più',
    ])
      expect(parseEquip(t)).toBeUndefined();
  });
});
