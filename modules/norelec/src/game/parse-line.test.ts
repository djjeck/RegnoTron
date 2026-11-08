import { describe, expect, it } from 'vitest';
import { type EventKind } from './events.ts';
import { parseLine } from './parse-line.ts';

/** One line per template, with invented players, and the fields that must come out. */
const LINES: [string, EventKind, Record<string, unknown>?][] = [
  // Travel
  [
    'Alfa parti per Bravo: arrivi tra 1 minuto e 40 secondi. Casa tua resta scoperta.',
    'depart',
    { player: { name: 'Alfa' }, to: { name: 'Bravo' }, seconds: 100, rocket: false },
  ],
  [
    '🚀 Alfa parti per Bravo: arrivi tra 2 minuti e 19 secondi. Alfa resta scoperto.',
    'depart',
    { seconds: 139, rocket: true },
  ],
  [
    'Alfa parti per Bravo con 🧊 da consegnare: arrivi tra 1 minuto e 51 secondi. Casa tua resta scoperta.',
    'depart',
    { load: '🧊', gift: false },
  ],
  [
    'Alfa parti per Bravo con 🏳️‍⚧️ da regalare: arrivi tra 50 secondi. Casa tua resta scoperta.',
    'depart',
    { load: '🏳️‍⚧️', gift: true },
  ],
  [
    'Alfa parti per Bravo con 500 palle da consegnare: arrivi tra 2 minuti. Casa tua resta scoperta.',
    'depart',
    { load: '500 palle', gift: true },
  ],
  ['Alfa sei già in viaggio, torni tra 55 secondi.', 'alreadyTravelling', { seconds: 55 }],
  ['Alfa sei già in viaggio, torni tra poco.', 'alreadyTravelling', { seconds: 0 }],
  [
    'Alfa lasci perdere e torni in @Alfa: arrivi tra 5 secondi.',
    'turnBack',
    { home: 'Alfa', seconds: 5 },
  ],
  ['Lungo la via trovi 102 palle!', 'foundBalls', { balls: 102 }],
  [
    'Alfa (🎈) eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!',
    'dreamDepart',
    { player: { name: 'Alfa', carried: ['🎈'] } },
  ],
  [
    'Alfa eri così stanco che hai solo sognato di entrare in @TheConquister37: non ti sei mai mosso da casa!',
    'dreamEntry',
  ],
  [
    'A metà strada la via si divide: ⛰️ collina o 🏞️ fiume? Scrivi !strada <nome> entro 3 minuti.',
    'forkAsked',
  ],
  [
    'Alfa (🎈) non hai scelto nessuna strada al bivio: ti sei perso e sei tornato in Alfa a mani vuote.',
    'lostAtFork',
    { home: 'Alfa' },
  ],
  [
    'Alfa sei sulla via del ritorno: le emoji si comprano da casa tua. Rientri tra 41 secondi.',
    'buyingAway',
    { seconds: 41 },
  ],
  ['Alfa (🎈) sei tornato in Alfa.', 'returnHome', { home: 'Alfa' }],
  ['🪐 Alfa (🎈) sei tornato in @Alfa con 7274 palle.', 'returnHome', { balls: 7274 }],
  ['Alfa (🎈) torni in Alfa con 308 palle.', 'returnHome', { balls: 308 }],
  ['Alfa (🎈) torni in Alfa con 1 palla.', 'returnHome', { balls: 1 }],
  ['Alfa (🎈) rientri in Alfa portando 641 palle.', 'returnHome', { balls: 641 }],
  ['Alfa (🎈) rientri in Alfa a mani vuote.', 'returnHome'],
  ['Alfa (🎈) eccoti di nuovo in @Alfa, con 641 palle in più.', 'returnHome', { balls: 641 }],
  ['Alfa (🎈) Alfa ti riaccoglie: hai con te 12 palle.', 'returnHome', { balls: 12 }],
  ['Alfa (🎈) torni in @Alfa con le tue 740 palle ancora in tasca.', 'returnHome', { balls: 740 }],
  ['Alfa torni in @Alfa con 🧊 ancora in tasca.', 'returnHome'],
  // Arrival at a home
  [
    'Alfa (🎈) hai bucato il palloncino di @Bravo (🎈) e rubato 813 palle! Torni in @Alfa tra 1 minuto e 45 secondi.',
    'theft',
    { victim: { name: 'Bravo' }, balls: 813, how: 'popped', victimAway: false, seconds: 105 },
  ],
  [
    'Alfa (🎈) hai bucato il palloncino di Bravo (🎈) e rubato 1 palla, che non era a casa! Torni in Alfa tra 3 minuti e 58 secondi.',
    'theft',
    { balls: 1, victimAway: true },
  ],
  [
    '💰 Alfa (🏄‍♂️) hai rubato 7274 palle a Bravo (🥺), che era in giro (♌ leone contro ♊ gemelli: 125/100)! Torni in @Alfa tra 2 minuti.',
    'theft',
    { how: 'unguarded', victimAway: true },
  ],
  [
    'Alfa (🥷) scivoli di nascosto oltre le difese di Bravo (🎈) e rubi 406 palle! Torni in @Alfa tra 52 secondi.',
    'theft',
    { how: 'sneaked' },
  ],
  [
    'Alfa (🎈) il palloncino di @Bravo (🎈) ha resistito. Ora il palloncino ha il 50% di probabilità di essere bucato. Torni in Alfa tra 56 secondi.',
    'balloonHeld',
    { nextChance: 50, seconds: 56 },
  ],
  [
    'Alfa (🎈) il cane di Bravo (🐶) ti ha intercettato: niente bottino. Torni in Alfa tra 1 minuto e 5 secondi.',
    'dog',
  ],
  [
    'Bravo ti ha impietosito: gli rubi 288 palle invece di 411 palle (30% in meno).',
    'pity',
    { balls: 288, insteadOf: 411, percent: 30 },
  ],
  ["L'allarme di Bravo ti scopre: devi vedertela con le sue difese.", 'alarm'],
  ['Il 🦖 di @Bravo ti mangia 🏴‍☠️: ora hai con te 🎈[]🏴‍☠️.', 'dinosaur', { eaten: '🏴‍☠️' }],
  ['Il 🦖 di @Bravo ti mangia 🏴‍☠️', 'dinosaur'],
  [
    'Arrembaggio: ti porti via anche 🧊 da casa sua: ora hai con te 🎈🧊.',
    'pirate',
    { emoji: '🧊', carried: ['🎈', '🧊'] },
  ],
  [
    'Arrembaggio: ti porti via anche 🧊 da casa sua: ora hai con te 🏴‍☠️🧊[]🎈®️. Non dà nessun bonus: quando la lanci con /throw parte da qui.',
    'pirate',
    { emoji: '🧊', carried: ['🏴‍☠️', '🧊', null, '🎈', '®️'] },
  ],
  ['Arrembaggio: ti porti via anche 📮 da casa sua.', 'pirate', { emoji: '📮' }],
  [
    'Alfa (🎈) hai consegnato 500 palle a @Bravo (🎈)! Torni in @Alfa tra 2 minuti e 30 secondi.',
    'giftDelivered',
    { balls: 500 },
  ],
  [
    'Alfa (🎈) hai regalato 🏳️‍⚧️ a Bravo (🎈)! Torni in @Alfa tra 49 secondi.',
    'giftDelivered',
    { emoji: '🏳️‍⚧️' },
  ],
  [
    'Alfa (🎈) la tua 💦 è arrivata a casa di @Bravo: tra 9 ore si vedrà. Torni in @Alfa tra 2 minuti.',
    'throwDelivered',
    { emoji: '💦', atHolder: false },
  ],
  [
    'Alfa la tua 💦 è arrivata addosso a Bravo in @TheConquister37: tra 9 ore si vedrà.',
    'throwDelivered',
    { atHolder: true },
  ],
  [
    'Alfa la tua bomba esplode addosso a @Bravo (🎈🥷) in @TheConquister37 e si porta via 🥷: ora @Bravo ha con sé 🎈.',
    'bombAtHolder',
    { destroyed: '🥷' },
  ],
  [
    'Alfa la tua bomba esplode addosso a @Bravo (🎈) in @TheConquister37 ma non trova niente da portarsi via.',
    'bombAtHolder',
  ],
  [
    'Alfa (🎈) la tua bomba esplode in casa di @Bravo (🎈) e si porta via 🐔! Torni in Alfa tra 1 minuto e 46 secondi.',
    'bombAtHome',
    { destroyed: '🐔', seconds: 106 },
  ],
  [
    'Alfa (🎈) la tua bomba esplode in casa di @Bravo (🎈) ma non trova niente da portarsi via. Torni in Alfa tra 44 secondi.',
    'bombAtHome',
  ],
  [
    'Alfa ([]🥷) la bomba era difettosa: ti esplode in mano e si porta via 🥷! Torni in @Alfa tra 1 minuto e 45 secondi.',
    'bombDefective',
    { destroyed: '🥷' },
  ],
  [
    'La cassetta di Bravo rispedisce 💦 al mittente: Alfa tra 9 ore si vedrà, e sarà tutto tuo! Torni in @Alfa tra 4 minuti e 35 secondi.',
    'bounced',
    { emoji: '💦', thrower: { name: 'Alfa' }, seconds: 275 },
  ],
  ['La cassetta di Bravo rispedisce 🧊 al mittente: Alfa resta congelato.', 'bounced'],
  [
    "Alfa (🎈) a casa di @Bravo (🎈) non c'è nessuno: la 💦 te la riporti a casa. Torni in Alfa tra 3 minuti e 11 secondi.",
    'throwUndelivered',
  ],
  [
    'Alfa ha sganciato la bomba nucleare su casa di @Bravo: riparte da zero.',
    'nuke',
    { target: { name: 'Bravo' } },
  ],
  ['Alfa ha sganciato la bomba nucleare su @TheConquister37: il gioco riparte da zero.', 'nuke'],
  [
    'Alfa (🥷🎈) congeli Bravo: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in Alfa tra 1 minuto e 25 secondi.',
    'freezeDelivered',
    { minutes: 30 },
  ],
  [
    'Alfa una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri 27 minuti e 35 secondi.',
    'frozen',
    { seconds: 1655 },
  ],
  ['🎉 Alfa 100 raid riusciti!', 'milestone', { raids: 100 }],
  // @TheConquister37
  [
    'Alfa (🎈) hai bucato il palloncino di @Bravo (🎈)!',
    'balloonPopped',
    { holder: { name: 'Bravo' } },
  ],
  ['Alfa (🥷) scivoli di nascosto oltre il palloncino di Bravo (🎈)!', 'sneakedPast'],
  [
    'Alfa hai cacciato @Bravo lo smarrito da @TheConquister37.',
    'ousted',
    { holder: { name: 'Bravo', title: 'lo smarrito' } },
  ],
  ['Bravo hai guadagnato 59 palle col ⚡ x1.1!', 'holderPaid', { balls: 59, multiplier: 1.1 }],
  ['Bravo hai guadagnato 1 palla!', 'holderPaid', { balls: 1 }],
  ['Alfa sei in @TheConquister37!', 'entered'],
  ['🪐 Alfa sei entrato in @TheConquister37!', 'entered'],
  [
    'Alfa (🎈) il palloncino di Bravo (🎈) ha resistito e prendi una penalità. Ora il palloncino ha il 50% di probabilità di essere bucato.',
    'entryHeld',
    { nextChance: 50 },
  ],
  [
    'Alfa (🎈) il palloncino di Bravo (🎈) ha resistito e prendi 5 minuti di penalità. Ora il palloncino ha il 75% di probabilità di essere bucato.',
    'entryHeld',
    { penaltyS: 300 },
  ],
  // Each ⏳ carried takes 10% off.
  [
    'Alfa (🎈⏳) il palloncino di Bravo (🎈) ha resistito e prendi 4 minuti e 30 secondi di penalità. Ora il palloncino ha il 100% di probabilità di essere bucato.',
    'entryHeld',
    { penaltyS: 270, nextChance: 100, player: { name: 'Alfa' }, holder: { name: 'Bravo' } },
  ],
  [
    'Alfa @TheConquister37 è chiuso: qualcuno ha appena provato a entrare. Riprova tra poco.',
    'locked',
  ],
  [
    'Alfa alla porta di @TheConquister37 il guardiano ti ferma e chiede: come si chiama questo frutto? 🍎 Rispondi con !parola <nome> entro 3 minuti.',
    'gatekeeperAsks',
    { player: { name: 'Alfa' }, question: 'come si chiama questo frutto? 🍎' },
  ],
  [
    'alla porta di @TheConquister37 il guardiano ti ferma e chiede: come si chiama questo frutto? 🍌 Rispondi con /parola <nome> entro 3 minuti.',
    'gatekeeperAsks',
  ],
  ['Alfa il guardiano ti fa passare.', 'gatekeeperPasses'],
  [
    'Alfa la porta di @TheConquister37 resta chiusa per te per 3 minuti e 22 secondi.',
    'doorClosed',
    { seconds: 202 },
  ],
  ['Alfa sei già in @TheConquister37!', 'alreadyAt', { place: 'TheConquister37' }],
  [
    'Alfa sei per strada: non puoi entrare in @TheConquister37 prima di tornare in @Alfa, tra 25 secondi.',
    'onTheRoad',
    { home: 'Alfa', seconds: 25 },
  ],
  [
    'Alfa torni da @TheConquister37 in @Alfa con 31 palle col ⚡ x1.1.',
    'leftConquister',
    { balls: 31 },
  ],
  ['Alfa hai ancora 2 minuti e 10 secondi di penalità.', 'penaltyLeft', { seconds: 130 }],
  [
    'Alfa razzie e consegne partono da casa tua: esci prima da @TheConquister37 con /back.',
    'raidFromConquister',
  ],
  ['Le tue aragoste diventano 🎈 finché resti qui.', 'lobster', { emoji: '🎈' }],
  // Buying, slots, burning
  [
    'Alfa (🎈) hai speso 1000 palle: 💣 in casa nel posto 3 (). Non dà nessun bonus: aspetta in casa finché non la lanci.',
    'bought',
    { emoji: '💣', carried: false, slot: 3 },
  ],
  [
    "Alfa (🎈🎈) hai speso 1000 palle: 🎈 ora è con te (ce n'erano già 45 in giro, prezzo x1).",
    'bought',
    { carried: true, copiesBefore: 45 },
  ],
  [
    'Alfa ti servono 1500 palle per 🧊 (ce ne sono già 1 in giro, ne hai 641).',
    'tooPoor',
    { price: 1500, emoji: '🧊', copies: 1, have: 641 },
  ],
  ['Alfa ti servono 1000 palle per 💣.', 'tooPoor', { price: 1000 }],
  ['Alfa hai già tutti i 10 posti della casa pieni: scegli quale sostituire.', 'houseFull'],
  [
    'Alfa hai già 5 emoji con te: per portare 🧊 serve un posto libero. Rimetti qualcosa in casa con !store <emoji>.',
    'carriedFull',
    { emoji: '🧊' },
  ],
  [
    "Alfa questo comando non c'è più: scrivi /raid @Bravo",
    'retiredCommand',
    { replacement: '/raid @Bravo' },
  ],
  [
    'Alfa (🥷🚀) 🚀 ora è con te: ora ne hai 1 con te: viaggi il 10% più veloce.',
    'moved',
    { emoji: '🚀', carried: true },
  ],
  [
    'Alfa (🥷[]) 🚀 ora è in casa: non ne hai più con te, nessun bonus.',
    'moved',
    { carried: false },
  ],
  [
    'Alfa (💣) 💣 ora è con te al posto di 🎈, che torna in casa: non dà nessun bonus.',
    'moved',
    { emoji: '💣', carried: true, swapped: '🎈' },
  ],
  ['Alfa hai bruciato 🏴‍☠️: è uscita dal gioco.', 'burned', { what: '🏴‍☠️' }],
  [
    'Alfa hai bruciato 159 palle: sono uscite dal gioco. Te ne restano 0.',
    'burned',
    { what: '159 palle' },
  ],
  [
    'Ci torni troppo presto: il 🧂 di @Bravo ti costa 86 palle, che vanno a lui.',
    'saltPaid',
    { balls: 86 },
  ],
  ['Alfa hai aggiunto la citazione spendendo 1000 palle!', 'quoteAdded', { balls: 1000 }],
  [
    '🧙 Un viandante lascia cadere un sacchetto di palle davanti a @Bravo! Il primo che scrive /raccogli (!raccogli su IRC) se lo prende.',
    'bagDropped',
    { near: { name: 'Bravo' } },
  ],
  ['🎒 Alfa raccoglie il sacchetto del viandante: 1762 palle!', 'bagCollected', { balls: 1762 }],
  [
    'Alfa Bravo non ha posti liberi per 💦.',
    'refused',
    { reason: 'Bravo non ha posti liberi per 💦.' },
  ],
  ['Alfa non hai 💣 con te.', 'refused', { reason: 'non hai 💣 con te.' }],
  ['Alfa la casa è piena: per fare posto brucia qualcosa con /burn <emoji>.', 'refused'],
  ['Alfa non puoi razziare te stesso.', 'refused'],
  [
    'Alfa hai solo 373 palle a disposizione.',
    'refused',
    { reason: 'hai solo 373 palle a disposizione.', have: 373 },
  ],
  // State queries and info
  [
    '2) Bravo lo smarrito (🥷🎈) — 34140 palle — 42 citazioni',
    'leaderboardRow',
    { rank: 2, balls: 34140, quotes: 42 },
  ],
  [
    'In @TheConquister37 ora: Alfa (🎈🚀)',
    'holderIs',
    { player: { name: 'Alfa', carried: ['🎈', '🚀'] } },
  ],
  ['Classifica @TheConquister37', 'info'],
  ["🌟 È l'ora d'oro: fino alle 22 ogni raid riuscito ruba il doppio delle palle!", 'info'],
  ["🌟 Ora d'oro: bottino doppio!", 'info'],
  ["🌙 L'ora d'oro è finita: torna domani alle 21.", 'info'],
  ['Ora ne hai 2 con te: il gelo di una 🧊 dura il 20% in meno', 'info'],
  ['🧂 funziona in casa, anche quando sei fuori: chi torna a razziarti paga.', 'info'],
  ['@Bravo (🎈) è nato un maschio 👶: il padre è Alfa.', 'info'],
  // Refusals
  ["Alfa nel posto 9 della casa non c'è nessuna emoji.", 'refused'],
  ['Alfa indica un numero di palle maggiore di zero.', 'refused'],
  ['Alfa ™️ non si lancia: per regalarla scrivi /give @Bravo ™️.', 'refused'],
  ['Alfa non puoi regalare a te stesso.', 'refused'],
  ["Alfa l'invito vale solo per chi è appena arrivato nel gioco.", 'refused'],
  [
    'Alfa il guardiano scuote la testa e ti chiude la porta di @TheConquister37: riprova tra 4 minuti e 58 secondi.',
    'doorClosed',
    { player: { name: 'Alfa' }, seconds: 298 },
  ],
  // Known lines that change no state
  ['Alfa hai scambiato 🧊 e 🐶: ora 🧊 è nel posto 5 e 🐶 nel posto 1. Casa: 🐶🐶💣🧊🎈', 'info'],
  ['Alfa hai spostato 📮 dal posto 10 al posto 9. Casa: 🐶🐶🎈📮', 'info'],
  ['Bravo 🎈 ora è con te, ora hai con te 🎈🎈: con te difende te dove sei.', 'info'],
  ['Alfa prendi 🏚️ rovine: arrivi tra 36 secondi.', 'info'],
  [
    "@Alfa, tiri una palla di cacca a Bravo, bravo hai fatto centro, l'hai completamente smarrito!",
    'info',
  ],
  ['🎯 bersaglio preferito: Alfa (166 colpi)', 'info'],
  ['⏱️ record in @TheConquister37: 58 secondi', 'info'],
  ['🚀 viaggi il 10% più veloce per ognuno', 'info'],
  ['⏳ ognuna accorcia del 10% la penalità dopo un tentativo fallito di entrare', 'info'],
  ['💩 🇷🇺 🇮🇱 chi la prende è "lo smarrito" per 1 giorno', 'info'],
  ['☢️ costa 1000000 palle: azzera un giocatore', 'info'],
  ['Si lanciano: /throw nome emoji su casa sua.', 'info'],
  ['Tutte le altre emoji sono decorative: non fanno niente.', 'info'],
  ['Citazione già presente o non salvabile: nessun addebito.', 'info'],
  ['Account collegati: ora condividono lo stesso giocatore.', 'info'],
  ['Hai ricevuto un rispetto!', 'info'],
  ['Una riga che nessun modello conosce.', 'unknown'],
  // A player's words that only look like the listing's are not taken for it.
  ['Alfa ognuno ha il 10%', 'unknown'],
];

