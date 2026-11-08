/**
 * The map's photo: the SVG of render.ts rendered by the shell's render service (`ctx.render`,
 * MegaBotTron1999's docs/bot-os-api.md §4.13), at 2× with the longest side at most 2560 px (what
 * Telegram keeps of a photo). The service reads no system fonts, so the image looks the same on any
 * host: the one face is bundled with this module (IBM Plex Mono, OFL, `fonts/`).
 */
import { type Render, type SvgToPngOptions } from '@megabottron1999/core';
import { fileURLToPath } from 'node:url';
import { COLOURS, FONT_FAMILY, type MapSvg } from './render.ts';

export const FONT_FILE = fileURLToPath(new URL('fonts/IBMPlexMono-Regular.ttf', import.meta.url));
export const PIXEL_RATIO = 2;
export const MAX_PHOTO_SIDE = 2560;

/** How the photo is rendered. */
export const PHOTO_OPTIONS: SvgToPngOptions = {
  scale: PIXEL_RATIO,
  maxSide: MAX_PHOTO_SIDE,
  background: COLOURS.background,
  fonts: [FONT_FILE],
  defaultFontFamily: FONT_FAMILY,
};

/** The map's SVG as a PNG, by the render service. */
export function renderPng(map: MapSvg, render: Render): Promise<Uint8Array> {
  return render.svgToPng(map.svg, PHOTO_OPTIONS);
}
