/**
 * One line of a NorelecBot message into one typed event (docs/bot-protocol.md §3). Stateless:
 * what a line needs from its neighbours is added by parse-message.ts.
 */
import { parseDuration } from './duration.ts';
import { CONQUISTER, type EventFields, type EventKind, type GameEvent } from './events.ts';
import { parseEmojiList, type PlayerRef, playerRef } from './player.ts';

/** A title after a name (`lo smarrito`), but not the start of a template (`il palloncino di`). */
const TITLE =
  "(?: (?!il palloncino|il cane|il guardiano|la tua|la porta|lo hai)(?:lo|la|il|l'|i|gli|le) ?[^\\s()!:,.]+)?";

/** The bot's ways of declining a command: they follow the player's name. */
const REFUSALS = [
  'non hai \\S+(?: con te|, né con te né in casa)\\.',
  'la casa è piena: .*',
  'sei in viaggio: .*',
  'hai solo \\d+ palle a disposizione\\.',
  'non conosco nessun giocatore di nome .*',
  "qui non c'è niente da raccogliere\\.",
  'non puoi razziare te stesso\\.',
  'una emoji per volta\\.',
  "nel posto \\d+ c'è già \\S+: nessun addebito\\.",
  'non hai \\S+ in casa\\.',
  'ti servono \\d+ palle per aggiungere una citazione.*',
  'hai già \\d+ emoji con te \\([^)]*\\): .*',
  '\\S+ è già con te\\.',
  'a @TheConquister37 non si porta(?:no)? .*',
  'la posizione si sceglie solo .*',
  '\\S+ non ha posti liberi per \\S+\\.',
  "nel posto \\d+ della casa non c'è nessuna emoji\\.",
  'indica un numero di palle maggiore di zero\\.',
  '\\S+ non si lancia: per regalarla scrivi .*',
  'non puoi regalare a te stesso\\.',
  "l'invito vale solo per chi è appena arrivato nel gioco\\.",
].join('|');

/** A named player with optional carried emoji, captured as `<g>` and `<gE>`. */
const named = (g: string): string => `(?<${g}>@?[^\\s()]+${TITLE})(?: \\((?<${g}E>[^)]*)\\))?`;

const PLACEHOLDERS: Record<string, string> = {
  '{P}': named('p'),
  '{V}': named('v'),
  '{T}': '(?<t>@?[^\\s:!,]+)',
  '{D}': '(?<d>[^.!]+?)',
  '{C}': `@${CONQUISTER}`,
};

function compile(template: string): RegExp {
  let src = template;
  for (const [k, v] of Object.entries(PLACEHOLDERS)) src = src.split(k).join(v);
  // A counted "palle" is "palla" when the count is 1.
  src = src.replace(/(\\d\+\)) palle/gu, '$1 pall[ae]');
  return new RegExp(`^${src}$`, 'u');
}

type Groups = Record<string, string | undefined>;
type Build<K extends EventKind> = (g: Groups) => EventFields[K];

interface Template<K extends EventKind = EventKind> {
  kind: K;
  re: RegExp;
  build: Build<K>;
}

function t<K extends EventKind>(kind: K, template: string, build: Build<K>): Template<K> {
  return { kind, re: compile(template), build };
}

/** A group that the matched template always captures. */
const str = (g: Groups, k: string): string => String(g[k]);
const who = (g: Groups, k = 'p'): PlayerRef => playerRef(str(g, k), g[`${k}E`]);
const home = (g: Groups): string => str(g, 't').replace(/^@/u, '');
const secs = (g: Groups): number => parseDuration(str(g, 'd')) ?? 0;
const num = (g: Groups, k: string): number => Number(g[k]);

