/**
 * How NorelecBot names a player: `Juno`, `@Gianpier`, `Juno lo smarrito`, `Gianpier il lombardo`,
 * optionally followed by the carried emoji in parentheses, `Juno (🥷🎈🔥)`, where `[]` is an
 * empty slot (docs/bot-protocol.md §2).
 */

/** A player as named in one line. */
export interface PlayerRef {
  /** The game name: the first word, without `@`. A player's home has the same name. */
  name: string;
  /** A title after the name (`lo smarrito`), if any. */
  title?: string;
  /** The carried emoji, if the line lists them; `null` for an empty slot. */
  carried?: (string | null)[];
}

const SEGMENTER = new Intl.Segmenter('it', { granularity: 'grapheme' });

/** The emoji of a parenthesised list: `🥷🎈[]🔥` → ['🥷', '🎈', null, '🔥']. */
export function parseEmojiList(text: string): (string | null)[] {
  const out: (string | null)[] = [];
  let open = false;
  for (const { segment } of SEGMENTER.segment(text)) {
    if (open && segment === ']') out.push(null);
    else if (segment !== '[' && segment.trim() !== '') out.push(segment);
    open = segment === '[';
  }
  return out;
}

/** Normalises an emoji for comparing effects: drops variation selectors and skin tones. */
export function emojiKind(emoji: string): string {
  return emoji.replace(/[\uFE0E\uFE0F]|\p{Emoji_Modifier}/gu, '');
}

/**
 * A player from the parts a template matched: the name with an optional title, and the text
 * inside the parentheses, if present.
 */
export function playerRef(named: string, emoji?: string): PlayerRef {
  const words = named.replace(/^@/u, '').split(' ');
  const ref: PlayerRef = { name: String(words[0]) };
  if (words.length > 1) ref.title = words.slice(1).join(' ');
  if (emoji !== undefined) ref.carried = parseEmojiList(emoji);
  return ref;
}
