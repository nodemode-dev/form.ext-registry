import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { plan, cues, tileHeight, extFor, MAX_TILES } from '../../../extensions/scrub-thumbnails/src/sprite.ts';
import type { Settings, Plan } from '../../../extensions/scrub-thumbnails/src/sprite.ts';
import { stamp, clock, buildVtt, parseVtt, cueAt } from '../../../extensions/scrub-thumbnails/src/vtt.ts';
import type { Cue } from '../../../extensions/scrub-thumbnails/src/vtt.ts';
import { zip } from '../../../extensions/scrub-thumbnails/src/zip.ts';

const HD = { duration: 100, width: 1920, height: 1080 };

function settings(over: Partial<Settings> = {}): Settings {
  return { interval: 2, width: 160, cols: 5, rows: 5, type: 'image/jpeg', quality: 80, base: 'clip', prefix: '', ...over };
}

function made(s: Settings, src = HD): Plan {
  const p = plan(s, src);
  assert.equal(typeof p, 'object');
  return p as Plan;
}

test('thumbnail height follows a 16 by 9 picture', () => {
  assert.equal(tileHeight(settings({ width: 160 }), HD), 90);
});

test('thumbnail height follows a portrait picture and stays even', () => {
  assert.equal(tileHeight(settings({ width: 160 }), { duration: 10, width: 1080, height: 1920 }), 284);
});

test('thumbnail height follows a 4 by 3 and a square picture', () => {
  assert.equal(tileHeight(settings({ width: 160 }), { duration: 10, width: 640, height: 480 }), 120);
  assert.equal(tileHeight(settings({ width: 160 }), { duration: 10, width: 500, height: 500 }), 160);
});

test('thumbnail height falls back to 16 by 9 without a source and has a floor of 2', () => {
  assert.equal(tileHeight(settings({ width: 160 }), null), 90);
  assert.equal(tileHeight(settings({ width: 32 }), { duration: 10, width: 1000, height: 1 }), 2);
});

test('file type maps to the extension', () => {
  assert.equal(extFor('image/webp'), 'webp');
  assert.equal(extFor('image/jpeg'), 'jpg');
});

test('count is the duration over the interval rounded up', () => {
  assert.equal(made(settings({ interval: 3 }), { ...HD, duration: 10 }).count, 4);
  assert.equal(made(settings({ interval: 2 }), { ...HD, duration: 10 }).count, 5);
  assert.equal(made(settings({ interval: 0.5 }), { ...HD, duration: 7.25 }).count, 15);
});

test('a duration shorter than the interval gives one thumbnail', () => {
  const p = made(settings({ interval: 10 }), { ...HD, duration: 0.3 });
  assert.equal(p.count, 1);
  assert.equal(p.sheets.length, 1);
  assert.equal(p.sheets[0].count, 1);
  assert.equal(p.sheets[0].width, 160);
  assert.equal(p.sheets[0].height, 90);
});

test('zero or negative duration is refused with a message', () => {
  assert.equal(typeof plan(settings(), { ...HD, duration: 0 }), 'string');
  assert.equal(typeof plan(settings(), { ...HD, duration: -5 }), 'string');
  assert.equal(typeof plan(settings(), { ...HD, duration: NaN }), 'string');
});

test('settings out of range are refused with a message', () => {
  assert.equal(typeof plan(settings({ interval: 0.4 }), HD), 'string');
  assert.equal(typeof plan(settings({ interval: 601 }), HD), 'string');
  assert.equal(typeof plan(settings({ width: 31 }), HD), 'string');
  assert.equal(typeof plan(settings({ width: 641 }), HD), 'string');
  assert.equal(typeof plan(settings({ cols: 0 }), HD), 'string');
  assert.equal(typeof plan(settings({ cols: 51 }), HD), 'string');
  assert.equal(typeof plan(settings({ cols: 2.5 }), HD), 'string');
  assert.equal(typeof plan(settings({ rows: 0 }), HD), 'string');
  assert.equal(typeof plan(settings({ base: '' }), HD), 'string');
});

test('the edges of the allowed ranges are accepted', () => {
  assert.equal(typeof plan(settings({ interval: 0.5, width: 32, cols: 1, rows: 1 }), { ...HD, duration: 5 }), 'object');
  assert.equal(typeof plan(settings({ interval: 600, width: 640, cols: 12, rows: 1 }), HD), 'object');
});

