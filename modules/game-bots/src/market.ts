/**
 * @LoreGameBot's market, the "📈 Mercato Fazionario 📉" (docs/game-bots.md §5.11), as the `loregame`
 * parser reads it. Pure, but for what a plugin hands it.
 *
 * Its companies are made and run by players (`/creaazienda`, a leader and members), each quoted at a
 * value that the bot moves at each update. A company is named as the market writes it, its emoji
 * included (its leader may change them): "F.R.O.D.E. Capital Partners ⚖️". The bot writes:
 *
 * - **An update**, of its own, every few hours, and when its developer asks (`/aggiornaborsa`,
 *   `/aggiornamercato`): "📈 Mercato Fazionario 📉 aggiornato!", then a line a company:
 *   "↗ <company>: <value> (<change>, <pct>%)", its arrow the direction (↗ up, ↘ down, → flat).
 * - **The market** (`/mercato`, `/borsa`): "📈 Mercato Fazionario 📉", the same lines (or "Nessuna
 *   azienda quotata.", and nothing more), then the asker's investments: "I tuoi investimenti", a line each, "> <company>:
 *   <n> ₭ investiti, valore <n> ₭ (<pct>%)", and the totals; or "Non hai investimenti attivi.".
 * - **An investment** (`/punta`, `/investi`): "Hai puntato <n> ₭ su <company>.", "Totale investito:
 *   <n> ₭ al valore iniziale <value>.", "Ti rimangono <n> ₭." One open a company: another is refused.
 * - **A withdrawal** (`/riscuoti`, `/ritira`): "Hai riscosso <n> ₭ da <company>.", "Incasso: <n> ₭
 *   (<pct>%).", and, for a part, "Valore rimasto: <n> ₭."; or all of them at once, "Hai riscosso
 *   tutti gli investimenti dal 📈 Mercato Fazionario 📉.", a line each, "> <company>: <n> ₭ investiti,
 *   incasso <n> ₭", and the totals.
 * - **A company** (`/azienda`): "Azienda <name> (<members>/<max>)", "👑 <leader>", "⚔️ <power>", "👥 <n>
 *   membri", a line a member, "- <faction> <player> [L<level>] (<power> ⚔️)", "📈 Valore: <value>",
 *   at times "Profilo: <profile>". It names the company without its emoji.
 *
 * None of the answers replies to its command [M]: each follows it within seconds, as `/accumulo`'s
 * do, and a watch pairs it with the command waiting (`src/answer-watch.ts`). An update needs none:
 * it is everyone's. Numbers are written with the bot's thousands ("1.341"); percentages with a
 * decimal point ("+9.25").
 */
import { AnswerWatch } from '#src/answer-watch.ts';

/** Where a company's value went at the last update. */
export type Direction = 'up' | 'down' | 'flat';

/** A company as the market quotes it. */
export interface Quote {
  company: string;
  value: number;
  /** Since the update before. */
  change: number;
  pct: number;
  direction: Direction;
}

/** An open investment, as the market lists it to its player. */
export interface Position {
  company: string;
  invested: number;
  /** What it is worth now. */
  value: number;
  pct: number;
}

/** A member of a company. */
export interface Member {
  player: string;
  /** Their faction's emoji: 😇, 👿, 👤. */
  faction: string;
  level: number;
  power: number;
}

/** What a market message says. */
export type MarketReply =
  | { kind: 'update'; quotes: Quote[] }
  | {
      kind: 'market';
      quotes: Quote[];
      /** The asker's investments: none open (`[]`), or each; not told (none quoted), none. */
      positions: Position[] | null;
      total: { invested: number; value: number; pct: number } | null;
    }
  | {
      kind: 'invest';
      company: string;
      amount: number;
      /** All that is invested in it now, and the value it was entered at. */
      invested: number;
      entry: number;
      /** What the investor has left. */
      coins: number;
    }
  | {
      kind: 'cashout';
      company: string;
      /** Of what was invested. */
      amount: number;
      cashed: number;
      pct: number;
      /** What is still invested there, at its value; none when all of it was taken. */
      left: number | null;
    }
  | {
      kind: 'cashout-all';
      positions: { company: string; invested: number; cashed: number }[];
      invested: number;
      cashed: number;
      pct: number;
    }
  | {
      kind: 'company';
      /** As the page writes it: without its emoji. */
      name: string;
      size: number;
      max: number;
      leader: string;
      power: number;
      members: Member[];
      value: number;
      profile: string | null;
    };

