import { describe, expect, it } from 'vitest';
import { ANSWER_RULES, answerDeclarations, answerOf, type ReadAnswer } from './answers.ts';
import { parseLine } from './parse-line.ts';

const T = 1_000_000;
const read = (line: string, self = 'Alfa'): ReadAnswer | undefined =>
  answerOf(parseLine(line), self, T);

describe('answerOf', () => {
  it.each([
    ['Alfa parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.', 'raid'],
    [
      'Alfa parti per Bravo con 🧊 da consegnare: arrivi tra 58 secondi. Casa tua resta scoperta.',
      'throw',
    ],
    ['Alfa sei già in Alfa!', 'backInvalid'],
    ['Alfa lasci perdere e torni in Alfa: arrivi tra 23 secondi.', 'back'],
    ['Alfa hai speso 100 palle: 🍕 in casa nel posto 3.', 'bought'],
    ['Alfa 🎈 ora è con te: difende la casa.', 'moved'],
    ['Alfa ti servono 500 palle per 🎈.', 'buyMissing'],
    ['Alfa hai già tutti i 10 posti della casa pieni. Nessun addebito.', 'shopInvalid'],
    ['Alfa hai già 2 emoji con te: per portare 🎈 serve un posto libero.', 'shopInvalid'],
    ['Alfa hai aggiunto la citazione spendendo 1000 palle!', 'quoted'],
    ['Alfa (🎈) hai preso gratis 🍕: 🍕 in casa nel posto 3.', 'bought'],
    ['Alfa hai spostato 🍕 dal posto 3 al posto 4. Casa: 🎈[]🍕', 'moved'],
    [
      "Alfa nel posto 1 c'è 👶, che non si tocca: se ne andrà da solo. Nessun addebito.",
      'slotLocked',
    ],
    ['Alfa /give è disattivato.', 'disabled'],
    ['Alfa !burn è disattivato.', 'disabled'],
    ['Alfa la ☢️ è disattivata.', 'nukeDisabled'],
    ['🎒 Alfa raccoglie il sacchetto del viandante: 300 palle!', 'collected'],
  ])('%s: %s', (line, rule) => {
    expect(read(line)).toEqual({ rule });
  });

  it.each([
    ['Alfa sei già in viaggio, torni tra 2 minuti.', 'travelling', 120],
    [
      'Alfa una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri 3 minuti.',
      'frozen',
      180,
    ],
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
    ['Alfa 🍕 non si lancia: per regalarla scrivi /give.', 'travelInvalid'],
    ['Alfa non hai 🧊 con te.', 'carryMissing'],
    ['Alfa non hai 🧊, né con te né in casa.', 'carryMissing'],
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
      read('Alfa eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!')
    ).toBeUndefined();
    // The closed place's refusal (gone since 10 Nov 2026) and a banned player's reply: no answer.
    expect(
      read('Alfa @TheConquister37 è chiuso: ora si gioca alla palla ⚽. Chi va a segno vince.')
    ).toBeUndefined();
    expect(
      answerOf({ kind: 'banned', line: 'COGLIONE', player: { name: 'Alfa' } }, 'Alfa', T)
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
      commands: ['!raid', '/raid', '!throw', '/throw'],
      when: { rule: 'travelling' },
      status: 'refused',
      reason: 'travelling',
      retryAtFrom: 'retryAt',
      holds: ['!raid', '/raid', '!throw', '/throw'],
    });
    expect(declared).toContainEqual({
      event: 'norelec.answer',
      commands: ['!raid', '/raid'],
      when: { rule: 'raid' },
      status: 'ok',
      retryAtFrom: 'retryAt',
    });
  });
});
