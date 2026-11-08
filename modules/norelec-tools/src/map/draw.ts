/**
 * The whole drawing of the map, from the measured pairs to the PNG: fit (fit.ts), what is fixed and
 * the orientation (layout.ts), of which only the fixed homes are drawn, turned to be as square as
 * it gets, the SVG (render.ts) and the photo, by the shell's render service (png.ts), which runs
 * off the event loop. The fit runs on it: about half a second on a full map, and only when the
 * measurements have changed and settled.
 */
import { type Render } from '@megabottron1999/core';
import { type Distance, fitHomes } from './fit.ts';
import { fixedOnly, layoutMap, type MapLayout } from './layout.ts';
import { renderPng } from './png.ts';
import { type Overlay, renderMapSvg, squarest } from './render.ts';

export type Drawn =
  | { accepted: true; maxError: number; layout: MapLayout; png: Uint8Array }
  | { accepted: false; maxError: number };

/** `overlay`: the roads' traffic and the players' holdings, for the widths and the dots. */
export async function drawMap(
  render: Render,
  pairs: readonly Distance[],
  overlay: Overlay = { roads: {}, holdings: {} },
  previous?: MapLayout
): Promise<Drawn> {
  const fit = fitHomes(pairs);
  if (!fit.accepted) return { accepted: false, maxError: fit.best.maxError };
  const layout = squarest(fixedOnly(layoutMap(pairs, fit, previous)));
  return {
    accepted: true,
    maxError: fit.best.maxError,
    layout,
    png: await renderPng(renderMapSvg(layout, overlay), render),
  };
}
