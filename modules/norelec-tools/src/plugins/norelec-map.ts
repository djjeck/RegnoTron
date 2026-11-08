/**
 * The map of the players' homes as a plugin: `norelec-map`. It reads the game through the `norelec`
 * plugin's interface (`state.game`) and hears each bot message from the bus (`norelec.message`,
 * after the game state has applied it); the map service (modules/norelec-tools/src/map/service.ts)
 * takes its trips, and draws the map again once they settle. The photo is rendered by the shell's
 * render service (`ctx.render`). It answers `/map`, and offers the map to other plugins
 * (`state.map`: the base time between two homes, for timing a trip).
 *
 * It is built from its config alone (MegaBotTron1999's docs/bot-os-api.md §7.2). Its store keeps
 * the measurements, the map's layout and Telegram's file id, and the photo. A first start reads the
 * trips of every bot message of the event log (`ctx.events`) through a game state of its own, so
 * that each trip counts the 🚀 carried then; from then on, each message as it comes. Its one
 * migration is a no-op, so that the store of v0's `norelec-utilities`, which kept the map (at
 * version 1), can be imported as its instance (bot-os.md D54).
 */
import { type CommandHandler, definePlugin, type Plugin } from '@megabottron1999/core';
import { parseMessage } from '@regnotron/norelec/game/parse-message.ts';
import {
  botMessageOf,
  MESSAGE_EVENT,
  messagesOf,
  NORELEC,
  type NorelecInterface,
} from '@regnotron/norelec/plugins/norelec.ts';
import { GameState } from '@regnotron/norelec/state/game-state.ts';
import { z } from 'zod';
import { drawMap } from '#src/map/draw.ts';
import { mapCommand } from '#src/map/map-command.ts';
import { MapService, playersFrom, SETTLE_MS } from '#src/map/service.ts';

export const NORELEC_MAP = 'norelec-map';

/** Its configuration. */
export const mapConfig = z.object({
  /** Rest after a return, in seconds, for the game state a first start replays the log through. */
  restS: z
    .number()
    .int()
    .min(0)
    .default(90)
    .describe('Rest after a return, in seconds, for the replay of a first start'),
  /** Quiet after a change of the map before drawing it again; 0 for only when asked. */
  settleMs: z
    .number()
    .int()
    .min(0)
    .default(SETTLE_MS)
    .describe('Quiet, in ms, after the trips change before the map is drawn again; 0: when asked'),
});
export type MapConfig = z.output<typeof mapConfig>;

/** The chat commands, in the order of the menus. */
export const MAP_COMMANDS = {
  map: { help: "The map of the players' homes", menu: 'La mappa delle case dei giocatori' },
};

export const norelecMapPlugin: Plugin = definePlugin({
  manifest: {
    id: NORELEC_MAP,
    version: '0.1.0',
    kinds: ['stats'],
    description: "The map of the players' homes, fitted to the trip times NorelecBot announces",
    inputs: {
      game: {
        type: 'interface',
        plugin: NORELEC,
        members: ['state.game'],
        help: "NorelecBot's game: the holdings the map reads",
      },
      messages: {
        type: 'events',
        namespace: NORELEC,
        help: "the bot messages: the map's trips",
      },
    },
    config: mapConfig,
    state: { migrations: [() => {}] },
    interface: {
      commands: MAP_COMMANDS,
      state: {
        map: {
          help: 'The map of the homes, live: the trips measured, and their times',
          output: z.custom<MapService>((v) => v instanceof MapService),
        },
      },
    },
  },
  create: (ctx) => {
    const config = ctx.config as MapConfig;
    const game = ctx.use<NorelecInterface>('game').state.game();
    const players = playersFrom(game.state);
    const map = new MapService({
      documents: ctx.store,
      players,
      draw: (pairs, overlay, previous) => drawMap(ctx.render, pairs, overlay, previous),
      log: (r) => ctx.log.info(`map ${r.event}: ${r.detail}`),
      now: () => ctx.clock.now(),
      settleMs: config.settleMs,
    });
    ctx.bus.subscribe(MESSAGE_EVENT, (event) => map.observe(botMessageOf(event), players));
    const commands: Record<keyof typeof MAP_COMMANDS, CommandHandler> = {
      map: { run: mapCommand({ map, warn: (line) => ctx.log.warn(line) }) },
    };
    return {
      commands,
      interface: { state: { map: () => map } },
      ready: () => {
        if (map.hasMeasurements) return;
        const all = messagesOf(ctx.events.read({ type: MESSAGE_EVENT }));
        const then = new GameState({ restS: config.restS });
        map.backfill(
          (function* () {
            for (const { time, text } of all) {
              const m = { time, text, events: parseMessage(text) };
              then.tick(time);
              then.apply(m);
              yield m;
            }
          })(),
          playersFrom(then)
        );
        ctx.log.info(`map: read the trips of ${all.length} logged bot messages`);
      },
      stop: () => map.stop(),
    };
  },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [norelecMapPlugin];
