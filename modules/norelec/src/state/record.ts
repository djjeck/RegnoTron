/**
 * The game's record, as the `norelec-state` plugin keeps it (modules/norelec/src/plugins/norelec-state.ts)
 * from the `norelec` parser's per-kind events (`norelec.<kind>`): per player their house (with the
 * babies' locked slots), their trip, their balls as /profile last said and whether the game banned
 * them; the ⚽, its holder and the time each player held it; every baby seen, with the stages it
 * was seen in and when it went; the trip times measured; the prices the bot asked. Pure: a state
 * and an event in, the next state out, never changing its arguments, so that the shell's state
 * plugin keeps it, resumes it from the event log and announces what changed (MegaBotTron1999's
 * bot-os.md D72, D83).
 *
 * It also times what the game does on its own (`settleDue`): a 💦 delivered gives a baby 9 hours
 * later (`BIRTH_AFTER_MS`), a baby leaves 96 hours after its birth (`BABY_LIFE_MS`), a trip ends at
 * its return. A line the bot says for each of them may be lost (Telegram, IRC) while the game
 * applies the change all the same: once one is overdue by a margin (`missedAfterMs`), at the first
 * event after it, the record applies it anyway, as the game did, and says so (`Missed`).
 *
 * The rules behind it are in docs/game-rules.md: the ⚽ §3, babies and locks §5.3, trips §2.
 */
import { z } from 'zod';
import { type EventFields, type EventOf, type GameEvent } from '#src/game/events.ts';
import { emojiKind, type PlayerRef } from '#src/game/player.ts';

/** The seven stages of a 💦's baby, one locked "person" in a house slot. */
export const PEOPLE = ['👶', '👦', '👧', '👨', '👩', '👴', '👵'];

/** Whether an emoji is a baby, at any stage of its life (skin tones aside). */
export const isPerson = (emoji: string | null | undefined): boolean =>
  emoji != null && PEOPLE.includes(emojiKind(emoji));

/** A person's stage of life, by its emoji: 👶 0, 👦 👧 1, 👨 👩 2, 👴 👵 3 (one stage a day). */
const STAGE: Record<string, number> = {
  '👶': 0,
  '👦': 1,
  '👧': 1,
  '👨': 2,
  '👩': 2,
  '👴': 3,
  '👵': 3,
};

const SECOND = 1000;
const HOUR = 3600 * SECOND;
const DAY = 24 * HOUR;

/**
 * A baby's life: it leaves its slot 96 hours after its birth line. Measured on 13 babies (Nov
 * 2026), each `ha vissuto la sua vita` line 96 h and 1 to 5 seconds after its birth's.
 */
export const BABY_LIFE_MS = 96 * HOUR;

/** A 💦 delivered at a home gives its baby 9 hours later (`tra 9 ore si vedrà`), measured exact. */
export const BIRTH_AFTER_MS = 9 * HOUR;

/** How long past its time a change the record expects waits for its line, by default. */
export const MISSED_AFTER_MS = 10 * 60 * SECOND;

/** The record's options: how long an expected change waits for its line before it is applied. */
export interface RecordOptions {
  missedAfterMs?: number;
}

/** A slot list: an emoji, or null when empty. */
const slots = z.array(z.string().nullable());

const tripSchema = z.object({
  from: z.string().describe('Whose home it left'),
  to: z.string().describe('Whose home it goes to'),
  start: z.number().describe('When it left (ms), when seen'),
  arriveAt: z.number().optional().describe('When it arrives there (ms)'),
  arrivedAt: z.number().optional().describe('When it arrived (ms)'),
  returnAt: z.number().optional().describe('When it is due home again (ms)'),
  rockets: z.number().describe('The 🚀 carried, each 10% faster'),
  load: z.string().optional().describe('What it carries, to throw'),
});
export type Trip = z.infer<typeof tripSchema>;

