import { describe, expect, it } from 'vitest';
import { parseRecipeMade, parseRecipeNeeds, parseRecipes } from './recipes.ts';

// Invented recipes and items; the bot's own words are the game's.
const HINT =
  'Scrivi /ricetta <nome ricetta> per vedere quali oggetti ti mancano per una certa ricetta!';

describe('the recipes', () => {
  it('reads a list: each recipe, its level, what it lacks or its [*]', () => {
    expect(
      parseRecipes(
        [
          '@bob, ecco le ricette a tua disposizione:',
          '- La zuppa del lunedì [L2] [manca 4]',
          '- Il ponte di cartone 🌉 [L1] [manca 0]',
          '- Il razzo a pedali [L1] [*]',
          '',
          HINT,
        ].join('\n')
      )
    ).toEqual({
      player: 'bob',
      recipes: [
        { name: 'La zuppa del lunedì', level: 2, lacking: 4, starred: false },
        { name: 'Il ponte di cartone 🌉', level: 1, lacking: 0, starred: false },
        { name: 'Il razzo a pedali', level: 1, lacking: null, starred: true },
      ],
    });
    expect(
      parseRecipes(
        [
          '@bob, ecco le ricette a tua disposizione:',
          'Nessuna ricetta creata finora.',
          '',
          HINT,
        ].join('\n')
      )
    ).toEqual({ player: 'bob', recipes: [] });
    expect(
      parseRecipes('@bob, ecco le ricette a tua disposizione:\n- una riga strana')
    ).toBeUndefined();
    expect(parseRecipes('Ciao')).toBeUndefined();
  });

  it('reads what a recipe lacks and what is held, a name over lines', () => {
    expect(
      parseRecipeNeeds(
        [
          '@bob, per fare la ricetta La zuppa del lunedì ti mancano:',
          '- un mestolo bucato 🥄 [B2] [usabile] x1',
          '- una rapa',
          'filosofica [L1] x1',
          '',
          'Mentre hai già:',
          '- una pentola senza fondo (2 - 4) [B1] x3',
        ].join('\n')
      )
    ).toEqual({
      player: 'bob',
      name: 'La zuppa del lunedì',
      lacking: [
        { item: 'un mestolo bucato 🥄', qty: 1, rarity: 'B2', tags: ['usabile'], level: null },
        { item: 'una rapa\nfilosofica', qty: 1, rarity: 'L1', tags: [], level: null },
      ],
      held: [
        {
          item: 'una pentola senza fondo',
          qty: 3,
          rarity: 'B1',
          tags: [],
          level: { low: 2, high: 4 },
        },
      ],
    });
    // Nothing held; a name that looks like a rarity and tags, to the last.
    expect(
      parseRecipeNeeds('@bob, per fare la ricetta X ti mancano:\n- un finto [Y] [scherzo] [B2] x1')
    ).toMatchObject({ held: [], lacking: [{ item: 'un finto [Y] [scherzo]', rarity: 'B2' }] });
    expect(
      parseRecipeNeeds('@bob, per fare la ricetta X ti mancano:\n- non finito')
    ).toBeUndefined();
    expect(parseRecipeNeeds('@bob, per fare la ricetta X ti mancano:')).toBeUndefined();
    expect(parseRecipeNeeds('Ricetta non trovata!')).toBeUndefined();
    expect(
      parseRecipeNeeds(
        '@bob, per fare la ricetta X ti mancano:\n- a [B1] x1\n\nMentre hai già:\n- b [B1] x1\n\nMentre hai già:\n- c [B1] x1'
      )
    ).toBeUndefined();
    expect(
      parseRecipeNeeds(
        '@bob, per fare la ricetta X ti mancano:\n- a [B1] x1\n\nMentre hai già:\n- b'
      )
    ).toBeUndefined();
  });

  it('reads a recipe made: what it took and gave; not a recipe being created', () => {
    const MADE = [
      '@bob, prendi in mano:',
      '- una pentola senza fondo [B1] x1',
      '- un mestolo bucato 🥄 [B2] x2',
      '',
      'e mescoli piano.',
      '',
      'Ottieni: Il brodo cosmico 🍲 [L1]!',
    ].join('\n');
    expect(parseRecipeMade(MADE)).toEqual({
      player: 'bob',
      used: [
        { item: 'una pentola senza fondo', qty: 1, rarity: 'B1', tags: [], level: null },
        { item: 'un mestolo bucato 🥄', qty: 2, rarity: 'B2', tags: [], level: null },
      ],
      made: { item: 'Il brodo cosmico 🍲', qty: 1, rarity: 'L1', tags: [], level: null },
    });
    // A recipe being made (/generaricetta) previews the same after its command, with a cost.
    expect(
      parseRecipeMade(
        `/ricetta Il brodo\n\n${MADE.replace('Ottieni: ', 'Ottieni: 1x ')}\n\nCosto: 60₭`
      )
    ).toBeUndefined();
    expect(parseRecipeMade(MADE.replace('- una pentola', 'una pentola'))).toBeUndefined();
    expect(parseRecipeMade('@bob, prendi in mano:\n\nOttieni: un sasso [B1]!')).toBeUndefined();
  });
});
