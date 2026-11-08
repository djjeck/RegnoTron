/**
 * Test helpers for graphs: the default graph's chat edges carry nothing a deployment chooses (a
 * channel, a group), so that a test gives each edge its chats, as the owner does in the editor.
 */
import { type Graph } from '@megabottron1999/core';

/** `graph` with the chat edge into `to` (`node.port`) reading and sending these chats too. */
export function withChats(
  graph: Graph,
  to: string,
  chats: { reads?: readonly string[]; sends?: readonly string[] }
): Graph {
  return {
    ...graph,
    edges: graph.edges.map((e) =>
      e.to !== to
        ? e
        : {
            ...e,
            reads: [...(e.reads ?? []), ...(chats.reads ?? [])],
            sends: [...(e.sends ?? []), ...(chats.sends ?? [])],
          }
    ),
  };
}