const playerSchema = z.object({
  house: z
    .object({ slots, at: z.number() })
    .optional()
    .describe('The house: its slots as last shown or changed since, empty ones null'),
  carried: slots.optional().describe('The carried emoji, as last listed'),
  trip: tripSchema.optional().describe('The trip under way'),
  balls: z
    .object({ n: z.number(), rank: z.number(), at: z.number() })
    .optional()
    .describe('The balls and rank /profile last gave'),
  banned: z.number().optional().describe('Since when the game bans them (a COGLIONE)'),
  expecting: z
    .array(z.object({ father: z.string(), at: z.number() }))
    .optional()
    .describe('Each 💦 delivered to the house (`at`), its baby due 9 hours after'),
});
export type PlayerRecord = z.infer<typeof playerSchema>;

const babySchema = z.object({
  player: z.string().describe('Whose house it is in'),
  slot: z.number().optional().describe('Its slot, 1 to 10, once known'),
  born: z.number().optional().describe('When it was born, when the birth was seen'),
  father: z.string().optional().describe('Who threw the 💦'),
  replaced: z.string().optional().describe('What it took the place of'),
  stages: z
    .array(z.object({ emoji: z.string(), at: z.number() }))
    .describe('Each stage it was seen in, with when first seen'),
  lastSeen: z.number().describe('When last seen in its slot'),
  gone: z.number().optional().describe('When it was first seen gone'),
  leaves: z
    .number()
    .optional()
    .describe('When it is due to leave: 96 h after its birth, or at the latest, from its stages'),
  unseen: z
    .array(z.enum(['born', 'gone']))
    .optional()
    .describe('Its lines never read, birth or departure, applied when they were overdue'),
});
export type Baby = z.infer<typeof babySchema>;

export const recordSchema = z.object({
  self: z.string().nullable().describe("The owner's game account"),
  players: z.record(z.string(), playerSchema).describe('Each player as last seen'),
  ball: z
    .object({
      holder: z
        .object({ name: z.string(), since: z.number() })
        .optional()
        .describe('Who holds the ⚽, and since when'),
      held: z
        .record(z.string(), z.number())
        .describe('The seconds each player held it, the holder’s current hold left out'),
      readAt: z.number().optional().describe('When /leaderboard was last read'),
      counted: z
        .object({ name: z.string(), t: z.number() })
        .optional()
        .describe('A holder row read whole, the hold under way in it, until its holder line'),
    })
    .describe('The ⚽'),
  babies: z.array(babySchema).describe('Every baby seen, alive or gone'),
  legs: z
    .record(z.string(), z.number())
    .describe('The base one-way trip time measured between two homes, in seconds (A|B)'),
  prices: z
    .record(z.string(), z.object({ balls: z.number(), at: z.number() }))
    .describe('The price of each emoji (and `quote`) as the bot last stated it'),
  disabled: z
    .record(z.string(), z.number())
    .describe('The commands the game said are disabled, and when it last did'),
});
export type GameRecord = z.infer<typeof recordSchema>;

export const initialRecord = (): GameRecord => ({
  self: null,
  players: {},
  ball: { held: {} },
  babies: [],
  legs: {},
  prices: {},
  disabled: {},
});

/** An event of the parser, as the bus delivers it. */
export interface KindEvent {
  type: string;
  t: number;
  [field: string]: unknown;
}

/** The key of the leg between two homes, the same both ways (map times are symmetric). */
export const legKey = (a: string, b: string): string => [a, b].sort().join('|');

/** The 🚀 in a carried list. */
const rocketsIn = (carried: readonly (string | null)[] | undefined): number =>
  (carried ?? []).filter((c) => c !== null && emojiKind(c) === '🚀').length;

/** A one-way trip's time: the base time, 10% faster per 🚀 carried, floored (rules §2.3). */
export const legSeconds = (base: number, rockets: number): number =>
  Math.floor(base / (1 + 0.1 * rockets));

/** The bus event of one of the parser's events: its fields, as `norelec` publishes them. */
const asGameEvent = (event: KindEvent): GameEvent => event as unknown as GameEvent;

