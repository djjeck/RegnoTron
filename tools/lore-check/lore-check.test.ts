import { type Inbound } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { CHECKS, report } from './checks.ts';
import { parseArgs, standIns, USAGE } from './cli.ts';
import { replayLore } from './run.ts';

// An invented chat (CLAUDE.md, "Test data is synthetic"): the bot's phrases are the game's.
const T0 = Date.parse('2026-11-06T12:00:00Z');
const MIN = 60_000;
const GROUP = '-1001';
const DM = '@LoreGameBot';
const TURN = 'Lore - Il Bosco Inventato ⛅️ [B1]\n\nUna storia.\nHai ottenuto un sasso [B1]!';
const SOON = (min: number) => `Non è passato abbastanza tempo! Riprova fra ${min} minuti.`;

let n = 0;
const say = (at: number, sender: string, text: string, m: Partial<Inbound> = {}): Inbound => ({
  account: 'telegram:owner',
  network: 'telegram',
  chat: GROUP,
  sender,
  text,
  time: T0 + at * MIN,
  id: String(++n),
  playback: false,
  ...m,
});
/** A command and the bot's reply to it, a second later (the bot's own, whatever the command). */
const asked = (
  at: number,
  sender: string,
  command: string,
  answer: string,
  m: Partial<Inbound> = {}
): Inbound[] => {
  const q = say(at, sender, command, m);
  const { own: _, ...where } = m;
  return [
    q,
    { ...say(at, 'LoreGameBot', answer, where), time: q.time + 1000, replyTo: q.id as string },
  ];
};

function chat(): Inbound[] {
  return [
    // Bob's turn; a "too soon" within its rest, as predicted; then one when we held him rested.
    ...asked(0, 'bob', '/lore', TURN),
    ...asked(5, 'bob', '/l@LoreGameBot', SOON(10)),
    ...asked(40, 'bob', '/lore', SOON(5)),
    // Carol's turn the parser cannot read.
    ...asked(41, 'carol', '/lore', 'Manda un’immagine valida!'),
    // Bob's /acc, answered in a message of its own: two charges, his turn and the one unseen.
    say(42, 'bob', '/acc'),
    say(42, 'LoreGameBot', 'Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 2/20'),
    // The owner's turn, in private.
    ...asked(43, 'alice', '/lore', TURN, { chat: DM, private: true, own: true }),
  ];
}

describe('the lore check', () => {
  it('replays a chat through the real parser and state, and checks what they made of it', async () => {
    const run = await replayLore(chat(), { self: 'alice' });
    const [coverage, rests, accumulo, players] = CHECKS.map((c) => c.run(run));
    const row = (f: typeof coverage, label: string) =>
      f?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row(coverage, 'replies to a turn command')).toBe('5');
    expect(row(coverage, 'read as a turn')).toBe('4 of 5 (80.0%)');
    expect(row(coverage, 'by outcome')).toBe('gain ×2, nothing/cooldown ×2');
    expect(row(rests, '"too soon"s after a turn seen')).toBe('2');
    expect(row(rests, 'by verdict')).toBe('agrees ×1, a turn unseen ×1');
    expect(row(rests, 'turns seen before')).toBe('0');
    expect(row(accumulo, 'the bot’s counters')).toBe('1');
    expect(row(accumulo, 'agreeing')).toBe('1 of 1 (100.0%)');
    expect(row(accumulo, 'disagreements')).toBe('none');
    expect(row(players, 'players kept')).toBe('2');
    expect(row(players, 'turns told of')).toBe('1 of 3 (33.3%)');
    expect(players?.rows.map(([k]) => k)).toContain('bob');
    // Shown as stand-ins when asked.
    const hidden = await replayLore(chat(), { self: 'alice', name: standIns() });
    const named =
      CHECKS.find((c) => c.id === 'players')
        ?.run(hidden)
        .rows.map(([k]) => k) ?? [];
    expect(named).toEqual(expect.arrayContaining(['P1', 'P2']));
    expect(named).not.toContain('bob');
  });

  it('tells a turn before its rest after a use, seen or not, from one it cannot explain', async () => {
    const lit =
      'Lore - Il Bosco Inventato ⛅️ [B1]\n\n🔋 /accumulo pronto!\nHai ottenuto un sasso [B1]!';
    const used =
      '🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore';
    const run = await replayLore(
      [
        // Bob: full, a use heard, a turn at once.
        ...asked(0, 'bob', '/lore', lit),
        say(1, 'bob', '/acc'),
        say(1, 'LoreGameBot', used),
        ...asked(2, 'bob', '/lore', TURN),
        // Carol: full, and a turn at once: a use in private.
        ...asked(0, 'carol', '/lore', lit),
        ...asked(3, 'carol', '/lore', TURN),
        // Dave: far from full, and a turn at once: not a use.
        say(0, 'dave', '/acc'),
        say(0, 'LoreGameBot', 'Accumulo non ancora sufficiente!\n\nIl tuo accumulo: 3/20'),
        ...asked(1, 'dave', '/lore', TURN),
        ...asked(4, 'dave', '/lore', TURN),
      ],
      { self: 'alice' }
    );
    const rests = CHECKS.find((c) => c.id === 'rests')?.run(run);
    const row = (label: string) => rests?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row('turns seen before the predicted rest ended')).toBe('3');
    expect(row('… after a use of the accumulo seen')).toBe('1');
    expect(row('… telling of a use unseen')).toBe('1');
    expect(row('… not a use')).toBe('1');
    expect(report([rests as NonNullable<typeof rests>])).toMatch(/^## Rest model\n- /u);
  });

  it('reads its command line, and says what it needs', () => {
    const args = ['exports/a', '--owner', 'Alice A.', '--username', '@alice', '--bot', 'The Bot'];
    expect(
      parseArgs([...args, '--since', '2026-10-01', '--names', '--time-zone', 'Europe/Rome'])
    ).toEqual({
      paths: ['exports/a'],
      owner: ['Alice A.'],
      username: 'alice',
      bot: 'The Bot',
      since: Date.parse('2026-10-01'),
      timeZone: 'Europe/Rome',
      names: true,
    });
    expect(parseArgs(['exports/a'])).toBe(USAGE);
    expect(parseArgs([...args, '--since', 'yesterday'])).toBe('--since: not a date');
    expect(parseArgs([...args, '--bogus'])).toBe('unknown option --bogus');
    expect(parseArgs([...args, '--bot'])).toBe('--bot needs a value');
  });
});
