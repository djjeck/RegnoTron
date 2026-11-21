/**
 * @LoreGameBot's inventory, the answer to `/zaino` and `/i` (docs/game-bots.md §5.8), as the
 * `loregame` parser reads it. Pure.
 *
 * Its first page names its player ("<username>, hai:", "<username>, il tuo inventario è vuoto!"),
 * after its filter if one was given (`/i <text>`: "Filtri attivi: <text>"), then lists an item a
 * line: "> <item> [<rarity>] [<tag>]… x<n>", an equippable item's name ending in its level range
 * ("(2 - 6)", "(4)"). A name may run over several lines (players write them): an item ends at the
 * line that ends in its rarity, tags and count. A long inventory is paged: its ◀️ and ▶️ buttons
 * turn the page (an edit of the message), each a lock at the first and the last page; a short one
 * shows no buttons; the text says nothing of its page. A later page starts with its items, and a page is cut by lines, so a name
 * running over several lines may be cut between two pages: its part on each is not read (`cut`).
 */
import { type Equipped } from '#src/profile.ts';

/** An item as the inventory lists it. */
export interface Listed {
  /** Its name, without its level range. */
  item: string;
  qty: number;
  rarity: string;
  tags: string[];
  /** An equippable item's level range; none for any other. */
  level: Equipped['level'];
}

/** What an inventory listing says. */
export interface InventoryListing {
  /** Its player, as its first page names them; none on a later page. */
  player: string | null;
  /** `/i <text>`'s filter; none for the whole inventory. */
  filter: string | null;
  /** The items of this page (of the whole, for a list of one page). */
  items: Listed[];
  /** An item cut between this page and the next or the one before: not read. */
  cut: boolean;
}

const HEADER = /^(\w+), (hai:|il tuo inventario è vuoto!)$/u;
const FILTER = /^Filtri attivi: (.+)$/u;
const ITEM = /^(.*?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*) x(\d+)$/su;
const RANGE = /^(.+) \((\d+)(?: - (\d+))?\)$/su;

/**
 * An item's lines, read: its name, its range, its rarity, tags and count; none if not whole. A recipe
 * lists its items so too (`src/recipes.ts`).
 */
export function listedOf(lines: readonly string[]): Listed | undefined {
  const m = ITEM.exec(lines.join('\n'));
  if (m === null) return undefined;
  const range = RANGE.exec(m[1] as string);
  return {
    item: range === null ? (m[1] as string) : (range[1] as string),
    qty: Number(m[4]),
    rarity: m[2] as string,
    tags: [...(m[3] as string).matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((t) => t[1] as string),
    level: range === null ? null : { low: Number(range[2]), high: Number(range[3] ?? range[2]) },
  };
}

/**
 * The listing `raw` is, if it is one: its header (a first page) and its items, or its items alone
 * (a later page), every line read; a later page that starts within a cut name skips to its first
 * item.
 */
export function parseInventory(raw: string): InventoryListing | undefined {
  const lines = raw.normalize('NFC').trim().split('\n');
  let filter: string | null = null;
  let at = 0;
  const f = FILTER.exec(lines[0]?.trim() ?? '');
  if (f !== null) {
    filter = f[1] as string;
    at = 1;
    while (lines[at]?.trim() === '') at++;
  }
  const header = HEADER.exec(lines[at]?.trim() ?? '');
  const empty = header !== null && header[2] !== 'hai:';
  let rest = lines.slice(header === null ? at : at + 1);
  let cut = false;
  if (header === null) {
    const first = rest.findIndex((l) => l.startsWith('> '));
    if (first < 0) return undefined;
    cut = first > 0;
    rest = rest.slice(first);
  }
  const items: Listed[] = [];
  let name: string[] | undefined;
  for (const line of rest) {
    if (name === undefined) {
      if (line.trim() === '') continue;
      if (empty || !line.startsWith('> ')) return undefined;
      name = [line.slice(2)];
    } else name.push(line);
    const item = listedOf(name);
    if (item === undefined) continue;
    items.push(item);
    name = undefined;
  }
  // A name the page ends within: cut, its rest on the next page.
  if (name !== undefined) cut = true;
  if (header === null && items.length === 0) return undefined;
  return { player: header === null ? null : (header[1] as string), filter, items, cut };
}

/**
 * Which page a listing's buttons say it is (MegaBotTron1999's D145): the first when it offers no
 * ◀️ (a lock instead), the last when it offers no ▶️; a listing short enough for one page shows no
 * buttons at all [M], so one without any is both. None when its buttons are not known (an export, a
 * shell before D145 0.1.47, which gives no `buttons`): a first page may then be all of it, or not.
 */
export function pageOf(
  buttons: readonly (readonly string[])[] | undefined
): { first: boolean; last: boolean } | null {
  if (buttons === undefined) return null;
  const labels = buttons.flat();
  return {
    first: !labels.some((l) => l.includes('◀')),
    last: !labels.some((l) => l.includes('▶')),
  };
}