/**
 * The next record, from a record and one of the parser's events: what fell due before it, and
 * whose line never came, is applied first (`settleDue`).
 */
export function reduceRecord(
  state: GameRecord,
  event: KindEvent,
  options: RecordOptions = {}
): GameRecord {
  const s = structuredClone(state);
  const t = event.t;
  settleDue(s, t, options);
  const self = event['self'];
  if (typeof self === 'string') s.self = self.replace(/^@/u, '');
  const e = asGameEvent(event);
  // The carried emoji listed next to any name.
  for (const v of Object.values(e))
    if (typeof v === 'object' && v !== null && 'carried' in v && 'name' in v) {
      const r = v as PlayerRef;
      if (r.carried !== undefined) player(s, r.name).carried = r.carried;
    }
  switch (e.kind) {
    case 'depart': {
      const me = player(s, e.player.name);
      const rockets = rocketsIn(e.player.carried ?? me.carried);
      const trip: Trip = {
        from: e.player.name,
        to: e.to.name,
        start: t,
        arriveAt: t + e.seconds * SECOND,
        rockets,
      };
      if (e.load !== undefined) trip.load = e.load;
      me.trip = trip;
      s.legs[legKey(e.player.name, e.to.name)] = Math.round(e.seconds * (1 + 0.1 * rockets));
      delete me.banned;
      break;
    }
    case 'bombAtHome':
      if (e.destroyed !== undefined) replaceInHouse(s, e.victim.name, e.destroyed, null, t);
      arrived(s, e.player.name, t, e.seconds);
      break;
    case 'theft':
    case 'balloonHeld':
    case 'dog':
    case 'bombDefective':
    case 'throwUndelivered':
      arrived(s, e.player.name, t, e.seconds);
      break;
    case 'throwDelivered':
      if (emojiKind(e.emoji) === '💦')
        (player(s, e.to.name).expecting ??= []).push({ father: e.player.name, at: t });
      arrived(s, e.player.name, t, undefined);
      break;
    case 'freezeDelivered':
      arrived(s, e.player.name, t, undefined);
      break;
    case 'bounced':
      if (e.seconds !== undefined) arrived(s, e.thrower.name, t, e.seconds);
      break;
    case 'turnBack': {
      const trip = s.players[e.player.name]?.trip;
      if (trip !== undefined) {
        trip.arrivedAt = t;
        trip.returnAt = t + e.seconds * SECOND;
      }
      break;
    }
    case 'returnHome':
    case 'lostAtFork':
    case 'dreamDepart':
      delete player(s, e.player.name).trip;
      break;
    case 'profile': {
      const me = player(s, e.player.name);
      me.balls = { n: e.balls, rank: e.rank, at: t };
      if (e.carried !== undefined) me.carried = e.carried;
      if (e.at !== undefined) profileAt(s, e.player.name, e.at, t);
      break;
    }
    case 'house':
      setHouse(s, e.player.name, e.slots, t);
      break;
    case 'rearranged':
      setHouse(s, e.player.name, [...e.slots, ...Array<null>(10).fill(null)].slice(0, 10), t);
      break;
    case 'bought': {
      s.prices[e.emoji] = { balls: e.balls, at: t };
      const house = s.players[e.player.name]?.house;
      if (e.slot !== undefined && house !== undefined && e.slot <= house.slots.length) {
        house.slots[e.slot - 1] = e.emoji;
        house.at = t;
      }
      break;
    }
    case 'tooPoor':
      s.prices[e.emoji] = { balls: e.price, at: t };
      break;
    case 'quoteAdded':
      s.prices['quote'] = { balls: e.balls, at: t };
      break;
    case 'refused': {
      const quote = /^ti servono (\d+) palle per aggiungere una citazione/u.exec(e.reason);
      if (quote !== null) s.prices['quote'] = { balls: Number(quote[1]), at: t };
      break;
    }
    case 'moved':
      // `/take` empties the emoji's slot or fills it with the one it swaps; `/store` the first free.
      if (e.carried) replaceInHouse(s, e.player.name, e.emoji, e.swapped ?? null, t);
      else replaceInHouse(s, e.player.name, null, e.emoji, t);
      break;
    case 'pirate':
      // A 🏴‍☠️'s plunder: out of the robbed house, onto the raider.
      if (e.victim !== undefined) replaceInHouse(s, e.victim.name, e.emoji, null, t);
      if (e.player !== undefined && e.carried !== undefined)
        player(s, e.player.name).carried = e.carried;
      break;
    case 'slotLocked': {
      const house = s.players[e.player.name]?.house;
      if (house === undefined) break;
      const slotsNow = [...house.slots];
      slotsNow[e.slot - 1] = e.emoji;
      setHouse(s, e.player.name, slotsNow, t);
      break;
    }
    case 'born':
      born(s, e, t);
      break;
    case 'babyGone': {
      const name = e.player.name;
      const baby = leaving(s, name, e.emoji, t);
      if (baby === undefined) break;
      baby.gone = t;
      freeSlot(s, baby, t);
      break;
    }
    case 'banned':
      if (e.player !== undefined) player(s, e.player.name).banned ??= t;
      break;
    case 'disabled':
      s.disabled[e.what.replace(/^!/u, '/')] = t;
      break;
    case 'ballTaken':
      if (e.player !== undefined) moveBall(s, e.player.name, t);
      break;
    case 'ballRow': {
      const name = e.player.name;
      const holder = s.ball.holder;
      // The holder's row counts the hold under way: kept apart, as it grows. Of a holder the
      // record does not know yet, the holder line that follows tells how much of it is under way.
      if (e.holding && holder?.name === name)
        s.ball.held[name] = Math.max(0, e.seconds - Math.floor((t - holder.since) / SECOND));
      else {
        s.ball.held[name] = e.seconds;
        if (e.holding) s.ball.counted = { name, t };
      }
      s.ball.readAt = t;
      break;
    }
    case 'ballHolder': {
      const name = e.player.name;
      const since = t - e.seconds * SECOND;
      const holder = s.ball.holder;
      const held = s.ball.held;
      // Re-anchored by the bot's own count: a transfer missed is settled here, not announced.
      if (s.ball.counted?.name === name && s.ball.counted.t === t)
        held[name] = Math.max(0, (held[name] ?? 0) - e.seconds);
      else if (holder?.name === name)
        held[name] = Math.max(0, (held[name] ?? 0) + Math.floor((since - holder.since) / SECOND));
      if (holder !== undefined && holder.name !== name)
        held[holder.name] =
          (held[holder.name] ?? 0) + Math.max(0, Math.floor((since - holder.since) / SECOND));
      s.ball.holder = { name, since };
      delete s.ball.counted;
      s.ball.readAt = t;
      break;
    }
    default:
      break;
  }
  return s;
}

