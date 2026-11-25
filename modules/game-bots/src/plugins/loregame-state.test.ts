import { parseManifest, readAnswer } from '@megabottron1999/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaIdOf } from '#src/media.ts';
import { bootState, GROUP, MIN, T0 } from '#test/state-run.ts';
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
    expect(m.inputs).toMatchObject({
      events: { type: 'events', namespace: 'loregame' },
      // The parser a shell player's sends are handed to (MegaBotTron1999's D141).
      parser: { type: 'interface', members: ['actions.sent'], bind: { node: 'loregame' } },
      // The account's photos, for the pictures (D151): optional.
      photo: { type: 'interface', members: ['actions.photo'], optional: true },
    });
    expect(Object.keys(m.events ?? {})).toEqual([
      'loregame-state.changed',
      'loregame-state.banned',
      'loregame-state.unbanned',
      'loregame-state.accumuloReady',
      'loregame-state.accumuloUsed',
      'loregame-state.statsDrift',
      'loregame-state.accumuloDrift',
      'loregame-state.marketUpdated',
      'loregame-state.shopChanged',
      'loregame-state.itemsDiscovered',
    ]);
    expect(Object.keys(m.interface.state ?? {})).toEqual([
      'get',
      'freshness',
      'ban',
      'accumulo',
      'player',
      'stat',
      'profile',
      'bans',
      'inventory',
      'places',
      'guardians',
      'market',
      'marketHistory',
      'investments',
      'shop',
      'shopSeen',
      'catalogue',
      'recipes',
      'recipe',
      'trip',
      'reach',
      'holders',
      'count',
      'held',
      // The owner's readiness, for a shell player (D141).
      'ready',
      'commands',
      'bot',
      // A picture's bytes, by its id.
      'media',
    ]);
    expect(Object.keys(m.interface.actions ?? {})).toEqual(['sent']);
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
    // Three drops, and the level-up's items, an event of its own.
    expect(run.read('freshness', { section: 'inventory' })).toMatchObject({
      deltas: 4,
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
  it('declares a ban a refusal, ahead of the ok, holding nothing back in the outbox', () => {
    const { answers } = parseManifest(loregamePlugin.manifest);
    const turn = (outcome: object) => ({ chat: '@LoreGameBot', outcome });
    const banned = readAnswer(
      answers,
      'loregame.turn',
      turn({ kind: 'banned', bot: 'LoreGameBot', until: BAN_END }),
      T0
    );
    expect(banned?.answer).toMatchObject({ status: 'refused', reason: 'banned' });
    // The state holds the commands (MegaBotTron1999's D142): the answer holds none back.
    expect(banned?.answer).not.toHaveProperty('retryAt');
    expect(banned?.commands).toEqual([
      '/lore',
      '/avventura',
      '/l',
      '/lore@LoreGameBot',
      '/avventura@LoreGameBot',
      '/l@LoreGameBot',
    ]);
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
      'loregame.sent',
      'loregame.turn',
      'loregame.answer',
      'loregame.reply',
      'loregame.ban',
      'loregame.unban',
      'loregame.accumulo',
      'loregame.training',
      'loregame.levelUp',
      'loregame.profile',
      'loregame.skills',
      'loregame.equipment',
      'loregame.inventory',
      'loregame.travel',
      'loregame.gift',
      'loregame.neutral',
      'loregame.requirements',
      'loregame.playerTurn',
      'loregame.playerAccumulo',
      'loregame.market',
      'loregame.investments',
      'loregame.invest',
      'loregame.cashout',
      'loregame.company',
      'loregame.shop',
      'loregame.purchase',
      'loregame.generated',
      'loregame.used',
      'loregame.recipes',
      'loregame.recipe',
      'loregame.recipeMade',
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

  it('adds the readiness to a state kept before there was one (0.15.0)', async () => {
    const dir2 = path.join(dir, 'k');
    const run = await bootState(dir2);
    await run.turn(lit('un sasso [B1]'));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    expect(kept.state.readiness).toBeDefined();
    delete kept.state.readiness;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 3 }));
    const migrated = await bootState(dir2);
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

  it('is declared to the player: unlocked by the bot’s word, and no condition to derive', () => {
    // By the state, whose mechanics they are (D141), in the parser's words.
    expect(parseManifest(loregamePlugin.manifest).botCommands).toBeUndefined();
    const m = parseManifest(loregameStatePlugin.manifest);
    expect(m.botUsername).toBe('LoreGameBot');
    // One turn by its name, then its aliases in the owner's order; one accumulo, `/acc` its alias.
    expect(m.botCommands).toEqual([
      { command: '/lore', aliases: ['/avventura', '/l'], turn: true },
      {
        command: '/accumulo',
        aliases: ['/acc'],
        unlock: {},
        // No effect: the player derives no condition from one; the state keeps the game's rules.
      },
      // The training, its cooldown of a day.
      { command: '/allenati', cooldownMin: 1440 },
      // A place's requirements: it asks a place's name, so it is the person's, never played by
      // default.
      { command: '/requisiti', aliases: ['/req'], interactive: true },
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

  it('takes /acc as /accumulo, one accumulo by its name', async () => {
    const run = await bootState(path.join(dir, 'o'));
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(run.ready()['/accumulo']).toMatchObject({ ready: true });
    expect(run.ready()).not.toHaveProperty('/acc');
    // The player sends /acc this time.
    const id = 'sent-acc';
    await run.core.controls.act('loregame', 'sent', {
      chat: '@LoreGameBot',
      id,
      t: run.clock.now(),
      command: '/acc',
    });
    await run.bot(USED, { replyTo: id });
    // The shell's parser pairs the answer to its command, by its name: the unlock used up.
    expect(run.of('loregame.answer').at(-1)).toMatchObject({ command: '/accumulo' });
    expect(run.ready()['/accumulo']).toMatchObject({ ready: false, why: 'waits for an unlock' });
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
    // The next line makes it ready again.
    run.clock.advance(MIN);
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(run.ready()['/accumulo']).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('holds back a "not yet" until a turn says it is full, for no time, and takes "already ready" as no use', async () => {
    const run = await bootState(path.join(dir, 'l'));
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    // Not yet (a line we trusted): held until a turn's line, not for a time, and spends nothing.
    await play(run, SHORT(17, 20));
    expect(ready(run)).toMatchObject({ ready: false, why: 'waits for an unlock' });
    expect(ready(run)).not.toHaveProperty('until');
    expect(run.ready()['/lore']).toMatchObject({ ready: false });
    expect(run.of('loregame.answer').at(-1)).toMatchObject({
      outcome: { kind: 'nothing', reason: 'cooldown', result: 'short', count: 17, max: 20 },
    });
    expect(run.of('loregame.answer').at(-1)).not.toHaveProperty('retryAt');
    // Full again by a turn's line, however soon, and legal while the turn rests.
    run.clock.advance(16 * MIN);
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(ready(run)).toMatchObject({ ready: true });
    // The rest over, it is illegal: the bot would refuse it, with nothing to end.
    run.clock.advance(16 * MIN);
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
    expect(ready(run)).toMatchObject({ ready: false, why: '/lore is not resting: nothing to end' });
    expect(ready(run)).not.toHaveProperty('until');
    // Sent by hand all the same: "already ready", refused, and nothing spent.
    await play(run, 'La lore è già pronta!\n\nIl tuo accumulo: 20/20');
    expect(ready(run)).toMatchObject({ ready: false });
    // The next turn rests, and it is legal again: still full, its line says.
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(ready(run)).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('is withdrawn by a turn without the line: a use it did not hear, or a start that knew nothing', async () => {
    const run = await bootState(path.join(dir, 'l2'), { group: true });
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    expect(ready(run)).toMatchObject({ ready: true });
    // Its /accumulo in the group, whose answer the account never reads; then a turn, unlit.
    await run.group('alice', '/acc', { own: true });
    run.clock.advance(MIN);
    const mine = await run.group('alice', '/lore', { own: true });
    await run.group('LoreGameBot', gain('una perla [B1]'), { replyTo: mine });
    expect(ready(run)).toMatchObject({ ready: false, why: 'waits for an unlock' });
    // A turn cut off, or one quoting the line, says nothing either way.
    run.clock.advance(16 * MIN);
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    run.clock.advance(MIN);
    await run.owner('/lore');
    await run.bot(
      `${HEADER}\n\n🔋 /accumulo pronto!\n🔋 /accumulo pronto!\nHai ottenuto un sasso [B1]!`
    );
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
    expect(ready(run)).toMatchObject({ ready: false, why: 'waits for an unlock' });
    expect(run.ready()['/lore']).toMatchObject({ ready: true });
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
    const answer = await run.group('LoreGameBot', lit('un sasso [B1]'), { replyTo: bobs });
    const mine = await run.group('alice', '/l', { own: true });
    await run.group('LoreGameBot', gain('una perla [B1]'), { replyTo: mine });
    await run.group('bob', '/acc');
    await run.group('LoreGameBot', USED);
    expect(run.of('loregame.playerTurn')).toMatchObject([
      // With the turn command's message and the bot's answer, by their ids.
      { player: 'bob', owner: false, outcome: { kind: 'gain' }, message: bobs, answer },
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

  it('pairs the answers the bot replays after an outage, in order, and marks them', async () => {
    const run = await bootState(path.join(dir, 'r'), { group: true });
    // Bob asks; the bot is down. Dave plays, Carol asks, hours later.
    await run.group('bob', '/acc');
    run.clock.advance(60 * MIN);
    const daves = await run.group('dave', '/lore');
    run.clock.advance(120 * MIN);
    const asked = run.clock.now();
    await run.group('carol', '/acc');
    run.clock.advance(120 * MIN);
    // Back: the replay. Dave's turn is refused by the flood guard; Bob, who asked before him, got
    // no answer; Carol's comes of its own, and is hers.
    await run.group('LoreGameBot', 'Stai calmo maschio...', { replyTo: daves });
    await run.group('LoreGameBot', USED);
    expect(run.of('loregame.playerAccumulo')).toEqual([
      expect.objectContaining({ player: 'carol', result: 'used', replayed: true, asked }),
    ]);
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
    expect(run.ready()['/lore']).toMatchObject({ ready: false });
    expect(run.ready()).not.toHaveProperty('/avventura');
    expect(run.of('loregame.playerTurn')).toMatchObject([
      { player: 'alice', owner: true, command: '/avventura' },
    ]);
    // Its /accumulo; the bot's use, a message of its own.
    run.clock.advance(10_000);
    await sent(run, '/accumulo');
    run.clock.advance(1000);
    await run.group('LoreGameBot', USED);
    expect(run.of('loregame.accumulo').at(-1)).toMatchObject({ result: 'used' });
    expect(run.of('loregame.accumulo').at(-1)).not.toHaveProperty('holds');
    // The turn is free again, for the parser as for the player, and the accumulo spent.
    expect(run.rest()).toBeUndefined();
    expect(run.ready()['/lore']).toMatchObject({ ready: true, since: run.clock.now() });
    expect(run.ready()['/accumulo']).toMatchObject({ ready: false });
    // The next turn starts its rest as usual.
    run.clock.advance(60_000);
    const next = await sent(run, '/avventura');
    await run.group('LoreGameBot', gain('una perla [B1]'), { replyTo: next });
    expect(run.ready()['/lore']).toMatchObject({ ready: false });
    await run.core.stop();
  });

  it('declares the answer to the outbox: a use is the ok, the rest are refusals', () => {
    const { answers } = parseManifest(loregamePlugin.manifest);
    const used = readAnswer(answers, 'loregame.accumulo', { chat: '-1001', result: 'used' }, T0);
    expect(used?.answer).toMatchObject({ status: 'ok', reason: 'used' });
    expect(used?.commands).toEqual([
      '/accumulo',
      '/acc',
      '/accumulo@LoreGameBot',
      '/acc@LoreGameBot',
    ]);
    const short = readAnswer(answers, 'loregame.accumulo', { chat: '-1001', result: 'short' }, T0);
    expect(short?.answer).toMatchObject({ status: 'refused', reason: 'not_ready' });
  });
});

describe('the training, for a shell player', () => {
  const DAY = 24 * 60 * MIN;
  const TRAINED = '🏋🏼 Ti sei allenato! Hai imparato qualcosa di nuovo... (+10)';
  const SOON = (wait: string) =>
    `Non è passato abbastanza tempo dal tuo ultimo allenamento! Riprova fra ${wait}.`;
  const ready = (run: { ready: () => Record<string, { ready: boolean; until?: number }> }) =>
    run.ready()['/allenati'];
  /** The player's send of /allenati, as it tells the parser. */
  const sent = async (run: Awaited<ReturnType<typeof bootState>>, chat: string) => {
    const id = `sent-${String(run.clock.now())}`;
    const r = await run.core.controls.act('loregame', 'sent', {
      chat,
      id,
      t: run.clock.now(),
      command: '/allenati',
    });
    expect(r).not.toHaveProperty('error');
    return id;
  };

  it('is ready until a training, then held a day; a "too soon" holds it for the wait it states', async () => {
    const run = await bootState(path.join(dir, 't1'));
    expect(ready(run)).toMatchObject({ ready: true });
    // In private the bot's success replies to nothing; the shell pairs it, the first after the send.
    await sent(run, '@LoreGameBot');
    run.clock.advance(1000);
    const at = run.clock.now();
    await run.bot(TRAINED);
    expect(run.of('loregame.answer').at(-1)).toMatchObject({
      command: '/allenati',
      outcome: { kind: 'training', learned: 10, extra: 0, gym: null },
    });
    expect(run.of('loregame.training')).toMatchObject([
      { player: 'alice', owner: true, result: 'trained', learned: 10 },
    ]);
    expect(ready(run)).toMatchObject({ ready: false, until: at + DAY, why: 'its cooldown' });
    // By hand, a little later: "too soon", with the wait left.
    run.clock.advance(MIN);
    const mine = await sent(run, '@LoreGameBot');
    await run.bot(SOON('23 ore e 59 minuti'), { replyTo: mine });
    expect(ready(run)).toMatchObject({ ready: false, until: at + DAY });
    expect(run.core.drift().find((d) => d.parser === 'loregame')).toMatchObject({ unread: 0 });
    run.clock.advance(DAY);
    expect(ready(run)).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('pairs a training in the group, which replies to nothing, and holds it a day', async () => {
    const run = await bootState(path.join(dir, 't2'), { group: true });
    // Bob trains first; his is not the owner's.
    await run.group('bob', '/allenati');
    await run.group('LoreGameBot', TRAINED.replace('!', ' nella palestra di Una Fazione 🏛!'));
    expect(ready(run)).toMatchObject({ ready: true });
    run.clock.advance(5000);
    await sent(run, '-1001');
    run.clock.advance(1000);
    const at = run.clock.now();
    await run.group('LoreGameBot', `${TRAINED}\n\n💪🏻 +2 extra`);
    expect(run.of('loregame.training')).toMatchObject([
      { player: 'bob', owner: false, result: 'trained', gym: 'Una Fazione 🏛', learned: 10 },
      { player: 'alice', owner: true, result: 'trained', gym: null, extra: 2 },
    ]);
    expect(ready(run)).toMatchObject({ ready: false, until: at + DAY });
    expect(run.read('player', { name: 'bob' })).toMatchObject({
      training: { seen: 1, unseen: 0 },
    });
    // Bob's "too soon", a day after a training of his the account did not see.
    run.clock.advance(DAY);
    const bobs = await run.group('bob', '/allenati@LoreGameBot');
    await run.group('LoreGameBot', SOON('10 ore'), { replyTo: bobs });
    expect(run.read('player', { name: 'bob' })).toMatchObject({
      training: { seen: 1, unseen: 1 },
    });
    expect(ready(run)).toMatchObject({ ready: true });
    await run.core.stop();
  });

  it('adds what a level-up of the owner’s training gives, and nothing of another player’s', async () => {
    const run = await bootState(path.join(dir, 't3'), { group: true });
    await run.group('bob', '/allenati');
    await run.group('LoreGameBot', `${TRAINED}\n\n${LEVEL_UP}`);
    expect(run.read('held')).toEqual({});
    expect(run.read('player', { name: 'bob' })).toMatchObject({ game: { level: 3 } });
    await run.group('alice', '/allenati', { own: true });
    await run.group('LoreGameBot', `${TRAINED}\n\n${LEVEL_UP}`);
    expect(run.read('held')).toEqual({ 'una scatola di sassi 📦': 2 });
    await run.core.stop();
  });

  it('declares the owner’s answer to the outbox: a training is the ok, "too soon" a refusal', () => {
    const { answers } = parseManifest(loregamePlugin.manifest);
    const at = (payload: object) =>
      readAnswer(answers, 'loregame.training', { chat: '-1001', player: 'p', ...payload }, T0);
    const ok = at({ owner: true, result: 'trained' });
    expect(ok?.answer).toMatchObject({ status: 'ok', reason: 'trained' });
    expect(ok?.commands).toEqual(['/allenati', '/allenati@LoreGameBot']);
    expect(at({ owner: true, result: 'soon' })?.answer).toMatchObject({
      status: 'refused',
      reason: 'cooldown',
    });
    // Another player's training answers none of the owner's sends.
    expect(at({ owner: false, result: 'trained' })).toBeUndefined();
  });

  it('adds the trainings to the players of a state kept before there were any (0.17.0)', async () => {
    const dir2 = path.join(dir, 't4');
    const run = await bootState(dir2, { group: true });
    const bobs = await run.group('bob', '/lore');
    await run.group('LoreGameBot', gain('un sasso [B1]'), { replyTo: bobs });
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.players.bob.training;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 4 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('player', { name: 'bob' })).toMatchObject({
      turns: 1,
      training: { seen: 0, unseen: 0, last: null, until: null },
    });
    await again.core.stop();
  });
});

describe('a level-up, whatever brought it', () => {
  it('is the player’s whose message it replies to, any command; in private the owner’s', async () => {
    const run = await bootState(path.join(dir, 'u1'), { group: true });
    // A command no grammar reads, in the group: the reply's level-up is still Bob's.
    const bobs = await run.group('bob', '/usa una pozione');
    await run.group('LoreGameBot', `Hai usato una pozione!\n\n${LEVEL_UP}`, { replyTo: bobs });
    // One that replies to nothing and pairs with no training: nobody's.
    await run.group('LoreGameBot', `Qualcosa accade.\n\n${LEVEL_UP}`);
    expect(run.of('loregame.levelUp')).toMatchObject([
      { player: 'bob', owner: false, level: 3, coins: 30, skillPoints: 1 },
    ]);
    expect(run.read('player', { name: 'bob' })).toMatchObject({
      game: { level: 3 },
      xp: { level_ups: [{ level: 3, xp: null }] },
    });
    expect(run.read('held')).toEqual({});
    // In private, the owner's, whatever it answers.
    await run.bot(`Una ricetta completata!\n\n${LEVEL_UP}`);
    expect(run.of('loregame.levelUp').at(-1)).toMatchObject({ player: 'alice', owner: true });
    expect(run.read('held')).toEqual({ 'una scatola di sassi 📦': 2 });
    await run.core.stop();
  });

  it('adds the XP to the players of a state kept before there was any (0.18.0)', async () => {
    const dir2 = path.join(dir, 'u2');
    const run = await bootState(dir2, { group: true });
    const bobs = await run.group('bob', '/lore');
    await run.group('LoreGameBot', gain('un sasso [B1]'), { replyTo: bobs });
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.players.bob.xp;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 5 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('player', { name: 'bob' })).toMatchObject({
      turns: 1,
      xp: { seen: 0, since_level: null, level_ups: [] },
    });
    await again.core.stop();
  });
});

describe('a profile, any player’s', () => {
  const PROFILE = (player: string, level: number, xp: number) =>
    [
      `👤 ${player}`,
      '',
      '👥 Nessuna azienda',
      '',
      `Livello ${level} (${xp} ⚔️)`,
      '▓░░░░░░░░░ 10.00%',
      '',
      'Il Bene 😇',
      'Episodio 1.200',
      '0 Ricette completate',
      '1.250 ₭',
      '',
      'Armatura 🛡 - (vuoto)',
      'Amuleto 🩺 - (vuoto)',
      'Arma 🗡 - una spatola (3 - 8)',
      '',
      '🔋 Stoccaggio II',
      '',
      '🎭 Effetti',
      '  - Neutralizzato (2 ore)',
      '',
      '',
      'Attualmente in Il Bosco Inventato ⛅️ [B1]',
    ].join('\n');

  it('is kept for the player it names, each stat queried alone, and sets their level and XP', async () => {
    const run = await bootState(path.join(dir, 'v1'), { group: true });
    // Bob's, which the owner asked for in the group: it names him.
    const asked = await run.group('alice', '/info bob', { own: true });
    await run.group('LoreGameBot', PROFILE('bob', 3, 233), { replyTo: asked });
    expect(run.of('loregame.profile')).toMatchObject([{ player: 'bob', owner: false, xp: 233 }]);
    expect(run.read('profile', { player: 'bob', stat: 'level' })).toBe(3);
    expect(run.read('profile', { player: 'bob', stat: 'equipment.weapon.level' })).toEqual({
      low: 3,
      high: 8,
    });
    expect(run.read('profile', { player: 'bob', stat: 'skills.Stoccaggio' })).toBe(2);
    expect(run.read('profile', { player: 'bob', stat: 'effects' })).toEqual([
      { name: 'Neutralizzato', until: new Date(T0 + 2 * 60 * MIN).toISOString() },
    ]);
    expect(run.read('profile', { player: 'bob', stat: 'nothing.such' })).toBeNull();
    expect(run.read('profile', { player: 'nobody' })).toBeNull();
    expect(run.read('player', { name: 'bob' })).toMatchObject({
      game: { level: 3 },
      stats: { xp: { value: 233, exact: true }, level: { value: 3, exact: true } },
      accumulo: { locked: 4 },
    });
    // Unnamed, the owner's: theirs, in private, names the account.
    expect(run.read('profile', { stat: 'coins' })).toBeNull();
    await run.owner('/me');
    await run.bot(PROFILE('alice', 4, 500));
    expect(run.of('loregame.profile').at(-1)).toMatchObject({ player: 'alice', owner: true });
    expect(run.read('profile', { stat: 'coins' })).toBe(1250);
    expect(run.read('get', { path: 'owner.name' })).toBe('alice');
    // A turn of theirs since moves their XP: 1, its win's "+N" besides.
    const turn = await run.group('alice', '/lore', { own: true });
    await run.group('LoreGameBot', gain('un sasso [B1]'), { replyTo: turn });
    expect(run.read('player', { name: 'alice' })).toMatchObject({
      stats: { xp: { value: 501, exact: true }, episode: { value: 1201, exact: true } },
    });
    await run.core.stop();
  });

  it('adds the profiles to the players of a state kept before there were any (0.21.1)', async () => {
    const dir2 = path.join(dir, 'v2');
    const run = await bootState(dir2, { group: true });
    const bobs = await run.group('bob', '/lore');
    await run.group('LoreGameBot', gain('un sasso [B1]'), { replyTo: bobs });
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.players.bob.profile;
    delete kept.state.players.bob.xp.total;
    delete kept.state.players.bob.xp.exact;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 6 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('player', { name: 'bob' })).toMatchObject({
      turns: 1,
      profile: null,
      stats: {},
      stats_drift: [],
      xp: { seen: 1 },
    });
    await again.core.stop();
  });
});

describe('a player’s stats, now', () => {
  const PROFILE = (episode: number, coins: number) =>
    [
      '👤 alice',
      '',
      '👥 Nessuna azienda',
      '',
      'Livello 4 (500 ⚔️)',
      '▓░░░░░░░░░ 6.20%',
      '',
      'Il Bene 😇',
      `Episodio ${episode}`,
      '0 Ricette completate',
      `${coins} ₭`,
      '',
      'Armatura 🛡 - (vuoto)',
      'Amuleto 🩺 - (vuoto)',
      'Arma 🗡 - (vuoto)',
      '',
      '',
      'Attualmente in Altrove [M1]',
    ].join('\n');

  it('answers each stat now, moved by the turns since the profile, and tells a mismatch', async () => {
    const run = await bootState(path.join(dir, 'w1'), { group: true });
    await run.owner('/me');
    await run.bot(PROFILE(100, 50));
    run.clock.advance(MIN);
    const turn = await run.group('alice', '/lore', { own: true });
    await run.group('LoreGameBot', gain('un sasso [B1]'), { replyTo: turn });
    expect(run.read('stat', { stat: 'xp' })).toMatchObject({ value: 501, exact: true });
    expect(run.read('stat', { stat: 'episode' })).toMatchObject({ value: 101, exact: true });
    expect(run.read('stat', { stat: 'location.code' })).toMatchObject({ value: 'B1' });
    expect(run.read('stat', { stat: 'nothing' })).toBeNull();
    expect(run.read('stat', { player: 'nobody', stat: 'xp' })).toBeNull();
    // The profile, as the bot gave it, stays as it was.
    expect(run.read('profile', { stat: 'xp' })).toBe(500);
    // The next: coins spent where the parser does not read.
    await run.owner('/me');
    await run.bot(PROFILE(101, 10));
    expect(run.of('loregame-state.statsDrift')).toMatchObject([
      { player: 'alice', owner: true, stat: 'xp', expected: 501, said: 500 },
      { player: 'alice', owner: true, stat: 'coins', expected: 50, said: 10 },
      { player: 'alice', owner: true, stat: 'location', said: { name: 'Altrove', code: 'M1' } },
    ]);
    expect(run.read('stat', { stat: 'coins' })).toMatchObject({ value: 10, exact: true });
    await run.core.stop();
  });

  it('seeds the stats of a state kept before there were any from its profiles (0.22.0)', async () => {
    const dir2 = path.join(dir, 'w2');
    const run = await bootState(dir2);
    await run.owner('/me');
    await run.bot(PROFILE(100, 50));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    const alice = kept.state.players.alice;
    delete alice.stats;
    delete alice.stats_drift;
    alice.xp = { ...alice.xp, total: 507, exact: false };
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 7 }));
    const again = await bootState(dir2);
    expect(again.read('stat', { stat: 'xp' })).toMatchObject({ value: 507, exact: false });
    expect(again.read('stat', { stat: 'coins' })).toMatchObject({ value: 50, exact: true });
    expect(again.read('player', { name: 'alice' })).not.toHaveProperty('xp.total');
    await again.core.stop();
  });
});

describe('skills and equipment, as /abilita and /equipaggia answer', () => {
  const PROFILE = [
    '👤 alice',
    '',
    '👥 Nessuna azienda',
    '',
    'Livello 4 (500 ⚔️)',
    '▓░░░░░░░░░ 6.20%',
    '',
    'Il Bene 😇',
    'Episodio 100',
    '0 Ricette completate',
    '50 ₭',
    '',
    'Armatura 🛡 - una pentola (2 - 6)',
    'Amuleto 🩺 - (vuoto)',
    'Arma 🗡 - un mestolo (4)',
    '',
    '🎒 Sciacallaggio II',
    '',
    '',
    'Attualmente in Altrove [M1]',
  ].join('\n');
  const MENU = (sciacallaggio: string, points: number) =>
    [
      `🎒 Sciacallaggio ${sciacallaggio} (${sciacallaggio === 'III' ? 3 : 2}/5) +10% Probabilità di trovare oggetti rari`,
      '🔋 Stoccaggio Ø (0/5) -0 Accumulo massimo necessario',
      '',
      `Punti disponibili: ${points}`,
    ].join('\n');
  /** A command of the owner's in the group, and the bot's answer replying to it. */
  const play = async (
    run: Awaited<ReturnType<typeof bootState>>,
    command: string,
    answer: string
  ) => {
    const id = await run.group('alice', command, { own: true });
    await run.group('LoreGameBot', answer, { replyTo: id });
  };

  it('moves the equipment by each answer, in the slot the gear or the item replaced tells', async () => {
    const run = await bootState(path.join(dir, 'x1'), { group: true });
    await run.owner('/me');
    await run.bot(PROFILE);
    const worn = () => run.read('stat', { stat: 'equipment' });
    // A known item replacing another: its slot, its range.
    await play(run, '/equipaggia mestolo', 'Hai equipaggiato un mestolo!');
    expect(worn()).toMatchObject({ exact: true });
    // A new item replacing the weapon: the weapon's slot, its range not known yet.
    await play(
      run,
      '/equipaggia spatola',
      'Hai rimosso un mestolo!\nHai equipaggiato una spatola!'
    );
    expect(worn()).toMatchObject({
      value: { weapon: { item: 'una spatola', level: null }, armour: { item: 'una pentola' } },
      exact: false,
    });
    expect(run.of('loregame.equipment').at(-1)).toMatchObject({
      player: 'alice',
      owner: true,
      kind: 'equipped',
      removed: 'un mestolo',
    });
    // The slots listed: checked against what was held exactly (nothing now), and seeded.
    await play(
      run,
      '/equipaggia',
      'Formato non valido! /equipaggia {oggetto}\n\nArmatura 🛡 - una pentola (2 - 6)\nAmuleto 🩺 - (vuoto)\nArma 🗡 - una spatola (1 - 3)'
    );
    expect(worn()).toMatchObject({
      value: { weapon: { item: 'una spatola', level: { low: 1, high: 3 } } },
      exact: true,
    });
    // Taken off: its slot empty, still exact.
    await play(run, '/equipaggia pentola', 'Hai rimosso una pentola!');
    expect(worn()).toMatchObject({ value: { armour: null }, exact: true });
    // A refusal, or an answer to another command, changes nothing.
    await play(run, '/equipaggia sasso', "Non possiedi l'oggetto!");
    await play(run, '/usa pentola', 'Hai equipaggiato una pentola!');
    expect(worn()).toMatchObject({ value: { armour: null }, exact: true });
    // The next profile disagrees on the armour: told.
    await run.owner('/me');
    await run.bot(PROFILE.replace('Arma 🗡 - un mestolo (4)', 'Arma 🗡 - una spatola (1 - 3)'));
    expect(run.of('loregame-state.statsDrift')).toMatchObject([
      { stat: 'equipment', expected: { armour: null }, said: { armour: { item: 'una pentola' } } },
    ]);
    await run.core.stop();
  });

  it('checks and seeds the skills and the points left by the menu, and counts a level-up’s', async () => {
    const run = await bootState(path.join(dir, 'x2'), { group: true });
    await run.owner('/me');
    await run.bot(PROFILE);
    await play(run, '/abilita', MENU('II', 1));
    expect(run.of('loregame.skills').at(-1)).toMatchObject({ player: 'alice', points: 1 });
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 1, exact: true });
    expect(run.read('stat', { stat: 'skills' })).toMatchObject({ value: { Sciacallaggio: 2 } });
    expect(run.of('loregame-state.statsDrift')).toEqual([]);
    // A level-up gives a point; the menu replying to another command is not read.
    await run.bot(
      'Hai finito una ricetta!\n\n🎉 Congratulazioni, hai raggiunto il livello 5! 🎉\nOttieni:\n> 50 monete\n> 1 punto /abilita'
    );
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 2 });
    await play(run, '/info', MENU('III', 0));
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 2 });
    // A point spent with the buttons, which the account does not hear: the next menu shows a level
    // more and a point less, a purchase, not a mismatch.
    const skillDrift = () =>
      run
        .of('loregame-state.statsDrift')
        .filter((d) => d['stat'] === 'skills' || d['stat'] === 'skill_points');
    await play(run, '/abilita', MENU('III', 1));
    expect(skillDrift()).toEqual([]);
    expect(run.read('stat', { stat: 'skills' })).toMatchObject({ value: { Sciacallaggio: 3 } });
    // The last point spent, told by a profile alone: the points follow, exact.
    await run.owner('/me');
    await run.bot(PROFILE.replace('Sciacallaggio II', 'Sciacallaggio IV'));
    expect(skillDrift()).toEqual([]);
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 0, exact: true });
    // Points the state cannot explain: a mismatch.
    await play(run, '/abilita', MENU('III', 4));
    expect(skillDrift()).toMatchObject([
      { stat: 'skills', expected: { Sciacallaggio: 4 }, said: { Sciacallaggio: 3 } },
      { stat: 'skill_points', expected: 0, said: 4 },
    ]);
    await run.core.stop();
  });

  it('adds the gear to the players of a state kept before there was any (0.23.0)', async () => {
    const dir2 = path.join(dir, 'x3');
    const run = await bootState(dir2);
    await run.owner('/me');
    await run.bot(PROFILE);
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.players.alice.gear;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 8 }));
    const again = await bootState(dir2);
    expect(again.read('get', { path: 'players.alice.gear' })).toEqual({
      'una pentola': { slot: 'armour', level: { low: 2, high: 6 } },
      'un mestolo': { slot: 'weapon', level: { low: 4, high: 4 } },
    });
    await again.core.stop();
  });
});

