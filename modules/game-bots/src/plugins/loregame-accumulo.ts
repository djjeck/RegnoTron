/**
 * The `loregame-accumulo` plugin: when @LoreGameBot's `/accumulo` may go, in the terms a shell
 * turn-actor reads of its parser, so that an actor with `command: "/accumulo"` plays it as soon as
 * it is available, as another plays `/lore` (docs/game-bots.md §5.2, the README's "Auto-playing the
 * accumulo").
 *
 * It sends nothing and plays nothing: it answers the actor's one question, "does the bot rest?"
 * (`state.rest`, the shell's TurnParserInterface), from what `loregame-state` and the `loregame`
 * parser know. The actor is the shell's, wired in the owner's graph beside it:
 *
 * - **Its inputs:** `state`, bound to the `loregame-state` node (the accumulo and the owner's ban),
 *   and `parser`, to the `loregame` node (whether the bot rests, which the accumulo zeroes).
 * - **Its interface** is the turn parser's contract, which the actor's `parser` input takes:
 *   `state.rest` (`accumuloRest`: waits while the owner is banned, under the level, or the bot has
 *   not said the accumulo is full, and while there is no rest to zero), `state.lastTurn` (none:
 *   the actor counts from its own sends, and what the bot says decides, so a use by hand or from
 *   another device needs no mention) and `actions.sent` (nothing to keep).
 *
 * The permission is the bot's word, never a count of our own (`accumuloReady`).
 */
import { definePlugin, type Plugin } from '@megabottron1999/core';
import { type TurnParserInterface } from '@megabottron1999/turns/turn-parser.ts';
import { z } from 'zod';
import { ACCUMULO_MEMBERS, type AccumuloInterface, accumuloRest } from '#src/accumulo.ts';
import { bannedUntil, BANS_MEMBERS, type BansInterface } from '#src/bans.ts';
import { LOREGAME_STATE } from '#src/loregame-state.ts';
import { LOREGAME_PARSER } from '#src/plugins/loregame.ts';

export const LOREGAME_ACCUMULO = 'loregame-accumulo';

export const loregameAccumuloPlugin: Plugin = definePlugin({
  manifest: {
    id: LOREGAME_ACCUMULO,
    version: '0.1.0',
    kinds: ['stats'],
    description:
      "When @LoreGameBot's /accumulo may go, for a turn-actor of the shell to play it as soon as it is available",
    inputs: {
      state: {
        type: 'interface',
        plugin: LOREGAME_STATE,
        members: [...ACCUMULO_MEMBERS, ...BANS_MEMBERS],
        help: "The owner's state at @LoreGameBot: whether the bot said the accumulo is full, and the owner's ban",
      },
      parser: {
        type: 'interface',
        plugin: LOREGAME_PARSER,
        members: ['state.rest'],
        help: 'The @LoreGameBot parser: whether the bot rests, which /accumulo zeroes',
      },
    },
    interface: {
      state: {
        rest: {
          help: '/accumulo may go when this is none; else, until when to wait, and why',
          output: z.object({ until: z.number(), why: z.string() }).optional(),
        },
        lastTurn: {
          help: 'None: the actor counts from its own sends, and the bot decides when /accumulo goes',
          output: z.object({ t: z.number(), id: z.string().optional() }).optional(),
        },
      },
      actions: {
        sent: {
          help: 'A /accumulo sent by the actor: nothing to keep, the bot answers it',
          input: z.object({ chat: z.string(), id: z.string().optional(), t: z.number() }),
        },
      },
    },
  },
  create: (ctx) => {
    const state = ctx.use<AccumuloInterface & BansInterface>('state');
    const parser = ctx.use<TurnParserInterface>('parser');
    return {
      interface: {
        state: {
          rest: () => {
            const now = ctx.clock.now();
            return accumuloRest(state.state.accumulo(), {
              now,
              banUntil: bannedUntil(state, now),
              loreRests: parser.state.rest() !== undefined,
            });
          },
          lastTurn: () => undefined,
        },
        actions: { sent: () => undefined },
      },
    };
  },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregameAccumuloPlugin];
