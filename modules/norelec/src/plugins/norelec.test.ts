import { ircPlugin } from '@megabottron1999/connectors/plugins/irc.ts';
import { IRC_CONFIG, IRC_SECRETS } from '@megabottron1999/connectors/test/irc.ts';
import { type TransportEvents } from '@megabottron1999/connectors/transport/transport.ts';
import {
  type BusEvent,
  Core,
  definePlugin,
  type Graph,
  MemoryEventLog,
  type OutboxHandle,
  parseManifest,
  VirtualClock,
} from '@megabottron1999/core';
import { secretsWith } from '@megabottron1999/core/test/secrets.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BotMessage } from '#src/game/bot-message.ts';
import { withChats } from '#test/graph.ts';
import {
  ACCOUNTS,
  botMessageOf,
  MESSAGE_EVENT,
  messagesOf,
  type NorelecInterface,
  norelecPlugin,
  plugins,
  readExportRow,
  readLogged,
  TICK_MS,
} from './norelec.ts';
import { type NorelecGame } from './norelec-game.ts';

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'norelec-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
const RAID = 'Alfa parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.';
const AT_GIANPIER =
  'Juno (🎈) hai bucato il palloncino di @Gianpier il lombardo (🎈) e rubato 5 palle! Torni in Juno tra 1 minuto.';
const JUNO_LEAVES = 'Juno parti per Alfa: arrivi tra 10 minuti. Casa tua resta scoperta.';

/**
 * The norelec plugin and a plugin that follows its messages on a core over `dataDir`, with a fake IRC client: `say`
 * puts a line of the bot's on the channel and lets a second pass, `hear` only puts it there,
 * `status` a change of the connection.
 */
function setup(
  logged: { time: number; text: string }[] = [],
  history: { time: number; text: string }[] = [],
  joined = false,
  config: Record<string, unknown> = {},
  more: { irc?: Record<string, unknown>; graph?: (g: Graph) => Graph } = {}
) {
  let now = T0;
  const clock = new VirtualClock(now);
  const logged2: BusEvent[] = [];
  const lines: string[] = [];
  const heard: BotMessage[] = [];
  let irc: TransportEvents | undefined;
  // The event log before the start: the whole log's bot messages, then the last hours'.
  const log = new MemoryEventLog(
    [...logged, ...history].map(({ time, text }) => ({ type: MESSAGE_EVENT, t: time, text }))
  );
  const core = new Core({
    clock,
    dataDir,
    config: {
      irc: { ...IRC_CONFIG, ...more.irc },
      norelec: { channel: IRC_CONFIG.channel, restS: 60, self: 'alice', ...config },
    },
    graph: (defaults) =>
      (more.graph ?? ((g) => g))(
        withChats(defaults, 'norelec.channel', { reads: [IRC_CONFIG.channel] })
      ),
    secrets: secretsWith(IRC_SECRETS),
    events: log,
    record: (r) => {
      logged2.push(r as BusEvent);
      log.write(r);
    },
    print: (l) => lines.push(l),
    validateEvents: true,
  });
  core.register(
    ircPlugin({
      nick: 'alice',
      client: (_options, events) => {
        irc = events;
        const start = (): void => {
          events.status('registered');
          if (joined) events.status('joined');
        };
        return { start, say: () => true, stop() {} };
      },
    }),
    definePlugin({
      manifest: {
        id: 'follower',
        version: '0.1.0',
        kinds: ['stats'],
        description: 'follows the bot messages',
        requires: ['norelec'],
        games: { consumes: ['norelec'] },
      },
      create: (ctx) => {
        ctx.bus.subscribe(MESSAGE_EVENT, (e) => heard.push(botMessageOf(e)));
        ctx.bus.subscribe(MESSAGE_EVENT, () => {
          throw new Error('a broken part');
        });
        ctx.bus.subscribe(MESSAGE_EVENT, (e) => heard.push(botMessageOf(e)));
        return {};
      },
    }),
    norelecPlugin
  );
  const game = (): NorelecGame => {
    const g = core.controls.read('norelec', 'game');
    if (!('value' in g)) throw new Error(g.error);
    return g.value as NorelecGame;
  };
  const say = (text: string, playback = false): void => {
    irc?.line({ nick: 'NorelecBot', text, time: now, playback });
    now += 1000;
    clock.advanceTo(now);
  };
  return {
    core,
    hear: (text: string) => irc?.line({ nick: 'NorelecBot', text, time: now, playback: false }),
    later: (ms: number) => {
      now += ms;
      clock.advanceTo(now);
    },
    game,
    bus: logged2,
    lines,
    heard,
    say,
    status: (s: 'joined' | 'closed', detail?: string) => irc?.status(s, detail),
  };
}

