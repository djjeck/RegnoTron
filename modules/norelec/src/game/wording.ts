/**
 * NorelecBot's wording, written: the pieces its lines are built from, in the forms of
 * docs/bot-protocol.md. The writing half of the game's grammar, beside the reading half (the
 * templates of parse-line.ts, duration.ts, player.ts): library code that the parser and the arena's
 * engine share (P15), kept in step by wording.test.ts, which reads back what this writes.
 */

/** A duration as the bot writes it, rounded down to the second: "1 minuto e 30 secondi". */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const unit = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (h > 0) parts.push(unit(h, 'ora', 'ore'));
  if (m > 0) parts.push(unit(m, 'minuto', 'minuti'));
  if (s > 0 || parts.length === 0) parts.push(unit(s, 'secondo', 'secondi'));
  return parts.slice(0, 2).join(' e ');
}

/** "N palle", "1 palla". */
export const balls = (n: number): string => `${n} ${n === 1 ? 'palla' : 'palle'}`;

/** A player with the carried emoji in parentheses, `[]` for an empty slot before a full one. */
export function named(name: string, carried: readonly (string | null)[]): string {
  const last = carried.reduce((i, c, j) => (c === null ? i : j), -1);
  if (last < 0) return name;
  return `${name} (${carried
    .slice(0, last + 1)
    .map((c) => c ?? '[]')
    .join('')})`;
}

/** The price multiplier the bot shows, ×1.5 per copy: "x1.5", "x2.25", "x3.37". */
export const multiplier = (copies: number): string => `x${Math.floor(1.5 ** copies * 100) / 100}`;
