/**
 * @InventoryBot's messages, read with the grammar of `@inventorybot-wiki/grammar` (the module
 * `inventorybot-grammar`, which the InventoryBot wiki reads the bot's exports with) and told as the
 * outcomes of `src/replies.ts`, the same for every game bot (docs/game-bots.md §1, §3).
 *
 * - The grammar classifies a reply; this module tells whose it is. @InventoryBot answers in the
 *   group without replying to the command, and names the player: "@alice, <sentence><item> [C]!",
 *   maybe with a title after the username ("@alice il pizzaiolo, …"), and "[W] " before it when it
 *   announces the adventure to another group; the lucky adventure, "Complimenti @alice, …". The
 *   addressee and its title are taken off before the grammar reads the reply, and the gain is the
 *   owner's only if it names them.
 * - A drop's item is not delimited from its sentence: the grammar's `resolveDrop` finds it with the
 *   parser's knowledge (`inventorybot-knowledge.ts`), and the gain is `sure` when it did; otherwise
 *   it is the grammar's guess (`guessDropItem`), and the gain says so. The tags are the grammar's:
 *   `usabile` or none.
 * - Its cooldown names nobody: read in the private chat only, with its wait.
 * - Whatever else it says to the owner (`/mostra`, `/usa`, `/inventario`…) is no adventure's.
 *
 * The bot writes some accented letters decomposed, so the text is read in its composed form (NFC),
 * and the items are kept in it.
 */
import { classify, guessDropItem, resolveDrop } from '@inventorybot-wiki/grammar';
import { type BotMessage, type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import { type InventoryKnowledge } from './inventorybot-knowledge.ts';
import { INVENTORYBOT, type Outcome, TURN_REST_MS } from './replies.ts';

/** A drop's addressee: "[W] " for an announced one, "@user", maybe a title, and ", ". */
const ADDRESSED = /^(?:\[W\] )?@(\w+)(?: [^,\n]*)?, /u;
/** The lucky adventure's. */
const LUCKY = /^Complimenti @(\w+), /u;

/**
 * What an @InventoryBot message tells the parser of `known`'s instance: a gain or a cooldown, a
 * message claimed and unread, or nothing. Every drop it reads, whoever's, teaches `known`.
 */
export function readInventoryBot(m: BotMessage, known: InventoryKnowledge): TurnReading {
  const text = m.text.normalize('NFC').trim();
  const lucky = LUCKY.exec(text);
  const addressed = lucky === null ? ADDRESSED.exec(text) : null;
  const to = lucky?.[1] ?? addressed?.[1];
  const mine = to !== undefined && to.toLowerCase() === m.self?.toLowerCase();
  const ev = classify(
    addressed === null ? text : `@${addressed[1]}, ${text.slice(addressed[0].length)}`,
    null
  );
  if (ev.type === 'drop' && to !== undefined) {
    let gain: { item: string; sure: boolean };
    if (ev.kind === 'lucky') gain = { item: ev.item, sure: true };
    else {
      const found = resolveDrop(ev.raw, known);
      if (found !== null) known.learn(found.item, found.prefix);
      // Found by what it knows, a known item or a known sentence: sure. The grammar's own `sure`,
      // which a known sentence does not make, is not this one.
      gain =
        found === null
          ? { item: guessDropItem(ev.raw), sure: false }
          : { item: found.item, sure: true };
    }
    if (!mine) return undefined;
    const outcome: Outcome = {
      kind: 'gain',
      bot: INVENTORYBOT,
      item: gain.item,
      rarity: ev.rarity,
      tags: ev.usable ? ['usabile'] : [],
      sure: gain.sure,
    };
    return { outcome, restMs: TURN_REST_MS };
  }
  // A lucky adventure of the owner's it cannot read is theirs, and unread.
  if (lucky !== null && mine) return { unread: true };
  if (!m.private) return undefined;
  if (ev.type === 'cooldown') {
    const wait = ev.remaining === undefined ? TURN_REST_MS : ev.remaining * 1000;
    const outcome: Outcome = {
      kind: 'nothing',
      bot: INVENTORYBOT,
      reason: 'cooldown',
      retryMs: wait,
    };
    return { outcome, restMs: wait };
  }
  return m.answers ? { unread: true } : undefined;
}
