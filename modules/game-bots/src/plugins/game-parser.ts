/**
 * The base of the three game bots' parser plugins: the shell's `turnParserPlugin`
 * (@megabottron1999/turns/turn-parser.ts) on a bot's grammar, its turn commands defaulting to the
 * bot's own (`TURN_COMMANDS`) rather than the shell's placeholder, `/play`, since this is the
 * game's repository. The node's config may still name others; the edge from `telegram-user` reads
 * the private chat with the bot and, when it also reads the game's group, the turns played there.
 */
import { type Plugin } from '@megabottron1999/core';
import { turnParserPlugin, type TurnParserSpec } from '@megabottron1999/turns/turn-parser.ts';
import { z } from 'zod';
import { type GameBot, TURN_COMMANDS } from '#src/replies.ts';

/** A parser's configuration: the owner's turn commands it recognises, by first word. */
export function parserConfig(bot: GameBot) {
  return z.object({
    commands: z
      .array(z.string().regex(/^\/\w+$/u, 'expected a command'))
      .default([...TURN_COMMANDS[bot]])
      .describe(`The owner's turn commands to @${bot} it counts`),
  });
}

/** A game bot's parser plugin, from its grammar. */
export function gameParserPlugin(spec: TurnParserSpec & { bot: GameBot }): Plugin {
  const base = turnParserPlugin(spec);
  return { ...base, manifest: { ...base.manifest, config: parserConfig(spec.bot) } };
}
