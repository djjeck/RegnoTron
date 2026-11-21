import { mediaIdOf } from '@regnotron/game-bots/media.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportPhotos, photosInHtml, photosInJson, readPhoto } from './photos.ts';

// Invented exports (CLAUDE.md, "Test data is synthetic"): a chat titled "Il Gruppo Finto".
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20, 3]);
const message = (id: number, body: string) =>
  `<div class="message default clearfix" id="message${id}">
<div class="body">
<div class="pull_right date details" title="06.11.2026 13:00:0${id % 10} UTC+01:00">13:00</div>
<div class="from_name">LoreBot Finto</div>
${body}
<div class="text">WOOSH! Sei arrivato alla Stagione Il Bosco Inventato ⛅️ [B1]!</div>
</div>
</div>`;
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div class="page_wrap">
<div class="page_header"><div class="content"><div class="text bold">
Il Gruppo Finto
</div></div></div>
<div class="page_body chat_page"><div class="history">
${message(7, '<a class="photo_wrap clearfix pull_left" href="photos/photo_7%201.jpg"><img class="photo" src="photos/photo_7%201.jpg" style="width: 32px; height: 16px"></a>')}
${message(8, '')}
${message(9, '<a class="photo_wrap clearfix pull_left" href="photos/gone.jpg"></a>')}
</div></div></div></body></html>`;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the exports’ photos', () => {
  it('are found by the message they belong to, in an HTML page and in a JSON export', () => {
    expect([...photosInHtml(PAGE)]).toEqual([
      ['7', { photo: 'photos/photo_7 1.jpg' }],
      ['9', { photo: 'photos/gone.jpg' }],
    ]);
    expect([
      ...photosInJson({
        messages: [
          { id: 7, photo: 'photos/a.jpg', width: 32, height: 16 },
          { id: 8, text: 'none' },
          { id: 9, photo: 'photos/b.jpg' },
        ],
      }),
    ]).toEqual([
      ['7', { photo: 'photos/a.jpg', width: 32, height: 16 }],
      ['9', { photo: 'photos/b.jpg' }],
    ]);
    expect(photosInJson({})).toEqual(new Map());
    expect(photosInJson(null)).toEqual(new Map());
  });

  it('are read: their id, type and size; none for a file not there', () => {
    const file = path.join(dir, 'a.jpg');
    fs.writeFileSync(file, JPEG);
    expect(readPhoto(file)).toEqual({
      file,
      id: mediaIdOf(JPEG),
      mime: 'image/jpeg',
      width: 32,
      height: 16,
    });
    fs.writeFileSync(file, 'not a picture');
    expect(readPhoto(file, { photo: 'a.jpg', width: 3, height: 4 })).toMatchObject({
      mime: 'application/octet-stream',
      width: 3,
      height: 4,
    });
    expect(readPhoto(path.join(dir, 'none.jpg'))).toBeUndefined();
  });

  it('are keyed by chat, as the replay names it, and message id', () => {
    const html = path.join(dir, 'html');
    fs.mkdirSync(path.join(html, 'photos'), { recursive: true });
    fs.writeFileSync(path.join(html, 'messages.html'), PAGE);
    fs.writeFileSync(path.join(html, 'photos', 'photo_7 1.jpg'), JPEG);
    // An export with no photo: not read further.
    const bare = path.join(dir, 'bare');
    fs.mkdirSync(bare);
    fs.writeFileSync(path.join(bare, 'messages.html'), PAGE.replaceAll('photo_wrap', 'x'));
    const json = path.join(dir, 'json');
    fs.mkdirSync(path.join(json, 'photos'), { recursive: true });
    fs.writeFileSync(path.join(json, 'photos', 'b.jpg'), JPEG);
    fs.writeFileSync(
      path.join(json, 'result.json'),
      JSON.stringify({
        name: 'LoreBot Finto',
        type: 'bot_chat',
        id: 1,
        messages: [
          {
            id: 3,
            type: 'message',
            date: '2026-11-06T13:00:00',
            date_unixtime: '1793966400',
            from: 'LoreBot Finto',
            from_id: 'user1',
            text: 'Ti trovi nella stagione Il Bosco Inventato ⛅️ [B1]',
            text_entities: [],
            photo: 'photos/b.jpg',
            width: 640,
            height: 480,
          },
        ],
      })
    );
    const empty = path.join(dir, 'empty.json');
    fs.writeFileSync(empty, JSON.stringify({ name: 'X', messages: [] }));
    const photos = exportPhotos([html, bare, json, empty], (title) =>
      title === 'LoreBot Finto' ? '@LoreGameBot' : `chat ${title}`
    );
    expect([...photos.keys()]).toEqual(['chat Il Gruppo Finto\n7', '@LoreGameBot\n3']);
    expect(photos.get('@LoreGameBot\n3')).toMatchObject({ width: 640, height: 480 });
  });
});
