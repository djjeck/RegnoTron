import { describe, expect, it } from 'vitest';
import {
  cursorOf,
  formatLoot,
  Ledger,
  type LedgerDocuments,
  type LedgerEntry,
  PAGE_SIZE,
  pageName,
  pagesOf,
} from './ledger.ts';

const T0 = Date.parse('2026-11-01T11:00:00Z');

/** Documents in memory, as a store keeps them (JSON, names sorted). */
function documents(): LedgerDocuments & { docs: Map<string, string> } {
  const docs = new Map<string, string>();
  return {
    docs,
    read: <T>(name: string) => {
      const text = docs.get(name);
      return text === undefined ? undefined : (JSON.parse(text) as T);
    },
    write: (name, value) => docs.set(name, JSON.stringify(value)),
    names: () => [...docs.keys()].sort(),
  };
}

const drop = (item: string, t = T0): LedgerEntry => ({
  t,
  outcome: { kind: 'gain', bot: 'InventoryBot', item, rarity: 'C', tags: [], sure: true },
});

describe('Ledger', () => {
  it('lists what came after the cursor, across restarts', () => {
    const docs = documents();
    const l = new Ledger(docs);
    expect(l.cursor()).toBe(0);
    expect(l.unread()).toEqual([]);
    l.add(drop('un fermacarte di gelatina', T0));
    l.add(drop('un tostapane lunare', T0 + 60_000));
    l.markRead(T0);
    const again = new Ledger(docs);
    expect(again.cursor()).toBe(T0);
    expect(again.unread().map((e) => e.outcome)).toMatchObject([{ item: 'un tostapane lunare' }]);
  });

  it('reads a cursor that makes no sense as none', () => {
    const docs = documents();
    docs.write('cursor', { t: 'yesterday' });
    expect(new Ledger(docs).cursor()).toBe(0);
  });

  it('starts a page when one is full, and reads them in their order', () => {
    const docs = documents();
    for (const [name, page] of pagesOf(
      Array.from({ length: PAGE_SIZE }, (_, i) => drop(`un oggetto ${i}`, T0 + i))
    ))
      docs.write(name, page);
    const l = new Ledger(docs);
    l.add(drop('un fermacarte di gelatina', T0 - 1));
    l.add(drop('un tostapane lunare', T0 + 5));
    expect(docs.names()).toEqual([pageName(1), pageName(2)]);
    expect(docs.read<LedgerEntry[]>(pageName(2))).toHaveLength(2);
    const unread = l.unread();
    expect(unread).toHaveLength(PAGE_SIZE + 2);
    expect(unread.at(-2)?.outcome).toMatchObject({ item: 'un fermacarte di gelatina' });
    expect(unread.at(-1)?.outcome).toMatchObject({ item: 'un tostapane lunare' });
  });

  it('leaves alone the documents that are not its pages', () => {
    const docs = documents();
    docs.write('state', { last: 1 });
    const l = new Ledger(docs);
    l.add(drop('un fermacarte di gelatina'));
    expect(docs.names()).toEqual([pageName(1), 'state']);
    expect(l.unread()).toHaveLength(1);
  });
});

describe('Ledger.take', () => {
  it('lists the unread entries and moves the cursor to the newest one listed', () => {
    const l = new Ledger(documents());
    expect(l.take()).toBe('Since the ledger began: nothing new.');
    expect(l.cursor()).toBe(0);
    l.add(drop('un fermacarte di gelatina', T0 + 60_000));
    l.add(drop('un tostapane lunare', T0));
    expect(l.take()).toContain('InventoryBot, 2 items:');
    expect(l.cursor()).toBe(T0 + 60_000);
    expect(l.take()).toBe('Since 1 Nov, 12:01 (Italian time): nothing new.');
  });
});

