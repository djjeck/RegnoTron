import { parseManifest, readAnswer } from '@megabottron1999/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootState, MIN, T0 } from '#test/state-run.ts';
import { loregamePlugin } from './loregame.ts';
import { loregameStatePlugin, plugins } from './loregame-state.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loregame-state-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Invented places and items; the bot's own phrases are the game's.
const HEADER = 'Lore - Il Bosco Inventato ⛅️ [B1]\n\nUna storia.';
const gain = (item: string, level = ''): string =>
  `${HEADER}\nHai ottenuto ${item}!${level === '' ? '' : `\n\n${level}`}`;
const LEVEL_UP = [
  '🎉 Congratulazioni, hai raggiunto il livello 3! 🎉',
  'Ottieni:',
  '> 30 monete',
  '> 1 punto /abilita',
  '> 2 una scatola di sassi 📦 [X] [usabile]',
].join('\n');

describe('the loregame-state node', () => {
  it('is a state on the parser’s turns, its pins the owner’s first look', async () => {
    expect(plugins).toEqual([loregameStatePlugin]);
    const m = parseManifest(loregameStatePlugin.manifest);
    expect(m.id).toBe('loregame-state');
    expect(m.kinds).toEqual(['stats']);
    expect(m.inputs).toMatchObject({ events: { type: 'events', namespace: 'loregame' } });
    expect(Object.keys(m.events ?? {})).toEqual([
      'loregame-state.changed',
      'loregame-state.banned',
      'loregame-state.unbanned',
      'loregame-state.accumuloReady',
      'loregame-state.accumuloUsed',
      'loregame-state.accumuloDrift',
    ]);
    expect(Object.keys(m.interface.state ?? {})).toEqual([
      'get',
      'freshness',
      'ban',
      'accumulo',
      'player',
      'bans',
      'count',
      'held',
    ]);
    expect(m.config?.parse({})).toEqual({ pin: ['inventory.held', 'owner.as_of'] });
    const run = await bootState(dir);
    expect(run.core.graphProblems()).toEqual([]);
    expect(run.core.status().every((s) => s.state === 'running')).toBe(true);
    await run.core.stop();
  });

  it('adds what the owner’s turns gain, their count and a level-up’s items', async () => {
    const run = await bootState(dir);
    await run.turn(gain('un sasso [B1]'));
    await run.turn(gain('2x un sasso [B1]'));
    await run.turn(gain('una pigna (0 - 1) [M1] [equipaggiabile 🗡]', LEVEL_UP));
    expect(run.read('held')).toEqual({
      'un sasso': 3,
      'una pigna': 1,
      'una scatola di sassi 📦': 2,
    });
    expect(run.read('count', { name: 'un sasso' })).toBe(3);
    expect(run.read('count', { name: 'un orso' })).toBe(0);
    expect(run.read('get', { path: 'inventory.held' })).toBe(3);
    expect(run.read('get', { path: 'inventory.items.una scatola di sassi 📦' })).toEqual({
      qty: 2,
      exact: false,
      date: new Date(T0 + 62 * 60_000).toISOString(),
      via: 'level-up',
      rarity: 'X',
      tags: ['usabile'],
    });
    expect(run.read('get', { path: 'inventory.items.una pigna' })).toMatchObject({
      via: 'drop',
      rarity: 'M1',
      tags: ['equipaggiabile 🗡'],
    });
    expect(run.read('freshness', { section: 'inventory' })).toMatchObject({
      deltas: 3,
      uncertain: 0,
    });
    await run.core.stop();
  });

  it('changes nothing for a turn that gains nothing, and marks a cut-off one uncertain', async () => {
    const run = await bootState(dir);
    await run.turn(gain('un sasso [B1]'));
    await run.turn('Non è passato abbastanza tempo! Riprova fra 5 minuti.');
    await run.turn(
      `${HEADER}\nDurante il tuo cammino compare un orso [L4]!\nIl combattimento inizia...\nun orso [L4] sconfigge alice [L2]!\n\nTorni a casa dolorante e a mani vuote...`
    );
    expect(run.read('held')).toEqual({ 'un sasso': 1 });
    // Each turn charges the accumulo, but only the gain changed the inventory.
    const sections = (): string[][] =>
      run.of('loregame-state.changed').map((c) => c['sections'] as string[]);
    expect(sections().filter((s) => s.includes('inventory'))).toHaveLength(1);
    await run.turn(`${HEADER}\n${'x'.repeat(1024)}`);
    expect(run.read('held')).toEqual({ 'un sasso': 1 });
    expect(run.read('freshness', { section: 'inventory' })).toMatchObject({
      deltas: 2,
      uncertain: 1,
    });
    expect(run.of('loregame-state.changed').at(-1)).toMatchObject({
      refreshed: expect.arrayContaining(['inventory']),
    });
    expect(sections().at(-1)).not.toContain('inventory');
    await run.core.stop();
  });

  it('keeps an item named like an object’s own property', async () => {
    const run = await bootState(dir);
    await run.turn(gain('__proto__ [B1]'));
    await run.turn(gain('__proto__ [B1]'));
    expect(run.read('count', { name: '__proto__' })).toBe(2);
    expect(run.read('count', { name: 'constructor' })).toBe(0);
    await run.core.stop();
  });

  it('resumes after a restart, applying each turn once, those missed while down included', async () => {
    const first = await bootState(dir);
    await first.turn(gain('2x un sasso [B1]'));
    await first.core.stop();
    const second = await bootState(dir, { at: T0 + 3 * 60 * 60_000 });
    expect(second.read('held')).toEqual({ 'un sasso': 2 });
    await second.turn(gain('un sasso [B1]'));
    expect(second.read('held')).toEqual({ 'un sasso': 3 });
    await second.core.stop();
  });
});

