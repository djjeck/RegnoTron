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
import { parseGenerated, parseGenerationAsked } from '@regnotron/game-bots/generators.ts';
import {
  initialState,
  inventoryOfPlayer,
  type LoreState,
  type Player,
  playerOf,
  recipeMadeOf,
  reduce,
} from '@regnotron/game-bots/loregame-state.ts';
import {
  GENERATED_EVENT,
  INVENTORY_EVENT,
  PLAYER_TURN_EVENT,
  PROFILE_EVENT,
  PURCHASE_EVENT,
  RECIPE_EVENT,
  RECIPE_MADE_EVENT,
  RECIPES_EVENT,
  SHOP_EVENT,
  TRAVEL_EVENT,
  USED_EVENT,
} from '@regnotron/game-bots/plugins/loregame.ts';
import { levelForXp } from '@regnotron/game-bots/profile.ts';
import { LOREGAMEBOT, TURN_COMMANDS } from '@regnotron/game-bots/replies.ts';
import { GENERATOR_TAG } from '@regnotron/game-bots/shop.ts';
import { type ExportPhoto } from './photos.ts';

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
  /** The state as the replay left it (`loregame-state`'s whole state). */
  state: unknown;
  /** The photos the exports hold, by `<chat>\n<message id>` (photos.ts); none: not read. */
  photos?: ReadonlyMap<string, ExportPhoto>;
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

/**
 * Where the players are without a profile (docs/game-bots.md §6.1): those whose place their turns
 * tell, and whose faction its ladder does, no profile of theirs read; and, at each player's first
 * profile, how often it agrees with what their turns told.
 */
export const whereabouts: Check = {
  id: 'whereabouts',
  run: (r) => {
    const last = r.steps.at(-1)?.after ?? initialState();
    const unprofiled = Object.values(last.players).filter((p) => p.profile === null);
    const stat = (p: Player | null, s: string) =>
      p === null || !Object.hasOwn(p.stats, s) ? undefined : p.stats[s];
    let places = 0;
    let placesAgree = 0;
    let factions = 0;
    let factionsAgree = 0;
    for (const s of r.steps) {
      if (s.event.type !== PROFILE_EVENT) continue;
      const name = String(s.event['player']);
      const was = playerOf(s.before, name);
      if (was === null || was.profile !== null) continue;
      const place = stat(was, 'location')?.value as { code?: string } | null | undefined;
      const said = s.event['location'] as { code?: string } | null | undefined;
      if (place?.code !== undefined && said?.code !== undefined) {
        places++;
        if (place.code === said.code) placesAgree++;
      }
      const faction = stat(was, 'alignment')?.value;
      if (faction !== undefined) {
        factions++;
        if (faction === s.event['alignment']) factionsAgree++;
      }
    }
    return {
      title: 'Whereabouts',
      rows: [
        ['players with no profile read', String(unprofiled.length)],
        [
          'of them, with a place',
          pct(
            unprofiled.filter((p) => stat(p, 'location') !== undefined).length,
            unprofiled.length
          ),
        ],
        [
          'of them, with a faction (from the ladder)',
          pct(
            unprofiled.filter((p) => stat(p, 'alignment') !== undefined).length,
            unprofiled.length
          ),
        ],
        ['first profiles agreeing with the place the turns told', pct(placesAgree, places)],
        ['first profiles agreeing with the faction the ladder told', pct(factionsAgree, factions)],
      ],
    };
  },
};

/**
 * The shop (docs/game-bots.md §5.12): of the bot's listings, those read; the days they cover, and
 * how often the day's items changed within a day (the shop changes at midnight); the items seen on
 * sale, the generators apart.
 */
