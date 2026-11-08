/**
 * A whole NorelecBot message into its events: each line through parse-line.ts, plus what a line
 * needs from its neighbours (docs/bot-protocol.md §3).
 *
 * - Lines that name no player (found balls, pity, the pirate flag, …) get the last player named
 *   before them: the one whose action they belong to.
 * - In an entry message the random quote is not game text: after the entry, lines no template
 *   knows are dropped. Blank lines are ignored (IRC loses them), and the bot may put another
 *   event after the quote's blank line (an entry followed by a theft), so a known line is kept
 *   wherever it is.
 * - Listings and announcements (the /emoji printout, /help, "📣 Novità") are one `info` event:
 *   they describe rules, they change no state.
 * - A /profile reply is one `profile` event, and a /house reply one `house` event. A profile starts
 *   at its name, the line before `Con te:` (or before its balance, when it carries nothing): the
 *   IRC side can join another message before it (§1.2), whose lines are read as any others.
 */
import { parseDuration } from './duration.ts';
import { CONQUISTER, type EventFields, type GameEvent } from './events.ts';
import { parseLine } from './parse-line.ts';
import { parseEmojiList, type PlayerRef, playerRef } from './player.ts';

/** First lines of the messages that are read whole, as one `info` event. */
const LISTINGS = [
  /^Emoji con un potere/u,
  /^Come si gioca/u,
  /^📣 /u,
  /^Novità /u,
  /^Hai due posti per le emoji/u,
];

/** Kinds whose `player` is filled in from the message when the line names none. */
const NEEDS_PLAYER = new Set([
  'foundBalls',
  'pity',
  'alarm',
  'dinosaur',
  'pirate',
  'lobster',
  'doorClosed',
  'saltPaid',
]);

const PROFILE_BALANCE = /^(\d+) pall[ae], (\d+)° su \d+ in classifica$/u;

/** The index of a /profile reply's first line, its name, among `lines`; -1 if there is none. */
function profileStart(lines: readonly string[]): number {
  const at = lines.findIndex((l) => PROFILE_BALANCE.test(l.trim()));
  if (at === -1) return -1;
  return Math.max(0, /^Con te: /u.test(String(lines[at - 1]).trim()) ? at - 2 : at - 1);
}

/**
 * A /profile reply (docs/bot-protocol.md §3.6), or null if the message is not one. A message with
 * other lines before the profile is read from the profile's name on.
 */
export function parseProfile(text: string): GameEvent | null {
  const all = text.split('\n');
  const start = profileStart(all);
  if (start === -1) return null;
  const lines = all.slice(start).map((l) => l.trim());
  const balance = PROFILE_BALANCE.exec(lines.find((l) => PROFILE_BALANCE.test(l)) ?? '');
  if (!balance) return null;
  const e: EventFields['profile'] = {
    player: playerRef(String(lines[0])),
    balls: Number(balance[1]),
    rank: Number(balance[2]),
  };
  const telegram = new Set<string>();
  const written = (name: string): string => {
    if (name.startsWith('@') && name !== `@${CONQUISTER}`) telegram.add(name.slice(1));
    return name.replace(/^@/u, '');
  };
  written(String(lines[0]).split(' ')[0] ?? '');
  for (const line of lines) {
    const carried = /^Con te: (.*)$/u.exec(line);
    if (carried) e.carried = parseEmojiList(carried[1] === 'niente' ? '' : String(carried[1]));
    const hens = /^(\d+) 🐔: \d+ palle all'ora$/u.exec(line);
    if (hens) e.hens = Number(hens[1]);
    const home = /^a casa, in (@?\S+)$/u.exec(line);
    if (home) e.at = { kind: 'home', home: written(String(home[1])) };
    // "in @TheConquister37 da 42 minuti e 23 secondi": the player holds the place.
    if (/^in @TheConquister37\b/u.test(line)) e.at = { kind: 'conquister' };
    const away =
      /^(in viaggio verso|sulla via del ritorno da) (@?[^\s:]+)[^:]*: rientra tra (.+)$/u.exec(
        line
      );
    if (away) {
      e.at = {
        kind: away[1] === 'in viaggio verso' ? 'travelling' : 'returning',
        to: written(String(away[2])),
        seconds: parseDuration(String(away[3])) ?? 0,
      };
    }
  }
  return {
    kind: 'profile',
    line: String(lines[0]),
    ...e,
    ...(telegram.size > 0 && { telegram: [...telegram] }),
  };
}

const HOUSE = /^Casa di (\S+) \(\d+\/(\d+)\):$/u;
/** A line of a /house reply's slots: numbers, each with its emoji or `·`, several to a line. */
const SLOTS = /^\d+(?:\s.*)?$/u;

/**
 * A /house reply (docs/bot-protocol.md §3.6), or null if the message is not one: numbered slots,
 * each followed by its emoji, or by nothing or `·` when empty, several to a line.
 */
export function parseHouse(text: string): GameEvent | null {
  const lines = text.trim().split('\n');
  const head = HOUSE.exec(String(lines[0]).trim());
  if (!head) return null;
  const slots: (string | null)[] = Array.from({ length: Number(head[2]) }, () => null);
  let slot: number | undefined;
  for (const token of lines.slice(1).join(' ').split(/\s+/u)) {
    if (/^\d+$/u.test(token)) slot = Number(token) - 1;
    else if (slot !== undefined && token !== '·' && slot < slots.length) slots[slot] = token;
  }
  return { kind: 'house', line: String(lines[0]), player: playerRef(String(head[1])), slots };
}

/**
 * The events of one bot message, in line order. Blank lines produce nothing. A /house reply is read
 * wherever it starts, up to its last slot line: the IRC side joins replies that come together
 * (a /profile then a /house, 3 Nov), and what comes before or after it is read on its own.
 */
export function parseMessage(text: string): GameEvent[] {
  const all = text.split('\n');
  const h = all.findIndex((l) => HOUSE.test(l.trim()));
  if (h !== -1) {
    let end = h + 1;
    while (end < all.length && SLOTS.test(String(all[end]).trim())) end++;
    const house = parseHouse(all.slice(h, end).join('\n'));
    const rest = (xs: string[]): GameEvent[] =>
      xs.join('').trim() === '' ? [] : parseMessage(xs.join('\n'));
    return [...rest(all.slice(0, h)), ...(house === null ? [] : [house]), ...rest(all.slice(end))];
  }
  const first = String(text.trimStart().split('\n', 1)[0]);
  if (LISTINGS.some((re) => re.test(first))) return [{ kind: 'info', line: first }];
  const lines = text.split('\n');
  const start = profileStart(lines);
  if (start !== -1) {
    const profile = parseProfile(lines.slice(start).join('\n'));
    return [...parseLines(lines.slice(0, start)), ...(profile ? [profile] : [])];
  }
  return parseLines(lines);
}

/** Lines read one by one, in order, with what each needs from those before it. */
function parseLines(lines: readonly string[]): GameEvent[] {
  const events: GameEvent[] = [];
  let subject: PlayerRef | undefined;
  let entry = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    const event = parseLine(line);
    // After an entry, a line no template knows is the random quote.
    if (event.kind === 'unknown' && entry) continue;
    if (event.kind === 'entered') entry = true;
    if ('player' in event && event.player !== undefined) subject = event.player;
    else if (NEEDS_PLAYER.has(event.kind) && subject !== undefined) {
      (event as { player?: PlayerRef }).player = subject;
    }
    events.push(event);
  }
  return events;
}
