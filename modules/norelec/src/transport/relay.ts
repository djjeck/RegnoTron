/**
 * The Telegram ↔ IRC relay's line formats (docs/bot-protocol.md §1.2).
 *
 * - IRC → Telegram: the account "Regno" posts each line of the channel as `<nick> text`.
 * - Telegram → IRC: the nick `Regno` posts each Telegram message line as `<N\u200bame> text`, with a
 *   zero-width space after the first letter of the name (so that it does not ping), and a reply
 *   prefixed with `[Re N\u200bame: snippet…] `.
 */

/** The relay's name on both sides. */
export const RELAY = 'Regno';

/** A line with its real author, and whether it was relayed. */
export interface Unwrapped {
  author: string;
  text: string;
  relayed: boolean;
}

/**
 * Invisible characters that only break a word (the bot's anti-ping space U+200B, U+200C, U+2060,
 * U+FEFF). Never U+200D, the joiner that holds emoji such as 🏴‍☠️ and 🥷🏻 together.
 */
const ZERO_WIDTH = /[\u200B\u200C\u2060\uFEFF]/gu;
const RELAYED = /^<([^>]+)> ?(.*)$/su;
const REPLY_QUOTE = /^\[Re [^\]]*\] /u;
const NOTICE = /^(?:\* |Lost connection to )/u;

/**
 * The separator NorelecBot puts between the lines of a message on IRC, where a message is one
 * line: `Alfa · Con te: niente · 0 palle, 24° su 37 in classifica` (seen live, 22 Oct).
 */
export const IRC_LINE_SEPARATOR = ' · ';

/**
 * A bot message as IRC carries it, back in its Telegram form: zero-width characters out (the bot
 * puts one before each player's name, so that it does not ping), and the separator back into
 * line breaks.
 */
export function fromIrc(text: string): string {
  return stripZeroWidth(text)
    .split(IRC_LINE_SEPARATOR)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join('\n');
}

/** Text without zero-width characters. */
export function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH, '');
}

/**
 * The real author and text of a line from `sender`: a `<nick> text` line by the relay is
 * unwrapped (and any reply quote dropped), anything else is returned as it is. Relay notices
 * (`* nick …`, connection messages) keep the relay as author.
 */
export function unwrap(sender: string, text: string): Unwrapped {
  if (sender === RELAY && !NOTICE.test(text)) {
    const m = RELAYED.exec(text);
    if (m) {
      return {
        author: stripZeroWidth(String(m[1])),
        text: String(m[2]).replace(REPLY_QUOTE, ''),
        relayed: true,
      };
    }
  }
  return { author: sender, text, relayed: false };
}
