/**
 * The metagame's ledger and `/loot` (MegaBotTron1999's docs/bot-os-api.md §5): the plugin
 * `metagame`, which keeps the ledger (modules/game-bots/src/ledger.ts) of what the owner's turns
 * bring, from the events of the @InventoryBot and @LoreGameBot parsers (`inventorybot.turn`,
 * `loregame.turn`), and of any other game given in `games`; it answers `/loot`, the owner's. It
 * sends nothing, so it has no chat and no mode. It plays nothing either: the turns are the owner's,
 * by hand or by an actor outside RegnoTron.
 *
 * Its store keeps the ledger (pages `ledger-…` and `cursor`). Its migrations adopt the files an
 * older, single-file version of it kept in the data volume's root (`metagame.json`, the ledger's
 * `.jsonl` and its cursor), leaving them `.migrated`; and a timer `adventure` left by that version,
 * which played a turn itself, is dropped at the first start.
 */
import {
  type BusEvent,
  definePlugin,
  type MigrationStore,
  type Plugin,
} from '@megabottron1999/core';
import { CURSOR, cursorOf, Ledger, type LedgerEntry, ledgerLines, pagesOf } from '#src/ledger.ts';
import { INVENTORYBOT, LOREGAMEBOT, type Outcome } from '#src/replies.ts';
import { INVENTORYBOT_PARSER } from './inventorybot.ts';
import { LOREGAME_PARSER } from './loregame.ts';

export const METAGAME = 'metagame';

/** Where the older version kept its state, in the data volume's root. */
export const LEGACY_STATE_FILE = 'metagame.json';

/** The ledger's files of the older version, in the data volume's root, adopted into the store. */
export const LEGACY_LEDGER_FILE = 'metagame-ledger.jsonl';
export const LEGACY_CURSOR_FILE = 'metagame-cursor.json';
/** Where the old ledger stands while its migration pages it. */
const ADOPTED = 'ledger-adopted';

/** A game whose turns the ledger keeps (P7): its namespace, the event type, the bot it names. */
export interface LedgerGame {
  namespace: string;
  type: string;
  bot: string;
  /** What an event of its type brings to the ledger: by default the turn's `outcome`. */
  outcomes?: (e: BusEvent) => Outcome[];
}

/**
 * The games the ledger takes, in the order `/loot` lists their gains, each an events input of its
 * manifest (`<namespace>-events`). Not @EpicLorelecBot's (`epiclorelec.turn`): its count is a
 * running total the bot states itself, not an item (docs/game-bots.md §1). Another game's turns
 * join through `games`, with a parser of their own outside RegnoTron.
 */
export const LEDGER_GAMES: readonly LedgerGame[] = [
  { namespace: INVENTORYBOT_PARSER, type: `${INVENTORYBOT_PARSER}.turn`, bot: INVENTORYBOT },
  { namespace: LOREGAME_PARSER, type: `${LOREGAME_PARSER}.turn`, bot: LOREGAMEBOT },
];

/** The timer of the older version's own turn, which it no longer plays. */
export const RETIRED_TIMER = 'adventure';

/** `/loot` without the owner's account. */
export const NO_LOOT = "No ledger: the owner's Telegram account (telegram-user) is not set up";

/**
 * The `metagame` plugin; with `ledger`, when the owner's account runs the parsers it hears, it keeps
 * the ledger and lists it, and without, `/loot` says there is none, as before.
 */
export function metagamePlugin(
  o: { ledger?: boolean; games?: readonly LedgerGame[] } = {}
): Plugin {
  const games = o.games ?? LEDGER_GAMES;
  return definePlugin({
    manifest: {
      id: METAGAME,
      version: '0.1.0',
      kinds: ['stats'],
      description: "The ledger of what the owner's turns bring, and /loot",
      // The games it spans (P7), each optional: the parsers' events, from whichever instances run.
      inputs: Object.fromEntries(
        games.map((g) => [
          `${g.namespace}-events`,
          {
            type: 'events' as const,
            namespace: g.namespace,
            optional: true,
            help: `@${g.bot}'s turns, for the ledger`,
          },
        ])
      ),
      // Its owner's controls: `/loot`, here only, never in the group.
      interface: {
        commands: {
          loot: { help: "What the owner's turns brought since the last /loot", owner: true },
        },
      },
      state: {
        migrations: [
          (store: MigrationStore) => {
            store.adopt(LEGACY_STATE_FILE, 'state');
          },
          // The ledger's files, every entry its reader read, in their order.
          (store: MigrationStore) => {
            if (store.adopt(LEGACY_LEDGER_FILE, ADOPTED, (b) => ledgerLines(b.toString('utf8')))) {
              const entries = store.read<LedgerEntry[]>(ADOPTED) ?? [];
              store.remove(ADOPTED);
              for (const [name, page] of pagesOf(entries)) store.write(name, page);
            }
            store.adopt(LEGACY_CURSOR_FILE, CURSOR, (b) => {
              try {
                return { t: cursorOf(JSON.parse(b.toString('utf8'))) };
              } catch {
                return { t: 0 };
              }
            });
          },
        ],
      },
    },
    create: (ctx) => {
      if (ctx.scheduler.get(RETIRED_TIMER) !== undefined) {
        ctx.scheduler.cancel(RETIRED_TIMER);
        ctx.log.info('the older version’s own turn is retired: its plan dropped');
      }
      const ledger =
        o.ledger === true
          ? new Ledger(
              ctx.store,
              games.map((g) => g.bot)
            )
          : undefined;
      if (ledger !== undefined)
        for (const g of games)
          // By namespace: a game whose parser does not run registers no type to name.
          ctx.bus.subscribe(g.namespace, (e: BusEvent) => {
            if (e.type !== g.type) return;
            for (const outcome of g.outcomes?.(e) ?? [e['outcome'] as Outcome]) {
              ledger.add({ t: e.t, outcome });
              if (outcome.kind === 'unknown')
                ctx.log.info(`not understood from ${outcome.bot}: ${outcome.text}`);
            }
          });
      return {
        // Allowed while the bot is off, as it was.
        commands: { loot: { run: (answer) => answer.text(ledger?.take() ?? NO_LOOT) } },
      };
    },
  });
}
