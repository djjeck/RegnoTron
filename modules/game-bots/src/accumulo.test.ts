import { describe, expect, it } from 'vitest';
import {
  ACCUMULO_COMMANDS,
  accumuloReady,
  accumuloRest,
  type AccumuloView,
  AccumuloWatch,
  ANSWER_WINDOW_MS,
  isAccumuloCommand,
  LOOK_AGAIN_MS,
  parseAccumulo,
  POLL_MS,
  WAIT_MS,
} from './accumulo.ts';
import { type Heard } from './bans.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const GROUP = '-1001';
const SHORT = 'Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 7/20';
const USED =
  '🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore';

let n = 0;
/** A message heard: a player's, in the group, unless it says otherwise. */
const said = (sender: string, text: string, m: Partial<Heard> = {}): Heard => ({
  chat: GROUP,
  sender,
  text,
  time: T,
  id: String(n++),
  ...m,
});
const owner = (text: string, m: Partial<Heard> = {}): Heard =>
  said('alice', text, { own: true, ...m });
const bot = (text: string, m: Partial<Heard> = {}): Heard => said('LoreGameBot', text, m);

describe('what the bot answers to /accumulo', () => {
  it('reads the counter, a full accumulo with nothing to zero, a use and the level gate', () => {
    expect(parseAccumulo(SHORT)).toEqual({ result: 'short', count: 7, max: 20 });
    // A player with the Stoccaggio skill needs fewer turns.
    expect(parseAccumulo('Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 0/17')).toEqual({
      result: 'short',
      count: 0,
      max: 17,
    });
    expect(parseAccumulo('La lore è già pronta!\n\nIl tuo accumulo: 19/19')).toEqual({
      result: 'idle',
      count: 19,
      max: 19,
    });
    expect(parseAccumulo(USED)).toEqual({ result: 'used' });
    expect(parseAccumulo('Devi essere almeno di livello 4!')).toEqual({
      result: 'locked',
      level: 4,
    });
    // Whitespace around, and the other normal form of an accent.
    expect(parseAccumulo(`  La lore è già pronta!\r\n\r\nIl tuo accumulo: 20/20\n`)).toEqual({
      result: 'idle',
      count: 20,
      max: 20,
    });
  });

  it('reads nothing else: a turn quoting it, a counter without a maximum, the form of before', () => {
    const turn = `Lore - Il Bosco Inventato ⛅️ [B1]\n\n${SHORT}\n\nHai ottenuto un sasso [B1]!`;
    expect(parseAccumulo(turn)).toBeUndefined();
    expect(parseAccumulo(`${SHORT} e altro`)).toBeUndefined();
    expect(
      parseAccumulo('Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 7/0')
    ).toBeUndefined();
    expect(parseAccumulo('Accumulo non ancora sufficiente!')).toBeUndefined();
    // Until 15 Feb 2026 the bot wrote a second battery after the exclamation mark.
    expect(parseAccumulo(USED.replace('SI ATTIVA! ', 'SI ATTIVA! 🔋 '))).toBeUndefined();
    expect(parseAccumulo('Devi essere almeno di livello quattro!')).toBeUndefined();
    expect(parseAccumulo('')).toBeUndefined();
  });

  it('knows the commands, bare or addressed to its bot', () => {
    expect(ACCUMULO_COMMANDS).toEqual(['/accumulo', '/acc']);
    for (const text of ['/acc', '/accumulo', ' /ACC ', '/accumulo@LoreGameBot', '/acc@loregamebot'])
      expect(isAccumuloCommand(text, 'LoreGameBot')).toBe(true);
    for (const text of ['/acc@OtherBot', '/accumulo 5', '/accu', 'acc', '/lore', '/acc/acc'])
      expect(isAccumuloCommand(text, 'LoreGameBot')).toBe(false);
  });
});