/** "1.341": the bot's thousands. */
const num = (s: string): number => Number(s.replaceAll('.', ''));
/** "+9.25", "-0.88", "0.00": a percentage. */
const pctOf = (s: string): number => Number(s);

const MARKET = '📈 Mercato Fazionario 📉';
const DIRECTIONS: Record<string, Direction> = { '↗': 'up', '↘': 'down', '→': 'flat' };
const QUOTE = /^([↗↘→]) (.+): (\d[\d.]*) \(([+-]?\d[\d.]*), ([+-]?\d+(?:\.\d+)?)%\)$/u;
const POSITION = /^> (.+): (\d[\d.]*) ₭ investiti, valore (\d[\d.]*) ₭ \(([+-]?\d+(?:\.\d+)?)%\)$/u;
const TOTAL = /^Totale investito: (\d[\d.]*) ₭$/u;
const WORTH = /^Valore attuale: (\d[\d.]*) ₭ \(([+-]?\d+(?:\.\d+)?)%\)$/u;
const INVEST =
  /^Hai puntato (\d[\d.]*) ₭ su (.+)\.\nTotale investito: (\d[\d.]*) ₭ al valore iniziale (\d[\d.]*)\.\nTi rimangono (\d[\d.]*) ₭\.$/u;
const CASHOUT =
  /^Hai riscosso (\d[\d.]*) ₭ da (.+)\.\nIncasso: (\d[\d.]*) ₭ \(([+-]?\d+(?:\.\d+)?)%\)\.(?:\nValore rimasto: (\d[\d.]*) ₭\.)?$/u;
const ALL = `Hai riscosso tutti gli investimenti dal ${MARKET}.`;
const CASHED = /^> (.+): (\d[\d.]*) ₭ investiti, incasso (\d[\d.]*) ₭$/u;
const WITHDRAWN = /^Totale ritirato: (\d[\d.]*) ₭$/u;
const CASHED_TOTAL = /^Incasso totale: (\d[\d.]*) ₭ \(([+-]?\d+(?:\.\d+)?)%\)$/u;
const COMPANY = /^Azienda (.+) \((\d+)\/(\d+)\)$/u;
const MEMBER = /^- (\S+) (\S+) \[L(\d+)\] \((\d[\d.]*) ⚔️\)$/u;

/** The quotes of `lines`, each a company's; none if any line is not one. */
function quotesOf(lines: readonly string[]): Quote[] | undefined {
  const quotes: Quote[] = [];
  for (const l of lines) {
    const m = QUOTE.exec(l);
    if (m === null) return undefined;
    quotes.push({
      company: m[2] as string,
      value: num(m[3] as string),
      change: (m[4] as string).startsWith('-')
        ? -num((m[4] as string).slice(1))
        : num((m[4] as string).replace(/^\+/u, '')),
      pct: pctOf(m[5] as string),
      direction: DIRECTIONS[m[1] as string] as Direction,
    });
  }
  return quotes;
}

/** The message's blocks, split at its blank lines. */
const blocks = (text: string): string[][] =>
  text.split(/\n\s*\n/u).map((b) =>
    b
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
  );

