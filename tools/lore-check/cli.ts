/**
 * `npm run lore-check -- <export folder>… --owner "<display name>" --username <username>
 *  --bot "<the bot's display name>" [--since YYYY-MM-DD] [--time-zone Europe/Rome] [--names]`
 *
 * Reads Telegram Desktop exports (HTML or JSON; the private chat with @LoreGameBot and the group,
 * together, as one account sees them), replays them through the real `loregame` parser and
 * `loregame-state` node, and prints the checks (tools/lore-check/README.md). The players are
 * shown as P1, P2, … unless `--names`: the report can be shared, the exports stay local.
 */
import { type Inbound } from '@megabottron1999/core';
import { readExportPaths } from '@megabottron1999/telegram-export/files.ts';
import { toInbounds } from '@megabottron1999/telegram-export/inbound.ts';
import { CHECKS, report } from './checks.ts';
import { type ExportPhoto, exportPhotos } from './photos.ts';
import { chatNames, mergeRenamedChats, replayLore } from './run.ts';

export interface Args {
  paths: string[];
  owner: string[];
  username: string;
  bot: string;
  since?: number;
  timeZone: string;
  names: boolean;
}

export const USAGE =
  'usage: lore-check <export folder>… --owner "<display name>" --username <username> --bot "<bot display name>" [--since YYYY-MM-DD] [--time-zone <IANA>] [--names]';

/** The command line's arguments, or why they are not. */
export function parseArgs(argv: readonly string[]): Args | string {
  const a: Args = {
    paths: [],
    owner: [],
    username: '',
    bot: '',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    names: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    try {
      if (arg === '--owner') a.owner.push(value());
      else if (arg === '--username') a.username = value().replace(/^@/u, '');
      else if (arg === '--bot') a.bot = value();
      else if (arg === '--time-zone') a.timeZone = value();
      else if (arg === '--names') a.names = true;
      else if (arg === '--since') {
        const t = Date.parse(value());
        if (Number.isNaN(t)) return `--since: not a date`;
        a.since = t;
      } else if (arg.startsWith('--')) return `unknown option ${arg}`;
      else a.paths.push(arg);
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (a.paths.length === 0 || a.owner.length === 0 || a.username === '' || a.bot === '')
    return USAGE;
  return a;
}

/** Stand-ins for the players' names, in the order the report first shows them. */
export function standIns(): (player: string) => string {
  const given = new Map<string, string>();
  return (player) => {
    if (!given.has(player)) given.set(player, `P${given.size + 1}`);
    return given.get(player) as string;
  };
}

/**
 * The exports under the arguments' paths, as the replay takes them: the account's messages (each
 * player by their display name, the bot by its username, a renamed group one chat), and the photos
 * they hold, by the message they are of (photos.ts).
 */
export function readExports(a: Args): {
  inbounds: Inbound[];
  photos: Map<string, ExportPhoto>;
} {
  const { messages } = readExportPaths(a.paths, (line) => console.error(line), {
    timeZone: a.timeZone,
  });
  // Each player by their display name (the export has no usernames), the bot by its username.
  const senders: Record<string, string> = {};
  for (const m of messages) if (m.sender !== null) senders[m.sender] = m.sender;
  senders[a.bot] = 'LoreGameBot';
  const all = toInbounds(messages, {
    owner: { username: a.username, names: a.owner },
    // The private chat with the bot is titled with its name.
    chats: { [a.bot]: { chat: '@LoreGameBot', private: true } },
    senders,
  });
  // A group renamed between two exports is one chat, its messages once.
  const names = chatNames(all);
  const inbounds = mergeRenamedChats(all).filter((m) => a.since === undefined || m.time >= a.since);
  const photos = exportPhotos(a.paths, (title) => {
    const chat = title === a.bot ? '@LoreGameBot' : title;
    return names.get(chat) ?? chat;
  });
  return { inbounds, photos };
}

async function main(argv: readonly string[]): Promise<number> {
  const a = parseArgs(argv);
  if (typeof a === 'string') {
    console.error(a);
    return 2;
  }
  const { inbounds, photos } = readExports(a);
  console.error(`replaying ${inbounds.length} messages, ${photos.size} photos…`);
  const run = await replayLore(inbounds, {
    self: a.username,
    photos,
    ...(a.names ? {} : { name: standIns() }),
  });
  console.log(report(CHECKS.map((c) => c.run(run))));
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
