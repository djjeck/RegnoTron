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
