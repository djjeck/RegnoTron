/**
 * The `epiclorelec` parser plugin: @EpicLorelecBot's answers to the owner's turns, on the base
 * of @megabottron1999/turns/turn-parser.ts and the grammar of
 * modules/game-bots/src/replies.ts; minimal, for the rest.
 *
 * Its count ("mi hai rotto il cazzo 53 volte!") names the player by display name, so it is read in
 * the private chat only, with its 15 minutes' rest; its "too soon" replies to the command, so it is
 * read in either chat when it answers a turn, with its wait. In private, the first message after a
 * turn that is neither is claimed and unread (drift).
 */
import { type Plugin } from '@megabottron1999/core';
import { type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import { EPICLORELECBOT, parseEpicLorelecBot, TURN_REST_MS } from '#src/replies.ts';
import { gameParserPlugin } from './game-parser.ts';

export const EPICLORELEC_PARSER = 'epiclorelec';

export const epiclorelecPlugin: Plugin = gameParserPlugin({
  id: EPICLORELEC_PARSER,
  bot: EPICLORELECBOT,
  description: "@EpicLorelecBot's answers to the owner's turns: its count, and its rest",
  read: (m): TurnReading => {
    const outcome = parseEpicLorelecBot(m.text);
    if (outcome?.kind === 'count' && m.private) return { outcome, restMs: TURN_REST_MS };
    if (outcome?.kind === 'nothing' && (m.private || m.answers))
      return outcome.retryMs === undefined ? { outcome } : { outcome, restMs: outcome.retryMs };
    return m.private && m.answers ? { unread: true } : undefined;
  },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [epiclorelecPlugin];
