/**
 * The checks of a replayed @LoreGameBot chat (tools/lore-check/README.md): how much of what the
 * bot said the grammar read, and whether the state it built agrees with what the bot said next.
 * Each check is a function of the run, pure, so that a new one (the inventory, the equipment, the
 * stats, as the parser learns to read them) is one more entry in `CHECKS`.
 *
 * A run is the messages fed (`Inbound`s) and the parser's events in order, each with the state
 * before and after it, as `loregame-state`'s reducer makes it: a check compares what the state held
 * with what the bot then said.
 */
import { type BusEvent, type Inbound } from '@megabottron1999/core';
import { isTurnCommand } from '@megabottron1999/turns/turn-parser.ts';
import {
  initialState,
  type LoreState,
  type Player,
  playerOf,
  reduce,
} from '@regnotron/game-bots/loregame-state.ts';
import { levelForXp } from '@regnotron/game-bots/profile.ts';
import { LOREGAMEBOT, TURN_COMMANDS } from '@regnotron/game-bots/replies.ts';

/** One event of the parser, with the state before and after it. */
export interface Step {
  event: BusEvent;
  before: LoreState;
  after: LoreState;
}

/** What a check is given: the run's messages, its parser's events as steps, and its drift. */
export interface Run {
  inbounds: readonly Inbound[];
  steps: readonly Step[];
  /** The parser's drift: replies it claimed and read, and those it could not. */
  drift: { read: number; unread: number };
  /** Shown for a player's name: their own, or a stand-in (P1, P2, …) for a report to share. */
  name: (player: string) => string;
}

/** A check's findings: a line per measure, a label and a value. */
export interface Finding {
  title: string;
  rows: [string, string][];
}

export interface Check {
  id: string;
  run(r: Run): Finding;
}

/** The steps of a run: each parser event applied to the state, in order. */
export function stepsOf(events: readonly BusEvent[]): Step[] {
  const steps: Step[] = [];
  let state = initialState();
  for (const event of events) {
    const after = reduce(state, event);
    steps.push({ event, before: state, after });
    state = after;
  }
  return steps;
}

const pct = (n: number, of: number): string =>
  of === 0 ? `${n}` : `${n} of ${of} (${((100 * n) / of).toFixed(1)}%)`;

