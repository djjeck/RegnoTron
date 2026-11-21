/**
 * The places' pictures, from a replay of the exports (tools/media-seed/README.md): each sight the
 * state takes live (a season's creation card, an arrival, a `/v`: src/media.ts's `sightOf`) whose
 * message the exports hold a photo of, as the seed `loregame-state` takes at its next start
 * (`media-seed` in its store): each place's list, `via: "export"`, and each picture's bytes once.
 */
import { type BusEvent, mediaKind } from '@megabottron1999/core';
import { sightOf, withMedia } from '@regnotron/game-bots/media.ts';
import { type MediaSeed } from '@regnotron/game-bots/plugins/loregame-state.ts';

import { type ExportPhoto } from '#tools/lore-check/photos.ts';

/**
 * The seed of `events` (a replay's, in order): `photos` the exports' (by `<chat>\n<id>`), `read` a
 * photo's bytes from its file. An entry is an image's alone; the same picture seen again is one.
 */
export function mediaSeedOf(
  events: readonly BusEvent[],
  photos: ReadonlyMap<string, ExportPhoto>,
  read: (file: string) => Uint8Array
): MediaSeed {
  const seed: MediaSeed = { places: {}, files: {} };
  for (const e of events) {
    const s = sightOf(e);
    const photo = s === undefined ? undefined : photos.get(`${s.chat}\n${s.message}`);
    if (s === undefined || photo === undefined || mediaKind(photo.mime) !== 'image') continue;
    const was = Object.hasOwn(seed.places, s.key) ? seed.places[s.key]?.media : undefined;
    const media = withMedia(was ?? [], {
      id: photo.id,
      kind: 'image',
      mime: photo.mime,
      ...(photo.width === undefined ? {} : { width: photo.width }),
      ...(photo.height === undefined ? {} : { height: photo.height }),
      source: { chat: s.chat, message: s.message, via: 'export', at: s.at },
    });
    Object.defineProperty(seed.places, s.key, {
      value: { name: s.name, media },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    if (!Object.hasOwn(seed.files, photo.id))
      seed.files[photo.id] = Buffer.from(read(photo.file)).toString('base64');
  }
  return seed;
}
