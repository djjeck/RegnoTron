/**
 * One NorelecBot message, as both parsers deliver it (modules/norelec/src/export/export-parser.ts
 * for Telegram exports, modules/norelec/src/transport/irc-parser.ts for the live IRC channel):
 * its time, text and events.
 */
import { type GameEvent } from './events.ts';

/** The bot's names: on Telegram, and on IRC when it spoke there directly (13–15 Sep). */
export const BOT_NAME = /^NorelecBot_?$/u;

export interface BotMessage {
  /** Milliseconds since the epoch. */
  time: number;
  /** The message's text, lines joined with `\n`. */
  text: string;
  events: GameEvent[];
}

/** Whether a bot message is about `player`: an event of it names them. */
export function mentions(m: BotMessage, player: string): boolean {
  return m.events.some((e) =>
    Object.values(e).some(
      (v) =>
        typeof v === 'object' &&
        v !== null &&
        'name' in v &&
        (v as { name: unknown }).name === player
    )
  );
}
