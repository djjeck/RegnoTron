/**
 * @LoreGameBot's generators (docs/game-bots.md §5.13), as the `loregame` parser reads them: each
 * `/genera…` command a conversation of questions, then a confirmation of what is about to be made,
 * a button, and its outcome. Pure, but for what a plugin hands it.
 *
 * - **The confirmation** replies to the player's command (so it is theirs) and names what it makes:
 *   "Stai per generare l'oggetto <name>[ per la stagione …]. Sei sicuro?", "Stai per generare il
 *   guardiano <name>. …", "Stai per generare la stagione <name>. …", "Stai per generare una nuova
 *   storia che recita: …" (or "una storia [<code>] per <faction> …", "Stai per aggiungere una
 *   storia per la stagione …"), "Stai per rendere usabile l'oggetto <name>. …", "Stai per
 *   assemblare l'equipaggiamento <name>. L'assemblaggio consuma il generatore e <n>₭. …", "Stai per
 *   duplicare l'equipaggiamento <item> dal tuo inventario. …".
 * - **The outcome** is a message of its own, replying to nothing [M: 550 of 550], within seconds of
 *   the button: "La tua idea si materializza... hai generato <item> [<rarity>]!", "… il guardiano
 *   <name> [L<n>]!", "… la stagione <name> [<code>]!" (and "Tutti i generatori di stagione de
 *   <faction> sono stati rimossi!"), "… una nuova storia [<code>]!"; "Oggetto reso usabile con
 *   successo!" (or "Script installato con successo!"); "Il tuo equipaggiamento prende forma... hai
 *   assemblato e ottenuto 1x <item>!"; "Hai duplicato <item>!". It may end in a reward, "Hai
 *   ottenuto <n>₭!". `GenerationWatch` pairs it with the confirmation it answers: by the name it
 *   repeats, or, for a story or an item made usable, which name nothing, the oldest waiting in its
 *   chat.
 *
 * Each generator used is one of its kind consumed: "un generatore di oggetti" … (`GENERATORS`).
 */
import { type Listed } from '#src/inventory.ts';

/** What a generator makes. */
export type GeneratedKind =
  'item' | 'story' | 'guardian' | 'season' | 'utility' | 'equipment' | 'blueprint';

/** The generator each kind consumes, as an inventory names it. */
export const GENERATORS: Record<GeneratedKind, string> = {
  item: 'un generatore di oggetti',
  story: 'un generatore di storie',
  guardian: 'un generatore di guardiani',
  season: 'un generatore di stagioni',
  utility: 'un generatore di utilizzi',
  equipment: 'un generatore di equipaggiabili',
  blueprint: 'un generatore di blueprint',
};

/** A confirmation: what is about to be made, and what it costs beside its generator. */
export interface GenerationAsked {
  kind: GeneratedKind;
  /** What it names (an item, a guardian, a season); none for a story. */
  name: string | null;
  /** Coins it costs (equipment), 0 else. */
  cost: number;
}

/** An outcome: what was made. */
export interface Generated {
  kind: GeneratedKind;
  /** Its name (none for a story, or an item made usable). */
  name: string | null;
  /** Its code: an item's rarity, a guardian's level (`L3`), a season's or a story's place. */
  code: string | null;
  /** The item it gave its player (equipment assembled, a blueprint's copy). */
  gained: Omit<Listed, 'qty'> | null;
  /** Coins it gave ("Hai ottenuto <n>₭!"). */
  reward: number;
  /** A season made: the faction whose season generators were all removed. */
  removed: 'Bene' | 'Male' | 'Neutrale' | null;
}

const num = (s: string): number => Number(s.replaceAll('.', ''));
const tagsOf = (s: string): string[] =>
  [...s.matchAll(/\[([a-z][^\]\n]*)\]/gu)].map((t) => t[1] as string);
/** An item as the bot writes it: "<name>[ (<low> - <high>)] [<rarity>][ [<tag>]…]". */
const ITEM = String.raw`(.+?)(?: \((\d+)(?: - (\d+))?\))? \[([A-Z]+\d*\+?)\]((?: ?\[[a-z][^\]\n]*\])*)`;

