/**
 * The market's companies as entities (docs/game-bots.md §5.11): each one an id of its own, under
 * which its values, its page and the investments in it are kept, whatever it is called. Pure.
 *
 * - **Its name** is the latest the market wrote, its emoji included ("F.R.O.D.E. Capital Partners
 *   ⚖️"); its names before are kept, each with when it took it.
 * - **A rename** [M]: its leader changes its name at times (one company took four in ten days in
 *   September 2026, then kept one for months: a person's, not the bot's). A name the market writes
 *   that no company has now is the company's whose letters it has, emoji and symbols aside (its
 *   `core`), or, failing that, in a whole listing, the one whose value it carries on (its value
 *   less its change, the one before), each only when one company alone fits.
 * - **Gone**: a whole listing (an update, or the market listed) quotes every company there is, so
 *   one it does not quote is gone (deleted, or closed), with its history; a company that takes its
 *   name later is another, under an id of its own.
 * - **Its id**: its first name's letters, in lower case, joined by `-` ("frode-capital-partners"),
 *   with a number after when another, here or gone, had it (`-2`).
 *
 * A company's page names it without its emoji, and an investment as the market does: each is the
 * company's whose name, or letters, it has.
 */
import { type Point, type Via, withPoint } from '#src/market.ts';

/** A company's latest quote. */
export interface CompanyQuote {
  value: number;
  change: number;
  pct: number;
  direction: 'up' | 'down' | 'flat';
  via: Via;
  as_of: string;
}

/** A company's page, as last shown. */
export interface CompanyPage {
  size: number;
  max: number;
  leader: string;
  power: number;
  members: { player: string; faction: string; level: number; power: number }[];
  value: number;
  profile: string | null;
  as_of: string;
}

/** A company. */
export interface Company {
  /** Its latest name, as the market writes it. */
  name: string;
  /** Every name it had, each since when, oldest first. */
  names: { name: string; since: string }[];
  quote: CompanyQuote | null;
  page: CompanyPage | null;
  as_of: string;
}

/** The companies: those there are, those gone (each since when), and each one's values. */
export interface Companies {
  companies: Record<string, Company>;
  gone: Record<string, Company & { gone: string }>;
  series: Record<string, Point[]>;
}

/** A quote, as the market writes it. */
export interface Quoted {
  company: string;
  value: number;
  change: number;
  pct: number;
  direction: 'up' | 'down' | 'flat';
}

/** A name's letters, emoji and symbols aside, in lower case: "f.r.o.d.e. capital partners". */
export function coreOf(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}.,&'’\- ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

const own = <V>(r: Record<string, V>, k: string): V | undefined =>
  Object.hasOwn(r, k) ? r[k] : undefined;

