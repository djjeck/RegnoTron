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
import { z } from 'zod';
import { INVENTORYBOT, LOREGAMEBOT, TURN_COMMANDS } from '#src/replies.ts';
import { epiclorelecPlugin } from './epiclorelec.ts';
import { inventorybotPlugin } from './inventorybot.ts';
import { loregamePlugin } from './loregame.ts';
import {
  LEDGER_GAMES,
  LEGACY_CURSOR_FILE,
  LEGACY_LEDGER_FILE,
  metagamePlugin,
  NO_LOOT,
  RETIRED_TIMER,
} from './metagame.ts';

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metagame-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-11-01T11:00:00Z');
const KNOWN = 'il re di Quamser, contento delle tue gesta, ti elargisce ';

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
  it('brings the last send in from /data/metagame.json, and keeps it in its store', async () => {
    fs.writeFileSync(path.join(dataDir, 'metagame.json'), '{"last":1730000000000}\n');
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(metagamePlugin());
    await core.start();
    expect(core.state('metagame')?.state).toBe('running');
    expect(
      JSON.parse(fs.readFileSync(path.join(dataDir, 'plugins', 'metagame', 'state.json'), 'utf8'))
    ).toEqual({ last: 1730000000000 });
    expect(await loot(core)).toBe(NO_LOOT);
  });

  it("drops the plan of the older version's own turn", async () => {
    const store = path.join(dataDir, 'plugins', 'metagame');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, '_meta.json'), '{"version":1}');
    fs.writeFileSync(
      path.join(store, '_timers.json'),
      JSON.stringify({ [RETIRED_TIMER]: { at: T0 + 60_000, late: 'fire', graceMs: 600_000 } })
    );
    fs.writeFileSync(path.join(store, 'state.json'), '{"last":1}');
    const lines: string[] = [];
    const clock = new VirtualClock(T0);
    const core = new Core({ clock, dataDir, print: (l) => lines.push(l) });
    core.register(metagamePlugin());
    await core.start();
    clock.advance(120_000);
    expect(lines.some((l) => l.includes('own turn is retired'))).toBe(true);
    expect(lines.some((l) => l.includes('has no onTimer'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(store, '_timers.json'), 'utf8'))).toEqual({});
    expect(JSON.parse(fs.readFileSync(path.join(store, 'state.json'), 'utf8'))).toEqual({
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
      config: {
        inventorybot: { commands: TURN_COMMANDS[INVENTORYBOT] },
        loregame: { commands: TURN_COMMANDS[LOREGAMEBOT] },
      },
    });
    core.register(
      fakeConnectorPlugin(TELEGRAM_USER, account),
      inventorybotPlugin(),
      loregamePlugin(),
      metagamePlugin({ ledger: true })
    );
    await core.start();
    account.hear({
      chat: '@InventoryBot',
      sender: 'InventoryBot',
      time: T0,
      text: `@alice, ${KNOWN}un salame [C]!`,
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

  it('brings the ledger and its cursor in from the data volume, and /loot answers as before', async () => {
    const entry = (t: number, outcome: object) => JSON.stringify({ t, outcome });
    const gain = (bot: string, item: string, rarity: string, sure = true) => ({
      kind: 'gain',
      bot,
      item,
      rarity,
      tags: [],
      sure,
    });
    // As the older version's ledger wrote it: one line per outcome, in the order they came, the
    // last cut short by a crash.
    fs.writeFileSync(
      path.join(dataDir, LEGACY_LEDGER_FILE),
      [
        entry(T0 - 60_000, gain('InventoryBot', 'un salame', 'C')),
        entry(T0 + 60_000, gain('LoreGameBot', "un'aquila cieca", 'B1')),
        entry(T0 + 120_000, gain('InventoryBot', 'una pulce fastidiosa', 'C')),
        entry(T0 + 180_000, { kind: 'nothing', bot: 'LoreGameBot', reason: 'defeated' }),
        entry(T0 + 240_000, gain('InventoryBot', 'una pulce fastidiosa', 'C')),
        entry(T0 + 300_000, gain('InventoryBot', 'una nave', 'N', false)),
        entry(T0 + 360_000, {
          kind: 'unknown',
          bot: 'LoreGameBot',
          text: 'È giunto il livello 5!',
        }),
        '{"t":1793',
      ].join('\n')
    );
    fs.writeFileSync(path.join(dataDir, LEGACY_CURSOR_FILE), `${JSON.stringify({ t: T0 })}\n`);
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(metagamePlugin({ ledger: true }));
    await core.start();
    expect(core.state('metagame')?.state).toBe('running');
    for (const f of [LEGACY_LEDGER_FILE, LEGACY_CURSOR_FILE]) {
      expect(fs.existsSync(path.join(dataDir, f))).toBe(false);
      expect(fs.existsSync(path.join(dataDir, `${f}.migrated`))).toBe(true);
    }
    const store = path.join(dataDir, 'plugins', 'metagame');
    expect(
      fs
        .readdirSync(store)
        .filter((f) => !f.startsWith('_'))
        .sort()
    ).toEqual(['cursor.json', 'ledger-000001.json']);
    expect(
      JSON.parse(fs.readFileSync(path.join(store, 'ledger-000001.json'), 'utf8'))
    ).toHaveLength(7);
    expect(await loot(core)).toBe(
      [
        'Since 1 Nov, 12:00 (Italian time):',
        '',
        'InventoryBot, 3 items:',
        '- una pulce fastidiosa [C] ×2',
        '- una nave [N] (name guessed)',
        '',
        'LoreGameBot, 1 item:',
        "- un'aquila cieca [B1]",
        '',
        'Nothing: 1 fight lost',
        'Not understood: 1 (in the ledger)',
      ].join('\n')
    );
    expect(await loot(core)).toBe('Since 1 Nov, 12:06 (Italian time): nothing new.');
    await core.stop();
    // A restart migrates nothing again, and keeps the cursor moved.
    const again = new Core({ clock: new VirtualClock(T0), dataDir });
    again.register(metagamePlugin({ ledger: true }));
    await again.start();
    expect(await loot(again)).toBe('Since 1 Nov, 12:06 (Italian time): nothing new.');
  });

  it('starts an empty ledger without the files, and reads a cursor that makes no sense as none', async () => {
    fs.writeFileSync(path.join(dataDir, LEGACY_CURSOR_FILE), 'yesterday');
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(metagamePlugin({ ledger: true }));
    await core.start();
    expect(core.state('metagame')?.state).toBe('running');
    expect(fs.existsSync(path.join(dataDir, `${LEGACY_CURSOR_FILE}.migrated`))).toBe(true);
    expect(await loot(core)).toBe('Since the ledger began: nothing new.');
  });

  it('declares the games it spans as events inputs, bound to their parsers, not @EpicLorelecBot', async () => {
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(
      fakeConnectorPlugin(TELEGRAM_USER, new FakeConnector({ account: 'telegram:alice' })),
      inventorybotPlugin(),
      loregamePlugin(),
      epiclorelecPlugin(),
      metagamePlugin({ ledger: true })
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
    core.register(
      fakeConnectorPlugin(TELEGRAM_USER, account),
      epiclorelecPlugin(),
      metagamePlugin({ ledger: true })
    );
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

  it('takes another game as its list says, listing its gains in that order', async () => {
    // A game of the shape a later parser may have (a fishing game's): its own namespace and type.
    const fish: Plugin = definePlugin({
      manifest: {
        id: 'fish',
        version: '0.1.0',
        kinds: ['parser'],
        description: 'a game of tests',
        games: { registers: ['fish'] },
        events: { 'fish.catch': z.object({ outcome: z.looseObject({ kind: z.string() }) }) },
      },
      create: (ctx) => ({
        // Once every plugin has started, the ledger's subscription among them.
        ready: () => {
          for (const [t, item] of [
            [T0, 'un tonno'],
            [T0 + 1000, 'una sarda'],
          ] as const)
            ctx.bus.publish(
              'fish.catch',
              {
                outcome: { kind: 'gain', bot: 'FishBot', item, rarity: 'C', tags: [], sure: true },
              },
              t
            );
        },
      }),
    });
    const core = new Core({ clock: new VirtualClock(T0), dataDir });
    core.register(
      fish,
      metagamePlugin({
        ledger: true,
        games: [{ namespace: 'fish', type: 'fish.catch', bot: 'FishBot' }, ...LEDGER_GAMES],
      })
    );
    await core.start();
    expect(await loot(core)).toBe(
      'Since the ledger began:\n\nFishBot, 2 items:\n- un tonno [C]\n- una sarda [C]'
    );
  });
});
