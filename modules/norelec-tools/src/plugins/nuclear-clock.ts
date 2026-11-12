/**
 * The nuclear clock as a plugin: `nuclear-clock`. It reads the game through the `norelec` plugin's
 * interface (`state.game`), answers `/nuclear_warning` (modules/norelec-tools/src/clock/
 * nuclear-warning.ts), and, with its `nuclearClock` setting on, posts the warning in the game's
 * group whenever the balls in the game cross a multiple of 50,000
 * (modules/norelec-tools/src/clock/nuclear-clock.ts). It looks at the total after each bot message
 * (`norelec.message`) and every minute on its clock.
 *
 * It is built from its config alone (MegaBotTron1999's docs/bot-os-api.md §7.2). The clock is made
 * at `ready`, once the game has replayed its history, so that the balances it kept are put back
 * into the state the replay left. A first start takes the total of every bot message of the event
 * log (`ctx.events`), and posts nothing. Its posts leave through the outbox of the Telegram bot
 * account its `group` input is bound to, to the group its config names, which that edge must send
 * to, for real unless that edge is a dry run (MegaBotTron1999's bot-os.md D64). Its one migration is a no-op, so that the store of v0's
 * `norelec-utilities`, which kept the clock (at version 1), can be imported as its instance
 * (bot-os.md D54).
 */
import { TELEGRAM_BOT } from '@megabottron1999/connectors/plugins/telegram-bot.ts';
import {
  type CommandHandler,
  definePlugin,
  type Plugin,
  type SettingValue,
} from '@megabottron1999/core';
import { parseMessage } from '@regnotron/norelec/game/parse-message.ts';
import {
  MESSAGE_EVENT,
  messagesOf,
  NORELEC,
  type NorelecInterface,
} from '@regnotron/norelec/plugins/norelec.ts';
import { GameState } from '@regnotron/norelec/state/game-state.ts';
import { z } from 'zod';
import {
  type ClockState,
  footerFor,
  initialClock,
  NuclearClock,
  STEP,
} from '#src/clock/nuclear-clock.ts';
import { nuclearWarningCommand } from '#src/clock/nuclear-warning.ts';

export const NUCLEAR_CLOCK = 'nuclear-clock';

/** The store's document of the clock. */
export const CLOCK = 'clock';

/** How often the clock looks at the total, for the end of the night. */
export const CHECK_MS = 60_000;

/** Its configuration. */
export const clockConfig = z.object({
  /** The game's Telegram group (its chat id): the clock posts there, and nowhere without one. */
  group: z
    .string()
    .min(1)
    .optional()
    .describe("The game's Telegram group, by its chat id: the posts go there; none without it"),
  /** Rest after a return, in seconds, for the game state a first start replays the log through. */
  restS: z
    .number()
    .int()
    .min(0)
    .default(90)
    .describe('Rest after a return, in seconds, for the replay of a first start'),
});
export type ClockConfig = z.output<typeof clockConfig>;

/** A switch, from its text form (`on`, `off`, `true`, `false`) or a value. */
const onOff = z.preprocess(
  (v) => (v === 'on' || v === 'true' ? true : v === 'off' || v === 'false' ? false : v),
  z.boolean()
);

/** Its settings: the owner's switch for the posts. */
export const clockSettings = z.object({
  nuclearClock: onOff.describe('post /nuclear_warning in the group at each 50,000 balls'),
});

/** The chat commands, in the order of the menus. */
export const CLOCK_COMMANDS = {
  nuclear_warning: {
    help: 'The nuclear clock of the balls',
    menu: 'nuclear clock delle palle',
    // In no menu: the first is longer than the 32 characters Telegram allows one.
    aliases: ['aggiornamento_della_protezione_civile', 'avviso_della_protezione_civile'],
  },
};

export const nuclearClockPlugin: Plugin = definePlugin({
  manifest: {
    id: NUCLEAR_CLOCK,
    version: '0.1.0',
    kinds: ['stats'],
    description: 'The nuclear clock: the balls in the game, posted at each 50,000',
    inputs: {
      game: {
        type: 'interface',
        plugin: NORELEC,
        members: ['state.game'],
        help: "NorelecBot's game: the balances the clock counts",
      },
      group: {
        type: 'chat',
        network: 'telegram-bot',
        help: "The bot in the game's group: the clock's posts; the edge sends to the config's group",
        bind: { node: TELEGRAM_BOT, reads: [], sends: [] },
      },
      messages: {
        type: 'events',
        namespace: NORELEC,
        help: "the bot messages: the clock's total",
      },
    },
    config: clockConfig,
    settings: clockSettings,
    state: { migrations: [() => {}] },
    interface: { commands: CLOCK_COMMANDS },
  },
  create: (ctx) => {
    const config = ctx.config as ClockConfig;
    const group = config.group;
    const now = (): number => ctx.clock.now();
    const game = ctx.use<NorelecInterface>('game').state.game();
    const bot = ctx.connector('group');
    const outbox = ctx.outbox('group');
    let nuclearOn = (ctx.settings.kept()['nuclearClock'] as boolean | undefined) ?? false;
    let clock: NuclearClock | undefined;
    let checks: ReturnType<typeof ctx.clock.setTimeout> | undefined;
    const check = (): void => {
      checks = ctx.clock.setTimeout(check, CHECK_MS);
      clock?.check();
    };
    /** Resolves once the bot is connected: a post waits for it. */
    const connected = (): Promise<void> =>
      bot.status().state === 'connected'
        ? Promise.resolve()
        : new Promise((resolve) => {
            const off = bot.onStatus((s) => {
              if (s.state !== 'connected') return;
              off();
              resolve();
            });
          });

    ctx.bus.subscribe(MESSAGE_EVENT, () => clock?.check());

    const commands: Record<keyof typeof CLOCK_COMMANDS, CommandHandler> = {
      nuclear_warning: { run: nuclearWarningCommand(game.state) },
    };
    return {
      commands,
      ready: () => {
        // Without a group, it has nowhere to post.
        if (group === undefined) return;
        let kept = ctx.store.read<ClockState>(CLOCK);
        if (kept === undefined) {
          // A first start takes the total of the log, and posts nothing.
          const then = new GameState({ restS: config.restS });
          for (const { time, text } of messagesOf(ctx.events.read({ type: MESSAGE_EVENT })))
            then.apply({ time, text, events: parseMessage(text) });
          kept = initialClock(then);
          ctx.log.info(`nuclear: first start, at ${kept.level * STEP}+ balls`);
        }
        clock = new NuclearClock({
          state: game.state,
          kept,
          enabled: () => nuclearOn,
          post: async (text) => {
            const sent = await outbox.deliver(group, text, { format: 'markdown' });
            if (sent.outcome !== 'sent' && sent.outcome !== 'dry-run')
              throw new Error(sent.reason ?? sent.outcome);
          },
          // The bot's name, and whether it administers the group, once it is connected.
          footer: async () => {
            await connected();
            const admin = (await bot.isAdmin?.(group).catch(() => false)) ?? false;
            return footerFor(admin, bot.self());
          },
          save: (state) => ctx.store.write(CLOCK, state),
          log: (r) => ctx.log.info(`nuclear ${r.event}: ${r.detail}`),
          now,
        });
        checks = ctx.clock.setTimeout(check, CHECK_MS);
      },
      stop: () => ctx.clock.clearTimeout(checks),
      settings: {
        apply: (key, value) => {
          if (key === 'nuclearClock') nuclearOn = value as boolean;
        },
        read: (key): SettingValue | undefined => (key === 'nuclearClock' ? nuclearOn : undefined),
      },
    };
  },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [nuclearClockPlugin];
