/**
 * The `inventorybot` parser plugin: @InventoryBot's answers to the owner's turns, on the base of
 * @megabottron1999/turns/turn-parser.ts and the grammar of modules/game-bots/src/replies.ts.
 *
 * - A drop or the lucky adventure addressed to the owner, in either chat: a gain, then its 15 minutes'
 *   rest. It does not reply to the command, so it names the player.
 * - Its cooldown names nobody: read only in the private chat, with its wait.
 * - In private, the first message after a turn that is neither: claimed and unread (drift).
 */
import { type Plugin } from '@megabottron1999/core';
import { turnParserPlugin, type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import {
  INVENTORYBOT,
  inventoryCooldown,
  type Outcome,
  parseInventoryBot,
  TURN_REST_MS,
} from '#src/replies.ts';

export const INVENTORYBOT_PARSER = 'inventorybot';

export function inventorybotPlugin(o: { group?: string } = {}): Plugin {
  return turnParserPlugin(
    {
      id: INVENTORYBOT_PARSER,
      bot: INVENTORYBOT,
      description: "@InventoryBot's answers to the owner's turns: the items, and its rest",
      read: (m): TurnReading => {
        const gain = m.self === undefined ? undefined : parseInventoryBot(m.text, m.self);
        if (gain?.kind === 'unknown') return { unread: true };
        if (gain !== undefined) return { outcome: gain, restMs: TURN_REST_MS };
        if (!m.private) return undefined;
        const wait = inventoryCooldown(m.text);
        if (wait !== undefined) {
          const outcome: Outcome = {
            kind: 'nothing',
            bot: INVENTORYBOT,
            reason: 'cooldown',
            retryMs: wait,
          };
          return { outcome, restMs: wait };
        }
        return m.answers ? { unread: true } : undefined;
      },
    },
    o
  );
}
