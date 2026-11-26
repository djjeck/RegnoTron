/**
 * The pictures the game shows, as `loregame-state` keeps them (docs/game-bots.md §6.2): each
 * entity's list of media, newest last, each one's bytes in the state node's files (MegaBotTron1999's
 * bot-os.md D149), named by their content hash, never in its `state` document.
 *
 * A picture is fetched once, at its entity's first sight heard live, through the account's `photo`
 * action (D151): a place's from its creation card (a season's generator outcome), else an arrival
 * or a `/v`. Pure logic here: the schema of an entry, its id from its bytes, the file it is kept in,
 * whether an entity still wants a picture, and which parser event is a sight of which entity. The
 * fetching is the plugin's (src/plugins/loregame-state.ts).
 *
 * `media({ id })` answers the core's `MediaResult` (D153), as the account's `photo` does: a reader
 * cannot tell the state's files from the network.
 */
import { type BusEvent } from '@megabottron1999/core';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { GENERATED_EVENT, LOREGAME_PARSER, TRAVEL_EVENT } from '#src/plugins/loregame.ts';

/**
 * A picture fetched, as the state's reducer takes it: never published, the state hands it to its
 * reducer itself once the bytes are kept (src/plugins/loregame-state.ts), or as a seed gives it.
 */
export const MEDIA_EVENT = `${LOREGAME_PARSER}.media`;

/**
 * Where a picture was seen: a creation card (a season's or a story's generator outcome), an
 * arrival, a turn's answer, a `/v`; or the exports (tools/media-seed).
 */
export const MEDIA_VIA = ['creation', 'arrival', 'turn', 'v', 'export'] as const;
export type MediaVia = (typeof MEDIA_VIA)[number];

export const mediaSourceSchema = z.object({
  chat: z.string().describe('The chat of the message it was in'),
  message: z.string().describe("The message's id"),
  via: z.enum(MEDIA_VIA).describe('What the message was'),
  at: z.string().describe('When it was said (ISO)'),
});

/**
 * What a picture is: an `image` kept (its bytes in the files); `other`, a message the account's
 * `photo` found no photo in (another kind of media: a picture sent as a file, an animation), kept
 * with its source alone; `unknown`, not fetched (no `photo` edge, or the fetch failed).
 */
export const MEDIA_KINDS = ['image', 'other', 'unknown'] as const;

export const mediaEntrySchema = z.object({
  id: z
    .string()
    .nullable()
    .describe('sha256:<hex> of its bytes, which names its file; none: no bytes kept'),
  kind: z.enum(MEDIA_KINDS),
  mime: z.string().optional().describe("An image's media type"),
  width: z.number().optional(),
  height: z.number().optional(),
  source: mediaSourceSchema,
});
export type MediaEntry = z.infer<typeof mediaEntrySchema>;

const ID = /^sha256:([0-9a-f]{64})$/u;

/** A picture's id: the SHA-256 of its bytes, `sha256:<hex>`. */
export function mediaIdOf(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

/**
 * The file a picture's bytes are kept in, `sha256-<hex>` (a file's name takes no colon, D149); none
 * for what is not a picture's id.
 */
export function mediaFileOf(id: string): string | undefined {
  const m = ID.exec(id);
  return m === null ? undefined : `sha256-${m[1] as string}`;
}

/**
 * Whether an entity still wants its picture: none of its entries is an image, nor a message found
 * to hold another kind of media (those not fetched are tried again at its next sight).
 */
export function wantsPicture(media: readonly MediaEntry[]): boolean {
  return media.every((m) => m.kind === 'unknown');
}

/**
 * The list with `entry`, in the order they were seen, newest last (a seed's, older, before those
 * seen live): a picture that changes is a new entry, the old kept; the same picture seen again (the
 * image next to it in time is the same) changes nothing, nor does a message already recorded.
 */
export function withMedia(media: readonly MediaEntry[], entry: MediaEntry): MediaEntry[] {
  if (
    media.some(
      (m) =>
        m.id === entry.id &&
        m.source.chat === entry.source.chat &&
        m.source.message === entry.source.message
    )
  )
    return [...media];
  const at = media.findIndex((m) => m.source.at > entry.source.at);
  const i = at < 0 ? media.length : at;
  if (entry.id !== null) {
    const before = media.slice(0, i).findLast((m) => m.kind === 'image');
    const after = media.slice(i).find((m) => m.kind === 'image');
    if (before?.id === entry.id || after?.id === entry.id) return [...media];
  }
  return [...media.slice(0, i), entry, ...media.slice(i)];
}

/** An entity whose picture an event shows: a place, by its code. */
export interface Sight {
  entity: 'place';
  key: string;
  name: string;
  chat: string;
  message: string;
  via: MediaVia;
  at: string;
}

const travelSight = z.looseObject({
  chat: z.string(),
  kind: z.enum(['arrived', 'here', 'refused']),
  place: z.object({ name: z.string(), code: z.string() }),
  answer: z.string().nullable().optional(),
});
const generatedSight = z.looseObject({
  chat: z.string(),
  kind: z.string(),
  name: z.string().nullable(),
  code: z.string().nullable(),
  answer: z.string().nullable().optional(),
});

/**
 * The entity whose picture a parser event's message shows, and where: an arrival's and a `/v`'s
 * place (their answers are a photo of it), and a season made (its creation card). A turn's answer is
 * a photo of its story, or of the guardian met, not of its place [M]: the state keeps neither yet.
 */
export function sightOf(e: BusEvent): Sight | undefined {
  const at = new Date(e.t).toISOString();
  if (e.type === TRAVEL_EVENT) {
    const t = travelSight.safeParse(e);
    if (!t.success || t.data.kind === 'refused' || typeof t.data.answer !== 'string') return;
    const { chat, place, answer } = t.data;
    const via = t.data.kind === 'arrived' ? 'arrival' : 'v';
    return { entity: 'place', key: place.code, name: place.name, chat, message: answer, via, at };
  }
  if (e.type === GENERATED_EVENT) {
    const g = generatedSight.safeParse(e);
    if (!g.success || g.data.kind !== 'season' || typeof g.data.answer !== 'string') return;
    const { chat, name, code, answer } = g.data;
    if (name === null || code === null) return;
    return { entity: 'place', key: code, name, chat, message: answer, via: 'creation', at };
  }
  return undefined;
}

/** The reducer's event of a picture fetched (or not) for an entity (`MEDIA_EVENT`). */
export const mediaEventSchema = z.looseObject({
  entity: z.literal('place'),
  key: z.string(),
  name: z.string(),
  media: mediaEntrySchema,
});

/**
 * An image's size in pixels, read from its header: a JPEG's frame, a PNG's IHDR; none for another
 * kind, or a header not read.
 */
export function imageSize(data: Uint8Array): { width: number; height: number } | undefined {
  const u16 = (i: number): number => ((data[i] ?? 0) << 8) | (data[i + 1] ?? 0);
  const u32 = (i: number): number => u16(i) * 65536 + u16(i + 2);
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
    return data.length < 24 ? undefined : { width: u32(16), height: u32(20) };
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return undefined;
    const marker = data[i + 1] as number;
    // A start of frame (SOF0–SOF15, but the DHT, JPG and DAC markers): its height, then its width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { width: u16(i + 7), height: u16(i + 5) };
    i += 2 + u16(i + 2);
  }
  return undefined;
}