export const shop: Check = {
  id: 'shop',
  run: (r) => {
    const listed = r.inbounds.filter((m) => isBot(m) && m.text.includes('oggi nel negozio:'));
    const read = r.steps.filter((s) => s.event.type === SHOP_EVENT);
    const changed = read.filter(
      (s) => s.before.shop.items !== s.after.shop.items || s.before.shop.day !== s.after.shop.day
    );
    const last = r.steps.at(-1)?.after ?? initialState();
    const seen = Object.values(last.shop.seen);
    const generators = seen.filter((i) => i.tags.includes(GENERATOR_TAG)).length;
    // Each purchase's coins against the buyer's next profile, when the state held them exactly.
    const bought = r.steps.filter((s) => s.event.type === PURCHASE_EVENT);
    let checked = 0;
    let agreed = 0;
    for (const b of bought) {
      const name = String(b.event['player']);
      const next = r.steps.find(
        (s) =>
          s.event.type === PROFILE_EVENT &&
          s.event.t >= b.event.t &&
          String(s.event['player']).toLowerCase() === name.toLowerCase()
      );
      const held = next === undefined ? null : playerOf(next.before, name);
      const coins =
        held === null || !Object.hasOwn(held.stats, 'coins') ? undefined : held.stats['coins'];
      if (next === undefined || coins?.exact !== true) continue;
      checked++;
      const at = new Date(next.event.t).toISOString();
      const drifted = (playerOf(next.after, name)?.stats_drift ?? []).some(
        (d) => d.stat === 'coins' && d.at === at
      );
      if (!drifted) agreed++;
    }
    return {
      title: 'Shop',
      rows: [
        ['listings of the bot’s', String(listed.length)],
        ['read', pct(read.length, listed.length)],
        ['days', String(new Set(read.map((s) => s.after.shop.day)).size)],
        [
          'sagra days',
          String(
            new Set(read.filter((s) => s.after.shop.sagra !== null).map((s) => s.after.shop.day))
              .size
          ),
        ],
        [
          'changes of the items within a day',
          String(changed.filter((s) => s.before.shop.day === s.after.shop.day).length),
        ],
        ['items seen on sale', `${seen.length} (${generators} generators)`],
        [
          'players whose purchases were told',
          String(new Set(read.map((s) => String(s.event['player']))).size),
        ],
        ['purchases read (a listing edited back from its confirmation)', String(bought.length)],
        ['their coins agreeing with the buyer’s next profile', pct(agreed, checked)],
      ],
    };
  },
};

/** The catalogue (docs/game-bots.md §6): every item seen, how each was first seen, the generators. */
export const catalogue: Check = {
  id: 'catalogue',
  run: (r) => {
    const last = r.steps.at(-1)?.after ?? initialState();
    const all = Object.values(last.catalogue);
    return {
      title: 'Catalogue',
      rows: [
        ['items seen', String(all.length)],
        ['generators', String(all.filter((c) => c.tags.includes(GENERATOR_TAG)).length)],
        ['first seen by', tally(all.map((c) => c.via))],
        ['by rarity', tally(all.map((c) => c.rarity || '?'))],
      ],
    };
  },
};

/**
 * The generators (docs/game-bots.md §5.13): the bot's confirmations and outcomes, those the parser
 * paired with a player, by kind; the moving boxes opened, and those read.
 */
export const generators: Check = {
  id: 'generators',
  run: (r) => {
    const said = r.inbounds.filter(isBot);
    const asked = said.map((m) => parseGenerationAsked(m.text)).filter((a) => a !== undefined);
    const outcomes = said.map((m) => parseGenerated(m.text)).filter((g) => g !== undefined);
    const paired = r.steps.filter((s) => s.event.type === GENERATED_EVENT);
    const boxes = said.filter((m) => m.text.includes('apri lo scatolone 📦'));
    const used = r.steps.filter((s) => s.event.type === USED_EVENT);
    return {
      title: 'Generators',
      rows: [
        ['confirmations of the bot’s', `${asked.length} (${tally(asked.map((a) => a.kind))})`],
        ['outcomes read', `${outcomes.length} (${tally(outcomes.map((g) => g.kind))})`],
        [
          'outcomes paired with a player',
          `${pct(paired.length, outcomes.length)} (${tally(paired.map((s) => String(s.event['kind'])))})`,
        ],
        ['moving boxes opened', String(boxes.length)],
        ['read', pct(used.length, boxes.length)],
      ],
    };
  },
};

