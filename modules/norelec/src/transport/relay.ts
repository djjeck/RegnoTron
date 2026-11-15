/**
 * The Telegram ↔ IRC relay's line formats (docs/bot-protocol.md §1.2).
 *
 * - IRC → Telegram: the account "Regno" posts each line of the channel as `<nick> text`.
 * - Telegram → IRC: the relay's nick (`Regno`, or `Regno_` when it reconnected while the old nick
 *   was still held, as since 11 Nov 2026) posts each Telegram message line as `<N\u200bame> text`,
 *   with a zero-width space after the first letter of the name (so that it does not ping), and a
 *   reply prefixed with `[Re N\u200bame: snippet…] `.
 */

/**
 * The relay's nicks, by default: `Regno`, and `Regno_`, the nick it takes when it reconnects while
 * IRC still holds the old one. The `norelec` plugin's `relays` config replaces them.
 */
export const RELAYS: readonly string[] = ['Regno', 'Regno_'];

/** Whether `sender` is one of the relay's nicks (IRC nicks compare case-insensitively). */
export function isRelay(sender: string, relays: readonly string[] = RELAYS): boolean {
  const nick = sender.toLowerCase();
  return relays.some((r) => r.toLowerCase() === nick);
}

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
 *
 * An emoji named `·` (the game sells any character: `/buy · 5`, 13 Nov 2026) writes the separator
 * inside a line: `Alfa (🐶) · ora è con te: …`. With `known`, a line's test (the parser's
 * templates), two neighbouring pieces are one line again when the second starts with a lower-case
 * letter (a line goes on; a new one starts with a name, an emoji or a capital, a player's
 * lower-case name aside), either piece alone is unknown and the two together are known.
 */
export function fromIrc(text: string, known?: (line: string) => boolean): string {
  const pieces = stripZeroWidth(text)
    .split(IRC_LINE_SEPARATOR)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (known === undefined) return pieces.join('\n');
  const lines: string[] = [];
  for (const piece of pieces) {
    const before = lines.at(-1);
    const whole = `${before} · ${piece}`;
    if (
      before !== undefined &&
      /^\p{Ll}/u.test(piece) &&
      (!known(before) || !known(piece)) &&
      known(whole)
    )
      lines[lines.length - 1] = whole;
    else lines.push(piece);
  }
  return lines.join('\n');
}

/** Text without zero-width characters. */
export function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH, '');
}

/**
 * The real author and text of a line from `sender`: a `<nick> text` line by the relay (one of
 * `relays`) is
 * unwrapped (and any reply quote dropped), anything else is returned as it is. Relay notices
 * (`* nick …`, connection messages) keep the relay as author.
 */
export function unwrap(
  sender: string,
  text: string,
  relays: readonly string[] = RELAYS
): Unwrapped {
  if (isRelay(sender, relays) && !NOTICE.test(text)) {
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
