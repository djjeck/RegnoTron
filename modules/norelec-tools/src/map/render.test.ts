import { describe, expect, it } from 'vitest';
import { type MapLayout } from './layout.ts';
import {
  DISTANCE_COLOURS,
  distanceBands,
  escapeXml,
  holdingTier,
  MAX_SIDE,
  renderMapSvg,
  SCALE,
  squarest,
} from './render.ts';

const SMALL: MapLayout = {
  homes: [
    { name: 'Alfa', pairs: 3, at: { x: -50, y: 0 } },
    { name: 'Beta', pairs: 3, at: { x: 50, y: 0 } },
    { name: 'Gamma', pairs: 3, at: { x: 0, y: 70 } },
  ],
  unplaced: ['Delta', 'Epsilon'],
  links: [
    ['Alfa', 'Beta'],
    ['Alfa', 'Gamma'],
    ['Beta', 'Gamma'],
  ],
  maxError: 0.4,
};

describe('renderMapSvg', () => {
  it('draws a small fixed layout', async () => {
    await expect(renderMapSvg(SMALL).svg).toMatchFileSnapshot('./__snapshots__/small-map.svg');
  });

  it('draws a dot and a name for every home, and the legend of distances', () => {
    const svg = renderMapSvg(SMALL).svg;
    expect(svg.match(/<circle /gu)).toHaveLength(3);
    expect(svg).toContain('>Gamma</text>');
    for (const label of ['30s', '1m', '1m30', '2m']) expect(svg).toContain(`>${label}</text>`);
    for (const c of DISTANCE_COLOURS)
      expect(svg).toContain(`stroke="${c}" stroke-width="5" stroke-opacity="0.75"/>`);
  });

  it('colours a road by its length, from the middle out', () => {
    // Alfa to Beta is 100 s: 30 green in the middle, then 15 blue, 15 purple and 5 orange each way.
    const svg = renderMapSvg(SMALL).svg;
    const ab = [
      ...svg.matchAll(
        /<line x1="([\d.]+)" y1="208" x2="([\d.]+)" y2="208" stroke="(#[0-9a-f]+)"\/>/gu
      ),
    ];
    expect(ab.map((m) => [Number(m[2]) - Number(m[1]), m[3]])).toEqual([
      [5 * SCALE, DISTANCE_COLOURS[3]],
      [15 * SCALE, DISTANCE_COLOURS[2]],
      [15 * SCALE, DISTANCE_COLOURS[1]],
      [30 * SCALE, DISTANCE_COLOURS[0]],
      [15 * SCALE, DISTANCE_COLOURS[1]],
      [15 * SCALE, DISTANCE_COLOURS[2]],
      [5 * SCALE, DISTANCE_COLOURS[3]],
    ]);
  });

  it('keeps a map of close homes as wide as its legend', () => {
    const close: MapLayout = {
      homes: [
        { name: 'A', pairs: 1, at: { x: 0, y: 0 } },
        { name: 'B', pairs: 1, at: { x: 10, y: 0 } },
      ],
      unplaced: [],
      links: [['A', 'B']],
      maxError: 0,
    };
    const { svg, width } = renderMapSvg(close);
    const xs = [...svg.matchAll(/<line x1="([\d.]+)"/gu)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(width).toBeGreaterThan(4.5 * 30 * SCALE);
  });

  it('draws a busier road wider, with an arrow each way it is busier', () => {
    const widths = (roads: Record<string, number>) =>
      [
        ...renderMapSvg(SMALL, { roads, holdings: {} }).svg.matchAll(
          /<g fill="[^"]+" stroke-width="(\d)"/gu
        ),
      ].map((m) => m[1]);
    const arrows = (roads: Record<string, number>) =>
      renderMapSvg(SMALL, { roads, holdings: {} }).svg.match(/<polygon /gu)?.length ?? 0;
    // As busy both ways: one plain line, no arrow.
    const even = { 'Alfa Beta': 2, 'Beta Alfa': 2 };
    expect(widths(even)).toEqual(['2', '4']);
    expect(arrows(even)).toBe(0);
    // One way only, and two ways unevenly: one line, as wide as the busier way, with an arrow for
    // each busy way, in its own group (the 3 px one holds only an arrow).
    expect(widths({ 'Alfa Beta': 3 })).toEqual(['2', '5']);
    expect(arrows({ 'Alfa Beta': 3 })).toBe(1);
    const uneven = renderMapSvg(SMALL, {
      roads: { 'Alfa Beta': 3, 'Beta Alfa': 1 },
      holdings: {},
    }).svg;
    expect(widths({ 'Alfa Beta': 3, 'Beta Alfa': 1 })).toEqual(['2', '3', '5']);
    // No line beyond those of the plain map: the arrows ride on the one line.
    expect(uneven.match(/<line /gu)).toEqual(renderMapSvg(SMALL).svg.match(/<line /gu));
    expect(arrows({ 'Alfa Beta': 3, 'Beta Alfa': 1 })).toBe(2);
  });

  it('draws a home larger and hotter the more its player holds, grey when unknown', () => {
    const svg = renderMapSvg(SMALL, { roads: {}, holdings: { Alfa: 0, Beta: 2 } }).svg;
    expect([...svg.matchAll(/<circle [^>]*r="([\d.]+)"/gu)].map((m) => m[1])).toEqual([
      '4.5',
      '7',
      '5.5',
    ]);
    // Cold to hot, and grey for Gamma, whose holdings are not known.
    expect([...svg.matchAll(/<circle [^>]*fill="(#[0-9a-f]+)"/gu)].map((m) => m[1])).toEqual([
      '#3987e5',
      '#d03b3b',
      '#898781',
    ]);
    expect(holdingTier(1_000)).toBe(0);
    expect(holdingTier(1_001)).toBe(1);
    expect(holdingTier(50_001)).toBe(2);
  });

  it('shrinks a map too large for Telegram, and escapes names', () => {
    const far: MapLayout = {
      homes: [
        { name: 'A&B', pairs: 2, at: { x: -2000, y: 0 } },
        { name: '<C>', pairs: 2, at: { x: 2000, y: 10 } },
      ],
      unplaced: [],
      links: [['<C>', 'A&B']],
      maxError: 0,
    };
    const r = renderMapSvg(far);
    expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(MAX_SIDE);
    expect(r.svg).toContain('A&#38;B');
    expect(r.svg).toContain('&#60;C&#62;');
    // Bands too short for every label: every other one.
    expect(r.svg).toContain('>1m</text>');
    expect(r.svg).not.toContain('>30s</text>');
  });
});

