/**
 * `npm run sightings-seed -- <export folder>… --owner "<display name>" --username <username>
 *  --bot "<the bot's display name>" --out <sightings-seed.json> --since YYYY-MM-DD [--time-zone Europe/Rome]`
 *
 * Replays Telegram Desktop exports through the real `loregame` parser and `loregame-state` node, as
 * lore-check does, and writes each player's ladder steps seen in them, first and last, by their
 * Telegram id: the seed `loregame-state` takes at its next start (tools/sightings-seed/README.md).
 * It names players: it stays on your computer, and the instance's volume.
 */
import { writeFileSync } from 'node:fs';
import { sightingsSeedOf } from './seed.ts';

import { parseArgs, readExports } from '#tools/lore-check/cli.ts';
import { replayLore } from '#tools/lore-check/run.ts';

async function main(argv: readonly string[]): Promise<number> {
  const at = argv.indexOf('--out');
  const out = at < 0 ? undefined : argv[at + 1];
  const a = parseArgs(at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)]);
  if (typeof a === 'string' || out === undefined) {
    console.error(typeof a === 'string' ? a : 'sightings-seed needs --out <file.json>');
    return 2;
  }
  const { inbounds } = readExports(a);
  console.error(`replaying ${inbounds.length} messages…`);
  const run = await replayLore(inbounds, { self: a.username });
  const { seed, read, unmatched } = sightingsSeedOf(
    run.steps.map((s) => s.event),
    inbounds,
    a.since
  );
  writeFileSync(out, JSON.stringify(seed));
  const players = Object.entries(seed.players);
  const steps = players.flatMap(([, p]) => Object.values(p.steps));
  const firsts = steps.map((s) => s.first).sort();
  const lasts = steps.map((s) => s.last).sort();
  console.error(
    `${out}: ${read} sighting(s), ${unmatched} tied to no id; ${players.length} player(s), ${steps.length} step(s) seen, from ${firsts[0] ?? '-'} to ${lasts.at(-1) ?? '-'}; the owner ${seed.owner === null ? 'unknown' : 'known'}`
  );
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