describe('the skills menu, as its buttons change it (D144)', () => {
  // A simulation: the bot's edits are as its menus read (docs/game-bots.md §5.6), not yet seen live.
  const PROFILE = (skills: string) =>
    [
      '👤 alice',
      '',
      '👥 Nessuna azienda',
      '',
      'Livello 4 (840 ⚔️)',
      '▓▓▓▓▓▓▓▓▓░ 97.84%',
      '',
      'Il Bene 😇',
      'Episodio 700',
      '0 Ricette completate',
      '50 ₭',
      '',
      'Armatura 🛡 - (vuoto)',
      'Amuleto 🩺 - (vuoto)',
      'Arma 🗡 - (vuoto)',
      '',
      skills,
      '',
      '',
      'Attualmente in Altrove [M1]',
    ].join('\n');
  const MENU = (stoccaggio: number, points: number) =>
    [
      '🎒 Sciacallaggio II (2/5) +10% Probabilità di trovare oggetti rari',
      `🔋 Stoccaggio ${stoccaggio === 0 ? 'Ø' : 'I'} (${stoccaggio}/5) -${stoccaggio} Accumulo massimo necessario`,
      "💪🏻 Calistenico I (1/5) +2 Forza extra dall'allenamento",
      '',
      `Punti disponibili: ${points}`,
    ].join('\n');
  const WON = (learned: number, levelUp = '') =>
    [
      'Lore - Il Bosco Inventato ⛅️ [B1]',
      '',
      'Una storia.',
      'Durante il tuo cammino compare un orso [L3]!',
      'Il combattimento inizia...',
      `Alice [L4] sconfigge un orso [L3]! Hai imparato qualcosa di nuovo... (+${learned})`,
      `Hai ottenuto un sasso [B1]!${levelUp}`,
    ].join('\n');
  const UP =
    '\n\n🎉 Congratulazioni, hai raggiunto il livello 5! 🎉\nOttieni:\n> 50 monete\n> 1 punto /abilita';

  it('follows a point spent at the level-up, exactly, and reads no other edit', async () => {
    const run = await bootState(path.join(dir, 'y1'), { group: true });
    const mine = async (command: string, answer: string) => {
      const id = await run.group('alice', command, { own: true });
      return { id, answer: await run.group('LoreGameBot', answer, { replyTo: id }) };
    };
    await run.owner('/me');
    await run.bot(PROFILE('🎒 Sciacallaggio II\n💪🏻 Calistenico I'));
    await mine('/abilita', MENU(0, 0));
    // The turn that reaches 848: level 5, a point.
    run.clock.advance(MIN);
    const turn = await mine('/lore', WON(7, UP));
    expect(run.read('stat', { stat: 'level' })).toMatchObject({ value: 5, exact: true });
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 1, exact: true });
    // The menu, then Stoccaggio pressed: the bot edits the menu.
    run.clock.advance(MIN);
    const menu = await mine('/abilita', MENU(0, 1));
    const said = run.clock.now();
    run.clock.advance(5000);
    await run.edit(menu.answer, MENU(1, 0), { replyTo: menu.id, time: said });
    expect(run.of('loregame.skills').at(-1)).toMatchObject({
      player: 'alice',
      edited: true,
      points: 0,
      t: run.clock.now(),
    });
    expect(run.read('stat', { stat: 'skills' })).toMatchObject({
      value: { Sciacallaggio: 2, Stoccaggio: 1, Calistenico: 1 },
      exact: true,
    });
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 0, exact: true });
    // A purchase, not a mismatch; the same menu again (its buttons taken off) changes nothing.
    await run.edit(menu.answer, MENU(1, 0), { replyTo: menu.id, time: said });
    expect(run.of('loregame-state.statsDrift')).toEqual([]);
    // No other edit is read: a turn the bot edits is not a second turn, nor a menu answering
    // another command a menu.
    const turns = run.of('loregame.turn').length + run.of('loregame.playerTurn').length;
    await run.edit(turn.answer, WON(7, UP), { replyTo: turn.id, time: said });
    const other = await mine('/info', 'Un attimo...');
    await run.edit(other.answer, MENU(0, 9), { replyTo: other.id, time: said });
    expect(run.of('loregame.turn').length + run.of('loregame.playerTurn').length).toBe(turns);
    expect(run.read('stat', { stat: 'skill_points' })).toMatchObject({ value: 0 });
    // The next profile agrees.
    await run.owner('/me');
    await run.bot(
      PROFILE('🎒 Sciacallaggio II\n🔋 Stoccaggio I\n💪🏻 Calistenico I')
        .replace('Livello 4 (840 ⚔️)', 'Livello 5 (848 ⚔️)')
        .replace('▓▓▓▓▓▓▓▓▓░ 97.84%', '░░░░░░░░░░ 0.00%')
        .replace('Episodio 700', 'Episodio 701')
        .replace('50 ₭', '100 ₭')
        .replace('Altrove [M1]', 'Il Bosco Inventato ⛅️ [B1]')
    );
    expect(run.of('loregame-state.statsDrift')).toEqual([]);
    await run.core.stop();
  });
});

