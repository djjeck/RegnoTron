/**
 * The places' pictures and requirements, from a replay of the exports
 * (tools/media-seed/README.md), as the seed `loregame-state` takes at its next start (`media-seed`
 * in its store): each sight the state takes live (a season's creation card, an arrival, a `/v`:
 * src/media.ts's `sightOf`) whose message the exports hold a photo of, each place's list, `via:
 * "export"`, and each picture's bytes once; and each place's requirements as the replayed state
 * holds them at its end, with when they were told.
 */
import { type BusEvent, mediaKind } from '@megabottron1999/core';
import { type LoreState } from '@regnotron/game-bots/loregame-state.ts';
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

/**
 * Each place's requirements in `state` (a replay's, at its end: `loregame-state`'s), those told
 * alone, as a seed carries them: its level, items and guardians, and when they were told.
 */
export function requirementsSeedOf(state: unknown): NonNullable<MediaSeed['requirements']> {
  const places = ((state as Partial<LoreState> | undefined)?.places ?? {}) as LoreState['places'];
  return Object.fromEntries(
    Object.entries(places).flatMap(([code, p]) =>
      p.requirements_as_of == null
        ? []
        : [
            [
              code,
              {
                name: p.name,
                level: p.level,
                items: p.items,
                guardians: p.guardians,
                as_of: p.requirements_as_of,
              },
            ],
          ]
    )
  );
}
