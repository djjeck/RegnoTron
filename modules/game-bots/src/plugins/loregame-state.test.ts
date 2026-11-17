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
    ]);
    expect(Object.keys(m.interface.state ?? {})).toEqual([
      'get',
      'freshness',
      'ban',
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
    expect(run.of('loregame-state.changed')).toHaveLength(1);
    await run.turn(`${HEADER}\n${'x'.repeat(1024)}`);
    expect(run.read('held')).toEqual({ 'un sasso': 1 });
    expect(run.read('freshness', { section: 'inventory' })).toMatchObject({
      deltas: 2,
      uncertain: 1,
    });
    expect(run.of('loregame-state.changed').at(-1)).toMatchObject({
      sections: [],
      refreshed: ['inventory'],
    });
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

  it('reads the owner’s ban in private as an outcome, not drift, and holds the actor until it ends', async () => {
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
    // The ban answers every message, not only a turn's: each is the same news, once.
    await run.owner('/zaino');
    await run.bot(BAN);
    expect(run.of('loregame.ban')).toHaveLength(1);
    expect(run.of('loregame-state.banned')).toMatchObject([
      { player: 'alice', until: BAN_ISO, owner: true },
    ]);
    // Its end passes: the actor may go on.
    run.clock.advance(6 * 60 * MIN);
    expect(run.rest()).toBeUndefined();
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

  it('keeps the bans across a restart, and the owner’s still holds the actor', async () => {
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