describe('the inventory, as /zaino and /i list it', () => {
  const PAGE = (first: boolean, last: boolean) => [[first ? '🔒' : '◀️', last ? '🔒' : '▶️']];
  const ITEM = (name: string, qty: number) => `> ${name} [B1] x${qty}`;

  it('takes a listing followed page by page to its last as the whole inventory', async () => {
    const run = await bootState(path.join(dir, 'z1'), { group: true });
    const t0 = run.clock.now();
    // A drop the listing will not show: given away, say, where the account did not see.
    const turn = await run.group('alice', '/lore', { own: true });
    await run.group('LoreGameBot', gain('una pigna [B1]'), { replyTo: turn });
    const asked = await run.group('alice', '/zaino', { own: true });
    const first = [`alice, hai:`, ITEM('un sasso', 2), ITEM('una perla', 1)].join('\n');
    const id = await run.group('LoreGameBot', first, {
      replyTo: asked,
      buttons: PAGE(true, false),
    });
    // A page alone is a part: what it lists, exact; the rest as it was.
    expect(run.read('inventory', {})).toMatchObject({
      listed: null,
      items: { 'un sasso': { qty: 2, exact: true }, 'una pigna': { qty: 1, exact: false } },
    });
    run.clock.advance(3000);
    await run.edit(id, ITEM('una conchiglia', 5), {
      replyTo: asked,
      time: t0,
      buttons: PAGE(false, false),
    });
    run.clock.advance(3000);
    await run.edit(id, ITEM('una piuma', 1), {
      replyTo: asked,
      time: t0,
      buttons: PAGE(false, true),
    });
    expect(run.of('loregame.inventory').map((e) => e['page'])).toEqual([
      { first: true, last: false },
      { first: false, last: false },
      { first: false, last: true },
    ]);
    expect(run.read('held')).toEqual({
      'un sasso': 2,
      'una perla': 1,
      'una conchiglia': 5,
      'una piuma': 1,
    });
    expect(run.read('inventory', {})).toMatchObject({
      listed: new Date(run.clock.now()).toISOString(),
      held: 4,
    });
    expect(run.of('loregame-state.statsDrift')).toEqual([]);
    // A drop since: none was held, exactly.
    const next = await run.group('alice', '/lore', { own: true });
    await run.group('LoreGameBot', gain('una pigna [B1]'), { replyTo: next });
    expect(run.read('get', { path: 'inventory.items.una pigna' })).toMatchObject({
      qty: 1,
      exact: true,
    });
    // A listing of one page that says otherwise: a mismatch.
    const again = await run.group('alice', '/zaino', { own: true });
    await run.group(
      'LoreGameBot',
      [
        'alice, hai:',
        ITEM('un sasso', 2),
        ITEM('una perla', 1),
        ITEM('una conchiglia', 4),
        ITEM('una piuma', 1),
        ITEM('una pigna', 1),
      ].join('\n'),
      { replyTo: again, buttons: PAGE(true, true) }
    );
    expect(run.of('loregame-state.statsDrift')).toMatchObject([
      { stat: 'inventory', expected: { 'una conchiglia': 5 }, said: { 'una conchiglia': 4 } },
    ]);
    await run.core.stop();
  });

  it('keeps every player’s, tells who holds an item, and takes a part for a part', async () => {
    const run = await bootState(path.join(dir, 'z2'), { group: true });
    // A short inventory shows no buttons at all: one page, all of it (D145's `[]`).
    const bobs = await run.group('bob', '/i');
    await run.group('LoreGameBot', ['bob, hai:', ITEM('un sasso', 7)].join('\n'), {
      replyTo: bobs,
      buttons: [],
    });
    // The owner's, from an export: no buttons, a part; and filtered, a part.
    const mine = await run.group('alice', '/zaino', { own: true });
    await run.group('LoreGameBot', ['alice, hai:', ITEM('un sasso', 2)].join('\n'), {
      replyTo: mine,
    });
    const filtered = await run.group('alice', '/i perla', { own: true });
    await run.group(
      'LoreGameBot',
      ['Filtri attivi: perla', '', 'alice, hai:', ITEM('una perla', 1)].join('\n'),
      {
        replyTo: filtered,
        buttons: PAGE(true, true),
      }
    );
    expect(run.read('inventory', {})).toMatchObject({ listed: null, held: 2 });
    expect(run.read('inventory', { player: 'bob' })).toMatchObject({
      listed: expect.any(String),
      held: 1,
    });
    expect(run.read('holders', { item: 'un sasso' })).toEqual([
      { player: 'bob', qty: 7, exact: true },
      { player: 'alice', qty: 2, exact: true },
    ]);
    // An empty inventory has no pages: it is whole.
    const carols = await run.group('carol', '/zaino');
    await run.group('LoreGameBot', 'carol, il tuo inventario è vuoto!', { replyTo: carols });
    expect(run.read('inventory', { player: 'carol' })).toMatchObject({
      held: 0,
      listed: expect.any(String),
    });
    expect(run.read('inventory', { player: 'nobody' })).toBeNull();
    await run.core.stop();
  });

  it('adds the inventories to a state kept before there were any (0.25.0)', async () => {
    const dir2 = path.join(dir, 'z3');
    const run = await bootState(dir2, { group: true });
    const bobs = await run.group('bob', '/lore');
    await run.group('LoreGameBot', gain('un sasso [B1]'), { replyTo: bobs });
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.inventory.listed;
    delete kept.state.players.bob.inventory;
    delete kept.state.players.bob.listing;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 9 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('inventory', {})).toMatchObject({ listed: null });
    expect(again.read('inventory', { player: 'bob' })).toEqual({
      held: 0,
      items: {},
      listed: null,
    });
    await again.core.stop();
  });
});

