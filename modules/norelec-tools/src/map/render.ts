/**
 * The map of the homes as an SVG: one scale on both axes, in seconds of travel without rockets, +y
 * up, with no axes. Homes are filled dots, only those the times fix (`fixedOnly` in layout.ts);
 * every measured pair between them is a line under the dots, as wide as the road is busy its busier
 * way (`ROAD_WIDTHS`), and coloured by how far it is (`DISTANCE_COLOURS`, `distanceBands`): from
 * its middle out to both ends, green for the middle 30 s, then a band per 15 s more each way, to red
 * past 2 minutes. The legend in a corner shows the bands one way, at the map's scale, so that it is
 * also its scale bar. A road busier one way than the other has an arrowhead for each way it is busy,
 * as large as that way's traffic, two thirds of the way to its destination. A home's dot is a
 * little larger, and hotter in colour, the more balls its player holds (`HOME_RADII` and
 * `HOME_COLOURS`, by `holdingTier`); grey while they are not known. Every home gets its name, placed greedily (most pairs
 * first) at the one of 8 positions around its dot that overlaps least with the labels and dots
 * already there and with the edges. The face is monospace, so a label's width is its length. One
 * opaque dark background (the dataviz palette's dark surface and ink):
 * Telegram shows the image as is in both of its themes. png.ts turns it into the photo.
 */
import { type Point } from './fit.ts';
import { type MapLayout } from './layout.ts';
import { roadKey } from './measurements.ts';

/**
 * The look of the drawing: a map kept from an older look is drawn again
 * (modules/norelec-tools/src/map/service.ts). Raise it with any change to what this file draws.
 */
export const MAP_STYLE = 5;

/** px per second at 1×, unless the map would be too large. */
export const SCALE = 2.4;
/** The longest side at 1×: the photo is rendered at 2×, and Telegram keeps up to 2560 px. */
export const MAX_SIDE = 1280;

export const COLOURS = {
  background: '#1a1a19',
  text: '#f0efec',
  muted: '#c3c2b7',
  /** The arrows on the roads. */
  link: '#c3c2b7',
  /** A home whose player's holdings are not known. */
  unknown: '#898781',
};

/** The face bundled for the PNG (png.ts), OFL. */
export const FONT_FAMILY = 'IBM Plex Mono';
const FONT_SIZE = 13;
/** The width of one character of the face at FONT_SIZE: 600/1000 em. */
const CHAR_W = 0.6 * FONT_SIZE;
/**
 * The balls from which a player is in the next tier of holdings: up to about what a scripted raider's raids
 * take from a home that does not play, the bulk of the players, and the large holders.
 */
export const HOLDING_TIERS = [1_000, 50_000];

/** A player's tier of holdings, 0 to `HOLDING_TIERS.length`. */
export const holdingTier = (balls: number): number => HOLDING_TIERS.filter((n) => balls > n).length;

/** A home's radius at 1× by its player's tier; one whose balls are unknown has the middle one. */
export const HOME_RADII = [4.5, 5.5, 7];

/**
 * A home's colour by its player's tier, from cold to hot: the dataviz palette's dark blue, an
 * amber and a red, which pass its checks against the dark surface (lightness, chroma, contrast,
 * and apart enough for normal and colour-blind sight, the size telling the tiers apart too).
 */
export const HOME_COLOURS = ['#3987e5', '#c98500', '#d03b3b'];
const MIDDLE_TIER = 1;
/** A road's width and opacity at 1×, by how busy it is (`roadLevel` in measurements.ts). */
export const ROAD_WIDTHS = [2, 3, 4, 5];
const ROAD_OPACITY = [0.55, 0.65, 0.75, 0.85];
/**
 * A road's colours by distance, a band per `BAND_S` of its length, the last one for everything
 * past: a progression from green through blue, purple and orange to red, muted rather than primary,
 * each at least 4.4:1 against the dark surface and apart enough from its neighbours.
 */
export const DISTANCE_COLOURS = ['#4bb06c', '#3b97c9', '#8d72d6', '#d98a3d', '#d9534f'];
/** The length of a band, in seconds: the middle one is centred, the others are half at each end. */
export const BAND_S = 30;
/** Room around the dots for their labels, and the frame's margin. */
const PAD = { x: 70, y: 24 };
const MARGIN = 16;
/**
 * The legend's length, in seconds (a band per colour, the last one shorter, for "and more"), its
 * thickness, and the room it takes below the map, its labels included.
 */
