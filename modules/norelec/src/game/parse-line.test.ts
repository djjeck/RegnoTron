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
    { load: '🧊' },
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
    'Alfa (🎈) la tua 💦 è arrivata a casa di @Bravo: tra 9 ore si vedrà. Torni in @Alfa tra 2 minuti.',
    'throwDelivered',
    { emoji: '💦' },
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
  // Each ⏳ carried takes 10% off.
  // Buying and slots
  [
    'Alfa (🎈) hai speso 1000 palle: 💣 in casa nel posto 3 (). Non dà nessun bonus: aspetta in casa finché non la lanci.',
    'bought',
    { emoji: '💣', carried: false, slot: 3 },
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
  // State queries and info
  ["🌟 È l'ora d'oro: fino alle 22 ogni raid riuscito ruba il doppio delle palle!", 'info'],
  ["🌟 Ora d'oro: bottino doppio!", 'info'],
  ["🌙 L'ora d'oro è finita: torna domani alle 21.", 'info'],
  ['Ora ne hai 2 con te: il gelo di una 🧊 dura il 20% in meno', 'info'],
  ['🧂 funziona in casa, anche quando sei fuori: chi torna a razziarti paga.', 'info'],
  // Refusals
  ["Alfa nel posto 9 della casa non c'è nessuna emoji.", 'refused'],
  ['Alfa ™️ non si lancia: per regalarla scrivi /give @Bravo ™️.', 'refused'],
  ["Alfa l'invito vale solo per chi è appena arrivato nel gioco.", 'refused'],
  // Known lines that change no state
  ['Alfa prendi 🏚️ rovine: arrivi tra 36 secondi.', 'info'],
  [
    "@Alfa, tiri una palla di cacca a Bravo, bravo hai fatto centro, l'hai completamente smarrito!",
    'info',
  ],
  ['🎯 bersaglio preferito: Alfa (166 colpi)', 'info'],
  ['⏱️ record in @TheConquister37: 58 secondi', 'info'],
  ['🚀 viaggi il 10% più veloce per ognuno', 'info'],
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
  // The ⚽ version (9 Nov 2026)
  ["⚽ E gli porti via la palla! Ora ce l'hai tu: tienila il più a lungo possibile.", 'ballTaken'],
  [
    '1) Alfa (🥷🏾) — 1 giorno, 22 ore, 30 minuti e 42 secondi',
    'ballRow',
    { rank: 1, player: { name: 'Alfa' }, seconds: 167_442, holding: false },
  ],
  [
    '2) Bravo lo smarrito — 3 ore e 41 secondi ⚽',
    'ballRow',
    { player: { name: 'Bravo', title: 'lo smarrito' }, seconds: 10_841, holding: true },
  ],
  ['3) Charlie (🎈) — 2 giorni e 1 minuto', 'ballRow', { seconds: 172_860 }],
  [
    "La palla ce l'ha Alfa (🎈🚀) da 1 minuto e 5 secondi: rubagliela con /raid @Alfa.",
    'ballHolder',
    { player: { name: 'Alfa', carried: ['🎈', '🚀'] }, seconds: 65 },
  ],
  ["La palla ce l'ha Bravo da 2 ore: rubagliela con !raid Bravo.", 'ballHolder', { seconds: 7200 }],
  ["⚽ Classifica della palla: chi l'ha tenuta più a lungo", 'info'],
  ['Alfa /burn è disattivato.', 'disabled', { what: '/burn' }],
  ['Alfa !give è disattivato.', 'disabled', { what: '!give' }],
  [
    "Alfa /give è disattivato: ora si gioca alla palla ⚽. Chi va a segno con /raid su chi ce l'ha gliela porta via.",
    'disabled',
    { what: '/give' },
  ],
  ['Alfa la ☢️ è disattivata.', 'disabled', { what: '☢️' }],
  [
    "Alfa @TheConquister37 è chiuso: ora si gioca alla palla ⚽. Chi va a segno con /raid su chi ce l'ha gliela porta via; vince chi la tiene più a lungo, guarda /leaderboard.",
    'disabled',
    { what: '@TheConquister37' },
  ],
  ['☢️ è disattivata: non si compra, non si lancia e non si regala', 'info'],
  ['COGLIONE', 'banned'],
  [
    "Alfa nel posto 1 c'è 👶, che non si tocca: se ne andrà da solo. Nessun addebito.",
    'slotLocked',
    { slot: 1, emoji: '👶' },
  ],
  [
    "@Bravo ([]🥷🥷) è nata una femmina 👶: il padre è @Alfa. Non c'era un posto libero: ha preso quello di 📮.",
    'born',
    { player: { name: 'Bravo' }, father: { name: 'Alfa' }, female: true, replaced: '📮' },
  ],
  [
    '@Bravo (🎈) è nato un maschio 👶: il padre è Alfa.',
    'born',
    { player: { name: 'Bravo' }, father: { name: 'Alfa' }, emoji: '👶', female: false },
  ],
  ['@Bravo 👴 ha vissuto la sua vita.', 'babyGone', { emoji: '👴' }],
  [
    'Alfa (🎈) la bomba era difettosa: ti esplode in mano, ma non avevi niente con te da perdere. Torni in @Alfa tra 1 minuto e 11 secondi.',
    'bombDefective',
    { seconds: 71 },
  ],
  [
    'Alfa (🚀) hai preso gratis 📮: 📮 in casa nel posto 9, al posto di 🐔. Ora ne hai 3 in casa: 30% di rispedire al mittente quello che ti lanciano a casa.',
    'bought',
    { balls: 0, emoji: '📮', slot: 9, replaced: '🐔', count: 3, carried: false },
  ],
  [
    'Alfa (🎈🥷) hai preso gratis 🥷: 🥷 ora è con te. Ora ne hai 1 con te: 10% di passare oltre 🎈 e 🐶 senza toccarli.',
    'bought',
    { carried: true, count: 1 },
  ],
  ['Alfa (🎈) hai preso gratis 🅽: 🅽 in casa nel posto 1.', 'bought', { emoji: '🅽', slot: 1 }],
  [
    'Alfa (🚀🥷🏾) hai preso gratis 🚀: 🚀 in casa nel posto 2, al posto di 🥷🏾. In casa non fa niente: per averlo con te scrivi /take 🚀 <emoji da rimettere in casa>.',
    'bought',
    { emoji: '🚀', slot: 2, replaced: '🥷🏾', carried: false, balls: 0 },
  ],
  [
    "Alfa (🦞) hai preso gratis 🐔: 🐔 in casa nel posto 4, al posto di 🇻🇦. Ora ne hai 3 in casa: fanno 180 palle all'ora.",
    'bought',
    { emoji: '🐔', slot: 4, replaced: '🇻🇦', count: 3 },
  ],
  [
    'Alfa (🦞) hai preso gratis 🧊: 🧊 in casa nel posto 5, al posto di 🐔. Non dà nessun bonus: aspetta in casa finché non la lanci.',
    'bought',
    { emoji: '🧊', slot: 5, replaced: '🐔' },
  ],
  [
    'Alfa (🦞) hai preso gratis ⓕ: ⓕ in casa nel posto 6, al posto di 🐔.',
    'bought',
    { replaced: '🐔' },
  ],
  [
    'Alfa (🎈) hai speso 1000 palle: 💣 in casa nel posto 3. Non dà nessun bonus: aspetta in casa finché non la lanci.',
    'bought',
    { balls: 1000, emoji: '💣', slot: 3 },
  ],
  [
    'Alfa ti servono 1000 palle per 🧊 (ne hai 641).',
    'tooPoor',
    { price: 1000, emoji: '🧊', have: 641 },
  ],
  [
    'Alfa hai scambiato 🧊 e 🐶: ora 🧊 è nel posto 5 e 🐶 nel posto 1. Casa: 🐶🐶💣[]🧊',
    'rearranged',
    { slots: ['🐶', '🐶', '💣', null, '🧊'] },
  ],
  [
    'Alfa hai spostato 📮 dal posto 10 al posto 9. Casa: 🐶🐶🎈📮',
    'rearranged',
    { player: { name: 'Alfa' } },
  ],
  ['Alfa non puoi portare palle a te stesso.', 'refused'],
  ['Alfa i posti della casa vanno da 1 a 10: nessun addebito.', 'refused'],
  ['Alfa sei già in @Alfa!', 'alreadyAt', { place: 'Alfa' }],
  ["Per le prime 24 ore nessuno può derubarti. C'è una palla sola ⚽: rubala.", 'info'],
  ['• /raid <nome>: vai a rubare palle a qualcuno', 'info'],
];

describe('parseLine', () => {
  it.each(LINES)('%s → %s', (line, kind, fields) => {
    const e = parseLine(line);
    expect(e.kind).toBe(kind);
    expect(e.line).toBe(line);
    if (fields) expect(e).toMatchObject(fields);
  });

  it('trims the line', () => {
    expect(parseLine('  Alfa /burn è disattivato.  ').line).toBe('Alfa /burn è disattivato.');
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
    expect(
      parseLine(
        'Alfa una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri 5 secondi.'
      )
    ).not.toHaveProperty('telegram');
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
