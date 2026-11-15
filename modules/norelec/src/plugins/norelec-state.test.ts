import { parseManifest } from '@megabottron1999/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootRun, OWNER, T0 } from '#test/run.ts';
import { norelecStatePlugin, plugins } from './norelec-state.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norelec-state-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const S = 1000;
const TAKEN = "⚽ E gli porti via la palla! Ora ce l'hai tu: tienila il più a lungo possibile.";

describe('the norelec-state node', () => {
  it('is a state on the parser’s events, with its queries', async () => {
    expect(plugins).toEqual([norelecStatePlugin]);
    const m = parseManifest(norelecStatePlugin.manifest);
    expect(m.inputs).toMatchObject({ events: { type: 'events', namespace: 'norelec' } });
    expect(Object.keys(m.interface.state ?? {})).toEqual([
      'get',
      'freshness',
      'player',
      'house',
      'trip',
      'ball',
      'held',
      'babies',
      'banned',
      'price',
    ]);
    const run = await bootRun(dir);
    expect(run.core.graphProblems()).toEqual([]);
    expect(run.core.status().every((s) => s.state === 'running')).toBe(true);
    await run.core.stop();
  });

  it('keeps the ⚽ and tells who took it, from the owner too', async () => {
    const run = await bootRun(dir);
    await run.bot("La palla ce l'ha alice da 10 secondi: rubagliela con /raid @alice.");
    run.clock.advance(100 * S - 500);
    await run.bot(
      `Bravo (🎈) hai bucato il palloncino di @alice (🎈) e rubato 0 palle! Torni in Bravo tra 1 minuto.\n${TAKEN}`
    );
    expect(run.read('ball', { at: T0 + 200 * S })).toEqual({
      holder: { name: 'Bravo', since: T0 + 100 * S },
      totals: [
        { name: 'alice', seconds: 110 },
        { name: 'Bravo', seconds: 100 },
      ],
    });
    expect(run.read('held', { name: 'alice' })).toBe(110);
    expect(run.told()).toEqual([
      expect.objectContaining({ type: 'norelec-state.raided', by: 'Bravo', outcome: 'stolen' }),
      expect.objectContaining({ type: 'norelec-state.ballMoved', from: 'alice', to: 'Bravo' }),
      expect.objectContaining({ type: 'norelec-state.ballTaken', by: 'Bravo' }),
    ]);
    await run.core.stop();
  });

  it('tells the owner of throws and a baby that locks a slot, and nothing played back', async () => {
    const run = await bootRun(dir);
    await run.bot('Casa di alice (1/10):\n1 🎈  2 ·  3 ·  4 ·  5 ·  6 ·  7 ·  8 ·  9 ·  10 ·');
    await run.bot('Bravo la tua 💦 è arrivata a casa di @alice: tra 9 ore si vedrà.');
    await run.bot(
      'Bravo congeli alice: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in Bravo tra 1 minuto.'
    );
    await run.bot(
      'Charlie la tua bomba esplode in casa di @alice ma non trova niente da portarsi via. Torni in Charlie tra 1 minuto.'
    );
    await run.bot(
      'Charlie il cane di alice ti ha intercettato: niente bottino. Torni in Charlie tra 1 minuto.'
    );
    await run.bot('@alice (🎈) è nato un maschio 👶: il padre è @Bravo.');
    // Played back: never told.
    await run.bot(
      'Delta il palloncino di alice ha resistito. Ora il palloncino ha il 50% di probabilità di essere bucato. Torni in Delta tra 1 minuto.',
      {
        playback: true,
      }
    );
    expect(run.told().map((r) => r.type)).toEqual([
      'norelec-state.thrownAt',
      'norelec-state.thrownAt',
      'norelec-state.thrownAt',
      'norelec-state.raided',
      'norelec-state.slotLocked',
    ]);
    expect(run.of('norelec-state.slotLocked')[0]).toMatchObject({
      slot: 2,
      emoji: '👶',
      by: 'Bravo',
    });
    expect(run.of('norelec-state.thrownAt').map((e) => e['emoji'])).toEqual(['💦', '🧊', '💣']);
    expect(run.read('house', { name: 'alice' })).toMatchObject({ locked: [2] });
    expect(run.read('babies', { name: 'alice' })).toEqual([
      expect.objectContaining({ slot: 2, born: expect.any(Number), father: 'Bravo' }),
    ]);
    expect(run.read('babies', {})).toHaveLength(1);
    await run.core.stop();
  });

  it('answers the other queries, and keeps its record across a restart', async () => {
    let run = await bootRun(dir);
    await run.bot('Bravo parti per Charlie: arrivi tra 1 minuto. Casa tua resta scoperta.');
    await run.bot('Bravo (🎈) hai preso gratis 🐔: 🐔 in casa nel posto 1.');
    await run.say('Delta', '/avventura');
    await run.bot('COGLIONE');
    await run.bot('alice\nCon te: 🎈\n10 palle, 2° su 3 in classifica\na casa, in alice');
    expect(run.read('trip', { name: 'Bravo' })).toMatchObject({ to: 'Charlie', rockets: 0 });
    expect(run.read('trip', { name: 'Nobody' })).toBeNull();
    expect(run.read('house', { name: 'Nobody' })).toBeNull();
    expect(run.read('player', { name: 'Nobody' })).toBeNull();
    expect(run.read('price', { emoji: '🐔' })).toEqual({ balls: 0, at: T0 + 500 });
    expect(run.read('price', { emoji: '☢️' })).toBeNull();
    expect(run.read('banned')).toEqual({ Delta: T0 + 1500 });
    await run.core.stop();
    run = await bootRun(dir);
    expect(run.read('player', { name: OWNER })).toMatchObject({ balls: { n: 10, rank: 2 } });
    expect(run.read('get', { path: 'self' })).toBe(OWNER);
    await run.core.stop();
  });
});
