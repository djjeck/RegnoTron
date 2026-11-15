import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootTelegram, DM, OWNER, T0 } from '#test/telegram-run.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'norelec-telegram-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the norelec parser on Telegram alone', () => {
  it("follows the account's health, and answers the owner's commands in the group", async () => {
    const run = await bootTelegram(dir);
    const status = (): unknown => {
      const r = run.core.controls.read('norelec', 'status');
      return 'value' in r ? r.value : r.error;
    };
    expect(status()).toMatchObject({ health: { connected: true } });
    run.account.close('gone');
    expect(status()).toMatchObject({ health: { connected: false } });
    run.account.open();
    await run.say(OWNER, '/give @Bravo 🐔');
    await run.bot('alice /give è disattivato.');
    expect(run.of('norelec.answer')).toEqual([
      expect.objectContaining({ rule: 'disabled', status: 'refused', player: OWNER }),
    ]);
    expect(run.of('norelec.disabled')).toEqual([
      expect.objectContaining({ what: '/give', self: OWNER }),
    ]);
    expect(run.of('norelec.message')[0]).toMatchObject({ source: 'telegram' });
    await run.core.stop();
    const again = await bootTelegram(dir, { at: T0 + 60_000 });
    expect(again.read('get', { path: 'disabled' })).toEqual({ '/give': T0 });
    await again.core.stop();
  });

  it("reads the bot's replies in the private chat as the owner's, and a catch-up as history", async () => {
    const run = await bootTelegram(dir);
    await run.bot('Casa di alice (1/10):\n1 🎈  2 ·  3 ·  4 ·  5 ·  6 ·  7 ·  8 ·  9 ·  10 ·', {
      chat: DM,
      private: true,
    });
    await run.say(OWNER, '/house', { chat: DM, private: true });
    await run.bot('COGLIONE', { chat: DM, private: true });
    expect(run.read('house', { name: OWNER })).toMatchObject({
      slots: ['🎈', ...Array(9).fill(null)],
    });
    expect(run.read('banned')).toEqual({ alice: T0 });
    // Said while the instance was down: applied, published as history, never told.
    await run.bot(
      'Bravo il palloncino di alice ha resistito. Ora il palloncino ha il 50% di probabilità di essere bucato. Torni in Bravo tra 1 minuto.',
      { playback: true }
    );
    expect(run.of('norelec.balloonHeld')).toEqual([expect.objectContaining({ playback: true })]);
    expect(run.told()).toEqual([]);
    await run.core.stop();
  });
});
