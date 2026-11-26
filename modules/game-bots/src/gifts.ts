/**
 * @LoreGameBot's answers to `/give`, `/dai` and `/paga` (docs/game-bots.md §5.10), as the
 * `loregame` parser reads them. Pure.
 *
 * `/give` and `/dai` send items, `/paga <n>` coins [S: the bot's help], each to the player named or
 * to the one whose message the command replies to (the usual way to pay).
 *
 * A gift sent: "Hai inviato <n>x <item> [<rarity>] [<tag>]… a <username>!", or coins, "Hai inviato
 * <n> monete a <username>!"; at times after "[N] ", the bot's mark of a notification. The receiver
 * is named as the giver typed them, an `@` and any case at times. The answer names the receiver,
 * not the giver, and since August 2026 it is a message of its own, not a reply [M]: `GiftWatch`
 * pairs it with the command waiting (`src/answer-watch.ts`). Its refusals (a format, an item not
 * found or not held, a user unknown, too few coins) change nothing, and are not read; each replies
 * to its command [M: the 370 in the exports], which ends that command's wait, so no later answer is
 * credited to it.
 *
 * The bot also tells each side of a gift in private [S]: the giver, "[N] Hai inviato …" as the
 * answer; the receiver, "[N] Hai ricevuto <n>x <item> … da <username>!" (or "<n> monete"). So the
 * owner may hear one gift twice, its answer in the group and its notice in private, in either order,
 * or once, when it was played in private: `GiftWatch` gives each gift of the owner's once.
 */
import { isPrivate } from '@megabottron1999/turns/turn-parser.ts';
import { AnswerWatch, type PlayerAnswer } from '#src/answer-watch.ts';
import { type Heard } from '#src/bans.ts';
import { type Listed } from '#src/inventory.ts';

/** The commands of a gift, as a player types them. */
export const GIFT_COMMANDS: readonly string[] = ['/give', '/dai', '/paga'];

/**
 * How far apart, on the messages' times, a gift's answer and its notice to the owner may be: the
 * bot sends them together, seconds apart [M].
 */
export const GIFT_ECHO_MS = 60_000;

/** What a gift sent was: items, or coins; and to whom. */
export type Gift =
  ({ kind: 'item'; to: string } & Listed) | { kind: 'coins'; to: string; coins: number };

const ITEM = String.raw`(\d+)x (.+?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*)`;
const SENT_ITEMS = new RegExp(String.raw`^(?:\[N\] )?Hai inviato ${ITEM} a @?(\w+)!$`, 'su');
const SENT_COINS = /^(?:\[N\] )?Hai inviato (\d+) monete a @?(\w+)!$/u;
const GOT_ITEMS = new RegExp(String.raw`^(?:\[N\] )?Hai ricevuto ${ITEM} da @?(\w+)!$`, 'su');
const GOT_COINS = /^(?:\[N\] )?Hai ricevuto (\d+) monete da @?(\w+)!$/u;
const RANGE = /^(.+) \((\d+)(?: - (\d+))?\)$/su;

