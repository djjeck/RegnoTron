import { resvgRender } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_SIDE, renderPng } from './png.ts';
import { renderMapSvg } from './render.ts';

/** The width and height in a PNG's IHDR chunk. */
const size = (png: Uint8Array) => {
  const b = Buffer.from(png);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

describe('renderPng', () => {
  it('renders the map at 2×, with the bundled face, on the shell’s render service', async () => {
    const map = renderMapSvg({
      homes: [
        { name: 'Alfa', pairs: 2, at: { x: -50, y: 0 } },
        { name: 'Beta', pairs: 2, at: { x: 50, y: 0 } },
      ],
      unplaced: [],
      links: [['Alfa', 'Beta']],
      maxError: 0,
    });
    const png = await renderPng(map, resvgRender);
    expect(Buffer.from(png.subarray(1, 4)).toString('latin1')).toBe('PNG');
    expect(size(png)).toEqual({ width: 2 * map.width, height: 2 * map.height });
  });

  it('keeps the longest side within what Telegram keeps', async () => {
    const png = await renderPng(
      {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"/>',
        width: 1600,
        height: 400,
      },
      resvgRender
    );
    expect(size(png)).toEqual({ width: MAX_PHOTO_SIDE, height: 640 });
  });
});
