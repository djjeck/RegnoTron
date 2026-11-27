/**
 * The players' sightings in Telegram Desktop exports (#19, docs/game-bots.md §6.1), as the
 * `loregame-state` node takes them: each ladder step a player was seen at, first and last, by their
 * Telegram id. Pure: the replayed parser's events and the messages they came from.
 *
 * An export gives each sender's id and display name, never a username, and the replay names a
 * player by their display name (tools/lore-check/README.md): so a sighting is a player's by the
 * message that tells whose it is, the id of its sender. A turn is the sender's of the turn command
 * it replies to (`message`), an arrival's or a `/v`'s the sender's of the command the bot's answer
 * (`answer`) replies to, a profile the owner's alone (one of another names a username, which the
 * export does not tie to an id). A sighting no message ties to an id is left out.
 */
import { type BusEvent, type Inbound } from '@megabottron1999/core';
import { sightingOf, stepOf } from '@regnotron/game-bots/loregame-state.ts';
import {
  PLAYER_TURN_EVENT,
  PROFILE_EVENT,
  TRAVEL_EVENT,
} from '@regnotron/game-bots/plugins/loregame.ts';

/** A seed, as `loregame-state` takes it (`sightings-seed.json`, its `sightingsSeedSchema`). */
export interface SightingsSeed {
  /** The owner's id, as their own messages give it; none if no message of theirs has one. */
  owner: string | null;
  players: Record<
    string,
    { name: string | null; steps: Record<string, { first: string; last: string }> }
  >;
}

/**
 * The seed of `events` (the replay's), from `inbounds` (its messages), at or after `since` (ms);
 * with how many sightings it read, and how many no message tied to an id.
 */
export function sightingsSeedOf(
  events: readonly BusEvent[],
  inbounds: readonly Inbound[],
  since?: number
): { seed: SightingsSeed; read: number; unmatched: number } {
  let read = 0;
  let unmatched = 0;
  const byId = new Map(
    inbounds.flatMap((m) => (m.id === undefined ? [] : [[`${m.chat}\n${m.id}`, m]]))
  );
  const owner = inbounds.find((m) => m.own === true && m.senderId !== undefined)?.senderId ?? null;
  const players: SightingsSeed['players'] = {};
  /** The sender of message `id` of `chat`, or of the one it replies to (`up`). */
  const senderOf = (chat: string, id: unknown, up: boolean): Inbound | undefined => {
    if (typeof id !== 'string') return undefined;
    const m = byId.get(`${chat}\n${id}`);
    if (!up) return m;
    return m?.replyTo === undefined ? undefined : byId.get(`${chat}\n${m.replyTo}`);
  };
  for (const e of events) {
    if (since !== undefined && e.t < since) continue;
    const code = sightingOf(e);
    if (code === undefined || stepOf(code) === undefined) continue;
    const chat = String(e['chat']);
    const who =
      e.type === PLAYER_TURN_EVENT
        ? senderOf(chat, e['message'], false)
        : e.type === TRAVEL_EVENT
          ? senderOf(chat, e['answer'], true)
          : undefined;
    const mine = e['owner'] === true || who?.own === true;
    const id = mine ? owner : e.type === PROFILE_EVENT ? null : (who?.senderId ?? null);
    read += 1;
    if (id === null) {
      unmatched += 1;
      continue;
    }
    const at = new Date(e.t).toISOString();
    const p = (players[id] ??= {
      name: mine ? null : (who?.senderUsername ?? null),
      steps: {},
    });
    const was = p.steps[code];
    p.steps[code] =
      was === undefined
        ? { first: at, last: at }
        : { first: at < was.first ? at : was.first, last: at > was.last ? at : was.last };
  }
  return { seed: { owner, players }, read, unmatched };
}
