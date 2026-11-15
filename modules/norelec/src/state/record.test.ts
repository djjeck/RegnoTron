import { describe, expect, it } from 'vitest';
import { parseMessage } from '#src/game/parse-message.ts';
import {
  ballTotals,
  type GameRecord,
  heldSeconds,
  houseOf,
  initialRecord,
  isPerson,
  type KindEvent,
  legKey,
  legSeconds,
  reduceRecord,
  tripOf,
} from './record.ts';

const S = 1000;

/** The parser's events of a bot message at `t`, as the norelec plugin publishes them. */
const events = (t: number, text: string, self = 'Alfa'): KindEvent[] =>
  parseMessage(text)
    .filter((e) => e.kind !== 'info' && e.kind !== 'unknown')
    .map((e) => ({ ...e, type: `norelec.${e.kind}`, t, self }));

/** A record after the messages, each `[t, text]`. */
function after(...messages: [number, string][]): GameRecord {
  let s = initialRecord();
  for (const [t, text] of messages) for (const e of events(t, text)) s = reduceRecord(s, e);
  return s;
}

const EMPTY_HOUSE = 'Casa di Bravo (0/10):\n1 ·  2 ·  3 ·  4 ·  5 ·  6 ·  7 ·  8 ·  9 ·  10 ·';
const FULL_HOUSE =
  'Casa di Bravo (10/10):\n1 🎈  2 📮  3 📮  4 🐔  5 🐔  6 🐔  7 🐔  8 🐔  9 🐔  10 🐔';

describe('the ⚽', () => {
  it('moves only by a theft from its holder, and counts the time each held it', () => {
    const s = after(
      [0, "La palla ce l'ha Bravo (🎈) da 1 minuto e 40 secondi: rubagliela con /raid @Bravo."],
      [
        100 * S,
        'Alfa (🎈) hai rubato 0 palle a @Bravo (🎈), che non era a casa! Torni in @Alfa tra 1 minuto.\n' +
          "⚽ E gli porti via la palla! Ora ce l'hai tu: tienila il più a lungo possibile.",
      ],
      [
        150 * S,
        'Charlie (🎈) il palloncino di @Alfa (🎈) ha resistito. Ora il palloncino ha il 50% di probabilità di essere bucato. Torni in Charlie tra 1 minuto.',
      ]
    );
    expect(s.ball.holder).toEqual({ name: 'Alfa', since: 100 * S });
    expect(s.self).toBe('Alfa');
    expect(heldSeconds(s, 'Bravo', 500 * S)).toBe(200);
    expect(heldSeconds(s, 'Alfa', 500 * S)).toBe(400);
    expect(ballTotals(s, 500 * S)).toEqual([
      { name: 'Alfa', seconds: 400 },
      { name: 'Bravo', seconds: 200 },
    ]);
    // A theft by the holder itself, and one without its holder known, change nothing more.
    const again = reduceRecord(s, {
      type: 'norelec.ballTaken',
      t: 600 * S,
      kind: 'ballTaken',
      line: '',
      player: { name: 'Alfa' },
    });
    expect(again.ball).toEqual(s.ball);
  });

  it('reconciles with the leaderboard, its rows and its holder line', () => {
    const board = [
      "⚽ Classifica della palla: chi l'ha tenuta più a lungo",
      '1) Bravo (🎈) — 1 giorno e 40 secondi ⚽',
      '2) Alfa — 2 ore',
      "La palla ce l'ha Bravo (🎈) da 40 secondi: rubagliela con !raid Bravo.",
    ].join('\n');
    const s = after([1000 * S, board]);
    expect(s.ball.holder).toEqual({ name: 'Bravo', since: 960 * S });
    expect(heldSeconds(s, 'Bravo', 1000 * S)).toBe(86_440);
    expect(heldSeconds(s, 'Alfa', 1000 * S)).toBe(7200);
    // A holder the record had wrong: its hold until the new one began is counted, silently.
    const t = after(
      [0, "La palla ce l'ha Charlie da 10 secondi: rubagliela con !raid Charlie."],
      [1000 * S, board]
    );
    expect(heldSeconds(t, 'Charlie', 1000 * S)).toBe(970);
    expect(t.ball.holder?.name).toBe('Bravo');
    // The holder's row read again later keeps its count apart from the hold under way.
    const u = after([1000 * S, board], [2000 * S, '1) Bravo (🎈) — 1 giorno e 1040 secondi ⚽']);
    expect(heldSeconds(u, 'Bravo', 2000 * S)).toBe(87_440);
  });
});

