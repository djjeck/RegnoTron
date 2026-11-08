import { Rng } from '@megabottron1999/core/rng.ts';
import { describe, expect, it } from 'vitest';
import { parseMessage } from '#src/game/parse-message.ts';
import { GameState } from '#src/state/game-state.ts';
import { type ArenaSetup, Engine, type EngineMessage } from './engine.ts';

const S = 1000;
const T0 = Date.UTC(2026, 9, 22, 18, 0, 0);

/** Alfa, Bravo and Charlie on a line, 60 s apart; Delta far off. */
const setup = (over: Partial<ArenaSetup> = {}): ArenaSetup => ({
  seed: 1,
  start: T0,
  players: [
    { name: 'Alfa', x: 0, y: 0, balls: 5000, carried: ['🎈'] },
    { name: 'Bravo', x: 60, y: 0, balls: 3000 },
    { name: 'Charlie', x: 120, y: 0, balls: 200, carried: ['🎈'], house: ['🎈'] },
    { name: 'Delta', x: 0, y: 300, balls: 10000, carried: ['🎈', '⚡'] },
  ],
  ...over,
});
const text = (out: EngineMessage[]): string => out.map((m) => m.text).join('\n');
const kinds = (out: EngineMessage[]): string[] =>
  out.flatMap((m) => parseMessage(m.text).map((e) => e.kind));

describe('rng', () => {
  it('draws the same numbers for the same seed', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    expect([a.next(), a.int(1, 6), a.pick(['x', 'y'])]).toEqual([
      b.next(),
      b.int(1, 6),
      b.pick(['x', 'y']),
    ]);
  });
});

