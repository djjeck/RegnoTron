/**
 * @LoreGameBot's places ("stagioni") and the moves between them, the answers to `/vai` and `/v`
 * (docs/game-bots.md §5.9), as the `loregame` parser reads them. Pure.
 *
 * - **An arrival:** "WOOSH! Sei arrivato alla Stagione <place> [<code>]!", then, if entering took
 *   them, "Per entrare, hai consumato i seguenti oggetti" and the items, one each.
 * - **Where one is** (`/v` alone): "Ti trovi nella stagione <place> [<code>]", its requirements, if
 *   it has any ("Requisiti d'accesso (oggetti consumati all'arrivo)", then "> Livello <n>" and its
 *   items), then where one can go ("Puoi andare in:", each place, 🔒 if locked to them), or "Nessuna
 *   stagione disponibile!".
 * - **A refusal:** "Non hai accesso a <place> [<code>]!", then its requirements ("Requisiti
 *   d'accesso per <place> [<code>] (oggetti consumati all'arrivo)", the level, then the items, under
 *   "Ti serve:" and "Hai già:"). The same block tells a place's requirements anywhere the bot
 *   writes it: an answer that changed them ("La modalità d'accesso alla stagione [<code>] è
 *   cambiata!").
 * - **A name not among the exits** (`/vai <name>` matches only those, by any part of the name or
 *   code; the place one is at is none): "Stagione non trovata!". It changes nothing, and is not read.
 *
 * An item's name may run over several lines (players write them): it ends at the line that ends in
 * its rarity and tags. A requirement may be no item but a condition: "Almeno un guardiano [generato
 * da] [<code>]", a guardian made at that place by anyone (`/generaguardiano`, with a "generatore di
 * guardiani", standing there; a faction's places only) [M]; listed under "Hai già:" once one is, for
 * every player, and entering does not consume it. A neutral place does not ask it of a faction's
 * player [M]. The making itself is confirmed by a button, and is not read.
 *
 * **Neutrality** (the ticket, "un biglietto neutralizzante 🎫", `/usa`): "<username>, prendi il
 * biglietto ma ti sbriciola in mano! … perché hai perso colore?", a message of its own, naming its
 * player; the effect "Neutralizzato" for 10 hours, each ticket more adding 10 [M]. While it lasts,
 * the neutral ladder (`N1`, …) is open to them; at its end the bot tells them alone, in private, "[N]
 * Hai ripreso colore e sei stato buttato fuori dalla neutralità!", and a player in a neutral place
 * is back in their faction's ladder [M].
 */
import { type Listed } from '#src/inventory.ts';

/** A place: its name, and its code (the rarities' notation: `B1`, `M7`, `N1`). */
export interface Place {
  name: string;
  code: string;
}

/**
 * What entering a place takes: a level, and items, one each, consumed at the arrival; and the
 * places a guardian must have been made at (`guardians`, by anyone), which nothing consumes. A
 * refusal splits them, for its player, into what they lack ("Ti serve:") and what they hold ("Hai
 * già:"): `met` is the guardians already made, none where the block is not split.
 */
export interface Requirements {
  level: number | null;
  items: Omit<Listed, 'qty'>[];
  guardians: string[];
  met: string[] | null;
}

/** What an answer to `/vai` or `/v` says. */
export type Travel =
  | { kind: 'arrived'; place: Place; consumed: Omit<Listed, 'qty'>[] }
  | {
      kind: 'here';
      place: Place;
      requirements: Requirements | null;
      exits: (Place & { locked: boolean })[];
    }
  | { kind: 'refused'; place: Place; requirements: Requirements | null };

const CODE = String.raw`\[([A-Z]+\d*\+?)\]`;
const ARRIVED = new RegExp(String.raw`^WOOSH! Sei arrivato alla Stagione (.+) ${CODE}!$`, 'u');
const HERE = new RegExp(String.raw`^Ti trovi nella stagione (.+) ${CODE}$`, 'u');
const REFUSED = new RegExp(String.raw`^Non hai accesso a (.+) ${CODE}!$`, 'u');
const BLOCK_FOR = new RegExp(
  String.raw`^Requisiti d'accesso per (.+) ${CODE} \(oggetti consumati all'arrivo\)$`,
  'u'
);
const BLOCK = "Requisiti d'accesso (oggetti consumati all'arrivo)";
const CONSUMED = 'Per entrare, hai consumato i seguenti oggetti';
const EXIT = new RegExp(String.raw`^> (🔒 )?(.+) ${CODE}$`, 'u');
const ITEM = /^(.*?) \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*)$/su;
const RANGE = /^(.+) \((\d+)(?: - (\d+))?\)$/su;
const LEVEL = /^> Livello (\d+)$/u;
const GUARDIAN = new RegExp(String.raw`^> Almeno un guardiano (?:generato da )?${CODE}$`, 'u');

/** How long a neutralizing ticket lasts, each one used adding as much [M]. */
export const NEUTRAL_MS = 10 * 3_600_000;
/** The effect a ticket gives, as the profile lists it. */
export const NEUTRAL_EFFECT = 'Neutralizzato';
/** The ticket, as the inventory lists it. */
export const NEUTRAL_TICKET = 'un biglietto neutralizzante 🎫';

/** A player neutralized by a ticket (naming them), or the owner's neutrality ended. */
export type Neutrality = { kind: 'neutralized'; player: string } | { kind: 'restored' };

