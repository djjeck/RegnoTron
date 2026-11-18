import { describe, expect, it } from 'vitest';
import { type Heard } from './bans.ts';
import { initialState, playerOf, reduce } from './loregame-state.ts';
import { parseTraining, trainingReading, TrainingWatch } from './training.ts';

// The bot's own phrases are the game's; the factions and items are invented.
const T = Date.parse('2026-11-06T12:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const GROUP = '-1001';
const TRAINED = '🏋🏼 Ti sei allenato! Hai imparato qualcosa di nuovo... (+10)';
const AT_GYM =
  '🏋🏼 Ti sei allenato nella palestra di Una Fazione, Srl 🏛! Hai imparato qualcosa di nuovo... (+15)';
const SOON = (wait: string) =>
  `Non è passato abbastanza tempo dal tuo ultimo allenamento! Riprova fra ${wait}.`;

describe('the training’s answers', () => {
  it('reads a training: where, what it taught, a bonus, a level-up', () => {
    expect(parseTraining(TRAINED)).toEqual({ result: 'trained', gym: null, learned: 10, extra: 0 });
    expect(parseTraining(AT_GYM)).toMatchObject({ gym: 'Una Fazione, Srl 🏛', learned: 15 });
    expect(parseTraining(`${AT_GYM}\n\n💪🏻 +2 extra`)).toMatchObject({ learned: 15, extra: 2 });
    const up = [
      '🎉 Congratulazioni, hai raggiunto il livello 4! 🎉',
      'Ottieni:',
      '> 40 monete',
      '> 1 punto /abilita',
      '> 1 una scatola 📦 [X] [usabile]',
    ].join('\n');
    expect(parseTraining(`${AT_GYM}\n\n${up}`)).toMatchObject({
      result: 'trained',
      learned: 15,
      levelUp: {
        level: 4,
        coins: 40,
        skillPoints: 1,
        items: [{ item: 'una scatola 📦', qty: 1, rarity: 'X', tags: ['usabile'] }],
      },
    });
  });

  it('reads "too soon" with the wait left, in every form the bot writes it', () => {
    const wait = (w: string) => (parseTraining(SOON(w)) as { retryMs: number }).retryMs;
    expect(wait('23 ore, 59 minuti e 50 secondi')).toBe(DAY - 10_000);
    expect(wait('1 ora, 21 minuti e 11 secondi')).toBe((81 * 60 + 11) * 1000);
    expect(wait('38 minuti e 1 secondo')).toBe((38 * 60 + 1) * 1000);
    expect(wait('4 ore e 2 secondi')).toBe((4 * 3600 + 2) * 1000);
  });

  it('reads nothing else: the turn’s "too soon", a quote, an unstated wait', () => {
    expect(parseTraining('Non è passato abbastanza tempo! Riprova fra 5 minuti.')).toBeUndefined();
    expect(parseTraining(`Una storia.\n${TRAINED}`)).toBeUndefined();
    expect(parseTraining(SOON('poco'))).toBeUndefined();
    expect(parseTraining('Devi essere almeno di livello 4!')).toBeUndefined();
  });

  it('is a success to the shell, or a "too soon" holding it for its wait', () => {
    expect(trainingReading({ result: 'trained', gym: null, learned: 10, extra: 0 })).toEqual({
      outcome: { kind: 'training', bot: 'LoreGameBot', gym: null, learned: 10, extra: 0 },
    });
    expect(trainingReading({ result: 'soon', retryMs: 5000 })).toEqual({
      outcome: { kind: 'nothing', bot: 'LoreGameBot', reason: 'cooldown', retryMs: 5000 },
      restMs: 5000,
    });
  });
});

describe('the training watch', () => {
  const said = (sender: string, text: string, m: Partial<Heard> = {}): Heard => ({
    chat: GROUP,
    sender,
    text,
    time: T,
    id: `${sender}-${text}`,
    ...m,
  });

  it('gives each training in the group to the oldest command waiting, the owner’s by name', () => {
    const w = new TrainingWatch('LoreGameBot');
    w.answer(said('bob', '/allenati'), 'alice');
    w.sent({ chat: GROUP, id: 'mine', t: T + 1000, command: '/allenati@LoreGameBot' });
    expect(w.answer(said('LoreGameBot', AT_GYM, { time: T + 2000 }), 'alice')).toMatchObject({
      player: 'bob',
      owner: false,
      reply: { result: 'trained', learned: 15 },
    });
    expect(w.answer(said('LoreGameBot', TRAINED, { time: T + 3000 }), 'alice')).toMatchObject({
      player: 'alice',
      owner: true,
    });
    // Nobody waits: a training in the group is no one's, in private the owner's.
    expect(w.answer(said('LoreGameBot', TRAINED, { time: T + 4000 }), 'alice')).toBeUndefined();
    expect(
      w.answer(said('LoreGameBot', TRAINED, { chat: '@LoreGameBot', private: true }), 'alice')
    ).toMatchObject({ owner: true });
    // Another command is not its own.
    w.sent({ chat: GROUP, t: T + 5000, command: '/accumulo' });
    expect(w.answer(said('LoreGameBot', TRAINED, { time: T + 6000 }), 'alice')).toBeUndefined();
  });
});

describe('a player’s trainings, in the state', () => {
  const training = (t: number, payload: object) => ({
    type: 'loregame.training',
    t,
    chat: GROUP,
    player: 'bob',
    owner: false,
    ...payload,
  });

  it('counts a training seen, and one a "too soon" tells of, but not a "too soon" that agrees', () => {
    let s = reduce(initialState(), training(T, { result: 'trained', learned: 10 }));
    expect(playerOf(s, 'bob')?.training).toEqual({
      seen: 1,
      unseen: 0,
      last: new Date(T).toISOString(),
      until: new Date(T + DAY).toISOString(),
    });
    // Within the day, the wait the bot states agrees (to the second, give or take).
    s = reduce(s, training(T + 10 * 60 * MIN, { result: 'soon', retryMs: 14 * 60 * MIN + 5000 }));
    expect(playerOf(s, 'bob')?.training.unseen).toBe(0);
    // A day and more later, a wait of ten hours: a training in private, two hours after its end.
    s = reduce(s, training(T + DAY + 4 * 60 * MIN, { result: 'soon', retryMs: 20 * 60 * MIN }));
    expect(playerOf(s, 'bob')?.training).toMatchObject({ seen: 1, unseen: 1 });
    // A "too soon" before any training seen tells of nothing it can count.
    s = reduce(s, { ...training(T, { result: 'soon', retryMs: MIN }), player: 'carol' });
    expect(playerOf(s, 'carol')?.training).toMatchObject({ seen: 0, unseen: 0 });
  });
});