describe('the norelec plugin', () => {
  it('reads the channel into its game, and publishes each bot message to the parts that follow', async () => {
    const { core, game: gameOf, bus, lines, heard, say, status } = setup();
    await core.start();
    const game = gameOf();
    expect(core.status().map((s) => s.id)).toEqual(['irc', 'norelec', 'follower']);
    // The connector's status at once, then each change; irc prints them.
    expect(lines).toContain('irc: registered');
    expect(game.health.connected).toBe(false);
    status('joined');
    expect(game.health.connected).toBe(true);
    say(RAID);
    expect(heard).toHaveLength(2);
    expect(heard[0]).toMatchObject({ time: T0, text: RAID });
    expect(game.state.players.get('Alfa')?.location).toBe('travelling');
    expect(lines).toContain('follower: error: on norelec.message: a broken part');
    expect(bus.filter((r) => r.type === 'norelec.message')).toEqual([
      {
        type: 'norelec.message',
        t: T0,
        text: RAID,
        events: heard[0]?.events,
        source: 'irc',
        instance: 'norelec',
      },
    ]);
    // The lines and the statuses are irc's, the notices on the bus; played back, a line is
    // logged and not read.
    say(RAID, true);
    expect(bus.filter((r) => r.type.startsWith('irc.')).map((r) => r.type)).toEqual([
      'irc.status',
      'irc.status',
      'irc.line',
      'irc.line',
    ]);
    expect(bus.filter((r) => r.type === 'norelec.notice')).toEqual([
      {
        type: 'norelec.notice',
        t: T0 + 91_000,
        instance: 'norelec',
        notice: expect.objectContaining({ kind: 'incomingRaid', player: 'Bravo', by: 'Alfa' }),
      },
    ]);
    expect(core.drift()).toEqual([
      { parser: 'norelec', read: 1, unread: 0, recent: 0, tripped: false },
    ]);
    // A line no template knows: the message is unread, and logged with it.
    const odd = 'Una riga che nessun modello conosce.';
    say(odd);
    expect(core.drift()[0]).toMatchObject({ read: 1, unread: 1 });
    expect(bus.filter((r) => r.type === 'core.drift')).toEqual([
      {
        type: 'core.drift',
        t: T0 + 2000,
        plugin: 'norelec',
        // The plugin's version, which the core records with its drift since MegaBotTron1999 0.1.40.
        version: '0.1.0',
        event: 'unread',
        text: odd,
        lines: [odd],
      },
    ]);
    await core.stop();
    // Stopped, it hears nothing more, and the game records its messages itself again.
    say(RAID);
    expect(heard).toHaveLength(4);
    const before = bus.length;
    game.line({ nick: 'NorelecBot', text: RAID, time: T0 + 9000, playback: false });
    game.line({ nick: 'Alfa', text: 'ciao', time: T0 + 9500, playback: false });
    game.tick();
    expect(bus.slice(before).map((r) => r.type)).toEqual(['norelec.message', 'norelec.notice']);
  });

  it('offers its game, replays the history at ready, then reads what waited and ticks', async () => {
    const history = [
      {
        time: T0 - 120_000,
        text: JUNO_LEAVES,
      },
    ];
    const { core, hear, later, game, lines, bus } = setup([], history);
    const heard: { replaying: boolean; juno?: string }[] = [];
    let ticks = 0;
    core.register(
      definePlugin({
        manifest: {
          id: 'listener',
          version: '0.1.0',
          kinds: ['actor'],
          description: 'listens',
          requires: ['norelec'],
          uses: { norelec: ['state.game'] },
        },
        create: (ctx) => {
          const g = ctx.use<NorelecInterface>('norelec').state.game();
          g.onMessage(() => {
            const entry: { replaying: boolean; juno?: string } = { replaying: g.replaying };
            const to = g.state.players.get('Juno')?.trip?.to;
            if (to !== undefined) entry.juno = to;
            heard.push(entry);
          });
          g.onTick(() => ticks++);
          // A line of the channel before the history is replayed.
          return { start: () => hear(RAID) };
        },
      })
    );
    await core.start();
    expect(lines).toContain('norelec: replayed 1 bot messages');
    expect(game().state.players.get('Juno')?.trip?.to).toBe('Alfa');
    // The line heard at the start waited for the replay, and is read right after it: a short
    // message of known lines needs no tick to complete.
    expect(heard).toEqual([
      { replaying: true, juno: 'Alfa' },
      { replaying: false, juno: 'Alfa' },
    ]);
    // The first tick a tick after every plugin is ready, the channel not up yet.
    expect(ticks).toBe(0);
    later(1000);
    expect(bus.filter((r) => r.type === 'norelec.message')).toHaveLength(1);
    // Every TICK_MS from ready.
    expect(ticks).toBe(4);
    later(TICK_MS * 3);
    expect(ticks).toBe(7);
    await core.stop();
    later(TICK_MS * 3);
    expect(ticks).toBe(7);
  });

  it('ticks at once after ready when the channel is up already', async () => {
    const { core, later } = setup([], [], true);
    let ticks = 0;
    core.register(
      definePlugin({
        manifest: {
          id: 'listener',
          version: '0.1.0',
          kinds: ['actor'],
          description: 'listens',
          requires: ['norelec'],
          uses: { norelec: ['state.game'] },
        },
        create: (ctx) => {
          ctx
            .use<NorelecInterface>('norelec')
            .state.game()
            .onTick(() => ticks++);
          return {};
        },
      })
    );
    await core.start();
    expect(ticks).toBe(0);
    later(0);
    expect(ticks).toBe(1);
    later(TICK_MS);
    expect(ticks).toBe(2);
    await core.stop();
  });

  it('learns the Telegram accounts from the whole log once, and keeps them in its store', async () => {
    const first = setup([{ time: T0 - 60_000, text: AT_GIANPIER }]);
    await first.core.start();
    expect(first.lines).toContain('norelec: 1 Telegram accounts in 1 logged bot messages');
    expect(first.game().state.players.get('Gianpier')?.telegram).toBe(true);
    first.say(
      'Juno (🎈) hai bucato il palloncino di @Mirco777 (🎈) e rubato 5 palle! Torni in Juno tra 1 minuto.'
    );
    await first.core.stop();
    const kept = path.join(dataDir, 'instances', 'norelec', `${ACCOUNTS}.json`);
    expect(JSON.parse(fs.readFileSync(kept, 'utf8'))).toEqual({ names: ['Gianpier', 'Mirco777'] });
    // A restart reads them from the store, not from the log.
    const again = setup([]);
    await again.core.start();
    expect(again.lines.some((l) => l.includes('Telegram accounts in'))).toBe(false);
    expect(again.game().state.players.get('Mirco777')?.telegram).toBe(true);
    await again.core.stop();
  });
});

