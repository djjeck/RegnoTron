import { type Store } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import {
  InventoryKnowledge,
  KNOWLEDGE_DOC,
  MAX_ITEMS,
  MAX_PREFIXES,
  prefixForms,
} from './inventorybot-knowledge.ts';
import { INVENTORYBOT_PREFIXES } from './inventorybot-prefixes.ts';

/** A store in memory, counting its writes. */
function memory(docs: Record<string, unknown> = {}): Store & { writes: number } {
  const store = {
    writes: 0,
    read: <T>(name: string) => docs[name] as T | undefined,
    write: (name: string, value: unknown) => {
      store.writes++;
      docs[name] = value;
    },
    remove: (name: string) => {
      delete docs[name];
    },
    names: () => Object.keys(docs).sort(),
  };
  return store;
}

const SHIPPED = 'il re di Quamser, contento delle tue gesta, ti elargisce ';

describe('prefixForms', () => {
  it('adds the line-break form of a final space', () => {
    expect(prefixForms('nel bosco trovi ')).toEqual(['nel bosco trovi ', 'nel bosco trovi\n']);
    expect(prefixForms('nel bosco trovi:')).toEqual(['nel bosco trovi:']);
  });
});

describe('InventoryKnowledge', () => {
  it('starts with the shipped prefixes, in both forms, and nothing learned', () => {
    const k = new InventoryKnowledge(memory());
    expect(INVENTORYBOT_PREFIXES).toContain(SHIPPED);
    expect([...k.prefixes]).toEqual(expect.arrayContaining([SHIPPED, SHIPPED.trimEnd() + '\n']));
    expect([k.items.size, k.learned.size]).toEqual([0, 0]);
  });

  it('learns items and prefixes, writing the store only for something new', () => {
    const store = memory();
    const k = new InventoryKnowledge(store);
    k.learn('una giuggiola', 'nel fosso trovi ');
    k.learn('una giuggiola', 'nel fosso trovi ');
    k.learn('un sasso', SHIPPED);
    k.learn('', '');
    expect(store.writes).toBe(2);
    expect(store.read(KNOWLEDGE_DOC)).toEqual({
      items: ['una giuggiola', 'un sasso'],
      prefixes: ['nel fosso trovi ', 'nel fosso trovi\n'],
    });
    expect([...new InventoryKnowledge(store).items]).toEqual(['una giuggiola', 'un sasso']);
  });

  it('drops the oldest beyond its bounds', () => {
    const store = memory();
    const k = new InventoryKnowledge(store);
    for (let i = 0; i <= MAX_ITEMS; i++) k.learn(`oggetto ${i}`, '');
    for (let i = 0; i <= MAX_PREFIXES; i++) k.learn('', `frase ${i}:`);
    expect(k.items.size).toBe(MAX_ITEMS);
    expect(k.items.has('oggetto 0')).toBe(false);
    expect(k.items.has(`oggetto ${MAX_ITEMS}`)).toBe(true);
    expect(k.learned.size).toBe(MAX_PREFIXES);
    expect(k.learned.has('frase 0:')).toBe(false);
  });

  it('reads back within its bounds, and ignores a store it cannot read', () => {
    const items = Array.from({ length: MAX_ITEMS + 2 }, (_, i) => `oggetto ${i}`);
    const k = new InventoryKnowledge(
      memory({ [KNOWLEDGE_DOC]: { items, prefixes: [SHIPPED, 'nel fosso trovi '] } })
    );
    expect(k.items.size).toBe(MAX_ITEMS);
    expect(k.items.has('oggetto 1')).toBe(false);
    expect([...k.learned]).toEqual(['nel fosso trovi ']);
    expect(new InventoryKnowledge(memory({ [KNOWLEDGE_DOC]: { items: 3 } })).items.size).toBe(0);
  });
});
