import { describe, expect, it } from 'vitest';
import {
  ANSWER_RULES,
  answerDeclarations,
  answerOf,
  ENTRY_PENALTY_S,
  type ReadAnswer,
} from './answers.ts';
import { parseLine } from './parse-line.ts';

const T = 1_000_000;
const read = (line: string, self = 'Alfa'): ReadAnswer | undefined =>
  answerOf(parseLine(line), self, T);

describe('answerOf', () => {
  it.each([
    ['Alfa parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.', 'raid'],
    [
      'Alfa parti per Bravo con 500 palle da consegnare: arrivi tra 58 secondi. Casa tua resta scoperta.',
      'give',
    ],
    [
      'Alfa parti per Bravo con 🧊 da consegnare: arrivi tra 58 secondi. Casa tua resta scoperta.',
      'throw',
    ],
    ['Alfa la tua 💩 è arrivata addosso a Bravo in @TheConquister37: centro.', 'throw'],
    [
      'Alfa la tua bomba esplode addosso a Bravo in @TheConquister37 ma non trova niente da portarsi via.',
      'throw',
    ],
    [
      'Alfa razzie e consegne partono da casa tua: esci prima da @TheConquister37 con /back.',
      'inConquister',
    ],
    ['Alfa sei in @TheConquister37!', 'entered'],
    [
      'Alfa alla porta di @TheConquister37 il guardiano ti ferma e chiede: come si chiama questo frutto? 🍎 Rispondi con !parola <nome> entro 3 minuti.',
      'gatekeeper',
    ],
    ['Alfa il guardiano ti fa passare.', 'passed'],
    [
      'Alfa @TheConquister37 è chiuso: qualcuno ha appena provato a entrare. Riprova tra poco.',
      'locked',
    ],
    ['Alfa sei già in @TheConquister37!', 'enterInvalid'],
    ['Alfa sei già in Alfa!', 'backInvalid'],
    ['Alfa lasci perdere e torni in Alfa: arrivi tra 23 secondi.', 'back'],
    ['Alfa torni da @TheConquister37 in Alfa con 500 palle.', 'back'],
    ['Alfa hai speso 100 palle: 🍕 in casa nel posto 3.', 'bought'],
    ['Alfa 🎈 ora è con te: difende la casa.', 'moved'],
    ['Alfa ti servono 500 palle per 🎈.', 'buyMissing'],
    ['Alfa hai già tutti i 10 posti della casa pieni. Nessun addebito.', 'shopInvalid'],
    ['Alfa hai già 2 emoji con te: per portare 🎈 serve un posto libero.', 'shopInvalid'],
    ['Alfa hai bruciato 🍕: è uscita dal gioco.', 'burned'],
    ['Alfa hai aggiunto la citazione spendendo 1000 palle!', 'quoted'],
    ['🎒 Alfa raccoglie il sacchetto del viandante: 300 palle!', 'collected'],
  ])('%s: %s', (line, rule) => {
    expect(read(line)).toEqual({ rule });
  });

  it.each([
    ['Alfa sei già in viaggio, torni tra 2 minuti.', 'travelling', 120],
    [
      'Alfa sei per strada: non puoi entrare in @TheConquister37 prima di tornare in Alfa, tra 1 minuto.',
      'travelling',
      60,
    ],
    [
      'Alfa una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri 3 minuti.',
      'frozen',
      180,
    ],
    [
      'Alfa il palloncino di Bravo ha resistito e prendi 4 minuti di penalità. Ora il palloncino ha il 50% di probabilità di essere bucato.',
      'entryHeld',
      240,
    ],
    [
      'Alfa il palloncino di Bravo ha resistito e prendi una penalità. Ora il palloncino ha il 50% di probabilità di essere bucato.',
      'entryHeld',
      ENTRY_PENALTY_S,
    ],
    [
      'Alfa il guardiano scuote la testa e ti chiude la porta di @TheConquister37: riprova tra 4 minuti e 58 secondi.',
      'doorClosed',
      298,
    ],
    ['Alfa hai ancora 2 minuti di penalità.', 'penalty', 120],
    [
      'Alfa sei sulla via del ritorno: le emoji si comprano da casa tua. Rientri tra 30 secondi.',
      'shopAway',
      30,
    ],
  ])('%s: %s, again after %i s', (line, rule, s) => {
    expect(read(line)).toEqual({ rule, retryAt: T + s * 1000 });
  });

  it.each([
    ['Alfa sei in viaggio: torni tra poco.', 'travelling'],
    ['Alfa non conosco nessun giocatore di nome Zulu.', 'travelInvalid'],
    ['Alfa non puoi razziare te stesso.', 'travelInvalid'],
    ['Alfa una emoji per volta.', 'travelInvalid'],
    ['Alfa a @TheConquister37 non si porta niente: esci prima.', 'travelInvalid'],
    ['Alfa 🍕 non si lancia: per regalarla scrivi /give.', 'travelInvalid'],
    ['Alfa non hai 🧊 con te.', 'carryMissing'],
    ['Alfa non hai 🧊, né con te né in casa.', 'carryMissing'],
    ['Alfa hai solo 20 palle a disposizione.', 'giveMissing'],
    ['Alfa non puoi regalare a te stesso.', 'giveInvalid'],
    ['Alfa indica un numero di palle maggiore di zero.', 'giveInvalid'],
    ['Alfa non hai 🍕 in casa.', 'shopMissing'],
    ["Alfa nel posto 4 della casa non c'è nessuna emoji.", 'shopMissing'],
    ['Alfa la casa è piena: libera un posto.', 'shopInvalid'],
    ["Alfa nel posto 3 c'è già 🍕: nessun addebito.", 'shopInvalid'],
    ['Alfa hai già 2 emoji con te (🎈🚀): riponine una.', 'shopInvalid'],
    ['Alfa 🎈 è già con te.', 'shopInvalid'],
    ['Alfa la posizione si sceglie solo per le emoji in casa.', 'shopInvalid'],
    ['Alfa 🍕 non ha posti liberi per 🎈.', 'shopInvalid'],
    ['Alfa ti servono 1000 palle per aggiungere una citazione.', 'quoteMissing'],
    ["Alfa qui non c'è niente da raccogliere.", 'nothingToCollect'],
  ])('the refusal %s: %s', (line, rule) => {
    expect(parseLine(line).kind).toBe('refused');
    expect(read(line)).toEqual({ rule });
  });

  it("answers only the owner's account, without case or @, and only at once", () => {
    const raid = 'Alfa parti per Bravo: arrivi tra 58 secondi. Casa tua resta scoperta.';
    expect(read(raid, 'Bravo')).toBeUndefined();
    expect(read(raid, '@alfa')).toEqual({ rule: 'raid' });
    // An arrival, a dream, a refusal of no command it knows, a line of no player: news.
    expect(read('Alfa la tua 💩 è arrivata a casa di Bravo: centro.')).toBeUndefined();
    expect(
      read(
        'Alfa eri così stanco che hai solo sognato di entrare in @TheConquister37: non ti sei mai mosso da casa!'
      )
    ).toBeUndefined();
    expect(read("Alfa l'invito vale solo per chi è appena arrivato nel gioco.")).toBeUndefined();
    expect(read('Lungo la via trovi 210 palle!')).toBeUndefined();
  });
});

describe('answerDeclarations', () => {
  it('declares every rule over the event, matched by its name', () => {
    const declared = answerDeclarations('norelec.answer');
    expect(declared).toHaveLength(Object.keys(ANSWER_RULES).length);
    expect(declared).toContainEqual({
      event: 'norelec.answer',
      commands: ['!raid', '!give', '!throw', '!avventura'],
      when: { rule: 'travelling' },
      status: 'refused',
      reason: 'travelling',
      retryAtFrom: 'retryAt',
      holds: ['!raid', '!give', '!throw', '!avventura'],
    });
    expect(declared).toContainEqual({
      event: 'norelec.answer',
      commands: ['!raid'],
      when: { rule: 'raid' },
      status: 'ok',
      retryAtFrom: 'retryAt',
    });
  });
});
