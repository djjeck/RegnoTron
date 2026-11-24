/**
 * @LoreGameBot's recipes (docs/game-bots.md §5.14), as the `loregame` parser reads them. Pure.
 *
 * Each answer names its player ("@<username>, …"), replying to nothing [M: none of the exports'
 * does]:
 *
 * - **`/ricetta`**, the recipes a player can make: "@<p>, ecco le ricette a tua disposizione:", then
 *   "- <name> [L<n>] [manca <n>]" a line, `[manca <n>]` the lines its answer lists as lacking [M: 34
 *   of 34], or `[*]`, one they have made already [M], listed after the others; or "Nessuna ricetta
 *   creata finora.". It ends in "Scrivi /ricetta <nome ricetta> per …". Every player is listed
 *   every recipe of the game's [M].
 * - **`/ricetta <name>`** (any part of a name), a recipe lacking something: "@<p>, per fare la
 *   ricetta <name> ti mancano:", the items lacking ("- <item> [<rarity>][ [<tag>]…] x<n>"), then,
 *   if any is held, "Mentre hai già:" and the items held, each with the player's whole count. An
 *   item is never both [M]. "Ricetta non trovata!" when no recipe has that name.
 * - **A recipe made** (`/ricetta <name>`, nothing lacking): "@<p>, prendi in mano:", the items it
 *   takes, each with its count; a story ("e …"); "Ottieni: <item> [<rarity>]!". It costs nothing
 *   and names no recipe [M: 7 of 7]. A recipe being made (`/generaricetta`) is previewed the same
 *   way, but after the command repeated and with "Ottieni: 1x …" and "Costo: <n>₭": not read.
 *
 * An item's name may run over several lines (players write them): it ends at the line that ends
 * in its rarity, tags and count, as in an inventory (`listedOf`).
 */
import { type Listed, listedOf } from '#src/inventory.ts';

/** A recipe as a player's list names it. */
export interface RecipeListed {
  name: string;
  /** Its level, `[L<n>]`. */
  level: number;
  /** How many items they lack for it (`[manca <n>]`); none for `[*]`. */
  lacking: number | null;
  /** `[*]`: one they have made already [M], listed last, in place of `[manca <n>]`. */
  starred: boolean;
}

/** A player's recipes, as `/ricetta` lists them. */
export interface RecipeList {
  player: string;
  recipes: RecipeListed[];
}

/** A recipe's needs, as `/ricetta <name>` tells them. */
export interface RecipeNeeds {
  player: string;
  name: string;
  /** What they lack, each by how many. */
  lacking: Listed[];
  /** What they hold of what it takes, each their whole count. */
  held: Listed[];
}

/** A recipe made: whose, what it took, what it gave. */
export interface RecipeMade {
  player: string;
  used: Listed[];
  made: Listed;
}

const LIST = /^@(\w+), ecco le ricette a tua disposizione:$/u;
const LISTED = /^- (.+) \[L(\d+)\] \[(?:manca (\d+)|(\*))\]$/u;
const NEEDS = /^@(\w+), per fare la ricetta (.+) ti mancan?[oa]:$/u;
const MADE = /^@(\w+), prendi in mano:$/u;
const GOT = /^Ottieni: (?:(\d+)x )?(.+)!$/su;

/** "- <item>" lines, an item to the line that ends in its count; none if one is not whole. */
function itemsOf(lines: readonly string[]): Listed[] | undefined {
  const items: Listed[] = [];
  let name: string[] | undefined;
  for (const l of lines) {
    if (name === undefined) {
      if (!l.startsWith('- ')) return undefined;
      name = [l.slice(2)];
    } else name.push(l);
    const item = listedOf(name);
    if (item === undefined) continue;
    items.push(item);
    name = undefined;
  }
  return name === undefined ? items : undefined;
}

/** The list `raw` is, if one: its player and every recipe, every line read. */
export function parseRecipes(raw: string): RecipeList | undefined {
  const lines = raw.normalize('NFC').trim().split('\n');
  const head = LIST.exec(lines[0] as string);
  if (head === null) return undefined;
  const recipes: RecipeListed[] = [];
  for (const l of lines.slice(1)) {
    if (l === '' || l === 'Nessuna ricetta creata finora.' || l.startsWith('Scrivi /ricetta'))
      continue;
    const m = LISTED.exec(l);
    if (m === null) return undefined;
    recipes.push({
      name: m[1] as string,
      level: Number(m[2]),
      lacking: m[3] === undefined ? null : Number(m[3]),
      starred: m[4] !== undefined,
    });
  }
  return { player: head[1] as string, recipes };
}

/** The needs `raw` tells, if a recipe's: what its player lacks and holds. */
export function parseRecipeNeeds(raw: string): RecipeNeeds | undefined {
  const text = raw.normalize('NFC').trim();
  const [first = '', ...rest] = text.split('\n');
  const head = NEEDS.exec(first);
  if (head === null) return undefined;
  const parts = rest.join('\n').split(/\n\s*\nMentre hai già:\n/u);
  if (parts.length > 2) return undefined;
  const lacking = itemsOf((parts[0] as string).split('\n'));
  const held = parts[1] === undefined ? [] : itemsOf(parts[1].split('\n'));
  if (lacking === undefined || held === undefined || lacking.length === 0) return undefined;
  return { player: head[1] as string, name: head[2] as string, lacking, held };
}

/** The recipe made `raw` tells, if one: whose, what it took and gave. */
export function parseRecipeMade(raw: string): RecipeMade | undefined {
  const paras = raw
    .normalize('NFC')
    .trim()
    .split(/\n\s*\n/u);
  const [first = '', ...rest] = (paras[0] as string).split('\n');
  const head = MADE.exec(first);
  const got = GOT.exec(paras.at(-1) as string);
  if (head === null || got === null || paras.length < 3) return undefined;
  const used = itemsOf(rest);
  const made = listedOf([`${got[2] as string} x${got[1] ?? '1'}`]);
  if (used === undefined || used.length === 0 || made === undefined) return undefined;
  return { player: head[1] as string, used, made };
}
