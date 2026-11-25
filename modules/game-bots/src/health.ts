/**
 * Whether @LoreGameBot is answering now (docs/game-bots.md §5.16): `up`, `slow`, `suspect`, `down`
 * or `catching-up`, from what the parser hears and the sends it is told of. Pure, but for what a
 * plugin hands it: the plugin ticks it on a timer, since a silence is told by no message.
 *
 * The bot goes down for minutes to days and says nothing; then it replays what it missed, in
 * order, sometimes in bursts with silence between (§5.15). Live, it answers within 2 s (98%). So:
 *
 * - **Silence while a command waits** is the signal: the bot has said nothing, anywhere the parser
 *   reads, since a command of its was sent `SUSPECT_MS` ago. No single command's answer is
 *   load-bearing (about 1% are never given, and some days its answers reply to nothing).
 * - **A probe, once per suspicion:** `/info` in the owner's private chat, which `loregame-state`
 *   offers a player while `suspect`. Answered: the bot is alive, only slow where the commands wait.
 *   Unanswered after `PROBE_WAIT_MS`: down. Without one, `DOWN_MS` of silence is down all the same.
 * - **Back** is a reply at normal latency (within `REPLAY_MS` of what it answers). A replay's
 *   replies answer what was sent before the silence, so they never end an outage: they mark it
 *   `catching-up`. Since the replay keeps the order, a fresh reply means it is through.
 */
import { isPrivate } from '@megabottron1999/turns/turn-parser.ts';
import { REPLAY_MS } from '#src/answer-watch.ts';
import { type Heard } from '#src/bans.ts';