/** The gift a message tells of, sent or received: what, and the other player. */
function parseWith(raw: string, items: RegExp, coins: RegExp): Gift | undefined {
  const text = raw.normalize('NFC').trim();
  const c = coins.exec(text);
  if (c !== null) return { kind: 'coins', coins: Number(c[1]), to: c[2] as string };
  const m = items.exec(text);
  if (m === null) return undefined;
  const range = RANGE.exec(m[2] as string);
  return {
    kind: 'item',
    to: m[5] as string,
    qty: Number(m[1]),
    item: range === null ? (m[2] as string) : (range[1] as string),
    rarity: m[3] as string,
    tags: [...(m[4] as string).matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((t) => t[1] as string),
    level: range === null ? null : { low: Number(range[2]), high: Number(range[3] ?? range[2]) },
  };
}

/** The gift `raw` tells of, if it is one sent: the whole message. */
export function parseGift(raw: string): Gift | undefined {
  return parseWith(raw, SENT_ITEMS, SENT_COINS);
}

/**
 * The gift `raw` tells the receiver of, in private, if it is one: what, and from whom (`from`; its
 * `to` is left empty, the receiver being whoever the bot told).
 */
export function parseReceived(raw: string): { from: string; gift: Gift } | undefined {
  const g = parseWith(raw, GOT_ITEMS, GOT_COINS);
  return g === undefined ? undefined : { from: g.to, gift: { ...g, to: '' } };
}

/** A player's gift: who gave it, and what; and whether the owner received it. */
export type PlayerGift = PlayerAnswer<Gift> & { toOwner: boolean };

/** A gift of the owner's given, waiting a moment for its other message. */
interface Given {
  time: number;
  /** What it was and which way it went: the same gift's two messages agree on it. */
  key: string;
  /** Its giver, by name, lower case: preferred to pair, when the two messages name them alike. */
  giver: string;
  /** It answered a command known to wait (the answer), or none (a notice in private). */
  paired: boolean;
}

const same = (a: string, b: string | undefined): boolean =>
  b !== undefined && a.toLowerCase() === b.toLowerCase();

/**
 * The answers to `/give`, `/dai` and `/paga`, paired with their givers (`src/answer-watch.ts`),
 * and the owner's notices of a gift received, in private; each gift of the owner's once.
 *
 * A gift the owner gives or receives may come as two messages: the answer to its command (paired
 * with it, in the group or in private) and the bot's notice in private, which answers none (a
 * private "Hai inviato" with no command waiting is the owner's, as `AnswerWatch` takes it; a "Hai
 * ricevuto"). The second of an answer and a notice that tell the same gift (the same way, the same
 * other player, item, rarity and quantity, or coins), within `GIFT_ECHO_MS` of each other, is the
 * first's echo and is dropped: each message pairs once, so two like gifts in a row are two answers
 * and two notices, two gifts. Two answers never pair (each answered its own command), nor two
 * notices; a gift heard once, either way, is given.
 */
export class GiftWatch extends AnswerWatch<Gift> {
  private readonly giftBot: string;
  private given: Given[] = [];

  constructor(bot: string) {
    super({ bot, commands: GIFT_COMMANDS, parse: parseGift, args: true });
    this.giftBot = bot.toLowerCase();
  }

  /** Any player's gift, if `m` tells one: as `AnswerWatch.answer`, and the owner's once. */
  override answer(m: Heard, self: string | undefined): PlayerGift | undefined {
    const sent = super.answer(m, self);
    const gift: PlayerGift | undefined =
      sent === undefined ? this.received(m, self) : { ...sent, toOwner: same(sent.reply.to, self) };
    if (gift === undefined || !(gift.owner || gift.toOwner)) return gift;
    return this.once(gift, m.time);
  }

  /** The owner's notice of a gift received, in private: its giver's, to the owner. */
  private received(m: Heard, self: string | undefined): PlayerGift | undefined {
    if (m.own === true || m.sender.toLowerCase() !== this.giftBot || !isPrivate(m))
      return undefined;
    const got = parseReceived(m.text);
    if (got === undefined) return undefined;
    return {
      player: got.from,
      owner: same(got.from, self),
      reply: { ...got.gift, to: self ?? '' },
      toOwner: true,
    };
  }

  /** `gift`, unless it is the echo of one given a moment ago (the class's doc). */
  private once(gift: PlayerGift, time: number): PlayerGift | undefined {
    this.given = this.given.filter((g) => time - g.time <= GIFT_ECHO_MS);
    const r = gift.reply;
    const what = r.kind === 'coins' ? `coins ${r.coins}` : `${r.qty}x ${r.item} [${r.rarity}]`;
    const key = `${gift.owner ? `to ${r.to.toLowerCase()}` : 'to the owner'}\n${what}`;
    const giver = gift.player.toLowerCase();
    const paired = gift.asked !== undefined;
    const echoes = this.given.filter((g) => g.key === key && g.paired !== paired);
    const echo = echoes.find((g) => g.giver === giver) ?? echoes[0];
    if (echo !== undefined) {
      this.given = this.given.filter((g) => g !== echo);
      return undefined;
    }
    this.given.push({ time, key, giver, paired });
    return gift;
  }
}