/**
 * The recipes (docs/game-bots.md §5.14): the bot's lists, answers and recipes made, those read;
 * which recipe each made was; the recipes the game has; and the items a recipe made left, against
 * its player's next inventory listing (each listed that the state held exactly then).
 */
export const recipes: Check = {
  id: 'recipes',
  run: (r) => {
    const said = r.inbounds.filter(isBot);
    const told = (pattern: RegExp) => said.filter((m) => pattern.test(m.text)).length;
    const read = (type: string) => r.steps.filter((s) => s.event.type === type);
    const made = read(RECIPE_MADE_EVENT);
    const items = (v: unknown) => (Array.isArray(v) ? (v as { item: string; qty: number }[]) : []);
    const known = made.filter(
      (s) =>
        recipeMadeOf(s.after, items(s.event['used']), s.event['made'] as { item: string }) !==
        undefined
    );
    let checked = 0;
    let agreed = 0;
    for (const m of made) {
      const name = String(m.event['player']);
      const owner = m.event['owner'] === true;
      const next = r.steps.find(
        (s) =>
          s.event.type === INVENTORY_EVENT &&
          s.event.t >= m.event.t &&
          (owner ? s.event['owner'] === true : String(s.event['player']) === name)
      );
      if (next === undefined) continue;
      const before = inventoryOfPlayer(next.before, owner ? undefined : name);
      const listed = new Map(items(next.event['items']).map((i) => [i.item, i.qty]));
      for (const i of [...items(m.event['used']), m.event['made'] as { item: string }]) {
        const h =
          before !== null && Object.hasOwn(before.items, i.item) ? before.items[i.item] : undefined;
        const said = listed.get(i.item);
        if (h?.exact !== true || said === undefined) continue;
        checked++;
        if (h.qty === said) agreed++;
      }
    }
    const last = r.steps.at(-1)?.after ?? initialState();
    return {
      title: 'Recipes',
      rows: [
        ['lists of the bot’s', String(told(/ ecco le ricette a tua disposizione:/u))],
        ['lists read', String(read(RECIPES_EVENT).length)],
        ['answers lacking something', String(told(/ per fare la ricetta .+ ti mancan[oa]:/u))],
        ['answers read', String(read(RECIPE_EVENT).length)],
        ['recipes made', String(told(/^@\w+, prendi in mano:/u))],
        ['recipes made read', String(made.length)],
        ['of them, known which recipe', pct(known.length, made.length)],
        ['recipes the game has', String(Object.keys(last.recipes).length)],
        ['items a recipe made left, agreeing with the next listing', pct(agreed, checked)],
      ],
    };
  },
};

/** Every check, in the report's order: add one here as the parser learns to read more. */
/**
 * The pictures (docs/game-bots.md §5.9, §6.2): of the bot's answers that show one (a season's and
 * a story's creation card, a guardian made, an arrival, a `/v`, a turn, a turn's encounter), how
 * many the parser read, how many the exports hold a photo of, and how many pictures they are; the
 * places pictured (as the state takes them: creation cards, arrivals, `/v`), those told by more than
 * one picture; whether a turn shows its place's picture; and whether each enemy met shows one.
 */
