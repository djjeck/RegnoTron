/**
 * What the owner got from their turns, whoever sent them: each outcome the
 * parsers of the game bots read (@megabottron1999/turns/turn-parser.ts, the grammar of
 * modules/game-bots/src/replies.ts), kept in the documents of the `metagame` plugin's store, in
 * the order they came, with a cursor for the last time the owner asked for the list. Which
 * messages answer the owner's turns is the parsers' to tell. Outcomes that give nothing are kept too,
 * so that the list can say how many turns were empty.
 *
 * The entries are pages of up to `PAGE_SIZE` (`ledger-000001`, …), so that adding one rewrites a
 * page, not the whole ledger; the cursor is the document `cursor`. In an older version they were the lines
 * of `metagame-ledger.jsonl` and `metagame-cursor.json`, in the data volume's root, which the
 * plugin's migration adopts (`ledgerLines`, `cursorOf`, `pagesOf`).
 */
import { INVENTORYBOT, LOREGAMEBOT, type Outcome } from './replies.ts';

export interface LedgerEntry {
  /** When the bot told it, in ms. */
  t: number;
  outcome: Outcome;
}

/** Where the ledger keeps its documents: its plugin's store, or anything that reads and writes. */
export interface LedgerDocuments {
  read<T = unknown>(name: string): T | undefined;
  write(name: string, value: unknown): void;
  /** The documents' names, sorted. */
  names(): string[];
}

/** The bots whose gains `/loot` lists, in its order, unless told others. */
export const LOOT_BOTS: readonly string[] = [INVENTORYBOT, LOREGAMEBOT];

/** How many entries a page holds. */
export const PAGE_SIZE = 1000;
/** The cursor's document. */
export const CURSOR = 'cursor';
const PAGE = /^ledger-\d{6}$/u;

/** The name of the `n`th page, from 1, which sorts in the pages' order. */
export function pageName(n: number): string {
  return `ledger-${String(n).padStart(6, '0')}`;
}

/** Entries in their order, as pages from the `first`th. */
export function pagesOf(entries: readonly LedgerEntry[], first = 1): [string, LedgerEntry[]][] {
  const pages: [string, LedgerEntry[]][] = [];
  for (let i = 0; i < entries.length; i += PAGE_SIZE)
    pages.push([pageName(first + i / PAGE_SIZE), entries.slice(i, i + PAGE_SIZE)]);
  return pages;
}

/**
 * The entries of the older version's ledger file, in its order: a line cut short by a crash, or one
 * that is no entry, is skipped, as its reader skipped it.
 */
export function ledgerLines(text: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      const e = JSON.parse(line) as unknown;
      if (typeof e === 'object' && e !== null && !Array.isArray(e)) out.push(e as LedgerEntry);
    } catch {
      // A line cut short by a crash: the rest still counts.
    }
  }
  return out;
}

/** The time a cursor document or file holds, or 0 for one that makes no sense. */
export function cursorOf(value: unknown): number {
  const t = (value as { t?: unknown } | null | undefined)?.t;
  return typeof t === 'number' ? t : 0;
}

export class Ledger {
  private readonly docs: LedgerDocuments;
  /** The bots whose gains are listed, in their order. */
  private readonly bots: readonly string[];

  constructor(docs: LedgerDocuments, bots: readonly string[] = LOOT_BOTS) {
    this.docs = docs;
    this.bots = bots;
  }

  /** The pages' names, in their order. */
  private pages(): string[] {
    return this.docs.names().filter((n) => PAGE.test(n));
  }

  /** An outcome a parser read, after the others. */
  add(entry: LedgerEntry): void {
    const pages = this.pages();
    const last = pages.at(-1);
    const entries = last === undefined ? [] : (this.docs.read<LedgerEntry[]>(last) ?? []);
    if (last !== undefined && entries.length < PAGE_SIZE)
      this.docs.write(last, [...entries, entry]);
    else this.docs.write(pageName(pages.length + 1), [entry]);
  }

  /** The time of the last list, or 0 before the first. */
  cursor(): number {
    return cursorOf(this.docs.read(CURSOR));
  }

  /** The entries told after the last list, in the order they came. */
  unread(): LedgerEntry[] {
    const since = this.cursor();
    const out: LedgerEntry[] = [];
    for (const page of this.pages())
      for (const e of this.docs.read<LedgerEntry[]>(page) ?? []) if (e.t > since) out.push(e);
    return out;
  }

  /** Moves the cursor: what was told up to `t` is read. */
  markRead(t: number): void {
    this.docs.write(CURSOR, { t });
  }

  /**
   * The list since the last one, and the cursor moved past what it shows. The cursor goes to the
   * newest entry listed, not to now: an entry is stamped with the bot's time, and one stamped just
   * before now may still be on its way.
   */
  take(): string {
    const since = this.cursor();
    const entries = this.unread();
    const text = formatLoot(entries, since, this.bots);
    if (entries.length > 0) this.markRead(Math.max(...entries.map((e) => e.t)));
    return text;
  }
}

/** What the empty turns' reasons read as in the list. */
const NOTHING: Record<Extract<Outcome, { kind: 'nothing' }>['reason'], string> = {
  cooldown: 'too soon',
  defeated: 'fight lost',
  lost: 'item lost in a fight',
  calm: '"Stai calmo maschio"',
  unregistered: 'not registered',
};

/** Telegram's limit is 4096 characters; the list stops short of it. */
const MAX_LENGTH = 3800;

/**
 * The owner's list of what came since `since` (0: ever): the items per bot, in the order of `bots`
 * (a bot not among them is left out), the same item counted once with how many, then the empty
 * turns and what was not understood.
 */
export function formatLoot(
  entries: readonly LedgerEntry[],
  since: number,
  bots: readonly string[] = LOOT_BOTS
): string {
  const when =
    since === 0
      ? 'Since the ledger began'
      : `Since ${new Date(since).toLocaleString('en-GB', {
          timeZone: 'Europe/Rome',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })} (Italian time)`;
  if (entries.length === 0) return `${when}: nothing new.`;
  const lines = [`${when}:`];
  for (const bot of bots) {
    const counts = new Map<string, number>();
    for (const { outcome: o } of entries) {
      if (o.kind !== 'gain' || o.bot !== bot) continue;
      const line = `${o.item.replace(/\s*\n\s*/gu, ' ')} [${o.rarity}]${o.sure ? '' : ' (name guessed)'}`;
      counts.set(line, (counts.get(line) ?? 0) + (o.count ?? 1));
    }
    if (counts.size === 0) continue;
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    lines.push('', `${bot}, ${total} item${total === 1 ? '' : 's'}:`);
    for (const [line, n] of counts) lines.push(`- ${line}${n > 1 ? ` ×${n}` : ''}`);
  }
  const empty = new Map<string, number>();
  for (const { outcome: o } of entries)
    if (o.kind === 'nothing') empty.set(NOTHING[o.reason], (empty.get(NOTHING[o.reason]) ?? 0) + 1);
  if (empty.size > 0)
    lines.push('', `Nothing: ${[...empty].map(([why, n]) => `${n} ${why}`).join(', ')}`);
  const unknown = entries.filter((e) => e.outcome.kind === 'unknown').length;
  if (unknown > 0) lines.push(`Not understood: ${unknown} (in the ledger)`);
  let text = lines.join('\n');
  if (text.length > MAX_LENGTH) {
    const cut = text.lastIndexOf('\n', MAX_LENGTH);
    const left = text.slice(cut + 1).split('\n').length;
    text = `${text.slice(0, cut)}\n… and ${left} more lines`;
  }
  return text;
}