describe('raids', () => {
  it('travels, robs 7 balls a second of distance and comes home', () => {
    const e = new Engine(setup(), { dreamBase: 0, foundBalls: 0 });
    expect(text(e.command(T0, 'Alfa', '!raid Bravo'))).toBe(
      'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.'
    );
    expect(e.player('Alfa').at).toBe('trip');
    expect(e.nextAt()).toBe(T0 + 60 * S);
    const arrival = e.advance(T0 + 60 * S);
    expect(text(arrival)).toBe(
      'Alfa (🎈) hai rubato 420 palle a Bravo! Torni in Alfa tra 1 minuto.'
    );
    expect(kinds(e.advance(T0 + 120 * S))).toEqual(['returnHome']);
    expect([e.player('Alfa').balls, e.player('Bravo').balls]).toEqual([5420, 2580]);
  });

  it('is faster with a rocket, refused on the road, and dreams when tired', () => {
    const e = new Engine(
      setup({
        players: [
          { name: 'Alfa', x: 0, y: 0, balls: 0, carried: ['🚀'] },
          { name: 'Bravo', x: 110, y: 0, balls: 0 },
        ],
      }),
      { dreamBase: 0, dreamUnder10s: 1, foundBalls: 0, dreamRevealed: 1, dreamRevealS: [30, 30] }
    );
    expect(text(e.command(T0, 'Alfa', '!raid Bravo'))).toBe(
      '🚀 Alfa parti per Bravo: arrivi tra 1 minuto e 40 secondi. Alfa resta scoperto.'
    );
    expect(text(e.command(T0 + S, 'Alfa', '!raid Bravo'))).toBe(
      'Alfa sei già in viaggio, torni tra 3 minuti e 19 secondi.'
    );
    e.advance(T0 + 200 * S);
    expect(e.player('Alfa').at).toBe('home');
    // Leaving 5 s after the return is a dream: shown, never made, revealed 30 s after the arrival.
    expect(kinds(e.command(T0 + 205 * S, 'Alfa', '!raid Bravo'))).toEqual(['depart']);
    expect(e.player('Alfa').at).toBe('home');
    expect(kinds(e.advance(T0 + 400 * S))).toEqual(['dreamDepart']);
  });

  it('rolls the 🎈 counter at a guarded house, and takes no more than the victim has', () => {
    const e = new Engine(setup({ seed: 3 }), { dreamBase: 0, foundBalls: 0 });
    const outcomes: string[] = [];
    let t = T0;
    for (let i = 0; i < 8; i++) {
      e.command(t, 'Bravo', '!raid Charlie');
      outcomes.push(...kinds(e.advance(t + 60 * S)));
      e.advance(t + 120 * S);
      t += 300 * S;
    }
    expect(outcomes).toContain('balloonHeld');
    expect(outcomes).toContain('theft');
    expect(e.player('Charlie').balls).toBe(0);
  });

  it('applies the house defences: dog, pity, salt, pirate flag, dinosaur', () => {
    const players = [
      { name: 'Alfa', x: 0, y: 0, balls: 1000, carried: ['🏴‍☠️', '🏴‍☠️', '🏴‍☠️', '🏴‍☠️', '🏴‍☠️'] },
      {
        name: 'Bravo',
        x: 60,
        y: 0,
        balls: 9000,
        house: ['🥺', '🥺', '🧂', '🦖', '🦖', '🦖', '🦖', '🦖', '💣', '🐶'],
      },
    ];
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const e = new Engine(
        { seed, start: T0, players },
        { dreamBase: 0, dreamUnder10s: 0, dreamUnder60s: 0, foundBalls: 0 }
      );
      let t = T0;
      for (let i = 0; i < 3; i++) {
        e.command(t, 'Alfa', '!raid Bravo');
        for (const k of kinds(e.advance(t + 120 * S))) seen.add(k);
        t += 125 * S;
      }
    }
    expect([...seen].sort()).toEqual(
      ['dinosaur', 'dog', 'pirate', 'pity', 'returnHome', 'saltPaid', 'theft'].sort()
    );
  });

  it('turns back on !back, taking as long as the way already travelled', () => {
    const e = new Engine(setup(), { dreamBase: 0, foundBalls: 0 });
    e.command(T0, 'Alfa', '!raid Bravo');
    expect(text(e.command(T0 + 20 * S, 'Alfa', '!back'))).toBe(
      'Alfa lasci perdere e torni in Alfa: arrivi tra 20 secondi.'
    );
    expect(kinds(e.advance(T0 + 40 * S))).toEqual(['returnHome']);
    expect(e.player('Bravo').balls).toBe(3000);
    expect(text(e.command(T0 + 41 * S, 'Alfa', '!back'))).toBe('Alfa sei già in Alfa!');
  });
});

describe('Telegram accounts', () => {
  it('takes a Telegram account only as @Name and an IRC one only bare, and writes the @', () => {
    const players = setup().players.map((p) => (p.name === 'Alfa' ? { ...p, telegram: true } : p));
    const e = new Engine(setup({ players }), { dreamBase: 0, foundBalls: 0 });
    expect(text(e.command(T0, 'Bravo', '!raid Alfa'))).toBe(
      'Bravo non conosco nessun giocatore di nome Alfa'
    );
    expect(text(e.command(T0, 'Alfa', '!raid @Bravo'))).toBe(
      'Alfa non conosco nessun giocatore di nome @Bravo'
    );
    expect(text(e.command(T0, 'Alfa', '!profile @Alfa'))).toMatch(/\na casa, in @Alfa$/u);
    expect(text(e.command(T0, 'Alfa', '!throw Charlie 🎈'))).toMatch(/^Alfa parti per Charlie/u);
    e.command(T0, 'Delta', '!raid @Alfa');
    // Alfa's home is written with @, so the client learns it is a Telegram account.
    const g = new GameState();
    for (const m of e.advance(T0 + 300 * S)) g.apply({ ...m, events: parseMessage(m.text) });
    expect(g.players.get('Alfa')?.telegram).toBe(true);
    expect(g.players.get('Delta')?.telegram).toBeUndefined();
  });
});

