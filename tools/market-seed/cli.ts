/**
 * `npm run market-seed -- <export folder>… --owner "<display name>" --username <username>
 *  --bot "<the bot's display name>" --out <file.json> [--since YYYY-MM-DD] [--time-zone Europe/Rome]`
 *
 * Replays Telegram Desktop exports through the real `loregame` parser and `loregame-state` node, as
 * lore-check does, and writes the market's history the state then holds as the seed of its
 * migration to 0.35.0 (tools/market-seed/README.md). The seed names players: it stays on your
 * computer, and the instance's volume.
 */
import { readExportPaths } from '@megabottron1999/telegram-export/files.ts';
import { toInbounds } from '@megabottron1999/telegram-export/inbound.ts';
import { type LoreState } from '@regnotron/game-bots/loregame-state.ts';
import { writeFileSync } from 'node:fs';
import { seedOf, usernames } from './seed.ts';

import { parseArgs } from '#tools/lore-check/cli.ts';
import { mergeRenamedChats, replayLore } from '#tools/lore-check/run.ts';

async function main(argv: readonly string[]): Promise<number> {
  const at = argv.indexOf('--out');
  const out = at < 0 ? undefined : argv[at + 1];
  const a = parseArgs(at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)]);
  if (typeof a === 'string' || out === undefined) {
    console.error(typeof a === 'string' ? a : 'market-seed needs --out <file.json>');
    return 2;
  }
  const { messages } = readExportPaths(a.paths, (line) => console.error(line), {
    timeZone: a.timeZone,
  });
  const senders: Record<string, string> = {};
  for (const m of messages) if (m.sender !== null) senders[m.sender] = m.sender;
  senders[a.bot] = 'LoreGameBot';
  const inbounds = mergeRenamedChats(
    toInbounds(messages, {
      owner: { username: a.username, names: a.owner },
      chats: { [a.bot]: { chat: '@LoreGameBot', private: true } },
      senders,
    })
  ).filter((m) => a.since === undefined || m.time >= a.since);
  console.error(`replaying ${inbounds.length} messages…`);
  const run = await replayLore(inbounds, { self: a.username });
  const seed = seedOf(run.state as LoreState, usernames(inbounds, 'LoreGameBot'));
  writeFileSync(out, JSON.stringify(seed));
  const points = Object.values(seed.market.series).reduce((n, s) => n + s.length, 0);
  console.error(
    `${out}: ${Object.keys(seed.market.series).length} companies, ${points} points, ${seed.market.schedule.missed.length} updates missed, ${Object.keys(seed.companies).length} pages, ${Object.keys(seed.players).length} players investing`
  );
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