const LEGEND_S = BAND_S * (DISTANCE_COLOURS.length - 0.5);
const LEGEND_W = 5;
/** As opaque as a busy road, so that its colours look like the roads'. */
const LEGEND_OPACITY = ROAD_OPACITY[2] as number;
const BAR_H = 34;

export interface MapSvg {
  svg: string;
  /** At 1×. */
  width: number;
  height: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The narrowest map, at 1×: room for the legend at full scale. */
const MIN_W = Math.ceil(LEGEND_S * SCALE + 4 * MARGIN);

/** The outer size, at 1× and full scale, of a map of `homes`. */
function sizeOf(points: readonly Point[]): { w: number; h: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    w: Math.max(MIN_W, (Math.max(...xs) - Math.min(...xs)) * SCALE + 2 * (PAD.x + MARGIN)),
    h: (Math.max(...ys) - Math.min(...ys)) * SCALE + 2 * (PAD.y + MARGIN) + BAR_H,
  };
}

/** How far from square a size is: the long side over the short one. */
const elongation = (s: { w: number; h: number }): number => Math.max(s.w, s.h) / Math.min(s.w, s.h);

/** Within this of the squarest, the smallest turn wins: a refit does not spin the map. */
const SQUARE_SLACK = 0.05;

/**
 * The layout turned so that the picture is as close to square as it gets, in whole degrees; of
 * the turns within `SQUARE_SLACK` of the squarest, the smallest, so that a refit aligned to the
 * previous map (already turned) stays as it was.
 */
export function squarest(layout: MapLayout): MapLayout {
  if (layout.homes.length < 2) return layout;
  const turned = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return (p: Point): Point => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos });
  };
  const points = layout.homes.map((h) => h.at);
  // A half turn gives the same box, so -89° to 90° covers every shape.
  const tries: { deg: number; e: number }[] = [];
  for (let deg = -89; deg <= 90; deg++)
    tries.push({ deg, e: elongation(sizeOf(points.map(turned(deg)))) });
  const best = Math.min(...tries.map((t) => t.e));
  const [chosen] = tries
    .filter((t) => t.e <= best + SQUARE_SLACK)
    .sort((x, y) => Math.abs(x.deg) - Math.abs(y.deg));
  const turn = turned((chosen as { deg: number }).deg);
  const round = (p: Point): Point => ({
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
  });
  return {
    ...layout,
    homes: layout.homes.map((h) => ({
      ...h,
      at: round(turn(h.at)),
      ...(h.other === undefined ? {} : { other: round(turn(h.other)) }),
    })),
  };
}

/**
 * What the map shows besides the homes and their distances: how busy each road is each way, by
 * `roadKey` (a way left out is quiet), and each player's tier of holdings (one left out is not
 * known).
 */
export interface Overlay {
  roads: Readonly<Record<string, number>>;
  holdings: Readonly<Record<string, number>>;
}