// A ban is the bot's reply to any message of a banned player's; the date is Rome's.
const BAN = 'Sei stato bannato fino al 06/11/2026, 18:00:00.';
const BAN_END = Date.parse('2026-11-06T17:00:00Z');
const BAN_ISO = new Date(BAN_END).toISOString();

describe('the loregame parser’s bans', () => {
  it('declares a ban a refusal that holds the bot’s commands until it ends, ahead of the ok', () => {
    const { answers } = parseManifest(loregamePlugin.manifest);
    const turn = (outcome: object) => ({ chat: '@LoreGameBot', outcome });
    const banned = readAnswer(
      answers,
      'loregame.turn',
      turn({ kind: 'banned', bot: 'LoreGameBot', until: BAN_END }),
      T0
    );
    expect(banned?.answer).toMatchObject({ status: 'refused', reason: 'banned', retryAt: BAN_END });
    expect(banned?.commands).toEqual(['/avventura', '/lore', '/l']);
    expect(banned?.holds).toEqual(expect.arrayContaining(['/lore', '/vai', '/usa', '/zaino']));
    // What else a turn brings is still the ok it was.
    const ok = readAnswer(
      answers,
      'loregame.turn',
      { ...turn({ kind: 'gain', bot: 'LoreGameBot' }), retryAt: T0 + 15 * MIN },
      T0
    );
    expect(ok?.answer).toMatchObject({ status: 'ok', reason: 'rest' });
  });

  it('reads the owner’s ban in private as an outcome, not drift, and holds the player until it ends', async () => {
    const dir2 = path.join(dir, 'a');
    const run = await bootState(dir2);
    expect(run.rest()).toBeUndefined();
    await run.owner('/lore');
    await run.bot(BAN);
    expect(run.of('loregame.turn')).toMatchObject([
      { outcome: { kind: 'banned', until: BAN_END } },
    ]);
    expect(run.core.drift().find((d) => d.parser === 'loregame')).toMatchObject({ unread: 0 });
    expect(run.read('ban')).toEqual({ until: BAN_ISO, since: new Date(T0).toISOString() });
    expect(run.read('get', { path: 'owner.name' })).toBe('alice');
    expect(run.rest()).toEqual({ until: BAN_END, why: 'the owner is banned' });
    // A shell player asks each command's readiness: every one is held until the ban ends.
    for (const r of Object.values(run.ready()))
      expect(r).toMatchObject({ ready: false, until: BAN_END, why: 'the owner is banned' });
    // The ban answers every message, not only a turn's: each is the same news, once.
    await run.owner('/zaino');
    await run.bot(BAN);
    expect(run.of('loregame.ban')).toHaveLength(1);
    expect(run.of('loregame-state.banned')).toMatchObject([
      { player: 'alice', until: BAN_ISO, owner: true },
    ]);
    // Its end passes: the player may go on.
    run.clock.advance(6 * 60 * MIN);
    expect(run.rest()).toBeUndefined();
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('keeps every player’s ban, named from the message the bot replies to in the group', async () => {
    const run = await bootState(path.join(dir, 'b'), { group: true });
    const bob = await run.group('bob', '/lore@LoreGameBot');
    await run.group('LoreGameBot', BAN, { replyTo: bob });
    const carol = await run.group('carol', 'ciao a tutti');
    await run.group('LoreGameBot', 'Sei stato bannato fino al 07/11/2026.', { replyTo: carol });
    // The owner's own message in the group, by hand: the owner's ban.
    const mine = await run.group('', '/l', { own: true });
    await run.group('LoreGameBot', BAN, { replyTo: mine });
    // Unknown whom: older than what it heard.
    await run.group('LoreGameBot', BAN, { replyTo: '1' });
    expect(run.read('bans')).toEqual({
      bob: { until: BAN_ISO, since: new Date(T0).toISOString() },
      carol: { until: '2026-11-07T23:00:00.000Z', since: new Date(T0).toISOString() },
      alice: { until: BAN_ISO, since: new Date(T0).toISOString() },
    });
    expect(run.read('ban')).toMatchObject({ until: BAN_ISO });
    expect(run.read('ban', { player: 'bob' })).toMatchObject({ until: BAN_ISO });
    expect(run.read('ban', { player: 'dave' })).toBeNull();
    expect(run.of('loregame-state.banned').map((e) => [e['player'], e['owner']])).toEqual([
      ['bob', false],
      ['carol', false],
      ['alice', true],
    ]);
    // Another's ban in the group is not the owner's: the actor keeps playing.
    expect(run.rest()).toEqual({ until: BAN_END, why: 'the owner is banned' });
    expect(run.of('loregame.turn')).toHaveLength(1);
    await run.core.stop();
  });

  it('ends a ban when the bot serves the player again, told once, and when it runs out', async () => {
    const run = await bootState(path.join(dir, 'c'), { group: true });
    const bob = await run.group('bob', '/lore');
    await run.group('LoreGameBot', BAN, { replyTo: bob });
    const carol = await run.group('carol', '/lore');
    await run.group('LoreGameBot', BAN, { replyTo: carol });
    run.clock.advance(MIN);
    const again = await run.group('bob', '/lore');
    await run.group('LoreGameBot', 'Storia\nHai ottenuto un sasso [B1]!', { replyTo: again });
    expect(Object.keys(run.read('bans') as object)).toEqual(['carol']);
    expect(run.of('loregame.unban')).toHaveLength(1);
    expect(run.of('loregame-state.unbanned')).toMatchObject([
      { player: 'bob', owner: false, reason: 'lifted' },
    ]);
    // Carol's runs out, and the next event drops it.
    run.clock.advance(6 * 60 * MIN);
    const dave = await run.group('dave', '/lore');
    await run.group('LoreGameBot', BAN.replace('06/11', '07/11'), { replyTo: dave });
    expect(Object.keys(run.read('bans') as object)).toEqual(['dave']);
    expect(run.of('loregame-state.unbanned').at(-1)).toMatchObject({
      player: 'carol',
      reason: 'expired',
    });
    await run.core.stop();
  });

  it('keeps the bans across a restart, and the owner’s still holds the player', async () => {
    const dir2 = path.join(dir, 'd');
    const run = await bootState(dir2, { group: true });
    const bob = await run.group('bob', '/lore');
    await run.group('LoreGameBot', BAN, { replyTo: bob });
    await run.owner('/lore');
    await run.bot(BAN);
    await run.core.stop();
    const again = await bootState(dir2, { group: true, at: T0 + 30 * MIN });
    expect(Object.keys(again.read('bans') as object)).toEqual(['bob', 'alice']);
    expect(again.rest()).toEqual({ until: BAN_END, why: 'the owner is banned' });
    // The same ban again is not news; the parser knew it.
    await again.owner('/lore');
    await again.bot(BAN);
    expect(again.of('loregame.ban')).toHaveLength(0);
    // Served again (the bot lifts bans early): the owner's rest is over.
    await again.owner('/lore');
    await again.bot('Hai ottenuto un sasso [B1]!');
    expect(again.of('loregame.unban')).toHaveLength(1);
    expect(again.rest()).toMatchObject({ why: 'its rest after a turn' });
    await again.core.stop();
  });

  it('adds the bans to a state kept before there were any', async () => {
    const dir2 = path.join(dir, 'e');
    const run = await bootState(dir2);
    await run.turn(gain('un sasso [B1]'));
    await run.core.stop();
    // The state of 0.4.0: no bans, no owner's name, one store version behind.
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state'));
    expect(file).toBeDefined();
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file as string), 'utf8'));
    delete kept.state.bans;
    delete kept.state.owner.name;
    fs.writeFileSync(path.join(docs, file as string), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 0 }));
    const again = await bootState(dir2);
    expect(again.read('bans')).toEqual({});
    expect(again.read('held')).toEqual({ 'un sasso': 1 });
    await again.core.stop();
  });
});

