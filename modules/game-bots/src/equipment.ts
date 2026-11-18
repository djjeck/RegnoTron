/**
 * @LoreGameBot's answers to `/equipaggia` (docs/game-bots.md §5.7), as the `loregame` parser reads
 * them. Pure.
 *
 * `/equipaggia <item>` equips an item, in its slot, removing the one it held: "Hai rimosso <old>!",
 * then "Hai equipaggiato <new>!"; an item worn already is taken off ("Hai rimosso <item>!" alone).
 * Neither names the slot nor the item's level range: the state knows them from the item, if it saw
 * it before. Without an item, the bot lists the three slots, as the profile does. Its refusals (the
 * level, an item not held, not equippable, worn already, several that match) change nothing, and
 * are not read here.
 */
import { type Equipped, equipped, SLOT, type Slot, SLOTS } from '#src/profile.ts';

/** What an answer to `/equipaggia` changed, or listed. */
export type EquipAnswer =
  | { kind: 'equipped'; item: string; removed: string | null }
  | { kind: 'removed'; item: string }
  | { kind: 'listing'; equipment: Record<Slot, Equipped | null> };

const EQUIPPED = /^Hai equipaggiato (.+)!$/u;
const REMOVED = /^Hai rimosso (.+)!$/u;
const LISTING = 'Formato non valido! /equipaggia {oggetto}';

/** The answer `raw` is, if it is one that changes or lists the equipment: the whole message. */
export function parseEquip(raw: string): EquipAnswer | undefined {
  const lines = raw
    .normalize('NFC')
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines[0] === LISTING) {
    const equipment: Record<Slot, Equipped | null> = { armour: null, amulet: null, weapon: null };
    const slots = lines.slice(1);
    for (const l of slots) {
      const m = SLOT.exec(l);
      if (m === null) return undefined;
      equipment[SLOTS[m[1] as keyof typeof SLOTS]] = equipped(m[2] as string);
    }
    return slots.length === 3 ? { kind: 'listing', equipment } : undefined;
  }
  const [first, second, ...rest] = lines;
  if (first === undefined || rest.length > 0) return undefined;
  const removed = REMOVED.exec(first);
  const put = EQUIPPED.exec(second ?? first);
  if (second === undefined)
    return put !== null
      ? { kind: 'equipped', item: put[1] as string, removed: null }
      : removed !== null
        ? { kind: 'removed', item: removed[1] as string }
        : undefined;
  return removed !== null && put !== null
    ? { kind: 'equipped', item: put[1] as string, removed: removed[1] as string }
    : undefined;
}