test('more than 5000 thumbnails is refused and exactly 5000 is accepted', () => {
  assert.equal(MAX_TILES, 5000);
  assert.equal(typeof plan(settings({ interval: 1, cols: 50, rows: 50, width: 64 }), { ...HD, duration: 5001 }), 'string');
  const ok = plan(settings({ interval: 1, cols: 50, rows: 50, width: 64 }), { ...HD, duration: 5000 });
  assert.equal(typeof ok, 'object');
  assert.equal((ok as Plan).count, 5000);
});

test('a sheet wider or taller than 8192 pixels is refused', () => {
  assert.equal(typeof plan(settings({ cols: 50, width: 200 }), HD), 'string');
  assert.equal(typeof plan(settings({ rows: 50, width: 640 }), { ...HD, duration: 200, width: 100, height: 400 }), 'string');
});

test('a full sheet is followed by a new sheet with the next number', () => {
  const p = made(settings({ cols: 5, rows: 5 }));
  assert.equal(p.count, 50);
  assert.equal(p.sheets.length, 2);
  assert.deepEqual(p.sheets.map((x) => x.name), ['clip-1.jpg', 'clip-2.jpg']);
  assert.deepEqual(p.sheets.map((x) => x.first), [0, 25]);
  assert.deepEqual(p.sheets.map((x) => x.count), [25, 25]);
  assert.deepEqual(p.sheets.map((x) => [x.width, x.height]), [[800, 450], [800, 450]]);
});

test('one thumbnail past a full sheet opens a third sheet', () => {
  const p = made(settings({ cols: 5, rows: 5 }), { ...HD, duration: 102 });
  assert.equal(p.count, 51);
  assert.equal(p.sheets.length, 3);
  assert.deepEqual(p.sheets[2], { name: 'clip-3.jpg', first: 50, count: 1, width: 160, height: 90 });
});

test('a short last sheet is sized to the thumbnails it holds', () => {
  const p = made(settings({ cols: 4, rows: 3, interval: 2 }), { ...HD, duration: 61 });
  assert.equal(p.count, 31);
  assert.deepEqual(p.sheets.map((x) => x.count), [12, 12, 7]);
  assert.deepEqual(p.sheets[0], { name: 'clip-1.jpg', first: 0, count: 12, width: 640, height: 270 });
  assert.deepEqual(p.sheets[2], { name: 'clip-3.jpg', first: 24, count: 7, width: 640, height: 180 });
});

test('fewer thumbnails than columns make a narrow sheet', () => {
  const p = made(settings({ cols: 10, rows: 2, interval: 5 }), { ...HD, duration: 15 });
  assert.equal(p.count, 3);
  assert.equal(p.sheets[0].width, 480);
  assert.equal(p.sheets[0].height, 90);
});

test('webp type names the sheets with the webp extension', () => {
  const p = made(settings({ type: 'image/webp', base: 'night' }), { ...HD, duration: 4 });
  assert.equal(p.ext, 'webp');
  assert.equal(p.sheets[0].name, 'night-1.webp');
});

test('capture times step by the interval and stop just before the end', () => {
  assert.deepEqual(made(settings({ interval: 3 }), { ...HD, duration: 10 }).times, [0, 3, 6, 9]);
  const t = made(settings({ interval: 3 }), { ...HD, duration: 9.01 }).times;
  assert.equal(t.length, 4);
  assert.deepEqual(t.slice(0, 3), [0, 3, 6]);
  assert.ok(Math.abs(t[3] - 8.97) < 1e-9);
});

test('tile sizes are even and match the planned sheet cells', () => {
  const p = made(settings({ width: 161 }));
  assert.equal(p.tileW % 2, 0);
  assert.equal(p.tileH % 2, 0);
  assert.equal(p.tileW, 162);
});

test('thumbnail i sits at column i mod C and row floor(i / C) of its sheet', () => {
  const s = settings({ cols: 5, rows: 5 });
  const list = cues(made(s), s, 100);
  assert.equal(list.length, 50);
  assert.deepEqual([list[7].x, list[7].y, list[7].url], [320, 90, 'clip-1.jpg']);
  assert.deepEqual([list[24].x, list[24].y, list[24].url], [640, 360, 'clip-1.jpg']);
  assert.deepEqual([list[26].x, list[26].y, list[26].url], [160, 0, 'clip-2.jpg']);
  assert.deepEqual([list[0].w, list[0].h], [160, 90]);
});