// The accumulo: the line a turn carries while it is full, and the bot's answers to /accumulo.
const MARK = '🔋 /accumulo pronto!';
const lit = (item: string): string => `${HEADER}\n\n${MARK}\nHai ottenuto ${item}!`;
const SHORT = (n: number, max: number): string =>
  `Accumulo non ancora sufficiente!\n\nIl tuo accumulo: ${n}/${max}`;
const USED =
  '🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore';
const acc = (run: { read: (n: string) => unknown }) =>
  run.read('accumulo') as Record<string, unknown> & { drift: Record<string, unknown>[] };

describe('the loregame parser’s accumulo', () => {
  it('declares what the parser publishes, beside the turns', () => {
    const { events } = parseManifest(loregamePlugin.manifest);
    expect(Object.keys(events ?? {})).toEqual([
      'loregame.turn',
      'loregame.answer',
      'loregame.ban',
      'loregame.unban',
      'loregame.accumulo',
      'loregame.playerTurn',
      'loregame.playerAccumulo',
    ]);
  });

  it('counts the turns against the bot’s word: its counter, the line of a full one, a use', async () => {
    const run = await bootState(path.join(dir, 'f'));
    await run.owner('/accumulo');
    await run.bot(SHORT(1, 3));
    expect(run.of('loregame.accumulo')).toMatchObject([
      { chat: '@LoreGameBot', result: 'short', count: 1, max: 3 },
    ]);
    // It is no turn, and no drift: the parser claims no reply to a command that is not a turn's.
    expect(run.of('loregame.turn')).toHaveLength(0);
    expect(acc(run)).toMatchObject({ count: 1, exact: true, max: 3, ready: false, drift: [] });
    // Two turns; the second finds it full, and says so.
    await run.turn(gain('un sasso [B1]'));
    await run.turn(lit('un sasso [B1]'));
    expect(run.of('loregame.turn').at(-1)).toMatchObject({
      outcome: { kind: 'gain', accumulo: { ready: true, sure: true } },
    });
    expect(acc(run)).toMatchObject({ count: 3, ready: true, drift: [] });
    expect(run.of('loregame-state.accumuloReady')).toMatchObject([
      { count: 3, max: 3, via: 'turn' },
    ]);
    // Used: the count starts again.
    await run.owner('/acc');
    await run.bot(USED);
    expect(run.of('loregame-state.accumuloUsed')).toMatchObject([{ turns: 3, exact: true }]);
    expect(acc(run)).toMatchObject({ count: 0, ready: false, locked: null });
    expect(acc(run).used_at).toBe(new Date(run.clock.now()).toISOString());
    expect(run.core.drift().find((d) => d.parser === 'loregame')).toMatchObject({ unread: 0 });
    await run.core.stop();
  });

  it('reports where our count and the bot’s word part: a full accumulo no turn announced', async () => {
    const run = await bootState(path.join(dir, 'g'));
    await run.owner('/accumulo');
    await run.bot(SHORT(1, 3));
    for (let i = 0; i < 3; i++) await run.turn(gain('un sasso [B1]'));
    // Counted 4 against a maximum of 3, and the bot never said it was full.
    expect(acc(run)).toMatchObject({ count: 4, ready: false });
    expect(acc(run).drift).toMatchObject([{ kind: 'late', counted: 3, max: 3 }]);
    expect(run.of('loregame-state.accumuloDrift')).toMatchObject([
      { kind: 'late', counted: 3, said: null, max: 3 },
    ]);
    await run.core.stop();
  });

  it('answers a level gate only after the command, and empties the accumulo', async () => {
    const run = await bootState(path.join(dir, 'h'));
    await run.turn(gain('un sasso [B1]'));
    expect(acc(run)).toMatchObject({ count: 1, exact: false });
    await run.bot('Devi essere almeno di livello 4!');
    expect(run.of('loregame.accumulo')).toHaveLength(0);
    await run.owner('/accumulo');
    await run.bot('Devi essere almeno di livello 4!');
    expect(run.of('loregame.accumulo')).toMatchObject([{ result: 'locked', level: 4 }]);
    expect(acc(run)).toMatchObject({ locked: 4, count: 0, exact: true });
    await run.core.stop();
  });

  it('pairs the group’s answers with the owner’s command among the other players’', async () => {
    const run = await bootState(path.join(dir, 'i'), { group: true });
    // Bob asks, then the owner; the bot answers each in order, in messages of its own.
    await run.group('bob', '/acc');
    await run.group('alice', '/accumulo@LoreGameBot', { own: true });
    await run.group('LoreGameBot', SHORT(9, 20));
    expect(run.of('loregame.accumulo')).toHaveLength(0);
    await run.group('LoreGameBot', SHORT(4, 20));
    expect(run.of('loregame.accumulo')).toMatchObject([
      { chat: '-1001', result: 'short', count: 4, max: 20 },
    ]);
    expect(acc(run)).toMatchObject({ count: 4, exact: true });
    // Another player's alone is no one's of ours.
    await run.group('carol', '/acc');
    await run.group('LoreGameBot', USED);
    expect(run.of('loregame.accumulo')).toHaveLength(1);
    expect(acc(run)).toMatchObject({ count: 4, used_at: null });
    await run.core.stop();
  });

  it('keeps the accumulo across a restart, and adds it to a state kept before there was one', async () => {
    const dir2 = path.join(dir, 'j');
    const run = await bootState(dir2);
    await run.owner('/accumulo');
    await run.bot(SHORT(2, 3));
    await run.turn(lit('un sasso [B1]'));
    await run.core.stop();
    const again = await bootState(dir2);
    expect(acc(again)).toMatchObject({ count: 3, exact: true, max: 3, ready: true });
    await again.core.stop();
    // The state of 0.5.0: bans, no accumulo, one store version behind.
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.accumulo;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 1 }));
    const migrated = await bootState(dir2);
    expect(acc(migrated)).toMatchObject({ count: 0, exact: false, max: null, ready: false });
    expect(migrated.read('held')).toEqual({ 'un sasso': 1 });
    await migrated.core.stop();
  });
});