describe("the bot's answers to the owner's commands (D93, D98)", () => {
  /** The plugin, and an actor that sends to the channel through `irc`, its outbox `out()`. */
  async function answering(irc: Record<string, unknown> = {}) {
    let outbox: OutboxHandle | undefined;
    const t = setup(
      [],
      [],
      true,
      {},
      {
        irc,
        graph: (g) => withChats(g, 'raider.chat', { sends: [IRC_CONFIG.channel] }),
      }
    );
    t.core.register(
      definePlugin({
        manifest: {
          id: 'raider',
          version: '0.1.0',
          kinds: ['actor'],
          description: 'sends commands to the channel',
          outputs: { chat: { type: 'chat-out', network: 'irc', bind: { node: 'irc', sends: [] } } },
        },
        create: (ctx) => {
          outbox = ctx.outbox('chat');
          return {};
        },
      })
    );
    await t.core.start();
    return { ...t, out: () => outbox as OutboxHandle };
  }
  const flush = () => new Promise((r) => setImmediate(r));
  const channel = IRC_CONFIG.channel;

  it('pairs a command sent through the outbox with the answer read from the channel', async () => {
    const { core, out, hear, bus } = await answering();
    const q = out().enqueue(channel, '!raid Bravo');
    await flush();
    expect(q.status()).toBe('sent');
    // Another player's departure answers nobody's command here; the owner's does, at once.
    hear('Bravo parti per Juno: arrivi tra 58 secondi. Casa tua resta scoperta.');
    hear('alice parti per Bravo: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.');
    await expect(q).resolves.toMatchObject({
      text: '!raid Bravo',
      outcome: 'sent',
      answer: {
        status: 'ok',
        event: { type: 'norelec.answer', rule: 'raid', player: 'alice', t: T0 },
      },
    });
    expect(bus.filter((r) => r.type === 'norelec.answer')).toHaveLength(1);
    await core.stop();
  });

  it('holds a command back for the time the bot says, and refuses as it does', async () => {
    const { core, out, hear } = await answering();
    const q = out().enqueue(channel, '!raid Bravo');
    await flush();
    hear('alice sei già in viaggio, torni tra 2 minuti.');
    await expect(q).resolves.toMatchObject({
      answer: { status: 'refused', reason: 'travelling', retryAt: T0 + 120_000 },
    });
    // Its cooldown holds the trips, in both forms.
    expect(out().held(channel, '/throw')).toMatchObject({ until: T0 + 120_000 });
    expect(out().held(channel, '!buy')).toBeUndefined();
    const r = out().enqueue(channel, '!throw Juno 💣');
    await flush();
    expect(r.status()).not.toBe('sent');
    r.cancel();
    await core.stop();
  });

  it('keeps the watchdog quiet while the bot answers, so it needs no unansweredAt: 0', async () => {
    const { core, out, hear, later } = await answering({ unansweredAt: 2, minIntervalS: 1 });
    for (let i = 0; i < 4; i++) {
      expect(out().send(channel, '!back').outcome).toBe('sent');
      hear('alice lasci perdere e torni in alice: arrivi tra 23 secondi.');
      later(2000);
    }
    // Unanswered, it stops the node at its threshold, as before.
    expect(out().send(channel, '!back').outcome).toBe('sent');
    later(2000);
    expect(out().send(channel, '!back').outcome).toBe('sent');
    later(2000);
    expect(out().send(channel, '!back').reason).toMatch(/^stopped: stalled/u);
    await core.stop();
  });
});

