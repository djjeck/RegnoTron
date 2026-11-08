import { type Answer, type CommandPhoto } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { type MapPhoto } from '#src/map/service.ts';
import { mapCommand, NOT_YET } from './map-command.ts';

/** A map that remembers the file id it was given. */
function fakeMap(photo: MapPhoto | null = { key: 'k1', png: Buffer.from([1]) }) {
  const uploads: [string, string][] = [];
  let current = photo ?? undefined;
  return {
    uploads,
    map: {
      photo: () => Promise.resolve(current),
      uploaded: (key: string, fileId: string) => {
        uploads.push([key, fileId]);
        if (current?.key === key) current = { ...current, fileId };
      },
    },
  };
}

/** An answer that records what is sent, refusing the photos `refuse` says. */
function answer(refuse: (photo: CommandPhoto) => boolean = () => false) {
  const sent: string[] = [];
  let n = 0;
  const a: Answer = {
    text: (text) => {
      sent.push(text);
      return Promise.resolve();
    },
    photo: (photo) => {
      sent.push(typeof photo === 'string' ? photo : `upload ${photo.filename}`);
      if (refuse(photo)) return Promise.reject(new Error('400: wrong file identifier'));
      return Promise.resolve(`photo-${++n}`);
    },
  };
  return { a, sent };
}

describe('/map', () => {
  it('uploads the photo once, then sends it by its file id', async () => {
    const m = fakeMap();
    const handle = mapCommand({ map: m.map });
    const first = answer();
    await handle(first.a);
    const second = answer();
    await handle(second.a);
    expect(first.sent).toEqual(['upload mappa.png']);
    expect(m.uploads).toEqual([['k1', 'photo-1']]);
    expect(second.sent).toEqual(['photo-1']);
  });

  it('uploads again when Telegram no longer takes the file id', async () => {
    const m = fakeMap({ key: 'k1', png: Buffer.from([1]), fileId: 'stale' });
    const warned: string[] = [];
    const r = answer((p) => p === 'stale');
    await mapCommand({ map: m.map, warn: (l) => warned.push(l) })(r.a);
    expect(r.sent).toEqual(['stale', 'upload mappa.png']);
    expect(m.uploads).toEqual([['k1', 'photo-1']]);
    expect(warned).toEqual([
      'map: sending by file id failed, uploading again: Error: 400: wrong file identifier',
    ]);
  });

  it('keeps no file id when Telegram gives none', async () => {
    const m = fakeMap();
    await mapCommand({ map: m.map })({
      text: () => Promise.resolve(),
      photo: () => Promise.resolve(undefined),
    });
    expect(m.uploads).toEqual([]);
  });

  it('says the map is not ready while there is none', async () => {
    const r = answer();
    await mapCommand({ map: fakeMap(null).map })(r.a);
    expect(r.sent).toEqual([NOT_YET]);
  });
});
