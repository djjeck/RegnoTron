/**
 * Test helpers for graphs: the default graph's chat edges carry nothing a deployment chooses (a
 * channel, a group), so that a test gives each edge its chats, as the owner does in the editor.
 */
import { type Graph } from '@megabottron1999/core';

/**
 * `graph` with the chat edges of `port` (`node.port`) carrying these chats too: its chat-in edge
 * (into it) reads `reads`, its chat-out edge (out of it) sends to `sends`, and is a dry run with
 * `dryRun` (MegaBotTron1999's bot-os.md D60, D64).
 */
export function withChats(
  graph: Graph,
  port: string,
  chats: { reads?: readonly string[]; sends?: readonly string[]; dryRun?: boolean }
): Graph {
  return {
    ...graph,
    edges: graph.edges.map((e) => {
      if (e.type === 'chat-in' && e.to === port) {
        const reads = e.reads === '*' ? '*' : [...(e.reads ?? []), ...(chats.reads ?? [])];
        return { ...e, reads };
      }
      if (e.type === 'chat-out' && e.from === port)
        return {
          ...e,
          sends: [...(e.sends ?? []), ...(chats.sends ?? [])],
          ...(chats.dryRun === undefined ? {} : { dryRun: chats.dryRun }),
        };
      return e;
    }),
  };
}