describe('distanceBands', () => {
  const seconds = (s: number) =>
    distanceBands(s).map(({ from, to, band }) => [Math.round((to - from) * s * 10) / 10, band]);

  it('splits a road from the middle out, a band per 15 s more each way', () => {
    expect(seconds(80)).toEqual([
      [10, 2],
      [15, 1],
      [30, 0],
      [15, 1],
      [10, 2],
    ]);
    expect(seconds(20)).toEqual([[20, 0]]);
    expect(seconds(0)).toEqual([]);
    // Past 2 minutes, all that is left is red.
    expect(seconds(160)).toEqual([
      [20, 4],
      [15, 3],
      [15, 2],
      [15, 1],
      [30, 0],
      [15, 1],
      [15, 2],
      [15, 3],
      [20, 4],
    ]);
    const pieces = distanceBands(160);
    expect(pieces[0]?.from).toBe(0);
    expect(pieces.at(-1)?.to).toBe(1);
  });
});

describe('squarest', () => {
  const size = (l: MapLayout) => {
    const { width, height } = renderMapSvg(l);
    return Math.max(width, height) / Math.min(width, height);
  };
  const line = (deg: number): MapLayout => {
    const a = (deg * Math.PI) / 180;
    const at = (k: number) => ({ x: k * 60 * Math.cos(a), y: k * 60 * Math.sin(a) });
    return {
      homes: [0, 1, 2, 3].map((k) => ({ name: `P${k}`, pairs: 3, at: at(k) })),
      unplaced: [],
      links: [],
      maxError: 0,
    };
  };

  it('turns a long map until it is about as tall as it is wide', () => {
    const long = line(0);
    expect(size(long)).toBeGreaterThan(2);
    expect(size(squarest(long))).toBeLessThan(1.3);
  });

  it('keeps a map that is square enough as it is', () => {
    // 100 s wide and 127 s tall: with the labels' room, a square picture.
    const square: MapLayout = {
      ...SMALL,
      homes: [
        { name: 'Alfa', pairs: 2, at: { x: -50, y: 0 } },
        { name: 'Beta', pairs: 2, at: { x: 50, y: 0 } },
        { name: 'Gamma', pairs: 2, at: { x: 0, y: 127 } },
      ],
    };
    expect(size(square)).toBeLessThan(1.05);
    expect(squarest(square)).toEqual(square);
    expect(size(squarest(SMALL))).toBeLessThan(size(SMALL));
    const one = { ...SMALL, homes: SMALL.homes.slice(0, 1), links: [] };
    expect(squarest(one)).toBe(one);
  });
});

describe('escapeXml', () => {
  it('escapes what XML would read', () => {
    expect(escapeXml(`a&b<c>"d'`)).toBe('a&#38;b&#60;c&#62;&#34;d&#39;');
  });
});