/** The bot's health: answering, held up in one chat, silent, gone, or replaying what it missed. */
export const HEALTH_STATES = ['up', 'slow', 'suspect', 'down', 'catching-up'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** Silence while a command waits, this long: suspect. Live, the bot answers within 2 s (98%). */
export const SUSPECT_MS = 60_000;
/** A probe unanswered this long after it was sent: down. */
export const PROBE_WAIT_MS = 2 * 60_000;
/** Silence while a command waits, this long, suspect or catching up, probe or not: down. */
export const DOWN_MS = 5 * 60_000;
/** Silence while a command waits, this long, though the probe was answered: down. */
export const SLOW_DOWN_MS = 15 * 60_000;

/** The probe: a command any player may send at any time, which the bot always answers. */
export const PROBE_COMMAND = '/info';

/**
 * The commands the bot answers, whose wait tells its silence: those it answered in 95% or more of
 * the exports' cases (docs/game-bots.md §5.16). Not `/dai` nor `/usa`, which other bots take too.
 */
export const HEALTH_COMMANDS = [
  '/avventura',
  '/lore',
  '/l',
  '/accumulo',
  '/acc',
  '/i',
  '/zaino',
  '/vai',
  '/v',
  '/me',
  PROBE_COMMAND,
  '/abilita',
  '/negozio',
  '/give',
  '/leaderboard',
  '/generaoggetto',
  '/generastoria',
  '/generaequipaggiamento',
  '/generaguardiano',
];

/** How many of the others' messages it remembers the time of, to read the bot's replies. */
const KEPT_HEARD = 5000;

/** The bot's health, since when (ms), why, and the latency of its last reply (ms) if known. */
export interface Health {
  state: HealthState;
  since: number;
  reason: string;
  latency?: number;
}

/** What it keeps across a restart: the health, and when the bot last spoke. */
export interface HealthKept {
  health: Health;
  lastWord: number | null;
}

const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`;

export class HealthWatch {
  private readonly bot: string;
  private health: Health;
  /** When the bot last said anything, in any chat read. */
  private lastWord: number;
  /** When the oldest of its commands sent since its last word was sent. */
  private waiting: number | undefined;
  /** The probe sent this suspicion, if any: when, and its message. */
  private probe: { t: number; chat: string; id: string | undefined } | undefined;
  private readonly heard = new Map<string, number>();

  constructor(bot: string, kept?: HealthKept, now = 0) {
    this.bot = bot.toLowerCase();
    this.health = kept?.health ?? { state: 'up', since: now, reason: 'nothing heard yet' };
    this.lastWord = kept?.lastWord ?? -Infinity;
  }

  /** The health now. */
  current(): Health {
    return this.health;
  }

  /** What to keep across a restart. */
  kept(): HealthKept {
    return {
      health: this.health,
      lastWord: Number.isFinite(this.lastWord) ? this.lastWord : null,
    };
  }

  /** Whether `text` is one of the bot's commands this watch waits on, bare or addressed to it. */
  isCommand(text: string): boolean {
    const m = /^(\/\w+)(?:@(\w+))?(?:\s|$)/u.exec(text.trim());
    if (m === null) return false;
    if (m[2] !== undefined && m[2].toLowerCase() !== this.bot) return false;
    return HEALTH_COMMANDS.includes((m[1] as string).toLowerCase());
  }

  /** A message heard, anyone's, live (never one played back from history): the new health, if any. */
  hear(m: Heard): Health | undefined {
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      this.remember(m.chat, m.id, m.time);
      if (this.isCommand(m.text)) this.asked(m.chat, m.id, m.time, m.text, isPrivate(m));
      return undefined;
    }
    this.lastWord = Math.max(this.lastWord, m.time);
    this.waiting = undefined;
    const to = m.replyTo === undefined ? undefined : this.heard.get(`${m.chat}\n${m.replyTo}`);
    const lag = to === undefined ? undefined : m.time - to;
    // The probe's answer: the bot's first word in private after it, a reply or not.
    const probe = this.probe;
    if (probe !== undefined && isPrivate(m) && m.chat === probe.chat && m.time >= probe.t) {
      this.probe = undefined;
      const took = lag ?? m.time - probe.t;
      if (this.health.state === 'suspect' && took <= PROBE_WAIT_MS)
        return this.move('slow', m.time, `the probe was answered in ${seconds(took)}`, took);
    }
    if (lag !== undefined && lag <= REPLAY_MS)
      return this.health.state === 'up'
        ? this.note(lag)
        : this.move('up', m.time, `a reply in ${seconds(lag)}`, lag);
    const s = this.health.state;
    if (s === 'suspect' || s === 'down')
      return this.move(
        'catching-up',
        m.time,
        lag === undefined
          ? 'the bot speaks again, replying to nothing it can place'
          : `the bot replies again, ${seconds(lag)} late`,
        lag
      );
    return lag === undefined ? undefined : this.note(lag);
  }

  /** A command the owner's account sent (`actions.sent`), which it never hears come back. */
  sent(s: { chat: string; id?: string; t: number; command?: string }): Health | undefined {
    this.remember(s.chat, s.id, s.t);
    // No command named: a turn.
    const text = s.command ?? '/avventura';
    if (this.isCommand(text)) this.asked(s.chat, s.id, s.t, text, s.chat.startsWith('@'));
    return undefined;
  }

  /** The health at `now`, a silence long enough: the new health, if any. */
  tick(now: number): Health | undefined {
    const s = this.health.state;
    const waited = this.waiting === undefined ? -Infinity : now - this.waiting;
    if (s === 'up' && waited >= SUSPECT_MS) {
      this.probe = undefined;
      return this.move('suspect', now, `silent for ${seconds(waited)} while a command waited`);
    }
    if (s === 'suspect' && this.probe !== undefined && now - this.probe.t >= PROBE_WAIT_MS)
      return this.move('down', now, `the probe went unanswered for ${seconds(now - this.probe.t)}`);
    if ((s === 'suspect' || s === 'catching-up') && waited >= DOWN_MS)
      return this.move('down', now, `silent for ${seconds(waited)} while a command waited`);
    if (s === 'slow' && waited >= SLOW_DOWN_MS)
      return this.move('down', now, `silent for ${seconds(waited)}, though the probe was answered`);
    return undefined;
  }

  /** When a tick may next change the health (ms), if one can before anything is heard. */
  due(): number | undefined {
    const s = this.health.state;
    const after = (ms: number): number | undefined =>
      this.waiting === undefined ? undefined : this.waiting + ms;
    const times: (number | undefined)[] = [];
    if (s === 'up') times.push(after(SUSPECT_MS));
    if (s === 'suspect') {
      times.push(after(DOWN_MS));
      if (this.probe !== undefined) times.push(this.probe.t + PROBE_WAIT_MS);
    }
    if (s === 'catching-up') times.push(after(DOWN_MS));
    if (s === 'slow') times.push(after(SLOW_DOWN_MS));
    const known = times.filter((t): t is number => t !== undefined);
    return known.length === 0 ? undefined : Math.min(...known);
  }

  /** One of the bot's commands, sent at `t`: it waits, and a probe in private is the probe. */
  private asked(
    chat: string,
    id: string | undefined,
    t: number,
    text: string,
    inPrivate: boolean
  ): void {
    if (t > this.lastWord) this.waiting = Math.min(this.waiting ?? t, t);
    const probe = text.trim().split(/[\s@]/u)[0]?.toLowerCase() === PROBE_COMMAND;
    if (probe && inPrivate && this.health.state === 'suspect' && this.probe === undefined)
      this.probe = { t, chat, id };
  }

  private remember(chat: string, id: string | undefined, t: number): void {
    if (id === undefined) return;
    const key = `${chat}\n${id}`;
    this.heard.delete(key);
    this.heard.set(key, t);
    if (this.heard.size > KEPT_HEARD) this.heard.delete(this.heard.keys().next().value as string);
  }

  private move(state: HealthState, t: number, reason: string, latency?: number): Health {
    this.health = { state, since: t, reason, ...(latency === undefined ? {} : { latency }) };
    return this.health;
  }

  /** A live reply's latency, the health unchanged: kept, not news. */
  private note(latency: number): undefined {
    this.health = { ...this.health, latency };
    return undefined;
  }
}
