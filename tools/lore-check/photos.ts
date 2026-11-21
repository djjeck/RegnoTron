/**
 * The photos of Telegram Desktop exports (tools/lore-check/README.md, tools/media-seed/README.md):
 * an export keeps each photo of its messages as a file (`photos/photo_<n>@<date>.jpg`), linked from
 * its message, which MegaBotTron1999's readers leave out. Here they are found again, by the message
 * they belong to, so that a replay can tell which of the bot's answers showed a picture, and which.
 *
 * Keyed as a replay knows a message, `<chat>\n<id>`: the chat as `toInbounds` names it (the bot's
 * private chat by its username, a group by its title), a group renamed between two exports by the
 * name `mergeRenamedChats` gives it.
 */
import { sniffMime } from '@megabottron1999/core';
import { listInput, readJsonFile } from '@megabottron1999/telegram-export/files.ts';
import { readHtmlExport, splitExports } from '@megabottron1999/telegram-export/merge.ts';
import { imageSize, mediaIdOf } from '@regnotron/game-bots/media.ts';
import fs from 'node:fs';
import path from 'node:path';

/** A message's photo, as an export links it: its file, relative to the export's folder. */
export interface Linked {
  photo: string;
  width?: number;
  height?: number;
}

const MESSAGE = /<div class="message [^"]*" id="message(-?\d+)">/gu;
const PHOTO = /<a class="photo_wrap[^"]*" href="([^"]+)"/u;

/** The photos an HTML page of an export links, by message id. */
export function photosInHtml(html: string): Map<string, Linked> {
  const out = new Map<string, Linked>();
  const starts = [...html.matchAll(MESSAGE)];
  for (const [i, m] of starts.entries()) {
    const end = starts[i + 1]?.index ?? html.length;
    const photo = PHOTO.exec(html.slice(m.index, end));
    if (photo !== null) out.set(m[1] as string, { photo: decodeURI(photo[1] as string) });
  }
  return out;
}

/** The photos a JSON export lists, by message id, with their size. */
export function photosInJson(json: unknown): Map<string, Linked> {
  const out = new Map<string, Linked>();
  const messages = (json as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) return out;
  for (const m of messages as Record<string, unknown>[]) {
    if (typeof m['photo'] !== 'string' || typeof m['id'] !== 'number') continue;
    const { width, height } = m;
    out.set(String(m['id']), {
      photo: m['photo'],
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
    });
  }
  return out;
}

/** A photo of the exports, read: its file, its id (`sha256:<hex>`), type and size. */
export interface ExportPhoto {
  file: string;
  id: string;
  mime: string;
  width?: number;
  height?: number;
}

/** A photo read from its file: its id, its type and its size; none if the file is not there. */
export function readPhoto(file: string, linked: Linked = { photo: file }): ExportPhoto | undefined {
  if (!fs.existsSync(file)) return undefined;
  const data = fs.readFileSync(file);
  const size = imageSize(data);
  const width = linked.width ?? size?.width;
  const height = linked.height ?? size?.height;
  return {
    file,
    id: mediaIdOf(data),
    mime: sniffMime(data) ?? 'application/octet-stream',
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

/**
 * The photos of the exports under `paths`, by `<chat>\n<id>`: `chatOf` names a chat as the replay
 * does from the title the export gives it. A photo whose file the export does not hold (an export
 * made without its photos) is left out.
 */
export function exportPhotos(
  paths: readonly string[],
  chatOf: (title: string) => string,
  log: (line: string) => void = () => undefined
): Map<string, ExportPhoto> {
  const out = new Map<string, ExportPhoto>();
  const add = (title: string | null | undefined, dir: string, linked: Map<string, Linked>) => {
    if (title === null || title === undefined) return;
    for (const [id, l] of linked) {
      const photo = readPhoto(path.join(dir, l.photo), l);
      if (photo !== undefined) out.set(`${chatOf(title)}\n${id}`, photo);
    }
  };
  for (const p of paths) {
    const { pages, json } = listInput(p, log);
    for (const exp of splitExports(pages)) {
      const linked = new Map<string, Linked>();
      for (const page of exp) for (const [id, l] of photosInHtml(page.html)) linked.set(id, l);
      if (linked.size === 0) continue;
      const title = readHtmlExport(exp).messages[0]?.chat;
      add(title, path.dirname((exp[0] as { label: string }).label), linked);
    }
    for (const file of json) {
      const linked = photosInJson(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (linked.size > 0) add(readJsonFile(file).messages[0]?.chat, path.dirname(file), linked);
    }
  }
  return out;
}
