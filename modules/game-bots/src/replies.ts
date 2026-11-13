/**
 * What the owner gets from a turn of the group's game bots, as their parser plugins publish it
 * (`Outcome`), with the grammars of two of them: @LoreGameBot and @EpicLorelecBot, in the private
 * chat with each or in the group. Pure: their parser plugins (@megabottron1999/turns/turn-parser.ts)
 * decide which messages answer the owner's turns. The rests between turns are here too, as the bots
 * state them or as measured (docs/game-bots.md §2). @InventoryBot's parser is InventoryBotTron's
 * (https://github.com/djjeck/InventoryBotTron), whose outcomes have this shape too.
 *
 * - @LoreGameBot replies to the command and names nobody; its last lines are the outcome: "Hai
 *   ottenuto <item> [M2]!" (the item's name may span lines), a fight lost ("Torni a casa dolorante
 *   e a mani vuote..."), the item lost in a fight ("L'oggetto si perde nello scontro..."), the
 *   cooldown ("Non è passato abbastanza tempo! Riprova fra …", sometimes followed by a quip), "Stai
 *   calmo maschio..." or "Non sei registrato!". Anything else is kept as not understood.
 *
 * - @EpicLorelecBot counts the player's "rotture": "Complimenti 78, <display name>, mi hai rotto il
 *   cazzo 53 volte!" (the count may be negative, and lines of the day's event may come first); it
 *   names the player by display name, so only its private chat tells it is the owner's. Its cooldown,
 *   "Non è passato abbastanza tempo dall'ultima rottura! Riprova fra …", may come after a
 *   parenthesis ("(🔟 piedento) "), and replies to the command.
 *
 * The bots write some accented letters decomposed ("e" and a combining grave for "è"), so the text
 * is read in its composed form (NFC), and the items are kept in it.
 */

export const INVENTORYBOT = 'InventoryBot';
export const LOREGAMEBOT = 'LoreGameBot';
export const EPICLORELECBOT = 'EpicLorelecBot';
export type GameBot = typeof INVENTORYBOT | typeof LOREGAMEBOT | typeof EPICLORELECBOT;

/**
 * The turn commands each of the three bots takes, in private and in the group: each parser's spec
 * names its bot's (`turnCommands`, a fact of the game, MegaBotTron1999's bot-os.md D70), and a
 * turn-actor of the shell, which defaults to a placeholder (`/play`), is configured with one of
 * them as its `command`.
 */
export const TURN_COMMANDS: Readonly<Record<GameBot, readonly string[]>> = {
  [INVENTORYBOT]: ['/avventura'],
  [LOREGAMEBOT]: ['/avventura'],
  [EPICLORELECBOT]: ['/avventura', '/rompimiilcazzo'],
};
/**
 * @pescaccia_bot, whose catches' materials the ledger keeps too: read by a parser outside RegnoTron, and never played
 * (docs/game-bots.md §4).
 */
export const PESCACCIABOT = 'pescaccia_bot';
/** A bot whose gains the ledger keeps. */
export type LedgerBot = GameBot | typeof PESCACCIABOT;

const MINUTE = 60_000;
/** Every bot's rest between turns: 15 minutes [M] (docs/game-bots.md §2). */
export const TURN_REST_MS = 15 * MINUTE;
/** @LoreGameBot's after a fight lost: 30 minutes [M] (docs/game-bots.md §2). */
export const LORE_DEFEAT_REST_MS = 30 * MINUTE;

export type Outcome =
  | {
      kind: 'gain';
      bot: LedgerBot;
      item: string;
      rarity: string;
      /** How many of it, when more than one (@pescaccia_bot's materials). */
      count?: number;
      /** The tags after the rarity, which start lower-case: `usabile`, `equipaggiabile 🗡`. */
      tags: string[];
      /** False when the item's name is a guess (@InventoryBot's, from an unknown sentence). */
      sure: boolean;
    }
  | {
      kind: 'nothing';
      bot: GameBot;
      reason: 'cooldown' | 'defeated' | 'lost' | 'calm' | 'unregistered';
      /** A cooldown's wait, as the bot states it, in ms. */
      retryMs?: number;
    }
  /** @EpicLorelecBot's count of the player's "rotture". */
  | { kind: 'count'; bot: GameBot; count: number }
  | { kind: 'unknown'; bot: GameBot; text: string };