function player(s: GameRecord, name: string): PlayerRecord {
  const p = (s.players[name] ??= {});
  return p;
}

/** A trip's arrival; its return leg takes `seconds` when the line says. */
function arrived(s: GameRecord, name: string, t: number, seconds: number | undefined): void {
  const p = player(s, name);
  const trip = p.trip;
  if (trip === undefined) return;
  trip.arrivedAt = t;
  if (seconds !== undefined) trip.returnAt = t + seconds * SECOND;
  else {
    const base = s.legs[legKey(trip.from, trip.to)];
    if (base !== undefined) trip.returnAt = t + legSeconds(base, trip.rockets) * SECOND;
  }
}

/** Where /profile says the player is: home, or on a trip it may not have seen leave. */
function profileAt(
  s: GameRecord,
  name: string,
  at: NonNullable<EventFields['profile']['at']>,
  t: number
): void {
  const p = player(s, name);
  if (at.kind === 'home') {
    delete p.trip;
    return;
  }
  const rockets = rocketsIn(p.carried);
  const trip: Trip = p.trip?.to === at.to ? p.trip : { from: name, to: at.to, start: t, rockets };
  if (at.kind === 'returning') {
    trip.arrivedAt ??= t;
    trip.returnAt = t + at.seconds * SECOND;
  } else {
    trip.arriveAt = t + at.seconds * SECOND;
    const base = s.legs[legKey(name, at.to)];
    if (base !== undefined) trip.returnAt = trip.arriveAt + legSeconds(base, rockets) * SECOND;
  }
  p.trip = trip;
}