describe('houses and babies', () => {
  it('follows a house through purchases, moves and a bomb', () => {
    const s = after(
      [0, EMPTY_HOUSE],
      [
        S,
        'Bravo (🎈) hai preso gratis 🐔: 🐔 in casa nel posto 3. Ora ne hai 1 in casa: fanno 60 palle.',
      ],
      [
        2 * S,
        'Bravo (🎈) hai preso gratis 🚀: 🚀 ora è con te. Ora ne hai 1 con te: viaggi il 10% più veloce.',
      ],
      [3 * S, 'Bravo (🚀) 🐶 ora è in casa: nessun bonus.'],
      [4 * S, 'Bravo (🐶) 🐶 ora è con te al posto di 🚀, che torna in casa: difende te.'],
      [
        5 * S,
        'Alfa (🎈) la tua bomba esplode in casa di @Bravo (🐶) e si porta via 🐔! Torni in Alfa tra 1 minuto.',
      ]
    );
    expect(houseOf(s, 'Bravo')).toEqual({
      slots: ['🚀', null, null, null, null, null, null, null, null, null],
      locked: [],
      at: 5 * S,
    });
    expect(s.prices['🐔']).toEqual({ balls: 0, at: S });
    expect(s.players['Bravo']?.carried).toEqual(['🐶']);
    expect(houseOf(s, 'Nobody')).toBeUndefined();
    // A /move gives the whole house.
    const m = after([0, 'Bravo hai spostato 🐔 dal posto 1 al posto 2. Casa: []🐔']);
    expect(houseOf(m, 'Bravo')?.slots).toEqual([null, '🐔', ...Array(8).fill(null)]);
  });

  it('puts a purchase over the slot it names, and moves an emoji between house and carried', () => {
    const s = after(
      [0, FULL_HOUSE],
      [
        S,
        'Bravo (🎈) hai preso gratis 🚀: 🚀 in casa nel posto 2, al posto di 📮. In casa non fa niente: per averlo con te scrivi /take 🚀 <emoji da rimettere in casa>.',
      ],
      [
        2 * S,
        'Bravo (🚀) 🚀 ora è con te al posto di 🎈, che torna in casa: viaggi il 10% più veloce.',
      ],
      [
        3 * S,
        'Bravo hai preso gratis 🧊: 🧊 in casa nel posto 4, al posto di 🐔. Non dà nessun bonus.',
      ]
    );
    expect(houseOf(s, 'Bravo')?.slots).toEqual([
      '🎈',
      '🎈',
      '📮',
      '🧊',
      ...Array<string>(6).fill('🐔'),
    ]);
    expect(s.players['Bravo']?.carried).toEqual(['🚀']);
    expect(houseOf(s, 'Bravo')?.at).toBe(3 * S);
  });

  it('records each baby: its birth, its slot, the stages it is seen in, and when it went', () => {
    const s = after(
      [0, FULL_HOUSE],
      [
        10 * S,
        "@Bravo (🎈) è nata una femmina 👶: il padre è @Alfa. Non c'era un posto libero: ha preso quello di 📮.",
      ],
      [20 * S, "Bravo nel posto 2 c'è 👶, che non si tocca: se ne andrà da solo. Nessun addebito."],
      [
        86_400 * S,
        'Casa di Bravo (10/10):\n1 🎈  2 👧🏽  3 📮  4 🐔  5 🐔  6 🐔  7 🐔  8 🐔  9 🐔  10 🐔',
      ]
    );
    expect(houseOf(s, 'Bravo')?.locked).toEqual([2]);
    expect(s.babies).toEqual([
      {
        player: 'Bravo',
        slot: 2,
        born: 10 * S,
        father: 'Alfa',
        replaced: '📮',
        stages: [
          { emoji: '👶', at: 10 * S },
          { emoji: '👧🏽', at: 86_400 * S },
        ],
        lastSeen: 86_400 * S,
      },
    ]);
    const gone = after(
      [0, FULL_HOUSE],
      [
        10 * S,
        "@Bravo (🎈) è nata una femmina 👶: il padre è @Alfa. Non c'era un posto libero: ha preso quello di 📮.",
      ],
      [99_000 * S, FULL_HOUSE]
    );
    expect(gone.babies[0]?.gone).toBe(99_000 * S);
    expect(houseOf(gone, 'Bravo')?.locked).toEqual([]);
  });

  it('takes babies first seen in a house, and the birth of one whose house is unknown', () => {
    const s = after(
      [0, '@Bravo (🎈) è nato un maschio 👶: il padre è Alfa.'],
      [10 * S, 'Casa di Bravo (2/10):\n1 👶  2 👴  3 ·  4 ·  5 ·  6 ·  7 ·  8 ·  9 ·  10 ·'],
      [20 * S, '@Bravo 👴 ha vissuto la sua vita.']
    );
    expect(s.babies.map((b) => [b.slot, b.born, b.stages.at(-1)?.emoji, b.gone])).toEqual([
      [1, 0, '👶', undefined],
      [2, undefined, '👴', 20 * S],
    ]);
    expect(houseOf(s, 'Bravo')?.slots[1]).toBeNull();
    // Into the first free slot, when the house had room.
    const room = after([0, EMPTY_HOUSE], [S, '@Bravo è nato un maschio 👶: il padre è Alfa.']);
    expect(room.babies[0]?.slot).toBe(1);
    expect(isPerson('👵🏻')).toBe(true);
    expect(isPerson('🐔')).toBe(false);
    expect(isPerson(null)).toBe(false);
  });
});