describe('the places, as /vai and /v answer', () => {
  it('moves a player, takes what entering consumed, and keeps what each place takes', async () => {
    const run = await bootState(path.join(dir, 'v9'), { group: true });
    await run.owner('/me');
    await run.bot(
      [
        '👤 alice',
        '',
        '👥 Nessuna azienda',
        '',
        'Livello 5 (900 ⚔️)',
        '▓░░░░░░░░░ 10.90%',
        '',
        'Il Bene 😇',
        'Episodio 700',
        '0 ₭',
        '',
        'Armatura 🛡 - (vuoto)',
        'Amuleto 🩺 - (vuoto)',
        'Arma 🗡 - (vuoto)',
        '',
        '',
        'Attualmente in Il Bosco Inventato ⛅️ [B1]',
      ].join('\n')
    );
    const play = async (command: string, answer: string) => {
      const id = await run.group('alice', command, { own: true });
      await run.group('LoreGameBot', answer, { replyTo: id });
    };
    await play('/zaino', 'alice, hai:\n> un sasso [M4] x2\n> una pigna [M5] x1');
    await play(
      '/vai monte',
      "Non hai accesso a Il Monte Finto 🗻 [M6]!\n\nRequisiti d'accesso per Il Monte Finto 🗻 [M6] (oggetti consumati all'arrivo)\n> Livello 6\nTi serve:\n> una piuma [M5]\nHai già:\n> un sasso [M4]"
    );
    expect(run.read('places')).toMatchObject({
      M6: { level: 6, items: [{ item: 'una piuma' }, { item: 'un sasso' }] },
    });
    await play(
      '/vai valle',
      'WOOSH! Sei arrivato alla Stagione La Valle Finta 🌄 [M5]!\n\nPer entrare, hai consumato i seguenti oggetti\n> un sasso [M4]\n> una pigna [M5]'
    );
    expect(run.read('stat', { stat: 'location' })).toMatchObject({
      value: { name: 'La Valle Finta 🌄', code: 'M5' },
      exact: true,
    });
    expect(run.read('held')).toEqual({ 'un sasso': 1 });
    expect(run.read('get', { path: 'inventory.items.una pigna' })).toMatchObject({
      qty: 0,
      exact: true,
    });
    // Where one is, and where one can go.
    await play(
      '/v',
      "Ti trovi nella stagione La Valle Finta 🌄 [M5]\n\nRequisiti d'accesso (oggetti consumati all'arrivo)\n> Livello 5\n> un sasso [M4]\n> una pigna [M5]\n\nPuoi andare in:\n> 🔒 Il Monte Finto 🗻 [M6]\n> Il Bosco Inventato ⛅️ [B1]"
    );
    expect(run.read('places')).toMatchObject({
      M5: { level: 5, exits: [{ code: 'M6' }, { code: 'B1' }] },
      M6: { level: 6 },
    });
    // An arrival tells what the place takes now: M5 takes what it consumed.
    expect(run.read('places')).toMatchObject({
      M5: { items: [{ item: 'un sasso' }, { item: 'una pigna' }], guardians: [] },
    });
    // Down, nothing taken: the place takes nothing.
    await play('/vai bosco', 'WOOSH! Sei arrivato alla Stagione Il Bosco Inventato ⛅️ [B1]!');
    expect(run.read('held')).toEqual({ 'un sasso': 1 });
    expect(run.read('places')).toMatchObject({ B1: { items: [] } });
    await run.core.stop();
  });

  it('plans a trip: its way, and what each step takes of the player, up or down', async () => {
    const run = await bootState(path.join(dir, 'v11'), { group: true });
    await run.owner('/me');
    await run.bot(
      [
        '👤 alice',
        '',
        '👥 Nessuna azienda',
        '',
        'Livello 5 (900 ⚔️)',
        '▓░░░░░░░░░ 10.90%',
        '',
        'Il Bene 😇',
        'Episodio 700',
        '0 ₭',
        '',
        'Armatura 🛡 - (vuoto)',
        'Amuleto 🩺 - (vuoto)',
        'Arma 🗡 - (vuoto)',
        '',
        '',
        'Attualmente in Il Bosco Inventato ⛅️ [B1]',
      ].join('\n')
    );
    const play = async (command: string, answer: string) => {
      const id = await run.group('alice', command, { own: true });
      await run.group('LoreGameBot', answer, { replyTo: id, buttons: [] });
    };
    await play('/zaino', 'alice, hai:\n> un sasso [B2] x1\n> una pigna [B3] x1');
    await play(
      '/v',
      "Ti trovi nella stagione Il Bosco Inventato ⛅️ [B1]\n\nRequisiti d'accesso (oggetti consumati all'arrivo)\n> Livello 1\n\nPuoi andare in:\n> 🔒 Il Prato Finto 🌾 [B2]\n> 🔒 Il Limbo Inventato 🕑 [N1]"
    );
    // B2 told by a refusal, B3 by /requisiti; B3 asks a guardian as well, not made yet.
    await play(
      '/vai prato',
      "Non hai accesso a Il Prato Finto 🌾 [B2]!\n\nRequisiti d'accesso per Il Prato Finto 🌾 [B2] (oggetti consumati all'arrivo)\n> Livello 2\nTi serve:\n> un sasso [B2]"
    );
    await play(
      '/requisiti colle',
      "Requisiti d'accesso per Il Colle Finto ⛰ [B3] (oggetti consumati all'arrivo)\n> Livello 3\nTi serve:\n> una pigna [B3]\n> un sasso [B2]\n> Almeno un guardiano generato da [B2]"
    );
    const at = new Date(run.clock.now()).toISOString();
    expect(run.read('places')).toMatchObject({ B3: { guardians: ['B2'] } });
    expect(run.read('trip', { to: 'B2', at })).toMatchObject({
      from: 'B1',
      route: ['B2'],
      routed: true,
      ok: true,
      steps: [{ code: 'B2', level_ok: true, takes: [{ item: 'un sasso' }], missing: [] }],
    });
    // Two steps: the stone B2 takes is not there for B3 too; no guardian made at B2 yet.
    expect(run.read('trip', { to: 'B3', at })).toMatchObject({
      route: ['B2', 'B3'],
      ok: false,
      steps: [
        { missing: [] },
        { missing: [{ item: 'un sasso' }], guardians: ['B2'], guardians_ok: false },
      ],
    });
    // Refusals tell whether one has been made, by anyone: not yet ("Ti serve:"), then yes ("Hai
    // già:"), whoever was refused.
    const b3 = (has: string) =>
      `Non hai accesso a Il Colle Finto ⛰ [B3]!\n\nRequisiti d'accesso per Il Colle Finto ⛰ [B3] (oggetti consumati all'arrivo)\n> Livello 3\nTi serve:\n> una pigna [B3]\n> un sasso [B2]\n${has}> Almeno un guardiano generato da [B2]`;
    await play('/vai colle', b3(''));
    expect(run.read('guardians')).toEqual({ B2: false });
    expect(run.read('trip', { to: 'B3', at })).toMatchObject({
      steps: [{}, { guardians_ok: false }],
    });
    const asked = await run.group('bob', '/vai colle');
    await run.group('LoreGameBot', b3('Hai già:\n'), { replyTo: asked });
    expect(run.read('guardians')).toEqual({ B2: true });
    expect(run.read('trip', { to: 'B3', at })).toMatchObject({
      steps: [{}, { guardians_ok: true }],
    });
    // An arrival where one is asked: it was made (none is consumed).
    await play('/vai colle', b3(''));
    const id = await run.group('carol', '/vai colle');
    await run.group('LoreGameBot', 'WOOSH! Sei arrivato alla Stagione Il Colle Finto ⛰ [B3]!', {
      replyTo: id,
    });
    expect(run.read('guardians')).toEqual({ B2: true });
    // How far alice can climb: B2 takes her stone, and B3 nothing now (carol's arrival consumed
    // none); no place known above it.
    expect(run.read('reach')).toMatchObject({
      player: 'alice',
      ladder: 'B',
      from: 'B1',
      path: ['B2', 'B3'],
      reached: { code: 'B3', step: 3 },
      next: null,
      top: true,
      unknown: null,
    });
    expect(run.read('reach', { player: 'dave' })).toMatchObject({ unknown: 'alignment' });
    // A neutral place: open only while "Neutralizzato" lasts; and what N1 takes is not known.
    expect(run.read('trip', { to: 'N1', at })).toMatchObject({
      steps: [{ code: 'N1', neutral: true, neutral_ok: false, as_of: null }],
      ok: false,
    });
    await run.core.stop();
  });

  it('adds the places to a state kept before there were any (0.26.0)', async () => {
    const dir2 = path.join(dir, 'v10');
    const run = await bootState(dir2);
    await run.turn(gain('un sasso [B1]'));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.places;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 10 }));
    const again = await bootState(dir2);
    expect(again.read('places')).toEqual({});
    expect(again.read('held')).toEqual({ 'un sasso': 1 });
    await again.core.stop();
  });

  it('adds the guardians to the places kept before they were read (0.29.0)', async () => {
    const dir2 = path.join(dir, 'v12');
    const run = await bootState(dir2, { group: true });
    await run.group(
      'LoreGameBot',
      "Requisiti d'accesso per Il Prato Finto 🌾 [B2] (oggetti consumati all'arrivo)\n> Livello 2\n> un sasso [B2]"
    );
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.places.B2.guardians;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 11 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('places')).toMatchObject({ B2: { level: 2, guardians: [] } });
    await again.core.stop();
  });

  it('keeps the guardians made by place, not by player, folding in those kept (0.32.0)', async () => {
    const dir2 = path.join(dir, 'v13');
    const run = await bootState(dir2, { group: true });
    for (const who of ['bob', 'carol']) {
      const id = await run.group(who, '/vai prato');
      await run.group('LoreGameBot', 'WOOSH! Sei arrivato alla Stagione Il Prato Finto 🌾 [B2]!', {
        replyTo: id,
      });
    }
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.31.0 kept them: each player's, and none by place. Carol was told none made at B1 yet.
    delete kept.state.guardians;
    kept.state.players.bob.guardians = { B1: true };
    kept.state.players.carol.guardians = { B1: false, B2: false };
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 12 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('guardians')).toEqual({ B1: true, B2: false });
    expect(again.read('player', { name: 'bob' })).not.toHaveProperty('guardians');
    await again.core.stop();
  });

  it('drops a timed hold on /accumulo kept from before (0.34.0)', async () => {
    const dir2 = path.join(dir, 'v14');
    const run = await bootState(dir2);
    await run.owner('/lore');
    await run.bot(lit('un sasso [B1]'));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.32.0 kept them: a "not yet" for 3 hours, and the level gate for 6.
    kept.state.readiness.commands['/accumulo'] = {
      readyAt: T0 + 180 * MIN,
      why: 'it said too soon',
      unlocked: { at: T0 },
    };
    kept.state.readiness.holds.level = {
      until: T0 + 360 * MIN,
      why: 'under the level the bot asks',
      commands: ['/accumulo'],
    };
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 13 }));
    const again = await bootState(dir2);
    expect(again.read('get', { path: 'readiness' })).toMatchObject({
      commands: { '/accumulo': { unlocked: { at: T0 } } },
      holds: {},
    });
    expect(again.read('get', { path: 'readiness.commands./accumulo' })).not.toHaveProperty(
      'readyAt'
    );
    await again.core.stop();
  });
});

