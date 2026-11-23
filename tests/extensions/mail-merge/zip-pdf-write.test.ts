import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as zlib from 'node:zlib';
import { crc32, zip, type ZipEntry } from '../../../extensions/mail-merge/src/zip.ts';
import { readText, textString, widthOf, winAnsi } from '../../../extensions/mail-merge/src/pdf/font.ts';
import { RowEdit } from '../../../extensions/mail-merge/src/pdf/edit.ts';
import { writeCombined, writeSingle } from '../../../extensions/mail-merge/src/pdf/write.ts';
import { PdfDoc } from '../../../extensions/mail-merge/src/pdf/doc.ts';
import { readForm } from '../../../extensions/mail-merge/src/pdf/form.ts';
import {
  ByteWriter,
  PdfDict,
  PdfName,
  PdfRef,
  PdfStream,
  PdfString,
  type PdfValue,
  dict,
  name,
  nameText,
  numText,
  stringText,
  writeValue,
} from '../../../extensions/mail-merge/src/pdf/objects.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const bin = (b: Uint8Array) => Buffer.from(b).toString('latin1');

function referenceCrc(data: Uint8Array): number {
  const native = (zlib as unknown as { crc32?: (d: Uint8Array) => number }).crc32;
  if (native) return native(data) >>> 0;
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const PY_LIST = [
  'import zipfile, json, sys',
  'z = zipfile.ZipFile(sys.argv[1])',
  'bad = z.testzip()',
  'print(json.dumps({"bad": bad, "items": [[i.filename, i.file_size, i.compress_size, i.CRC, i.compress_type, list(i.date_time)] for i in z.infolist()]}))',
].join('\n');

type Listed = { bad: string | null; items: [string, number, number, number, number, number[]][] };

function withArchive<T>(bytes: Uint8Array, fn: (file: string, dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'mm-zip-'));
  try {
    const file = join(dir, 'a.zip');
    writeFileSync(file, bytes);
    return fn(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pythonList = (bytes: Uint8Array): Listed =>
  withArchive(bytes, (file) => JSON.parse(execFileSync('python3', ['-I', '-c', PY_LIST, file], { encoding: 'utf8' })) as Listed);

function pythonExtract(bytes: Uint8Array, names: string[]): Buffer[] {
  return withArchive(bytes, (file, dir) => {
    const out = join(dir, 'out');
    execFileSync('python3', ['-I', '-m', 'zipfile', '-e', file, out]);
    return names.map((n) => readFileSync(join(out, n)));
  });
}

type Parsed = { name: string; crc: number; size: number; packed: number; method: number; flags: number; data: Uint8Array; localName: string; localCrc: number; localSize: number };

function parseZip(b: Uint8Array): { count: number; entries: Parsed[]; cdOffset: number; cdSize: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const eocd = b.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  assert.equal(v.getUint16(eocd + 20, true), 0);
  const count = v.getUint16(eocd + 10, true);
  assert.equal(v.getUint16(eocd + 8, true), count);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  assert.equal(cdOffset + cdSize, eocd);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const entries: Parsed[] = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(at, true), 0x02014b50);
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const crc = v.getUint32(at + 16, true);
    const packed = v.getUint32(at + 20, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const entryName = dec.decode(b.subarray(at + 46, at + 46 + nameLen));
    assert.equal(v.getUint32(local, true), 0x04034b50);
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    entries.push({
      name: entryName,
      crc,
      size,
      packed,
      method,
      flags,
      data: b.subarray(start, start + packed),
      localName: dec.decode(b.subarray(local + 30, local + 30 + lNameLen)),
      localCrc: v.getUint32(local + 14, true),
      localSize: v.getUint32(local + 22, true),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(at, eocd);
  return { count, entries, cdOffset, cdSize };
}

function serial(v: PdfValue, ref: (r: PdfRef) => PdfRef | null = (r) => r): string {
  const w = new ByteWriter();
  writeValue(w, v, ref);
  return bin(w.done());
}

function buildPdf(bodies: string[], trailerExtra: string): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  bodies.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${bodies.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(out, 'latin1'));
}

const CONTENT = 'BT /F1 12 Tf (Hi) Tj ET';

const samplePdf = () =>
  buildPdf(
    [
      '<</Type /Catalog /Pages 2 0 R /Perms <</DocMDP 6 0 R>>>>',
      '<</Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792]>>',
      '<</Type /Page /Parent 2 0 R /Contents 4 0 R>>',
      `<</Length ${CONTENT.length}>>\nstream\n${CONTENT}\nendstream`,
      '<</Title (Hello \\(World\\)) /Producer (Old Maker)>>',
      '<</Type /Sig>>',
    ],
    '/Info 5 0 R',
  );

type Checked = { text: string; size: number; offsets: Map<number, number>; trailer: string; xref: number; body: (n: number) => string; root: number };

function checkPdf(bytes: Uint8Array): Checked {
  const text = bin(bytes);
  assert.match(text, /^%PDF-1\.\d\n/);
  const tail = /startxref\n(\d+)\n%%EOF\n?$/.exec(text);
  assert.ok(tail, 'file ends with startxref and EOF marker');
  const xref = Number(tail[1]);
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(xref, xref + 40));
  assert.ok(head, 'startxref points at the xref keyword');
  const size = Number(head[1]);
  let at = xref + head[0].length;
  const offsets = new Map<number, number>();
  for (let n = 0; n < size; n++) {
    const line = text.slice(at, at + 20);
    assert.match(line, /^\d{10} \d{5} [nf][ \r][\r\n]$/);
    if (n === 0) assert.equal(line.slice(0, 18), '0000000000 65535 f');
    else {
      assert.equal(line[17], 'n');
      const off = Number(line.slice(0, 10));
      assert.equal(text.slice(off, off + `${n} 0 obj\n`.length), `${n} 0 obj\n`);
      offsets.set(n, off);
    }
    at += 20;
  }
  assert.equal(text.slice(at, at + 8), 'trailer\n');
  const trailer = text.slice(at + 8, text.lastIndexOf('startxref'));
  const sizeEntry = /\/Size (\d+)/.exec(trailer);
  assert.ok(sizeEntry);
  assert.equal(Number(sizeEntry[1]), size);
  const rootEntry = /\/Root (\d+) 0 R/.exec(trailer);
  assert.ok(rootEntry);
  const root = Number(rootEntry[1]);
  assert.ok(offsets.has(root));
  const starts = [...text.matchAll(/(?:^|\n)(\d+) 0 obj\n/g)].length;
  assert.equal(starts, size - 1);
  const body = (n: number) => {
    const off = offsets.get(n)!;
    const end = text.indexOf('\nendobj\n', off);
    return text.slice(off + `${n} 0 obj\n`.length, end);
  };
  return { text, size, offsets, trailer, xref, body, root };
}

test('crc32 matches the published check value and an independent implementation', () => {
  assert.equal(crc32(utf8('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const blob = new Uint8Array(5000);
  for (let i = 0; i < blob.length; i++) blob[i] = (i * 31 + 7) & 0xff;
  assert.equal(crc32(blob), referenceCrc(blob));
});

test('an empty archive is a bare end record that python accepts', () => {
  const out = zip([]);
  assert.equal(out.length, 22);
  assert.deepEqual([...out.subarray(0, 4)], [0x50, 0x4b, 0x05, 0x06]);
  const parsed = parseZip(out);
  assert.equal(parsed.count, 0);
  assert.equal(parsed.cdOffset, 0);
  const listed = pythonList(out);
  assert.equal(listed.bad, null);
  assert.deepEqual(listed.items, []);
});

test('python lists names sizes and checksums of a small archive', () => {
  const entries: ZipEntry[] = [
    { name: 'a.txt', data: utf8('alpha') },
    { name: 'dir/b.bin', data: Uint8Array.from([0, 1, 2, 255, 254]) },
  ];
  const listed = pythonList(zip(entries));
  assert.equal(listed.bad, null);
  assert.deepEqual(listed.items.map((i) => i[0]), ['a.txt', 'dir/b.bin']);
  for (const [i, e] of entries.entries()) {
    assert.equal(listed.items[i][1], e.data.length);
    assert.equal(listed.items[i][2], e.data.length);
    assert.equal(listed.items[i][3], referenceCrc(e.data));
    assert.equal(listed.items[i][4], 0);
  }
});

test('python extracts the exact bytes including a nested path', () => {
  const big = new Uint8Array(70000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 13) & 0xff;
  const entries: ZipEntry[] = [
    { name: 'one.txt', data: utf8('first file\n') },
    { name: 'deep/er/two.bin', data: big },
  ];
  const got = pythonExtract(zip(entries), entries.map((e) => e.name));
  assert.ok(got[0].equals(Buffer.from(entries[0].data)));
  assert.ok(got[1].equals(Buffer.from(big)));
});

test('local headers and central directory agree when parsed by hand', () => {
  const entries: ZipEntry[] = [
    { name: 'x', data: utf8('xx') },
    { name: 'y/z.txt', data: utf8('the quick brown fox') },
    { name: 'last', data: Uint8Array.from([9]) },
  ];
  const parsed = parseZip(zip(entries));
  assert.equal(parsed.count, 3);
  for (const [i, e] of entries.entries()) {
    const p = parsed.entries[i];
    assert.equal(p.name, e.name);
    assert.equal(p.localName, e.name);
    assert.equal(p.method, 0);
    assert.equal(p.size, e.data.length);
    assert.equal(p.packed, e.data.length);
    assert.equal(p.localSize, e.data.length);
    assert.equal(p.crc, referenceCrc(e.data));
    assert.equal(p.localCrc, p.crc);
    assert.deepEqual([...p.data], [...e.data]);
  }
});

test('non ASCII names are stored as UTF-8 with the language flag and read back by python', () => {
  const names = ['Ärger über Öl.pdf', '日本語/ファイル.txt', 'emoji-\u{1F600}.bin'];
  const entries = names.map((n, i) => ({ name: n, data: utf8(`content ${i}`) }));
  const out = zip(entries);
  const parsed = parseZip(out);
  for (const [i, p] of parsed.entries.entries()) {
    assert.equal(p.name, names[i]);
    assert.equal(p.flags & 0x0800, 0x0800);
  }
  const listed = pythonList(out);
  assert.equal(listed.bad, null);
  assert.deepEqual(listed.items.map((i) => i[0]), names);
  const got = pythonExtract(out, names);
  assert.equal(got[1].toString('utf8'), 'content 1');
});

test('an empty file is stored with zero size and zero checksum', () => {
  const out = zip([
    { name: 'empty.txt', data: new Uint8Array(0) },
    { name: 'after.txt', data: utf8('after') },
  ]);
  const listed = pythonList(out);
  assert.equal(listed.bad, null);
  assert.deepEqual(listed.items[0].slice(0, 4), ['empty.txt', 0, 0, 0]);
  const got = pythonExtract(out, ['empty.txt', 'after.txt']);
  assert.equal(got[0].length, 0);
  assert.equal(got[1].toString(), 'after');
});

test('many files keep their order names and contents', () => {
  const entries: ZipEntry[] = [];
  for (let i = 0; i < 500; i++) entries.push({ name: `row-${String(i).padStart(4, '0')}.pdf`, data: utf8(`payload number ${i} `.repeat(i % 7)) });
  const out = zip(entries);
  const listed = pythonList(out);
  assert.equal(listed.bad, null);
  assert.equal(listed.items.length, 500);
  assert.deepEqual(listed.items.map((i) => i[0]), entries.map((e) => e.name));
  assert.deepEqual(listed.items.map((i) => i[3]), entries.map((e) => referenceCrc(e.data)));
  const parsed = parseZip(out);
  assert.deepEqual([...parsed.entries[499].data], [...entries[499].data]);
});

test('the given timestamp is stored as local DOS date and time', () => {
  const out = zip([{ name: 't', data: utf8('t') }], new Date(2024, 4, 17, 13, 45, 58));
  assert.deepEqual(pythonList(out).items[0][5], [2024, 5, 17, 13, 45, 58]);
});

test('a date before 1980 is clamped to a valid DOS year', () => {
  const out = zip([{ name: 't', data: utf8('t') }], new Date(1975, 0, 2, 3, 4, 6));
  assert.deepEqual(pythonList(out).items[0][5], [1980, 1, 2, 3, 4, 6]);
});

test('the same input and timestamp give identical bytes and inputs are not changed', () => {
  const data = utf8('stable');
  const copy = data.slice();
  const when = new Date(2020, 1, 2, 3, 4, 6);
  const a = zip([{ name: 'n', data }], when);
  const b = zip([{ name: 'n', data }], when);
  assert.deepEqual([...a], [...b]);
  assert.deepEqual([...data], [...copy]);
});

test('names escape delimiters whitespace and the number sign as two hex digits', () => {
  assert.equal(nameText('Type'), '/Type');
  assert.equal(nameText('A B'), '/A#20B');
  assert.equal(nameText('a#b'), '/a#23b');
  assert.equal(nameText('a/b'), '/a#2fb');
  assert.equal(nameText('(x)'), '/#28x#29');
  assert.equal(nameText('<[{%}]>'), '/#3c#5b#7b#25#7d#5d#3e');
  assert.equal(nameText('tab\there'), '/tab#09here');
  assert.equal(nameText(''), '/');
  assert.match(nameText('café \u0001'), /^\/[!-~]+$/);
});

test('names that differ only above Latin-1 serialise to different tokens', { todo: 'defect: nameText keeps only the low byte of a code point, so /€ and /¬ are written identically' }, () => {
  assert.notEqual(nameText('€'), nameText('¬'));
});

test('strings escape parentheses and backslashes and nothing else', () => {
  assert.equal(stringText(new PdfString(utf8('plain text'))), '(plain text)');
  assert.equal(stringText(new PdfString(utf8('a(b)c\\d'))), '(a\\(b\\)c\\\\d)');
  assert.equal(stringText(new PdfString(utf8(')('))), '(\\)\\()');
  assert.equal(stringText(new PdfString(new Uint8Array(0))), '()');
});

test('strings with bytes outside printable ASCII are written as hex', () => {
  assert.equal(stringText(new PdfString(Uint8Array.from([0xfe, 0xff, 0x00, 0x41, 0x0a]))), '<feff00410a>');
  assert.equal(stringText(new PdfString(utf8('AB'), true)), '<4142>');
  assert.equal(stringText(new PdfString(Uint8Array.from([65, 10, 66]))), '<410a42>');
});

test('numbers are written as plain decimals', () => {
  assert.equal(numText(0), '0');
  assert.equal(numText(-12), '-12');
  assert.equal(numText(1.5), '1.5');
  assert.equal(numText(0.1 + 0.2), '0.3');
  assert.equal(numText(-0.25), '-0.25');
  assert.equal(numText(123456789), '123456789');
  for (const n of [1e-7, -1e-9, 2.5e-5, 1e15, 123456.789, -0.00001, 4.00001]) assert.match(numText(n), /^-?\d+(\.\d+)?$/);
  assert.equal(numText(-1e-9), '0');
  assert.equal(numText(1e-7), '0');
});

test('very large numbers have no exponent', { todo: 'defect: numText(1e21) returns 1e+21, which is not a PDF number' }, () => {
  assert.match(numText(1e21), /^-?\d+(\.\d+)?$/);
  assert.match(numText(1.5e22), /^-?\d+(\.\d+)?$/);
});

test('scalars and references serialise to their PDF keywords', () => {
  assert.equal(serial(null), 'null');
  assert.equal(serial(true), 'true');
  assert.equal(serial(false), 'false');
  assert.equal(serial(new PdfRef(12, 3)), '12 3 R');
  assert.equal(serial(new PdfRef(12), () => null), 'null');
  assert.equal(serial(new PdfRef(12), () => new PdfRef(4)), '4 0 R');
});

test('dictionaries and arrays nest and escape their keys', () => {
  const v = dict({
    Type: name('Page'),
    'My Key': [1, 2.5, [true, null, new PdfString(utf8('s'))], dict({ K: new PdfRef(7) })],
    Empty: [],
    Sub: new PdfDict(),
  });
  assert.equal(serial(v), '<</Type /Page/My#20Key [1 2.5 [true null (s)] <</K 7 0 R>>]/Empty []/Sub <<>>>>');
});

test('a stream carries a Length equal to its data even when the dictionary says otherwise', () => {
  const data = Uint8Array.from([0, 255, 10, 13, 37, 62, 62]);
  const s = new PdfStream(dict({ Length: 999, Filter: name('X') }), data);
  const out = serial(s);
  const m = /^<<(.*)>>\nstream\n/s.exec(out);
  assert.ok(m);
  assert.deepEqual([.../\/Length (\d+)/g[Symbol.matchAll](m[1])].map((x) => Number(x[1])), [data.length]);
  assert.match(m[1], /\/Filter \/X/);
  const body = out.slice(m[0].length);
  assert.equal(body.slice(0, data.length), bin(data));
  assert.equal(body.slice(data.length), '\nendstream');
  assert.equal(s.dict.get('Length'), 999);
});

test('the byte writer reports its length across text and raw byte chunks', () => {
  const w = new ByteWriter();
  w.text('a'.repeat(70000));
  w.bytes(Uint8Array.from([1, 2, 3]));
  w.text('éz');
  assert.equal(w.length, 70005);
  const out = w.done();
  assert.equal(out.length, 70005);
  assert.equal(out[69999], 97);
  assert.deepEqual([...out.subarray(70000)], [1, 2, 3, 0xe9, 122]);
});

test('text strings are plain bytes for ASCII and UTF-16BE with a byte order mark otherwise', () => {
  const plain = textString('Hello (x)');
  assert.equal(plain.hex, false);
  assert.deepEqual([...plain.bytes], [...utf8('Hello (x)')]);
  const uni = textString('Zü€');
  assert.deepEqual([...uni.bytes], [0xfe, 0xff, 0x00, 0x5a, 0x00, 0xfc, 0x20, 0xac]);
  assert.equal(stringText(uni), '<feff005a00fc20ac>');
  const astral = textString('\u{1F600}');
  assert.deepEqual([...astral.bytes], [0xfe, 0xff, 0xd8, 0x3d, 0xde, 0x00]);
  assert.deepEqual([...textString('').bytes], []);
});

test('text strings read back to the same text', () => {
  for (const s of ['', 'plain', 'line\nbreak\ttab', 'Grüße € 日本 \u{1F600}', 'tilde~', 'del\u007f']) assert.equal(readText(textString(s)), s);
  assert.equal(readText(undefined), '');
  assert.equal(readText(new PdfString(Uint8Array.from([0xef, 0xbb, 0xbf, 0xc3, 0xa9]))), 'é');
  assert.equal(readText(new PdfString(Uint8Array.from([0x80, 0xa0, 0x41]))), '•€A');
});

test('WinAnsi encoding maps Windows-1252 characters and flags what it cannot encode', () => {
  assert.deepEqual(winAnsi('Aé'), { bytes: [65, 0xe9], lossy: false });
  assert.deepEqual(winAnsi('€—’™'), { bytes: [0x80, 0x97, 0x92, 0x99], lossy: false });
  assert.deepEqual(winAnsi('a\tb\nc'), { bytes: [97, 32, 98, 32, 99], lossy: false });
  assert.deepEqual(winAnsi('日x\u{1F600}'), { bytes: [63, 120, 63], lossy: true });
  const table = new TextDecoder('windows-1252');
  for (const ch of '‚ƒ„…†‡ˆ‰Š‹ŒŽ‘“”•–˜š›œžŸ') {
    const r = winAnsi(ch);
    assert.equal(r.lossy, false);
    assert.equal(table.decode(Uint8Array.from(r.bytes)), ch);
  }
});

test('Helvetica widths follow the standard metrics and scale with size', () => {
  assert.equal(widthOf([32], 1000), 278);
  assert.equal(widthOf([65], 1000), 667);
  assert.equal(widthOf([87], 1000), 944);
  assert.equal(widthOf([105], 1000), 222);
  assert.equal(widthOf([109], 1000), 833);
  assert.equal(widthOf([0x80], 1000), 556);
  assert.equal(widthOf([0xe9], 1000), 556);
  assert.equal(widthOf([], 12), 0);
  assert.ok(Math.abs(widthOf(winAnsi('Hello').bytes, 12) - (722 + 556 + 222 + 222 + 556) * 0.012) < 1e-9);
});

test('a row edit copies on write and never changes the loaded document', async () => {
  const doc = await PdfDoc.load(samplePdf());
  const edit = new RowEdit(doc);
  const page = edit.mut(3);
  page.set('Rotate', 90);
  assert.equal(edit.mut(3), page);
  assert.equal((doc.objects.get(3) as PdfDict).has('Rotate'), false);
  assert.equal((edit.raw(3) as PdfDict).get('Rotate'), 90);
  assert.equal((edit.dict(new PdfRef(3)) as PdfDict).get('Rotate'), 90);
  assert.equal(edit.raw(2), doc.objects.get(2));
  assert.equal(edit.raw(999), undefined);
  assert.equal(edit.dict(new PdfRef(4)), (doc.objects.get(4) as PdfStream).dict);
});

test('a row edit numbers new objects after the highest existing one and reuses one font', async () => {
  const doc = await PdfDoc.load(samplePdf());
  const edit = new RowEdit(doc);
  const a = edit.add(dict({ A: 1 }));
  const b = edit.add(new PdfRef(a.num));
  assert.equal(a.num, 7);
  assert.equal(b.num, 8);
  assert.equal((edit.get(b) as PdfDict).get('A'), 1);
  const f1 = edit.helvetica();
  const f2 = edit.helvetica();
  assert.equal(f1.num, 9);
  assert.equal(f2.num, f1.num);
  assert.equal(serial(edit.raw(f1.num) as PdfValue), '<</Type /Font/Subtype /Type1/BaseFont /Helvetica/Encoding /WinAnsiEncoding>>');
  const loop = edit.add(null);
  edit.extra.set(loop.num, new PdfRef(loop.num));
  assert.equal(edit.get(loop), undefined);
});

test('a written file has a cross reference table that points at every object', async () => {
  const doc = await PdfDoc.load(samplePdf());
  const out = writeSingle(doc, new RowEdit(doc));
  const pdf = checkPdf(out);
  assert.ok(pdf.size >= 6);
  assert.match(pdf.body(pdf.root), /\/Type \/Catalog/);
  assert.equal(pdf.text.slice(pdf.xref - 8, pdf.xref), '\nendobj\n');
  const refs = [...pdf.text.slice(0, pdf.xref).matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  for (const r of refs) assert.ok(pdf.offsets.has(r), `reference ${r} has an object`);
});

test('a written file sets the producer keeps the title and drops permissions', async () => {
  const doc = await PdfDoc.load(samplePdf());
  const pdf = checkPdf(writeSingle(doc, new RowEdit(doc)));
  const info = /\/Info (\d+) 0 R/.exec(pdf.trailer);
  assert.ok(info);
  const body = pdf.body(Number(info[1]));
  assert.match(body, /\/Producer \(formpdf Mail Merge\)/);
  assert.match(body, /\/Title \(Hello \\\(World\\\)\)/);
  assert.doesNotMatch(body, /Old Maker/);
  assert.doesNotMatch(pdf.body(pdf.root), /\/Perms/);
  assert.doesNotMatch(pdf.text, /\/Sig\b/);
});

test('a written file keeps the content stream bytes with a matching Length', async () => {
  const doc = await PdfDoc.load(samplePdf());
  const pdf = checkPdf(writeSingle(doc, new RowEdit(doc)));
  const m = /<<[^>]*\/Length (\d+)[^>]*>>\nstream\n/.exec(pdf.text);
  assert.ok(m);
  const start = m.index + m[0].length;
  assert.equal(Number(m[1]), CONTENT.length);
  assert.equal(pdf.text.slice(start, start + Number(m[1])), CONTENT);
  assert.equal(pdf.text.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream');
});

test('writing does not change the source bytes and the result loads again with the edit applied', async () => {
  const source = samplePdf();
  const before = source.slice();
  const doc = await PdfDoc.load(source);
  const edit = new RowEdit(doc);
  edit.mut(3).set('Rotate', 180);
  const fontRef = edit.helvetica();
  edit.mut(3).set('Resources', dict({ Font: dict({ F1: fontRef }) }));
  const out = writeSingle(doc, edit);
  assert.deepEqual([...source], [...before]);
  assert.deepEqual([...doc.bytes], [...before]);
  checkPdf(out);
  const again = await PdfDoc.load(out);
  const pages = again.pages();
  assert.equal(pages.length, 1);
  const page = again.dict(new PdfRef(pages[0]))!;
  assert.equal(page.get('Rotate'), 180);
  const font = again.dict(again.dict(again.dict(page.get('Resources'))!.get('Font'))!.get('F1'))!;
  assert.equal((font.get('BaseFont') as PdfName).name, 'Helvetica');
  assert.deepEqual([...(await again.decode(again.get(page.get('Contents')) as PdfStream))], [...utf8(CONTENT)]);
  assert.equal(readText(again.dict(again.trailer.get('Info'))!.get('Producer') as PdfString), 'formpdf Mail Merge');
});

test('a flattened edit removes the form dictionary and an unflattened one strips XFA', async () => {
  const withForm = () =>
    buildPdf(
      [
        '<</Type /Catalog /Pages 2 0 R /AcroForm <</Fields [] /XFA 4 0 R /SigFlags 3 /DA (/Helv 0 Tf 0 g)>>>>',
        '<</Type /Pages /Kids [3 0 R] /Count 1>>',
        '<</Type /Page /Parent 2 0 R /MediaBox [0 0 10 10]>>',
        '<</Length 3>>\nstream\nxfa\nendstream',
      ],
      '',
    );
  const doc = await PdfDoc.load(withForm());
  const keep = new RowEdit(doc);
  keep.needAppearances = true;
  const kept = checkPdf(writeSingle(doc, keep));
  const root = kept.body(kept.root);
  assert.match(root, /\/AcroForm <<[^>]*\/NeedAppearances true/);
  assert.match(root, /\/DA \(\/Helv 0 Tf 0 g\)/);
  assert.doesNotMatch(root, /XFA|SigFlags/);
  assert.doesNotMatch(kept.text, /stream\nxfa/);
  const doc2 = await PdfDoc.load(withForm());
  const flat = new RowEdit(doc2);
  flat.flattened = true;
  const flatPdf = checkPdf(writeSingle(doc2, flat));
  assert.doesNotMatch(flatPdf.body(flatPdf.root), /AcroForm/);
});

test('a combined file has one page per row shares untouched objects and stays well formed', async () => {
  const doc = await PdfDoc.load(samplePdf());
  const form = readForm(doc);
  const edits = [new RowEdit(doc), new RowEdit(doc), new RowEdit(doc)];
  const out = writeCombined(doc, form, edits, ['r1', 'r2', 'r3']);
  const pdf = checkPdf(out);
  assert.equal([...pdf.text.matchAll(/\nstream\n/g)].length, 1);
  assert.doesNotMatch(pdf.text, /-\d+ 0 R/);
  const again = await PdfDoc.load(out);
  const pages = again.pages();
  assert.equal(pages.length, 3);
  assert.equal(new Set(pages).size, 3);
  const pagesRef = again.root.get('Pages') as PdfRef;
  assert.equal(again.dict(pagesRef)!.get('Count'), 3);
  const contents = new Set<number>();
  for (const p of pages) {
    const page = again.dict(new PdfRef(p))!;
    assert.equal((page.get('Parent') as PdfRef).num, pagesRef.num);
    assert.deepEqual(again.array(page.get('MediaBox')), [0, 0, 612, 792]);
    contents.add((page.get('Contents') as PdfRef).num);
  }
  assert.equal(contents.size, 1);
  const info = again.dict(again.trailer.get('Info'))!;
  assert.equal(readText(info.get('Producer') as PdfString), 'formpdf Mail Merge');
  assert.equal(readText(info.get('Title') as PdfString), 'Hello (World)');
});
