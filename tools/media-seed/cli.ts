/**
 * `npm run media-seed -- <export folder>… --owner "<display name>" --username <username>
 *  --bot "<the bot's display name>" --out <media-seed.json> [--since YYYY-MM-DD] [--time-zone Europe/Rome]`
 *
 * Replays Telegram Desktop exports through the real `loregame` parser and `loregame-state` node, as
 * lore-check does, and writes the places' pictures the exports hold, and each place's requirements
 * as last told in them, as the seed `loregame-state` takes at its next start
 * (tools/media-seed/README.md). The seed holds the group's pictures and its chats' names: it stays
 * on your computer, and the instance's volume.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mediaSeedOf, requirementsSeedOf } from './seed.ts';

import { parseArgs, readExports } from '#tools/lore-check/cli.ts';
import { replayLore } from '#tools/lore-check/run.ts';

async function main(argv: readonly string[]): Promise<number> {
  const at = argv.indexOf('--out');
  const out = at < 0 ? undefined : argv[at + 1];
  const a = parseArgs(at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)]);
  if (typeof a === 'string' || out === undefined) {
    console.error(typeof a === 'string' ? a : 'media-seed needs --out <file.json>');
    return 2;
  }
  const { inbounds, photos } = readExports(a);
  console.error(`replaying ${inbounds.length} messages, ${photos.size} photos…`);
  const run = await replayLore(inbounds, { self: a.username, photos });
  const seed = {
    ...mediaSeedOf(
      run.steps.map((s) => s.event),
      photos,
      (file) => readFileSync(file)
    ),
    requirements: requirementsSeedOf(run.state),
  };
  writeFileSync(out, JSON.stringify(seed));
  const places = Object.values(seed.places);
  const entries = places.reduce((n, p) => n + p.media.length, 0);
  console.error(
    `${out}: ${places.length} places pictured, ${entries} pictures of them, ${Object.keys(seed.files).length} files`
  );
  for (const [code, q] of Object.entries(seed.requirements).sort(([a], [b]) => a.localeCompare(b)))
    console.error(
      `${code}: level ${q.level ?? '?'}, ${q.items.length} item(s), guardians [${q.guardians.join(' ')}], as of ${q.as_of}`
    );
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