describe('the documents', () => {
  it('reads the cursor, or 0', () => {
    expect(cursorOf({ t: T0 })).toBe(T0);
    expect(cursorOf({ t: 'yesterday' })).toBe(0);
    expect(cursorOf(null)).toBe(0);
    expect(cursorOf(undefined)).toBe(0);
  });

  it('pages entries from the page asked', () => {
    const entries = Array.from({ length: PAGE_SIZE * 2 + 1 }, (_, i) => drop(`x${i}`, i));
    const pages = pagesOf(entries, 3);
    expect(pages.map(([n, p]) => [n, p.length])).toEqual([
      ['ledger-000003', PAGE_SIZE],
      ['ledger-000004', PAGE_SIZE],
      ['ledger-000005', 1],
    ]);
    expect(pages.flatMap(([, p]) => p)).toEqual(entries);
    expect(pagesOf([])).toEqual([]);
  });
});

describe('formatLoot', () => {
  const gain = (bot: 'InventoryBot' | 'LoreGameBot', item: string, rarity: string, sure = true) =>
    ({ t: T0, outcome: { kind: 'gain', bot, item, rarity, tags: [], sure } }) as LedgerEntry;
  const nothing = (reason: 'cooldown' | 'defeated' | 'lost' | 'calm' | 'unregistered') =>
    ({ t: T0, outcome: { kind: 'nothing', bot: 'LoreGameBot', reason } }) as LedgerEntry;

  it('groups the items per bot, counts repeats, then the empty turns and the unknown', () => {
    expect(
      formatLoot(
        [
          gain('LoreGameBot', 'lo ZUCCOTTO 🥩', 'B1'),
          gain('InventoryBot', 'un fermacarte di gelatina', 'C'),
          gain('InventoryBot', 'un fermacarte di gelatina', 'C'),
          gain('InventoryBot', 'una lanterna storta', 'N', false),
          gain('LoreGameBot', '👍🏽\n👉🏽 /avventura\n👍🏽', 'M1'),
          nothing('cooldown'),
          nothing('cooldown'),
          nothing('defeated'),
          nothing('lost'),
          nothing('calm'),
          nothing('unregistered'),
          { t: T0, outcome: { kind: 'unknown', bot: 'LoreGameBot', text: '?' } },
        ],
        T0
      )
    ).toBe(
      [
        'Since 1 Nov, 12:00 (Italian time):',
        '',
        'InventoryBot, 3 items:',
        '- un fermacarte di gelatina [C] ×2',
        '- una lanterna storta [N] (name guessed)',
        '',
        'LoreGameBot, 2 items:',
        '- lo ZUCCOTTO 🥩 [B1]',
        '- 👍🏽 👉🏽 /avventura 👍🏽 [M1]',
        '',
        'Nothing: 2 too soon, 1 fight lost, 1 item lost in a fight, 1 "Stai calmo maschio", 1 not registered',
        'Not understood: 1 (in the ledger)',
      ].join('\n')
    );
  });

  it('says "1 item", and leaves out a bot with none', () => {
    expect(formatLoot([gain('LoreGameBot', 'un tostapane lunare', 'M1')], 0)).toBe(
      'Since the ledger began:\n\nLoreGameBot, 1 item:\n- un tostapane lunare [M1]'
    );
  });

  it('lists the bots in the order given, and only those', () => {
    const entries = [
      gain('InventoryBot', 'un fermacarte di gelatina', 'C'),
      gain('LoreGameBot', 'un tostapane lunare', 'M1'),
    ];
    expect(formatLoot(entries, 0, ['LoreGameBot', 'InventoryBot'])).toBe(
      'Since the ledger began:\n\nLoreGameBot, 1 item:\n- un tostapane lunare [M1]\n\nInventoryBot, 1 item:\n- un fermacarte di gelatina [C]'
    );
    expect(formatLoot(entries, 0, ['LoreGameBot'])).toBe(
      'Since the ledger began:\n\nLoreGameBot, 1 item:\n- un tostapane lunare [M1]'
    );
  });

  it("stops short of Telegram's limit, saying how much is left out", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      gain('InventoryBot', `un oggetto numero ${i}`, 'C')
    );
    const text = formatLoot(many, 0);
    expect(text.length).toBeLessThan(4096);
    expect(text).toMatch(/\n… and \d+ more lines$/u);
  });
});