describe('neutrality, as a ticket gives it and its end takes it', () => {
  it('adds 10 hours a ticket, takes the ticket, and puts the owner back in their ladder', async () => {
    const run = await bootState(path.join(dir, 'n1'), { group: true });
    await run.owner('/me');
    await run.bot(
      [
        '👤 alice',
        '',
        '👥 Nessuna azienda',
        '',
        'Livello 2 (60 ⚔️)',
        '▓░░░░░░░░░ 10.90%',
        '',
        'Il Bene 😇',
        'Episodio 70',
        '0 ₭',
        '',
        'Armatura 🛡 - (vuoto)',
        'Amuleto 🩺 - (vuoto)',
        'Arma 🗡 - (vuoto)',
        '',
        '',
        'Attualmente in Il Bosco Inventato ⛅️ [B1]',
      ].join('\n')
    );
    await run.owner('/zaino');
    await run.bot('alice, hai:\n> un biglietto neutralizzante 🎫 [X] [usabile] x2', {
      buttons: [],
    });
    const TICKET =
      'alice, prendi il biglietto ma ti sbriciola in mano! Aspetta, ti sta succedendo qualcosa di strano... perché hai perso colore?';
    const t0 = run.clock.now();
    await run.owner('/usa neutralizzante');
    await run.bot(TICKET);
    await run.owner('/usa neutralizzante');
    await run.bot(TICKET);
    expect(run.of('loregame.neutral')).toMatchObject([
      { player: 'alice', owner: true, kind: 'neutralized' },
      { player: 'alice', owner: true, kind: 'neutralized' },
    ]);
    // Two tickets: 20 hours, exactly; both gone.
    expect(run.read('stat', { stat: 'effects' })).toMatchObject({
      value: [{ name: 'Neutralizzato', until: new Date(t0 + 20 * 3_600_000).toISOString() }],
      exact: true,
    });
    expect(
      run.read('get', { path: 'inventory.items.un biglietto neutralizzante 🎫' })
    ).toMatchObject({ qty: 0, exact: true });
    await run.owner('/vai limbo');
    await run.bot('WOOSH! Sei arrivato alla Stagione Il Limbo Inventato 🕑 [N1]!');
    // Its end, told in private: the effect gone, and back in the good's ladder, not exactly.
    await run.bot('[N] Hai ripreso colore e sei stato buttato fuori dalla neutralità!');
    expect(run.read('stat', { stat: 'effects' })).toMatchObject({ value: [], exact: true });
    expect(run.read('stat', { stat: 'location' })).toMatchObject({
      value: { code: 'B1' },
      exact: false,
    });
    await run.core.stop();
  });

  it('keeps another player’s ticket, and moves none whose place is not neutral', async () => {
    const run = await bootState(path.join(dir, 'n2'), { group: true });
    await run.group(
      'LoreGameBot',
      'bob, prendi il biglietto ma ti sbriciola in mano! Aspetta, ti sta succedendo qualcosa di strano... perché hai perso colore?'
    );
    expect(run.of('loregame.neutral')).toMatchObject([
      { player: 'bob', owner: false, kind: 'neutralized' },
    ]);
    expect(run.read('player', { name: 'bob' })).not.toBeNull();
    // The end, in the group, is no one's; in private, the owner's, who is not in a neutral place.
    await run.group(
      'LoreGameBot',
      '[N] Hai ripreso colore e sei stato buttato fuori dalla neutralità!'
    );
    expect(run.of('loregame.neutral')).toHaveLength(1);
    await run.owner('/me');
    await run.bot(
      [
        '👤 alice',
        '',
        '👥 Nessuna azienda',
        '',
        'Livello 2 (60 ⚔️)',
        '▓░░░░░░░░░ 10.90%',
        '',
        'Il Male 👿',
        'Episodio 70',
        '0 ₭',
        '',
        'Armatura 🛡 - (vuoto)',
        'Amuleto 🩺 - (vuoto)',
        'Arma 🗡 - (vuoto)',
        '',
        '',
        'Attualmente in L’Inferno [M1]',
      ].join('\n')
    );
    await run.bot('[N] Hai ripreso colore e sei stato buttato fuori dalla neutralità!');
    expect(run.read('stat', { stat: 'location' })).toMatchObject({
      value: { code: 'M1' },
      exact: true,
    });
    await run.core.stop();
  });
});

describe('gifts, as /give and /dai answer', () => {
  it('moves items and coins from the giver to the receiver, each player’s', async () => {
    const run = await bootState(path.join(dir, 'g1'), { group: true });
    await run.owner('/me');
    await run.bot(
      [
        '👤 alice',
        '',
        '👥 Nessuna azienda',
        '',
        'Livello 4 (500 ⚔️)',
        '▓░░░░░░░░░ 6.20%',
        '',
        'Il Bene 😇',
        'Episodio 100',
        '50 ₭',
        '',
        'Armatura 🛡 - (vuoto)',
        'Amuleto 🩺 - (vuoto)',
        'Arma 🗡 - (vuoto)',
        '',
        '',
        'Attualmente in Altrove [M1]',
      ].join('\n')
    );
    const listing = await run.group('alice', '/zaino', { own: true });
    await run.group('LoreGameBot', 'alice, hai:\n> un sasso [B1] x3', {
      replyTo: listing,
      buttons: [['🔒', '🔒']],
    });
    // The owner's gift, in the group: the answer is a message of its own.
    await run.group('alice', '/dai bob sasso', { own: true });
    await run.group('LoreGameBot', 'Hai inviato 2x un sasso [B1] a @BOB!');
    expect(run.of('loregame.gift')).toMatchObject([
      { player: 'alice', owner: true, kind: 'item', to: 'BOB', toOwner: false, qty: 2 },
    ]);
    expect(run.read('get', { path: 'inventory.items.un sasso' })).toMatchObject({
      qty: 1,
      exact: true,
    });
    expect(run.read('inventory', { player: 'BOB' })).toMatchObject({
      items: { 'un sasso': { qty: 2, exact: false, via: 'gift' } },
    });
    // Bob, known by his username, gives the owner coins: theirs rise, exactly.
    const bobs = await run.group('bob', '/lore');
    await run.group('LoreGameBot', gain('una pigna [B1]'), { replyTo: bobs });
    await run.group('bob', '/give alice 20');
    await run.group('LoreGameBot', 'Hai inviato 20 monete a alice!');
    expect(run.of('loregame.gift').at(-1)).toMatchObject({
      player: 'bob',
      toOwner: true,
      coins: 20,
    });
    expect(run.read('stat', { stat: 'coins' })).toMatchObject({ value: 70, exact: true });
    expect(run.read('holders', { item: 'un sasso' })).toEqual([
      { player: 'BOB', qty: 2, exact: false },
      { player: 'alice', qty: 1, exact: true },
    ]);
    await run.core.stop();
  });
});