test('thumbnails never overlap and stay inside their sheet', () => {
  const s = settings({ cols: 4, rows: 3 });
  const p = made(s, { ...HD, duration: 61 });
  const list = cues(p, s, 61);
  const dims = new Map(p.sheets.map((x) => [x.name, x]));
  for (const c of list) {
    const sh = dims.get(c.url)!;
    assert.ok(c.x >= 0 && c.y >= 0);
    assert.ok(c.x + c.w <= sh.width, `x overflow ${c.url} ${c.x}`);
    assert.ok(c.y + c.h <= sh.height, `y overflow ${c.url} ${c.y}`);
  }
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      if (list[a].url !== list[b].url) continue;
      const apart = list[a].x + list[a].w <= list[b].x || list[b].x + list[b].w <= list[a].x || list[a].y + list[a].h <= list[b].y || list[b].y + list[b].h <= list[a].y;
      assert.ok(apart, `thumbnails ${a} and ${b} overlap`);
    }
  }
});

test('cues are in order, touch end to start and cover the whole duration', () => {
  const s = settings({ interval: 3 });
  const list = cues(made(s, { ...HD, duration: 10 }), s, 10);
  assert.deepEqual(list.map((c) => [c.start, c.end]), [[0, 3], [3, 6], [6, 9], [9, 10]]);
});

test('cues for a sub second interval and fractional duration cover it exactly', () => {
  const s = settings({ interval: 0.5 });
  const list = cues(made(s, { ...HD, duration: 7.25 }), s, 7.25);
  assert.equal(list.length, 15);
  assert.equal(list[0].start, 0);
  assert.equal(list[14].start, 7);
  assert.equal(list[14].end, 7.25);
  for (let i = 1; i < list.length; i++) assert.equal(list[i].start, list[i - 1].end);
});

test('the sheet url prefix and renamed sheets are used in the cues', () => {
  const s = settings({ prefix: 'https://cdn.example.com/thumbs/' });
  const p = made(s);
  const plain = cues(p, s, 100);
  assert.equal(plain[0].url, 'https://cdn.example.com/thumbs/clip-1.jpg');
  assert.equal(plain[49].url, 'https://cdn.example.com/thumbs/clip-2.jpg');
  const renamed = cues(p, s, 100, ['a.jpg', 'b.jpg']);
  assert.equal(renamed[0].url, 'https://cdn.example.com/thumbs/a.jpg');
  assert.equal(renamed[30].url, 'https://cdn.example.com/thumbs/b.jpg');
});

test('stamp writes HH:MM:SS.mmm', () => {
  assert.equal(stamp(0), '00:00:00.000');
  assert.equal(stamp(3599.5), '00:59:59.500');
  assert.equal(stamp(3600), '01:00:00.000');
  assert.equal(stamp(3661.007), '01:01:01.007');
  assert.equal(stamp(36000), '10:00:00.000');
  assert.equal(stamp(1.5), '00:00:01.500');
});

test('stamp rounds to the millisecond and clamps negatives to zero', () => {
  assert.equal(stamp(0.0004), '00:00:00.000');
  assert.equal(stamp(1.9996), '00:00:02.000');
  assert.equal(stamp(59.9996), '00:01:00.000');
  assert.equal(stamp(-3), '00:00:00.000');
});

test('clock writes a short player time', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(59.9), '0:59');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(3661), '1:01:01');
  assert.equal(clock(-4), '0:00');
});