describe('whose answer it is', () => {
  it('is the owner’s, in private, with the command or without one', () => {
    const w = new AccumuloWatch('LoreGameBot');
    const asked = owner('/accumulo', { chat: '@LoreGameBot', private: true });
    expect(w.hear(asked)).toBeUndefined();
    expect(
      w.hear(bot(SHORT, { chat: '@LoreGameBot', private: true, replyTo: asked.id as string }))
    ).toEqual({ result: 'short', count: 7, max: 20 });
    // A command the parser did not hear (sent elsewhere): the answer says what it is.
    expect(w.hear(bot(USED, { chat: '@LoreGameBot', private: true }))).toEqual({ result: 'used' });
    // The level gate is any command's: it counts only after the command.
    const gate = 'Devi essere almeno di livello 4!';
    expect(w.hear(bot(gate, { chat: '@LoreGameBot', private: true }))).toBeUndefined();
    w.hear(owner('/acc', { chat: '@LoreGameBot', private: true }));
    expect(w.hear(bot(gate, { chat: '@LoreGameBot', private: true }))).toEqual({
      result: 'locked',
      level: 4,
    });
  });

  it('is, in the group, that of the oldest command waiting, as the bot answers them', () => {
    const w = new AccumuloWatch('LoreGameBot');
    // Bob asks first, the owner second: the bot answers in order, to no one in particular.
    w.hear(said('bob', '/acc'));
    w.hear(owner('/accumulo@LoreGameBot'));
    expect(w.hear(bot(SHORT))).toBeUndefined();
    expect(w.hear(bot(USED))).toEqual({ result: 'used' });
    // Nothing is waiting any more: whose could it be?
    expect(w.hear(bot(USED))).toBeUndefined();
    // The owner first: theirs is the first.
    w.hear(owner('/acc'));
    w.hear(said('carol', '/acc'));
    expect(w.hear(bot(SHORT))).toEqual({ result: 'short', count: 7, max: 20 });
    expect(w.hear(bot(SHORT))).toBeUndefined();
  });

  it('keeps each chat’s commands apart, and forgets a command the bot did not answer', () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.hear(owner('/acc', { chat: '-1002' }));
    w.hear(said('bob', '/acc'));
    // The answer in the group is bob's, not the owner's of the other chat.
    expect(w.hear(bot(SHORT))).toBeUndefined();
    w.hear(owner('/acc'));
    // The bot never answered; a later answer is not that command's.
    expect(w.hear(bot(SHORT, { time: T + ANSWER_WINDOW_MS + 1 }))).toBeUndefined();
    w.hear(owner('/acc', { time: T + ANSWER_WINDOW_MS + 5 }));
    expect(w.hear(bot(SHORT, { time: T + ANSWER_WINDOW_MS + 6 }))).toEqual({
      result: 'short',
      count: 7,
      max: 20,
    });
  });

  it('ends a command’s wait with the reply the bot gave it, a ban included', () => {
    const w = new AccumuloWatch('LoreGameBot');
    const bobs = said('bob', '/acc');
    w.hear(bobs);
    w.hear(owner('/acc'));
    // Bob is banned: the bot replies to his message with the ban, and answers nothing else of his.
    expect(
      w.hear(bot('Sei stato bannato fino al 07/11/2026.', { replyTo: bobs.id as string }))
    ).toBeUndefined();
    // The next answer is the owner's.
    expect(w.hear(bot(SHORT))).toEqual({ result: 'short', count: 7, max: 20 });
    // The way the bot answered until February 2026: a reply to the command.
    const mine = owner('/acc');
    w.hear(mine);
    w.hear(said('bob', '/acc'));
    expect(w.hear(bot(USED, { replyTo: mine.id as string }))).toEqual({ result: 'used' });
    const theirs = said('bob', '/acc');
    w.hear(theirs);
    expect(w.hear(bot(USED, { replyTo: theirs.id as string }))).toBeUndefined();
  });

  it('is no one’s, in the group, when it replies to a message it never heard', () => {
    const w = new AccumuloWatch('LoreGameBot');
    w.hear(owner('/acc'));
    expect(w.hear(bot(SHORT, { replyTo: 'unheard' }))).toBeUndefined();
    // Another bot's, or another command's, or a player's words, are not answers.
    expect(w.hear(bot('Hai ottenuto un sasso [B1]!'))).toBeUndefined();
    expect(w.hear(said('bob', SHORT))).toBeUndefined();
    expect(w.hear(owner(SHORT))).toBeUndefined();
    w.hear(owner('/acc@OtherBot'));
    expect(w.hear(bot(SHORT, { time: T + 1 }))).toEqual({ result: 'short', count: 7, max: 20 });
  });
});

