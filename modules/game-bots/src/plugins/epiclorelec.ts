/**
 * The `epiclorelec` parser plugin: @EpicLorelecBot's answers to the owner's turns, on the base
 * of @megabottron1999/turns/turn-parser.ts and the grammar of
 * modules/game-bots/src/replies.ts; minimal, for the rest.
 *
 * Its count ("mi hai rotto il cazzo 53 volte!") names the player by display name, so it is read in
 * the private chat only, with its 15 minutes' rest; its "too soon" replies to the command, so it is
 * read in either chat when it answers a turn, with its wait. In private, the first message after a
 * turn that is neither is claimed and unread (drift).
 *
 * The bot has no state of its own here, so its turn's readiness, which a shell player binds to, is
 * kept by `epiclorelec-ready`, the shell's generic readiness state on this parser's events
 * (MegaBotTron1999's bot-os.md D141).
 */
import { type Plugin } from '@megabottron1999/core';
import { readinessPlugin } from '@megabottron1999/turns/state-plugin.ts';
import { turnParserPlugin, type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import { EPICLORELECBOT, parseEpicLorelecBot, TURN_COMMANDS, TURN_REST_MS } from '#src/replies.ts';

export const EPICLORELEC_PARSER = 'epiclorelec';
export const EPICLORELEC_READY = 'epiclorelec-ready';

/** @EpicLorelecBot's vocabulary: its turn, its own command first (D140, D141). */
const VOCABULARY = { bot: EPICLORELECBOT, turnCommands: TURN_COMMANDS[EPICLORELECBOT] };

export const epiclorelecPlugin: Plugin = turnParserPlugin({
  id: EPICLORELEC_PARSER,
  description: "@EpicLorelecBot's answers to the owner's turns: its count, and its rest",
  ...VOCABULARY,
  read: (m): TurnReading => {
    const outcome = parseEpicLorelecBot(m.text);
    if (outcome?.kind === 'count' && m.private) return { outcome, restMs: TURN_REST_MS };
    if (outcome?.kind === 'nothing' && (m.private || m.answers))
      return outcome.retryMs === undefined ? { outcome } : { outcome, restMs: outcome.retryMs };
    return m.private && m.answers ? { unread: true } : undefined;
  },
});

/** Its turn's readiness, for a shell player (D141): its rest, from the parser's events. */
export const epiclorelecReadyPlugin: Plugin = readinessPlugin({
  id: EPICLORELEC_READY,
  description: "When @EpicLorelecBot's turn may be played again, from its parser's events",
  parser: { id: EPICLORELEC_PARSER, ...VOCABULARY },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [epiclorelecPlugin, epiclorelecReadyPlugin];
