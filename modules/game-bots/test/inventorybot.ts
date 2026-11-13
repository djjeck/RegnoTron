/**
 * A stand-in for @InventoryBot's parser, which is InventoryBotTron's (its module `inventorybot`,
 * https://github.com/djjeck/InventoryBotTron): a turn parser of the same id, publishing the same
 * `inventorybot.turn` with an outcome of the same shape, which is all `metagame` relies on, through
 * the graph. It reads a drop as "@<owner>, <item> [<rarity>]!", the item delimited, as a sure gain.
 */
import { type Plugin } from '@megabottron1999/core';
import { turnParserPlugin } from '@megabottron1999/turns/turn-parser.ts';
import { INVENTORYBOT_PARSER } from '#src/plugins/metagame.ts';
import { INVENTORYBOT, type Outcome, TURN_COMMANDS, TURN_REST_MS } from '#src/replies.ts';

const DROP = /^@(\w+), (.+) \[(\w+\+?)\]!$/u;

export const inventorybotStandIn: Plugin = turnParserPlugin({
  id: INVENTORYBOT_PARSER,
  bot: INVENTORYBOT,
  description: "A stand-in for InventoryBotTron's @InventoryBot parser",
  turnCommands: TURN_COMMANDS[INVENTORYBOT],
  read: (m) => {
    const drop = DROP.exec(m.text);
    if (drop === null || drop[1] !== m.self) return undefined;
    const outcome: Outcome = {
      kind: 'gain',
      bot: INVENTORYBOT,
      item: drop[2] as string,
      rarity: drop[3] as string,
      tags: [],
      sure: true,
    };
    return { outcome, restMs: TURN_REST_MS };
  },
});