describe('the market, every company’s and every player’s (§5.11)', () => {
  // Invented companies and players; the bot's own words are the game's.
  const UPDATE = (pinco: number, change: string) =>
    `📈 Mercato Fazionario 📉 aggiornato!\n\n${change.startsWith('-') ? '↘' : change === '0' ? '→' : '↗'} Pinco Spa 🍕: ${pinco} (${change}, ${change}.00%)\n→ Tizio Srl: 50 (0, 0.00%)`;
  const PROFILE = (player: string, coins: number) =>
    [
      `👤 ${player}`,
      '',
      '👥 Pinco Spa',
      '',
      'Livello 4 (500 ⚔️)',
      '▓░░░░░░░░░ 6.20%',
      '',
      'Il Bene 😇',
      'Episodio 100',
      '0 Ricette completate',
      `${coins} ₭`,
      '',
      'Armatura 🛡 - (vuoto)',
      'Amuleto 🩺 - (vuoto)',
      'Arma 🗡 - (vuoto)',
    ].join('\n');

  it('keeps each company’s value and series, its updates’ schedule, and every player’s investments', async () => {
    const run = await bootState(path.join(dir, 'market'), { group: true });
    const HOUR = 60 * MIN;
    // Four updates of the bot's own, six hours apart: the interval learned.
    for (const [i, v] of [100, 104, 102, 108].entries()) {
      if (i > 0) run.clock.advance(6 * HOUR);
      await run.group('LoreGameBot', UPDATE(v, i === 0 ? '0' : '+2'));
    }
    // One its developer forces out of turn, then the next on schedule, two later: one missed.
    run.clock.advance(HOUR);
    await run.group('carol', '/aggiornaborsa');
    await run.group('LoreGameBot', UPDATE(110, '+2'));
    run.clock.advance(11 * HOUR);
    await run.group('LoreGameBot', UPDATE(97, '-13'));
    const market = run.read('market') as {
      companies: Record<string, { name: string; value: number; via: string; direction: string }>;
      schedule: { period_min: number; missed: string[]; next: string };
    };
    // Each company by an id of its own, its name as the market writes it.
    expect(Object.keys(market.companies)).toEqual(['pinco-spa', 'tizio-srl']);
    expect(market.companies['pinco-spa']).toMatchObject({
      name: 'Pinco Spa 🍕',
      value: 97,
      via: 'update',
      direction: 'down',
    });
    expect(market.schedule.period_min).toBe(360);
    expect(market.schedule.missed).toEqual([new Date(T0 + 24 * HOUR).toISOString()]);
    expect(market.schedule.next).toBe(new Date(T0 + 36 * HOUR).toISOString());
    const history = run.read('marketHistory', { company: 'Pinco Spa 🍕' }) as Record<
      string,
      { name: string; gone: string | null; points: { value: number; via: string }[] }
    >;
    expect(history['pinco-spa']).toMatchObject({ name: 'Pinco Spa 🍕', gone: null });
    expect(history['pinco-spa']?.points.map((p) => [p.value, p.via])).toEqual([
      [100, 'update'],
      [104, 'update'],
      [102, 'update'],
      [108, 'update'],
      [110, 'forced'],
      [97, 'update'],
    ]);
    expect(Object.keys(run.read('marketHistory') as object)).toEqual(['pinco-spa', 'tizio-srl']);
    expect(run.of('loregame-state.marketUpdated').map((e) => e['via'])).toEqual([
      'update',
      'update',
      'update',
      'update',
      'forced',
      'update',
    ]);
    // bob, known by a profile with his coins: his investment, and his market listed to him.
    await run.group('LoreGameBot', PROFILE('bob', 300));
    await run.group('bob', '/punta 100 pinco');
    await run.group(
      'LoreGameBot',
      'Hai puntato 100 ₭ su Pinco Spa 🍕.\nTotale investito: 100 ₭ al valore iniziale 97.\nTi rimangono 200 ₭.'
    );
    run.clock.advance(MIN);
    await run.group('bob', '/borsa');
    await run.group(
      'LoreGameBot',
      '📈 Mercato Fazionario 📉\n\n↗ Pinco Spa 🍕: 99 (+2, +2.06%)\n→ Tizio Srl: 50 (0, 0.00%)\n\nI tuoi investimenti\n> Pinco Spa 🍕: 100 ₭ investiti, valore 102 ₭ (+2.06%)\n\nTotale investito: 100 ₭\nValore attuale: 102 ₭ (+2.06%)'
    );
    expect(run.read('investments', { player: 'bob' })).toEqual({
      'pinco-spa': {
        company: 'Pinco Spa 🍕',
        invested: 100,
        entry: 97,
        value: 102,
        now: 102,
        as_of: new Date(run.clock.now()).toISOString(),
      },
    });
    expect(run.read('stat', { player: 'bob', stat: 'coins' })).toMatchObject({
      value: 200,
      exact: true,
    });
    // The listing's value is a point of its own; it announces no update.
    expect(
      (
        run.read('marketHistory', { company: 'pinco-spa' }) as Record<
          string,
          { points: { via: string }[] }
        >
      )['pinco-spa']?.points.at(-1)
    ).toMatchObject({ value: 99, via: 'listing' });
    expect(run.of('loregame-state.marketUpdated')).toHaveLength(6);
    // A part withdrawn, then all of it.
    await run.group('bob', '/riscuoti 40 pinco');
    await run.group(
      'LoreGameBot',
      'Hai riscosso 40 ₭ da Pinco Spa 🍕.\nIncasso: 41 ₭ (+2.06%).\nValore rimasto: 61 ₭.'
    );
    expect(run.read('investments', { player: 'bob' })).toMatchObject({
      'pinco-spa': { invested: 60, entry: 97, value: 61 },
    });
    await run.group('bob', '/ritira');
    await run.group(
      'LoreGameBot',
      'Hai riscosso tutti gli investimenti dal 📈 Mercato Fazionario 📉.\n\n> Pinco Spa 🍕: 60 ₭ investiti, incasso 61 ₭\n\nTotale ritirato: 60 ₭\nIncasso totale: 61 ₭ (+1.67%)'
    );
    expect(run.read('investments', { player: 'bob' })).toEqual({});
    expect(run.read('stat', { player: 'bob', stat: 'coins' })).toMatchObject({ value: 302 });
    // A company's page, as it names it; and an answer no one waits for is no one's.
    await run.group(
      'LoreGameBot',
      'Azienda Pinco Spa (1/20)\n\n👑 bob\n\n⚔️ 500\n\n👥 1 membri\n\n- 😇 bob [L4] (500 ⚔️)\n\n📈 Valore: 99'
    );
    // Its page names it without its emoji: the company whose letters it has.
    expect(run.read('get', { path: 'market.companies' })).toMatchObject({
      'pinco-spa': {
        name: 'Pinco Spa 🍕',
        page: { leader: 'bob', members: [{ player: 'bob', faction: '😇' }], value: 99 },
      },
    });
    await run.group(
      'LoreGameBot',
      'Hai puntato 5 ₭ su Tizio Srl.\nTotale investito: 5 ₭ al valore iniziale 50.\nTi rimangono 0 ₭.'
    );
    expect(run.of('loregame.invest')).toHaveLength(1);
    expect(run.read('investments', { player: 'nobody' })).toBeNull();
    // Renamed by its leader, and Tizio Srl no longer quoted: the same company, and one gone.
    run.clock.advance(HOUR);
    await run.group(
      'LoreGameBot',
      '📈 Mercato Fazionario 📉 aggiornato!\n\n↗ Pinco Spa 🍕🎉: 101 (+2, +2.02%)'
    );
    expect(run.read('get', { path: 'market.companies' })).toMatchObject({
      'pinco-spa': {
        name: 'Pinco Spa 🍕🎉',
        names: [{ name: 'Pinco Spa 🍕' }, { name: 'Pinco Spa 🍕🎉' }],
      },
    });
    expect(Object.keys(run.read('get', { path: 'market.companies' }) as object)).toEqual([
      'pinco-spa',
    ]);
    expect(run.read('get', { path: 'market_history.gone' })).toMatchObject({
      'tizio-srl': { name: 'Tizio Srl', gone: new Date(run.clock.now()).toISOString() },
    });
    expect(run.of('loregame-state.marketUpdated').at(-1)).toMatchObject({
      quotes: [{ id: 'pinco-spa', company: 'Pinco Spa 🍕🎉', value: 101 }],
      gone: [{ id: 'tizio-srl', company: 'Tizio Srl' }],
    });
    // Its history whole under its id, by any of its names; a company that takes a name gone is new.
    expect(
      (
        run.read('marketHistory', { company: 'Pinco Spa 🍕' }) as Record<
          string,
          { points: unknown[] }
        >
      )['pinco-spa']?.points
    ).toHaveLength(8);
    run.clock.advance(HOUR);
    await run.group(
      'LoreGameBot',
      '📈 Mercato Fazionario 📉 aggiornato!\n\n→ Pinco Spa 🍕🎉: 101 (0, 0.00%)\n→ Tizio Srl: 100 (0, 0.00%)'
    );
    // Gone an hour, quoted again: back, its history with it.
    expect(Object.keys(run.read('get', { path: 'market.companies' }) as object)).toEqual([
      'pinco-spa',
      'tizio-srl',
    ]);
    expect(
      (run.read('marketHistory') as Record<string, { points: { value: number }[] }>)[
        'tizio-srl'
      ]?.points.map((p) => p.value)
    ).toEqual([50, 50, 50, 50, 50, 50, 100]);
    // Gone, its history out of the series, until it is forgotten two weeks after its newest value;
    // a company that takes its name then is another.
    run.clock.advance(HOUR);
    await run.group(
      'LoreGameBot',
      '📈 Mercato Fazionario 📉 aggiornato!\n\n→ Pinco Spa 🍕🎉: 101 (0, 0.00%)'
    );
    expect(Object.keys(run.read('marketHistory') as object)).toEqual(['pinco-spa']);
    expect(Object.keys(run.read('marketHistory', { gone: true }) as object)).toEqual([
      'pinco-spa',
      'tizio-srl',
    ]);
    run.clock.advance(15 * 24 * HOUR);
    await run.group(
      'LoreGameBot',
      '📈 Mercato Fazionario 📉 aggiornato!\n\n→ Pinco Spa 🍕🎉: 101 (0, 0.00%)'
    );
    expect(run.read('get', { path: 'market_history.gone' })).toEqual({});
    run.clock.advance(HOUR);
    await run.group(
      'LoreGameBot',
      '📈 Mercato Fazionario 📉 aggiornato!\n\n→ Pinco Spa 🍕🎉: 101 (0, 0.00%)\n→ Tizio Srl: 7 (0, 0.00%)'
    );
    expect(Object.keys(run.read('get', { path: 'market.companies' }) as object)).toEqual([
      'pinco-spa',
      'tizio-srl',
    ]);
    expect(
      (run.read('marketHistory') as Record<string, { points: unknown[] }>)['tizio-srl']?.points
    ).toHaveLength(1);
    await run.core.stop();
  });

  it('keeps history played back, and announces none of it; an empty market quotes nothing', async () => {
    const run = await bootState(path.join(dir, 'market-back'), { group: true });
    await run.bot(UPDATE(100, '0'), { playback: true });
    await run.bot('📈 Mercato Fazionario 📉\n\nNessuna azienda quotata.');
    // The market, quoting none: every company there was is gone.
    expect(run.of('loregame.market')).toMatchObject([
      { playback: true, via: 'update' },
      { via: 'listing', quotes: [] },
    ]);
    expect(run.read('market')).toMatchObject({ companies: {} });
    expect(run.read('marketHistory')).toEqual({});
    expect(run.read('marketHistory', { gone: true })).toMatchObject({
      'pinco-spa': { gone: expect.any(String) as unknown, points: [{ value: 100 }] },
    });
    expect(run.of('loregame-state.marketUpdated')).toEqual([]);
    // The owner's market, in private: theirs, though no command was heard.
    await run.bot(
      '📈 Mercato Fazionario 📉\n\n→ Tizio Srl: 50 (0, 0.00%)\n\nNon hai investimenti attivi.'
    );
    expect(run.of('loregame.investments')).toMatchObject([{ owner: true, positions: [] }]);
    await run.core.stop();
  });

  it('keeps a company gone with its history, forgotten two weeks after its newest value (0.37.0)', async () => {
    const dir2 = path.join(dir, 'v17');
    const run = await bootState(dir2, { group: true });
    await run.group('LoreGameBot', UPDATE(100, '0'));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.36.0 kept it: the series of those gone among the others', their entries without it.
    const point = (t: string) => ({ t, value: 1, change: 0, pct: 0, via: 'update' });
    const company = { names: [], quote: null, page: null, as_of: '2026-11-01T00:00:00.000Z' };
    const recent = new Date(T0 - 24 * 60 * MIN).toISOString();
    kept.state.market_history.series['old-co'] = [point('2026-09-01T00:00:00.000Z')];
    kept.state.market_history.series['new-co'] = [point(recent)];
    kept.state.market_history.gone = {
      'old-co': { ...company, name: 'Old Co', gone: '2026-09-02T00:00:00.000Z' },
      'new-co': { ...company, name: 'New Co', gone: recent },
    };
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 16 }));
    const again = await bootState(dir2, { group: true });
    expect(Object.keys(again.read('marketHistory') as object)).toEqual(['pinco-spa', 'tizio-srl']);
    expect(again.read('get', { path: 'market_history.gone' })).toEqual({
      'new-co': { ...company, name: 'New Co', gone: recent, points: [point(recent)] },
    });
    await again.core.stop();
  });

  it('takes the market and the investments from a seed, and keeps them by company id (0.35.0, 0.36.0)', async () => {
    const dir2 = path.join(dir, 'v15');
    const run = await bootState(dir2, { group: true });
    await run.group('LoreGameBot', PROFILE('bob', 10));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.34.0 kept it: no market, no companies, no investments.
    delete kept.state.market;
    delete kept.state.companies;
    delete kept.state.players.bob.investments;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    const point = { t: '2026-05-18T16:00:00.000Z', value: 100, change: 0, pct: 0, via: 'update' };
    fs.writeFileSync(
      path.join(docs, 'market-seed.json'),
      JSON.stringify({
        market: {
          as_of: point.t,
          quotes: {
            'Pinco Spa 🍕': {
              value: 100,
              change: 0,
              pct: 0,
              direction: 'flat',
              via: 'update',
              as_of: point.t,
            },
          },
          series: { 'Pinco Spa 🍕': [point] },
          schedule: { last: point.t, period_min: null, gaps_min: [], missed: [], pending: null },
        },
        companies: {},
        players: {
          bob: {
            investments: {
              'Pinco Spa 🍕': { invested: 10, entry: 100, value: 10, as_of: point.t },
            },
          },
          carol: { investments: {} },
        },
      })
    );
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 14 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('marketHistory')).toEqual({
      'pinco-spa': { name: 'Pinco Spa 🍕', gone: null, points: [point] },
    });
    expect(again.read('investments', { player: 'bob' })).toMatchObject({
      'pinco-spa': { company: 'Pinco Spa 🍕', invested: 10, now: 10 },
    });
    expect(again.read('get', { path: 'companies' })).toBeUndefined();
    expect(again.read('investments', { player: 'carol' })).toEqual({});
    expect(again.read('stat', { player: 'bob', stat: 'coins' })).toMatchObject({ value: 10 });
    await again.core.stop();
  });
});

