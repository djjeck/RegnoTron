/**
 * @LoreGameBot's shop, the answer to `/negozio` and `/shop` (docs/game-bots.md §5.12), as the
 * `loregame` parser reads it. Pure.
 *
 * It names the player who asked ("<player>, oggi nel negozio:"), after the day's sagra when there
 * is one ("<player>, c'è la sagra <of something>!", a blank line, then "oggi nel negozio:"), then
 * lists an item a line: "- 🛒 <item> [<rarity>] [<tag>]… <price>₭", `✅` for `🛒` on an item the
 * player who asked has already bought. A name may run over several lines (players write them): an
 * item ends at the line that ends in its rarity, tags and price. The list is the same for every
 * player, all day: it changes at midnight Italian time.
 */
import { type CommandMechanics } from '@megabottron1999/turns/readiness.ts';

/** The shop's commands: its name, then its alias. */
export const SHOP_COMMANDS: readonly string[] = ['/negozio', '/shop'];
/** The shop's command, by its name. */
export const SHOP = SHOP_COMMANDS[0] as string;

/** An item as the shop lists it. */
export interface ShopItem {
  item: string;
  rarity: string;
  tags: string[];
  /** Its price, in coins (₭). */
  price: number;
  /** The player who asked has already bought it (`✅`). */
  bought: boolean;
}

/** What a shop listing says. */
export interface ShopListing {
  /** The player who asked, as the answer names them. */
  player: string;
  /** The day's sagra ("della pigna"), as the bot names it; none on an ordinary day. */
  sagra: string | null;
  items: ShopItem[];
}

const HEADER = /^(.+?), oggi nel negozio:$/u;
const SAGRA = /^(.+?), c['’]è la sagra (.+)!$/u;
const LIST = 'oggi nel negozio:';
const MARK = /^- (🛒|✅) /u;
const ITEM = /^(.*?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*) ([\d.]+) ?₭$/su;

/** An item's lines, read: its name, rarity, tags and price; none if not whole. */
function itemOf(lines: readonly string[], bought: boolean): ShopItem | undefined {
  const m = ITEM.exec(lines.join('\n'));
  if (m === null) return undefined;
  return {
    item: m[1] as string,
    rarity: m[2] as string,
    tags: [...(m[3] as string).matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((t) => t[1] as string),
    price: Number((m[4] as string).replaceAll('.', '')),
    bought,
  };
}

/** The shop listing `raw` is, if it is one, every line read; none for anything else. */
export function parseShop(raw: string): ShopListing | undefined {
  const lines = raw.normalize('NFC').trim().split('\n');
  let player: string;
  let sagra: string | null = null;
  let at = 1;
  const header = HEADER.exec(lines[0]?.trim() ?? '');
  if (header !== null) player = header[1] as string;
  else {
    const s = SAGRA.exec(lines[0]?.trim() ?? '');
    if (s === null) return undefined;
    player = s[1] as string;
    sagra = s[2] as string;
    while (lines[at]?.trim() === '') at++;
    if (lines[at]?.trim() !== LIST) return undefined;
    at++;
  }
  const items: ShopItem[] = [];
  let name: string[] | undefined;
  let bought = false;
  for (const line of lines.slice(at)) {
    if (name === undefined) {
      if (line.trim() === '') continue;
      const mark = MARK.exec(line);
      if (mark === null) return undefined;
      bought = mark[1] === '✅';
      name = [line.slice(mark[0].length)];
    } else name.push(line);
    const item = itemOf(name, bought);
    if (item === undefined) continue;
    items.push(item);
    name = undefined;
  }
  // A name the listing ends within, or no item at all: not a listing this grammar knows.
  if (name !== undefined || items.length === 0) return undefined;
  return { player, sagra, items };
}

/** The generators' tag (`[generatore]`): meta-game items, sold by the shop as any other. */
export const GENERATOR_TAG = 'generatore';

/** The shop's time zone: it changes at midnight there (§5.12). */
export const SHOP_TIME_ZONE = 'Europe/Rome';

const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The shop's day at `t` (ms): the date in Italy, `YYYY-MM-DD`. */
export const shopDayOf = (t: number): string => DAY.format(new Date(t));

/**
 * The shop's mechanics (MegaBotTron1999's D165): listed, it has nothing new to say until its items
 * change, at midnight in Italy, whoever listed it. Not interactive: the listing asks nothing.
 */
export const SHOP_MECHANICS: CommandMechanics = {
  resetsAt: { times: ['00:00'], timeZone: SHOP_TIME_ZONE },
};

/** A purchase the shop's buttons asked to confirm, or made. */
export interface Purchase {
  player: string;
  item: string;
  rarity: string;
  tags: string[];
  /** Its price, in coins (₭). */
  price: number;
}

const CONFIRM =
  /^(.+?), sei sicuro di voler comprare (.+?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*) per ([\d.]+) ₭\?$/su;

/** The confirmation a listing's buy button edits it into, if `raw` is one (§5.12). */
export function parseConfirm(raw: string): Purchase | undefined {
  const m = CONFIRM.exec(raw.normalize('NFC').trim());
  if (m === null) return undefined;
  return {
    player: m[1] as string,
    item: m[2] as string,
    rarity: m[3] as string,
    tags: [...(m[4] as string).matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((t) => t[1] as string),
    price: Number((m[5] as string).replaceAll('.', '')),
  };
}

/** The confirmations waiting, at most, the oldest forgotten first. */
const KEPT_CONFIRMS = 100;

/**
 * The purchases made with a listing's buttons (§5.12), as its edits tell them: the buy button edits
 * the listing into a confirmation ("<player>, sei sicuro di voler comprare <item> per <price> ₭?"),
 * and the answer to it edits the same message back into the player's listing, the item `✅` if it
 * was bought (`🛒` if not: cancelled). The purchase itself sends no message.
 */
export class PurchaseWatch {
  private readonly waiting = new Map<string, Purchase>();

  /** A message of the bot's, or an edit of one: the purchase it ends, if one. */
  hear(m: { chat: string; id?: string | undefined; text: string }): Purchase | undefined {
    if (m.id === undefined) return undefined;
    const key = `${m.chat}\n${m.id}`;
    const confirm = parseConfirm(m.text);
    if (confirm !== undefined) {
      this.waiting.delete(key);
      this.waiting.set(key, confirm);
      if (this.waiting.size > KEPT_CONFIRMS)
        this.waiting.delete(this.waiting.keys().next().value as string);
      return undefined;
    }
    const asked = this.waiting.get(key);
    if (asked === undefined) return undefined;
    this.waiting.delete(key);
    const listing = parseShop(m.text);
    const item = listing?.items.find((i) => i.item === asked.item && i.rarity === asked.rarity);
    return listing?.player === asked.player && item?.bought === true ? asked : undefined;
  }
}