describe('the norelec plugin, from its config', () => {
  it('is its entry’s first plugin, and reads the channel, Telegram or both', () => {
    expect(plugins).toEqual([norelecPlugin]);
    // It reads and sends nothing: chat-in inputs, and no chat-out output.
    const m = parseManifest(norelecPlugin.manifest);
    expect(m.inputs['channel']).toMatchObject({
      type: 'chat-in',
      when: { config: 'channel' },
      bind: { node: 'irc', reads: [] },
    });
    expect(m.inputs['telegram']).toMatchObject({
      type: 'chat-in',
      network: 'telegram',
      optional: true,
    });
    expect(m.outputs['channel']).toBeUndefined();
    const config = norelecPlugin.manifest.config;
    expect(config?.safeParse({ channel: 'lobby' }).success).toBe(false);
    expect(config?.parse({})).toMatchObject({ bot: 'NorelecBot' });
    expect(config?.parse({ channel: '#lobby' })).toEqual({
      channel: '#lobby',
      bot: 'NorelecBot',
      relays: ['Regno', 'Regno_'],
      restS: 90,
      historyHours: 6,
    });
  });

  it('replays only the last hours of the log', async () => {
    const old = {
      time: T0 - 3 * 3_600_000,
      text: JUNO_LEAVES,
    };
    const recent = {
      time: T0 - 60_000,
      text: 'Bravo parti per Alfa: arrivi tra 10 minuti. Casa tua resta scoperta.',
    };
    const { core, game, lines } = setup([old], [recent], true, { historyHours: 2 });
    await core.start();
    expect(lines).toContain('norelec: replayed 1 bot messages');
    expect(game().state.players.get('Bravo')?.trip?.to).toBe('Alfa');
    expect(game().state.players.get('Juno')).toBeUndefined();
    await core.stop();
  });

  it('reads only the channel of its config', async () => {
    const { core, say, heard } = setup([], [], true, { channel: '#elsewhere' });
    await core.start();
    say(RAID);
    expect(heard).toEqual([]);
    await core.stop();
  });

  it('prints the notices of the IRC account’s own nick when its config names no player', async () => {
    const { core, say, lines, status } = setup([], [], false, { self: undefined });
    await core.start();
    status('joined');
    say('Bravo parti per alice: arrivi tra 1 minuto e 31 secondi. Casa tua resta scoperta.');
    expect(lines.some((l) => l.includes('incomingRaid alice by Bravo'))).toBe(true);
    await core.stop();
  });

  it('reads the bot messages out of the log’s records, without the zero-width characters', () => {
    expect(
      messagesOf([
        { type: MESSAGE_EVENT, t: 1, text: 'Ju\u200bno' },
        { type: 'norelec.notice', t: 2 },
        { type: MESSAGE_EVENT, t: 3 },
      ])
    ).toEqual([{ time: 1, text: 'Juno' }]);
  });
});

describe('the norelec parser contract', () => {
  it('reads export rows and logged records: not the bot’s, read, or unread', () => {
    const date = '01.11.2026 10:00:00 UTC-04:00';
    expect(readExportRow({ date, sender: 'Juno', text: 'ciao' })).toEqual({ kind: 'not-mine' });
    const text = 'Alfa parti per Bravo: arrivi tra 58 secondi. Casa tua resta scoperta.';
    expect(readExportRow({ date, sender: 'NorelecBot', text }).kind).toBe('read');
    expect(readLogged({ type: 'irc.line', t: 1 })).toEqual({ kind: 'not-mine' });
    const unread = readLogged({ type: 'norelec.message', t: 1, text: 'Ri\u200bga nuova.' });
    expect(unread).toMatchObject({ kind: 'unread', text: 'Riga nuova.', lines: ['Riga nuova.'] });
  });
});
