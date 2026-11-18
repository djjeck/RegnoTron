/**
 * @LoreGameBot's answers to `/give` and `/dai` (docs/game-bots.md §5.10), as the `loregame` parser
 * reads them. Pure.
 *
 * A gift sent: "Hai inviato <n>x <item> [<rarity>] [<tag>]… a <username>!", or coins, "Hai inviato
 * <n> monete a <username>!"; at times after "[N] " [?]. The receiver is named as the giver typed
 * them, an `@` and any case at times. The answer names the receiver, not the
 * giver, and since August 2026 it is a message of its own, not a reply [M]: `GiftWatch` pairs it
 * with the command waiting (`src/answer-watch.ts`). The receiver is told nothing. Its refusals (a
 * format, an item not found or not held, a user unknown) change nothing, and are not read.
 */
import { AnswerWatch, type PlayerAnswer } from '#src/answer-watch.ts';
import { type Listed } from '#src/inventory.ts';

/** The commands of a gift, as a player types them. */
export const GIFT_COMMANDS: readonly string[] = ['/give', '/dai'];

/** What a gift sent was: items, or coins; and to whom. */
export type Gift =
  ({ kind: 'item'; to: string } & Listed) | { kind: 'coins'; to: string; coins: number };

const PREFIX = String.raw`^(?:\[N\] )?Hai inviato `;
const ITEMS = new RegExp(
  String.raw`${PREFIX}(\d+)x (.+?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*) a @?(\w+)!$`,
  'su'
);
const COINS = new RegExp(String.raw`${PREFIX}(\d+) monete a @?(\w+)!$`, 'u');
const RANGE = /^(.+) \((\d+)(?: - (\d+))?\)$/su;

/** The gift `raw` tells of, if it is one: the whole message. */
export function parseGift(raw: string): Gift | undefined {
  const text = raw.normalize('NFC').trim();
  const coins = COINS.exec(text);
  if (coins !== null) return { kind: 'coins', coins: Number(coins[1]), to: coins[2] as string };
  const m = ITEMS.exec(text);
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

/** A player's gift: who gave it, and what. */
export type PlayerGift = PlayerAnswer<Gift>;

/** The answers to `/give` and `/dai`, paired with their givers (`src/answer-watch.ts`). */
export class GiftWatch extends AnswerWatch<Gift> {
  constructor(bot: string) {
    super({ bot, commands: GIFT_COMMANDS, parse: parseGift, args: true });
  }
}