describe('the shop, the same for every player (§5.12)', () => {
  // Invented items; the bot's own words are the game's.
  const SHOP = (player: string, ...items: string[]) =>
    [`${player}, oggi nel negozio:`, ...items].join('\n');
  const PIGNA = '- 🛒 una pigna [B1] 200₭';
  const MESTOLO = '- 🛒 un mestolo [M4] [equipaggiabile 🗡] 1.000₭';
  const GENERATORE = '- 🛒 un generatore di oggetti [X] [generatore] 100₭';
  const HOUR = 60 * MIN;
  /** The shop, as the state answers it at the clock's time. */
  const shopNow = (run: Awaited<ReturnType<typeof bootState>>, player?: string): Shop =>
    run.read('shop', {
      at: new Date(run.clock.now()).toISOString(),
      ...(player === undefined ? {} : { player }),
    }) as Shop;
  type Shop = {
    day: string | null;
    today: boolean;
    sagra: string | null;
    items: { item: string; price: number; bought: boolean | null }[];
  };

  it('keeps the day’s items, each player’s purchases apart, and announces a new day’s', async () => {
    const run = await bootState(path.join(dir, 'shop'), { group: true });
    // Nothing known yet.
    expect(shopNow(run)).toEqual({ day: null, sagra: null, as_of: null, today: false, items: [] });
    // bob asks in the group: the day's items (13:00 in Rome), none bought by alice as far as told.
    const asked = await run.group('bob', '/negozio');
    await run.group('LoreGameBot', SHOP('bob', PIGNA, MESTOLO, GENERATORE), { replyTo: asked });
    expect(run.of('loregame.shop')).toMatchObject([{ player: 'bob', owner: false, sagra: null }]);
    let shop = shopNow(run);
    expect(shop).toMatchObject({ day: '2026-11-06', today: true, sagra: null });
    expect(shop.items.map((i) => [i.item, i.price, i.bought])).toEqual([
      ['una pigna', 200, null],
      ['un mestolo', 1000, null],
      ['un generatore di oggetti', 100, null],
    ]);
    expect(shopNow(run, 'bob').items.map((i) => i.bought)).toEqual([false, false, false]);
    // alice's own, in private, the pigna bought: hers, and the same list, so nothing announced.
    run.clock.advance(HOUR);
    await run.owner('/shop');
    await run.bot(SHOP('alice', PIGNA.replace('🛒', '✅'), MESTOLO, GENERATORE));
    shop = shopNow(run);
    expect(shop.items.map((i) => i.bought)).toEqual([true, false, false]);
    expect(run.of('loregame-state.shopChanged')).toEqual([
      expect.objectContaining({
        day: '2026-11-06',
        new: ['una pigna', 'un mestolo', 'un generatore di oggetti'],
      }),
    ]);
    // After midnight in Rome: yesterday's is not today's, and no one's purchases are known.
    run.clock.advance(10 * HOUR);
    expect(shopNow(run).today).toBe(false);
    // A sagra day's, listed to carol, its button pressed (an edit): the pigna is not new.
    const SAGRA = [
      "carol, c'è la sagra della pigna!",
      '',
      'oggi nel negozio:',
      PIGNA,
      '- 🛒 un sasso [B2] 50₭',
    ].join('\n');
    const listing = await run.group('LoreGameBot', SAGRA);
    await run.edit(listing, 'carol, sei sicuro di voler comprare un sasso per 50 ₭?', {
      time: run.clock.now(),
    });
    await run.edit(listing, SAGRA.replace('🛒 un sasso', '✅ un sasso'), { time: run.clock.now() });
    shop = shopNow(run, 'carol');
    expect(shop).toMatchObject({ day: '2026-11-07', today: true, sagra: 'della pigna' });
    expect(shop.items.map((i) => [i.item, i.bought])).toEqual([
      ['una pigna', false],
      ['un sasso', true],
    ]);
    expect(shopNow(run).items.map((i) => i.bought)).toEqual([null, null]);
    expect(run.of('loregame-state.shopChanged').map((e) => e['new'])).toEqual([
      ['una pigna', 'un mestolo', 'un generatore di oggetti'],
      ['un sasso'],
    ]);
    expect(run.read('shopSeen')).toMatchObject({
      'una pigna': { first: '2026-11-06', last: '2026-11-07', days: 2 },
      'un sasso': { rarity: 'B2', first: '2026-11-07', days: 1 },
      'un generatore di oggetti': { tags: ['generatore'], last: '2026-11-06', days: 1 },
    });
    await run.core.stop();
  });

  it('reads a purchase from its listing’s edits: the item in, its price out of the coins', async () => {
    const run = await bootState(path.join(dir, 'purchase'), { group: true });
    const PROFILE = [
      '👤 bob',
      '',
      '👥 Nessuna azienda',
      '',
      'Livello 4 (500 ⚔️)',
      '▓░░░░░░░░░ 6.20%',
      '',
      'Il Bene 😇',
      'Episodio 100',
      '0 Ricette completate',
      '1.500 ₭',
      '',
      'Armatura 🛡 - (vuoto)',
      'Amuleto 🩺 - (vuoto)',
      'Arma 🗡 - (vuoto)',
    ].join('\n');
    await run.group('LoreGameBot', PROFILE);
    const asked = await run.group('bob', '/negozio');
    const listing = await run.group('LoreGameBot', SHOP('bob', PIGNA, MESTOLO), {
      replyTo: asked,
    });
    const time = run.clock.now();
    run.clock.advance(MIN);
    await run.edit(
      listing,
      'bob, sei sicuro di voler comprare un mestolo [M4] [equipaggiabile 🗡] per 1.000 ₭?',
      { replyTo: asked, time }
    );
    run.clock.advance(MIN);
    await run.edit(listing, SHOP('bob', PIGNA, MESTOLO.replace('🛒', '✅')), {
      replyTo: asked,
      time,
    });
    expect(run.of('loregame.purchase')).toMatchObject([
      { player: 'bob', owner: false, item: 'un mestolo', rarity: 'M4', price: 1000, qty: 1 },
    ]);
    expect(run.read('inventory', { player: 'bob' })).toMatchObject({
      items: { 'un mestolo': { qty: 1, via: 'purchase', rarity: 'M4' } },
    });
    expect(run.read('stat', { player: 'bob', stat: 'coins' })).toMatchObject({
      value: 500,
      exact: true,
    });
    expect(shopNow(run, 'bob').items.map((i) => i.bought)).toEqual([false, true]);
    await run.core.stop();
  });

  it('reads a generator used, paired with its confirmation, and the moving box opened', async () => {
    const run = await bootState(path.join(dir, 'generators'), { group: true });
    const asked = await run.group('bob', '/generaoggetto');
    await run.group('LoreGameBot', "Stai per generare l'oggetto una pigna. Sei sicuro?", {
      replyTo: asked,
    });
    // Another player's confirmation between, and an outcome no one waits for.
    const other = await run.group('carol', '/generaguardiano');
    await run.group('LoreGameBot', 'Stai per generare il guardiano Gino. Sei sicuro?', {
      replyTo: other,
    });
    await run.group('LoreGameBot', 'La tua idea si materializza... hai generato un sasso [B1]!');
    run.clock.advance(MIN);
    await run.group(
      'LoreGameBot',
      'La tua idea si materializza... hai generato una pigna [B2]!\n\nHai ottenuto 100₭!'
    );
    expect(run.of('loregame.generated')).toMatchObject([
      { player: 'bob', owner: false, kind: 'item', name: 'una pigna', code: 'B2', reward: 100 },
    ]);
    expect(run.read('catalogue')).toMatchObject({ 'una pigna': { via: 'generated' } });
    await run.group('LoreGameBot', 'bob, apri lo scatolone 📦 e trovi:\n> un mestolo [M4]');
    expect(run.of('loregame.used')).toMatchObject([
      { player: 'bob', item: 'uno scatolone da trasloco 📦', found: [{ item: 'un mestolo' }] },
    ]);
    expect(run.read('inventory', { player: 'bob' })).toMatchObject({
      items: { 'un mestolo': { qty: 1, via: 'used' } },
    });
    await run.core.stop();
  });

  it('keeps the shop from 0.38.0 on, nothing known of it before', async () => {
    const dir2 = path.join(dir, 'v18');
    const run = await bootState(dir2, { group: true });
    await run.group('LoreGameBot', SHOP('bob', PIGNA));
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.37.0 kept it: no shop.
    delete kept.state.shop;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 17 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('shopSeen')).toEqual({});
    await again.group('LoreGameBot', SHOP('bob', MESTOLO));
    expect(shopNow(again).items.map((i) => i.item)).toEqual(['un mestolo']);
    await again.core.stop();
  });
});

describe('the catalogue, every item seen in the game (§6)', () => {
  type Catalogue = Record<string, { rarity: string; tags: string[]; first: string; via: string }>;

  it('keeps each item the first time it is seen anywhere, and announces it', async () => {
    const run = await bootState(path.join(dir, 'cat'), { group: true });
    const at = () => new Date(run.clock.now()).toISOString();
    const t0 = at();
    // bob's drop, in the group.
    const turn = await run.group('bob', '/lore');
    await run.group('LoreGameBot', gain('una pigna [B1]'), { replyTo: turn });
    // carol's inventory, a minute later: the pigna again, and a mestolo.
    run.clock.advance(MIN);
    const asked = await run.group('carol', '/zaino');
    await run.group(
      'LoreGameBot',
      [
        'carol, hai:',
        '> una pigna [B1] x2',
        '> un mestolo (2 - 6) [M2] [equipaggiabile 🗡] x1',
      ].join('\n'),
      { replyTo: asked }
    );
    // The shop: the mestolo's tags told otherwise, and a sasso.
    run.clock.advance(MIN);
    await run.group(
      'LoreGameBot',
      ['dave, oggi nel negozio:', '- 🛒 un mestolo [M2] 400₭', '- 🛒 un sasso [B2] 50₭'].join('\n')
    );
    const catalogue = run.read('catalogue') as Catalogue;
    expect(catalogue).toEqual({
      'una pigna': { rarity: 'B1', tags: [], first: t0, via: 'drop' },
      'un mestolo': {
        rarity: 'M2',
        tags: [],
        first: new Date(Date.parse(t0) + MIN).toISOString(),
        via: 'inventory',
      },
      'un sasso': { rarity: 'B2', tags: [], first: at(), via: 'shop' },
    });
    expect(run.of('loregame-state.itemsDiscovered').map((e) => e['items'])).toEqual([
      [{ item: 'una pigna', rarity: 'B1', tags: [], via: 'drop' }],
      [{ item: 'un mestolo', rarity: 'M2', tags: ['equipaggiabile 🗡'], via: 'inventory' }],
      [{ item: 'un sasso', rarity: 'B2', tags: [], via: 'shop' }],
    ]);
    await run.core.stop();
  });

  it('is seeded from the items the state held, by the migration to 0.39.0', async () => {
    const dir2 = path.join(dir, 'v19');
    const run = await bootState(dir2, { group: true });
    await run.turn(gain('un sasso [B1]'));
    await run.group('LoreGameBot', 'bob, oggi nel negozio:\n- 🛒 una pigna [B1] 200₭');
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.38.0 kept it: no catalogue; a place's items besides.
    delete kept.state.catalogue;
    kept.state.places = {
      B2: {
        name: 'Il Bosco',
        level: 3,
        items: [{ item: 'un ramo', rarity: 'B1', tags: ['usabile'], level: null }],
        guardians: [],
        exits: [],
        as_of: '2026-11-01T00:00:00.000Z',
      },
    };
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 18 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('catalogue')).toEqual({
      'un ramo': {
        rarity: 'B1',
        tags: ['usabile'],
        first: '2026-11-01T00:00:00.000Z',
        via: 'place',
      },
      'una pigna': { rarity: 'B1', tags: [], first: '2026-11-06T00:00:00.000Z', via: 'shop' },
      'un sasso': { rarity: 'B1', tags: [], first: new Date(T0).toISOString(), via: 'drop' },
    });
    await again.core.stop();
  });

  it('reads the recipes: a list, an answer, one made', async () => {
    const run = await bootState(path.join(dir, 'recipes'), { group: true });
    await run.group('bob', '/ricetta');
    await run.group(
      'LoreGameBot',
      '@bob, ecco le ricette a tua disposizione:\n- La zuppa [L1] [manca 1]\n\nScrivi /ricetta <nome ricetta> per vedere quali oggetti ti mancano per una certa ricetta!'
    );
    await run.group('bob', '/ricetta zuppa');
    await run.group(
      'LoreGameBot',
      '@bob, per fare la ricetta La zuppa ti mancano:\n- una rapa [B1] x1\n\nMentre hai già:\n- una pentola [B2] x2'
    );
    run.clock.advance(MIN);
    await run.group('bob', '/ricetta zuppa');
    await run.group(
      'LoreGameBot',
      '@bob, prendi in mano:\n- una pentola [B2] x1\n- una rapa [B1] x1\n\ne mescoli.\n\nOttieni: il brodo [L1]!'
    );
    expect(run.of('loregame.recipes')).toMatchObject([{ player: 'bob', owner: false }]);
    expect(run.of('loregame.recipe')).toMatchObject([{ player: 'bob', name: 'La zuppa' }]);
    expect(run.of('loregame.recipeMade')).toMatchObject([{ made: { item: 'il brodo' } }]);
    expect(run.read('recipe', { name: 'zuppa', player: 'bob' })).toMatchObject({
      name: 'La zuppa',
      level: 1,
      made: { item: 'il brodo' },
      // Made: marked as their list will mark it.
      player: { lacking: null, starred: true },
    });
    expect(run.read('inventory', { player: 'bob' })).toMatchObject({
      items: { 'una pentola': { qty: 1, exact: true }, 'il brodo': { qty: 1, via: 'recipe' } },
    });
    expect(Object.keys(run.read('recipes') as object)).toEqual(['La zuppa']);
    // Another player's make, with no list of theirs: made all the same.
    await run.group(
      'LoreGameBot',
      '@carol, prendi in mano:\n- una pentola [B2] x1\n- una rapa [B1] x1\n\ne mescoli.\n\nOttieni: il brodo [L1]!'
    );
    expect(run.read('recipe', { name: 'zuppa', player: 'carol' })).toMatchObject({
      player: { level: 1, lacking: null, items: null, starred: true },
    });
    // A list is the authority: one without the mark says it is not.
    await run.group(
      'LoreGameBot',
      '@bob, ecco le ricette a tua disposizione:\n- La zuppa [L1] [manca 2]'
    );
    expect(run.read('recipe', { name: 'zuppa', player: 'bob' })).toMatchObject({
      player: { lacking: 2, starred: false },
    });
    await run.core.stop();
  });

  it('keeps the recipes from 0.44.0 on, none known before', async () => {
    const dir2 = path.join(dir, 'v19');
    const run = await bootState(dir2, { group: true });
    await run.group(
      'LoreGameBot',
      '@bob, ecco le ricette a tua disposizione:\n- La zuppa [L1] [*]'
    );
    await run.core.stop();
    const docs = path.join(dir2, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    // As 0.43.0 kept it: no recipes, a player's neither.
    delete kept.state.recipes;
    delete kept.state.players.bob.recipes;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 19 }));
    const again = await bootState(dir2, { group: true });
    expect(again.read('recipes')).toEqual({});
    expect(again.read('player', { name: 'bob' })).toMatchObject({ recipes: {} });
    await again.core.stop();
  });
});

// A picture: a JPEG's first bytes, 32 by 16, as invented as the places.
const jpeg = (n: number): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 0x03, n]);
const ARRIVED = (place: string) => `WOOSH! Sei arrivato alla Stagione ${place}!`;
const HERE = (place: string) =>
  `Ti trovi nella stagione ${place}\n\nRequisiti d'accesso (oggetti consumati all'arrivo)\n> Livello 1\n\nPuoi andare in:\n> Il Bosco Inventato ⛅️ [B1]`;
type Media = { id: string | null; kind: string; source: { via: string; message: string } }[];
const mediaOf = (
  run: { read: (n: string, i?: Record<string, unknown>) => unknown },
  code: string
): Media => (run.read('get', { path: `places.${code}.media` }) ?? []) as Media;
const filesOf = (d: string): string[] => {
  const files = path.join(d, 'data', 'instances', 'loregame-state', 'files');
  return fs.existsSync(files) ? fs.readdirSync(files).filter((f) => !f.startsWith('.')) : [];
};