test('the track text starts with WEBVTT and has the exact cue layout', () => {
  const text = buildVtt([
    { start: 0, end: 2, url: 'clip-1.jpg', x: 0, y: 0, w: 160, h: 90 },
    { start: 2, end: 3.5, url: 'clip-1.jpg', x: 160, y: 0, w: 160, h: 90 },
  ]);
  assert.equal(text, 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nclip-1.jpg#xywh=0,0,160,90\n\n00:00:02.000 --> 00:00:03.500\nclip-1.jpg#xywh=160,0,160,90\n');
});

test('a whole planned track reads back with every cue matching the layout', () => {
  const s = settings({ cols: 5, rows: 5, prefix: 'p/' });
  const list = cues(made(s), s, 100);
  const text = buildVtt(list);
  assert.ok(text.startsWith('WEBVTT\n'));
  const back = parseVtt(text);
  assert.equal(back.length, 50);
  assert.deepEqual(back[7], { start: 14, end: 16, url: 'p/clip-1.jpg', x: 320, y: 90, w: 160, h: 90 });
  assert.deepEqual(back[26], { start: 52, end: 54, url: 'p/clip-2.jpg', x: 160, y: 0, w: 160, h: 90 });
  assert.equal(back[49].end, 100);
  for (let i = 1; i < back.length; i++) assert.equal(back[i].start, back[i - 1].end);
});

test('a track with no cues is just the header', () => {
  assert.equal(buildVtt([]), 'WEBVTT\n\n\n');
  assert.deepEqual(parseVtt('WEBVTT\n'), []);
});

test('parsing accepts CRLF, a byte order mark, a header note and cue settings', () => {
  const text = '﻿WEBVTT - thumbnails\r\n\r\n00:00:00.000 --> 00:00:02.000 align:start\r\ns.jpg#xywh=1,2,3,4\r\n';
  assert.deepEqual(parseVtt(text), [{ start: 0, end: 2, url: 's.jpg', x: 1, y: 2, w: 3, h: 4 }]);
});

test('parsing accepts times without an hour part', () => {
  const c = parseVtt('WEBVTT\n\n01:02.500 --> 01:04.000\ns.jpg#xywh=0,0,10,10\n');
  assert.equal(c[0].start, 62.5);
  assert.equal(c[0].end, 64);
});

test('parsing refuses text without the WEBVTT header', () => {
  assert.throws(() => parseVtt('00:00:00.000 --> 00:00:02.000\ns.jpg#xywh=0,0,1,1\n'), /WEBVTT/);
  assert.throws(() => parseVtt(''), /WEBVTT/);
  assert.throws(() => parseVtt('WEBVTTX\n'), /WEBVTT/);
});

test('parsing skips cues with bad times or no xywh and keeps the good ones', () => {
  const text = 'WEBVTT\n\nnope --> 00:00:02.000\na.jpg#xywh=0,0,1,1\n\n00:00:02.000 --> 00:00:04.000\nno-fragment.jpg\n\n00:00:04.000 --> 00:00:06.000\nb.jpg#xywh=x,0,1,1\n\n00:00:06.000 --> 00:00:08.000\nok.jpg#xywh=5,6,7,8\n';
  assert.deepEqual(parseVtt(text), [{ start: 6, end: 8, url: 'ok.jpg', x: 5, y: 6, w: 7, h: 8 }]);
});

const row: Cue[] = [0, 1, 2].map((i) => ({ start: i * 2, end: i * 2 + 2, url: 's.jpg', x: i * 10, y: 0, w: 10, h: 10 }));

test('the cue lookup finds the cue holding a time', () => {
  assert.equal(cueAt(row, 0), row[0]);
  assert.equal(cueAt(row, 1.99), row[0]);
  assert.equal(cueAt(row, 3), row[1]);
  assert.equal(cueAt(row, 5.5), row[2]);
});

test('a time on a cue boundary belongs to the later cue', () => {
  assert.equal(cueAt(row, 2), row[1]);
  assert.equal(cueAt(row, 4), row[2]);
});

test('the cue lookup gives the last cue past the end and nothing before the start or when empty', () => {
  assert.equal(cueAt(row, 6), row[2]);
  assert.equal(cueAt(row, 999), row[2]);
  assert.equal(cueAt(row, -0.1), null);
  assert.equal(cueAt([], 1), null);
});

const READER = [
  'import sys, zipfile, json, zlib',
  'z = zipfile.ZipFile(sys.argv[1])',
  'out = {"bad": z.testzip(), "entries": []}',
  'for i in z.infolist():',
  '    d = z.read(i.filename)',
  '    out["entries"].append({"name": i.filename, "size": i.file_size, "csize": i.compress_size, "crc": i.CRC, "method": i.compress_type, "flags": i.flag_bits, "hex": d.hex(), "zcrc": zlib.crc32(d)})',
  'print(json.dumps(out))',
].join('\n');

interface Read {
  bad: string | null;
  entries: { name: string; size: number; csize: number; crc: number; method: number; flags: number; hex: string; zcrc: number }[];
}

function withZip<T>(bytes: Uint8Array, fn: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'scrub-zip-'));
  try {
    const file = join(dir, 'out.zip');
    writeFileSync(file, bytes);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readBack(bytes: Uint8Array): Read {
  return withZip(bytes, (file) => JSON.parse(execFileSync('python3', ['-I', '-c', READER, file], { encoding: 'utf8' })) as Read);
}

function listing(bytes: Uint8Array): string {
  return withZip(bytes, (file) => execFileSync('python3', ['-I', '-m', 'zipfile', '-l', file], { encoding: 'utf8' }));
}

const utf = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('an independent reader lists the names and passes its integrity test', () => {
  const bytes = zip([
    { name: 'clip.vtt', data: utf('WEBVTT\n') },
    { name: 'clip-1.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
  ]);
  const text = listing(bytes);
  assert.match(text, /clip\.vtt/);
  assert.match(text, /clip-1\.jpg/);
  const r = readBack(bytes);
  assert.equal(r.bad, null);
  assert.deepEqual(r.entries.map((e) => e.name), ['clip.vtt', 'clip-1.jpg']);
  assert.deepEqual(r.entries.map((e) => e.size), [7, 4]);
});

test('stored sizes equal the real sizes and content is stored without compression', () => {
  const r = readBack(zip([{ name: 'a.txt', data: utf('hello') }]));
  assert.equal(r.entries[0].method, 0);
  assert.equal(r.entries[0].size, 5);
  assert.equal(r.entries[0].csize, 5);
  assert.equal(r.entries[0].hex, hex(utf('hello')));
});

test('checksums match the known CRC-32 values', () => {
  const r = readBack(zip([
    { name: 'nine.txt', data: utf('123456789') },
    { name: 'a.txt', data: utf('a') },
    { name: 'hello.txt', data: utf('hello') },
  ]));
  assert.equal(r.entries[0].crc, 0xcbf43926);
  assert.equal(r.entries[1].crc, 0xe8b7be43);
  assert.equal(r.entries[2].crc, 0x3610a686);
});

test('an empty file is stored with size 0 and checksum 0', () => {
  const r = readBack(zip([{ name: 'empty.txt', data: new Uint8Array(0) }, { name: 'after.txt', data: utf('x') }]));
  assert.equal(r.bad, null);
  assert.equal(r.entries[0].name, 'empty.txt');
  assert.equal(r.entries[0].size, 0);
  assert.equal(r.entries[0].crc, 0);
  assert.equal(r.entries[0].hex, '');
  assert.equal(r.entries[1].hex, '78');
});

test('a non-ASCII name is kept and flagged as UTF-8', () => {
  const name = 'vorschaubilder-über-日本.vtt';
  const bytes = zip([{ name, data: utf('WEBVTT\n') }]);
  const r = readBack(bytes);
  assert.equal(r.entries[0].name, name);
  assert.equal(r.entries[0].flags & 0x800, 0x800);
  assert.equal(r.bad, null);
});

test('binary data with every byte value and a large entry survive intact', () => {
  const all = new Uint8Array(256).map((_, i) => i);
  const big = new Uint8Array(200_000).map((_, i) => (i * 31 + 7) & 0xff);
  const r = readBack(zip([{ name: 'all.bin', data: all }, { name: 'big.bin', data: big }]));
  assert.equal(r.bad, null);
  assert.equal(r.entries[0].hex, hex(all));
  assert.equal(r.entries[1].size, 200_000);
  assert.equal(r.entries[1].hex, hex(big));
  assert.equal(r.entries[1].crc, r.entries[1].zcrc);
});

test('the end record carries the entry count, directory size and offset', () => {
  const bytes = zip([{ name: 'a.txt', data: new Uint8Array([1, 2, 3]) }, { name: 'b.bin', data: new Uint8Array([1, 2, 3, 4]) }]);
  assert.equal(bytes.length, 201);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(v.getUint32(201 - 22, true), 0x06054b50);
  assert.equal(v.getUint16(201 - 22 + 8, true), 2);
  assert.equal(v.getUint16(201 - 22 + 10, true), 2);
  assert.equal(v.getUint32(201 - 22 + 12, true), 102);
  assert.equal(v.getUint32(201 - 22 + 16, true), 77);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(38, true), 0x04034b50);
});

test('a zip with no entries is a bare end record that a reader opens', () => {
  const bytes = zip([]);
  assert.equal(bytes.length, 22);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x05, 0x06]);
  const r = readBack(bytes);
  assert.deepEqual(r.entries, []);
});