/** Every template, most specific first: the first that matches a line wins. */
const TEMPLATES: Template[] = [
  // Travel
  t(
    'depart',
    '(?<r>🚀 )?{P} parti per {V}(?: con (?<load>.+?) da (?<how>consegnare|regalare))?: arrivi tra {D}\\. (?:Casa tua resta scoperta|.+ resta scoperto)\\.',
    (g) => {
      const e: EventFields['depart'] = {
        player: who(g),
        to: who(g, 'v'),
        seconds: secs(g),
        gift: g['how'] === 'regalare' || /\bpall[ae]$/u.test(g['load'] ?? ''),
        rocket: g['r'] !== undefined,
      };
      if (g['load'] !== undefined) e.load = g['load'];
      return e;
    }
  ),
  t('alreadyTravelling', '{P} sei già in viaggio, torni tra {D}\\.', (g) => ({
    player: who(g),
    seconds: secs(g),
  })),
  t('turnBack', '{P} lasci perdere e torni in {T}: arrivi tra {D}\\.', (g) => ({
    player: who(g),
    home: home(g),
    seconds: secs(g),
  })),
  t('foundBalls', 'Lungo la via trovi (?<n>\\d+) palle!', (g) => ({ balls: num(g, 'n') })),
  t(
    'dreamDepart',
    '{P},? eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!',
    (g) => ({ player: who(g) })
  ),
  t('dreamEntry', `{P},? eri così stanco che hai solo sognato di entrare in {C}: .*`, (g) => ({
    player: who(g),
  })),
  t('forkAsked', 'A metà strada la via si divide: .*', () => ({})),
  t(
    'lostAtFork',
    '{P} non hai scelto nessuna strada al bivio: ti sei perso e sei tornato in {T} a mani vuote\\.',
    (g) => ({ player: who(g), home: home(g) })
  ),
  t('buyingAway', '{P} sei sulla via del ritorno: [^.]+\\. Rientri tra {D}\\.', (g) => ({
    player: who(g),
    seconds: secs(g),
  })),
  // Arrival at a home
  t(
    'theft',
    '(?:💰 )?{P} hai bucato il palloncino di {V} e rubato (?<n>\\d+) palle(?<away>, che non era a casa)?! Torni in {T} tra {D}\\.',
    (g) => ({ ...theft(g), how: 'popped' })
  ),
  t(
    'theft',
    '(?:💰 )?{P} hai rubato (?<n>\\d+) palle a {V}(?<away>, che (?:non era a casa|era in giro[^!]*))?! Torni in {T} tra {D}\\.',
    (g) => ({ ...theft(g), how: 'unguarded' })
  ),
  t(
    'theft',
    '{P} scivoli di nascosto oltre le difese di {V} e rubi (?<n>\\d+) palle(?<away>, che non era a casa)?! Torni in {T} tra {D}\\.',
    (g) => ({ ...theft(g), how: 'sneaked' })
  ),
  t(
    'balloonHeld',
    '{P} il palloncino di {V} ha resistito\\. Ora il palloncino ha il (?<pct>\\d+)% di probabilità di essere bucato\\. Torni in {T} tra {D}\\.',
    (g) => ({ player: who(g), victim: who(g, 'v'), nextChance: num(g, 'pct'), seconds: secs(g) })
  ),
  t(
    'dog',
    '{P} il cane di {V} ti ha intercettato: niente bottino\\. Torni in {T} tra {D}\\.',
    (g) => ({
      player: who(g),
      victim: who(g, 'v'),
      seconds: secs(g),
    })
  ),
  t(
    'pity',
    '{V} ti ha impietosito: gli rubi (?<n>\\d+) palle invece di (?<of>\\d+) palle \\((?<pct>\\d+)% in meno\\)\\.',
    (g) => ({
      victim: who(g, 'v'),
      balls: num(g, 'n'),
      insteadOf: num(g, 'of'),
      percent: num(g, 'pct'),
    })
  ),
  t('alarm', "L'allarme di {V} ti scopre: devi vedertela con le sue difese\\.", (g) => ({
    victim: who(g, 'v'),
  })),
  t('dinosaur', 'Il 🦖 di {V} ti mangia (?<e>[^\\s.:]+)(?:: .*|\\.)?', (g) => ({
    victim: who(g, 'v'),
    eaten: str(g, 'e'),
  })),
  // The carried list after the plunder, when the bot gives it: the raid's own line shows the slots
  // before it.
  t(
    'pirate',
    'Arrembaggio: ti porti via anche (?<e>\\S+) da casa sua(?:: ora hai con te (?<c>[^\\s.]+)\\.)?.*',
    (g) => {
      const e: EventFields['pirate'] = { emoji: str(g, 'e') };
      if (g['c'] !== undefined) e.carried = parseEmojiList(str(g, 'c'));
      return e;
    }
  ),
  t(
    'giftDelivered',
    '{P} hai (?:consegnato (?<n>\\d+) palle|regalato (?<e>\\S+)) a {V}! Torni in {T} tra {D}\\.',
    (g) => {
      const e: EventFields['giftDelivered'] = { player: who(g), to: who(g, 'v'), seconds: secs(g) };
      if (g['n'] !== undefined) e.balls = num(g, 'n');
      if (g['e'] !== undefined) e.emoji = g['e'];
      return e;
    }
  ),
  t('throwDelivered', '{P} la tua (?<e>\\S+) è arrivata a casa di {V}: .*', (g) => ({
    player: who(g),
    emoji: str(g, 'e'),
    to: who(g, 'v'),
    atHolder: false,
  })),
  t('throwDelivered', `{P} la tua (?<e>\\S+) è arrivata addosso a {V} in {C}: .*`, (g) => ({
    player: who(g),
    emoji: str(g, 'e'),
    to: who(g, 'v'),
    atHolder: true,
  })),
  t(
    'bombAtHome',
    '{P} la tua bomba esplode in casa di {V} (?:ma non trova niente da portarsi via|e si porta via (?<e>\\S+))[^.!]*[.!] Torni in {T} tra {D}\\.',
    (g) => {
      const e: EventFields['bombAtHome'] = {
        player: who(g),
        victim: who(g, 'v'),
        seconds: secs(g),
      };
      if (g['e'] !== undefined) e.destroyed = g['e'];
      return e;
    }
  ),
  t(
    'bombAtHolder',
    `{P} la tua bomba esplode addosso a {V} in {C} (?:e si porta via (?<e>\\S+): .*|ma non trova niente da portarsi via\\.)`,
    (g) => {
      const e: EventFields['bombAtHolder'] = { player: who(g), holder: who(g, 'v') };
      if (g['e'] !== undefined) e.destroyed = g['e'];
      return e;
    }
  ),
  t(
    'bombDefective',
    '{P} la bomba era difettosa: ti esplode in mano e si porta via (?<e>\\S+)! Torni in {T} tra {D}\\.',
    (g) => ({ player: who(g), destroyed: str(g, 'e'), seconds: secs(g) })
  ),
  t(
    'bounced',
    'La cassetta di {V} rispedisce (?<e>\\S+) al mittente: (?<p>[^\\s()]+) .*?(?: Torni in {T} tra {D}\\.)?',
    (g) => {
      const e: EventFields['bounced'] = {
        victim: who(g, 'v'),
        emoji: str(g, 'e'),
        thrower: who(g),
      };
      if (g['d'] !== undefined) e.seconds = secs(g);
      return e;
    }
  ),
  t(
    'throwUndelivered',
    "{P} a casa di {V} non c'è nessuno: la (?<e>\\S+) te la riporti a casa\\. Torni in {T} tra {D}\\.",
    (g) => ({ player: who(g), to: who(g, 'v'), emoji: str(g, 'e'), seconds: secs(g) })
  ),
  t('nuke', `{P} ha sganciato la bomba nucleare su (?:casa di {V}|{C}): .*`, (g) => {
    const e: EventFields['nuke'] = { player: who(g) };
    if (g['v'] !== undefined) e.target = who(g, 'v');
    return e;
  }),
  t(
    'freezeDelivered',
    `{P} congeli {V}(?<h> in {C})?: per (?<m>\\d+) minuti non può (?:(?<old>entrare in {C} né partire)|partire e, se lo cacciano, non può rientrare).*`,
    (g) => ({
      player: who(g),
      target: who(g, 'v'),
      minutes: num(g, 'm'),
      atHolder: g['h'] !== undefined,
      actual: g['old'] === undefined,
    })
  ),
  t(
    'frozen',
    `{P} una 🧊 ti ha congelato: non puoi entrare in {C} né partire per altri {D}\\.`,
    (g) => ({
      player: who(g),
      seconds: secs(g),
    })
  ),
  t('milestone', '🎉 {P} (?<n>\\d+) raid riusciti!', (g) => ({
    player: who(g),
    raids: num(g, 'n'),
  })),
  // @TheConquister37
  t('balloonPopped', '{P} hai bucato il palloncino di {V}!', (g) => ({
    player: who(g),
    holder: who(g, 'v'),
  })),
  t('sneakedPast', '{P} scivoli di nascosto oltre il palloncino di {V}!', (g) => ({
    player: who(g),
    holder: who(g, 'v'),
  })),
  t('ousted', `{P} hai cacciato {V} da {C}\\.`, (g) => ({ player: who(g), holder: who(g, 'v') })),
  t('holderPaid', '{P} hai guadagnato (?<n>\\d+) pall[ae](?: col ⚡ x(?<x>[\\d.]+))?!', (g) => {
    const e: EventFields['holderPaid'] = { player: who(g), balls: num(g, 'n') };
    if (g['x'] !== undefined) e.multiplier = Number(g['x']);
    return e;
  }),
  t('entered', `(?:🪐 )?{P} sei (?:entrato )?in {C}!`, (g) => ({ player: who(g) })),
  t(
    'entryHeld',
    '{P} il palloncino di {V} ha resistito e prendi (?:una penalità|{D} di penalità)\\. Ora il palloncino ha il (?<pct>\\d+)% di probabilità di essere bucato\\.',
    (g) => {
      const e: EventFields['entryHeld'] = {
        player: who(g),
        holder: who(g, 'v'),
        nextChance: num(g, 'pct'),
      };
      if (g['d'] !== undefined) e.penaltyS = secs(g);
      return e;
    }
  ),
  t(
    'locked',
    `{P} {C} è chiuso: qualcuno ha appena provato a entrare\\. Riprova tra poco\\.`,
    (g) => ({
      player: who(g),
    })
  ),
  t(
    'gatekeeperAsks',
    `(?:{P} )?alla porta di {C} il guardiano ti ferma e chiede: (?<q>.+?) Rispondi con [!/]parola <nome> entro 3 minuti\\.`,
    (g) => {
      const e: EventFields['gatekeeperAsks'] = { question: str(g, 'q') };
      if (g['p'] !== undefined) e.player = who(g);
      return e;
    }
  ),
  t('gatekeeperPasses', '{P} il guardiano ti fa passare\\.', (g) => ({ player: who(g) })),
  t('doorClosed', '.*la porta.* resta chiusa per te per {D}\\.', (g) => ({ seconds: secs(g) })),
  t(
    'doorClosed',
    `{P} il guardiano scuote la testa e ti chiude la porta di {C}: riprova tra {D}\\.`,
    (g) => ({ player: who(g), seconds: secs(g) })
  ),
  t('alreadyAt', '{P} sei già in (?<at>@?\\S+?)!', (g) => ({
    player: who(g),
    place: str(g, 'at').replace(/^@/u, ''),
  })),
  t(
    'onTheRoad',
    `{P} sei per strada: non puoi entrare in {C} prima di tornare in {T}, tra {D}\\.`,
    (g) => ({ player: who(g), home: home(g), seconds: secs(g) })
  ),
  t(
    'leftConquister',
    `(?:🪐 )?{P} torni da {C} in {T} con (?<n>\\d+) palle(?: col ⚡ x[\\d.]+)?\\.`,
    (g) => ({
      player: who(g),
      home: home(g),
      balls: num(g, 'n'),
    })
  ),
  t('penaltyLeft', '{P} hai ancora {D} di penalità\\.', (g) => ({
    player: who(g),
    seconds: secs(g),
  })),
  t('raidFromConquister', `{P} razzie e consegne partono da casa tua: .*`, (g) => ({
    player: who(g),
  })),
  t('lobster', 'Le tue aragoste diventano (?<e>.+) finché resti qui\\.', (g) => ({
    emoji: str(g, 'e'),
  })),
  // Return home, in its several wordings (docs/bot-protocol.md §3.1)
  t('returnHome', '(?:🪐 )?{P} sei tornato in {T}(?: con (?<n>\\d+) palle)?\\.', returned),
  t('returnHome', '(?:🪐 )?{P} torni in {T} con (?<n>\\d+) palle\\.', returned),
  t('returnHome', '{P} rientri in {T} (?:portando (?<n>\\d+) palle|a mani vuote)\\.', returned),
  t('returnHome', '{P} eccoti di nuovo in {T}(?:, con (?<n>\\d+) palle in più)?\\.', returned),
  t('returnHome', '{P} {T} ti riaccoglie(?:: hai con te (?<n>\\d+) palle)?\\.', returned),
  // A gift turned back: the balls, which left the giver at departure, come home with them.
  t('returnHome', '{P} torni in {T} con le tue (?<n>\\d+) palle ancora in tasca\\.', returned),
  t('returnHome', '{P} torni in {T} con (?<e>\\S+) ancora in tasca\\.', returned),
  // Buying and slots
  t(
    'moved',
    '{P} (?<e>\\S+) ora è (?<w>con te|in casa)(?: al posto di (?<x>\\S+), che torna in casa)?: .*',
    (g) => {
      const e: EventFields['moved'] = {
        player: who(g),
        emoji: str(g, 'e'),
        carried: g['w'] === 'con te',
      };
      if (g['x'] !== undefined) e.swapped = str(g, 'x');
      return e;
    }
  ),
  t('burned', '{P} hai bruciato (?<w>.+?): (?:è uscita|sono uscite) dal gioco\\..*', (g) => ({
    player: who(g),
    what: str(g, 'w'),
  })),
  t(
    'saltPaid',
    'Ci torni troppo presto: il 🧂 di {V} ti costa (?<n>\\d+) palle, che vanno a lui\\.',
    (g) => ({
      victim: who(g, 'v'),
      balls: num(g, 'n'),
    })
  ),
  t('refused', `{P} (?<r>${REFUSALS})`, (g) => {
    const e: EventFields['refused'] = { player: who(g), reason: str(g, 'r') };
    const have = /^hai solo (\d+) palle a disposizione/u.exec(e.reason);
    if (have) e.have = Number(have[1]);
    return e;
  }),
  t('bagDropped', '🧙 Un viandante lascia cadere un sacchetto di palle davanti a {V}! .*', (g) => ({
    near: who(g, 'v'),
  })),
  t('bagCollected', '🎒 {P} raccoglie il sacchetto del viandante: (?<n>\\d+) palle!', (g) => ({
    player: who(g),
    balls: num(g, 'n'),
  })),
  t('quoteAdded', '{P} hai aggiunto la citazione spendendo (?<n>\\d+) palle!', (g) => ({
    player: who(g),
    balls: num(g, 'n'),
  })),
  t(
    'bought',
    '{P} hai speso (?<n>\\d+) palle: (?<e>\\S+) (?:in casa nel posto (?<slot>\\d+)|ora è con te)(?<rest>.*)',
    (g) => {
      const e: EventFields['bought'] = {
        player: who(g),
        balls: num(g, 'n'),
        emoji: str(g, 'e'),
        carried: g['slot'] === undefined,
      };
      if (g['slot'] !== undefined) e.slot = num(g, 'slot');
      const copies = /ce n'er(?:a|ano) già (\d+) in giro/u.exec(str(g, 'rest'));
      if (copies) e.copiesBefore = Number(copies[1]);
      return e;
    }
  ),
  t(
    'tooPoor',
    '{P} ti servono (?<price>\\d+) palle per (?<e>\\S+)(?: \\((?<info>[^)]*)\\))?\\.?',
    (g) => {
      const e: EventFields['tooPoor'] = {
        player: who(g),
        price: num(g, 'price'),
        emoji: str(g, 'e'),
      };
      const copies = /ce n[e']\s?(?:sono|è|era|erano) già (\d+)/u.exec(g['info'] ?? '');
      const have = /ne hai (\d+)/u.exec(g['info'] ?? '');
      if (copies) e.copies = Number(copies[1]);
      if (have) e.have = Number(have[1]);
      return e;
    }
  ),
  t('houseFull', '{P} hai già tutti i \\d+ posti della casa pieni.*', (g) => ({ player: who(g) })),
  t(
    'carriedFull',
    '{P} hai già \\d+ emoji con te: per portare (?<e>\\S+) serve un posto libero\\..*',
    (g) => ({
      player: who(g),
      emoji: str(g, 'e'),
    })
  ),
  t('retiredCommand', "{P} questo comando non c'è più: scrivi (?<c>.+)", (g) => ({
    player: who(g),
    replacement: str(g, 'c'),
  })),
  // State queries
  t(
    'leaderboardRow',
    '(?<rank>\\d+)\\) {P} — (?<n>\\d+) pall[ae](?: — (?<q>\\d+) citazion[ei])?',
    (g) => ({
      rank: num(g, 'rank'),
      player: who(g),
      balls: num(g, 'n'),
      quotes: g['q'] === undefined ? 0 : num(g, 'q'),
    })
  ),
  t('holderIs', `In {C} ora: {P}`, (g) => ({ player: who(g) })),
];

function theft(g: Groups): Omit<EventFields['theft'], 'how'> {
  return {
    player: who(g),
    victim: who(g, 'v'),
    balls: num(g, 'n'),
    victimAway: g['away'] !== undefined,
    seconds: secs(g),
  };
}

function returned(g: Groups): EventFields['returnHome'] {
  const e: EventFields['returnHome'] = { player: who(g), home: home(g) };
  if (g['n'] !== undefined) e.balls = num(g, 'n');
  return e;
}

/** Lines that are known but change no state. */
const INFO = [
  // An emoji's explanation (/emoji 🧂): rules, no state.
  /^\S+ (?:funziona (?:in casa|con te)|è decorativa)[,:] /u,
  /^Classifica @TheConquister37$/u,
  /^🏆 È il tuo colpo più grosso di sempre!$/u,
  /^Entrambi gli account hanno già beni: /u,
  /^Imposta uno username Telegram /u,
  /^🐔 funziona in casa/u,
  // Babies: no effect since 14 Oct (docs/game-rules.md §5.3).
  /^\S+(?: \([^)]*\))? (?:è nat[oa] un[a]? (?:maschio|femmina)|\S+ ha vissuto la sua vita)/u,
  /^Ora ne hai \d+ /u,
  /^Oggi è giorno di /u,
  /^Uso: /u,
  // The golden hour, double loot (docs/game-rules.md §4.1): its start, a theft's note, its end.
  /^🌟 È l'ora d'oro: /u,
  /^🌟 Ora d'oro: bottino doppio!$/u,
  /^🌙 L'ora d'oro è finita/u,
  // The house rearranged (/move): the count of each emoji stays.
  /^.+? hai scambiato \S+ e \S+: ora .*Casa: /u,
  /^.+? hai spostato \S+ dal posto \d+ al posto \d+\. Casa: /u,
  // A gift's emoji in the hands of who received it; the gift's own line comes first.
  /^.+? \S+ ora è con te, ora hai con te \S+: /u,
  // A road chosen at a fork (19 Oct only).
  /^.+? prendi \S+ \S+: arrivi tra /u,
  /^@?[^\s,]+, tiri una palla di cacca a /u,
  // A profile's statistics, when the bot sends them apart from the profile.
  /^(?:🎯 bersaglio preferito: |⏱️ record in @TheConquister37: |⚔️ \d+ raid riusciti|📜 con noi da )/u,
  // The lines of /emoji, when the bot sends them apart from the listing's first line.
  /^(?:(?:[\p{Extended_Pictographic}\p{Regional_Indicator}]|\u{200d}|\u{fe0f})+ )+(?:ognun[oa] |viaggi il \d+% |\+\d+% di palle |in @TheConquister37 diventa |il palloncino: |distrugge un'emoji |costa \d+ palle: |dopo \d+ ore nasce |chi la prende |si lancia: )/u,
  /^Si lanciano: /u,
  /^I bambini \(/u,
  /^Tutte le altre emoji sono decorative/u,
  /^Citazione (?:eliminata|già presente)/u,
  /^Account collegati: /u,
  /^Hai ricevuto un rispetto!$/u,
];

/**
 * The players a matched line writes with `@`, from the groups that name a player or a home (named
 * after its owner); never the place. A refusal captures no name, so a name a player typed wrong
 * ("non conosco nessun giocatore di nome @Name") is no evidence.
 */
function telegramNames(g: Groups): string[] {
  const out: string[] = [];
  for (const k of ['p', 'v', 't', 'at']) {
    const name = /^@([^\s()]+)/u.exec(g[k] ?? '')?.[1];
    if (name !== undefined && name !== CONQUISTER && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The event of one line, `unknown` when no template matches. */
export function parseLine(line: string): GameEvent {
  const text = line.trim();
  for (const tpl of TEMPLATES) {
    const m = tpl.re.exec(text);
    if (m) {
      const g = m.groups ?? {};
      const telegram = telegramNames(g);
      return {
        kind: tpl.kind,
        line: text,
        ...tpl.build(g),
        ...(telegram.length > 0 && { telegram }),
      } as GameEvent;
    }
  }
  if (INFO.some((re) => re.test(text))) return { kind: 'info', line: text };
  return { kind: 'unknown', line: text };
}
