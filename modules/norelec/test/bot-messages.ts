/**
 * Synthetic NorelecBot messages in the bot's real formats (docs/bot-protocol.md), with invented
 * players. Shared by the export-side and the IRC-side parser tests, so that both parsers are held
 * to the same expectations: a fix to one that breaks the other fails the tests.
 */
import { type EventKind } from '#src/game/events.ts';

export interface BotMessageFixture {
  name: string;
  /** The message as Telegram has it, lines joined with `\n`. */
  text: string;
  /** The kinds of its events, in order. */
  kinds: EventKind[];
}

export const BOT_MESSAGES: BotMessageFixture[] = [
  {
    name: 'a departure',
    text: 'Alfa parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.',
    kinds: ['depart'],
  },
  {
    name: 'a departure with balls found on the way',
    text: 'Alfa parti per Bravo: arrivi tra 58 secondi. Casa tua resta scoperta.\nLungo la via trovi 210 palle!',
    kinds: ['depart', 'foundBalls'],
  },
  {
    name: 'a theft that takes the ⚽',
    text: [
      'Alfa (🎈) hai bucato il palloncino di @Bravo (🎈) e rubato 0 palle! Torni in @Alfa tra 1 minuto e 49 secondi.',
      "⚽ E gli porti via la palla! Ora ce l'hai tu: tienila il più a lungo possibile.",
    ].join('\n'),
    kinds: ['theft', 'ballTaken'],
  },
  {
    name: 'a quote added, and its echo',
    text: ['Alfa hai aggiunto la citazione spendendo 1000 palle!', 'Una citazione qualunque.'].join(
      '\n'
    ),
    kinds: ['quoteAdded'],
  },
  {
    name: 'a theft with pity and a pirate flag',
    text: [
      'Alfa (🏴‍☠️🎈) hai rubato 411 palle a Bravo (🎈), che non era a casa! Torni in Alfa tra 58 secondi.',
      'Bravo ti ha impietosito: gli rubi 288 palle invece di 411 palle (30% in meno).',
      'Arrembaggio: ti porti via anche 🧊 da casa sua',
    ].join('\n'),
    kinds: ['theft', 'pity', 'pirate'],
  },
  {
    name: "the ⚽'s leaderboard",
    text: [
      "⚽ Classifica della palla: chi l'ha tenuta più a lungo",
      '1) Alfa (🎈🚀) — 1 giorno, 2 ore, 3 minuti e 4 secondi',
      '2) Bravo lo smarrito (🥷🎈) — 3 ore, 30 minuti e 41 secondi ⚽',
      '3) Charlie — 12 secondi',
      "La palla ce l'ha Bravo lo smarrito (🥷🎈) da 1 minuto e 5 secondi: rubagliela con /raid @Bravo.",
    ].join('\n'),
    kinds: ['info', 'ballRow', 'ballRow', 'ballRow', 'ballHolder'],
  },
  {
    name: 'a profile',
    text: [
      'Alfa',
      'Con te: 🥷🎈🔥',
      '32713 palle, 3° su 34 in classifica',
      'a casa, in Alfa',
      '📜 con noi da 35 giorni',
    ].join('\n'),
    kinds: ['profile'],
  },
  {
    name: 'a line, then a profile sent within the join window',
    text: [
      'Bravo (🎈) il palloncino di @Alfa (🥷🎈) ha resistito. Ora il palloncino ha il 50% di probabilità di essere bucato. Torni in Bravo tra 3 minuti e 16 secondi.',
      'Alfa',
      'Con te: 🥷🎈',
      '1410 palle, 5° su 37 in classifica',
      'a casa, in @Alfa',
    ].join('\n'),
    kinds: ['balloonHeld', 'profile'],
  },
  {
    name: 'the emoji listing',
    text: 'Emoji con un potere\n\nRestano a casa: funzionano anche quando sei fuori.',
    kinds: ['info'],
  },
  {
    name: 'a birth that takes a full house’s slot',
    text: "@Bravo ([]🥷) è nata una femmina 👶: il padre è @Alfa. Non c'era un posto libero: ha preso quello di 📮.",
    kinds: ['born'],
  },
  {
    name: 'a free purchase',
    text: 'Alfa (🚀) hai preso gratis 📮: 📮 in casa nel posto 9, al posto di 🐔. Ora ne hai 1 in casa: 10% di rispedire al mittente quello che ti lanciano a casa.',
    kinds: ['bought'],
  },
  {
    name: 'a freeze, then the frozen player tries to leave',
    text: 'Alfa (🎈) congeli Bravo: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in Alfa tra 1 minuto e 25 secondi.',
    kinds: ['freezeDelivered'],
  },
];
