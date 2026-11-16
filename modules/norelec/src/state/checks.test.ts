import { describe, expect, it } from 'vitest';
import { parseMessage } from '#src/game/parse-message.ts';
import { disagreements, missedNews, settled, when } from './checks.ts';
import {
  BABY_LIFE_MS,
  BIRTH_AFTER_MS,
  type GameRecord,
  initialRecord,
  type KindEvent,
  reduceRecord,
} from './record.ts';

const S = 1000;
const MIN = 60 * S;

/** The parser's events of a bot message at `t`, as the norelec plugin publishes them. */
const events = (t: number, text: string): KindEvent[] =>
  parseMessage(text)
    .filter((e) => e.kind !== 'info' && e.kind !== 'unknown')
    .map((e) => ({ ...e, type: `norelec.${e.kind}`, t, self: 'Alfa' }));

function after(...messages: [number, string][]): GameRecord {
  let s = initialRecord();
  for (const [t, text] of messages) for (const e of events(t, text)) s = reduceRecord(s, e);
  return s;
}

/** What the listing of `text` at `t` contradicts in `s`. */
const against = (s: GameRecord, t: number, text: string) =>
  events(t, text).flatMap((e) => disagreements(settled(s, t).state, e, s.self));

const house = (n: number, slots: string): string =>
  `Casa di ${['Alfa', 'Bravo'][n]} (1/10):\n${slots}`;
const SLOTS = (two: string): string => `1 🎈  2 ${two}  3 ·  4 ·  5 ·  6 ·  7 ·  8 ·  9 ·  10 ·`;
const SPLASH =
  'Bravo la tua 💦 è arrivata a casa di @Alfa: tra 9 ore si vedrà. Torni in Bravo tra 1 minuto.';
const BORN = '@Alfa (🎈) è nato un maschio 👶: il padre è @Bravo.';

describe('the changes missed', () => {
  it('words each change the owner should hear of, and not those of others', () => {
    const s = after([0, house(0, SLOTS('·'))], [S, SPLASH]);
    const due = S + BIRTH_AFTER_MS;
    const born = settled(s, due + 11 * MIN);
    expect(missedNews(born.missed, 'Alfa')).toEqual([
      {
        what: 'born',
        player: 'Alfa',
        due,
        slot: 2,
        detail: `no birth line came for Bravo's 💦: a baby was due in Alfa's house at ${when(due)}, taken as born in slot 2`,
      },
    ]);
    expect(missedNews(born.missed, 'Bravo')).toEqual([]);
    const gone = settled(born.state, due + BABY_LIFE_MS + 11 * MIN);
    expect(missedNews(gone.missed, 'Alfa')).toEqual([
      expect.objectContaining({
        what: 'babyGone',
        slot: 2,
        detail: expect.stringContaining("the 👶 in slot 2 of Alfa's house was due to leave at"),
      }),
    ]);
    // A baby whose birth was not seen: by its time at the latest; one with no slot known.
    const seen = after([0, house(0, SLOTS('👴'))]);
    expect(missedNews(settled(seen, BABY_LIFE_MS).missed, 'Alfa')[0]?.detail).toContain(
      'due to leave by'
    );
    const nowhere = after([0, BORN]);
    expect(
      missedNews(settled(nowhere, BABY_LIFE_MS + 11 * MIN).missed, 'Alfa')[0]?.detail
    ).toContain('the 👶 of Alfa');
    expect(when(0)).toBe('1970-01-01 00:00 UTC');
  });

  it('tells a return missed only when the arrival was seen', () => {
    const left = after([0, 'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.']);
    const arrived = after(
      [0, 'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.'],
      [MIN, 'Alfa il cane di Bravo ti ha intercettato: niente bottino. Torni in Alfa tra 1 minuto.']
    );
    expect(missedNews(settled(arrived, 20 * MIN).missed, 'Alfa')).toEqual([
      expect.objectContaining({ what: 'returnHome', due: 2 * MIN }),
    ]);
    // Not seen arriving, the leg measured: home all the same, but a dream perhaps, so not told.
    expect(settled(left, 20 * MIN).missed).toHaveLength(1);
    expect(missedNews(settled(left, 20 * MIN).missed, 'Alfa')).toEqual([]);
  });
});

