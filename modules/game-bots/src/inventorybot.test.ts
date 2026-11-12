import { type Store } from '@megabottron1999/core';
import { type BotMessage } from '@megabottron1999/turns/turn-parser.ts';
import { describe, expect, it } from 'vitest';
import { readInventoryBot } from './inventorybot.ts';
import { InventoryKnowledge } from './inventorybot-knowledge.ts';

const KNOWN = 'il re di Quamser, contento delle tue gesta, ti elargisce ';

function knowledge(): InventoryKnowledge {
  const docs: Record<string, unknown> = {};
  const store: Store = {
    read: <T>(name: string) => docs[name] as T | undefined,
    write: (name, value) => void (docs[name] = value),
    remove: (name) => void delete docs[name],
    names: () => Object.keys(docs),
  };
  return new InventoryKnowledge(store);
}

/** A message of the bot, in the group unless said otherwise, to alice's account. */
const msg = (text: string, more: Partial<BotMessage> = {}): BotMessage => ({
  text,
  private: false,
  answers: false,
  replies: false,
  self: 'alice',
  ...more,
});

const gain = (item: string, rarity: string, more: object = {}) => ({
  outcome: { kind: 'gain', bot: 'InventoryBot', item, rarity, tags: [], sure: true, ...more },
  restMs: 15 * 60_000,
});

describe('readInventoryBot', () => {
  it("reads alice's drop, with its rarity and tags, the addressee in any case", () => {
    expect(
      readInventoryBot(msg(`@ALice, ${KNOWN}un baule di quercia 📦 [R] [usabile]!`), knowledge())
    ).toEqual(gain('un baule di quercia 📦', 'R', { tags: ['usabile'] }));
  });

  it('reads an addressee with a title, an announced drop, and a rarity with a plus', () => {
    const k = knowledge();
    expect(readInventoryBot(msg(`@alice il pizzaiolo, ${KNOWN}una giuggiola [C+]!`), k)).toEqual(
      gain('una giuggiola', 'C+')
    );
    expect(readInventoryBot(msg(`[W] @alice, ${KNOWN}un bullone [N]!`), k)).toEqual(
      gain('un bullone', 'N')
    );
  });

  it('reads the lucky adventure, and keeps one it cannot read as unread', () => {
    const lucky = "Complimenti @alice, questa e' l'avventura FORTUNATA del giorno! Hai vinto: ";
    expect(readInventoryBot(msg(`${lucky}una Sfera del Grillo ⭐️ [X]`), knowledge())).toEqual(
      gain('una Sfera del Grillo ⭐️', 'X')
    );
    expect(readInventoryBot(msg(`${lucky}qualcosa`), knowledge())).toEqual({ unread: true });
  });

  it('reads the item of a composed text, and guesses it after an unknown sentence', () => {
    expect(readInventoryBot(msg(`@alice, ${KNOWN}un caffè [C]!`), knowledge())).toMatchObject({
      outcome: { item: 'un caffè' },
    });
    expect(
      readInventoryBot(msg("@alice, nel fango trovi un'ancora [C]!"), knowledge())
    ).toMatchObject({ outcome: { item: "un'ancora", sure: false } });
  });

  it("learns from others' drops, and reads none of them as alice's", () => {
    const k = knowledge();
    expect(readInventoryBot(msg(`@bravo, ${KNOWN}un pesante bullone [C]!`), k)).toBeUndefined();
    expect(readInventoryBot(msg('@bravo, nel fosso trovi un pesante bullone [C]!'), k)).toBe(
      undefined
    );
    expect([...k.items, ...k.learned]).toEqual([
      'un pesante bullone',
      'nel fosso trovi ',
      'nel fosso trovi\n',
    ]);
    expect(readInventoryBot(msg('@alice, nel fosso trovi un dado [R]!'), k)).toEqual(
      gain('un dado', 'R')
    );
  });

  it('reads no gain in a /mostra reply, nor in others', () => {
    for (const text of [
      '@alice, mostri orgogliosamente di possedere 3x una giuggiola farinosa [N]',
      '@alice, possiedi:',
      'alice, hai: > un generatore [X] x1',
    ])
      expect(readInventoryBot(msg(text), knowledge())).toBeUndefined();
  });

  it('reads the cooldown in private only, with its wait or the rest', () => {
    const cooldown =
      'Troppo presto, devi riposare ancora per 9 minuti e 29 secondi prima di poterti avventurare di nuovo.';
    expect(readInventoryBot(msg(cooldown, { private: true }), knowledge())).toEqual({
      outcome: { kind: 'nothing', bot: 'InventoryBot', reason: 'cooldown', retryMs: 569_000 },
      restMs: 569_000,
    });
    expect(
      readInventoryBot(msg('Troppo presto, riposati!', { private: true }), knowledge())
    ).toMatchObject({ outcome: { retryMs: 15 * 60_000 } });
    expect(readInventoryBot(msg(cooldown), knowledge())).toBeUndefined();
  });

  it('claims what else answers a turn in private, and nothing without the account', () => {
    expect(
      readInventoryBot(msg('Qualcosa di nuovo', { private: true, answers: true }), knowledge())
    ).toEqual({ unread: true });
    expect(readInventoryBot(msg('Qualcosa di nuovo', { private: true }), knowledge())).toBe(
      undefined
    );
    expect(
      readInventoryBot(msg(`@alice, ${KNOWN}una giuggiola [C]!`, { self: undefined }), knowledge())
    ).toBeUndefined();
  });
});