describe('the accumulo, for a shell player', () => {
  const ready = (run: { ready: () => Record<string, { ready: boolean; why?: string }> }) =>
    run.ready()['/accumulo'];
  /** The player's send of /accumulo, as it tells the parser, and the bot's reply to it. */
  const play = async (run: Awaited<ReturnType<typeof bootState>>, reply: string): Promise<void> => {
    const id = 'sent-' + String(run.clock.now());
    const r = await run.core.controls.act('loregame', 'sent', {
      chat: '@LoreGameBot',
      id,
      t: run.clock.now(),
      command: '/accumulo',
    });
    expect(r).not.toHaveProperty('error');
    await run.bot(reply, { replyTo: id });
  };

  it('is declared to the player: unlocked by the bot’s word, ending /lore’s rest when used', () => {
    const m = parseManifest(loregamePlugin.manifest);
    expect(m.botCommands).toEqual([
      { command: '/avventura', turn: true },
      { command: '/lore', turn: true },
      { command: '/l', turn: true },
      { command: '/accumulo', unlock: {}, effects: [{ command: '/lore', clear: true }] },
      { command: '/acc', unlock: {}, effects: [{ command: '/lore', clear: true }] },
    ]);
  });

  it('is ready once a turn says it is full, and its use ends the rest of the next /lore', async () => {
    const run = await bootState(path.join(dir, 'k'));
    expect(ready(run)).toMatchObject({ ready: false, why: 'waits for an unlock' });
    // A turn without the line, then one with a story quoting it: neither is the bot's word.
    await run.owner('/lore');
    await run.bot(gain('un sasso [B1]'));
    run.clock.advance(16 * MIN);
    await run.owner('/lore');
    await run.bot(`${HEADER}\n${MARK}\n${MARK}\n\n${MARK}\nHai ottenuto un sasso [B1]!`);
    expect(ready(run)).toMatchObject({ ready: false });
    run.clock.advance(16 * MIN);
    // The bot's own line: ready, while /lore rests (which is when the player plays it).
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(ready(run)).toMatchObject({ ready: true });
    expect(run.ready()['/lore']).toMatchObject({ ready: false });
    // Used: spent, and /lore may go at once.
    await play(run, USED);
    expect(ready(run)).toMatchObject({ ready: false });
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
    expect(run.rest()).toBeUndefined();
    expect(run.of('loregame.answer')).toMatchObject([
      { command: '/accumulo', outcome: { kind: 'accumulo', result: 'used' } },
    ]);
    expect(run.core.drift().find((d) => d.parser === 'loregame')).toMatchObject({ unread: 0 });
    await run.core.stop();
  });

  it('offers /acc beside /accumulo, one accumulo: a use of either holds both', async () => {
    const run = await bootState(path.join(dir, 'o'));
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(run.ready()['/accumulo']).toMatchObject({ ready: true });
    expect(run.ready()['/acc']).toMatchObject({ ready: true });
    // The player sends /acc this time.
    const id = 'sent-acc';
    await run.core.controls.act('loregame', 'sent', {
      chat: '@LoreGameBot',
      id,
      t: run.clock.now(),
      command: '/acc',
    });
    await run.bot(USED, { replyTo: id });
    expect(run.of('loregame.answer').at(-1)).toMatchObject({ command: '/acc' });
    expect(run.ready()['/acc']).toMatchObject({ ready: false });
    expect(run.ready()['/accumulo']).toMatchObject({
      ready: false,
      why: 'used since the bot said it was full',
    });
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
    // The next line makes both ready again.
    run.clock.advance(MIN);
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(run.ready()['/accumulo']).toMatchObject({ ready: true });
    expect(run.ready()['/acc']).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('holds back a "not yet" for the turns still needed, and takes "already ready" as no use', async () => {
    const run = await bootState(path.join(dir, 'l'));
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    // Not yet (a line we trusted): held for 3 turns at the bot's rest, and spends nothing.
    await play(run, SHORT(17, 20));
    expect(ready(run)).toMatchObject({ ready: false });
    expect(run.ready()['/lore']).toMatchObject({ ready: false });
    expect(run.of('loregame.answer').at(-1)).toMatchObject({
      outcome: { kind: 'nothing', reason: 'cooldown', result: 'short', count: 17, max: 20 },
      retryAt: run.clock.now() + 45 * MIN,
    });
    // Full again by a turn's line, and the rest over: the bot says "already ready".
    run.clock.advance(46 * MIN);
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    run.clock.advance(16 * MIN);
    await play(run, 'La lore è già pronta!\n\nIl tuo accumulo: 20/20');
    // Still full: nothing was spent.
    expect(ready(run)).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('is spent by the owner’s own use, by hand, in the group, which the shell cannot pair', async () => {
    const run = await bootState(path.join(dir, 'm'), { group: true });
    await run.group('alice', '/lore', { own: true });
    const turn = run.of('loregame.turn').length;
    const mine = await run.group('alice', '/l', { own: true });
    await run.group('LoreGameBot', lit('un sasso [B1]'), { replyTo: mine });
    expect(run.of('loregame.turn')).toHaveLength(turn + 1);
    expect(ready(run)).toMatchObject({ ready: true });
    // The bot answers /acc in a message of its own; only the parser's watch knows it is the owner's.
    await run.group('alice', '/acc', { own: true });
    await run.group('LoreGameBot', USED);
    expect(ready(run)).toMatchObject({ ready: false, why: 'used since the bot said it was full' });
    // Kept across a restart.
    await run.core.stop();
    const again = await bootState(path.join(dir, 'm'), { group: true });
    expect(ready(again)).toMatchObject({ ready: false });
    // The next line makes it ready again.
    again.clock.advance(16 * MIN);
    const next = await again.group('alice', '/lore', { own: true });
    await again.group('LoreGameBot', lit('un sasso [B1]'), { replyTo: next });
    expect(ready(again)).toMatchObject({ ready: true });
    await again.core.stop();
  });

  it('is held, as every command, while the owner is banned, and a ban answering it uses nothing', async () => {
    const run = await bootState(path.join(dir, 'n'));
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    await play(run, BAN);
    expect(ready(run)).toMatchObject({ ready: false, why: 'the owner is banned' });
    expect(run.of('loregame.answer').at(-1)).toMatchObject({
      outcome: { kind: 'nothing', reason: 'cooldown', banned: BAN_END },
    });
    // An answer it cannot read is drift, as a turn's.
    run.clock.advance(7 * 60 * MIN);
    await play(run, 'Qualcosa che il bot non ha mai scritto.');
    expect(run.core.drift().find((d) => d.parser === 'loregame')).toMatchObject({ unread: 1 });
    await run.core.stop();
  });
});

describe('every player, as the group shows them', () => {
  it('keeps the players of the group and the owner, by username, from their turns and answers', async () => {
    const run = await bootState(path.join(dir, 'p'), { group: true });
    const bobs = await run.group('bob', '/lore@LoreGameBot');
    await run.group('LoreGameBot', lit('un sasso [B1]'), { replyTo: bobs });
    const mine = await run.group('alice', '/l', { own: true });
    await run.group('LoreGameBot', gain('una perla [B1]'), { replyTo: mine });
    await run.group('bob', '/acc');
    await run.group('LoreGameBot', USED);
    expect(run.of('loregame.playerTurn')).toMatchObject([
      { player: 'bob', owner: false, outcome: { kind: 'gain' } },
      { player: 'alice', owner: true, outcome: { kind: 'gain' } },
    ]);
    expect(run.of('loregame.playerAccumulo')).toMatchObject([
      { player: 'bob', owner: false, result: 'used' },
    ]);
    expect(run.read('player', { name: 'bob' })).toMatchObject({
      turns: 1,
      accumulo: { ready: false, count: 0, exact: true },
    });
    expect(run.read('player', { name: 'alice' })).toMatchObject({ turns: 1 });
    expect(run.read('player', { name: 'nobody' })).toBeNull();
    // Bob's drop is not the owner's.
    expect(run.read('held')).toEqual({ 'una perla': 1 });
    await run.core.stop();
  });

  it('adds the players to a state kept before there were any', async () => {
    const dir2 = path.join(dir, 'q');
    const run = await bootState(dir2);
    await run.turn(gain('un sasso [B1]'));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.players;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 2 }));
    const again = await bootState(dir2);
    expect(again.read('get', { path: 'players' })).toEqual({});
    expect(again.read('held')).toEqual({ 'un sasso': 1 });
    await again.core.stop();
  });
});

describe('a player that plays in the group', () => {
  const sent = async (run: Awaited<ReturnType<typeof bootState>>, command: string) => {
    const id = `sent-${command}-${String(run.clock.now())}`;
    await run.core.controls.act('loregame', 'sent', {
      chat: '-1001',
      id,
      t: run.clock.now(),
      command,
    });
    return id;
  };

  it('pairs the bot’s answer to its /accumulo, which replies to nothing, and frees the next turn', async () => {
    const run = await bootState(path.join(dir, 'r'), { group: true });
    // Its /avventura, which the account never hears come back, and the bot's turn replying to it.
    const turn = await sent(run, '/avventura');
    await run.group('LoreGameBot', lit('un sasso [B1]'), { replyTo: turn });
    expect(run.ready()['/accumulo']).toMatchObject({ ready: true });
    expect(run.ready()['/avventura']).toMatchObject({ ready: false });
    expect(run.of('loregame.playerTurn')).toMatchObject([
      { player: 'alice', owner: true, command: '/avventura' },
    ]);
    // Its /accumulo; the bot's use, a message of its own.
    run.clock.advance(10_000);
    await sent(run, '/accumulo');
    run.clock.advance(1000);
    await run.group('LoreGameBot', USED);
    expect(run.of('loregame.accumulo').at(-1)).toMatchObject({
      result: 'used',
      holds: { '/avventura': run.clock.now(), '/lore': run.clock.now(), '/l': run.clock.now() },
    });
    // The turn is free again, for the parser as for the player, and the accumulo spent.
    expect(run.rest()).toBeUndefined();
    expect(run.ready()['/avventura']).toMatchObject({ ready: true, since: run.clock.now() });
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
    expect(run.ready()['/accumulo']).toMatchObject({ ready: false });
    // The next turn starts its rest as usual.
    run.clock.advance(60_000);
    const next = await sent(run, '/avventura');
    await run.group('LoreGameBot', gain('una perla [B1]'), { replyTo: next });
    expect(run.ready()['/avventura']).toMatchObject({ ready: false });
    await run.core.stop();
  });

  it('declares the answer to the outbox: a use ends the turns’ hold, the rest are refusals', () => {
    const { answers } = parseManifest(loregamePlugin.manifest);
    const used = readAnswer(
      answers,
      'loregame.accumulo',
      { chat: '-1001', result: 'used', holds: { '/avventura': T0, '/lore': T0, '/l': T0 } },
      T0
    );
    expect(used?.answer).toMatchObject({ status: 'ok', reason: 'used' });
    expect(used?.holdsAt).toEqual({ '/avventura': T0, '/lore': T0, '/l': T0 });
    expect(used?.commands).toEqual([
      '/accumulo',
      '/accumulo@LoreGameBot',
      '/acc',
      '/acc@LoreGameBot',
    ]);
    const short = readAnswer(answers, 'loregame.accumulo', { chat: '-1001', result: 'short' }, T0);
    expect(short?.answer).toMatchObject({ status: 'refused', reason: 'not_ready' });
  });
});
