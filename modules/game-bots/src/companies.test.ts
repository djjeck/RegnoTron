import { describe, expect, it } from 'vitest';
import {
  type Companies,
  companiesFromNames,
  companyOf,
  coreOf,
  idFor,
  idOf,
  paged,
  type Quoted,
  quoted,
} from './companies.ts';
import { type Point } from './market.ts';

// Invented companies.
const EMPTY: Companies = { companies: {}, gone: {}, series: {} };
const at = (h: number) => new Date(Date.UTC(2026, 10, 1, h)).toISOString();
const q = (company: string, value: number, change = 0): Quoted => ({
  company,
  value,
  change,
  pct: 0,
  direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
});
/** The companies after each whole listing, an hour apart. */
const listed = (...listings: Quoted[][]): Companies =>
  listings.reduce<{ c: Companies; h: number }>(
    ({ c, h }, quotes) => ({
      c: quoted(c, quotes, at(h), 'update', true, h === 0 ? null : at(h - 1)),
      h: h + 1,
    }),
    { c: EMPTY, h: 0 }
  ).c;

describe('the market’s companies', () => {
  it('names a company by its letters, and makes its id of them, free', () => {
    expect(coreOf('📈 Pinco Spa ⏫ 🍕')).toBe('pinco spa');
    expect(coreOf('F.R.O.D.E. & Co, LP ⚖️')).toBe('f.r.o.d.e. & co, lp');
    expect(idFor(EMPTY, 'F.R.O.D.E. & Co, LP ⚖️')).toBe('f-r-o-d-e-co-lp');
    expect(idFor(EMPTY, '🍕')).toBe('company');
    const c = listed([q('Pinco Spa 🍕', 100)]);
    expect(idFor(c, 'Pinco Spa 🎉')).toBe('pinco-spa-2');
    expect(
      idFor({ ...c, gone: { 'pinco-spa-2': c.companies['pinco-spa'] as never } }, 'Pinco Spa')
    ).toBe('pinco-spa-3');
  });

  it('follows a rename: by its letters, by a name it had, by the value it carries on', () => {
    const c = listed(
      [q('Pinco Spa 🍕', 100), q('Tizio Srl', 50)],
      [q('📈 Pinco Spa ⏫ 🍕', 102, 2), q('Tizio Srl', 50)],
      [q('Pinco Spa 🍕', 103, 1), q('Tizio Srl', 50)],
      // A name of no letters in common, its value carried on: Tizio's.
      [q('Pinco Spa 🍕', 103), q('Caio & Co', 55, 5)]
    );
    expect(Object.keys(c.companies)).toEqual(['pinco-spa', 'tizio-srl']);
    expect(c.companies['pinco-spa']?.names.map((n) => n.name)).toEqual([
      'Pinco Spa 🍕',
      '📈 Pinco Spa ⏫ 🍕',
      'Pinco Spa 🍕',
    ]);
    expect(c.companies['tizio-srl']).toMatchObject({ name: 'Caio & Co', quote: { value: 55 } });
    expect(c.series['pinco-spa']?.map((p) => p.value)).toEqual([100, 102, 103, 103]);
    expect(companyOf(c, '📈 Pinco Spa ⏫ 🍕')).toBe('pinco-spa');
    expect(companyOf(c, 'Tizio Srl')).toBe('tizio-srl');
    expect(companyOf(c, 'Nessuno')).toBeUndefined();
  });

  it('takes none for a rename where two fit, and removes those a whole listing does not quote', () => {
    const c = listed(
      [q('Pinco Spa 🍕', 100), q('Pinco Spa 🎉', 100)],
      // Two had the letters: a new company. The two not quoted are gone.
      [q('Pinco Spa 🌵', 100)]
    );
    expect(Object.keys(c.companies)).toEqual(['pinco-spa-3']);
    expect(Object.keys(c.gone)).toEqual(['pinco-spa', 'pinco-spa-2']);
    expect(c.gone['pinco-spa']?.gone).toBe(at(1));
    expect(companyOf(c, 'Pinco Spa 🍕')).toBe('pinco-spa-3');
  });

  it('renames and removes nothing for a listing told late, nor for a part', () => {
    const now = listed([q('Pinco Spa 🍕', 100), q('Tizio Srl', 50)]);
    const late = quoted(now, [q('Pinco Spa 🎉', 90)], at(-5), 'update', true, at(0));
    expect(Object.keys(late.companies)).toEqual(['pinco-spa', 'tizio-srl']);
    expect(late.companies['pinco-spa']).toMatchObject({
      name: 'Pinco Spa 🍕',
      quote: { value: 100 },
    });
    expect(late.series['pinco-spa']?.map((p) => p.value)).toEqual([90, 100]);
    const part = quoted(now, [q('Pinco Spa 🍕', 101, 1)], at(1), 'listing', false, at(0));
    expect(Object.keys(part.companies)).toEqual(['pinco-spa', 'tizio-srl']);
  });

  it('gives a page, or an investment, to the company whose letters it has, or a new one', () => {
    const c = listed([q('Pinco Spa 🍕', 100)]);
    const page = {
      size: 1,
      max: 20,
      leader: 'bob',
      power: 5,
      members: [],
      value: 100,
      profile: null,
    };
    expect(paged(c, 'Pinco Spa', page, at(1)).companies['pinco-spa']?.page).toEqual({
      ...page,
      as_of: at(1),
    });
    // An older page than the one kept: kept.
    const newer = paged(c, 'Pinco Spa', page, at(2));
    expect(
      paged(newer, 'Pinco Spa', { ...page, value: 1 }, at(1)).companies['pinco-spa']?.page?.value
    ).toBe(100);
    const fresh = paged(c, 'Caio Spa', page, at(1));
    expect(fresh.companies['caio-spa']).toMatchObject({ name: 'Caio Spa', quote: null });
    expect(idOf(c, 'Pinco Spa 🍕', at(1)).id).toBe('pinco-spa');
    expect(idOf(c, 'Altro', at(1))).toMatchObject({ id: 'altro' });
  });

  it('keeps a market kept by name by id, renames followed and those gone gone (0.35.0)', () => {
    const p = (h: number, value: number, via: Point['via'] = 'update'): Point => ({
      t: at(h),
      value,
      change: 0,
      pct: 0,
      via,
    });
    const c = companiesFromNames(
      {
        'Pinco Spa 🍕': [p(0, 100), p(2, 102), p(3, 103, 'listing')],
        '📈 Pinco Spa ⏫ 🍕': [p(1, 101)],
        'Tizio Srl': [p(0, 50), p(1, 50)],
      },
      {
        'Pinco Spa': {
          size: 1,
          max: 20,
          leader: 'bob',
          power: 5,
          members: [],
          value: 103,
          profile: null,
          as_of: at(3),
        },
      }
    );
    expect(Object.keys(c.companies)).toEqual(['pinco-spa']);
    expect(c.series['pinco-spa']?.map((x) => x.value)).toEqual([100, 101, 102, 103]);
    expect(c.companies['pinco-spa']?.page?.leader).toBe('bob');
    expect(c.gone['tizio-srl']?.gone).toBe(at(2));
    // A company missing from one time's points, but quoted after: not gone.
    const lossy = companiesFromNames(
      {
        'Pinco Spa 🍕': [p(0, 100), p(2, 100)],
        'Tizio Srl': [p(0, 50), p(1, 51, 'forced'), p(2, 51)],
      },
      {}
    );
    expect(Object.keys(lossy.companies)).toEqual(['pinco-spa', 'tizio-srl']);
  });
});
