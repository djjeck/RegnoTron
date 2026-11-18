/**
 * A recorded chat replayed through the real `loregame` parser and `loregame-state` node
 * (MegaBotTron1999's telegram-export `replay`, bot-os.md D131): its messages fed in time order on
 * the dev kit's clock, every chat they come from read by the parser, from every sender (as the
 * group's edge must be for every player to be named). Out come the parser's events as steps, for
 * the checks (checks.ts).
 */
import { type BusEvent, type Inbound } from '@megabottron1999/core';
import { OWNER_ACCOUNT, replay } from '@megabottron1999/telegram-export/replay.ts';
import { loregamePlugin } from '@regnotron/game-bots/plugins/loregame.ts';
import { loregameStatePlugin } from '@regnotron/game-bots/plugins/loregame-state.ts';
import { type Run, stepsOf } from './checks.ts';

/** The parser's events the state applies, as the run recorded them. */
const PARSER = /^loregame\./u;

/**
 * Replays `inbounds` (the account's messages: the private chat with the bot and the group,
 * `toInbounds`) as the owner `self`, and gives the run the checks take.
 */
export async function replayLore(
  inbounds: readonly Inbound[],
  o: { self: string; name?: (player: string) => string }
): Promise<Run> {
  const chats = [...new Set(inbounds.map((m) => m.chat))];
  const run = await replay({
    plugins: [loregamePlugin, loregameStatePlugin],
    inbounds,
    self: o.self,
    print: () => undefined,
    graph: {
      version: 2,
      nodes: [
        {
          id: 'telegram-user',
          plugin: 'telegram-user',
          account: inbounds[0]?.account ?? OWNER_ACCOUNT,
        },
        { id: 'loregame', plugin: 'loregame' },
        { id: 'loregame-state', plugin: 'loregame-state' },
      ],
      edges: [
        // Every chat of the export, from every sender: the group's players are named so.
        { from: 'telegram-user.chat', to: 'loregame.chat', type: 'chat-in', reads: chats },
        { from: 'loregame.events', to: 'loregame-state.events', type: 'events' },
        { from: 'loregame.interface', to: 'loregame-state.parser', type: 'interface' },
      ],
    },
  });
  try {
    const events = run.records().filter((r) => PARSER.test(r.type)) as unknown as BusEvent[];
    const drift = run.drift().find((d) => d.parser === 'loregame');
    return {
      inbounds,
      steps: stepsOf(events),
      drift: { read: drift?.read ?? 0, unread: drift?.unread ?? 0 },
      name: o.name ?? ((p) => p),
    };
  } finally {
    await run.stop();
  }
}

/** How many messages two chats must share (same id, sender and text) to be one chat. */
const SAME_CHAT_AT = 10;

/**
 * The chats of `inbounds` as one where a group was renamed between two exports: a Telegram Desktop
 * export names a chat by its title when it was made, and gives no id, so the same group exported
 * before and after a rename is two chats, and the messages both exports hold would be replayed
 * twice. Two chats that share messages (the same id, sender and text, `SAME_CHAT_AT` at least) are
 * the same: the later title takes the earlier's name, and each message is kept once.
 */
export function mergeRenamedChats(inbounds: readonly Inbound[]): Inbound[] {
  const key = (m: Inbound): string => `${m.id ?? ''}\n${m.sender}\n${m.text}`;
  const byChat = new Map<string, Set<string>>();
  const first = new Map<string, number>();
  for (const m of inbounds) {
    if (m.id === undefined) continue;
    let keys = byChat.get(m.chat);
    if (keys === undefined) byChat.set(m.chat, (keys = new Set()));
    keys.add(key(m));
    if (!first.has(m.chat) || m.time < (first.get(m.chat) as number)) first.set(m.chat, m.time);
  }
  // Earliest first: each chat named as the earliest it shares its messages with.
  const chats = [...byChat.keys()].sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0));
  const name = new Map<string, string>();
  for (const [i, c] of chats.entries()) {
    const mine = byChat.get(c) as Set<string>;
    const same = chats.slice(0, i).find((earlier) => {
      let shared = 0;
      for (const k of byChat.get(earlier) as Set<string>)
        if (mine.has(k) && ++shared >= SAME_CHAT_AT) return true;
      return false;
    });
    name.set(c, same === undefined ? c : (name.get(same) ?? same));
  }
  const seen = new Set<string>();
  const out: Inbound[] = [];
  for (const m of inbounds) {
    const chat = name.get(m.chat) ?? m.chat;
    if (m.id !== undefined) {
      const id = `${chat}\n${m.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(chat === m.chat ? m : { ...m, chat });
  }
  return out;
}