/** The market message `raw` is, if one: the whole message, its every line read. */
export function parseMarket(raw: string): MarketReply | undefined {
  const text = raw.normalize('NFC').trim();
  const [head, ...rest] = blocks(text);
  const first = head?.[0];
  if (first === `${MARKET} aggiornato!`) {
    const quotes = quotesOf([...(head as string[]).slice(1), ...rest.flat()]);
    return quotes === undefined ? undefined : { kind: 'update', quotes };
  }
  if (first === MARKET) return marketOf([...(head as string[]).slice(1), ...rest.flat()]);
  const invest = INVEST.exec(text);
  if (invest !== null)
    return {
      kind: 'invest',
      amount: num(invest[1] as string),
      company: invest[2] as string,
      invested: num(invest[3] as string),
      entry: num(invest[4] as string),
      coins: num(invest[5] as string),
    };
  const cashout = CASHOUT.exec(text);
  if (cashout !== null)
    return {
      kind: 'cashout',
      amount: num(cashout[1] as string),
      company: cashout[2] as string,
      cashed: num(cashout[3] as string),
      pct: pctOf(cashout[4] as string),
      left: cashout[5] === undefined ? null : num(cashout[5]),
    };
  if (first === ALL) return cashoutAllOf([...(head as string[]).slice(1), ...rest.flat()]);
  if (first !== undefined && COMPANY.test(first)) return companyOf(text);
  return undefined;
}

/** The market's lines after its title: the quotes, then the asker's investments. */
function marketOf(lines: readonly string[]): MarketReply | undefined {
  const mine = lines.findIndex(
    (l) => l === 'I tuoi investimenti' || l === 'Non hai investimenti attivi.'
  );
  if (mine < 0)
    return lines.length === 1 && lines[0] === 'Nessuna azienda quotata.'
      ? { kind: 'market', quotes: [], positions: null, total: null }
      : undefined;
  const quoted = lines.slice(0, mine);
  const quotes =
    quoted.length === 1 && quoted[0] === 'Nessuna azienda quotata.' ? [] : quotesOf(quoted);
  if (quotes === undefined) return undefined;
  if (lines[mine] === 'Non hai investimenti attivi.')
    return mine === lines.length - 1
      ? { kind: 'market', quotes, positions: [], total: null }
      : undefined;
  const positions: Position[] = [];
  let i = mine + 1;
  for (; i < lines.length; i++) {
    const m = POSITION.exec(lines[i] as string);
    if (m === null) break;
    positions.push({
      company: m[1] as string,
      invested: num(m[2] as string),
      value: num(m[3] as string),
      pct: pctOf(m[4] as string),
    });
  }
  const total = TOTAL.exec(lines[i] ?? '');
  const worth = WORTH.exec(lines[i + 1] ?? '');
  if (total === null || worth === null || i + 2 !== lines.length) return undefined;
  return {
    kind: 'market',
    quotes,
    positions,
    total: {
      invested: num(total[1] as string),
      value: num(worth[1] as string),
      pct: pctOf(worth[2] as string),
    },
  };
}

/** All investments withdrawn: a line each, then the totals. */
function cashoutAllOf(lines: readonly string[]): MarketReply | undefined {
  const positions: { company: string; invested: number; cashed: number }[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const m = CASHED.exec(lines[i] as string);
    if (m === null) break;
    positions.push({
      company: m[1] as string,
      invested: num(m[2] as string),
      cashed: num(m[3] as string),
    });
  }
  const withdrawn = WITHDRAWN.exec(lines[i] ?? '');
  const cashed = CASHED_TOTAL.exec(lines[i + 1] ?? '');
  if (withdrawn === null || cashed === null || i + 2 !== lines.length) return undefined;
  return {
    kind: 'cashout-all',
    positions,
    invested: num(withdrawn[1] as string),
    cashed: num(cashed[1] as string),
    pct: pctOf(cashed[2] as string),
  };
}

