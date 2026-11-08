import { GameState } from '@regnotron/norelec/state/game-state.ts';
import { describe, expect, it } from 'vitest';
import {
  countBalls,
  DELETE_AFTER_MS,
  formatWarning,
  italianNumber,
  nuclearWarningCommand,
  shareOfNuke,
} from './nuclear-warning.ts';

/** A game state with these balances, and a player whose balance is not known. */
function stateWith(balances: Record<string, number>): GameState {
  const state = new GameState();
  for (const [name, balls] of Object.entries(balances))
    state.player(name).balance = { balls, at: 0 };
  state.player('Unknown');
  return state;
}

describe('countBalls', () => {
  it('adds up the known balances and lists those with 50,000 (5% of a ☢️) or more, richest first', () => {
    const count = countBalls(
      stateWith({ Gianpier: 249_845, Mirco: 18_982, Juno: 422_865, Ada: 50_000, Bob: 49_999 })
    );
    expect(count).toEqual({
      total: 791_691,
      listed: [
        { name: 'Juno', balls: 422_865 },
        { name: 'Gianpier', balls: 249_845 },
        { name: 'Ada', balls: 50_000 },
      ],
    });
  });

  it('counts the balls on the road with a player whose balance is known', () => {
    const state = stateWith({ Juno: 1_000, Mirco: 0 });
    state.player('Mirco').trip = {
      to: 'Juno',
      departedAt: 0,
      arriveAt: 0,
      arrived: false,
      carrying: 300_000,
    };
    state.player('Unknown').trip = {
      to: 'Juno',
      departedAt: 0,
      arriveAt: 0,
      arrived: false,
      carrying: 5,
    };
    expect(countBalls(state)).toEqual({
      total: 301_000,
      listed: [{ name: 'Mirco', balls: 300_000 }],
    });
  });
});

describe('formatWarning', () => {
  it("writes the issue's example", () => {
    expect(
      formatWarning({
        total: 736_920,
        listed: [
          { name: 'Juno', balls: 320_000 },
          { name: 'Gianpier', balls: 280_000 },
        ],
      })
    ).toBe(
      [
        '**AGGIORNAMENTO DELLA PROTEZIONE CIVILE**',
        'Ci sono 736.920 palle in circolazione.',
        'È il 74% di una ☢️**BOMBATOMICA**☢️',
        '',
        '- Juno detiene il 32% di una ☢️',
        '- Gianpier detiene il 28% di una ☢️',
      ].join('\n')
    );
  });

  it('puts the list and the footer apart, each in a paragraph of its own', () => {
    expect(
      formatWarning({ total: 736_920, listed: [{ name: 'Juno', balls: 320_000 }] }, 'Footer')
    ).toBe(
      [
        '**AGGIORNAMENTO DELLA PROTEZIONE CIVILE**',
        'Ci sono 736.920 palle in circolazione.',
        'È il 74% di una ☢️**BOMBATOMICA**☢️',
        '',
        '- Juno detiene il 32% di una ☢️',
        '',
        'Footer',
      ].join('\n')
    );
  });

  it('leaves the list out without a player to list, and adds the footer apart', () => {
    expect(formatWarning({ total: 1_740_000, listed: [] }, 'Messaggio offerto da /x')).toBe(
      [
        '**AGGIORNAMENTO DELLA PROTEZIONE CIVILE**',
        'Ci sono 1.740.000 palle in circolazione.',
        'È il 174% di una ☢️**BOMBATOMICA**☢️',
        '',
        'Messaggio offerto da /x',
      ].join('\n')
    );
  });
});

describe('italianNumber', () => {
  it('puts dots between the thousands', () => {
    expect([0, 7, 999, 1000, 7360, 736_920, 1_000_000].map(italianNumber)).toEqual([
      '0',
      '7',
      '999',
      '1.000',
      '7.360',
      '736.920',
      '1.000.000',
    ]);
  });
});

describe('shareOfNuke', () => {
  it('rounds to a whole percent, with the article Italian wants', () => {
    const shares = [0, 4_999, 5_000, 80_000, 110_000, 115_000, 180_000, 845_000, 1_000_000];
    expect(shares.map(shareOfNuke)).toEqual([
      'lo 0%',
      'lo 0%',
      "l'1%",
      "l'8%",
      "l'11%",
      'il 12%',
      'il 18%',
      "l'85%",
      'il 100%',
    ]);
  });
});

describe('nuclearWarningCommand', () => {
  it('answers with the count as the game state has it, to be deleted from the group in 30 s', async () => {
    const said: string[] = [];
    await nuclearWarningCommand(stateWith({ Juno: 422_865, Gianpier: 249_845, Mirco: 22_290 }))({
      text: (t, format, options) => (
        said.push(`${format}, deleted from the group in ${options?.deleteInGroupAfterMs} ms: ${t}`),
        Promise.resolve()
      ),
      photo: () => Promise.resolve(undefined),
    });
    expect(DELETE_AFTER_MS).toBe(30_000);
    expect(said).toEqual([
      'markdown, deleted from the group in 30000 ms: ' +
        [
          '**AGGIORNAMENTO DELLA PROTEZIONE CIVILE**',
          'Ci sono 695.000 palle in circolazione.',
          'È il 70% di una ☢️**BOMBATOMICA**☢️',
          '',
          '- Juno detiene il 42% di una ☢️',
          '- Gianpier detiene il 25% di una ☢️',
        ].join('\n'),
    ]);
  });
});