export const pictures: Check = {
  id: 'pictures',
  run: (r) => {
    const photos = r.photos;
    if (photos === undefined || photos.size === 0)
      return { title: 'Pictures', rows: [['photos in the exports', 'none read']] };
    const photoOf = (e: BusEvent): ExportPhoto | undefined =>
      typeof e['answer'] === 'string'
        ? photos.get(`${String(e['chat'])}\n${e['answer']}`)
        : undefined;
    const outcome = (e: BusEvent) =>
      e['outcome'] as
        { place?: { code: string }; fight?: { enemy?: { name: string } } } | undefined;
    const sources: [string, (e: BusEvent) => boolean][] = [
      [
        'a season made (its creation card)',
        (e) => e.type === GENERATED_EVENT && e['kind'] === 'season',
      ],
      ['a story made', (e) => e.type === GENERATED_EVENT && e['kind'] === 'story'],
      ['a guardian made', (e) => e.type === GENERATED_EVENT && e['kind'] === 'guardian'],
      ['an arrival', (e) => e.type === TRAVEL_EVENT && e['kind'] === 'arrived'],
      ['a /v', (e) => e.type === TRAVEL_EVENT && e['kind'] === 'here'],
      [
        'a turn, no enemy met',
        (e) =>
          e.type === PLAYER_TURN_EVENT &&
          outcome(e)?.place !== undefined &&
          outcome(e)?.fight === undefined,
      ],
      [
        'a turn, an enemy met',
        (e) => e.type === PLAYER_TURN_EVENT && outcome(e)?.fight !== undefined,
      ],
    ];
    const events = r.steps.map((s) => s.event);
    const rows: [string, string][] = [['photos in the exports', String(photos.size)]];
    for (const [label, is] of sources) {
      const read = events.filter(is);
      const shown = read.map(photoOf).filter((p) => p !== undefined);
      rows.push([
        label,
        `${read.length} read, ${shown.length} with a photo, ${new Set(shown.map((p) => p.id)).size} pictures`,
      ]);
    }
    // The places' pictures, as the state takes them, by code.
    const places = new Map<string, Set<string>>();
    for (const e of events) {
      const p = photoOf(e);
      const code =
        e.type === TRAVEL_EVENT && e['kind'] !== 'refused'
          ? (e['place'] as { code: string }).code
          : e.type === GENERATED_EVENT && e['kind'] === 'season'
            ? (e['code'] as string | null)
            : null;
      if (p === undefined || code === null) continue;
      places.set(code, (places.get(code) ?? new Set()).add(p.id));
    }
    const turns = events.filter((e) => sources[5]?.[1](e) === true && photoOf(e) !== undefined);
    const atPictured = turns.filter((e) => places.has(outcome(e)?.place?.code ?? ''));
    const same = atPictured.filter((e) =>
      places.get(outcome(e)?.place?.code ?? '')?.has((photoOf(e) as ExportPhoto).id)
    );
    const enemies = new Map<string, Set<string>>();
    for (const e of events) {
      const enemy = outcome(e)?.fight?.enemy?.name;
      const p = photoOf(e);
      if (e.type === PLAYER_TURN_EVENT && enemy !== undefined && p !== undefined)
        enemies.set(enemy, (enemies.get(enemy) ?? new Set()).add(p.id));
    }
    rows.push(
      ['places pictured', String(places.size)],
      [
        'of them, told by more than one picture',
        String([...places.values()].filter((s) => s.size > 1).length),
      ],
      ['turns at a place pictured showing its picture', pct(same.length, atPictured.length)],
      ['enemies met with a photo', String(enemies.size)],
      [
        'of them, one picture each',
        String([...enemies.values()].filter((s) => s.size === 1).length),
      ]
    );
    return { title: 'Pictures', rows };
  },
};

export const CHECKS: readonly Check[] = [
  coverage,
  rests,
  accumulo,
  training,
  levels,
  profiles,
  players,
  whereabouts,
  shop,
  generators,
  recipes,
  catalogue,
  pictures,
];

/** The report's text: each check's title, then its rows. */
export function report(findings: readonly Finding[]): string {
  return findings
    .map((f) => [`## ${f.title}`, ...f.rows.map(([k, v]) => `- ${k}: ${v}`)].join('\n'))
    .join('\n\n');
}