describe('trips', () => {
  it('times a trip from its departure, the 🚀 carried, and measures the leg', () => {
    let s = after([
      0,
      'Alfa (🚀🚀) parti per Bravo: arrivi tra 1 minuto e 40 secondi. Casa tua resta scoperta.',
    ]);
    expect(s.legs[legKey('Bravo', 'Alfa')]).toBe(120);
    expect(tripOf(s, 'Alfa')).toEqual({
      from: 'Alfa',
      to: 'Bravo',
      start: 0,
      arriveAt: 100 * S,
      rockets: 2,
      returnAt: 200 * S,
    });
    s = after(
      [
        0,
        'Alfa (🚀🚀) parti per Bravo: arrivi tra 1 minuto e 40 secondi. Casa tua resta scoperta.',
      ],
      [100 * S, 'Alfa (🚀🚀) hai rubato 5 palle a Bravo! Torni in Alfa tra 1 minuto e 38 secondi.']
    );
    expect(tripOf(s, 'Alfa')).toMatchObject({ arrivedAt: 100 * S, returnAt: 198 * S });
    s = reduceRecord(s, events(200 * S, 'Alfa (🚀🚀) sei tornato in Alfa.')[0] as KindEvent);
    expect(tripOf(s, 'Alfa')).toBeUndefined();
    expect(legSeconds(116, 5)).toBe(77);
  });

  it('follows a throw, a turn back, a bounce, and an arrival with no return stated', () => {
    const s = after(
      [
        0,
        'Alfa parti per Bravo con 💦 da consegnare: arrivi tra 1 minuto. Casa tua resta scoperta.',
      ],
      [60 * S, 'Alfa la tua 💦 è arrivata a casa di Bravo: tra 9 ore si vedrà.'],
      [0, 'Charlie parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.'],
      [30 * S, 'Charlie lasci perdere e torni in Charlie: arrivi tra 30 secondi.'],
      [
        0,
        'Delta parti per Bravo con 💣 da consegnare: arrivi tra 1 minuto. Casa tua resta scoperta.',
      ],
      [
        60 * S,
        'La cassetta di Bravo rispedisce 💣 al mittente: Delta esplode a casa tua. Torni in @Delta tra 1 minuto.',
      ]
    );
    expect(tripOf(s, 'Alfa')).toMatchObject({ load: '💦', arrivedAt: 60 * S, returnAt: 120 * S });
    expect(tripOf(s, 'Charlie')).toMatchObject({ arrivedAt: 30 * S, returnAt: 60 * S });
    expect(tripOf(s, 'Delta')).toMatchObject({ returnAt: 120 * S });
  });

  it('takes a trip from a profile, and home from one', () => {
    let s = after([0, 'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.']);
    s = after(
      [0, 'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.'],
      [
        500 * S,
        'Charlie\nCon te: 🚀\n12 palle, 3° su 9 in classifica\nin viaggio verso Bravo: rientra tra 10 secondi',
      ],
      [
        500 * S,
        'Delta\n0 palle, 9° su 9 in classifica\nsulla via del ritorno da Bravo: rientra tra 20 secondi',
      ]
    );
    expect(s.players['Charlie']?.balls).toEqual({ n: 12, rank: 3, at: 500 * S });
    expect(tripOf(s, 'Charlie')).toMatchObject({ to: 'Bravo', arriveAt: 510 * S, rockets: 1 });
    expect(tripOf(s, 'Delta')).toMatchObject({ arrivedAt: 500 * S, returnAt: 520 * S });
    s = reduceRecord(
      s,
      events(600 * S, 'Delta\n0 palle, 9° su 9 in classifica\na casa, in Delta')[0] as KindEvent
    );
    expect(tripOf(s, 'Delta')).toBeUndefined();
    expect(tripOf(s, 'Nobody')).toBeUndefined();
  });
});

describe('bans, prices and disabled commands', () => {
  it('keeps them as the bot states them', () => {
    let s = after(
      [0, 'Alfa hai aggiunto la citazione spendendo 1000 palle!'],
      [S, 'Alfa ti servono 500 palle per 🧊 (ne hai 10).'],
      [2 * S, 'Alfa !give è disattivato.'],
      [3 * S, 'Bravo ti servono 1500 palle per aggiungere una citazione (ne hai 3).'],
      [4 * S, 'Bravo non hai 🧊 con te.']
    );
    expect(s.prices).toEqual({ quote: { balls: 1500, at: 3 * S }, '🧊': { balls: 500, at: S } });
    expect(s.disabled).toEqual({ '/give': 2 * S });
    s = reduceRecord(s, {
      type: 'norelec.banned',
      t: 5 * S,
      kind: 'banned',
      line: 'COGLIONE',
      player: { name: 'Bravo' },
    });
    s = reduceRecord(s, { type: 'norelec.banned', t: 6 * S, kind: 'banned', line: 'COGLIONE' });
    expect(s.players['Bravo']?.banned).toBe(5 * S);
    s = reduceRecord(
      s,
      events(
        7 * S,
        'Bravo parti per Alfa: arrivi tra 5 secondi. Casa tua resta scoperta.'
      )[0] as KindEvent
    );
    expect(s.players['Bravo']?.banned).toBeUndefined();
  });
});
