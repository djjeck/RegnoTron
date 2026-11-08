import { resvgRender } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { syntheticHomes } from '#test/homes.ts';
import { drawMap } from './draw.ts';

// Full fits of several seeds, slow under coverage.
const FULL_FIT_TIMEOUT = 60_000;

describe('drawMap', () => {
  it(
    'draws a map that fits, as a PNG',
    async () => {
      const { pairs } = syntheticHomes(1, 8);
      const drawn = await drawMap(resvgRender, pairs);
      expect(drawn.accepted).toBe(true);
      if (!drawn.accepted) return;
      // Every home is drawn or listed; a sparse map leaves a home or so uncertain.
      expect(drawn.layout.homes.length + drawn.layout.unplaced.length).toBe(8);
      expect(drawn.layout.homes.length).toBeGreaterThan(5);
      expect(drawn.layout.homes.every((h) => h.other === undefined)).toBe(true);
      expect(Buffer.from(drawn.png.subarray(1, 4)).toString('latin1')).toBe('PNG');
    },
    FULL_FIT_TIMEOUT
  );

  it(
    'refuses times that no plane fits',
    async () => {
      const drawn = await drawMap(resvgRender, [
        { a: 'A', b: 'B', d: 10 },
        { a: 'B', b: 'C', d: 10 },
        { a: 'A', b: 'C', d: 100 },
      ]);
      expect(drawn).toMatchObject({ accepted: false });
    },
    FULL_FIT_TIMEOUT
  );
});
