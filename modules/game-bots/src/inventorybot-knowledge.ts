/**
 * What the `inventorybot` parser knows of @InventoryBot's drops, for the grammar's `resolveDrop`
 * (`@inventorybot-wiki/grammar`): the sentence prefixes it ships (`inventorybot-prefixes.ts`), and
 * the item names and prefixes it learns as it reads drops, kept in its instance's store.
 *
 * - An item is learned from every drop resolved (a known item, or what follows a known prefix), and
 *   a prefix from every drop that ends with a known item: the next drop of that sentence resolves,
 *   whatever its item, and the next drop of that item, whatever its sentence.
 * - A prefix that ends with a space is known in a second form, with a line break instead: a
 *   player-made item's name may start on a new line, and the grammar drops the space before it.
 * - What it learns is bounded (`MAX_ITEMS`, `MAX_PREFIXES`), the oldest dropped first, so its store
 *   document stays small (a few hundred kB at most) whatever the group plays; the game's items, a
 *   little over a thousand seen in years of the group's exports, fit with room to spare. The shipped
 *   prefixes are never dropped.
 */
import { type DropKnowledge } from '@inventorybot-wiki/grammar';
import { type Store } from '@megabottron1999/core';
import { z } from 'zod';
import { INVENTORYBOT_PREFIXES } from './inventorybot-prefixes.ts';

/** The store's document of what it learned. */
export const KNOWLEDGE_DOC = 'knowledge';
/** At most this many learned item names. */
export const MAX_ITEMS = 5000;
/** At most this many learned prefixes (each form counts). */
export const MAX_PREFIXES = 1000;

const learnedSchema = z.object({ items: z.array(z.string()), prefixes: z.array(z.string()) });
type Learned = z.infer<typeof learnedSchema>;

/** A prefix as the grammar may find it: as written, and with a line break for its final space. */
export function prefixForms(prefix: string): string[] {
  return prefix.endsWith(' ') ? [prefix, `${prefix.slice(0, -1)}\n`] : [prefix];
}

const SHIPPED: ReadonlySet<string> = new Set(INVENTORYBOT_PREFIXES.flatMap(prefixForms));

/** Add `value` to `set`, dropping the oldest beyond `max`; whether it was new. */
function addBounded(set: Set<string>, value: string, max: number): boolean {
  if (set.has(value)) return false;
  set.add(value);
  for (const oldest of set) {
    if (set.size <= max) break;
    set.delete(oldest);
  }
  return true;
}

/** The knowledge of one parser instance, read from and written to its store. */
export class InventoryKnowledge implements DropKnowledge {
  /** The learned item names, oldest first. */
  readonly items = new Set<string>();
  /** The learned prefixes, oldest first; the shipped ones are not among them. */
  readonly learned = new Set<string>();

  readonly #store: Store;

  constructor(store: Store) {
    this.#store = store;
    const kept = learnedSchema.safeParse(store.read<Learned>(KNOWLEDGE_DOC));
    if (!kept.success) return;
    for (const item of kept.data.items) addBounded(this.items, item, MAX_ITEMS);
    for (const prefix of kept.data.prefixes)
      if (!SHIPPED.has(prefix)) addBounded(this.learned, prefix, MAX_PREFIXES);
  }

  /** The shipped prefixes and the learned ones. */
  get prefixes(): Iterable<string> {
    return [...SHIPPED, ...this.learned];
  }

  /** Learn a drop's item, and the prefix it was found after; the store is written if either is new. */
  learn(item: string, prefix: string): void {
    let changed = item !== '' && addBounded(this.items, item, MAX_ITEMS);
    if (prefix !== '')
      for (const form of prefixForms(prefix))
        if (!SHIPPED.has(form) && addBounded(this.learned, form, MAX_PREFIXES)) changed = true;
    if (changed)
      this.#store.write(KNOWLEDGE_DOC, { items: [...this.items], prefixes: [...this.learned] });
  }
}
