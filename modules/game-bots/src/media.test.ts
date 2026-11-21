import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '#src/loregame-state.ts';
import {
  imageSize,
  MEDIA_EVENT,
  type MediaEntry,
  mediaFileOf,
  mediaIdOf,
  sightOf,
  wantsPicture,
  withMedia,
} from '#src/media.ts';
import { GENERATED_EVENT, TRAVEL_EVENT } from '#src/plugins/loregame.ts';

const T = Date.parse('2026-11-06T12:00:00Z');
const at = (min: number): string => new Date(T + min * 60_000).toISOString();
const image = (id: string, min: number, message = String(min)): MediaEntry => ({
  id,
  kind: 'image',
  mime: 'image/jpeg',
  source: { chat: '-1001', message, via: 'arrival', at: at(min) },
});
const none = (kind: 'other' | 'unknown', min: number): MediaEntry => ({
  id: null,
  kind,
  source: { chat: '-1001', message: String(min), via: 'v', at: at(min) },
});
const PLACE = { name: 'Il Bosco Inventato ⛅️', code: 'B1' };

describe('a picture’s id and file', () => {
  it('is the SHA-256 of its bytes, its file the same with no colon', () => {
    const id = mediaIdOf(new TextEncoder().encode('abc'));
    expect(id).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(mediaFileOf(id)).toBe(`sha256-${id.slice(7)}`);
    expect(mediaFileOf('sha256:abc')).toBeUndefined();
    expect(mediaFileOf('../etc')).toBeUndefined();
  });
});

describe('an entity’s list of media', () => {
  it('wants a picture until it has one, or a message without a photo', () => {
    expect(wantsPicture([])).toBe(true);
    expect(wantsPicture([none('unknown', 1)])).toBe(true);
    expect(wantsPicture([none('other', 1)])).toBe(false);
    expect(wantsPicture([none('unknown', 1), image('a', 2)])).toBe(false);
  });

  it('keeps them in the order seen, a picture changed a new entry, the same one once', () => {
    let list = withMedia([], image('a', 10));
    list = withMedia(list, image('a', 20));
    expect(list.map((m) => m.id)).toEqual(['a']);
    list = withMedia(list, image('b', 30));
    // An older one (a seed's) before; the same as the next image: nothing.
    list = withMedia(list, image('c', 5));
    list = withMedia(list, image('b', 25));
    expect(list.map((m) => m.id)).toEqual(['c', 'a', 'b']);
    // A message already recorded.
    expect(withMedia(list, image('c', 5))).toEqual(list);
    expect(withMedia([none('unknown', 1)], none('unknown', 1))).toHaveLength(1);
    expect(withMedia([none('unknown', 1)], none('other', 2))).toHaveLength(2);
  });
});

describe('a sight', () => {
  const ev = (type: string, fields: Record<string, unknown>) => ({ type, t: T, ...fields });

  it('is an arrival, a /v or a season’s creation card, with the message', () => {
    expect(
      sightOf(ev(TRAVEL_EVENT, { chat: 'g', kind: 'arrived', place: PLACE, answer: '7' }))
    ).toEqual({
      entity: 'place',
      key: 'B1',
      name: PLACE.name,
      chat: 'g',
      message: '7',
      via: 'arrival',
      at: at(0),
    });
    expect(
      sightOf(ev(TRAVEL_EVENT, { chat: 'g', kind: 'here', place: PLACE, answer: '8' }))
    ).toMatchObject({ via: 'v', message: '8' });
    expect(
      sightOf(
        ev(GENERATED_EVENT, { chat: 'g', kind: 'season', name: 'La Cima', code: 'B9', answer: '9' })
      )
    ).toMatchObject({ key: 'B9', name: 'La Cima', via: 'creation' });
  });

  it('is none for a refusal, an answer not known, another generator, another event', () => {
    expect(
      sightOf(ev(TRAVEL_EVENT, { chat: 'g', kind: 'refused', place: PLACE, answer: '7' }))
    ).toBeUndefined();
    expect(
      sightOf(ev(TRAVEL_EVENT, { chat: 'g', kind: 'arrived', place: PLACE, answer: null }))
    ).toBeUndefined();
    expect(sightOf(ev(TRAVEL_EVENT, { chat: 'g', kind: 'arrived' }))).toBeUndefined();
    expect(
      sightOf(ev(GENERATED_EVENT, { chat: 'g', kind: 'item', name: 'x', code: 'B1', answer: '9' }))
    ).toBeUndefined();
    expect(
      sightOf(
        ev(GENERATED_EVENT, { chat: 'g', kind: 'season', name: null, code: null, answer: '9' })
      )
    ).toBeUndefined();
    expect(sightOf(ev(GENERATED_EVENT, { chat: 'g' }))).toBeUndefined();
    expect(sightOf(ev('loregame.turn', {}))).toBeUndefined();
  });
});

describe('the reducer of a picture', () => {
  it('adds it to its place, known by its name from then on; a bad one changes nothing', () => {
    const s = initialState();
    const media = image('sha256:aa', 0);
    const next = reduce(s, {
      type: MEDIA_EVENT,
      t: T,
      entity: 'place',
      key: 'B1',
      ...PLACE,
      media,
    });
    expect(next.places['B1']).toMatchObject({ name: PLACE.name, level: null, media: [media] });
    expect(
      reduce(next, { type: MEDIA_EVENT, t: T, entity: 'place', key: 'B1', ...PLACE, media })
    ).toBe(next);
    expect(reduce(s, { type: MEDIA_EVENT, t: T, entity: 'story' })).toBe(s);
  });
});

describe('an image’s size', () => {
  it('is read from a JPEG’s frame or a PNG’s header', () => {
    // A JPEG with an APP0 segment before its frame.
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x01, 0x00,
      0x02, 0x00, 0x03,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 512, height: 256 });
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 1, 0, 0, 0, 0, 200], 16);
    expect(imageSize(png)).toEqual({ width: 256, height: 200 });
    expect(imageSize(png.subarray(0, 10))).toBeUndefined();
    expect(imageSize(Uint8Array.from([0x47, 0x49, 0x46]))).toBeUndefined();
    // A JPEG cut short, or not a marker where one should be.
    expect(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeUndefined();
    expect(
      imageSize(Uint8Array.from([0xff, 0xd8, 0x00, 0xe0, 0, 4, 0, 0, 0, 0, 0, 0]))
    ).toBeUndefined();
  });
});
