/**
 * A player's own command, as the channel shows it before the bot answers: `/raid @Juno` from
 * Telegram through the relay (`<Regno> <Mirco777> /raid @Juno`), `!raid Juno` from IRC
 * (docs/bot-protocol.md §1). The command is seen whether the bot then plays or refuses it.
 */
import { BOT_NAME } from './bot-message.ts';

export interface PlayerCommand {
  /** Milliseconds since the epoch. */
  time: number;
  /** Who sent it. */
  player: string;
  /** The command's verb, lower-case, without `/`, `!` or `@NorelecBot`: `raid`. */
  verb: string;
  /** Its arguments, `@` dropped: `['Juno']`. */
  args: string[];
}

const COMMAND = /^[/!]([A-Za-z]+)(?:@\w+)?(?:\s+(.*))?$/su;

/** The command `text` by `player` is, or null if it is none (or the bot's own line). */
export function playerCommand(time: number, player: string, text: string): PlayerCommand | null {
  if (BOT_NAME.test(player)) return null;
  const m = COMMAND.exec(text.trim());
  if (m === null) return null;
  const args = (m[2] ?? '')
    .split(/\s+/u)
    .filter((a) => a !== '')
    .map((a) => a.replace(/^@/u, ''));
  return { time, player, verb: String(m[1]).toLowerCase(), args };
}
