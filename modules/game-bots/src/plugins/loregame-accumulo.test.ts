import { parseManifest, readAnswer } from '@megabottron1999/core';
import { TURN_PARSER_MEMBERS } from '@megabottron1999/turns/turn-parser.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POLL_MS } from '#src/accumulo.ts';
import { bootState, MIN, T0 } from '#test/state-run.ts';
import { loregamePlugin } from './loregame.ts';
import { loregameAccumuloPlugin, plugins } from './loregame-accumulo.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loregame-accumulo-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Invented places and items; the bot's own phrases are the game's.
const HEADER = 'Lore - Il Bosco Inventato ⛅️ [B1]\n\nUna storia.';
const MARK = '🔋 /accumulo pronto!';
const lit = `${HEADER}\n\n${MARK}\nHai ottenuto un sasso [B1]!`;
const plain = `${HEADER}\nHai ottenuto un sasso [B1]!`;
const SHORT = (n: number, max: number): string =>
  `Accumulo non ancora sufficiente!\n\nIl tuo accumulo: ${n}/${max}`;
const USED =
  '🔋 IL TUO ACCUMULO SI ATTIVA! Ti senti di nuovo pronto per vivere una nuova storia! /lore';
const BAN = 'Sei stato bannato fino al 06/11/2026, 18:00:00.';
const BAN_END = Date.parse('2026-11-06T17:00:00Z');
const NODE = 'loregame-accumulo';

describe('the loregame-accumulo node', () => {
  it('offers the turn parser’s contract, which a shell turn-actor’s parser input takes', async () => {
    expect(plugins).toEqual([loregameAccumuloPlugin]);
    const m = parseManifest(loregameAccumuloPlugin.manifest);
    expect(m.id).toBe(NODE);
    expect(m.inputs).toMatchObject({
      state: { type: 'interface', plugin: 'loregame-state' },
      parser: { type: 'interface', plugin: 'loregame' },
    });
    const offered = [
      ...Object.keys(m.interface.state ?? {}).map((n) => `state.${n}`),
      ...Object.keys(m.interface.actions ?? {}).map((n) => `actions.${n}`),
    ];
    for (const member of TURN_PARSER_MEMBERS) expect(offered).toContain(member);
    const run = await bootState(dir);
    expect(run.core.graphProblems()).toEqual([]);
    expect(run.core.status().every((s) => s.state === 'running')).toBe(true);
    // The actor counts from its own sends: nothing of the owner's is its last turn.
    expect(run.core.controls.read(NODE, 'lastTurn')).toEqual({ value: undefined });
    await run.core.stop();
  });

  it('lets it go only on the bot’s word, once there is a rest to zero, and not after the use', async () => {
    const run = await bootState(dir);
    // Nothing known: not full.
    expect(run.rest(NODE)).toEqual({ until: T0 + POLL_MS, why: 'the accumulo is not full' });
    await run.owner('/accumulo');
    await run.bot(SHORT(2, 3));
    // One turn to go, and the bot rests 15 minutes between turns: not before the next is possible.
    expect(run.rest(NODE)).toEqual({ until: T0 + 15 * MIN, why: 'the accumulo is not full' });
    // The turn that fills it says so; the rest after it is what /accumulo zeroes.
    run.clock.advance(16 * MIN);
    await run.owner('/lore');
    await run.bot(lit);
    expect(run.read('accumulo')).toMatchObject({ ready: true, count: 3 });
    expect(run.rest(NODE)).toBeUndefined();
    // The rest runs out unused: it would be answered "already ready", and spend nothing.
    run.clock.advance(16 * MIN);
    expect(run.rest(NODE)).toMatchObject({ why: 'the next /lore is not resting: nothing to zero' });
    // Rested again: it goes, and once used it waits for the accumulo to fill again.
    await run.owner('/lore');
    await run.bot(lit);
    expect(run.rest(NODE)).toBeUndefined();
    await run.owner('/accumulo');
    await run.bot(USED);
    expect(run.rest(NODE)).toMatchObject({ why: 'the accumulo is not full' });
    await run.core.stop();
  });

  it('does not go on its own count, which says full before the bot does', async () => {
    const run = await bootState(dir);
    await run.owner('/accumulo');
    await run.bot(SHORT(1, 3));
    for (let i = 0; i < 2; i++) {
      run.clock.advance(16 * MIN);
      await run.owner('/lore');
      await run.bot(plain);
    }
    expect(run.read('accumulo')).toMatchObject({ count: 3, ready: false });
    expect(run.rest(NODE)).toMatchObject({ why: 'the accumulo is not full' });
    await run.core.stop();
  });

  it('waits behind the owner’s ban and behind the level', async () => {
    const run = await bootState(dir);
    await run.owner('/accumulo');
    await run.bot('Devi essere almeno di livello 4!');
    expect(run.rest(NODE)).toMatchObject({ why: 'the accumulo needs level 4' });
    await run.owner('/lore');
    await run.bot(BAN);
    expect(run.rest(NODE)).toEqual({ until: BAN_END, why: 'the owner is banned' });
    await run.core.stop();
  });
});

describe('what the bot’s answer to /accumulo tells a node that sent it', () => {
  it('is the ok of a use, and a refusal with its reason for the rest', () => {
    const { answers } = parseManifest(loregamePlugin.manifest);
    const heard = (result: string) => ({ chat: '@LoreGameBot', result });
    const answer = (result: string) => readAnswer(answers, 'loregame.accumulo', heard(result), T0);
    expect(answer('used')?.answer).toMatchObject({ status: 'ok', reason: 'used' });
    expect(answer('idle')?.answer).toMatchObject({ status: 'refused', reason: 'idle' });
    expect(answer('short')?.answer).toMatchObject({ status: 'refused', reason: 'not_ready' });
    expect(answer('locked')?.answer).toMatchObject({ status: 'refused', reason: 'locked' });
    // It answers /accumulo and its short form, and no other command.
    expect(answer('used')?.commands).toEqual(['/accumulo', '/acc']);
  });
});
