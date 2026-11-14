import { TELEGRAM_USER } from '@megabottron1999/connectors/plugins/telegram-user.ts';
import {
  type Answer,
  Core,
  definePlugin,
  FakeConnector,
  fakeConnectorPlugin,
  type Plugin,
  VirtualClock,
} from '@megabottron1999/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inventorybotStandIn } from '#test/inventorybot.ts';
import { epiclorelecPlugin } from './epiclorelec.ts';
import { loregamePlugin } from './loregame.ts';
import {
  LEDGER_GAMES,
  type MetagameInterface,
  metagamePlugin,
  NO_LOOT,
  plugins,
} from './metagame.ts';

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metagame-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-11-01T11:00:00Z');

/** What `/loot` answers. */
async function loot(core: Core): Promise<string> {
  const command = core.commands().find((c) => c.name === 'loot');
  let text = '';
  await command?.run(
    { text: (t: string) => (text = t) } as unknown as Answer,
    {
      args: '',
      asker: { id: '1', owner: true },
    } as never
  );
  return text;
}

describe('metagamePlugin', () => {
  it('is its entry’s one plugin, and keeps no ledger when its config says so', async () => {
    expect(plugins).toEqual([metagamePlugin]);
    const core = new Core({
      clock: new VirtualClock(T0),
      dataDir,
      config: { metagame: { ledger: false } },
    });
    core.register(metagamePlugin);
    await core.start();
    expect(core.state('metagame')?.state).toBe('running');
    expect(await loot(core)).toBe(NO_LOOT);
    await expect(core.controls.act('metagame', 'add', { t: T0, outcomes: [] })).resolves.toEqual({
      output: { added: 0 },
    });
  });

  it('starts on a store at version 2, its migrations no-ops', async () => {
    const store = path.join(dataDir, 'instances', 'metagame');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, '_meta.json'), '{"version":2}');
    fs.writeFileSync(path.join(store, 'cursor.json'), '{"last":1}');
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(metagamePlugin);
    await core.start();
    expect(core.state('metagame')?.state).toBe('running');
    expect(JSON.parse(fs.readFileSync(path.join(store, 'cursor.json'), 'utf8'))).toEqual({
      last: 1,
    });
  });

  it("keeps what the parsers read of alice's turns, and lists it with /loot", async () => {
    const account = new FakeConnector({ account: 'telegram:alice' });
    const lines: string[] = [];
    const core = new Core({
      clock: new VirtualClock(T0),
      dataDir,
      print: (l) => lines.push(l),
    });
    core.register(
      fakeConnectorPlugin(TELEGRAM_USER, account),
      inventorybotStandIn,
      loregamePlugin,
      metagamePlugin
    );
    await core.start();
    account.hear({
      chat: '@InventoryBot',
      sender: 'InventoryBot',
      time: T0,
      text: '@alice, un salame [C]!',
    });
    account.hear({
      chat: '@LoreGameBot',
      sender: 'alice',
      own: true,
      id: '5',
      time: T0,
      text: '/avventura',
    });
    account.hear({
      chat: '@LoreGameBot',
      sender: 'LoreGameBot',
      replyTo: '5',
      time: T0 + 1000,
      text: 'È giunto il livello 5!',
    });
    const text = await loot(core);
    expect(text).toContain('InventoryBot, 1 item:\n- un salame [C]');
    expect(text).toContain('Not understood: 1');
    expect(lines.some((l) => l.includes('not understood from LoreGameBot'))).toBe(true);
    expect(await loot(core)).toContain('nothing new');
  });

  it('declares the games it spans as events inputs, bound to their parsers, not @EpicLorelecBot', async () => {
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(
      fakeConnectorPlugin(TELEGRAM_USER, new FakeConnector({ account: 'telegram:alice' })),
      inventorybotStandIn,
      loregamePlugin,
      epiclorelecPlugin,
      metagamePlugin
    );
    core.load();
    expect(LEDGER_GAMES.map((g) => g.namespace)).toEqual(['inventorybot', 'loregame']);
    const edges = core
      .graph()
      ?.edges.filter((e) => e.to.startsWith('metagame.'))
      .map((e) => `${e.from} → ${e.to}`);
    expect(edges).toEqual([
      'inventorybot.events → metagame.inventorybot-events',
      'loregame.events → metagame.loregame-events',
    ]);
  });

  it("keeps @EpicLorelecBot's count out of the ledger", async () => {
    const account = new FakeConnector({ account: 'telegram:alice' });
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(fakeConnectorPlugin(TELEGRAM_USER, account), epiclorelecPlugin, metagamePlugin);
    await core.start();
    account.hear({
      chat: '@EpicLorelecBot',
      sender: 'alice',
      own: true,
      id: '7',
      time: T0,
      text: '/avventura',
    });
    account.hear({
      chat: '@EpicLorelecBot',
      sender: 'EpicLorelecBot',
      time: T0 + 1000,
      text: 'Complimenti 78, alice, mi hai rotto il cazzo 53 volte!',
    });
    expect(await loot(core)).toBe('Since the ledger began: nothing new.');
  });

  it('takes another game’s outcomes through its action, listing its gains as its config says', async () => {
    // A game of the shape a later parser may have (a fishing game's), bound to the ledger's action.
    const fish: Plugin = definePlugin({
      manifest: {
        id: 'fish',
        version: '0.1.0',
        kinds: ['parser'],
        description: 'a game of tests',
        inputs: {
          ledger: { type: 'interface', plugin: 'metagame', members: ['actions.add'] },
        },
      },
      create: (ctx) => ({
        ready: () => {
          const { actions } = ctx.use<MetagameInterface>('ledger');
          const gain = (item: string) => ({
            kind: 'gain',
            bot: 'FishBot',
            item,
            rarity: 'C',
            tags: [],
            sure: true,
          });
          expect(actions.add({ t: T0, outcomes: [gain('un tonno')] })).toEqual({ added: 1 });
          actions.add({ t: T0 + 1000, outcomes: [gain('una sarda')] });
        },
      }),
    });
    const core = new Core({
      clock: new VirtualClock(T0),
      dataDir,
      config: { metagame: { bots: ['FishBot', 'InventoryBot'] } },
    });
    core.register(metagamePlugin, fish);
    await core.start();
    expect(await loot(core)).toBe(
      'Since the ledger began:\n\nFishBot, 2 items:\n- un tonno [C]\n- una sarda [C]'
    );
  });
});
