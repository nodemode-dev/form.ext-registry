import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PdfDoc, Protected } from '../../../extensions/mail-merge/src/pdf/doc.ts';
import { PdfDict, PdfError, PdfName, PdfRef, PdfStream } from '../../../extensions/mail-merge/src/pdf/objects.ts';

const T = { timeout: 10000 };

type Row = { num: number; type: 0 | 1 | 2; a: number; b: number };

class Builder {
  private chunks: Buffer[] = [];
  private length = 0;
  readonly offsets = new Map<number, number>();
  private lastXref = 0;

  constructor(header = '%PDF-1.7\n') {
    this.raw(header);
  }

  get size(): number {
    return this.length;
  }

  raw(data: string | Buffer): this {
    const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    this.chunks.push(buf);
    this.length += buf.length;
    return this;
  }

  obj(num: number, body: string | Buffer): this {
    this.offsets.set(num, this.length);
    this.raw(`${num} 0 obj\n`);
    this.raw(body);
    return this.raw('\nendobj\n');
  }

  table(opts: { size: number; root?: number; inUse: number[]; free?: number[]; prev?: number; extra?: string; offsets?: Record<number, number> }): number {
    const at = this.length;
    this.lastXref = at;
    let out = 'xref\n0 1\n0000000000 65535 f \n';
    for (const n of opts.free ?? []) out += `${n} 1\n0000000000 00001 f \n`;
    for (const n of opts.inUse) {
      const off = opts.offsets?.[n] ?? this.offsets.get(n);
      if (off === undefined) throw new Error(`object ${n} was never written`);
      out += `${n} 1\n${String(off).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${opts.size}`;
    if (opts.root !== undefined) out += ` /Root ${opts.root} 0 R`;
    if (opts.prev !== undefined) out += ` /Prev ${opts.prev}`;
    if (opts.extra) out += ` ${opts.extra}`;
    out += ' >>\n';
    this.raw(out);
    return at;
  }

  xrefStream(num: number, rows: Row[], opts: { size: number; root: number; predictor?: boolean; extra?: string }): number {
    const at = this.length;
    this.lastXref = at;
    const all = [...rows, { num, type: 1 as const, a: at, b: 0 }].sort((x, y) => x.num - y.num);
    const index: number[] = [];
    const plain: Buffer[] = [];
    for (const r of all) {
      index.push(r.num, 1);
      const row = Buffer.alloc(7);
      row.writeUInt8(r.type, 0);
      row.writeUInt32BE(r.a, 1);
      row.writeUInt16BE(r.b, 5);
      plain.push(row);
    }
    let data = Buffer.concat(plain);
    let parms = '';
    if (opts.predictor) {
      const coded: Buffer[] = [];
      let prev = Buffer.alloc(7);
      for (const row of plain) {
        const line = Buffer.alloc(8);
        line[0] = 2;
        for (let i = 0; i < 7; i++) line[i + 1] = (row[i] - prev[i]) & 0xff;
        coded.push(line);
        prev = row;
      }
      data = Buffer.concat(coded);
      parms = ' /DecodeParms << /Predictor 12 /Columns 7 >>';
    }
    const packed = deflateSync(data);
    const head = `<< /Type /XRef /Size ${opts.size} /Root ${opts.root} 0 R /W [1 4 2] /Index [${index.join(' ')}] /Filter /FlateDecode${parms} ${opts.extra ?? ''} /Length ${packed.length} >>\nstream\n`;
    this.obj(num, Buffer.concat([Buffer.from(head, 'latin1'), packed, Buffer.from('\nendstream', 'latin1')]));
    this.offsets.set(num, at);
    return at;
  }

  end(startxref: number | null = this.lastXref): Uint8Array {
    if (startxref !== null) this.raw(`startxref\n${startxref}\n`);
    this.raw('%%EOF\n');
    return new Uint8Array(Buffer.concat(this.chunks));
  }
}

function streamBody(dictInner: string, data: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`<< ${dictInner} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);
}

function objectStream(members: Array<[number, string]>): Buffer {
  let head = '';
  let body = '';
  for (const [num, text] of members) {
    head += `${num} ${body.length} `;
    body += `${text}\n`;
  }
  const packed = deflateSync(Buffer.from(head + body, 'latin1'));
  return streamBody(`/Type /ObjStm /N ${members.length} /First ${head.length} /Filter /FlateDecode`, packed);
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';

function onePage(): Builder {
  return new Builder()
    .obj(1, CATALOG)
    .obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    .obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>');
}

function onePageFile(): Uint8Array {
  const b = onePage();
  b.table({ size: 4, root: 1, inUse: [1, 2, 3] });
  return b.end();
}

function nestedFile(): Uint8Array {
  const b = new Builder()
    .obj(1, CATALOG)
    .obj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 3 /MediaBox [0 0 200 300] /Rotate 90 >>')
    .obj(3, '<< /Type /Pages /Parent 2 0 R /Kids [5 0 R 6 0 R] /Count 2 /MediaBox [0 0 400 500] >>')
    .obj(4, '<< /Type /Page /Parent 2 0 R >>')
    .obj(5, '<< /Type /Page /Parent 3 0 R >>')
    .obj(6, '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 20] >>');
  b.table({ size: 7, root: 1, inUse: [1, 2, 3, 4, 5, 6] });
  return b.end();
}

async function refuses(bytes: Uint8Array): Promise<PdfError> {
  let caught: unknown;
  try {
    await PdfDoc.load(bytes);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof PdfError, `expected a PdfError, got ${String(caught)}`);
  return caught;
}

test('a one page file opens and gives the catalogue', T, async () => {
  const doc = await PdfDoc.load(onePageFile());
  assert.ok(doc.root instanceof PdfDict);
  const type = doc.root.get('Type');
  assert.ok(type instanceof PdfName);
  assert.equal(type.name, 'Catalog');
  const pages = doc.root.get('Pages');
  assert.ok(pages instanceof PdfRef);
  assert.equal(pages.num, 2);
});

test('a one page file has one page with its MediaBox', T, async () => {
  const doc = await PdfDoc.load(onePageFile());
  assert.deepEqual(doc.pages(), [3]);
  assert.deepEqual(doc.inherited(3, 'MediaBox'), [0, 0, 612, 792]);
});

test('the trailer size and highest object number are kept', T, async () => {
  const doc = await PdfDoc.load(onePageFile());
  assert.equal(doc.trailer.get('Size'), 4);
  assert.equal(doc.maxNum, 3);
  assert.deepEqual([...doc.objects.keys()].sort(), [1, 2, 3]);
});

test('junk before the header inside the first kilobyte is accepted', T, async () => {
  const b = new Builder('\n\n  junk bytes here\n%PDF-1.4\n').obj(1, CATALOG).obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>').obj(3, '<< /Type /Page /Parent 2 0 R >>');
  b.table({ size: 4, root: 1, inUse: [1, 2, 3] });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.pages(), [3]);
});

test('three pages in a nested tree come back in document order', T, async () => {
  const doc = await PdfDoc.load(nestedFile());
  assert.deepEqual(doc.pages(), [5, 6, 4]);
});

test('page attributes are inherited from the nearest ancestor', T, async () => {
  const doc = await PdfDoc.load(nestedFile());
  assert.deepEqual(doc.inherited(5, 'MediaBox'), [0, 0, 400, 500]);
  assert.deepEqual(doc.inherited(6, 'MediaBox'), [0, 0, 10, 20]);
  assert.deepEqual(doc.inherited(4, 'MediaBox'), [0, 0, 200, 300]);
  assert.equal(doc.inherited(5, 'Rotate'), 90);
  assert.equal(doc.inherited(5, 'CropBox'), undefined);
});

test('an incremental update makes the newer object win', T, async () => {
  const b = onePage();
  const first = b.table({ size: 4, root: 1, inUse: [1, 2, 3] });
  b.raw(`startxref\n${first}\n%%EOF\n`);
  b.obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>');
  b.obj(4, '<< /Note (added) >>');
  b.table({ size: 5, root: 1, inUse: [3, 4], prev: first });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.inherited(3, 'MediaBox'), [0, 0, 100, 100]);
  assert.deepEqual(doc.pages(), [3]);
  assert.ok(doc.get(new PdfRef(4)) instanceof PdfDict);
  assert.ok(doc.get(new PdfRef(2)) instanceof PdfDict);
  assert.equal(doc.trailer.get('Size'), 5);
  assert.equal(doc.maxNum, 4);
});

test('an object marked free in the table is not returned', T, async () => {
  const b = onePage().obj(4, '<< /Gone true >>');
  b.table({ size: 5, root: 1, inUse: [1, 2, 3], free: [4] });
  const doc = await PdfDoc.load(b.end());
  assert.equal(doc.objects.has(4), false);
  assert.equal(doc.dict(new PdfRef(4)), undefined);
});

test('an object freed by a later update is not returned', { ...T, todo: 'defect: a free entry in a newer classic xref section is ignored, so the older in-use entry still wins' }, async () => {
  const b = onePage().obj(4, '<< /Gone true >>');
  const first = b.table({ size: 5, root: 1, inUse: [1, 2, 3, 4] });
  b.raw(`startxref\n${first}\n%%EOF\n`);
  b.table({ size: 5, root: 1, inUse: [], free: [4], prev: first });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.pages(), [3]);
  assert.equal(doc.objects.has(4), false);
});

test('an object freed by a later cross-reference stream is not returned', T, async () => {
  const b = onePage().obj(4, '<< /Gone true >>');
  const first = b.table({ size: 5, root: 1, inUse: [1, 2, 3, 4] });
  b.raw(`startxref\n${first}\n%%EOF\n`);
  b.xrefStream(5, [{ num: 4, type: 0, a: 0, b: 1 }], { size: 6, root: 1, extra: `/Prev ${first}` });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.pages(), [3]);
  assert.equal(doc.objects.has(4), false);
});

function xrefStreamFile(predictor: boolean): Uint8Array {
  const b = onePage();
  const rows: Row[] = [{ num: 0, type: 0, a: 0, b: 65535 }];
  for (const n of [1, 2, 3]) rows.push({ num: n, type: 1, a: b.offsets.get(n)!, b: 0 });
  b.xrefStream(4, rows, { size: 5, root: 1, predictor });
  return b.end();
}

test('a compressed cross-reference stream is read', T, async () => {
  const doc = await PdfDoc.load(xrefStreamFile(false));
  assert.deepEqual(doc.pages(), [3]);
  assert.deepEqual(doc.inherited(3, 'MediaBox'), [0, 0, 612, 792]);
  assert.ok(doc.get(new PdfRef(4)) instanceof PdfStream);
  assert.equal(doc.trailer.get('Size'), 5);
});

test('a cross-reference stream with a PNG row predictor is read', T, async () => {
  const doc = await PdfDoc.load(xrefStreamFile(true));
  assert.deepEqual(doc.pages(), [3]);
  assert.deepEqual([...doc.objects.keys()].sort(), [1, 2, 3, 4]);
});

test('objects packed in an object stream are read', T, async () => {
  const b = new Builder().obj(1, CATALOG);
  b.obj(4, objectStream([
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'],
  ]));
  b.xrefStream(5, [
    { num: 0, type: 0, a: 0, b: 65535 },
    { num: 1, type: 1, a: b.offsets.get(1)!, b: 0 },
    { num: 2, type: 2, a: 4, b: 0 },
    { num: 3, type: 2, a: 4, b: 1 },
    { num: 4, type: 1, a: b.offsets.get(4)!, b: 0 },
  ], { size: 6, root: 1 });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.pages(), [3]);
  assert.deepEqual(doc.inherited(3, 'MediaBox'), [0, 0, 595, 842]);
  assert.equal(doc.number(doc.dict(new PdfRef(2))!.get('Count')), 1);
});

test('a stream whose length is an indirect object is read and decoded', T, async () => {
  const text = Buffer.from('BT (hello endstream trap) Tj ET', 'latin1');
  const packed = deflateSync(text);
  const b = onePage();
  b.obj(4, Buffer.concat([Buffer.from('<< /Filter /FlateDecode /Length 5 0 R >>\nstream\n', 'latin1'), packed, Buffer.from('\nendstream', 'latin1')]));
  b.obj(5, String(packed.length));
  b.table({ size: 6, root: 1, inUse: [1, 2, 3, 4, 5] });
  const doc = await PdfDoc.load(b.end());
  const s = doc.get(new PdfRef(4));
  assert.ok(s instanceof PdfStream);
  assert.equal(s.data.length, packed.length);
  assert.equal(Buffer.from(await doc.decode(s)).toString('latin1'), text.toString('latin1'));
});

test('a stream with an unsupported filter is refused when decoded', T, async () => {
  const b = onePage().obj(4, streamBody('/Filter /LZWDecode', Buffer.from('abc')));
  b.table({ size: 5, root: 1, inUse: [1, 2, 3, 4] });
  const doc = await PdfDoc.load(b.end());
  const s = doc.get(new PdfRef(4));
  assert.ok(s instanceof PdfStream);
  await assert.rejects(doc.decode(s), (err: unknown) => err instanceof PdfError && /LZWDecode/.test(err.message));
});

test('a reference to a missing object gives no dictionary, no array and no number', T, async () => {
  const doc = await PdfDoc.load(onePageFile());
  const missing = new PdfRef(99);
  assert.equal(doc.dict(missing), undefined);
  assert.deepEqual(doc.array(missing), []);
  assert.equal(doc.number(missing), null);
  assert.equal(doc.get(missing) ?? null, null);
});

test('a reference to a missing object resolves to null', { ...T, todo: 'defect: get() returns undefined for a missing object where the format defines the null object' }, async () => {
  const doc = await PdfDoc.load(onePageFile());
  assert.equal(doc.get(new PdfRef(99)), null);
});

test('references that point at each other resolve to nothing without hanging', T, async () => {
  const b = onePage().obj(4, '5 0 R').obj(5, '4 0 R').obj(6, '3 0 R');
  b.table({ size: 7, root: 1, inUse: [1, 2, 3, 4, 5, 6] });
  const doc = await PdfDoc.load(b.end());
  assert.equal(doc.get(new PdfRef(4)), undefined);
  assert.equal(doc.dict(new PdfRef(6)), doc.dict(new PdfRef(3)));
});

test('an encrypted file is refused with a clear error', T, async () => {
  const b = onePage().obj(4, '<< /Filter /Standard /V 1 /R 2 /P -44 >>');
  b.table({ size: 5, root: 1, inUse: [1, 2, 3, 4], extra: '/Encrypt 4 0 R' });
  const err = await refuses(b.end());
  assert.ok(err instanceof Protected);
  assert.match(err.message, /password/i);
});

test('a file without a PDF header is refused', T, async () => {
  const bytes = onePageFile();
  const err = await refuses(bytes.subarray(9));
  assert.match(err.message, /not a PDF/);
  await refuses(new Uint8Array(0));
  await refuses(new Uint8Array(Buffer.from('hello world, this is plain text\n')));
});

test('a header later than the first kilobyte is refused', T, async () => {
  const b = new Builder(' '.repeat(1024) + '%PDF-1.7\n').obj(1, CATALOG).obj(2, '<< /Type /Pages /Kids [] /Count 0 >>');
  b.table({ size: 3, root: 1, inUse: [1, 2] });
  await refuses(b.end());
});

test('a file with no startxref and no catalogue is refused', T, async () => {
  const b = new Builder().obj(1, '<< /Type /Pages /Kids [] /Count 0 >>');
  await refuses(b.end(null));
  await refuses(new Uint8Array(Buffer.from('%PDF-1.7\n%%EOF\n')));
});

test('a file with no startxref but intact objects is rebuilt by scanning', T, async () => {
  const b = onePage();
  const doc = await PdfDoc.load(b.end(null));
  assert.deepEqual(doc.pages(), [3]);
  assert.deepEqual(doc.inherited(3, 'MediaBox'), [0, 0, 612, 792]);
});

test('a startxref offset past the end of the file does not hang and the file is rebuilt', T, async () => {
  const b = onePage();
  b.table({ size: 4, root: 1, inUse: [1, 2, 3] });
  const doc = await PdfDoc.load(b.end(b.size + 100000));
  assert.deepEqual(doc.pages(), [3]);
});

test('a startxref offset past the end with nothing to rebuild from is refused', T, async () => {
  const b = new Builder().obj(1, '<< /Type /Pages /Kids [] /Count 0 >>');
  await refuses(b.end(999999));
});

test('a catalogue offset past the end of the file is refused', T, async () => {
  const b = onePage();
  b.table({ size: 4, root: 1, inUse: [1, 2, 3], offsets: { 1: 5000000 } });
  const err = await refuses(b.end());
  assert.match(err.message, /catalog/i);
});

test('a page offset past the end of the file leaves that page out', T, async () => {
  const b = onePage();
  b.table({ size: 4, root: 1, inUse: [1, 2, 3], offsets: { 3: 5000000 } });
  const doc = await PdfDoc.load(b.end());
  assert.equal(doc.objects.has(3), false);
  assert.deepEqual(doc.pages(), []);
});

test('a table entry that points at a different object number is not trusted', T, async () => {
  const b = onePage();
  b.table({ size: 4, root: 1, inUse: [1, 2, 3], offsets: { 3: b.offsets.get(2)! } });
  const doc = await PdfDoc.load(b.end());
  assert.equal(doc.objects.has(3), false);
});

test('a root that is not a dictionary is refused', T, async () => {
  const b = new Builder().obj(1, '[1 2 3]').obj(2, '<< /Type /Pages /Kids [] /Count 0 >>');
  b.table({ size: 3, root: 1, inUse: [1, 2] });
  const err = await refuses(b.end());
  assert.match(err.message, /catalog/i);
});

test('a page tree that loops ends and lists each page once', T, async () => {
  const b = new Builder()
    .obj(1, CATALOG)
    .obj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R 2 0 R] /Count 2 >>')
    .obj(3, '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R 5 0 R 3 0 R] /Count 1 >>')
    .obj(4, '<< /Type /Page /Parent 2 0 R >>')
    .obj(5, '<< /Type /Page /Parent 3 0 R >>');
  b.table({ size: 6, root: 1, inUse: [1, 2, 3, 4, 5] });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.pages(), [5, 4]);
});

test('a parent chain that loops ends when an inherited attribute is looked up', T, async () => {
  const b = new Builder()
    .obj(1, CATALOG)
    .obj(2, '<< /Type /Pages /Parent 3 0 R /Kids [4 0 R] /Count 1 >>')
    .obj(3, '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>')
    .obj(4, '<< /Type /Page /Parent 2 0 R >>');
  b.table({ size: 5, root: 1, inUse: [1, 2, 3, 4] });
  const doc = await PdfDoc.load(b.end());
  assert.equal(doc.inherited(4, 'MediaBox'), undefined);
  assert.deepEqual(doc.pages(), [4]);
});

test('a cross-reference chain whose Prev points at itself ends', T, async () => {
  const b = onePage();
  const at = b.size;
  b.table({ size: 4, root: 1, inUse: [1, 2, 3], prev: at });
  const doc = await PdfDoc.load(b.end());
  assert.deepEqual(doc.pages(), [3]);
});

test('a file cut off at any length either opens or raises the module error', T, async () => {
  for (const bytes of [onePageFile(), xrefStreamFile(false)]) {
    for (let cut = 0; cut < bytes.length; cut += 3) {
      let doc: PdfDoc | undefined;
      try {
        doc = await PdfDoc.load(bytes.slice(0, cut));
      } catch (err) {
        assert.ok(err instanceof PdfError, `cut at ${cut} raised ${String(err)}`);
      }
      if (doc) assert.ok(doc.pages().length <= 1, `cut at ${cut}`);
    }
  }
});

test('a file cut off before the catalogue is refused', T, async () => {
  const b = onePage();
  const cut = b.offsets.get(1)! + 12;
  b.table({ size: 4, root: 1, inUse: [1, 2, 3] });
  const err = await refuses(b.end().slice(0, cut));
  assert.match(err.message, /damaged|catalog/i);
});
