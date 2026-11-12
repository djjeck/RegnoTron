import { TELEGRAM_USER } from '@megabottron1999/connectors/plugins/telegram-user.ts';
import {
  Core,
  FakeConnector,
  fakeConnectorPlugin,
  GraphFile,
  VirtualClock,
} from '@megabottron1999/core';
import { runParser as run, T0 } from '@megabottron1999/turns/test/parser-run.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPICLORELECBOT, INVENTORYBOT, LOREGAMEBOT, TURN_COMMANDS } from '#src/replies.ts';
import { EPICLORELEC_PARSER, epiclorelecPlugin, plugins as epiclorelec } from './epiclorelec.ts';
import {
  INVENTORYBOT_PARSER,
  inventorybotPlugin,
  plugins as inventorybot,
} from './inventorybot.ts';
import { LOREGAME_PARSER, loregamePlugin, plugins as loregame } from './loregame.ts';

const GROUP = '-1001000000001';
const MIN = 60_000;
const KNOWN = 'il re di Quamser, contento delle tue gesta, ti elargisce ';

describe('the inventorybot parser', () => {
  it("reads alice's drops in either chat, and the cooldown in private, with the rests", async () => {
    const p = await run(inventorybotPlugin, {}, GROUP);
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
    const p = await run(inventorybotPlugin);
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

  it('reads no gain in a /mostra reply, and an announced [W] drop to alice', async () => {
    const p = await run(inventorybotPlugin, {}, GROUP);
    const bot = { sender: 'InventoryBot', chat: GROUP };
    p.hear({ ...bot, text: '@alice, mostri orgogliosamente di possedere 3x una giuggiola [C]' });
    expect(p.outcomes()).toEqual([]);
    p.hear({ ...bot, text: `[W] @alice il pizzaiolo, ${KNOWN}un baule 📦 [S] [usabile]!` });
    expect(p.events).toMatchObject([
      {
        chat: GROUP,
        outcome: {
          kind: 'gain',
          bot: 'InventoryBot',
          item: 'un baule 📦',
          rarity: 'S',
          tags: ['usabile'],
          sure: true,
        },
      },
    ]);
  });

  it("learns the items of anyone's drops, and starts from what its store kept", async () => {
    const p = await run(inventorybotPlugin, {}, GROUP);
    const bot = { sender: 'InventoryBot', chat: GROUP };
    p.hear({ ...bot, text: `@lucia, ${KNOWN}una giuggiola [C]!` });
    // A sentence it never shipped, before the item it learned: sure.
    p.hear({ ...bot, text: '@alice, nel fosso trovi una giuggiola [C]!' });
    // Unknown sentence and item: the grammar's guess, which says so.
    p.hear({ ...bot, text: '@alice, sul molo raccogli una conchiglia [N]!' });
    expect(p.events.map((e) => e['outcome'])).toMatchObject([
      { item: 'una giuggiola', sure: true },
      { item: 'una conchiglia', sure: false },
    ]);
    const q = await run(inventorybotPlugin, {}, GROUP, {
      knowledge: { items: ['una conchiglia'], prefixes: ['sul molo raccogli '] },
    });
    q.hear({ ...bot, text: '@alice, sul molo raccogli un granchio [C]!' });
    expect(q.events[0]).toMatchObject({ outcome: { item: 'un granchio', sure: true } });
  });

  it('reports a lucky adventure it cannot read', async () => {
    const p = await run(inventorybotPlugin);
    p.hear({
      chat: '@InventoryBot',
      sender: 'InventoryBot',
      text: "Complimenti @alice, questa e' l'avventura FORTUNATA del giorno! Hai vinto: qualcosa",
    });
    expect(p.outcomes()).toEqual(['unknown']);
  });
});

describe('the game bots’ parsers', () => {
  it('count their bot’s own turn commands, named in their specs, with no config', () => {
    for (const plugin of [inventorybotPlugin, loregamePlugin, epiclorelecPlugin])
      expect(plugin.manifest.config).toBeUndefined();
    expect([...inventorybot, ...loregame, ...epiclorelec]).toEqual([
      inventorybotPlugin,
      loregamePlugin,
      epiclorelecPlugin,
    ]);
  });

  it('run on a graph saved while their nodes named commands, which they ignore', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-parsers-'));
    try {
      const bots = [
        [INVENTORYBOT_PARSER, INVENTORYBOT],
        [LOREGAME_PARSER, LOREGAMEBOT],
        [EPICLORELEC_PARSER, EPICLORELECBOT],
      ] as const;
      // A version 2 graph, as saved before: each parser node with its commands as config.
      const graph = {
        version: 2,
        nodes: [
          { id: TELEGRAM_USER, plugin: TELEGRAM_USER },
          ...bots.map(([id]) => ({ id, plugin: id, config: { commands: ['/play'] } })),
        ],
        edges: bots.map(([id, bot]) => ({
          from: `${TELEGRAM_USER}.chat`,
          to: `${id}.chat`,
          type: 'chat-in',
          reads: [`@${bot}`],
          senders: [`@${bot}`, 'me'],
        })),
      };
      fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(graph));
      const account = new FakeConnector({ account: 'telegram:alice' });
      const turns: string[] = [];
      const core = new Core({
        clock: new VirtualClock(T0),
        graphFile: new GraphFile(dir),
        record: (r) => {
          if (r.type.endsWith('.turn')) turns.push(`${r.type} ${String(r['chat'])}`);
        },
      });
      core.register(
        fakeConnectorPlugin(TELEGRAM_USER, account),
        inventorybotPlugin,
        loregamePlugin,
        epiclorelecPlugin
      );
      await core.start();
      expect(core.graphProblems()).toEqual([]);
      expect(core.status().every((s) => s.state === 'running')).toBe(true);
      // In private, an unreadable first answer to a turn is claimed: only to a turn it counts.
      for (const [, bot] of bots) {
        const chat = `@${bot}`;
        const own = { chat, sender: 'alice', own: true, time: T0 };
        account.hear({ ...own, text: '/play' });
        account.hear({ chat, sender: bot, time: T0, text: 'Nothing like a turn.' });
        for (const command of TURN_COMMANDS[bot]) {
          account.hear({ ...own, text: command });
          account.hear({ chat, sender: bot, time: T0, text: 'Nothing like a turn.' });
        }
      }
      expect(turns).toEqual([
        'inventorybot.turn @InventoryBot',
        'loregame.turn @LoreGameBot',
        'epiclorelec.turn @EpicLorelecBot',
        'epiclorelec.turn @EpicLorelecBot',
      ]);
      await core.stop();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
