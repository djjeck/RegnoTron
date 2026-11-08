/**
 * The export-side parser: a message of a Telegram Desktop export (as tools/export/dump.ts writes
 * them, docs/bot-protocol.md §1.1) into a bot message. The live side is
 * modules/norelec/src/transport/irc-parser.ts; both share the templates of
 * modules/norelec/src/game/, so a wording fix there serves both.
 */
import { BOT_NAME, type BotMessage } from '#src/game/bot-message.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { fromIrc, unwrap } from '#src/transport/relay.ts';

/** The fields of an exported message this parser reads. */
export interface ExportMessage {
  date: string | null;
  sender: string | null;
  text: string;
}

const EXPORT_DATE = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2}) UTC([+-])(\d{2}):(\d{2})$/u;

/** `20.10.2026 22:16:35 UTC-04:00` in milliseconds since the epoch, or null. */
export function parseExportDate(date: string): number | null {
  const m = EXPORT_DATE.exec(date);
  if (!m) return null;
  const n = (i: number): number => Number(m[i]);
  const offsetMinutes = (m[7] === '-' ? -1 : 1) * (n(8) * 60 + n(9));
  return Date.UTC(n(3), n(2) - 1, n(1), n(4), n(5), n(6)) - offsetMinutes * 60_000;
}

/**
 * The bot message an exported message is, or null when it is not the bot's: its Telegram
 * messages, and the lines the relay carried from an IRC nick of the bot.
 */
export function exportBotMessage(m: ExportMessage): BotMessage | null {
  if (m.date === null) return null;
  const { author, text, relayed } = unwrap(m.sender ?? '', m.text);
  if (!BOT_NAME.test(author)) return null;
  const time = parseExportDate(m.date);
  if (time === null) return null;
  // A bot line the relay carried from IRC has the IRC form
  // (modules/norelec/src/transport/relay.ts).
  const body = relayed ? fromIrc(text) : text;
  return { time, text: body, events: parseMessage(body) };
}
