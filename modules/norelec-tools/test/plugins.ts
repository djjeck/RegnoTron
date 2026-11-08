/**
 * The norelec-tools plugins on a dev kit, beside fake `irc` and `telegram-bot` connectors and the
 * `norelec` plugin: what they log, send and answer.
 */
import {
  type Answer,
  type AnswerOptions,
  type ChatCommand,
  DevKit,
  FakeConnector,
  fakeConnectorPlugin,
  type Mode,
  type Plugin,
  type SendRecord,
} from '@megabottron1999/core';
import { norelecPlugin } from '@regnotron/norelec/plugins/norelec.ts';
import { type NorelecGame } from '@regnotron/norelec/plugins/norelec-game.ts';

/** 13:00 in Italy, out of the clock's quiet hours. */
export const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
export const GROUP = '-1001000000001';
export const CHANNEL = '#lobby';
export const RAID =
  'Alfa parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.';

export interface KitOptions {
  admin?: boolean;
  config?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  mode?: Mode;
  documents?: Record<string, unknown>;
}

/** `plugin` (instance `id`) on a dev kit with the game and the fake connectors. */
export async function kitWith(id: string, plugin: Plugin, o: KitOptions = {}) {
  const irc = new FakeConnector({ account: 'irc:alice' });
  const bot = new FakeConnector({
    account: 'telegram-bot:ExampleBot',
    ...(o.admin === true ? { admins: [GROUP] } : {}),
  });
  const sends: SendRecord[] = [];
  const lines: string[] = [];
  const ref: { kit?: DevKit } = {};
  const now = (): number => ref.kit?.clock.now() ?? T0;
  const k = new DevKit({
    start: T0,
    plugins: [
      fakeConnectorPlugin('irc', irc),
      fakeConnectorPlugin('telegram-bot', bot),
      norelecPlugin({
        channel: CHANNEL,
        game: { log: { write: () => {} }, print: () => {}, now, restS: 60, self: 'alice' },
      }),
      plugin,
    ],
    config: { [id]: { restS: 60, ...o.config } },
    ...(o.settings === undefined ? {} : { settings: { [id]: o.settings } }),
    modes: { [id]: o.mode ?? 'live' },
    ...(o.documents === undefined ? {} : { documents: { [id]: o.documents } }),
    record: (r) => {
      if (r.type === 'core.send') sends.push(r as SendRecord);
    },
    print: (l) => lines.push(l),
    validateEvents: true,
  });
  ref.kit = k;
  irc.open('joined');
  bot.open();
  await k.start();
  const game = (): NorelecGame => {
    const g = k.core.service<NorelecGame>('norelec');
    if (g === undefined) throw new Error('no game');
    return g;
  };
  const command = (name: string): ChatCommand => {
    const c = k.core.commands().find((x) => x.name === name);
    if (c === undefined) throw new Error(`no ${name}`);
    return c;
  };
  /** A line of NorelecBot's on the channel. */
  const say = (text: string, time = now()): void =>
    irc.hear({ chat: CHANNEL, sender: 'NorelecBot', text, time });
  return { k, irc, bot, sends, lines, game, command, say };
}

/** An answer that records what it is asked to send. */
export function answer() {
  const texts: { text: string; format?: string; options?: AnswerOptions }[] = [];
  const photos: unknown[] = [];
  const a: Answer = {
    text: (text, format, options) => {
      texts.push({ text, ...(format && { format }), ...(options && { options }) });
      return Promise.resolve();
    },
    photo: (photo) => {
      photos.push(photo);
      return Promise.resolve('file-1');
    },
  };
  return { a, texts, photos };
}

export const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
