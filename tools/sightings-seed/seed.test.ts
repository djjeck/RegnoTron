import { type BusEvent, type Inbound } from '@megabottron1999/core';
import {
  PLAYER_TURN_EVENT,
  PROFILE_EVENT,
  TRAVEL_EVENT,
} from '@regnotron/game-bots/plugins/loregame.ts';
import { describe, expect, it } from 'vitest';
import { sightingsSeedOf } from './seed.ts';

// Invented players and places; the ids are made up.
const T = Date.parse('2026-09-01T10:00:00Z');
const MIN = 60_000;
const GROUP = 'Il Gruppo';
const msg = (id: string, senderUsername: string, senderId: string, m: Partial<Inbound> = {}) =>
  ({
    account: 'telegram:alice',
    network: 'telegram',
    chat: GROUP,
    id,
    senderUsername,
    senderId,
    text: '',
    time: T,
    playback: false,
    ...m,
  }) as Inbound;
const turn = (message: string, code: string, min: number, owner = false) =>
  ({
    type: PLAYER_TURN_EVENT,
    t: T + min * MIN,
    chat: GROUP,
    playerName: 'x',
    playerId: null,
    owner,
    outcome: { kind: 'nothing', bot: 'LoreGameBot', reason: 'lost', place: { name: 'P', code } },
    message,
    answer: null,
  }) as unknown as BusEvent;

describe("the players' sightings seed", () => {
  it('ties each sighting to the id of the message that tells whose it is', () => {
    const inbounds = [
      msg('1', 'Bob Rossi', '2000'),
      msg('2', 'Carla', '3000'),
      msg('3', 'LoreGameBot', '9000', { replyTo: '2' }),
      msg('4', 'Alice', '1000', { own: true }),
    ];
    const events = [
      turn('1', 'B1', 0),
      turn('1', 'B2', 10),
      turn('1', 'B1', 20),
      turn('1', 'X', 25),
      // Carla's arrival: the bot's answer (#3) replies to her command (#2).
      {
        type: TRAVEL_EVENT,
        t: T + 30 * MIN,
        chat: GROUP,
        kind: 'arrived',
        place: { name: 'Q', code: 'M3' },
        answer: '3',
      } as unknown as BusEvent,
      // A refusal, and another's profile: not tied, or no sighting.
      {
        type: TRAVEL_EVENT,
        t: T + 31 * MIN,
        chat: GROUP,
        kind: 'refused',
        place: { name: 'R', code: 'M9' },
        answer: '3',
      } as unknown as BusEvent,
      {
        type: PROFILE_EVENT,
        t: T + 32 * MIN,
        chat: GROUP,
        owner: false,
        location: { name: 'S', code: 'B7' },
      } as unknown as BusEvent,
      // The owner's, by their own id; one before the season left out.
      turn('4', 'N1', 40, true),
      turn('1', 'B9', -60),
      // A turn whose command the exports do not hold.
      turn('99', 'B4', 50),
    ];
    const { seed, read, unmatched } = sightingsSeedOf(events, inbounds, T);
    expect(read).toBe(7);
    expect(unmatched).toBe(2);
    expect(seed).toEqual({
      owner: '1000',
      players: {
        '2000': {
          name: 'Bob Rossi',
          steps: {
            B1: { first: '2026-09-01T10:00:00.000Z', last: '2026-09-01T10:20:00.000Z' },
            B2: { first: '2026-09-01T10:10:00.000Z', last: '2026-09-01T10:10:00.000Z' },
          },
        },
        '3000': {
          name: 'Carla',
          steps: { M3: { first: '2026-09-01T10:30:00.000Z', last: '2026-09-01T10:30:00.000Z' } },
        },
        '1000': {
          name: null,
          steps: { N1: { first: '2026-09-01T10:40:00.000Z', last: '2026-09-01T10:40:00.000Z' } },
        },
      },
    });
  });
});
