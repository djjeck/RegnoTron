import { mediaIdOf } from '@regnotron/game-bots/media.ts';
import { GENERATED_EVENT, TRAVEL_EVENT } from '@regnotron/game-bots/plugins/loregame.ts';
import { describe, expect, it } from 'vitest';
import { mediaSeedOf, requirementsSeedOf } from './seed.ts';

import { type ExportPhoto } from '#tools/lore-check/photos.ts';

// Invented places and pictures.
const T = Date.parse('2026-10-22T12:00:00Z');
const bytes = (n: number) => Uint8Array.from([0xff, 0xd8, 0xff, n]);
const photo = (n: number, mime = 'image/jpeg'): ExportPhoto => ({
  file: `photo_${n}.jpg`,
  id: mediaIdOf(bytes(n)),
  mime,
  ...(n === 1 ? { width: 32, height: 16 } : {}),
});
const travel = (kind: string, code: string, answer: string, min: number) => ({
  type: TRAVEL_EVENT,
  t: T + min * 60_000,
  chat: 'Il Gruppo',
  kind,
  place: { name: `Il Posto ${code}`, code },
  answer,
});

describe('the pictures’ seed', () => {
  it('lists each place’s pictures as the state takes them, each file once', () => {
    const photos = new Map([
      ['Il Gruppo\n1', photo(1)],
      ['Il Gruppo\n2', photo(1)],
      ['Il Gruppo\n3', photo(2)],
      ['Il Gruppo\n4', photo(3)],
      ['Il Gruppo\n5', photo(4, 'video/mp4')],
    ]);
    const seed = mediaSeedOf(
      [
        {
          type: GENERATED_EVENT,
          t: T,
          chat: 'Il Gruppo',
          kind: 'season',
          name: 'Il Posto B9',
          code: 'B9',
          answer: '1',
        },
        // The same picture again; then another.
        travel('arrived', 'B9', '2', 1),
        travel('here', 'B9', '3', 2),
        // No photo held; a refusal; not an image.
        travel('here', 'B1', '9', 3),
        travel('refused', 'B2', '4', 4),
        travel('arrived', 'B3', '5', 5),
        { type: 'loregame.turn', t: T },
      ],
      photos,
      (file) => bytes(Number(/\d+/u.exec(file)?.[0]))
    );
    expect(seed.places).toEqual({
      B9: {
        name: 'Il Posto B9',
        media: [
          {
            id: mediaIdOf(bytes(1)),
            kind: 'image',
            mime: 'image/jpeg',
            width: 32,
            height: 16,
            source: {
              chat: 'Il Gruppo',
              message: '1',
              via: 'export',
              at: new Date(T).toISOString(),
            },
          },
          {
            id: mediaIdOf(bytes(2)),
            kind: 'image',
            mime: 'image/jpeg',
            source: {
              chat: 'Il Gruppo',
              message: '3',
              via: 'export',
              at: new Date(T + 2 * 60_000).toISOString(),
            },
          },
        ],
      },
    });
    expect(seed.files).toEqual({
      [mediaIdOf(bytes(1))]: Buffer.from(bytes(1)).toString('base64'),
      [mediaIdOf(bytes(2))]: Buffer.from(bytes(2)).toString('base64'),
    });
  });
});

describe('the requirements’ seed', () => {
  it('carries each place’s requirements the replay ends with, those told alone', () => {
    const at = new Date(T).toISOString();
    const place = (code: string, told: string | null) => ({
      name: `Il Posto ${code}`,
      level: told === null ? null : 3,
      items: told === null ? [] : [{ item: 'una pigna', rarity: code, tags: [], level: null }],
      guardians: told === null ? [] : ['B2'],
      exits: [{ name: 'Il Posto B2', code: 'B2' }],
      as_of: at,
      requirements_as_of: told,
      media: [],
    });
    expect(requirementsSeedOf({ places: { B3: place('B3', at), B4: place('B4', null) } })).toEqual({
      B3: {
        name: 'Il Posto B3',
        level: 3,
        items: [{ item: 'una pigna', rarity: 'B3', tags: [], level: null }],
        guardians: ['B2'],
        as_of: at,
      },
    });
    expect(requirementsSeedOf(undefined)).toEqual({});
  });
});