/**
 * The house as a whole snapshot: its slots, and the babies in them (each stage seen, those gone
 * since the last look).
 */
function setHouse(s: GameRecord, name: string, slotsNow: (string | null)[], t: number): void {
  player(s, name).house = { slots: [...slotsNow], at: t };
  const alive = s.babies.filter((b) => b.player === name && b.gone === undefined);
  const seen = new Set<Baby>();
  slotsNow.forEach((emoji, i) => {
    if (!isPerson(emoji) || emoji === null) return;
    const slot = i + 1;
    const baby =
      alive.find((b) => b.slot === slot && !seen.has(b)) ??
      alive.find((b) => b.slot === undefined && !seen.has(b));
    if (baby === undefined) {
      const fresh: Baby = {
        player: name,
        slot,
        stages: [{ emoji, at: t }],
        lastSeen: t,
        leaves: leavesBy(emoji, t),
      };
      s.babies.push(fresh);
      seen.add(fresh);
      return;
    }
    seen.add(baby);
    baby.slot = slot;
    baby.lastSeen = t;
    if (baby.stages.at(-1)?.emoji !== emoji) baby.stages.push({ emoji, at: t });
    if (baby.born === undefined)
      baby.leaves = Math.min(baby.leaves ?? Infinity, leavesBy(emoji, t));
  });
  for (const b of alive) if (!seen.has(b) && b.slot !== undefined) b.gone = t;
}

/** A baby born in a house: its slot, where the house is known. */
function born(s: GameRecord, e: EventOf<'born'>, t: number): void {
  const name = e.player.name;
  const father = e.father.name;
  // The 💦 it comes of is due no more.
  const p = s.players[name];
  const of = p?.expecting?.findIndex((x) => x.father === father) ?? -1;
  if (p?.expecting !== undefined && of >= 0) {
    p.expecting.splice(of, 1);
    if (p.expecting.length === 0) delete p.expecting;
  }
  // A late line of a birth the record already took for missed: the line has the last word.
  const assumed = s.babies.findIndex(
    (b) =>
      b.player === name && b.father === father && b.gone === undefined && b.unseen?.includes('born')
  );
  if (assumed >= 0) {
    const [old] = s.babies.splice(assumed, 1);
    if (old !== undefined) freeSlot(s, old, t);
  }
  const baby: Baby = {
    player: name,
    born: t,
    father,
    stages: [{ emoji: e.emoji, at: t }],
    lastSeen: t,
    leaves: t + BABY_LIFE_MS,
  };
  const replaced = e.replaced;
  if (replaced !== undefined) baby.replaced = replaced;
  const house = s.players[name]?.house;
  if (house !== undefined) {
    const i =
      replaced === undefined
        ? house.slots.indexOf(null)
        : house.slots.findIndex((c) => c !== null && emojiKind(c) === emojiKind(replaced));
    if (i >= 0) {
      house.slots[i] = e.emoji;
      house.at = t;
      baby.slot = i + 1;
    }
  }
  s.babies.push(baby);
}

/** The baby whose `babyGone` line this is: by its last stage seen, else the one due nearest `t`. */
function leaving(s: GameRecord, name: string, emoji: string, t: number): Baby | undefined {
  const alive = s.babies.filter((b) => b.player === name && b.gone === undefined);
  const kind = emojiKind(emoji);
  const byStage = alive.find((b) => emojiKind(b.stages.at(-1)?.emoji ?? '') === kind);
  if (byStage !== undefined) return byStage;
  const due = (b: Baby): number => Math.abs((leavesOf(b) ?? Infinity) - t);
  return alive.sort((a, b) => due(a) - due(b))[0];
}