/** How many of each key, largest first, as `key ×n`. */
const tally = (keys: readonly string[]): string =>
  [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ×${n}`)
    .join(', ') || 'none';

const bot = LOREGAMEBOT.toLowerCase();
const isBot = (m: Inbound): boolean => m.own !== true && m.sender.toLowerCase() === bot;
const TWO_MIN = 2 * 60_000;

/**
 * Parse coverage: of the bot's replies to a turn command, any player's, how many the parser read
 * as a turn or a "too soon" (`loregame.playerTurn`); and the parser's own drift (the owner's
 * replies it claimed and could not read).
 */
export const coverage: Check = {
  id: 'coverage',
  run: (r) => {
    const turns = new Set<string>();
    for (const m of r.inbounds)
      if (!isBot(m) && m.id !== undefined && isTurnCommand(m.text, TURN_COMMANDS[LOREGAMEBOT], bot))
        turns.add(`${m.chat}\n${m.id}`);
    const replies = r.inbounds.filter(
      (m) => isBot(m) && m.replyTo !== undefined && turns.has(`${m.chat}\n${m.replyTo}`)
    ).length;
    const read = r.steps.filter((s) => s.event.type === 'loregame.playerTurn').length;
    const kinds = r.steps
      .filter((s) => s.event.type === 'loregame.playerTurn')
      .map((s) => {
        const o = s.event['outcome'] as { kind: string; reason?: string };
        return o.reason === undefined ? o.kind : `${o.kind}/${o.reason}`;
      });
    return {
      title: 'Parse coverage',
      rows: [
        ['replies to a turn command, any player’s', String(replies)],
        ['read as a turn or a "too soon"', pct(read, replies)],
        ['by outcome', tally(kinds)],
        [
          'the owner’s replies the parser could not read (drift)',
          pct(r.drift.unread, r.drift.read + r.drift.unread),
        ],
      ],
    };
  },
};

/**
 * The rest model (docs/game-bots.md §2): each "too soon" the bot gave a player against the rest
 * the state predicted from their last turn. It agrees within two minutes; tells of a turn unseen
 * (we held them rested: played in private); or is longer or shorter than we predicted, a rest the
 * model does not know. And each turn seen before the rest we predicted was over (a use of the
 * accumulo ends it).
 */
export const rests: Check = {
  id: 'rests',
  run: (r) => {
    const verdicts: string[] = [];
    let early = 0;
    let earlyAfterUse = 0;
    let earlyUnseen = 0;
    let earlyDouble = 0;
    for (const s of r.steps) {
      if (s.event.type !== 'loregame.playerTurn') continue;
      const name = s.event['player'] as string;
      const p = playerOf(s.before, name);
      const o = s.event['outcome'] as {
        kind: string;
        reason?: string;
        retryMs?: number;
        place?: unknown;
      };
      const predicted = p?.rest_until === null || p === null ? undefined : Date.parse(p.rest_until);
      if (o.kind === 'nothing' && o.reason === 'cooldown' && o.retryMs !== undefined) {
        if (p === null || p.last_turn === null) continue;
        const said = s.event.t + o.retryMs;
        if (predicted === undefined || predicted <= s.event.t) verdicts.push('a turn unseen');
        else if (Math.abs(said - predicted) <= TWO_MIN) verdicts.push('agrees');
        else verdicts.push(said > predicted ? 'longer than predicted' : 'shorter than predicted');
      } else if (
        o.place !== undefined &&
        predicted !== undefined &&
        predicted - s.event.t > TWO_MIN
      ) {
        early++;
        // A use of the accumulo the bot answered in a chat the account reads, since that turn.
        const used = p?.accumulo.used_at ?? null;
        const after = playerOf(s.after, name);
        if (used !== null && p !== null && p.last_turn !== null && used >= p.last_turn)
          earlyAfterUse++;
        else if ((after?.double_turns ?? 0) > (p?.double_turns ?? 0)) earlyDouble++;
        else if ((after?.unseen_uses ?? 0) > (p?.unseen_uses ?? 0)) earlyUnseen++;
      }
    }
    const agree = verdicts.filter((v) => v === 'agrees').length;
    return {
      title: 'Rest model',
      rows: [
        ['"too soon"s after a turn seen', String(verdicts.length)],
        ['agree with the rest predicted (±2 min)', pct(agree, verdicts.length)],
        ['by verdict', tally(verdicts)],
        ['turns seen before the predicted rest ended', String(early)],
        ['… a double turn (within a minute of the last)', String(earlyDouble)],
        ['… after a use of the accumulo seen', String(earlyAfterUse)],
        ['… telling of a use unseen (played in private)', String(earlyUnseen)],
        [
          '… not a use (the accumulo was not full: an item, or a rest the model lacks)',
          String(early - earlyDouble - earlyAfterUse - earlyUnseen),
        ],
      ],
    };
  },
};

/**
 * The accumulo (docs/game-bots.md §5.2, §6.1): each counter the bot gave a player against the
 * state's count (exact: equal; a floor: not above it), and the disagreements the state found,
 * by kind.
 */
export const accumulo: Check = {
  id: 'accumulo',
  run: (r) => {
    let readings = 0;
    let agree = 0;
    const drift: string[] = [];
    for (const s of r.steps) {
      if (s.event.type !== 'loregame.playerAccumulo') continue;
      const name = s.event['player'] as string;
      const count = s.event['count'];
      const p = playerOf(s.before, name);
      if (typeof count === 'number' && p !== null && p.turns > 0) {
        readings++;
        if (p.accumulo.exact ? count === p.accumulo.count : count >= p.accumulo.count) agree++;
      }
    }
    for (const s of r.steps) {
      const name = s.event['player'];
      if (typeof name !== 'string') continue;
      const before = new Set(
        (playerOf(s.before, name)?.accumulo.drift ?? []).map((d) => `${d.kind}@${d.at}`)
      );
      for (const d of playerOf(s.after, name)?.accumulo.drift ?? [])
        if (!before.has(`${d.kind}@${d.at}`)) drift.push(d.kind);
    }
    const ready = r.steps.filter((s) => {
      const name = s.event['player'];
      if (typeof name !== 'string') return false;
      return (
        playerOf(s.after, name)?.accumulo.ready === true &&
        playerOf(s.before, name)?.accumulo.ready !== true
      );
    }).length;
    return {
      title: 'Accumulo',
      rows: [
        ['the bot’s counters, for a player already seen', String(readings)],
        ['agreeing with the state’s count (exact, or above a floor)', pct(agree, readings)],
        ['times the bot said it was full', String(ready)],
        ['disagreements found', tally(drift)],
      ],
    };
  },
};

/**
 * The training (docs/game-bots.md §5.3): each "too soon" the bot gave a player's `/allenati`
 * against the wait the state predicted from their last training (a day): it agrees within two
 * minutes, ends later (a training unseen, played in private), or sooner (a wait the model does not
 * know). And how many of the bot's answers to `/allenati` the parser paired with a player.
 */
export const training: Check = {
  id: 'training',
  run: (r) => {
    const commands = r.inbounds.filter(
      (m) => !isBot(m) && /^\/allenati(?:@loregamebot)?$/iu.test(m.text.trim())
    ).length;
    const answers = r.steps.filter((s) => s.event.type === 'loregame.training');
    const verdicts: string[] = [];
    for (const s of answers) {
      const retryMs = s.event['retryMs'];
      if (s.event['result'] !== 'soon' || typeof retryMs !== 'number') continue;
      const before = playerOf(s.before, s.event['player'] as string)?.training;
      if (before?.last === null || before?.until === null || before === undefined) continue;
      const off = s.event.t + retryMs - Date.parse(before.until);
      verdicts.push(
        Math.abs(off) <= TWO_MIN
          ? 'agrees'
          : off > 0
            ? 'a training unseen'
            : 'sooner than predicted'
      );
    }
    const trained = answers.filter((s) => s.event['result'] === 'trained').length;
    return {
      title: 'Training',
      rows: [
        ['/allenati sent, any player’s', String(commands)],
        ['answers paired with a player', pct(answers.length, commands)],
        ['… trainings', String(trained)],
        ['"too soon"s after a training seen', String(verdicts.length)],
        [
          'agree with the day predicted (±2 min)',
          pct(verdicts.filter((v) => v === 'agrees').length, verdicts.length),
        ],
        ['by verdict', tally(verdicts)],
      ],
    };
  },
};

/**
 * Levels and XP (docs/game-bots.md §5.4, §6.1): of the bot's messages that end in a level-up, how
 * many the parser placed with a player; and, per level reached, the XP the state saw the player gain
 * since their level-up before (when it saw that one): the ground for telling whether the levels'
 * thresholds are fixed, once the profile says how much XP a player has.
 */
export const levels: Check = {
  id: 'levels',
  run: (r) => {
    const LEVEL_UP = /🎉 Congratulazioni, hai raggiunto il livello \d+! 🎉\nOttieni:/u;
    const said = r.inbounds.filter((m) => isBot(m) && LEVEL_UP.test(m.text)).length;
    const placed = r.steps.filter((s) => s.event.type === 'loregame.levelUp');
    const byLevel = new Map<number, number[]>();
    for (const s of placed) {
      const name = s.event['player'] as string;
      const up = playerOf(s.after, name)?.xp.level_ups.at(-1);
      if (up?.xp === null || up === undefined) continue;
      byLevel.set(up.level, [...(byLevel.get(up.level) ?? []), up.xp]);
    }
    const last = r.steps.at(-1)?.after ?? initialState();
    const seen = Object.values(last.players).reduce((n, p) => n + p.xp.seen, 0);
    return {
      title: 'Levels and XP',
      rows: [
        ['the bot’s level-ups', String(said)],
        ['placed with a player', pct(placed.length, said)],
        ['XP seen gained, every player', String(seen)],
        ...[...byLevel]
          .sort((a, b) => a[0] - b[0])
          .map(([level, xp]): [string, string] => [
            `… XP seen before reaching level ${level}`,
            xp.sort((a, b) => a - b).join(', '),
          ]),
      ],
    };
  },
};

/**
 * Profiles (docs/game-bots.md §5.5, §6.1): each profile against what the state held of its player
 * since their last one. Its episodes against the turns seen since (a turn unseen told of besides):
 * agreeing, every turn was seen; and then its XP against the state's total, which tests the XP rule
 * of §5.4 alone (a player's turns in private, which the account does not read, would move it too).
 * And its level against its XP (53 × (level − 1)²), and its lines left unread.
 */
export const profiles: Check = {
  id: 'profiles',
  run: (r) => {
    const seen = r.steps.filter((s) => s.event.type === 'loregame.profile');
    const xp: string[] = [];
    const episodes: string[] = [];
    let unknown = 0;
    const drifted: string[] = [];
    const ownDrift: string[] = [];
    let levels = 0;
    let unread = 0;
    const last = new Map<string, { episode: number; turns: number; unseen: number }>();
    for (const s of seen) {
      const name = s.event['player'] as string;
      const said = { xp: s.event['xp'] as number, episode: s.event['episode'] as number };
      if (levelForXp(said.xp) === s.event['level']) levels++;
      unread += (s.event['unread'] as string[]).length;
      const p = playerOf(s.before, name);
      const before = last.get(name);
      if (before !== undefined && p !== null) {
        const turns =
          said.episode - before.episode - (p.turns - before.turns) - (p.unseen - before.unseen);
        episodes.push(turns === 0 ? 'agrees' : `off by ${turns > 0 ? '+' : ''}${turns}`);
        // Every turn seen: the XP rule alone.
        const held = Object.hasOwn(p.stats, 'xp') ? p.stats['xp'] : undefined;
        if (turns === 0 && held !== undefined) {
          const off = said.xp - Number(held.value);
          if (!held.exact) unknown++;
          else xp.push(off === 0 ? 'agrees' : `off by ${off > 0 ? '+' : ''}${off}`);
        }
      }
      const after = playerOf(s.after, name);
      // The stats held exactly that this profile said otherwise (the state's own check).
      const at = new Date(s.event.t).toISOString();
      for (const d of after?.stats_drift ?? [])
        if (d.at === at) (s.event['owner'] === true ? ownDrift : drifted).push(d.stat);
      if (after !== null)
        last.set(name, { episode: said.episode, turns: after.turns, unseen: after.unseen });
    }
    const agree = (v: string[]) => pct(v.filter((x) => x === 'agrees').length, v.length);
    return {
      title: 'Profiles',
      rows: [
        ['profiles read, any player’s', String(seen.length)],
        ['their level as their XP makes it', pct(levels, seen.length)],
        ['lines left unread', String(unread)],
        ['episodes against the turns seen since the last profile', agree(episodes)],
        ['… by verdict', tally(episodes)],
        ['with every turn seen, XP against the state’s', agree(xp)],
        ['… by verdict', tally(xp)],
        ['… an outcome whose XP is not known (a draw, a turn cut off)', String(unknown)],
        ['stats held exactly that the next profile said otherwise: the owner’s', tally(ownDrift)],
        ['… the other players’ (their turns in private among them)', tally(drifted)],
      ],
    };
  },
};

/** The players: how many, their turns seen and unseen, and the busiest, their name shown or not. */
export const players: Check = {
  id: 'players',
  run: (r) => {
    const last = r.steps.at(-1)?.after ?? initialState();
    const all = Object.entries(last.players) as [string, Player][];
    const seen = all.reduce((n, [, p]) => n + p.turns, 0);
    const unseen = all.reduce((n, [, p]) => n + p.unseen, 0);
    const busiest = all
      .sort((a, b) => b[1].turns - a[1].turns)
      .slice(0, 10)
      .map(([name, p]): [string, string] => [
        r.name(name),
        `${p.turns} seen, ${p.unseen} unseen (${p.unseen_uses} uses), level ${p.game.level ?? '?'}, accumulo ${p.accumulo.count}${p.accumulo.exact ? '' : '+'}/${p.accumulo.max ?? '?'}${p.accumulo.ready ? ' full' : ''}`,
      ]);
    return {
      title: 'Players',
      rows: [
        ['players kept', String(all.length)],
        ['turns seen', String(seen)],
        ['turns told of by a "too soon" alone (played in private)', pct(unseen, seen + unseen)],
        ['with a level known', String(all.filter(([, p]) => p.game.level !== null).length)],
        ...busiest,
      ],
    };
  },
};

/** Every check, in the report's order: add one here as the parser learns to read more. */
export const CHECKS: readonly Check[] = [
  coverage,
  rests,
  accumulo,
  training,
  levels,
  profiles,
  players,
];

/** The report's text: each check's title, then its rows. */
export function report(findings: readonly Finding[]): string {
  return findings
    .map((f) => [`## ${f.title}`, ...f.rows.map(([k, v]) => `- ${k}: ${v}`)].join('\n'))
    .join('\n\n');
}