describe('the pictures of the places', () => {
  it('fetches a place’s picture once, at its first sight, and answers its bytes', async () => {
    const d = path.join(dir, 'pictures');
    const run = await bootState(d, { photos: true });
    const asked = await run.group('bob', '/vai bosco');
    const answer = await run.group('LoreGameBot', ARRIVED('Il Bosco Inventato ⛅️ [B1]'), {
      replyTo: asked,
      photo: { data: jpeg(1), mime: 'image/jpeg' },
    });
    await run.fetched();
    const id = mediaIdOf(jpeg(1));
    expect(mediaOf(run, 'B1')).toEqual([
      {
        id,
        kind: 'image',
        mime: 'image/jpeg',
        width: 32,
        height: 16,
        source: { chat: GROUP, message: answer, via: 'arrival', at: new Date(T0).toISOString() },
      },
    ]);
    expect(filesOf(d)).toEqual([`sha256-${id.slice(7)}`]);
    expect(run.read('media', { id })).toEqual({
      ok: true,
      media: { data: jpeg(1), mime: 'image/jpeg', width: 32, height: 16 },
    });
    expect(run.read('places')).toMatchObject({ B1: { media: [{ id }] } });
    // Seen again, another picture: not fetched again.
    const v = await run.group('bob', '/v');
    await run.group('LoreGameBot', HERE('Il Bosco Inventato ⛅️ [B1]'), {
      replyTo: v,
      photo: { data: jpeg(2), mime: 'image/jpeg' },
    });
    await run.fetched();
    expect(mediaOf(run, 'B1')).toHaveLength(1);
    // A message the account finds no photo in: another kind of media, kept with its source.
    const go = await run.group('bob', '/vai prato');
    const plain = await run.group('LoreGameBot', ARRIVED('Il Prato Finto 🌾 [B2]'), {
      replyTo: go,
    });
    await run.fetched();
    expect(mediaOf(run, 'B2')).toEqual([
      expect.objectContaining({
        id: null,
        kind: 'other',
        source: expect.objectContaining({ message: plain, via: 'arrival' }),
      }),
    ]);
    // Refused: not fetched, tried again at its next sight.
    const up = await run.group('bob', '/vai colle');
    await run.group('LoreGameBot', ARRIVED('Il Colle Finto ⛰ [B3]'), {
      replyTo: up,
      photo: 'MESSAGE_ID_INVALID',
    });
    await run.fetched();
    expect(mediaOf(run, 'B3')).toMatchObject([{ id: null, kind: 'unknown' }]);
    const again = await run.group('bob', '/v');
    await run.group('LoreGameBot', HERE('Il Colle Finto ⛰ [B3]'), {
      replyTo: again,
      photo: { data: jpeg(1), mime: 'image/jpeg' },
    });
    await run.fetched();
    expect(mediaOf(run, 'B3')).toMatchObject([
      { kind: 'unknown' },
      { id, kind: 'image', source: { via: 'v' } },
    ]);
    // The same picture twice is one file.
    expect(filesOf(d)).toHaveLength(1);
    // A refusal to enter shows no place's picture.
    const no = await run.group('bob', '/vai cima');
    await run.group(
      'LoreGameBot',
      "Non hai accesso a La Cima Finta 🗻 [B4]!\n\nRequisiti d'accesso per La Cima Finta 🗻 [B4] (oggetti consumati all'arrivo)\n> Livello 6",
      { replyTo: no, photo: { data: jpeg(3), mime: 'image/jpeg' } }
    );
    await run.fetched();
    expect(mediaOf(run, 'B4')).toEqual([]);
    expect(run.read('media', { id: 'B1' })).toEqual({ ok: false, error: "not a picture's id: B1" });
    expect(run.read('media', { id: mediaIdOf(jpeg(9)) })).toEqual({ ok: true, media: null });
    await run.core.stop();
    // Kept across a restart.
    const back = await bootState(d, { photos: true });
    expect(mediaOf(back, 'B1')).toMatchObject([{ id }]);
    expect(back.read('media', { id })).toMatchObject({ ok: true, media: { data: jpeg(1) } });
    await back.core.stop();
  });

  it('takes a season’s picture from its creation card, the earliest sight', async () => {
    const run = await bootState(path.join(dir, 'creation'), { photos: true });
    const asked = await run.group('bob', '/generastagione');
    await run.group('LoreGameBot', 'Stai per generare la stagione La Cima Finta 🗻. Sei sicuro?', {
      replyTo: asked,
    });
    const card = await run.group(
      'LoreGameBot',
      'La tua idea si materializza... hai generato la stagione La Cima Finta 🗻 [B9]!',
      { photo: { data: jpeg(4), mime: 'image/jpeg' } }
    );
    await run.fetched();
    expect(run.of('loregame.generated')).toMatchObject([{ kind: 'season', answer: card }]);
    expect(run.read('places')).toMatchObject({
      B9: {
        name: 'La Cima Finta 🗻',
        level: null,
        media: [{ id: mediaIdOf(jpeg(4)), source: { via: 'creation', message: card } }],
      },
    });
    await run.core.stop();
  });

  it('keeps where a place was first seen, without its bytes, with no photo edge', async () => {
    const run = await bootState(path.join(dir, 'unwired'), { group: true });
    for (const place of ['Il Bosco Inventato ⛅️ [B1]', 'Il Bosco Inventato ⛅️ [B1]']) {
      const asked = await run.group('bob', '/vai bosco');
      await run.group('LoreGameBot', ARRIVED(place), { replyTo: asked });
    }
    await run.fetched();
    expect(mediaOf(run, 'B1')).toMatchObject([
      { id: null, kind: 'unknown', source: { via: 'arrival' } },
    ]);
    await run.core.stop();
  });

  it('takes a seed of the exports’ pictures at its next start, once', async () => {
    const d = path.join(dir, 'seeded');
    const run = await bootState(d, { photos: true });
    const asked = await run.group('bob', '/vai bosco');
    await run.group('LoreGameBot', ARRIVED('Il Bosco Inventato ⛅️ [B1]'), {
      replyTo: asked,
      photo: { data: jpeg(1), mime: 'image/jpeg' },
    });
    await run.fetched();
    await run.core.stop();
    const docs = path.join(d, 'data', 'instances', 'loregame-state');
    const source = (message: string, at: string) => ({
      chat: 'Il Gruppo',
      message,
      via: 'export',
      at,
    });
    const image = (n: number, message: string, at: string) => ({
      id: mediaIdOf(jpeg(n)),
      kind: 'image',
      mime: 'image/jpeg',
      source: source(message, at),
    });
    const b64 = (n: number) => Buffer.from(jpeg(n)).toString('base64');
    fs.writeFileSync(
      path.join(docs, 'media-seed.json'),
      JSON.stringify({
        places: {
          // Older than the live one, another picture; then the same picture as live.
          B1: {
            name: 'Il Bosco Inventato ⛅️',
            media: [
              image(5, '7', '2026-10-01T00:00:00.000Z'),
              image(1, '8', '2026-10-02T00:00:00.000Z'),
            ],
          },
          M7: { name: 'Il Fondo Finto 🌋', media: [image(6, '9', '2026-10-03T00:00:00.000Z')] },
          // A picture whose bytes it was not given.
          M8: { name: 'Il Pozzo Finto', media: [image(7, '10', '2026-10-03T00:00:00.000Z')] },
        },
        files: {
          [mediaIdOf(jpeg(5))]: b64(5),
          [mediaIdOf(jpeg(6))]: b64(6),
          [mediaIdOf(jpeg(8))]: b64(9),
        },
      })
    );
    const again = await bootState(d, { photos: true });
    await again.settle();
    expect(mediaOf(again, 'B1').map((m) => [m.id, m.source.via])).toEqual([
      [mediaIdOf(jpeg(5)), 'export'],
      [mediaIdOf(jpeg(1)), 'arrival'],
    ]);
    expect(again.read('places')).toMatchObject({
      M7: { name: 'Il Fondo Finto 🌋', media: [{ id: mediaIdOf(jpeg(6)) }] },
    });
    expect(mediaOf(again, 'M8')).toEqual([]);
    expect(filesOf(d)).toHaveLength(3);
    expect(again.read('media', { id: mediaIdOf(jpeg(6)) })).toMatchObject({
      ok: true,
      media: { data: jpeg(6), mime: 'image/jpeg', width: 32, height: 16 },
    });
    expect(fs.existsSync(path.join(docs, 'media-seed.json'))).toBe(false);
    await again.core.stop();
    // A seed it cannot read is left where it is.
    fs.writeFileSync(path.join(docs, 'media-seed.json'), JSON.stringify({ places: [] }));
    const third = await bootState(d, { photos: true });
    expect(fs.existsSync(path.join(docs, 'media-seed.json'))).toBe(true);
    await third.core.stop();
  });

  it('takes a seed’s requirements of places, older than none it holds', async () => {
    const d = path.join(dir, 'seeded-requirements');
    const run = await bootState(d, { group: true });
    const play = async (player: string, command: string, answer: string) => {
      const id = await run.group(player, command);
      await run.group('LoreGameBot', answer, { replyTo: id });
    };
    // B2 told live; M4 seen by /v alone, what it takes not told.
    await play(
      'bob',
      '/vai prato',
      "Non hai accesso a Il Prato Finto 🌾 [B2]!\n\nRequisiti d'accesso per Il Prato Finto 🌾 [B2] (oggetti consumati all'arrivo)\n> Livello 2\nTi serve:\n> un sasso [B2]"
    );
    await play(
      'bob',
      '/v',
      'Ti trovi nella stagione Il Lago Finto 🌊 [M4]\nPuoi andare in:\n> Il Fosso Finto [M3]'
    );
    const live = new Date(run.clock.now()).toISOString();
    expect(run.read('places')).toMatchObject({
      B2: { requirements_as_of: live },
      M4: { requirements_as_of: null, exits: [{ code: 'M3' }] },
    });
    await run.core.stop();
    const docs = path.join(d, 'data', 'instances', 'loregame-state');
    const day = (n: number) => new Date(T0 + n * 24 * 60 * MIN).toISOString();
    const item = (name: string, rarity: string) => ({ item: name, rarity, tags: [], level: null });
    fs.writeFileSync(
      path.join(docs, 'media-seed.json'),
      JSON.stringify({
        places: {},
        files: {},
        requirements: {
          // Older than the live one: kept as told live.
          B2: {
            name: 'Il Prato Finto 🌾',
            level: 2,
            items: [item('una pigna', 'B2')],
            guardians: [],
            as_of: day(-1),
          },
          M4: {
            name: 'Il Lago Finto 🌊',
            level: 4,
            items: [item('una conchiglia 🐚', 'M4')],
            guardians: ['M3'],
            as_of: day(-2),
          },
          N3: { name: 'Il Limbo Finto 🕚', level: 3, items: [], guardians: [], as_of: day(-3) },
        },
      })
    );
    const again = await bootState(d, { group: true, at: T0 + 60 * MIN });
    await again.settle();
    expect(again.read('places')).toMatchObject({
      B2: { level: 2, items: [{ item: 'un sasso' }], requirements_as_of: live },
      M4: {
        name: 'Il Lago Finto 🌊',
        level: 4,
        items: [{ item: 'una conchiglia 🐚' }],
        guardians: ['M3'],
        exits: [{ code: 'M3' }],
        as_of: live,
        requirements_as_of: day(-2),
      },
      N3: { level: 3, items: [], exits: [], as_of: day(-3), requirements_as_of: day(-3) },
    });
    expect(fs.existsSync(path.join(docs, 'media-seed.json'))).toBe(false);
    // Told anew: the newer statement replaces the seed's.
    const id = await again.group('carol', '/req lago');
    await again.group(
      'LoreGameBot',
      "Requisiti d'accesso per Il Lago Finto 🌊 [M4] (oggetti consumati all'arrivo)\n> Livello 4\nTi serve:\n> un remo [M4]\nHai già:\n> Almeno un guardiano generato da [M3]",
      { replyTo: id }
    );
    expect(again.read('places')).toMatchObject({
      M4: {
        items: [{ item: 'un remo' }],
        requirements_as_of: new Date(T0 + 60 * MIN).toISOString(),
      },
    });
    expect(again.read('guardians')).toEqual({ M3: true });
    await again.core.stop();
  });

  it('dates the requirements the places kept before 0.46.0 told, none if never', async () => {
    const d = path.join(dir, 'v21');
    const run = await bootState(d, { group: true });
    const asked = await run.group('bob', '/vai bosco');
    await run.group('LoreGameBot', ARRIVED('Il Bosco Inventato ⛅️ [B1]'), { replyTo: asked });
    const v = await run.group('bob', '/v');
    await run.group(
      'LoreGameBot',
      'Ti trovi nella stagione Il Bosco Inventato ⛅️ [B1]\nPuoi andare in:\n> Il Prato Finto 🌾 [B2]',
      { replyTo: v }
    );
    await run.core.stop();
    const docs = path.join(d, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    for (const p of Object.values(kept.state.places) as Record<string, unknown>[])
      delete p['requirements_as_of'];
    kept.state.places.B2 = { ...kept.state.places.B1, name: 'Il Prato Finto 🌾', level: 2 };
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 21 }));
    const again = await bootState(d, { group: true });
    const at = new Date(T0).toISOString();
    expect(again.read('places')).toMatchObject({
      B1: { requirements_as_of: null },
      B2: { level: 2, requirements_as_of: at },
    });
    await again.core.stop();
  });

  it('adds the empty lists to the places kept before 0.45.0', async () => {
    const d = path.join(dir, 'v20');
    const run = await bootState(d, { group: true });
    const asked = await run.group('bob', '/vai bosco');
    await run.group('LoreGameBot', ARRIVED('Il Bosco Inventato ⛅️ [B1]'), { replyTo: asked });
    await run.core.stop();
    const docs = path.join(d, 'data', 'instances', 'loregame-state');
    const file = fs.readdirSync(docs).find((f) => f.startsWith('state')) as string;
    const kept = JSON.parse(fs.readFileSync(path.join(docs, file), 'utf8'));
    delete kept.state.places.B1.media;
    fs.writeFileSync(path.join(docs, file), JSON.stringify(kept));
    fs.writeFileSync(path.join(docs, '_meta.json'), JSON.stringify({ version: 20 }));
    const again = await bootState(d, { group: true });
    expect(again.read('places')).toMatchObject({
      B1: { name: 'Il Bosco Inventato ⛅️', media: [] },
    });
    await again.core.stop();
  });
});
