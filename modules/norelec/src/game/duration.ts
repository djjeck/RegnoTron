/**
 * Durations as NorelecBot writes them: "58 secondi", "1 minuto e 40 secondi", "2 minuti",
 * "3 minuti e 22 secondi", "1 ora e 5 minuti", and since the ⚽'s leaderboard (9 Nov 2026) with days,
 * "1 giorno, 22 ore, 30 minuti e 42 secondi". The bot rounds down to the second.
 */
const UNIT = /(\d+)\s+(?:(giorn[oi])|(or[ae])|(minut[oi])|second[oi])/gu;

/** The number of seconds in a duration, or null if the text holds none. */
export function parseDuration(text: string): number | null {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(UNIT)) {
    total += Number(m[1]) * (m[2] ? 86_400 : m[3] ? 3600 : m[4] ? 60 : 1);
    found = true;
  }
  return found ? total : null;
}
