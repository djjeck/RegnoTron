import { runParser as run, T0 } from '@megabottron1999/turns/test/parser-run.ts';
import { describe, expect, it } from 'vitest';
import { EPICLORELECBOT, INVENTORYBOT, LOREGAMEBOT, TURN_COMMANDS } from '#src/replies.ts';
import { epiclorelecPlugin, plugins as epiclorelec } from './epiclorelec.ts';
import { inventorybotPlugin, plugins as inventorybot } from './inventorybot.ts';
import { loregamePlugin, plugins as loregame } from './loregame.ts';

const CONFIG = { commands: TURN_COMMANDS[INVENTORYBOT] };

const GROUP = '-1001000000001';
const MIN = 60_000;
const KNOWN = 'il re di Quamser, contento delle tue gesta, ti elargisce ';

describe('the inventorybot parser', () => {
  it("reads alice's drops in either chat, and the cooldown in private, with the rests", async () => {
    const p = await run(inventorybotPlugin, CONFIG, GROUP);
    const bot = { sender: 'InventoryBot' };
    p.hear({ ...bot, chat: '@InventoryBot', text: `@alice, ${KNOWN}una giuggiola [C]!` });
    expect(p.iface.rest()).toMatchObject({ until: T0 + 15 * MIN, why: 'its rest after a turn' });
    p.hear({ ...bot, chat: GROUP, text: `@alice, ${KNOWN}un baule 📦 [R] [usabile]!` });
    // Others' drops and the group's cooldown are none of its business.
    p.hear({ ...bot, chat: GROUP, text: `@lucia, ${KNOWN}un baule [R]!` });
    p.hear({ ...bot, chat: GROUP, text: 'Troppo presto, devi riposare ancora per 3 minuti prima' });
    p.kit.runUntil(T0 + MIN);
    p.hear({
      ...bot,
      chat: '@InventoryBot',
      text: 'Troppo presto, devi riposare ancora per 20 minuti prima di poterti avventurare di nuovo.',
    });
    expect(p.outcomes()).toEqual(['gain', 'gain', 'nothing']);
    expect(p.events[2]).toMatchObject({
      chat: '@InventoryBot',
      outcome: { reason: 'cooldown', retryMs: 20 * MIN },
    });
    expect(p.iface.rest()).toMatchObject({ until: T0 + 21 * MIN, why: 'it said too soon' });
    p.kit.runUntil(T0 + 22 * MIN);
    expect(p.iface.rest()).toBeUndefined();
    expect(p.drift()).toMatchObject({ read: 3, unread: 0 });
  });

  it('claims the first message after a turn in private, and reports it to drift if unread', async () => {
    const p = await run(inventorybotPlugin, CONFIG);
    p.hear({ chat: '@InventoryBot', sender: 'alice', own: true, text: '/avventura' });
    p.hear({ chat: '@InventoryBot', sender: 'InventoryBot', text: 'Qualcosa di nuovo' });
    // Only the first; and nothing once the window has passed.
    p.hear({ chat: '@InventoryBot', sender: 'InventoryBot', text: 'Ancora altro' });
    await p.iface.sent({ chat: '@InventoryBot', t: p.kit.clock.now() });
    p.kit.runUntil(T0 + 3 * MIN);
    p.hear({ chat: '@InventoryBot', sender: 'InventoryBot', text: 'Più tardi' });
    expect(p.outcomes()).toEqual(['unknown']);
    expect(p.drift()).toMatchObject({ unread: 1 });
  });

  it('reports a lucky adventure it cannot read', async () => {
    const p = await run(inventorybotPlugin, CONFIG);
    p.hear({
      chat: '@InventoryBot',
      sender: 'InventoryBot',
      text: "Complimenti @alice, questa e' l'avventura FORTUNATA del giorno! Hai vinto: qualcosa",
    });
    expect(p.outcomes()).toEqual(['unknown']);
  });
});

describe('the game bots’ parsers', () => {
  it('count their bot’s own turn commands unless their config names others', () => {
    for (const [plugin, bot] of [
      [inventorybotPlugin, INVENTORYBOT],
      [loregamePlugin, LOREGAMEBOT],
      [epiclorelecPlugin, EPICLORELECBOT],
    ] as const) {
      expect(plugin.manifest.config?.parse({})).toEqual({ commands: TURN_COMMANDS[bot] });
      expect(plugin.manifest.config?.parse({ commands: ['/play'] })).toEqual({
        commands: ['/play'],
      });
    }
    expect([...inventorybot, ...loregame, ...epiclorelec]).toEqual([
      inventorybotPlugin,
      loregamePlugin,
      epiclorelecPlugin,
    ]);
  });
});