describe('@TheConquister37', () => {
  it('lets the first in, ousts and pays the holder, and pays ⚡ extra', () => {
    const e = new Engine(setup(), { dreamBase: 0 });
    expect(kinds(e.command(T0, 'Bravo', '!avventura'))).toEqual(['entered']);
    expect(kinds(e.command(T0 + 100 * S, 'Delta', '!avventura'))).toEqual([
      'ousted',
      'holderPaid',
      'entered',
    ]);
    expect(e.player('Bravo').balls).toBe(3100);
    expect(text(e.command(T0 + 200 * S, 'Delta', '!back'))).toBe(
      'Delta torni da @TheConquister37 in Delta con 110 palle.'
    );
    expect(e.holder).toBeUndefined();
  });

  it('penalises a resisted entry, locks the place, and fakes the entries of the penalty', () => {
    const e = new Engine(setup({ holder: { name: 'Alfa', since: T0 } }), { lockS: [50, 50] });
    // Charlie's attempts until one is resisted (seeded: the first is).
    let t = T0;
    let k = kinds(e.command(t, 'Bravo', '!avventura'));
    while (!k.includes('entryHeld')) {
      t += 400 * S;
      e.command(t, 'Alfa', '!avventura');
      k = kinds(e.command(t + S, 'Bravo', '!avventura'));
    }
    t += S;
    expect(kinds(e.command(t + 10 * S, 'Charlie', '!avventura'))).toEqual(['locked']);
    // Within the penalty Bravo's entry is a fake: no oust, no pay, nothing changes.
    const fake = kinds(e.command(t + 60 * S, 'Bravo', '!avventura'));
    expect(fake).not.toContain('ousted');
    expect(e.holder?.name).not.toBe('Bravo');
    // The next real entry reveals the dream.
    let next: string[] = [];
    for (let at = t + 70 * S; !next.includes('ousted'); at += 80 * S)
      next = kinds(e.command(at, 'Delta', '!avventura'));
    expect(next.at(-1)).toBe('dreamEntry');
  });

  it('freezes the holder at once with a throw, and the frozen 🎈 does not defend', () => {
    const e = new Engine(
      setup({
        holder: { name: 'Charlie', since: T0 },
        players: [
          { name: 'Alfa', x: 0, y: 0, balls: 0, house: ['🧊'] },
          { name: 'Bravo', x: 60, y: 0, balls: 0 },
          { name: 'Charlie', x: 120, y: 0, balls: 0, carried: ['🎈', '🔥'] },
        ],
      })
    );
    expect(text(e.command(T0, 'Alfa', '!throw @TheConquister37 🧊'))).toBe(
      'Alfa congeli Charlie in @TheConquister37: per 27 minuti non può partire e, se lo cacciano, non può rientrare.'
    );
    // 27 minutes with one 🔥.
    expect(e.player('Charlie').frozenUntil).toBe(T0 + 27 * 60 * S);
    expect(e.copies('🧊')).toBe(0);
    expect(kinds(e.command(T0 + S, 'Bravo', '!avventura'))).toEqual([
      'ousted',
      'holderPaid',
      'entered',
    ]);
    expect(kinds(e.command(T0 + 2 * S, 'Charlie', '!avventura'))).toEqual(['frozen']);
    expect(kinds(e.command(T0 + 3 * S, 'Charlie', '!raid Alfa'))).toEqual(['frozen']);
  });
});

