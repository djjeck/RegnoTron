/**
 * The `loregame-state` plugin: the owner's state at @LoreGameBot, kept by MegaBotTron1999's
 * `statePlugin` (its docs/bot-os-api.md §5, bot-os.md D72) from the `loregame` parser's turns, with
 * the reducer of `src/loregame-state.ts`, which says what it keeps and how.
 *
 * - **Its input:** `events`, required, bound to the `loregame` parser's events output (the
 *   namespace `loregame`): `loregame.turn`. It resumes from its cursor in the event log, so nothing
 *   is applied twice, and the turns the parser published while it was down are applied at its next
 *   start.
 * - **Its sections:** `owner` (when its state last changed) and `inventory` (an estimate: the
 *   items the turns gained, `exact` once a listing says so).
 * - **Freshness:** a turn that gains is a `delta` of the inventory; one cut off at Telegram's limit
 *   is an `uncertain` one.
 * - **Its interface:** `state.get`, `state.freshness`, and `state.count({ name })` (how many of an
 *   item the owner holds) and `state.held()` (every item held, with its count).
 * - **Its config:** `pin`, by default `inventory.held` (how many items the owner holds) and
 *   `owner.as_of` (when it last changed), the line of its card.
 *
 * It never sends, and announces each change as `loregame-state.changed`, the sections changed; an
 * event its reducer refuses is recorded as `loregame-state.refused`.
 */
import { type Plugin } from '@megabottron1999/core';
import { statePlugin } from '@megabottron1999/turns/state-plugin.ts';
import { z } from 'zod';
import {
  CONSUMES,
  freshness,
  held,
  initialState,
  LOREGAME_STATE,
  type LoreState,
  PINS,
  reduce,
  stateSchema,
} from '#src/loregame-state.ts';

/** The state, as `statePlugin` keeps it: an object of sections. */
type Kept = LoreState & Record<string, unknown>;

const base = statePlugin<Kept>({
  id: LOREGAME_STATE,
  description: "The owner's state at @LoreGameBot: the inventory the turns gained",
  schema: stateSchema,
  initial: initialState() as Kept,
  consumes: CONSUMES,
  reduce: (state, event) => reduce(state, event) as Kept,
  freshness,
  queries: {
    count: {
      help: 'How many of an item the owner holds, as the state estimates it',
      input: z.object({ name: z.string() }),
      output: z.number(),
      run: (s, input: { name: string }) => {
        const all = held(s);
        return Object.hasOwn(all, input.name) ? (all[input.name] as number) : 0;
      },
    },
    held: {
      help: 'Every item the owner holds, with its count',
      output: z.record(z.string(), z.number()),
      run: (s) => held(s),
    },
  },
});

/** Its node's config: the state plugin's, with the pins the owner wants first by default. */
type Config = z.ZodObject<{ pin: z.ZodDefault<z.ZodArray> }>;
const config = (base.manifest.config as Config).extend({
  pin: (base.manifest.config as Config).shape.pin
    .unwrap()
    .default(PINS)
    .describe(
      'Paths of the state (dotted: inventory.held) drawn first in its panel; the first two make the line on its card'
    ),
});

export const loregameStatePlugin: Plugin = {
  ...base,
  manifest: { ...base.manifest, config },
};

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [loregameStatePlugin];
