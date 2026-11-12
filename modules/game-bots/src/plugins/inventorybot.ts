/**
 * The `inventorybot` parser plugin: @InventoryBot's answers to the owner's turns, on the base of
 * @megabottron1999/turns/turn-parser.ts and the grammar of `@inventorybot-wiki/grammar`, through
 * modules/game-bots/src/inventorybot.ts.
 *
 * - A drop or the lucky adventure addressed to the owner, in either chat: a gain, then its 15 minutes'
 *   rest. It does not reply to the command, so it names the player.
 * - Its cooldown names nobody: read only in the private chat, with its wait.
 * - In private, the first message after a turn that is neither: claimed and unread (drift).
 *
 * Each instance keeps what it learns of the drops (items and sentence prefixes) in its own store
 * (`inventorybot-knowledge.ts`), so the base parser is made per instance, with its knowledge, rather
 * than once in the factory.
 */
import { type Plugin } from '@megabottron1999/core';
import { turnParserPlugin, type TurnParserSpec } from '@megabottron1999/turns/turn-parser.ts';
import { readInventoryBot } from '#src/inventorybot.ts';
import { InventoryKnowledge } from '#src/inventorybot-knowledge.ts';
import { INVENTORYBOT, TURN_COMMANDS } from '#src/replies.ts';

export const INVENTORYBOT_PARSER = 'inventorybot';

const spec = (read: TurnParserSpec['read']): TurnParserSpec => ({
  id: INVENTORYBOT_PARSER,
  bot: INVENTORYBOT,
  description: "@InventoryBot's answers to the owner's turns: the items, and its rest",
  turnCommands: TURN_COMMANDS[INVENTORYBOT],
  read,
});

export const inventorybotPlugin: Plugin = {
  manifest: turnParserPlugin(spec(() => undefined)).manifest,
  create: (ctx) => {
    const known = new InventoryKnowledge(ctx.store);
    return turnParserPlugin(spec((m) => readInventoryBot(m, known))).create(ctx);
  },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [inventorybotPlugin];
