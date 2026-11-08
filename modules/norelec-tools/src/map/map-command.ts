/**
 * `/map`, a command of the `norelec-map` plugin
 * (modules/norelec-tools/src/plugins/norelec-map.ts): the photo of the players' homes
 * (modules/norelec-tools/src/map/service.ts), in reply to the command. The photo is uploaded once
 * and sent again by Telegram's `file_id` until the map changes; an id Telegram no longer takes is
 * replaced by a new upload.
 */
import { type Answer } from '@megabottron1999/core';
import { type MapPhoto } from '#src/map/service.ts';

export const NOT_YET = 'La mappa non è ancora pronta: servono più viaggi tra le case.';

export interface MapCommandDeps {
  map: { photo(): Promise<MapPhoto | undefined>; uploaded(key: string, fileId: string): void };
  /** Where a file id Telegram no longer takes is reported. */
  warn?: (line: string) => void;
}

/** The handler of `/map`. */
export function mapCommand(deps: MapCommandDeps): (answer: Answer) => Promise<void> {
  const warn = deps.warn ?? ((line: string) => console.log(line));
  return async (answer) => {
    const photo = await deps.map.photo();
    if (photo === undefined) return answer.text(NOT_YET);
    const upload = async (): Promise<void> => {
      const fileId = await answer.photo({ data: photo.png, filename: 'mappa.png' });
      if (fileId !== undefined) deps.map.uploaded(photo.key, fileId);
    };
    if (photo.fileId === undefined) return upload();
    try {
      await answer.photo(photo.fileId);
    } catch (e) {
      warn(`map: sending by file id failed, uploading again: ${String(e)}`);
      await upload();
    }
  };
}