/** A baby's slot, freed in its house where the house still shows a person there. */
function freeSlot(s: GameRecord, baby: Baby, t: number): void {
  const house = s.players[baby.player]?.house;
  if (house === undefined || baby.slot === undefined) return;
  if (!isPerson(house.slots[baby.slot - 1])) return;
  house.slots[baby.slot - 1] = null;
  house.at = t;
}

/** The latest a person seen at a stage at `at` leaves: born a stage a day, at most that old. */
const leavesBy = (emoji: string, at: number): number =>
  at - (STAGE[emojiKind(emoji)] ?? 0) * DAY + BABY_LIFE_MS;

/**
 * When a baby is due to leave: 96 h after its birth when the birth was seen (exact), else the
 * latest its stages allow; undefined for one never seen in a stage.
 */
export function leavesOf(b: Baby): number | undefined {
  if (b.leaves !== undefined) return b.leaves;
  if (b.born !== undefined) return b.born + BABY_LIFE_MS;
  const bounds = b.stages.map((st) => leavesBy(st.emoji, st.at));
  return bounds.length === 0 ? undefined : Math.min(...bounds);
}

/** A change the record expected, whose line never came within the margin: applied all the same. */
export type Missed =
  | {
      what: 'born';
      player: string;
      due: number;
      father: string;
      slot?: number;
    }
  | { what: 'babyGone'; player: string; due: number; emoji: string; slot?: number; exact: boolean }
  | { what: 'returnHome'; player: string; due: number; to: string; arrived: boolean };

/**
 * Applies to `s` (in place) what was due more than the margin before `t` and whose line never
 * came, as the game applied it: a baby born 9 h after a 💦 delivered (into the first free slot,
 * when the house is known and has one; else its slot is left to the next /house), a baby gone 96 h
 * after its birth (its slot freed), a trip back home by its return. Returns what it applied, in
 * time order.
 */
export function settleDue(s: GameRecord, t: number, options: RecordOptions = {}): Missed[] {
  const margin = options.missedAfterMs ?? MISSED_AFTER_MS;
  const out: Missed[] = [];
  for (const [name, p] of Object.entries(s.players)) {
    const due = (p.expecting ?? []).filter((x) => x.at + BIRTH_AFTER_MS + margin < t);
    if (due.length === 0) continue;
    p.expecting = (p.expecting ?? []).filter((x) => !due.includes(x));
    if (p.expecting.length === 0) delete p.expecting;
    for (const x of due) {
      const at = x.at + BIRTH_AFTER_MS;
      const baby: Baby = {
        player: name,
        born: at,
        father: x.father,
        stages: [{ emoji: '👶', at }],
        lastSeen: at,
        leaves: at + BABY_LIFE_MS,
        unseen: ['born'],
      };
      const i = p.house?.slots.indexOf(null) ?? -1;
      if (p.house !== undefined && i >= 0) {
        p.house.slots[i] = '👶';
        p.house.at = t;
        baby.slot = i + 1;
      }
      s.babies.push(baby);
      out.push({
        what: 'born',
        player: name,
        due: at,
        father: x.father,
        ...(baby.slot === undefined ? {} : { slot: baby.slot }),
      });
    }
  }
  for (const b of s.babies) {
    const leaves = leavesOf(b);
    if (b.gone !== undefined || leaves === undefined || leaves + margin >= t) continue;
    b.gone = leaves;
    b.unseen = [...(b.unseen ?? []), 'gone'];
    freeSlot(s, b, t);
    out.push({
      what: 'babyGone',
      player: b.player,
      due: leaves,
      emoji: b.stages.at(-1)?.emoji ?? '👶',
      ...(b.slot === undefined ? {} : { slot: b.slot }),
      exact: b.born !== undefined,
    });
  }
  for (const [name, p] of Object.entries(s.players)) {
    const trip = tripOf(s, name);
    if (trip?.returnAt === undefined || trip.returnAt + margin >= t) continue;
    delete p.trip;
    out.push({
      what: 'returnHome',
      player: name,
      due: trip.returnAt,
      to: trip.to,
      arrived: trip.arrivedAt !== undefined,
    });
  }
  return out.sort((a, b) => a.due - b.due);
}