describe('throws and purchases', () => {
  it('carries a 🧊 to a home, needing a free slot, and the 📮 may send it back', () => {
    const players = [
      {
        name: 'Alfa',
        x: 0,
        y: 0,
        balls: 0,
        carried: ['🎈', '🚀', '🚀', '🚀', '🚀'],
        house: ['🧊'],
      },
      { name: 'Bravo', x: 60, y: 0, balls: 0 },
    ];
    const e = new Engine({ seed: 1, start: T0, players }, { dreamBase: 0, foundBalls: 0 });
    expect(kinds(e.command(T0, 'Alfa', '!throw Bravo 🧊'))).toEqual(['carriedFull']);
    expect(text(e.command(T0, 'Alfa', '!take 🧊 🚀'))).toBe(
      'Alfa (🎈🧊🚀🚀🚀) 🧊 ora è con te al posto di 🚀, che torna in casa: fatto.'
    );
    expect(kinds(e.command(T0, 'Alfa', '!take 🚀 🧊'))).toEqual(['moved']);
    expect(e.player('Alfa').house).toContain('🧊');
    expect(kinds(e.command(T0, 'Alfa', '!store 🚀'))).toEqual(['moved']);
    expect(kinds(e.command(T0, 'Alfa', '!throw Bravo 🧊'))).toEqual(['depart']);
    expect(kinds(e.advance(T0 + 60 * S))).toEqual(['freezeDelivered']);
    // Three 🚀 left: 46 s there, then 30 minutes.
    expect(e.player('Bravo').frozenUntil).toBe(T0 + 1846 * S);
    expect(kinds(e.command(T0 + 61 * S, 'Alfa', '!throw Bravo 💣'))).toEqual(['refused']);

    const bounced = new Engine(
      {
        seed: 1,
        start: T0,
        players: [
          { name: 'Alfa', x: 0, y: 0, balls: 0, house: ['🧊'] },
          { name: 'Bravo', x: 60, y: 0, balls: 0, house: Array(10).fill('📮') },
        ],
      },
      { dreamBase: 0, foundBalls: 0 }
    );
    bounced.command(T0, 'Alfa', '!throw Bravo 🧊');
    expect(kinds(bounced.advance(T0 + 60 * S))).toEqual(['bounced']);
    expect(bounced.player('Alfa').house).toContain('🧊');
  });

  it('prices by the copies in the game, places by power, and refuses what it cannot do', () => {
    const e = new Engine(setup());
    expect(text(e.command(T0, 'Bravo', '!buy 🧊'))).toBe(
      'Bravo hai speso 1000 palle: 🧊 in casa nel posto 1. Non dà nessun bonus: aspetta in casa finché non la usi.'
    );
    expect(text(e.command(T0, 'Bravo', '!buy 🧊'))).toContain(
      "hai speso 1500 palle: 🧊 in casa nel posto 2 (ce n'erano già 1 in giro, prezzo x1.5)"
    );
    expect(text(e.command(T0, 'Bravo', '!buy 🧊'))).toBe(
      'Bravo ti servono 2250 palle per 🧊 (ce ne sono già 2 in giro, ne hai 500).'
    );
    expect(kinds(e.command(T0, 'Alfa', '!buy 🚀'))).toEqual(['bought']);
    expect(e.player('Alfa').carried).toContain('🚀');
    expect(e.price('🎈')).toBe(1000);
    expect(e.price('☢️')).toBe(1_000_000);
    const full = new Engine({
      seed: 1,
      start: T0,
      players: [{ name: 'Alfa', x: 0, y: 0, balls: 9000, house: Array(10).fill('🌀') }],
    });
    expect(kinds(full.command(T0, 'Alfa', '!buy 🐔'))).toEqual(['houseFull']);
    expect(kinds(full.command(T0, 'Alfa', '!buy 🐔 3'))).toEqual(['bought']);
    expect(kinds(full.command(T0, 'Alfa', '!buy'))).toEqual(['refused']);
  });

  it('answers profile, house and leaderboard, and pays 🐔', () => {
    const e = new Engine({
      seed: 1,
      start: T0,
      players: [
        { name: 'Alfa', x: 0, y: 0, balls: 0, house: ['🐔', '🐔'] },
        { name: 'Bravo', x: 60, y: 0, balls: 50 },
      ],
    });
    e.command(T0 + 30 * 60 * S, 'Bravo', '!avventura');
    expect(text(e.command(T0 + 30 * 60 * S, 'Alfa', '!profile'))).toBe(
      'Alfa\nCon te: niente\n60 palle, 1° su 2 in classifica\na casa, in Alfa'
    );
    expect(kinds(e.command(T0 + 30 * 60 * S, 'Alfa', '!leaderboard'))).toEqual([
      'info',
      'leaderboardRow',
      'leaderboardRow',
      'holderIs',
    ]);
    expect(text(e.command(T0, 'Alfa', '!profile Bravo'))).toContain('in @TheConquister37');
    const house = e.command(T0 + 30 * 60 * S, 'Alfa', '!house');
    expect(text(house)).toBe('Casa di Alfa (2/10):\n1 🐔  2 🐔  3  4  5  6  7  8  9  10 ·');
    expect(parseMessage(text(house))).toMatchObject([
      { kind: 'house', slots: ['🐔', '🐔', null, null, null, null, null, null, null, null] },
    ]);
    expect(text(e.command(T0, 'Alfa', '!house Bravo'))).toMatch(/^Casa di Bravo \(0\/10\):/u);
    expect(e.command(T0, 'Alfa', '!house Nobody')).toEqual([]);
    expect(e.command(T0, 'Alfa', '!nonsense')).toEqual([]);
    expect(e.command(T0, 'Nobody', '!raid Alfa')).toEqual([]);
  });
});