export function renderMapSvg(
  layout: MapLayout,
  { roads, holdings }: Overlay = { roads: {}, holdings: {} }
): MapSvg {
  const radius = (name: string): number =>
    HOME_RADII[Math.min(holdings[name] ?? MIDDLE_TIER, HOME_RADII.length - 1)] as number;
  const colour = (name: string): string => {
    const tier = holdings[name];
    return tier === undefined
      ? COLOURS.unknown
      : (HOME_COLOURS[Math.min(tier, HOME_COLOURS.length - 1)] as string);
  };
  const spots = layout.homes.map((h) => h.at);
  const xs = spots.map((p) => p.x);
  const ys = spots.map((p) => p.y);
  const lo = { x: Math.min(...xs), y: Math.min(...ys) };
  const hi = { x: Math.max(...xs), y: Math.max(...ys) };
  const full = sizeOf(spots);
  // Too large: shrink the map, not the labels, dots or margins.
  const spanW = (hi.x - lo.x) * SCALE;
  const spanH = (hi.y - lo.y) * SCALE;
  const fit = Math.min(
    1,
    (MAX_SIDE - (full.w - spanW)) / (spanW || 1),
    (MAX_SIDE - (full.h - spanH)) / (spanH || 1)
  );
  const scale = SCALE * fit;
  const plot: Box = {
    x: MARGIN,
    y: MARGIN,
    w: Math.max(MIN_W - 2 * MARGIN, (hi.x - lo.x) * scale + 2 * PAD.x),
    h: (hi.y - lo.y) * scale + 2 * PAD.y,
  };
  // A map narrower than the legend is centred in its width.
  const shift = (plot.w - ((hi.x - lo.x) * scale + 2 * PAD.x)) / 2;
  const width = Math.ceil(plot.w + 2 * MARGIN);
  const height = Math.ceil(plot.h + 2 * MARGIN + BAR_H);
  const px = (p: Point): Point => ({
    x: plot.x + shift + PAD.x + (p.x - lo.x) * scale,
    y: plot.y + PAD.y + (hi.y - p.y) * scale,
  });

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}">`,
    `<rect width="${width}" height="${height}" fill="${COLOURS.background}"/>`
  );

  // Measured pairs, under the dots, the quiet ones first so that busy ones lie on top; each one a
  // line per band of distance, and the arrows on top of them.
  const at = new Map(layout.homes.map((h) => [h.name, h.at]));
  const top = ROAD_WIDTHS.length - 1;
  const byLevel: string[][] = ROAD_WIDTHS.map(() => []);
  for (const [a, b] of layout.links) {
    const p = px(at.get(a) as Point);
    const q = px(at.get(b) as Point);
    const toB = Math.min(roads[roadKey(a, b)] ?? 0, top);
    const toA = Math.min(roads[roadKey(b, a)] ?? 0, top);
    const seconds = Math.hypot(q.x - p.x, q.y - p.y) / scale;
    for (const { from, to, band } of distanceBands(seconds))
      (byLevel[Math.max(toB, toA)] as string[]).push(
        line(along(p, q, from), along(p, q, to), DISTANCE_COLOURS[band] as string)
      );
    if (toB !== toA)
      for (const [from, to, level] of [
        [p, q, toB],
        [q, p, toA],
      ] as const)
        if (level > 0)
          (byLevel[level] as string[]).push(arrow(from, to, ROAD_WIDTHS[level] as number));
  }
  byLevel.forEach((lines, level) => {
    if (lines.length > 0)
      out.push(
        `<g fill="${COLOURS.link}" stroke-width="${ROAD_WIDTHS[level]}" stroke-opacity="${ROAD_OPACITY[level]}" fill-opacity="${ROAD_OPACITY[level]}" stroke-linecap="butt">${lines.join('')}</g>`
      );
  });

  // Homes.
  for (const h of layout.homes) {
    const p = px(h.at);
    out.push(
      `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${radius(h.name)}" fill="${colour(h.name)}" stroke="${COLOURS.background}" stroke-width="2"/>`
    );
  }

  // Labels.
  const dots: Box[] = layout.homes.map((h) => {
    const p = px(h.at);
    const r = radius(h.name) + 2;
    return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
  });
  const placed: Box[] = [];
  const labels: string[] = [];
  for (const h of layout.homes) {
    const box = placeLabel(px(h.at), radius(h.name), h.name, placed, dots, plot);
    placed.push(box);
    labels.push(
      `<text x="${n(box.x)}" y="${n(box.y + FONT_SIZE - 2)}">${escapeXml(h.name)}</text>`
    );
  }
  out.push(`<g fill="${COLOURS.text}">${labels.join('')}</g>`);

  out.push(legend(width - MARGIN, height - MARGIN - 16, scale), '</svg>');
  return { svg: out.join('\n'), width, height };
}

/**
 * The pieces of a road `seconds` long, as fractions of its length from one end, each with its band
 * of distance (an index of `DISTANCE_COLOURS`): the middle `BAND_S` is band 0, and each band after
 * it takes `BAND_S / 2` more at both ends, the last one all that is left. A road of 80 s is 10 s of
 * band 2, 15 of band 1, 30 of band 0, 15 of band 1 and 10 of band 2.
 */
export function distanceBands(seconds: number): { from: number; to: number; band: number }[] {
  const last = DISTANCE_COLOURS.length - 1;
  const half = seconds / 2;
  // Fractions of the length, from the middle out.
  const at = (s: number): number => (half + s) / seconds;
  const left: { from: number; to: number; band: number }[] = [];
  const right: { from: number; to: number; band: number }[] = [];
  for (let band = 0; band <= last && (band * BAND_S) / 2 < half; band++) {
    const inner = (band * BAND_S) / 2;
    const outer = band === last ? half : Math.min(half, ((band + 1) * BAND_S) / 2);
    if (band === 0) {
      right.push({ from: at(-outer), to: at(outer), band });
      continue;
    }
    left.unshift({ from: at(-outer), to: at(-inner), band });
    right.push({ from: at(inner), to: at(outer), band });
  }
  return [...left, ...right];
}