/** `r` with `k` set to `v`, as an own property whatever the key. */
function put<V>(r: Record<string, V>, k: string, v: V): Record<string, V> {
  const next = { ...r };
  Object.defineProperty(next, k, {
    value: v,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return next;
}

const without = <V>(r: Record<string, V>, k: string): Record<string, V> =>
  Object.fromEntries(Object.entries(r).filter(([x]) => x !== k));

/** A new company's id, from `name`: free among those there are and those gone. */
export function idFor(c: Companies, name: string): string {
  const base =
    coreOf(name)
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'company';
  const taken = (id: string) => Object.hasOwn(c.companies, id) || Object.hasOwn(c.gone, id);
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * The id of the company there is now whose name `name` is (its latest, or one it had), or whose
 * letters it has, when one alone does; none if none.
 */
export function companyOf(c: Companies, name: string): string | undefined {
  const ids = Object.keys(c.companies);
  const now = ids.find((id) => c.companies[id]?.name === name);
  if (now !== undefined) return now;
  const had = ids.filter((id) => c.companies[id]?.names.some((n) => n.name === name));
  if (had.length === 1) return had[0];
  const core = coreOf(name);
  const like = ids.filter((id) => coreOf(c.companies[id]?.name ?? '') === core);
  return like.length === 1 ? like[0] : undefined;
}

/** A company new at `at`, named `name`: its id, and the companies with it. */
export function added(
  c: Companies,
  name: string,
  at: string
): { id: string; companies: Companies } {
  const id = idFor(c, name);
  const company: Company = {
    name,
    names: [{ name, since: at }],
    quote: null,
    page: null,
    as_of: at,
  };
  return { id, companies: { ...c, companies: put(c.companies, id, company) } };
}

/** `id` renamed `name` at `at`, if it was not called so. */
function renamed(c: Companies, id: string, name: string, at: string): Companies {
  const was = own(c.companies, id);
  if (was === undefined || was.name === name) return c;
  return {
    ...c,
    companies: put(c.companies, id, {
      ...was,
      name,
      names: [...was.names, { name, since: at }],
      as_of: at,
    }),
  };
}

/**
 * The companies after a listing of quotes at `at` (ISO), told `via`: each quote its company's (by
 * name, or a rename, `companyOf` and the value carried on; a new company else), its value now if
 * no later one was told, and a point of its series; and, when `whole` (every company quoted, the
 * market's own word), those not quoted gone. A listing older than the latest told (history told
 * late) renames and removes nothing. Pure.
 */
export function quoted(
  c: Companies,
  quotes: readonly Quoted[],
  at: string,
  via: Via,
  whole: boolean,
  latest: string | null
): Companies {
  const late = latest !== null && Date.parse(at) < Date.parse(latest);
  let next = c;
  const ids: (string | undefined)[] = quotes.map((q) =>
    Object.keys(next.companies).find((id) => next.companies[id]?.name === q.company)
  );
  const taken = () => new Set(ids.filter((id) => id !== undefined));
  // A name none has now: by its names before, or its letters; then, in a whole listing, by the
  // value it carries on; each when one company alone fits, not taken by another quote.
  for (const pass of ['name', 'value'] as const) {
    if (pass === 'value' && !whole) break;
    for (const [i, q] of quotes.entries()) {
      if (ids[i] !== undefined) continue;
      const used = taken();
      const fits = Object.keys(next.companies).filter((id) => {
        if (used.has(id) || quotes.some((x) => x.company === next.companies[id]?.name))
          return false;
        const co = next.companies[id] as Company;
        return pass === 'name'
          ? co.names.some((n) => n.name === q.company) || coreOf(co.name) === coreOf(q.company)
          : co.quote !== null && co.quote.value === q.value - q.change;
      });
      if (fits.length === 1) ids[i] = fits[0];
    }
  }
  for (const [i, q] of quotes.entries()) {
    let id = ids[i];
    if (id === undefined) {
      const made = added(next, q.company, at);
      id = made.id;
      next = made.companies;
      ids[i] = id;
    } else if (!late) next = renamed(next, id, q.company, at);
    const co = own(next.companies, id) as Company;
    const quote: CompanyQuote = {
      value: q.value,
      change: q.change,
      pct: q.pct,
      direction: q.direction,
      via,
      as_of: at,
    };
    const fresher = co.quote === null || Date.parse(co.quote.as_of) <= Date.parse(at);
    next = {
      ...next,
      companies: fresher ? put(next.companies, id, { ...co, quote, as_of: at }) : next.companies,
      series: put(
        next.series,
        id,
        withPoint(own(next.series, id) ?? [], {
          t: at,
          value: q.value,
          change: q.change,
          pct: q.pct,
          via,
        })
      ),
    };
  }
  if (!whole || late) return next;
  const listed = taken();
  for (const id of Object.keys(next.companies)) {
    if (listed.has(id)) continue;
    const co = own(next.companies, id) as Company;
    next = {
      ...next,
      companies: without(next.companies, id),
      gone: put(next.gone, id, { ...co, gone: at }),
    };
  }
  return next;
}

/** The companies after a company's page at `at`: its company's (a new one if none fits). Pure. */
export function paged(
  c: Companies,
  name: string,
  page: Omit<CompanyPage, 'as_of'>,
  at: string
): Companies {
  let next = c;
  let id = companyOf(next, name);
  if (id === undefined) {
    const made = added(next, name, at);
    id = made.id;
    next = made.companies;
  }
  const co = own(next.companies, id) as Company;
  if (co.page !== null && Date.parse(co.page.as_of) > Date.parse(at)) return next;
  return { ...next, companies: put(next.companies, id, { ...co, page: { ...page, as_of: at } }) };
}

/** The id of the company `name` is (a new one if none fits), and the companies then. Pure. */
export function idOf(c: Companies, name: string, at: string): { id: string; companies: Companies } {
  const id = companyOf(c, name);
  return id === undefined ? added(c, name, at) : { id, companies: c };
}

/**
 * The companies of a market kept by name (game-bots 0.35.0): each name's series replayed in time
 * order, renames followed, then each page, by the name it gives. Its series held no point for a
 * company at an update that quoted it at the value of the update a minute before (0.35.0 took them
 * for one), so a time's points are not the whole market: a company is gone only when updates went
 * on after its last point, as of the first of them. Pure.
 */
export function companiesFromNames(
  series: Readonly<Record<string, readonly Point[]>>,
  pages: Readonly<Record<string, CompanyPage>>
): Companies {
  const byTime = new Map<string, { company: string; point: Point }[]>();
  for (const [company, points] of Object.entries(series))
    for (const point of points) {
      const at = byTime.get(point.t) ?? [];
      at.push({ company, point });
      byTime.set(point.t, at);
    }
  const times = [...byTime.keys()].sort((a, b) => Date.parse(a) - Date.parse(b));
  let c: Companies = { companies: {}, gone: {}, series: {} };
  let latest: string | null = null;
  for (const t of times) {
    const at = byTime.get(t) ?? [];
    const via = at.find((x) => x.point.via !== 'listing')?.point.via ?? 'listing';
    const quotes = at.map(({ company, point }) => ({
      company,
      value: point.value,
      change: point.change,
      pct: point.pct,
      direction: (point.change > 0
        ? 'up'
        : point.change < 0
          ? 'down'
          : 'flat') as Quoted['direction'],
    }));
    c = quoted(c, quotes, t, via, false, latest);
    latest = t;
  }
  const updates = times.filter((t) => byTime.get(t)?.some((x) => x.point.via !== 'listing'));
  for (const [id, co] of Object.entries(c.companies)) {
    const last = (c.series[id] ?? []).at(-1)?.t;
    const after =
      last === undefined ? undefined : updates.find((t) => Date.parse(t) > Date.parse(last));
    if (after === undefined) continue;
    c = {
      ...c,
      companies: without(c.companies, id),
      gone: put(c.gone, id, { ...co, gone: after }),
    };
  }
  for (const [name, { as_of, ...page }] of Object.entries(pages)) c = paged(c, name, page, as_of);
  return c;
}