const NEUTRALIZED =
  /^(\w+), prendi il biglietto ma ti sbriciola in mano! Aspetta, ti sta succedendo qualcosa di strano\.\.\. perché hai perso colore\?$/u;
const RESTORED = /^(?:\[N\] )?Hai ripreso colore e sei stato buttato fuori dalla neutralità!$/u;

/** The ticket's answer, or the end of the neutrality, that `raw` is, if one: the whole message. */
export function parseNeutrality(raw: string): Neutrality | undefined {
  const text = raw.normalize('NFC').trim();
  const m = NEUTRALIZED.exec(text);
  if (m !== null) return { kind: 'neutralized', player: m[1] as string };
  return RESTORED.test(text) ? { kind: 'restored' } : undefined;
}

/** A place's ladder and step (`M3`: `M`, 3); none for a code of no number. */
export function ladderOf(code: string): { ladder: string; step: number } | undefined {
  const m = /^([A-Z]+)(\d+)$/u.exec(code);
  return m === null ? undefined : { ladder: m[1] as string, step: Number(m[2]) };
}

/**
 * The items of a list ("> <item> [<rarity>] [<tag>]…", a name perhaps over several lines), from
 * `lines`, up to the first line that is none of them; and how many lines they took.
 */
function itemsOf(lines: readonly string[]): { items: Omit<Listed, 'qty'>[]; read: number } {
  const items: Omit<Listed, 'qty'>[] = [];
  let name: string[] | undefined;
  let read = 0;
  for (const line of lines) {
    if (name === undefined) {
      if (!line.startsWith('> ') || LEVEL.test(line) || GUARDIAN.test(line)) break;
      name = [line.slice(2)];
    } else name.push(line);
    read++;
    const m = ITEM.exec(name.join('\n'));
    if (m === null) continue;
    const range = RANGE.exec(m[1] as string);
    items.push({
      item: range === null ? (m[1] as string) : (range[1] as string),
      rarity: m[2] as string,
      tags: [...(m[3] as string).matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((t) => t[1] as string),
      level: range === null ? null : { low: Number(range[2]), high: Number(range[3] ?? range[2]) },
    });
    name = undefined;
  }
  return { items, read: name === undefined ? read : read - name.length };
}

/** A requirements block's level and items, from the line after its heading. */
function requirementsOf(lines: readonly string[]): Requirements {
  let level: number | null = null;
  const items: Omit<Listed, 'qty'>[] = [];
  const guardians: string[] = [];
  let met: string[] | null = null;
  let held = false;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as string;
    const lv = LEVEL.exec(l);
    const g = GUARDIAN.exec(l);
    if (lv !== null) {
      level = Number(lv[1]);
      i++;
    } else if (g !== null) {
      guardians.push(g[1] as string);
      if (held) met?.push(g[1] as string);
      i++;
    } else if (l === 'Ti serve:' || l === 'Hai già:') {
      held = l === 'Hai già:';
      met ??= [];
      i++;
    } else if (l.startsWith('> ')) {
      const { items: more, read } = itemsOf(lines.slice(i));
      if (read === 0) break;
      items.push(...more);
      i += read;
    } else break;
  }
  return { level, items, guardians, met };
}

/** The answer to `/vai` or `/v` that `raw` is, if one: its every line read. */
export function parseTravel(raw: string): Travel | undefined {
  const lines = raw.normalize('NFC').trim().split('\n');
  const first = (lines[0] ?? '').trim();
  const arrived = ARRIVED.exec(first);
  if (arrived !== null) {
    const at = lines.findIndex((l) => l.trim() === CONSUMED);
    return {
      kind: 'arrived',
      place: { name: arrived[1] as string, code: arrived[2] as string },
      consumed: at < 0 ? [] : itemsOf(lines.slice(at + 1)).items,
    };
  }
  const here = HERE.exec(first);
  if (here !== null) {
    const at = lines.findIndex((l) => l.trim() === BLOCK);
    const go = lines.findIndex((l) => l.trim() === 'Puoi andare in:');
    const exits: (Place & { locked: boolean })[] = [];
    for (const l of go < 0 ? [] : lines.slice(go + 1)) {
      const m = EXIT.exec(l.trim());
      if (m === null) break;
      exits.push({ name: m[2] as string, code: m[3] as string, locked: m[1] !== undefined });
    }
    return {
      kind: 'here',
      place: { name: here[1] as string, code: here[2] as string },
      requirements: at < 0 ? null : requirementsOf(lines.slice(at + 1)),
      exits,
    };
  }
  const refused = REFUSED.exec(first);
  if (refused !== null)
    return {
      kind: 'refused',
      place: { name: refused[1] as string, code: refused[2] as string },
      requirements: placeRequirements(raw)[0]?.requirements ?? null,
    };
  return undefined;
}

/** Every place's requirements a message of the bot's states ("Requisiti d'accesso per …"). */
export function placeRequirements(raw: string): { place: Place; requirements: Requirements }[] {
  const lines = raw.normalize('NFC').split('\n');
  const found: { place: Place; requirements: Requirements }[] = [];
  for (const [i, l] of lines.entries()) {
    const m = BLOCK_FOR.exec(l.trim());
    if (m !== null)
      found.push({
        place: { name: m[1] as string, code: m[2] as string },
        requirements: requirementsOf(lines.slice(i + 1)),
      });
  }
  return found;
}
