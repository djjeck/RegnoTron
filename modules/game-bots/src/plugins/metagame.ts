/**
 * The metagame's ledger and `/loot` (MegaBotTron1999's docs/bot-os-api.md §5): the plugin
 * `metagame`, which keeps the ledger (modules/game-bots/src/ledger.ts) of what the owner's turns
 * bring, from the events of the @InventoryBot and @LoreGameBot parsers (`inventorybot.turn`,
 * `loregame.turn`; the first is InventoryBotTron's parser, heard through the graph alone); it answers `/loot`, the owner's. Another game's turns join through its action
 * `add`, which that game's parser calls through an interface input bound to it. It sends nothing,
 * so it has no chat and no mode. It plays nothing either: the turns are the owner's, by hand or by
 * an actor outside RegnoTron.
 *
 * It is built from its config alone (bot-os-api.md §7.2): whether it keeps the ledger, and the bots
 * `/loot` lists, in its order. Its store keeps the ledger (pages `ledger-…` and `cursor`), at
 * version 2: its two migrations, for a layout no store holds any more, are no-ops, kept because the
 * shell refuses a store at a version above its plugin's count of migrations.
 */
import { type BusEvent, definePlugin, type Plugin } from '@megabottron1999/core';
import { z } from 'zod';
import { Ledger, LOOT_BOTS } from '#src/ledger.ts';
import { INVENTORYBOT, LOREGAMEBOT, type Outcome } from '#src/replies.ts';
import { LOREGAME_PARSER } from './loregame.ts';

export const METAGAME = 'metagame';

/**
 * @InventoryBot's parser's id, the namespace of its `inventorybot.turn`: InventoryBotTron's module
 * `inventorybot` (https://github.com/djjeck/InventoryBotTron), whose outcomes have the shape of
 * `Outcome`. The ledger hears them through its events input, and imports nothing of it.
 */
export const INVENTORYBOT_PARSER = 'inventorybot';

/** A game whose turns the ledger keeps (P7): its namespace, the event type, the bot it names. */
export interface LedgerGame {
  namespace: string;
  type: string;
  bot: string;
}

/**
 * The games the ledger takes from the bus, each an events input of its manifest
 * (`<namespace>-events`). Not @EpicLorelecBot's (`epiclorelec.turn`): its count is a running total
 * the bot states itself, not an item (docs/game-bots.md §1). Another game's turns join through
 * the action `add`.
 */
export const LEDGER_GAMES: readonly LedgerGame[] = [
  { namespace: INVENTORYBOT_PARSER, type: `${INVENTORYBOT_PARSER}.turn`, bot: INVENTORYBOT },
  { namespace: LOREGAME_PARSER, type: `${LOREGAME_PARSER}.turn`, bot: LOREGAMEBOT },
];

/** `/loot` without the ledger. */
export const NO_LOOT = "No ledger: the metagame node's config has it off (ledger: false)";

/** Its configuration. */
export const metagameConfig = z.object({
  ledger: z
    .boolean()
    .default(true)
    .describe("Keep the ledger of what the owner's turns bring; /loot says there is none if off"),
  bots: z
    .array(z.string().regex(/^\w+$/u, 'expected a bot’s username, without @'))
    .default([...LOOT_BOTS])
    .describe('The bots whose gains /loot lists, in its order (another game’s too, if it adds)'),
});
export type MetagameConfig = z.output<typeof metagameConfig>;

const outcomeSchema = z.looseObject({ kind: z.string(), bot: z.string() });

/** What `add` takes: another game's outcomes, at the time its bot told them. */
export const addInput = z.object({ t: z.number(), outcomes: z.array(outcomeSchema) });

/** What it offers the parsers of other games (bot-os-api.md §2 `interface`). */
export interface MetagameInterface {
  actions: { add(input: z.infer<typeof addInput>): { added: number } };
}

export const metagamePlugin: Plugin = definePlugin({
  manifest: {
    id: METAGAME,
    version: '0.1.0',
    kinds: ['stats'],
    description: "The ledger of what the owner's turns bring, and /loot",
    config: metagameConfig,
    // The games it spans (P7), each optional: the parsers' events, from whichever instances run.
    inputs: Object.fromEntries(
      LEDGER_GAMES.map((g) => [
        `${g.namespace}-events`,
        {
          type: 'events' as const,
          namespace: g.namespace,
          optional: true,
          help: `@${g.bot}'s turns, for the ledger`,
        },
      ])
    ),
    interface: {
      // Its owner's controls: `/loot`, here only, never in the group.
      commands: {
        loot: { help: "What the owner's turns brought since the last /loot", owner: true },
      },
      actions: {
        add: {
          help: "Another game's outcomes, for the ledger: its parser's, through an edge",
          input: addInput,
          output: z.object({ added: z.number() }),
        },
      },
    },
    // No-ops, kept for the stores' version (above).
    state: { migrations: [() => {}, () => {}] },
  },
  create: (ctx) => {
    const config = ctx.config as MetagameConfig;
    const ledger = config.ledger ? new Ledger(ctx.store, config.bots) : undefined;
    const add = (t: number, outcome: Outcome): void => {
      ledger?.add({ t, outcome });
      if (outcome.kind === 'unknown')
        ctx.log.info(`not understood from ${outcome.bot}: ${outcome.text}`);
    };
    if (ledger !== undefined)
      for (const g of LEDGER_GAMES)
        // By namespace: a game whose parser does not run registers no type to name.
        ctx.bus.subscribe(g.namespace, (e: BusEvent) => {
          if (e.type === g.type) add(e.t, e['outcome'] as Outcome);
        });
    const iface: MetagameInterface = {
      actions: {
        add: ({ t, outcomes }) => {
          if (ledger === undefined) return { added: 0 };
          for (const outcome of outcomes) add(t, outcome as Outcome);
          return { added: outcomes.length };
        },
      },
    };
    return {
      // Allowed while the bot is off, as it was.
      commands: { loot: { run: (answer) => answer.text(ledger?.take() ?? NO_LOOT) } },
      interface: iface,
    };
  },
});

/** The module's plugin entry (MegaBotTron1999's docs/bot-os-api.md §7.2). */
export const plugins: Plugin[] = [metagamePlugin];