describe('round trip', () => {
  it('says nothing the parser does not know, and the client state follows the truth', () => {
    const players = [
      {
        name: 'Alfa',
        x: 0,
        y: 0,
        balls: 6000,
        carried: ['🎈', '🚀', '🥷'],
        house: ['🧊', '🎈', '🐶'],
      },
      {
        name: 'Bravo',
        x: 70,
        y: 20,
        balls: 9000,
        carried: ['🎈', '🏴‍☠️'],
        house: ['🧂', '🥺', '📮'],
      },
      {
        name: 'Charlie',
        x: 30,
        y: 110,
        balls: 4000,
        carried: ['🎈', '⚡', '🔥'],
        house: ['🧊', '🦖', '🔊'],
      },
      { name: 'Delta', x: 150, y: 60, balls: 2000, house: ['💣', '🐔'] },
    ];
    const names = players.map((p) => p.name);
    const commands = [
      (o: string) => `!raid ${o}`,
      () => '!avventura',
      () => '!back',
      () => '!buy 🧊',
      () => '!buy 💣',
      () => '!buy 🚀',
      () => '!throw @TheConquister37 🧊',
      () => '!throw @TheConquister37 💣',
      (o: string) => `!throw ${o} 🧊`,
      (o: string) => `!throw ${o} 💣`,
      () => '!store 🚀',
      () => '!take 🚀',
      () => '!profile',
      () => '!leaderboard',
      (o: string) => `!house ${o}`,
    ];
    const rng = new Rng(99);
    const e = new Engine({ seed: 5, start: T0, players });
    const g = new GameState();
    const unknown: string[] = [];
    const feed = (out: EngineMessage[]): void => {
      for (const m of out) {
        const events = parseMessage(m.text);
        for (const ev of events) if (ev.kind === 'unknown') unknown.push(ev.line);
        g.tick(m.time);
        g.apply({ time: m.time, text: m.text, events });
      }
    };
    let t = T0;
    for (let i = 0; i < 3000; i++) {
      t += rng.int(1, 40) * S;
      const p = rng.pick(names);
      const other = rng.pick(names.filter((n) => n !== p));
      feed(e.command(t, p, rng.pick(commands)(other)));
    }
    expect(unknown).toEqual([]);
    // After a profile of each, the client knows each balance and where each player is.
    t += 2 * 3600 * S;
    feed(e.advance(t));
    for (const p of names) feed(e.command(t, p, '!profile'));
    for (const p of names) {
      expect(g.player(p).balance?.balls).toBe(e.player(p).balls);
      if (e.player(p).at === 'home') expect(g.player(p).location).toBe('home');
    }
    expect(g.holder?.name).toBe(e.holder?.name);
    for (const emoji of ['🧊', '💣', '🚀'])
      if (g.copies.has(emoji)) expect(g.price(emoji)).toBe(e.price(emoji));
  });
});