/** A company's page. */
function companyOf(text: string): MarketReply | undefined {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const head = COMPANY.exec(lines[0] ?? '');
  const leader = /^👑 (.+)$/u.exec(lines[1] ?? '');
  const power = /^⚔️ (\d[\d.]*)$/u.exec(lines[2] ?? '');
  const size = /^👥 (\d+) membri$/u.exec(lines[3] ?? '');
  if (head === null || leader === null || power === null || size === null) return undefined;
  const members: Member[] = [];
  let i = 4;
  for (; i < lines.length; i++) {
    const m = MEMBER.exec(lines[i] as string);
    if (m === null) break;
    members.push({
      faction: m[1] as string,
      player: m[2] as string,
      level: Number(m[3]),
      power: num(m[4] as string),
    });
  }
  const value = /^📈 Valore: (\d[\d.]*)$/u.exec(lines[i] ?? '');
  if (value === null) return undefined;
  const profile = /^Profilo: (.+)$/u.exec(lines[i + 1] ?? '');
  if (i + (profile === null ? 1 : 2) !== lines.length) return undefined;
  return {
    kind: 'company',
    name: head[1] as string,
    size: Number(head[2]),
    max: Number(head[3]),
    leader: leader[1] as string,
    power: num(power[1] as string),
    members,
    value: num(value[1] as string),
    profile: profile === null ? null : (profile[1] as string),
  };
}

/** The market's commands, as a player types them: the market, an investment, a withdrawal, a company. */
export const MARKET_COMMANDS: readonly string[] = ['/mercato', '/borsa'];
export const INVEST_COMMANDS: readonly string[] = ['/punta', '/investi'];
export const CASHOUT_COMMANDS: readonly string[] = ['/riscuoti', '/ritira'];
export const COMPANY_COMMANDS: readonly string[] = ['/azienda'];
/** The developer's, which make an update out of turn. */
export const FORCE_COMMANDS: readonly string[] = ['/aggiornaborsa', '/aggiornamercato'];

/**
 * The answers to a player's market command, paired with it (`AnswerWatch`): the market listed
 * (its investments the asker's), an investment, a withdrawal.
 */
export class MarketWatch extends AnswerWatch<MarketReply> {
  constructor(bot: string, commands: readonly string[], kinds: readonly MarketReply['kind'][]) {
    super({
      bot,
      commands,
      args: true,
      parse: (text) => {
        const r = parseMarket(text);
        return r !== undefined && kinds.includes(r.kind) ? r : undefined;
      },
    });
  }
}

/**
 * An update made out of turn: the answer to the developer's command, whoever sent it; never one
 * without a command waiting, which is the bot's own.
 */
export class ForcedWatch extends AnswerWatch<MarketReply> {
  constructor(bot: string) {
    super({
      bot,
      commands: FORCE_COMMANDS,
      parse: (text) => {
        const r = parseMarket(text);
        return r?.kind === 'update' ? r : undefined;
      },
      ownerless: () => false,
    });
  }
}

/** How a value was told: the bot's update, one forced out of turn, a market listed. */
export type Via = 'update' | 'forced' | 'listing';

/** A point of a company's series. */
export interface Point {
  /** When, ISO. */
  t: string;
  value: number;
  change: number;
  pct: number;
  via: Via;
}

/** The most points a company's series keeps: the oldest go first. */
export const SERIES_KEPT = 3000;
/** Two updates told within this are one (the same message heard twice). */
const SAME_MS = 2 * 60_000;

/**
 * `series` with `p` in its place by time, unless it says nothing new: the same update heard again
 * (told the same way, the same value and change, within `SAME_MS`: one forced a minute after the
 * bot's own is another), or a listing of the value the point before it holds. The oldest
 * dropped past `SERIES_KEPT`. Pure.
 */
export function withPoint(series: readonly Point[], p: Point): Point[] {
  const t = Date.parse(p.t);
  // Its place, from the end: most points come last.
  let at = series.length;
  while (at > 0 && Date.parse((series[at - 1] as Point).t) > t) at--;
  const before = series[at - 1];
  if (p.via === 'listing') {
    if (before?.value === p.value) return [...series];
  } else {
    // The same update told again lies within `SAME_MS` of its place, on either side.
    for (const side of [-1, 1])
      for (let i = side < 0 ? at - 1 : at; i >= 0 && i < series.length; i += side) {
        const x = series[i] as Point;
        if (Math.abs(Date.parse(x.t) - t) > SAME_MS) break;
        if (x.via === p.via && x.value === p.value && x.change === p.change) return [...series];
      }
  }
  const next = [...series.slice(0, at), p, ...series.slice(at)];
  return next.length > SERIES_KEPT ? next.slice(next.length - SERIES_KEPT) : next;
}