/** The point a fraction `t` of the way from `p` to `q`. */
const along = (p: Point, q: Point, t: number): Point => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
});

/**
 * The colours of distance, right-aligned at (x, y), at the map's `scale`: a band of `BAND_S` per
 * colour, one way only, the last one shorter, with a tick and a label at each band's end (every
 * other one when the bands are too short for their labels).
 */
function legend(x: number, y: number, scale: number): string {
  const band = BAND_S * scale;
  const x0 = x - LEGEND_S * scale;
  const out = DISTANCE_COLOURS.map((c, i) => {
    const end = Math.min(x, x0 + (i + 1) * band);
    return `<line x1="${n(x0 + i * band)}" y1="${n(y)}" x2="${n(end)}" y2="${n(y)}" stroke="${c}" stroke-width="${LEGEND_W}" stroke-opacity="${LEGEND_OPACITY}"/>`;
  });
  const ink = `stroke="${COLOURS.muted}" stroke-width="1.5"`;
  const every = band >= 40 ? 1 : 2;
  for (let i = 0; i < DISTANCE_COLOURS.length; i++) {
    const tx = x0 + i * band;
    out.push(
      `<line x1="${n(tx)}" y1="${n(y - LEGEND_W / 2 - 2)}" x2="${n(tx)}" y2="${n(y + LEGEND_W / 2 + 2)}" ${ink}/>`
    );
    if (i > 0 && i % every === 0)
      out.push(
        `<text x="${n(tx)}" y="${n(y + LEGEND_W / 2 + 14)}" text-anchor="middle" fill="${COLOURS.muted}">${duration(i * BAND_S)}</text>`
      );
  }
  return out.join('\n');
}

/** A legend's label: `30s`, `1m`, `1m30`. */
const duration = (s: number): string =>
  s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 === 0 ? '' : String(s % 60).padStart(2, '0')}`;

/** The 8 places around a dot of radius `r` a label may go, in order of preference. */
function candidates(p: Point, r: number, w: number, h: number): Box[] {
  const g = r + 3.5;
  const c = r + 0.5;
  return [
    { x: p.x + g, y: p.y - h / 2 },
    { x: p.x - g - w, y: p.y - h / 2 },
    { x: p.x - w / 2, y: p.y - g - h },
    { x: p.x - w / 2, y: p.y + g },
    { x: p.x + c, y: p.y - c - h },
    { x: p.x - c - w, y: p.y - c - h },
    { x: p.x + c, y: p.y + c },
    { x: p.x - c - w, y: p.y + c },
  ].map((b) => ({ ...b, w, h }));
}

function placeLabel(p: Point, r: number, name: string, labels: Box[], dots: Box[], plot: Box): Box {
  const w = name.length * CHAR_W;
  const h = FONT_SIZE;
  let best: { box: Box; cost: number } | undefined;
  for (const box of candidates(p, r, w, h)) {
    let cost = box.w * box.h - overlap(box, plot);
    for (const o of labels) cost += overlap(box, o);
    for (const o of dots) cost += overlap(box, o);
    if (best === undefined || cost < best.cost) best = { box, cost };
  }
  return (best as { box: Box }).box;
}

const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** An arrowhead on the road from `p` to `q`, for a way `w` wide, centred two thirds along. */
function arrow(p: Point, q: Point, w: number): string {
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
  const head = 5 + 2 * w;
  const half = 2 + w;
  const along = (2 / 3) * len + head / 2;
  const tip = { x: p.x + u.x * along, y: p.y + u.y * along };
  const base = { x: tip.x - u.x * head, y: tip.y - u.y * head };
  const corner = (k: number): Point => ({ x: base.x - u.y * half * k, y: base.y + u.x * half * k });
  const [c1, c2] = [corner(1), corner(-1)];
  return `<polygon stroke="none" points="${n(tip.x)},${n(tip.y)} ${n(c1.x)},${n(c1.y)} ${n(c2.x)},${n(c2.y)}"/>`;
}

const line = (p: Point, q: Point, stroke: string): string =>
  `<line x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(q.x)}" y2="${n(q.y)}" stroke="${stroke}"/>`;

/** A coordinate, to a tenth of a pixel. */
const n = (v: number): string => String(Math.round(v * 10) / 10);

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/gu, (c) => `&#${c.charCodeAt(0)};`);
}
