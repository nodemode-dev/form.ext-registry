import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { decodeText, parseCsv, parseRanges, type Table } from '../../../extensions/mail-merge/src/csv.ts';
import { fromHost, signature, type HostField } from '../../../extensions/mail-merge/src/template.ts';
import { autoMap, CLEAR, fileName, KEEP, rowCells, runJob, unknownTokens } from '../../../extensions/mail-merge/src/merge.ts';
import { PdfDoc } from '../../../extensions/mail-merge/src/pdf/doc.ts';
import { readForm } from '../../../extensions/mail-merge/src/pdf/form.ts';

const table = (columns: string[], rows: string[][]): Table => ({ columns, rows, delimiter: ',' });

function formPdf(): Uint8Array {
  const widget = (t: string, v: string, y: number, extra = '') =>
    `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${t}) /V (${v}) /Rect [50 ${y} 300 ${y + 20}] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g)${extra} >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R 6 0 R] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv 7 0 R >> >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [4 0 R 5 0 R 6 0 R] >>',
    widget('name', 'orig name', 700),
    widget('email', 'orig email', 650),
    widget('office', 'HQ', 600, ' /Ff 1'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

function unzip(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'end of central directory found');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out: { name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < count; k++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const n = v.getUint16(p + 28, true);
    const e = v.getUint16(p + 30, true);
    const c = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + n));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    out.push({ name, data: method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw });
    p += 46 + n + e + c;
  }
  return out;
}

async function valuesOf(bytes: Uint8Array): Promise<Record<string, string>> {
  const form = readForm(await PdfDoc.load(bytes));
  return Object.fromEntries(form.fields.map((f) => [f.name, f.value]));
}

async function job(rows: string[][], mapping: Record<string, string>, pattern: string, pick?: number[]) {
  const doc = await PdfDoc.load(formPdf());
  const form = readForm(doc);
  const t = table(['Name', 'Email', 'Office'], rows);
  return runJob(
    { doc, form, table: t, mapping, rows: pick ?? rows.map((_, i) => i), flatten: false, mode: 'zip', pattern, stem: 'loan' },
    () => {},
    new AbortController().signal,
  );
}

test('a plain comma file gives the header as columns and each later line as a row', () => {
  const t = parseCsv('name,city\nAnn,Oslo\nBob,Rome\n');
  assert.deepEqual(t.columns, ['name', 'city']);
  assert.deepEqual(t.rows, [['Ann', 'Oslo'], ['Bob', 'Rome']]);
  assert.equal(t.delimiter, ',');
});

test('a quoted field keeps its commas and loses its quotes', () => {
  const t = parseCsv('name,addr\n"Smith, J","1 Main St, Flat 2"\n');
  assert.deepEqual(t.rows, [['Smith, J', '1 Main St, Flat 2']]);
});

test('two double quotes inside a quoted field stand for one quote', () => {
  const t = parseCsv('id,quote\n1,"He said ""hi"" twice"\n2,""""\n');
  assert.deepEqual(t.rows, [['1', 'He said "hi" twice'], ['2', '"']]);
});

test('line breaks inside quotes stay in the field instead of starting a row', () => {
  const t = parseCsv('a,b\r\n"line one\nline two\r\nline three",x\r\ny,z\r\n');
  assert.deepEqual(t.rows, [['line one\nline two\r\nline three', 'x'], ['y', 'z']]);
});

test('CRLF, LF and a lone CR all end a record', () => {
  const expected = [['1', '2'], ['3', '4'], ['5', '6']];
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4\r\n5,6\r\n').rows, expected);
  assert.deepEqual(parseCsv('a,b\n1,2\n3,4\n5,6\n').rows, expected);
  assert.deepEqual(parseCsv('a,b\r1,2\r3,4\r5,6\r').rows, expected);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r3,4\n5,6').rows, expected);
});

test('a byte order mark is not part of the first column name', () => {
  const t = parseCsv('﻿Name,Age\nAnn,30\n');
  assert.deepEqual(t.columns, ['Name', 'Age']);
  assert.deepEqual(t.rows, [['Ann', '30']]);
});

test('a file with and without a final newline gives the same rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2').rows, [['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,2\n').rows, [['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n1,""').rows, [['1', '']]);
});

test('empty fields stay empty strings and blank lines are skipped', () => {
  const t = parseCsv('a,b,c\n1,,3\n\n,5,\n\r\n');
  assert.deepEqual(t.rows, [['1', '', '3'], ['', '5', '']]);
});

test('short rows are padded and long rows are cut to the header width', () => {
  const t = parseCsv('a,b,c\n1\n1,2,3,4,5\n');
  assert.deepEqual(t.rows, [['1', '', ''], ['1', '2', '3']]);
});

test('duplicate header names are numbered and empty ones are named by position', () => {
  const t = parseCsv('Name,Name,,Name\n1,2,3,4\n');
  assert.deepEqual(t.columns, ['Name', 'Name (2)', 'Column 3', 'Name (3)']);
});

test('renamed duplicate headers never collide with another header', { todo: 'defect: header "Name,Name (2),Name" gives two columns called "Name (2)", so mapping by name picks the first' }, () => {
  const t = parseCsv('Name,Name (2),Name\n1,2,3\n');
  assert.equal(new Set(t.columns).size, 3);
});

test('an unterminated quote runs to the end of the input without losing text', () => {
  const t = parseCsv('a,b\n"open,1\n2,3\n');
  assert.deepEqual(t.rows, [['open,1\n2,3\n', '']]);
});

test('a quote in the middle of an unquoted field is kept as text', () => {
  assert.deepEqual(parseCsv('a,b\n5" disk,x\n').rows, [['5" disk', 'x']]);
});

test('semicolon, tab and bar files are recognised and commas in them are data', () => {
  const s = parseCsv('name;amount\nAnn;1,5\nBob;2,0\n');
  assert.equal(s.delimiter, ';');
  assert.deepEqual(s.rows, [['Ann', '1,5'], ['Bob', '2,0']]);
  assert.equal(parseCsv('a\tb\n1\t2\n').delimiter, '\t');
  assert.deepEqual(parseCsv('a|b\n1|2\n').rows, [['1', '2']]);
});

test('an empty or blank input gives no columns and no rows', () => {
  assert.deepEqual(parseCsv('').columns, []);
  assert.deepEqual(parseCsv('\n\r\n  \n').rows, []);
});

test('bytes are decoded as UTF-16, UTF-8 or Windows-1252', () => {
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0xe9, 0x00])), 'a,é');
  assert.equal(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62])), 'ab');
  assert.equal(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9])), 'café');
  assert.equal(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80])), 'café €');
});

test('row ranges are one based, merged in order and without repeats', () => {
  assert.deepEqual(parseRanges('1-3, 5', 10), [0, 1, 2, 4]);
  assert.deepEqual(parseRanges('2-4 3-5', 10), [1, 2, 3, 4]);
  assert.deepEqual(parseRanges('8-', 10), [7, 8, 9]);
  assert.deepEqual(parseRanges('  ', 3), [0, 1, 2]);
});

test('bad row ranges give a message instead of rows', () => {
  assert.equal(typeof parseRanges('12', 10), 'string');
  assert.equal(typeof parseRanges('4-2', 10), 'string');
  assert.equal(typeof parseRanges('abc', 10), 'string');
  assert.equal(typeof parseRanges('0', 10), 'string');
});

test('host fields become one form field per name with every widget kept', () => {
  const items: HostField[] = [
    { name: 'agree', type: 'checkbox', page: 2, x: 1, y: 2, w: 10, h: 10, value: 'Off', on: 'Yes' },
    { name: 'name', type: 'text', page: 1, x: 5, y: 6, w: 100, h: 20, value: 'Ann', readonly: true },
    { name: 'name', type: 'text', page: 2, x: 7, y: 8, w: 100, h: 20 },
    { name: 'odd', type: 'mystery', page: 1, x: 0, y: 0, w: 1, h: 1 },
  ];
  const t = fromHost({ open: true, name: 'loan.pdf', pages: 1, info: { sizes: [{ w: 612, h: 792, rotate: 90 }] } }, items);
  assert.deepEqual(t.fields.map((f) => f.name), ['agree', 'name', 'odd']);
  assert.equal(t.pages.length, 2);
  assert.deepEqual(t.pages[0], { w: 792, h: 612 });
  assert.deepEqual(t.shapes.get('name')!.map((s) => s.page), [0, 1]);
  const agree = t.fields[0];
  assert.equal(agree.kind, 'checkbox');
  assert.equal(agree.value, '');
  assert.deepEqual(agree.options.map((o) => o.value), ['Yes']);
  assert.equal(t.fields[1].readOnly, true);
  assert.equal(t.fields[2].kind, 'text');
  assert.equal(signature(t), 'agree\nname\nodd');
});

test('columns are matched to fields by name as the readme describes', () => {
  const t = fromHost({ open: true }, [
    { name: 'borrower_name', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
    { name: 'borrower_email', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
    { name: 'notes', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
    { name: 'sig', type: 'signature', page: 1, x: 0, y: 0, w: 1, h: 1 },
  ]);
  const m = autoMap(t.fields, ['Borrower Name', 'Email', 'Phone']);
  assert.deepEqual(m, { borrower_name: 'Borrower Name', borrower_email: 'Email', notes: KEEP });
});

test('one column is never matched to two fields', () => {
  const t = fromHost({ open: true }, [
    { name: 'name', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
    { name: 'person.name', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
  ]);
  const m = autoMap(t.fields, ['Name']);
  assert.equal(Object.values(m).filter((c) => c === 'Name').length, 1);
});

test('row cells take the mapped column, keep, or clear, and ignore unknown field keys', () => {
  const t = fromHost({ open: true }, [
    { name: 'a', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
    { name: 'b', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
    { name: 'c', type: 'text', page: 1, x: 0, y: 0, w: 1, h: 1 },
  ]);
  const data = table(['X', 'Y'], [['x1', 'y1'], ['x2', 'y2']]);
  const cells = rowCells(t, data, { a: 'Y', b: KEEP, c: CLEAR, nosuchfield: 'X' }, 1);
  assert.deepEqual(cells.map((c) => [c.field.name, c.input]), [['a', 'y2'], ['b', null], ['c', '']]);
});

test('placeholders are filled from columns, any case, with row and file', () => {
  const data = table(['First', 'Last'], [['Ann', 'Lee'], ['Bob', 'Ray']]);
  assert.equal(fileName('{Last}, {first} {ROW} of {file}', data, 1, 'loan'), 'Ray, Bob 2 of loan');
});

test('a placeholder used twice is filled both times', () => {
  const data = table(['First'], [['Ann']]);
  assert.equal(fileName('{First}-{First}-{ First }', data, 0, 'loan'), 'Ann-Ann-Ann');
});

test('a value that contains braces is not expanded again', () => {
  const data = table(['Name', 'Other'], [['{row} {Other}', 'zzz']]);
  assert.equal(fileName('{Name}', data, 0, 'loan'), '{row} {Other}');
});

test('an empty value leaves no gap and an empty result falls back to file and row', () => {
  const data = table(['Name', 'City'], [['', 'Oslo'], ['  ', '']]);
  assert.equal(fileName('{Name} {City}', data, 0, 'loan'), 'Oslo');
  assert.equal(fileName('{Name}{City}', data, 1, 'loan'), 'loan 2');
});

test('unknown placeholders are reported once each and become empty in the name', () => {
  const data = table(['Name'], [['Ann']]);
  assert.deepEqual(unknownTokens('{Name} {Nmae} {row} {FILE} { City }', data), ['Nmae', 'City']);
  assert.equal(fileName('{Name} {Nmae}', data, 0, 'loan'), 'Ann');
});

test('a cleaned file name never starts with a dot', { todo: 'defect: "../../etc/passwd" gives ".. etc passwd" because the leading dots are cut before the spaces after them are trimmed' }, () => {
  const data = table(['Name'], [['../../etc/passwd'], ['...secret']]);
  assert.ok(!fileName('{Name}', data, 0, 'loan').startsWith('.'));
  assert.ok(!fileName('{Name}', data, 1, 'loan').startsWith('.'));
});

test('file names lose path separators and reserved characters and stay short', () => {
  const data = table(['Name'], [['../../etc/passwd'], ['a/b\\c:d*e?f"g<h>i|j\tk'], ['x'.repeat(400)]]);
  const one = fileName('{Name}', data, 0, 'loan');
  assert.ok(!/[/\\]/.test(one), one);
  assert.equal(fileName('{Name}', data, 1, 'loan'), 'a b c d e f g h i j k');
  const long = fileName('{Name}', data, 2, 'loan');
  assert.ok(long.length > 0 && long.length <= 255);
});

test('a zip job makes one pdf per row in row order with safe unique names', async () => {
  const rows = [['Ann', 'ann@x.org', 'Oslo'], ['ann', 'b@x.org', 'Rome'], ['Cy/Di', 'c@x.org', 'Lima'], ['Ann', 'd@x.org', 'Kiev']];
  const out = await job(rows, { name: 'Name', email: 'Email' }, '{Name}');
  assert.equal(out.type, 'application/zip');
  assert.equal(out.name, 'loan merged.zip');
  const entries = unzip(out.bytes);
  assert.deepEqual(entries.map((e) => e.name), ['Ann.pdf', 'ann (2).pdf', 'Cy Di.pdf', 'Ann (3).pdf']);
  const emails = [];
  for (const e of entries) emails.push((await valuesOf(e.data)).email);
  assert.deepEqual(emails, ['ann@x.org', 'b@x.org', 'c@x.org', 'd@x.org']);
});

test('read only fields keep their value even when a column is mapped to them', async () => {
  const out = await job([['Ann', 'a@x.org', 'Branch']], { name: 'Name', email: KEEP, office: 'Office' }, '{Name}');
  assert.equal(out.type, 'application/pdf');
  assert.equal(out.name, 'Ann.pdf');
  assert.deepEqual(await valuesOf(out.bytes), { name: 'Ann', email: 'orig email', office: 'HQ' });
});

test('a mapping key that names no field is silently ignored', async () => {
  const out = await job([['Ann', 'a@x.org', 'X']], { name: 'Name', missing_field: 'Email' }, '{Name}');
  assert.deepEqual(await valuesOf(out.bytes), { name: 'Ann', email: 'orig email', office: 'HQ' });
  assert.equal(out.problems, 0);
});

test('only the picked rows are made, in the picked order', async () => {
  const rows = [['Ann', '', ''], ['Bob', '', ''], ['Cy', '', '']];
  const out = await job(rows, { name: 'Name' }, '{row} {Name}', [2, 0]);
  assert.deepEqual(unzip(out.bytes).map((e) => e.name), ['3 Cy.pdf', '1 Ann.pdf']);
});

test('zero rows give an empty archive and no problems', async () => {
  const out = await job([], { name: 'Name' }, '{Name}');
  assert.equal(out.problems, 0);
  assert.deepEqual(unzip(out.bytes), []);
});