/** The first slot holding `from` (null: the first free one) now holds `to`. */
function replaceInHouse(
  s: GameRecord,
  name: string,
  from: string | null,
  to: string | null,
  t: number
): void {
  const house = s.players[name]?.house;
  if (house === undefined) return;
  const i = house.slots.findIndex((c) =>
    from === null ? c === null : c !== null && emojiKind(c) === emojiKind(from)
  );
  if (i < 0) return;
  house.slots[i] = to;
  house.at = t;
}

/** The ⚽ to `to` at `t`: the hold that ends added to its holder's time. */
function moveBall(s: GameRecord, to: string, t: number): void {
  const holder = s.ball.holder;
  if (holder?.name === to) return;
  if (holder !== undefined)
    s.ball.held[holder.name] =
      (s.ball.held[holder.name] ?? 0) + Math.max(0, Math.floor((t - holder.since) / SECOND));
  s.ball.holder = { name: to, since: t };
}

// Queries

/** The seconds `name` held the ⚽ by `at` (ms), the hold under way included. */
export function heldSeconds(s: GameRecord, name: string, at: number): number {
  const done = s.ball.held[name] ?? 0;
  const h = s.ball.holder;
  return h?.name === name ? done + Math.max(0, Math.floor((at - h.since) / SECOND)) : done;
}

/** Every player's time with the ⚽ by `at`, most first, as /leaderboard ranks them. */
export function ballTotals(s: GameRecord, at: number): { name: string; seconds: number }[] {
  const names = new Set([
    ...Object.keys(s.ball.held),
    ...(s.ball.holder ? [s.ball.holder.name] : []),
  ]);
  return [...names]
    .map((name) => ({ name, seconds: heldSeconds(s, name, at) }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

/** A slot a baby locks, and until when: `exact` when its birth was seen, else at the latest. */
export interface Lock {
  slot: number;
  emoji: string;
  until?: number;
  exact: boolean;
}

/** A house's slots, with the slots babies lock (1 to 10), and until when each (`locks`). */
export function houseOf(
  s: GameRecord,
  name: string
): { slots: (string | null)[]; locked: number[]; locks: Lock[]; at: number } | undefined {
  const house = s.players[name]?.house;
  if (house === undefined) return undefined;
  const locked = house.slots.flatMap((c, i) => (isPerson(c) ? [i + 1] : []));
  const locks = locked.map((slot): Lock => {
    const baby = s.babies.find((b) => b.player === name && b.gone === undefined && b.slot === slot);
    const until = baby === undefined ? undefined : leavesOf(baby);
    return {
      slot,
      emoji: String(house.slots[slot - 1]),
      ...(until === undefined ? {} : { until }),
      exact: baby?.born !== undefined,
    };
  });
  return { slots: [...house.slots], locked, locks, at: house.at };
}

/** The babies (of one house, or all), each with when it is due to leave (`leaves`). */
export function babiesOf(s: GameRecord, name?: string): (Baby & { exact: boolean })[] {
  return s.babies
    .filter((b) => name === undefined || b.player === name)
    .map((b) => {
      const leaves = leavesOf(b);
      return { ...b, ...(leaves === undefined ? {} : { leaves }), exact: b.born !== undefined };
    });
}

/** A player's trip under way, with when it is due home if known (`returnAt`). */
export function tripOf(s: GameRecord, name: string): Trip | undefined {
  const trip = s.players[name]?.trip;
  if (trip === undefined) return undefined;
  const out = { ...trip };
  if (out.returnAt === undefined && out.arriveAt !== undefined) {
    const base = s.legs[legKey(trip.from, trip.to)];
    if (base !== undefined) out.returnAt = out.arriveAt + legSeconds(base, trip.rockets) * SECOND;
  }
  return out;
}
