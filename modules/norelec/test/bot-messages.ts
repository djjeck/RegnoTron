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
    name: 'an entry by ousting, with the payment, a revealed dream and a quote',
    text: [
      'Alfa (🥷🎈) hai bucato il palloncino di @Bravo (🎈)!',
      'Alfa hai cacciato @Bravo da @TheConquister37.',
      'Bravo hai guadagnato 512 palle col ⚡ x1.1!',
      'Alfa sei in @TheConquister37!',
      'Charlie eri così stanco che hai solo sognato di entrare in @TheConquister37: non ti sei mai mosso da casa!',
      '',
      'Una citazione qualunque, che non è testo del gioco.',
    ].join('\n'),
    kinds: ['balloonPopped', 'ousted', 'holderPaid', 'entered', 'dreamEntry'],
  },
  {
    name: 'an entry and a theft in one message',
    text: [
      'Alfa (🎈) hai bucato il palloncino di @Bravo (🎈)!',
      'Alfa hai cacciato @Bravo da @TheConquister37.',
      'Bravo hai guadagnato 408 palle!',
      'Alfa sei in @TheConquister37!',
      '',
      '💰 Charlie hai rubato 1321 palle a Bravo (🏄‍♂️), che non era a casa! Torni in @Charlie tra 2 minuti.',
      'Bravo ti ha impietosito: gli rubi 900 palle invece di 1321 palle (30% in meno).',
    ].join('\n'),
    kinds: ['balloonPopped', 'ousted', 'holderPaid', 'entered', 'theft', 'pity'],
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
    name: 'a leaderboard',
    text: [
      'Classifica @TheConquister37',
      '',
      '1) Alfa (🎈🚀) — 59119 palle',
      '2) Bravo lo smarrito (🥷🎈) — 34140 palle — 42 citazioni',
      '3) Charlie — 1 palla — 1 citazione',
      '',
      'In @TheConquister37 ora: Alfa (🎈🚀)',
    ].join('\n'),
    kinds: ['info', 'leaderboardRow', 'leaderboardRow', 'leaderboardRow', 'holderIs'],
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
    name: 'a freeze at the holder, in the wording of 23 Oct',
    text: 'Alfa congeli Bravo in @TheConquister37: per 24 minuti non può partire e, se lo cacciano, non può rientrare.',
    kinds: ['freezeDelivered'],
  },
  {
    name: 'a freeze, then the frozen player tries to leave',
    text: 'Alfa (🎈) congeli Bravo: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in Alfa tra 1 minuto e 25 secondi.',
    kinds: ['freezeDelivered'],
  },
];