function itemOf(m: RegExpExecArray, at: number): Omit<Listed, 'qty'> {
  return {
    item: m[at] as string,
    rarity: m[at + 3] as string,
    tags: tagsOf(m[at + 4] ?? ''),
    level:
      m[at + 1] === undefined
        ? null
        : { low: Number(m[at + 1]), high: Number(m[at + 2] ?? m[at + 1]) },
  };
}

/** The confirmation `raw` is, if one (its first line: a story's text follows). */
export function parseGenerationAsked(raw: string): GenerationAsked | undefined {
  const text = raw.normalize('NFC').trim();
  let m: RegExpExecArray | null;
  if (
    (m = /^Stai per generare l'oggetto (.+?)(?: per la stagione .+)?\. Sei sicuro\?$/su.exec(text))
  )
    return { kind: 'item', name: m[1] as string, cost: 0 };
  if ((m = /^Stai per generare il guardiano (.+)\. Sei sicuro\?$/su.exec(text)))
    return { kind: 'guardian', name: m[1] as string, cost: 0 };
  if ((m = /^Stai per generare la stagione (.+)\. Sei sicuro\?$/su.exec(text)))
    return { kind: 'season', name: m[1] as string, cost: 0 };
  if (/^Stai per (?:generare una (?:nuova )?storia|aggiungere una storia) /u.test(text))
    return { kind: 'story', name: null, cost: 0 };
  if ((m = /^Stai per rendere usabile l'oggetto (.+?)\. /su.exec(text)))
    return { kind: 'utility', name: m[1] as string, cost: 0 };
  if (
    (m =
      /^Stai per assemblare l'equipaggiamento (.+?)\. L'assemblaggio consuma il generatore e (\d[\d.]*) ?₭\./su.exec(
        text
      ))
  )
    return { kind: 'equipment', name: m[1] as string, cost: num(m[2] as string) };
  if (
    (m =
      /^Stai per duplicare (?:l'equipaggiamento (.+)|un equipaggiamento assemblato) dal tuo inventario\./su.exec(
        text
      ))
  )
    return { kind: 'blueprint', name: m[1] ?? null, cost: 0 };
  return undefined;
}

const MADE = 'La tua idea si materializza... hai generato ';
const FACTIONS: Record<string, 'Bene' | 'Male' | 'Neutrale'> = {
  'Il Bene': 'Bene',
  'Il Male': 'Male',
  'Il Neutrale': 'Neutrale',
};

/** The outcome `raw` is, if one: its first line, and the reward and removal after it. */
export function parseGenerated(raw: string): Generated | undefined {
  const text = raw.normalize('NFC').trim();
  const reward = /^Hai ottenuto (\d[\d.]*) ?₭!$/mu.exec(text);
  const gone =
    /^Tutti i generatori di stagione de (Il (?:Bene|Male|Neutrale)) .*sono stati rimossi!$/mu.exec(
      text
    );
  const base = {
    reward: reward === null ? 0 : num(reward[1] as string),
    removed: gone === null ? null : (FACTIONS[gone[1] as string] ?? null),
    gained: null,
  };
  // A name may run over lines (players write them): the outcome is its first paragraph.
  const first = text.split(/\n\s*\n/u)[0] ?? '';
  let m: RegExpExecArray | null;
  if (first.startsWith(MADE)) {
    const what = first.slice(MADE.length);
    if ((m = /^il guardiano (.+) \[(L\d+)\]!$/u.exec(what)))
      return { kind: 'guardian', name: m[1] as string, code: m[2] as string, ...base };
    if ((m = /^la stagione (.+) \[([A-Z]+\d+)\]!$/u.exec(what)))
      return { kind: 'season', name: m[1] as string, code: m[2] as string, ...base };
    if ((m = /^una nuova storia \[([^\]\n]+)\](?: per .+)?!$/u.exec(what)))
      return { kind: 'story', name: null, code: m[1] as string, ...base };
    if ((m = new RegExp(String.raw`^${ITEM}!$`, 'su').exec(what))) {
      const made = itemOf(m, 1);
      return { kind: 'item', name: made.item, code: made.rarity, ...base };
    }
    return undefined;
  }
  if (first === 'Oggetto reso usabile con successo!' || first === 'Script installato con successo!')
    return { kind: 'utility', name: null, code: null, ...base };
  if (
    (m = new RegExp(
      String.raw`^Il tuo equipaggiamento prende forma\.\.\. hai assemblato e ottenuto 1x ${ITEM}!$`,
      'su'
    ).exec(text))
  ) {
    const gained = itemOf(m, 1);
    return { kind: 'equipment', name: gained.item, code: gained.rarity, ...base, gained };
  }
  if ((m = new RegExp(String.raw`^Hai duplicato ${ITEM}!$`, 'su').exec(text))) {
    const gained = itemOf(m, 1);
    return { kind: 'blueprint', name: gained.item, code: gained.rarity, ...base, gained };
  }
  return undefined;
}

/** A confirmation waiting for its outcome: whose, where, when. */
interface Waiting extends GenerationAsked {
  chat: string;
  player: string;
  owner: boolean;
  t: number;
}

/** How long a confirmation waits for its button: the player may think it over. */
export const GENERATION_WAIT_MS = 15 * 60_000;

/** A generator's outcome, its player's. */
export interface PlayerGenerated extends Generated {
  player: string;
  owner: boolean;
  /** Coins it cost beside its generator, as its confirmation said. */
  cost: number;
}

/**
 * The generators' outcomes, each paired with the confirmation it answers (§5.13): one naming what
 * was made, by that name (a confirmation's item, its full text for a blueprint); a story, or an
 * item made usable, the oldest of its kind waiting in that chat. One no confirmation waits for is
 * no one's.
 */
export class GenerationWatch {
  private waiting: Waiting[] = [];

  /** A confirmation of `player`'s (the one whose command it replies to), at `t`. */
  asked(
    m: { chat: string; text: string },
    who: { player: string; owner: boolean },
    t: number
  ): boolean {
    const asked = parseGenerationAsked(m.text);
    if (asked === undefined) return false;
    this.waiting.push({ ...asked, chat: m.chat, ...who, t });
    return true;
  }

  /** A message of the bot's at `t`: the outcome it is, with its player, if one waits for it. */
  answer(m: { chat: string; text: string }, t: number): PlayerGenerated | undefined {
    this.waiting = this.waiting.filter((w) => t - w.t <= GENERATION_WAIT_MS);
    const made = parseGenerated(m.text);
    if (made === undefined) return undefined;
    const fits = (w: Waiting): boolean => {
      if (w.chat !== m.chat || w.kind !== made.kind) return false;
      if (made.kind === 'story' || made.kind === 'utility') return true;
      if (made.kind === 'blueprint' || made.kind === 'equipment')
        return w.name === null || (made.name !== null && w.name.startsWith(made.name));
      return w.name === made.name;
    };
    const i = this.waiting.findIndex(fits);
    if (i < 0) return undefined;
    const [w] = this.waiting.splice(i, 1) as [Waiting];
    return { ...made, player: w.player, owner: w.owner, cost: w.cost };
  }
}

/** The moving box (`/usa`), as an inventory names it: consumed, its contents gained [M]. */
export const BOX = 'uno scatolone da trasloco 📦';

/** The box opened, if `raw` is its answer: whose, and what it held. */
export function parseBox(
  raw: string
): { player: string; found: Omit<Listed, 'qty'>[] } | undefined {
  const lines = raw.normalize('NFC').trim().split('\n');
  const head = /^(\w+), apri lo scatolone 📦 e trovi:$/u.exec(lines[0] ?? '');
  if (head === null) return undefined;
  const found: Omit<Listed, 'qty'>[] = [];
  const pattern = new RegExp(String.raw`^${ITEM}$`, 'su');
  // An item from its "> " to the line that ends in its rarity and tags: a name may run over lines.
  let name: string[] | undefined;
  for (const l of lines.slice(1)) {
    if (name === undefined) {
      if (!l.startsWith('> ')) return undefined;
      name = [l.slice(2)];
    } else name.push(l);
    const m = pattern.exec(name.join('\n').trim());
    if (m === null) continue;
    found.push(itemOf(m, 1));
    name = undefined;
  }
  if (name !== undefined) return undefined;
  return found.length === 0 ? undefined : { player: head[1] as string, found };
}
