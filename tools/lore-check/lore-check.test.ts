import { type Inbound } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { CHECKS, report } from './checks.ts';
import { parseArgs, standIns, USAGE } from './cli.ts';
import { mergeRenamedChats, replayLore } from './run.ts';

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
    const [coverage, rests, accumulo, , , , players] = CHECKS.map((c) => c.run(run));
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
        // Erin: /avventura, then /lore at once: the bot gives both.
        ...asked(10, 'erin', '/avventura', TURN),
        { ...say(10, 'erin', '/lore'), time: T0 + 10 * MIN + 20_000, id: 'erin-lore' },
        { ...say(10, 'LoreGameBot', TURN), time: T0 + 10 * MIN + 21_000, replyTo: 'erin-lore' },
      ],
      { self: 'alice' }
    );
    const rests = CHECKS.find((c) => c.id === 'rests')?.run(run);
    const row = (label: string) => rests?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row('turns seen before the predicted rest ended')).toBe('4');
    expect(row('… a double turn')).toBe('1');
    expect(row('… after a use of the accumulo seen')).toBe('1');
    expect(row('… telling of a use unseen')).toBe('1');
    expect(row('… not a use')).toBe('1');
    expect(report([rests as NonNullable<typeof rests>])).toMatch(/^## Rest model\n- /u);
  });

  it('checks each training "too soon" against the day after the last training seen', async () => {
    const TRAINED = '🏋🏼 Ti sei allenato! Hai imparato qualcosa di nuovo... (+10)';
    const SOON = (wait: string) =>
      `Non è passato abbastanza tempo dal tuo ultimo allenamento! Riprova fra ${wait}.`;
    const run = await replayLore(
      [
        // Bob trains, in a message of the bot's own; then a "too soon" that agrees.
        say(0, 'bob', '/allenati'),
        say(0, 'LoreGameBot', TRAINED),
        ...asked(60, 'bob', '/allenati', SOON('23 ore')),
        // A day and a half later, a wait that tells of a training in private.
        ...asked(36 * 60, 'bob', '/allenati@LoreGameBot', SOON('20 ore')),
        // Carol's answer the parser cannot pair: nobody's command was heard.
        say(37 * 60, 'LoreGameBot', TRAINED),
      ],
      { self: 'alice' }
    );
    const found = CHECKS.find((c) => c.id === 'training')?.run(run);
    const row = (label: string) => found?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row('/allenati sent')).toBe('3');
    expect(row('answers paired')).toBe('3 of 3 (100.0%)');
    expect(row('… trainings')).toBe('1');
    expect(row('by verdict')).toBe('agrees ×1, a training unseen ×1');
  });

  it('places the level-ups, and gives the XP seen before each level reached', async () => {
    const UP = (level: number) =>
      `\n\n🎉 Congratulazioni, hai raggiunto il livello ${level}! 🎉\nOttieni:\n> 10 monete`;
    const WON = (learned: number) =>
      [
        'Lore - Il Bosco Inventato ⛅️ [B1]',
        '',
        'Una storia.',
        'Durante il tuo cammino compare un orso [L2]!',
        'Il combattimento inizia...',
        `Bobby [L3] sconfigge un orso [L2]! Hai imparato qualcosa di nuovo... (+${learned})`,
        'Hai ottenuto un sasso [B1]!',
      ].join('\n');
    const run = await replayLore(
      [
        ...asked(0, 'bob', '/lore', WON(4) + UP(4)),
        ...asked(20, 'bob', '/lore', WON(5)),
        ...asked(40, 'bob', '/lore', WON(6) + UP(5)),
        // One that replies to nothing: not placed.
        say(60, 'LoreGameBot', 'Qualcosa accade.' + UP(9)),
      ],
      { self: 'alice' }
    );
    const found = CHECKS.find((c) => c.id === 'levels')?.run(run);
    const row = (label: string) => found?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row('the bot’s level-ups')).toBe('3');
    expect(row('placed with a player')).toBe('2 of 3 (66.7%)');
    // Each turn 1, and its win's "+N".
    expect(row('XP seen gained')).toBe('18');
    expect(row('… XP seen before reaching level 5')).toBe('13');
    expect(row('… XP seen before reaching level 4')).toBeUndefined();
  });

  it('checks each profile against the XP and the turns the state held since the last one', async () => {
    const PROFILE = (level: number, xp: number, episode: number) =>
      [
        '👤 bob',
        '',
        '👥 Nessuna azienda',
        '',
        `Livello ${level} (${xp} ⚔️)`,
        '▓░░░░░░░░░ 10.00%',
        '',
        'Il Bene 😇',
        `Episodio ${episode}`,
        '0 ₭',
        '',
        'Armatura 🛡 - (vuoto)',
        'Amuleto 🩺 - (vuoto)',
        'Arma 🗡 - (vuoto)',
        '',
        '',
        'Attualmente in Il Bosco Inventato ⛅️ [B1]',
      ].join('\n');
    const run = await replayLore(
      [
        ...asked(0, 'bob', '/me', PROFILE(3, 250, 100)),
        ...asked(1, 'bob', '/lore', TURN),
        ...asked(20, 'bob', '/lore', TURN),
        // Two turns: XP and episodes agree.
        ...asked(30, 'bob', '/me', PROFILE(3, 252, 102)),
        ...asked(31, 'bob', '/lore', TURN),
        // One turn seen, two taken; and a level its XP does not make.
        ...asked(50, 'bob', '/me', PROFILE(4, 260, 104) + '\nUna riga nuova'),
      ],
      { self: 'alice' }
    );
    const found = CHECKS.find((c) => c.id === 'profiles')?.run(run);
    const rows = found?.rows ?? [];
    const row = (label: string, n = 0) => rows.filter(([k]) => k.startsWith(label))[n]?.[1];
    expect(row('profiles read')).toBe('3');
    expect(row('their level as their XP makes it')).toBe('2 of 3 (66.7%)');
    expect(row('lines left unread')).toBe('1');
    // Episodes: the first interval agrees, the second has a turn unseen.
    expect(row('… by verdict', 0)).toBe('agrees ×1, off by +1 ×1');
    // XP: tested where every turn was seen alone.
    expect(row('with every turn seen')).toBe('1 of 1 (100.0%)');
  });

  it('places a player by their turns without a profile, and checks it at their first', async () => {
    const PROFILE = (player: string, faction: string, place: string) =>
      [
        `👤 ${player}`,
        '',
        '👥 Nessuna azienda',
        '',
        'Livello 1 (5 ⚔️)',
        '',
        faction,
        'Episodio 3',
        '0 ₭',
        '',
        `Attualmente in ${place}`,
      ].join('\n');
    const MALE = TURN.replace('Il Bosco Inventato ⛅️ [B1]', 'La Valle Finta 🌄 [M3]');
    const run = await replayLore(
      [
        ...asked(0, 'bob', '/lore', TURN),
        ...asked(1, 'carol', '/lore', MALE),
        ...asked(2, 'dave', '/lore', TURN),
        // Bob as his turn told; carol elsewhere since, and of another faction than the ladder's.
        ...asked(3, 'bob', '/me', PROFILE('bob', 'Il Bene 😇', 'Il Bosco Inventato ⛅️ [B1]')),
        ...asked(4, 'carol', '/me', PROFILE('carol', 'Il Bene 😇', 'Il Limbo 🕑 [N1]')),
      ],
      { self: 'alice' }
    );
    const f = CHECKS.find((c) => c.id === 'whereabouts')?.run(run);
    const row = (label: string) => f?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row('players with no profile read')).toBe('1');
    expect(row('of them, with a place')).toBe('1 of 1 (100.0%)');
    expect(row('of them, with a faction')).toBe('1 of 1 (100.0%)');
    expect(row('first profiles agreeing with the place')).toBe('1 of 2 (50.0%)');
    expect(row('first profiles agreeing with the faction')).toBe('1 of 2 (50.0%)');
  });

  it('reads every shop listing, and tells the days and the items they sold', async () => {
    const SHOP = (player: string, ...items: string[]) =>
      [`${player}, oggi nel negozio:`, ...items].join('\n');
    const PIGNA = '- 🛒 una pigna [B1] 200₭';
    const GEN = '- 🛒 un generatore di oggetti [X] [generatore] 100₭';
    const run = await replayLore(
      [
        // Two listings in a day, the same items; one of another day (13:00 + 12 hours, in Rome).
        ...asked(0, 'bob', '/negozio', SHOP('bob', PIGNA, GEN)),
        ...asked(5, 'carol', '/shop', SHOP('carol', PIGNA.replace('🛒', '✅'), GEN)),
        ...asked(12 * 60, 'bob', '/negozio', SHOP('bob', '- 🛒 un sasso [B2] 50₭')),
      ],
      { self: 'alice' }
    );
    const shop = CHECKS.find((c) => c.id === 'shop')?.run(run);
    const row = (label: string) => shop?.rows.find(([k]) => k.startsWith(label))?.[1];
    expect(row('listings of the bot’s')).toBe('3');
    expect(row('read')).toBe('3 of 3 (100.0%)');
    expect(row('days')).toBe('2');
    expect(row('sagra days')).toBe('0');
    expect(row('changes of the items within a day')).toBe('0');
    expect(row('items seen on sale')).toBe('3 (1 generators)');
    expect(row('players whose purchases were told')).toBe('2');
    // The catalogue: the three items, two first seen in the shop, the sasso the next day.
    const cat = CHECKS.find((c) => c.id === 'catalogue')?.run(run);
    const of = (label: string) => cat?.rows.find(([k]) => k === label)?.[1];
    expect(of('items seen')).toBe('3');
    expect(of('generators')).toBe('1');
    expect(of('first seen by')).toBe('shop ×3');
    expect(of('by rarity')).toBe('B1 ×1, X ×1, B2 ×1');
  });

  it('takes a group renamed between two exports as one chat, each message once', () => {
    const before = Array.from({ length: 12 }, (_, i) => say(i, 'bob', `messaggio ${i}`));
    // The later export, titled anew, holds the last ten again, and two more.
    const after = [...before.slice(2), say(20, 'bob', 'dopo'), say(21, 'bob', 'ancora')].map(
      (m) => ({ ...m, chat: 'Il Gruppo, rinominato' })
    );
    const elsewhere = say(5, 'bob', 'altrove', { chat: '@LoreGameBot', private: true });
    const merged = mergeRenamedChats([...before, ...after, elsewhere]);
    expect(merged).toHaveLength(15);
    expect(new Set(merged.map((m) => m.chat))).toEqual(new Set([GROUP, '@LoreGameBot']));
    // Fewer shared than the threshold: two chats, as they are.
    const few = mergeRenamedChats([
      ...before.slice(0, 3),
      ...before.slice(0, 3).map((m) => ({ ...m, chat: 'Altro' })),
    ]);
    expect(new Set(few.map((m) => m.chat))).toEqual(new Set([GROUP, 'Altro']));
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