const UNITS: Record<string, number> = {
  or: 3600_000,
  minut: MINUTE,
  second: 1000,
};

/**
 * A wait as the bots write it, in ms: "9 minuti e 29 secondi", "1 minuto", "10 secondi", "4 ore e
 * 58 minuti"; undefined for anything else.
 */
export function italianWait(text: string): number | undefined {
  const parts = text.trim().split(/\s+e\s+/u);
  let ms = 0;
  for (const part of parts) {
    const m = /^(\d+) (or|minut|second)[aeio]$/u.exec(part);
    if (m === null) return undefined;
    ms += Number(m[1]) * (UNITS[m[2] as string] as number);
  }
  return ms;
}

/** A rarity code (`C`, `R+`, `M2`, `L8`, `X`), and the tags after it, at the end of a gain. */
const RARITY_END = /^(.*?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*)!?$/su;

function tagsOf(s: string): string[] {
  return [...s.matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((m) => m[1] as string);
}

const LORE_NOTHING: [RegExp, Extract<Outcome, { kind: 'nothing' }>['reason']][] = [
  [/^Non è passato abbastanza tempo! Riprova fra /mu, 'cooldown'],
  [/Torni a casa dolorante e a mani vuote\.\.\.\s*$/u, 'defeated'],
  [/L'oggetto si perde nello scontro\.\.\.\s*$/u, 'lost'],
  [/^Stai calmo maschio\.\.\.\s*$/u, 'calm'],
  [/^Non sei registrato!/u, 'unregistered'],
];

/** An @LoreGameBot reply to the owner's `/avventura`. */
export function parseLoreGameBot(raw: string): Outcome {
  const text = raw.normalize('NFC');
  const at = text.lastIndexOf('Hai ottenuto ');
  if (at >= 0) {
    const end = RARITY_END.exec(text.slice(at + 'Hai ottenuto '.length).trim());
    if (end !== null)
      return {
        kind: 'gain',
        bot: LOREGAMEBOT,
        item: end[1] as string,
        rarity: end[2] as string,
        tags: tagsOf(end[3] as string),
        sure: true,
      };
  }
  for (const [re, reason] of LORE_NOTHING)
    if (re.test(text)) {
      const wait = reason === 'cooldown' ? retryOf(text) : undefined;
      return {
        kind: 'nothing',
        bot: LOREGAMEBOT,
        reason,
        ...(wait === undefined ? {} : { retryMs: wait }),
      };
    }
  return { kind: 'unknown', bot: LOREGAMEBOT, text: text.trim() };
}

/** The wait of a "Riprova fra …." line, if it states one. */
function retryOf(text: string): number | undefined {
  const m = /Riprova fra ([^.!\n]+)/u.exec(text);
  return m === null ? undefined : italianWait(m[1] as string);
}

const EPIC_COUNT = /mi hai rotto il cazzo (-?\d+) volt[ae]!/u;
const EPIC_COOLDOWN =
  /^(?:\([^)\n]*\) )?Non è passato abbastanza tempo dall'ultima rottura! Riprova fra /u;

/**
 * An @EpicLorelecBot message: the count of a turn, its cooldown with the wait, or undefined for
 * anything else (its fights, its other commands).
 */
export function parseEpicLorelecBot(raw: string): Outcome | undefined {
  const text = raw.normalize('NFC').trim();
  const count = EPIC_COUNT.exec(text);
  if (count !== null) return { kind: 'count', bot: EPICLORELECBOT, count: Number(count[1]) };
  if (EPIC_COOLDOWN.test(text)) {
    const wait = retryOf(text);
    return {
      kind: 'nothing',
      bot: EPICLORELECBOT,
      reason: 'cooldown',
      ...(wait === undefined ? {} : { retryMs: wait }),
    };
  }
  return undefined;
}