/**
 * The bot's own updates, as their times tell (docs/game-bots.md §5.11): no clock is assumed. The
 * interval between two is learned as the one most seen (to 5 minutes) among the latest, once seen
 * three times; with it, an update a whole number of intervals after the last is on schedule, the
 * ones between missed; one off it is out of turn. The schedule moves with the bot's clock (summer
 * time, a new hour): an update off it that the next one follows by an interval is the new schedule,
 * and both are on it.
 */
export interface Schedule {
  /** The latest update on schedule, ISO; none yet. */
  last: string | null;
  /** The interval learned, in minutes; none yet. */
  period_min: number | null;
  /** The latest intervals seen between two updates on schedule, in minutes. */
  gaps_min: number[];
  /** The updates expected and not seen, ISO, latest last. */
  missed: string[];
  /** The latest update off the schedule, ISO: the new one, if the next follows it by an interval. */
  pending: string | null;
}

/** The intervals kept to learn from, and the updates missed kept. */
const GAPS_KEPT = 12;
const MISSED_KEPT = 100;
/** How far from the schedule an update may come and still be on it. */
const SLACK_MIN = 10;

export function initialSchedule(): Schedule {
  return { last: null, period_min: null, gaps_min: [], missed: [], pending: null };
}

/** The interval most seen among `gaps`, to 5 minutes, if seen three times at least. */
function periodOf(gaps: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const g of gaps) {
    const k = Math.round(g / 5) * 5;
    if (k > 0) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: [number, number] | undefined;
  for (const [k, n] of counts) if (best === undefined || n > best[1]) best = [k, n];
  return best !== undefined && best[1] >= 3 ? best[0] : null;
}

/**
 * The schedule after an update of the bot's own at `t` (ms): whether it is on schedule (an update
 * out of turn moves nothing), and the schedule then; `moved`, the update before it that turned out
 * to start the schedule anew (ISO), told out of turn when it came. One older than the last, or the
 * same one heard again, changes nothing. Pure.
 */
export function scheduled(
  s: Schedule,
  t: number
): { on: boolean; schedule: Schedule; moved?: string } {
  if (s.last === null) return { on: true, schedule: { ...s, last: new Date(t).toISOString() } };
  const last = Date.parse(s.last);
  const gap = (t - last) / 60_000;
  const p = s.period_min;
  // The same update heard again: on schedule, nothing new.
  if (Math.abs(gap) < SAME_MS / 60_000) return { on: true, schedule: s };
  const k = p === null ? 1 : Math.round(gap / p);
  const onGrid = p === null || Math.abs(gap - k * p) <= SLACK_MIN;
  // One older than the last (history told late): on schedule if on its grid, moving nothing.
  if (gap < 0) return { on: onGrid, schedule: s };
  if (!onGrid && p !== null) {
    // An interval after the one before it off the schedule: the schedule moved, from that one.
    const pending = s.pending === null ? null : Date.parse(s.pending);
    if (pending !== null && pending < t && Math.abs((t - pending) / 60_000 - p) <= SLACK_MIN)
      return {
        on: true,
        moved: s.pending as string,
        schedule: { ...s, last: new Date(t).toISOString(), pending: null },
      };
    return { on: false, schedule: { ...s, pending: new Date(t).toISOString() } };
  }
  const missed =
    p === null || k < 2
      ? []
      : Array.from({ length: k - 1 }, (_, i) =>
          new Date(last + (i + 1) * p * 60_000).toISOString()
        );
  const gaps = k === 1 ? [...s.gaps_min, Math.round(gap)].slice(-GAPS_KEPT) : s.gaps_min;
  return {
    on: true,
    schedule: {
      last: new Date(t).toISOString(),
      period_min: periodOf(gaps) ?? p,
      gaps_min: gaps,
      missed: [...s.missed, ...missed].slice(-MISSED_KEPT),
      pending: null,
    },
  };
}
