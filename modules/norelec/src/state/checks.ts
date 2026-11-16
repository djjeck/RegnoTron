/**
 * What the record (record.ts) and the game disagree on, told to the owner by the `norelec-state`
 * plugin (modules/norelec/src/plugins/norelec-state.ts) as `missed` and `disagreed`.
 *
 * - **Missed:** a change the record expected (a birth 9 h after a 💦, a baby's departure 96 h
 *   after its birth, a trip's return), whose line never came within the margin, and which the
 *   record applied all the same (`settleDue`). Told for the owner's account only, and a trip's
 *   return only when its arrival was seen: one never seen arriving may be a dream, whose line
 *   comes late (docs/game-rules.md §2.6), not a line lost.
 * - **Disagreed:** a listing, which is the truth and is taken as it is, that contradicts what the
 *   record held: the owner's `/house` (a slot that holds something else: a raid, a purchase, a
 *   birth whose line was lost; a baby grown a stage, or one whose departure is due, is no
 *   contradiction), the owner's `/profile` where it says another place than the record's trip
 *   (a departure or a return lost; a trip not seen arriving is left alone, for the dream it may
 *   be), and the ⚽'s holder a leaderboard names (a theft from the holder lost), for anyone.
 *
 * Left out, as expected to drift in silence: balances (the 🐔 pay a ball a minute unannounced,
 * hens.ts) and the carried emoji, which the record keeps as last listed, never through each
 * change; other players' houses and profiles, whose /take, /store and /move may be made in a
 * private chat with the bot that nobody else reads.
 */
import { type BusEvent } from '@megabottron1999/core';
import { emojiKind } from '#src/game/player.ts';
import {
  type GameRecord,
  isPerson,
  leavesOf,
  type Missed,
  type RecordOptions,
  settleDue,
} from './record.ts';

/** A `missed` announcement's payload. */
export interface MissedNews {
  what: Missed['what'];
  player: string;
  /** When it was due (ms). */
  due: number;
  slot?: number;
  detail: string;
}

/** A `disagreed` announcement's payload: what the record held, and what the listing showed. */
export interface Disagreement {
  what: 'house' | 'trip' | 'ball';
  player?: string;
  before: string;
  after: string;
  detail: string;
}

/** A time, for the owner: UTC, to the minute. */
export const when = (t: number): string =>
  `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The record as it was just before `event`: `before`, with what fell due settled. */
export function settled(
  before: GameRecord,
  t: number,
  options: RecordOptions = {}
): { state: GameRecord; missed: Missed[] } {
  const state = structuredClone(before);
  return { state, missed: settleDue(state, t, options) };
}

/** What the owner should hear of the changes `settleDue` applied without their line. */
export function missedNews(missed: readonly Missed[], self: string): MissedNews[] {
  return missed.flatMap((m): MissedNews[] => {
    if (m.player !== self) return [];
    const n = 'slot' in m ? m.slot : undefined;
    const slot = n === undefined ? {} : { slot: n };
    const where = n === undefined ? '' : ` in slot ${n}`;
    switch (m.what) {
      case 'born':
        return [
          {
            what: m.what,
            player: m.player,
            due: m.due,
            ...slot,
            detail: `no birth line came for ${m.father}'s 💦: a baby was due in ${m.player}'s house at ${when(m.due)}, taken as born${where}`,
          },
        ];
      case 'babyGone':
        return [
          {
            what: m.what,
            player: m.player,
            due: m.due,
            ...slot,
            detail: `no departure line came: the ${m.emoji}${where} of ${m.player}'s house was due to leave ${m.exact ? 'at' : 'by'} ${when(m.due)}, taken as gone and its slot freed`,
          },
        ];
      case 'returnHome':
        if (!m.arrived) return [];
        return [
          {
            what: m.what,
            player: m.player,
            due: m.due,
            detail: `no return line came: ${m.player}'s trip to ${m.to} was due home at ${when(m.due)}, taken as home`,
          },
        ];
    }
  });
}

const nameOf = (v: unknown): string | undefined =>
  typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string'
    ? (v as { name: string }).name
    : undefined;

const shown = (c: string | null | undefined): string => c ?? '·';

/**
 * What a listing in `event` contradicts of the record as it stood (`was`, settled to the event's
 * time), for the owner's account (`self`) and the ⚽'s holder.
 */
export function disagreements(
  was: GameRecord,
  event: BusEvent,
  self: string | null
): Disagreement[] {
  const kind = event.type.slice(event.type.indexOf('.') + 1);
  const player = nameOf(event['player']);
  const out: Disagreement[] = [];
  if (kind === 'ballHolder' && player !== undefined) {
    const holder = was.ball.holder?.name;
    if (holder !== undefined && holder !== player)
      out.push({
        what: 'ball',
        before: holder,
        after: player,
        detail: `the ⚽ is with ${player}, not with ${holder} as the record had it: a theft from the holder was never read`,
      });
  }
  if (self === null || player !== self) return out;
  if (kind === 'house') {
    const house = was.players[self]?.house;
    const now = event['slots'];
    if (house !== undefined && Array.isArray(now)) {
      const t = event.t;
      const diffs = (now as (string | null)[]).flatMap((c, i) => {
        const had = house.slots[i] ?? null;
        if (had === c) return [];
        if (had !== null && c !== null && emojiKind(had) === emojiKind(c)) return [];
        // A baby grown a stage is the same baby.
        if (isPerson(had) && isPerson(c)) return [];
        // A baby whose time is up may be gone before its line.
        if (isPerson(had) && c === null) {
          const baby = was.babies.find(
            (b) => b.player === self && b.gone === undefined && b.slot === i + 1
          );
          const leaves = baby === undefined ? undefined : leavesOf(baby);
          if (baby?.born !== undefined && leaves !== undefined && t >= leaves) return [];
        }
        return [{ slot: i + 1, had, c }];
      });
      if (diffs.length > 0) {
        const before = diffs.map((d) => `${d.slot} ${shown(d.had)}`).join(', ');
        const after = diffs.map((d) => `${d.slot} ${shown(d.c)}`).join(', ');
        const each = diffs.map((d) => `slot ${d.slot} ${shown(d.had)} → ${shown(d.c)}`).join(', ');
        out.push({
          what: 'house',
          player: self,
          before,
          after,
          detail: `${self}'s /house differs from the record: ${each} (a line never read: a raid, a purchase, a birth, a departure)`,
        });
      }
    }
  }
  if (kind === 'profile' && was.players[self] !== undefined) {
    const at = event['at'] as { kind: string; to?: string } | undefined;
    const trip = was.players[self]?.trip;
    if (at !== undefined) {
      const after = at.kind === 'home' ? 'home' : `on a trip to ${String(at.to)}`;
      const before = trip === undefined ? 'home' : `on a trip to ${trip.to}`;
      // A trip not seen arriving, and now home, may be a dream whose line is still to come.
      const dream = trip !== undefined && trip.arrivedAt === undefined && at.kind === 'home';
      if (after !== before && !dream)
        out.push({
          what: 'trip',
          player: self,
          before,
          after,
          detail: `${self}'s /profile says ${after}, the record had ${before}: a ${trip === undefined ? 'departure' : 'line of the trip'} was never read`,
        });
    }
  }
  return out;
}