describe('when to send /accumulo', () => {
  it('is when the bot said it is full, and it is not behind a level', () => {
    expect(accumuloReady({ ready: true, locked: null })).toBe(true);
    expect(accumuloReady({ ready: false, locked: null })).toBe(false);
    expect(accumuloReady({ ready: true, locked: 4 })).toBe(false);
  });
});

describe('when a turn-actor may send /accumulo', () => {
  const MIN = 60_000;
  const NOW = T + 5 * MIN;
  const view = (v: Partial<AccumuloView> = {}): AccumuloView => ({
    ready: false,
    locked: null,
    count: 4,
    exact: true,
    max: 20,
    as_of: new Date(T).toISOString(),
    ...v,
  });
  const at = (a: { banUntil?: number; loreRests?: boolean } = {}) => ({
    now: NOW,
    banUntil: a.banUntil,
    loreRests: a.loreRests ?? true,
  });

  it('goes when the bot said it is full and the next /lore rests, and not before', () => {
    expect(accumuloRest(view({ ready: true }), at())).toBeUndefined();
    // Nothing to zero: it would be answered "already ready", and spend nothing.
    expect(accumuloRest(view({ ready: true }), at({ loreRests: false }))).toEqual({
      until: NOW + POLL_MS,
      why: 'the next /lore is not resting: nothing to zero',
    });
  });

  it('never goes on its own count: it waits for the bot’s word, and looks again in time', () => {
    // A count at the maximum is not the word.
    expect(accumuloRest(view({ count: 20 }), at())).toMatchObject({
      why: 'the accumulo is not full',
    });
    // Sixteen turns to go, a rest of 15 minutes each: it need not look for a long while, but does.
    expect(accumuloRest(view(), at())?.until).toBe(NOW + LOOK_AGAIN_MS);
    // One turn to go: the earliest it fills is a rest after the last turn the state heard.
    expect(accumuloRest(view({ count: 19 }), at())?.until).toBe(T + 15 * MIN);
    // That moment has passed (the turn is late): a few minutes at a time.
    expect(accumuloRest(view({ count: 19 }), { ...at(), now: T + 40 * MIN })?.until).toBe(
      T + 40 * MIN + POLL_MS
    );
    // A count that is only a floor, or has no time, rules nothing out.
    expect(accumuloRest(view({ count: 19, exact: false }), at())?.until).toBe(NOW + POLL_MS);
    expect(accumuloRest(view({ count: 19, as_of: null }), at())?.until).toBe(NOW + POLL_MS);
    // A count past the maximum still needs the bot's word, one turn at most away.
    expect(accumuloRest(view({ count: 25, max: null }), at())?.until).toBe(T + 15 * MIN);
  });

  it('waits out a ban and a level, an hour at a time when nothing says when they end', () => {
    expect(accumuloRest(view({ ready: true }), at({ banUntil: NOW + 7 * MIN }))).toEqual({
      until: NOW + 7 * MIN,
      why: 'the owner is banned',
    });
    expect(accumuloRest(view({ ready: true }), at({ banUntil: Infinity }))).toEqual({
      until: NOW + WAIT_MS,
      why: 'the owner is banned',
    });
    expect(accumuloRest(view({ ready: true, locked: 4 }), at())).toEqual({
      until: NOW + WAIT_MS,
      why: 'the accumulo needs level 4',
    });
  });
});
