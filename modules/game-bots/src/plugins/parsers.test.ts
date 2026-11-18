import { TELEGRAM_USER } from '@megabottron1999/connectors/plugins/telegram-user.ts';
import {
  Core,
  FakeConnector,
  fakeConnectorPlugin,
  GraphFile,
  VirtualClock,
} from '@megabottron1999/core';
import { T0 } from '@megabottron1999/turns/test/parser-run.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EPICLORELECBOT, LOREGAMEBOT, TURN_COMMANDS } from '#src/replies.ts';
import {
  EPICLORELEC_PARSER,
  epiclorelecPlugin,
  epiclorelecReadyPlugin,
  plugins as epiclorelec,
} from './epiclorelec.ts';
import { LOREGAME_PARSER, loregamePlugin, plugins as loregame } from './loregame.ts';
import { loregameStatePlugin } from './loregame-state.ts';

describe('the game bots’ parsers', () => {
  it('count their bot’s own turn commands, named in their specs, with no config', () => {
    for (const plugin of [loregamePlugin, epiclorelecPlugin])
      expect(plugin.manifest.config).toBeUndefined();
    expect([...loregame, ...epiclorelec]).toEqual([
      loregamePlugin,
      epiclorelecPlugin,
      epiclorelecReadyPlugin,
    ]);
  });

  it('declare one turn each, by the bot’s own command, then /avventura, abbreviations last', () => {
    // The owner's order (bot-os.md D140): a player takes the first on a tie of reach. Declared by
    // the states a player binds to, in their parsers' words (D141).
    expect(epiclorelecReadyPlugin.manifest.botCommands).toEqual([
      { command: '/rompimiilcazzo', aliases: ['/avventura'], turn: true },
    ]);
    expect(loregameStatePlugin.manifest.botCommands?.[0]).toEqual({
      command: '/lore',
      aliases: ['/avventura', '/l'],
      turn: true,
    });
  });

  it('run on a graph saved while their nodes named commands, which they ignore', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-parsers-'));
    try {
      const bots = [
        [LOREGAME_PARSER, LOREGAMEBOT],
        [EPICLORELEC_PARSER, EPICLORELECBOT],
      ] as const;
      // A version 2 graph, as saved before: each parser node with its commands as config.
      const graph = {
        version: 2,
        nodes: [
          { id: TELEGRAM_USER, plugin: TELEGRAM_USER, account: 'telegram:alice' },
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
      core.register(fakeConnectorPlugin(TELEGRAM_USER, account), loregamePlugin, epiclorelecPlugin);
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
        'loregame.turn @LoreGameBot',
        'loregame.turn @LoreGameBot',
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