describe('the listings that contradict the record', () => {
  it("compares the owner's house slot by slot", () => {
    const s = after([0, house(0, SLOTS('🐔'))]);
    expect(against(s, MIN, house(0, SLOTS('🐔')))).toEqual([]);
    expect(against(s, MIN, house(0, SLOTS('·')))).toEqual([
      {
        what: 'house',
        player: 'Alfa',
        before: '2 🐔',
        after: '2 ·',
        detail:
          "Alfa's /house differs from the record: slot 2 🐔 → · (a line never read: a raid, a purchase, a birth, a departure)",
      },
    ]);
    // Another player's house, or one the record never had: nothing.
    expect(against(s, MIN, house(1, SLOTS('🐔')))).toEqual([]);
    expect(against(after([0, BORN]), MIN, house(0, SLOTS('·')))).toEqual([]);
  });

  it('takes a baby grown, or due to leave, for no contradiction, and a baby vanished for one', () => {
    const s = after([0, house(0, SLOTS('·'))], [S, BORN]);
    expect(against(s, 2 * 86_400 * S, house(0, SLOTS('👨🏻')))).toEqual([]);
    expect(against(s, S + BABY_LIFE_MS + 2 * S, house(0, SLOTS('·')))).toEqual([]);
    expect(against(s, 3 * S, house(0, SLOTS('·')))).toEqual([
      expect.objectContaining({ before: '2 👶', after: '2 ·' }),
    ]);
    // A baby seen but not born before the record's eyes: its departure only bounded.
    const seen = after([0, house(0, SLOTS('👴'))]);
    expect(against(seen, MIN, house(0, SLOTS('·')))).toHaveLength(1);
  });

  it("compares the owner's profile with the trip under way", () => {
    const profile = (where: string): string =>
      `Alfa\nCon te: 🎈\n10 palle, 2° su 3 in classifica\n${where}`;
    const home = after([0, house(0, SLOTS('·'))]);
    expect(against(home, MIN, profile('a casa, in Alfa'))).toEqual([]);
    expect(against(home, MIN, profile('in viaggio verso Bravo: rientra tra 1 minuto'))).toEqual([
      expect.objectContaining({
        what: 'trip',
        before: 'home',
        after: 'on a trip to Bravo',
        detail: expect.stringContaining('a departure was never read'),
      }),
    ]);
    const away = after(
      [0, house(0, SLOTS('·'))],
      [S, 'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.']
    );
    // Not seen arriving, now home: a dream, perhaps.
    expect(against(away, 30 * S, profile('a casa, in Alfa'))).toEqual([]);
    expect(
      against(away, 30 * S, profile('in viaggio verso Charlie: rientra tra 1 minuto'))
    ).toEqual([
      expect.objectContaining({ before: 'on a trip to Bravo', after: 'on a trip to Charlie' }),
    ]);
    const arrived = after(
      [0, house(0, SLOTS('·'))],
      [S, 'Alfa parti per Bravo: arrivi tra 1 minuto. Casa tua resta scoperta.'],
      [MIN, 'Alfa il cane di Bravo ti ha intercettato: niente bottino. Torni in Alfa tra 1 minuto.']
    );
    expect(against(arrived, MIN + S, profile('a casa, in Alfa'))).toEqual([
      expect.objectContaining({ detail: expect.stringContaining('a line of the trip') }),
    ]);
    // A profile that does not say where, and one of a player the record does not know.
    expect(against(home, MIN, 'Alfa\nCon te: 🎈\n10 palle, 2° su 3 in classifica')).toEqual([]);
    expect(against(initialRecord(), MIN, profile('a casa, in Alfa'))).toEqual([]);
  });

  it('tells a holder of the ⚽ other than the record’s, whoever it is', () => {
    const holder = (n: string): string =>
      `La palla ce l'ha ${n} da 10 secondi: rubagliela con /raid @${n}.`;
    expect(against(initialRecord(), 0, holder('Bravo'))).toEqual([]);
    const s = after([0, holder('Bravo')]);
    expect(against(s, MIN, holder('Bravo'))).toEqual([]);
    expect(against(s, MIN, holder('Charlie'))).toEqual([
      expect.objectContaining({ what: 'ball', before: 'Bravo', after: 'Charlie' }),
    ]);
    expect(
      disagreements(s, events(MIN, holder('Charlie'))[0] as KindEvent as never, null)
    ).toHaveLength(1);
  });
});