describe('parseLine', () => {
  it.each(LINES)('%s → %s', (line, kind, fields) => {
    const e = parseLine(line);
    expect(e.kind).toBe(kind);
    expect(e.line).toBe(line);
    if (fields) expect(e).toMatchObject(fields);
  });

  it('trims the line', () => {
    expect(parseLine('  Alfa sei in @TheConquister37!  ').line).toBe(
      'Alfa sei in @TheConquister37!'
    );
  });

  it('does not take a template word for a title', () => {
    const e = parseLine(
      'Alfa il palloncino di Bravo ha resistito. Ora il palloncino ha il 25% di probabilità di essere bucato. Torni in Alfa tra 9 secondi.'
    );
    expect(e).toMatchObject({
      kind: 'balloonHeld',
      player: { name: 'Alfa' },
      victim: { name: 'Bravo' },
    });
    expect(e).not.toHaveProperty('player.title');
  });

  it('lists the players written with @, Telegram accounts, never the place', () => {
    expect(
      parseLine(
        'Alfa (🎈) hai bucato il palloncino di @Bravo (🥷) e rubato 40 palle! Torni in @Alfa tra 9 secondi.'
      ).telegram
    ).toEqual(['Bravo', 'Alfa']);
    expect(parseLine('Alfa hai cacciato @Bravo da @TheConquister37.').telegram).toEqual(['Bravo']);
    expect(parseLine('Alfa sei in @TheConquister37!')).not.toHaveProperty('telegram');
    expect(
      parseLine('Alfa parti per Bravo: arrivi tra 5 secondi. Casa tua resta scoperta.')
    ).not.toHaveProperty('telegram');
  });

  it('takes no name a player typed as evidence, as in a refusal', () => {
    const e = parseLine('Alfa non conosco nessun giocatore di nome @Bravo.');
    expect(e.kind).toBe('refused');
    expect(e).not.toHaveProperty('telegram');
  });
});
