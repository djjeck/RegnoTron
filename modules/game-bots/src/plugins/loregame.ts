/**
 * The `loregame` parser plugin: @LoreGameBot's answers to the owner's turns, on the base of
 * @megabottron1999/turns/turn-parser.ts and the grammar of modules/game-bots/src/replies.ts.
 *
 * It replies to the command and names nobody: a reply to one of the owner's turns is read (an item, a
 * fight lost or the item lost, a "too soon"), and one it cannot read is claimed and unread (drift).
 * In private, a reply to a message it does not know (a turn sent an instant before the actor
 * learnt its id) still counts when it reads as a turn's outcome. Its rest: 15 minutes, 30 after a
 * fight lost, or the wait it states.
 */
import { type Plugin } from '@megabottron1999/core';
import { turnParserPlugin, type TurnReading } from '@megabottron1999/turns/turn-parser.ts';
import {
  LORE_DEFEAT_REST_MS,
  LOREGAMEBOT,
  type Outcome,
  parseLoreGameBot,
  TURN_REST_MS,
} from '#src/replies.ts';

export const LOREGAME_PARSER = 'loregame';

/** The rest a turn's outcome starts. */
function restOf(o: Outcome): number | undefined {
  if (o.kind === 'gain') return TURN_REST_MS;
  if (o.kind !== 'nothing') return undefined;
  if (o.reason === 'defeated') return LORE_DEFEAT_REST_MS;
  if (o.reason === 'lost') return TURN_REST_MS;
  if (o.reason === 'cooldown') return o.retryMs;
  return undefined;
}

export function loregamePlugin(o: { group?: string } = {}): Plugin {
  return turnParserPlugin(
    {
      id: LOREGAME_PARSER,
      bot: LOREGAMEBOT,
      description:
        "@LoreGameBot's answers to the owner's turns: the items, the fights, and its rest",
      read: (m): TurnReading => {
        if (!m.answers && !(m.private && m.replies)) return undefined;
        const outcome = parseLoreGameBot(m.text);
        if (outcome.kind === 'unknown') return m.answers ? { unread: true } : undefined;
        const restMs = restOf(outcome);
        return restMs === undefined ? { outcome } : { outcome, restMs };
      },
    },
    o
  );
}
