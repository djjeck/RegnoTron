import { DevKit, parseManifest } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { type ClockState } from '#src/clock/nuclear-clock.ts';
import { answer, flush, GROUP, kitWith, RAID, T0 } from '#test/plugins.ts';
import {
  CHECK_MS,
  CLOCK,
  CLOCK_COMMANDS,
  NUCLEAR_CLOCK,
  nuclearClockPlugin,
  plugins,
} from './nuclear-clock.ts';

const EMPTY: ClockState = { level: 0, posted: {}, balances: {} };
const on = { nuclearClock: 'on' };

describe('the nuclear-clock plugin', () => {
  it('declares its command, aliases out of the menus, within the names Telegram takes there', () => {
    const m = parseManifest(nuclearClockPlugin.manifest);
    const commands = m.interface.commands ?? {};
    expect(Object.keys(commands)).toEqual(Object.keys(CLOCK_COMMANDS));
    expect(commands['nuclear_warning']?.aliases).toEqual([
      'aggiornamento_della_protezione_civile',
      'avviso_della_protezione_civile',
    ]);
    for (const [name, c] of Object.entries(commands))
      if (c.menu !== undefined) expect(name.length).toBeLessThanOrEqual(32);
    // Without a group it reaches the bot, and sends nowhere.
    expect(m.inputs['group']).toMatchObject({
      type: 'chat',
      network: 'telegram-bot',
      bind: { node: 'telegram-bot', reads: [], sends: [] },
    });
    expect(plugins).toEqual([nuclearClockPlugin]);
    expect(nuclearClockPlugin.manifest.config?.parse({})).toEqual({ restS: 90 });
  });

  it('answers /nuclear_warning with the balls the game state knows, deleted from the group', async () => {
    const { game, command } = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
    });
    game().state.player('Alfa').balance = { balls: 320_000, at: T0 };
    const r = answer();
    await command('nuclear_warning').run(r.a, { args: '' });
    expect(r.texts[0]?.text).toContain('Ci sono 320.000 palle in circolazione.');
    expect(r.texts[0]?.text).toContain('- Alfa detiene il 32% di una ☢️');
    expect(r.texts[0]?.format).toBe('markdown');
    expect(r.texts[0]?.options?.deleteInGroupAfterMs).toBe(30_000);
  });

  it('posts a threshold crossed to the group through the outbox, in Markdown, with the footer', async () => {
    const { game, k, bot, sends, say, lines } = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
      settings: on,
      documents: { [CLOCK]: EMPTY },
    });
    game().state.player('Alfa').balance = { balls: 60_000, at: T0 };
    // A bot message checks the total.
    say(RAID, T0);
    k.runUntil(T0 + 1000);
    await flush();
    expect(bot.sent).toHaveLength(1);
    expect(bot.sent[0]?.chat).toBe(GROUP);
    expect(bot.sent[0]?.text).toContain('**AGGIORNAMENTO DELLA PROTEZIONE CIVILE**');
    expect(bot.sent[0]?.text).toMatch(
      /Messaggio offerto da \/aggiornamento_della_protezione_civile@ExampleBot$/u
    );
    expect(sends.map((s) => [s.plugin, s.outcome])).toEqual([[NUCLEAR_CLOCK, 'sent']]);
    expect(lines.some((l) => l.startsWith('nuclear-clock: nuclear posted: '))).toBe(true);
    // The next level, on its minute's check.
    game().state.player('Alfa').balance = { balls: 110_000, at: T0 + 2000 };
    k.runUntil(T0 + CHECK_MS + 1000);
    await flush();
    expect(bot.sent).toHaveLength(2);
    await k.stop();
  });

  it('names the bare alias once the bot is an admin of the group', async () => {
    const { game, k, bot } = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
      admin: true,
      settings: on,
      documents: { [CLOCK]: EMPTY },
    });
    game().state.player('Alfa').balance = { balls: 60_000, at: T0 };
    k.runUntil(T0 + CHECK_MS);
    await flush();
    expect(bot.sent[0]?.text).toMatch(/\/aggiornamento_della_protezione_civile$/u);
  });

  it('logs a post its mode refuses as failed, and posts nothing while the setting is off', async () => {
    const readOnly = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
      mode: 'read-only',
      settings: on,
      documents: { [CLOCK]: EMPTY },
    });
    readOnly.game().state.player('Alfa').balance = { balls: 60_000, at: T0 };
    readOnly.k.runUntil(T0 + CHECK_MS);
    await flush();
    expect(readOnly.bot.sent).toEqual([]);
    expect(readOnly.lines).toContain(
      'nuclear-clock: nuclear failed: 50000: 60000 balls: Error: read-only'
    );
    const off = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
      documents: { [CLOCK]: EMPTY },
    });
    off.game().state.player('Alfa').balance = { balls: 60_000, at: T0 };
    off.k.runUntil(T0 + CHECK_MS);
    await flush();
    expect(off.bot.sent).toEqual([]);
    expect(off.k.core.settings.current()['nuclearClock']).toBe(false);
    expect(off.k.core.settings.set('nuclearClock', 'on')).toBeUndefined();
    expect(off.k.core.settings.current()['nuclearClock']).toBe(true);
  });

  it('waits for the bot to connect before a post', async () => {
    const { game, k, bot } = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
      settings: on,
      documents: { [CLOCK]: EMPTY },
    });
    bot.close();
    game().state.player('Alfa').balance = { balls: 60_000, at: T0 };
    k.runUntil(T0 + CHECK_MS);
    await flush();
    expect(bot.sent).toEqual([]);
    bot.open();
    await flush();
    expect(bot.sent).toHaveLength(1);
  });

  it('takes a first start’s level from the log, posting nothing', async () => {
    const { k, lines, bot } = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      config: { group: GROUP },
      settings: on,
      logged: [{ time: T0 - 1000, text: RAID }],
    });
    expect(lines).toContain('nuclear-clock: nuclear: first start, at 0+ balls');
    expect(k.core.state(NUCLEAR_CLOCK)?.state).toBe('running');
    k.runUntil(T0 + CHECK_MS);
    await flush();
    expect(bot.sent).toEqual([]);
  });

  it('has no clock without a group', async () => {
    const { k, bot, game } = await kitWith(NUCLEAR_CLOCK, nuclearClockPlugin, {
      settings: on,
    });
    expect(k).toBeInstanceOf(DevKit);
    game().state.player('Alfa').balance = { balls: 60_000, at: T0 };
    k.runUntil(T0 + 2 * CHECK_MS);
    await flush();
    expect(bot.sent).toEqual([]);
  });
});
