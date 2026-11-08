/**
 * `/nuclear_warning`, a command of the `nuclear-clock` plugin: the balls in the game,
 * counted in ☢️, the emoji that costs 1,000,000 and resets the game when thrown at
 * @TheConquister37 (docs/game-rules.md §5.3, §7.3).
 *
 * The total is the sum of the balances the game state knows: the bot never states it. Each balance
 * is the last a leaderboard, a profile or a refused purchase showed, moved since by what the bot
 * said (modules/norelec/src/state/game-state.ts), plus the balls on the road with the player (a
 * gift on its way, a theft's loot on its way home), which no balance holds; a player the client
 * never saw is left out, and a leaderboard caps those below it. The players with at least 5% of a
 * ☢️ (50,000) are listed, richest first. No time to a ☢️ is given: balls burned and emojis
 * bought kept any estimate from the rate of a hold wrong.
 *
 * The message is Markdown (the switchboard's `markdown` format, sent as Telegram HTML), for its bold
 * heading and ☢️. In the group it is deleted after `DELETE_AFTER_MS`, so that the group does not keep
 * stale counts; a private chat keeps it.
 */
import { type Answer } from '@megabottron1999/core';
import { ballsOf, type GameState } from '@regnotron/norelec/state/game-state.ts';

/** The price of a ☢️ (rules §5.2). */
export const NUKE = 1_000_000;

/** The least a player holds to be listed: 5% of a ☢️. */
export const LISTED_FROM = NUKE / 20;

/** How long an answer stays in the group before it is deleted. */
export const DELETE_AFTER_MS = 30_000;

export interface BallCount {
  total: number;
  /** The players with at least `LISTED_FROM`, richest first. */
  listed: { name: string; balls: number }[];
}

/** The balls the game state knows of, and the players who hold the most. */
export function countBalls(state: Pick<GameState, 'players'>): BallCount {
  let total = 0;
  const listed: BallCount['listed'] = [];
  for (const p of state.players.values()) {
    const balls = ballsOf(p);
    if (balls === undefined) continue;
    total += balls;
    if (balls >= LISTED_FROM) listed.push({ name: p.name, balls });
  }
  listed.sort((a, b) => b.balls - a.balls || a.name.localeCompare(b.name));
  return { total, listed };
}

/** A count as Italian writes it, with dots between the thousands: 736.920. */
export const italianNumber = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(?:\d{3})+$)/gu, '.');

/** A share of a ☢️, rounded to a whole percent, with its article: "il 74%", "l'8%", "lo 0%". */
export function shareOfNuke(balls: number): string {
  const pct = Math.round((balls / NUKE) * 100);
  const digits = String(pct);
  const article =
    pct === 0 ? 'lo ' : pct === 1 || pct === 11 || digits.startsWith('8') ? "l'" : 'il ';
  return `${article}${digits}%`;
}

/** The message, in Markdown: the list and `footer`, if any, each a paragraph of its own. */
export function formatWarning(count: BallCount, footer?: string): string {
  const paragraphs = [
    [
      '**AGGIORNAMENTO DELLA PROTEZIONE CIVILE**',
      `Ci sono ${italianNumber(count.total)} palle in circolazione.`,
      `È ${shareOfNuke(count.total)} di una ☢️**BOMBATOMICA**☢️`,
    ].join('\n'),
    count.listed.map((p) => `- ${p.name} detiene ${shareOfNuke(p.balls)} di una ☢️`).join('\n'),
    footer ?? '',
  ];
  return paragraphs.filter((p) => p !== '').join('\n\n');
}

/** The handler of `/nuclear_warning`: the count as the game state has it now, deleted from the group in 30 s. */
export function nuclearWarningCommand(
  state: Pick<GameState, 'players'>
): (answer: Answer) => Promise<void> {
  return (answer) =>
    answer.text(formatWarning(countBalls(state)), 'markdown', {
      deleteInGroupAfterMs: DELETE_AFTER_MS,
    });
}
