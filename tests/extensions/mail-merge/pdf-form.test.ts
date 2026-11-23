import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PdfDoc } from '../../../extensions/mail-merge/src/pdf/doc.ts';
import { RowEdit } from '../../../extensions/mail-merge/src/pdf/edit.ts';
import { type Field, type FormInfo, check, fillable, flatten, readForm, setValue } from '../../../extensions/mail-merge/src/pdf/form.ts';
import { PdfDict, PdfName, PdfRef, PdfStream, PdfString, latin1 } from '../../../extensions/mail-merge/src/pdf/objects.ts';
import { writeSingle } from '../../../extensions/mail-merge/src/pdf/write.ts';
import { buildRow } from '../../../extensions/mail-merge/src/merge.ts';

function buildPdf(bodies: string[], root = 1): Uint8Array {
  let out = '%PDF-1.7\n';
  const offsets: number[] = [];
  bodies.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${bodies.length + 1} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes;
}

const stream = (dict: string, data: string) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
const xobject = (data: string) => stream('/Type /XObject /Subtype /Form /BBox [0 0 12 12]', data);
const widget = (rect: string) => `/Type /Annot /Subtype /Widget /P 4 0 R /Rect [${rect}]`;

function formPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R /AcroForm 3 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Fields [5 0 R 6 0 R 7 0 R 10 0 R 12 0 R 13 0 R 14 0 R 15 0 R 18 0 R] /DA (/Helv 10 Tf 0 g) >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [5 0 R 6 0 R 8 0 R 9 0 R 11 0 R 12 0 R 13 0 R 14 0 R 15 0 R 18 0 R] >>',
    `<< ${widget('50 700 250 720')} /FT /Tx /T (name) /V (Ada) >>`,
    `<< ${widget('50 670 62 682')} /FT /Btn /T (agree) /V /Off /AS /Off /AP << /N << /Yes 16 0 R /Off 17 0 R >> >> >>`,
    '<< /FT /Btn /Ff 32768 /T (color) /V /Red /Kids [8 0 R 9 0 R] >>',
    `<< ${widget('50 640 62 652')} /Parent 7 0 R /AS /Red /AP << /N << /Red 16 0 R /Off 17 0 R >> >> >>`,
    `<< ${widget('80 640 92 652')} /Parent 7 0 R /AS /Off /AP << /N << /Blue 16 0 R /Off 17 0 R >> >> >>`,
    '<< /T (person) /FT /Tx /Kids [11 0 R] >>',
    `<< ${widget('50 610 250 630')} /Parent 10 0 R /T (first) /V (Grace) >>`,
    `<< ${widget('50 580 250 600')} /FT /Tx /Ff 1 /T (locked) /V (fixed) >>`,
    `<< ${widget('50 550 250 570')} /FT /Sig /T (sig) >>`,
    `<< ${widget('50 520 250 540')} /FT /Ch /Ff 131072 /T (size) /V (S) /Opt [(S) (M) [(L) (Large)]] >>`,
    `<< ${widget('50 490 62 502')} /FT /Btn /T (news) /AS /Off /AP << /N << /Off 17 0 R /Subscribed 16 0 R >> >> >>`,
    xobject('0 0 12 12 re f'),
    xobject('0 0 12 12 re S'),
    `<< ${widget('50 400 250 470')} /FT /Ch /T (pick) /Opt [(a) (b) (c)] >>`,
  ]);
}

function plainPdf(): Uint8Array {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>',
  ]);
}

interface Opened {
  doc: PdfDoc;
  form: FormInfo;
}

async function open(bytes: Uint8Array): Promise<Opened> {
  const doc = await PdfDoc.load(bytes);
  return { doc, form: readForm(doc) };
}

function field(form: FormInfo, fieldName: string): Field {
  const f = form.fields.find((x) => x.name === fieldName);
  assert.ok(f, `field ${fieldName} is listed`);
  return f;
}

async function fill(values: Array<[string, string]>, bytes = formPdf()): Promise<Opened & { problems: string[]; saved: Uint8Array }> {
  const { doc, form } = await open(bytes);
  const edit = new RowEdit(doc);
  const problems = values.map(([n, v]) => setValue(edit, field(form, n), v));
  const saved = writeSingle(doc, edit);
  return { ...(await open(saved)), problems, saved };
}

const nameOf = (v: unknown) => (v instanceof PdfName ? v.name : null);

function appearanceText(o: Opened, fieldName: string): string {
  const f = field(o.form, fieldName);
  const wd = o.doc.dict(new PdfRef(f.widgets[0].num));
  const n = o.doc.get(o.doc.dict(wd?.get('AP'))?.get('N'));
  assert.ok(n instanceof PdfStream, 'the widget has a normal appearance stream');
  return latin1(n.data);
}

const hexOf = (s: string) => '<' + [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>';

test('lists every field with its full name in form order', async () => {
  const { form } = await open(formPdf());
  assert.equal(form.hasForm, true);
  assert.deepEqual(form.fields.map((f) => f.name), ['name', 'agree', 'color', 'person.first', 'locked', 'sig', 'size', 'news', 'pick']);
});

test('reports the type of each field', async () => {
  const { form } = await open(formPdf());
  assert.deepEqual(form.fields.map((f) => f.kind), ['text', 'checkbox', 'radio', 'text', 'text', 'signature', 'combo', 'checkbox', 'list']);
});

test('reports the current value of each field', async () => {
  const { form } = await open(formPdf());
  assert.deepEqual(form.fields.map((f) => f.value), ['Ada', '', 'Red', 'Grace', 'fixed', '', 'S', '', '']);
});

test('a field under a parent gets the dotted name and the inherited type', async () => {
  const { form } = await open(formPdf());
  const f = field(form, 'person.first');
  assert.equal(f.kind, 'text');
  assert.equal(f.num, 11);
  assert.equal(form.fields.some((x) => x.name === 'person'), false);
  assert.deepEqual(form.topFields, [5, 6, 7, 10, 12, 13, 14, 15, 18]);
});

test('marks only the read-only field as read-only', async () => {
  const { form } = await open(formPdf());
  assert.deepEqual(form.fields.filter((f) => f.readOnly).map((f) => f.name), ['locked']);
});

test('signature fields are not fillable and the others are', async () => {
  const { form } = await open(formPdf());
  assert.deepEqual(form.fields.filter((f) => !fillable(f)).map((f) => f.name), ['sig']);
});

test('widgets carry their page, rectangle and on state', async () => {
  const { form } = await open(formPdf());
  assert.deepEqual(field(form, 'name').widgets, [{ num: 5, page: 0, rect: [50, 700, 250, 720], on: null }]);
  assert.deepEqual(field(form, 'agree').widgets.map((w) => w.on), ['Yes']);
  assert.deepEqual(field(form, 'news').widgets.map((w) => w.on), ['Subscribed']);
  assert.deepEqual(field(form, 'color').widgets.map((w) => [w.num, w.on]), [[8, 'Red'], [9, 'Blue']]);
  assert.deepEqual(form.pages, [{ num: 4, x: 0, y: 0, width: 612, height: 792 }]);
});

test('choice fields list their options with export values and labels', async () => {
  const { form } = await open(formPdf());
  assert.deepEqual(field(form, 'size').options, [{ value: 'S', label: 'S' }, { value: 'M', label: 'M' }, { value: 'L', label: 'Large' }]);
  assert.deepEqual(field(form, 'color').options.map((o) => o.value), ['Red', 'Blue']);
});

test('a file with no form gives an empty field list', async () => {
  const { form } = await open(plainPdf());
  assert.equal(form.hasForm, false);
  assert.deepEqual(form.fields, []);
  assert.deepEqual(form.topFields, []);
  assert.deepEqual(form.pages, [{ num: 3, x: 0, y: 0, width: 300, height: 400 }]);
});

test('a filled text field holds the new value after save and reopen', async () => {
  const o = await fill([['name', 'Katherine']]);
  assert.deepEqual(o.problems, ['']);
  const f = field(o.form, 'name');
  assert.equal(f.value, 'Katherine');
  const v = o.doc.dict(new PdfRef(f.num))?.get('V');
  assert.ok(v instanceof PdfString);
  assert.equal(latin1(v.bytes), 'Katherine');
  assert.equal(field(o.form, 'person.first').value, 'Grace');
  assert.equal(o.form.fields.length, 9);
});

test('a filled text field gets an appearance stream that draws the text', async () => {
  const o = await fill([['name', 'Katherine']]);
  const ap = appearanceText(o, 'name');
  assert.ok(ap.includes(`${hexOf('Katherine')} Tj`), ap);
  assert.ok(ap.includes('/Tx BMC'));
  assert.ok(ap.includes('/FMHelv 10 Tf'));
  const f = field(o.form, 'name');
  const n = o.doc.get(o.doc.dict(o.doc.dict(new PdfRef(f.widgets[0].num))?.get('AP'))?.get('N')) as PdfStream;
  assert.deepEqual(o.doc.array(n.dict.get('BBox')), [0, 0, 200, 20]);
  const font = o.doc.dict(o.doc.dict(o.doc.dict(n.dict.get('Resources'))?.get('Font'))?.get('FMHelv'));
  assert.equal(nameOf(font?.get('BaseFont')), 'Helvetica');
  assert.equal(o.doc.dict(o.doc.root.get('AcroForm'))?.has('NeedAppearances'), false);
});

test('parentheses and backslashes survive the round trip', async () => {
  const text = 'a (b) \\ c) ((d \\\\';
  const o = await fill([['name', text]]);
  assert.equal(field(o.form, 'name').value, text);
  assert.ok(appearanceText(o, 'name').includes(hexOf(text)));
});

test('Latin-1 accents survive the round trip without asking viewers to redraw', async () => {
  const text = 'Zoë François';
  const o = await fill([['name', text]]);
  assert.deepEqual(o.problems, ['']);
  assert.equal(field(o.form, 'name').value, text);
  assert.ok(appearanceText(o, 'name').includes(hexOf(text)));
  assert.equal(o.doc.dict(o.doc.root.get('AcroForm'))?.has('NeedAppearances'), false);
});

test('text outside Latin-1 survives the round trip and sets NeedAppearances', async () => {
  const text = '日本語 (Ж) \\ €';
  const o = await fill([['name', text]]);
  assert.match(o.problems[0], /cannot draw/);
  assert.equal(field(o.form, 'name').value, text);
  assert.equal(o.doc.dict(o.doc.root.get('AcroForm'))?.get('NeedAppearances'), true);
});

test('a multi-line value keeps its line breaks in the stored value', async () => {
  const text = 'line one\nline two\ttabbed';
  const o = await fill([['person.first', text]]);
  assert.equal(field(o.form, 'person.first').value, text);
  assert.equal(field(o.form, 'name').value, 'Ada');
});

test('a check box takes its Yes state and its appearance state follows', async () => {
  const o = await fill([['agree', 'yes']]);
  assert.deepEqual(o.problems, ['']);
  const f = field(o.form, 'agree');
  const d = o.doc.dict(new PdfRef(f.num));
  assert.equal(nameOf(d?.get('V')), 'Yes');
  assert.equal(nameOf(d?.get('AS')), 'Yes');
  assert.equal(f.value, 'Yes');
});

test('a check box with its own on state name takes that name', async () => {
  const o = await fill([['news', 'x']]);
  const d = o.doc.dict(new PdfRef(field(o.form, 'news').num));
  assert.equal(nameOf(d?.get('V')), 'Subscribed');
  assert.equal(nameOf(d?.get('AS')), 'Subscribed');
  const n = o.doc.dict(o.doc.dict(d?.get('AP'))?.get('N'));
  assert.deepEqual([...(n?.map.keys() ?? [])].sort(), ['Off', 'Subscribed']);
});

test('a checked box is switched off by no', async () => {
  const first = await fill([['agree', 'TRUE']]);
  const o = await fill([['agree', ' No ']], first.saved);
  const d = o.doc.dict(new PdfRef(field(o.form, 'agree').num));
  assert.equal(nameOf(d?.get('V')), 'Off');
  assert.equal(nameOf(d?.get('AS')), 'Off');
  assert.equal(field(o.form, 'agree').value, '');
});

test('a check box value that is not yes or no is reported and left unchecked', async () => {
  const o = await fill([['agree', 'maybe']]);
  assert.match(o.problems[0], /"maybe" is not yes or no/);
  const d = o.doc.dict(new PdfRef(field(o.form, 'agree').num));
  assert.equal(nameOf(d?.get('V')), 'Off');
  assert.equal(nameOf(d?.get('AS')), 'Off');
});

test('a radio group selects one kid and switches the other off', async () => {
  const o = await fill([['color', 'blue']]);
  assert.deepEqual(o.problems, ['']);
  const f = field(o.form, 'color');
  assert.equal(nameOf(o.doc.dict(new PdfRef(f.num))?.get('V')), 'Blue');
  const states = f.widgets.map((w) => [w.on, nameOf(o.doc.dict(new PdfRef(w.num))?.get('AS'))]);
  assert.deepEqual(states, [['Red', 'Off'], ['Blue', 'Blue']]);
  assert.equal(f.value, 'Blue');
});

test('an empty radio value clears the group', async () => {
  const o = await fill([['color', '  ']]);
  const f = field(o.form, 'color');
  assert.equal(nameOf(o.doc.dict(new PdfRef(f.num))?.get('V')), 'Off');
  assert.deepEqual(f.widgets.map((w) => nameOf(o.doc.dict(new PdfRef(w.num))?.get('AS'))), ['Off', 'Off']);
  assert.equal(f.value, '');
});

test('a radio value that is not a choice is reported with the choices', async () => {
  const { form } = await open(formPdf());
  const c = check(field(form, 'color'), 'Green');
  assert.equal(c.value, '');
  assert.equal(c.problem, '"Green" is not one of Red, Blue');
});

test('a drop-down takes a label and stores the export value', async () => {
  const o = await fill([['size', 'large']]);
  assert.deepEqual(o.problems, ['']);
  const f = field(o.form, 'size');
  assert.equal(f.value, 'L');
  assert.ok(appearanceText(o, 'size').includes(`${hexOf('Large')} Tj`));
});

test('a list field stores the choice and its index and draws every option', async () => {
  const o = await fill([['pick', 'b']]);
  const f = field(o.form, 'pick');
  assert.equal(f.value, 'b');
  assert.deepEqual(o.doc.array(o.doc.dict(new PdfRef(f.num))?.get('I')), [1]);
  const ap = appearanceText(o, 'pick');
  for (const label of ['a', 'b', 'c']) assert.ok(ap.includes(`${hexOf(label)} Tj`), label);
  assert.equal(ap.split(' re f').length - 1, 1);
});

test('text longer than the field allows is reported', async () => {
  const { form } = await open(formPdf());
  const f = { ...field(form, 'name'), maxLen: 3 };
  assert.deepEqual(check(f, 'abcdef'), { value: 'abcdef', shown: 'abc', problem: 'longer than 3 characters; cut to fit' });
  assert.equal(check(f, 'abc').problem, '');
});

test('filling the same field twice keeps one value and one field', async () => {
  const o = await fill([['name', 'first'], ['name', 'second']]);
  assert.equal(o.form.fields.filter((f) => f.name === 'name').length, 1);
  assert.equal(field(o.form, 'name').value, 'second');
  const ap = appearanceText(o, 'name');
  assert.ok(ap.includes(hexOf('second')));
  assert.equal(ap.includes(hexOf('first')), false);
  const again = await fill([['name', 'third']], o.saved);
  assert.deepEqual(again.form.fields.map((f) => f.name), o.form.fields.map((f) => f.name));
  assert.equal(field(again.form, 'name').value, 'third');
  assert.equal(latin1(again.saved).split('/T (name)').length - 1, 1);
});

test('a signature field is reported as not fillable and left unchanged', async () => {
  const { doc, form } = await open(formPdf());
  const edit = new RowEdit(doc);
  const problem = setValue(edit, field(form, 'sig'), 'Ada');
  assert.equal(problem, 'cannot be filled');
  assert.equal(edit.overrides.size, 0);
  assert.equal(edit.extra.size, 0);
  const o = await open(writeSingle(doc, edit));
  const d = o.doc.dict(new PdfRef(field(o.form, 'sig').num));
  assert.equal(d?.has('V'), false);
  assert.equal(d?.has('AP'), false);
  assert.equal(field(o.form, 'sig').kind, 'signature');
});

test('a read-only field keeps its value when a row is merged', async () => {
  const { doc, form } = await open(formPdf());
  const table = { columns: ['a'], rows: [['changed']], delimiter: ',' };
  const edit = buildRow(doc, form, table, { name: 'a', locked: 'a', sig: 'a' }, 0, false);
  assert.equal(edit.overrides.has(12), false);
  assert.equal(edit.overrides.has(13), false);
  const o = await open(writeSingle(doc, edit));
  assert.equal(field(o.form, 'name').value, 'changed');
  assert.equal(field(o.form, 'locked').value, 'fixed');
  assert.equal(field(o.form, 'locked').readOnly, true);
  assert.equal(o.doc.dict(new PdfRef(field(o.form, 'locked').num))?.has('AP'), false);
});

test('filling does not change the opened document', async () => {
  const { doc, form } = await open(formPdf());
  const edit = new RowEdit(doc);
  setValue(edit, field(form, 'name'), 'changed');
  setValue(edit, field(form, 'agree'), 'yes');
  assert.equal(readForm(doc).fields[0].value, 'Ada');
  assert.equal(nameOf((doc.objects.get(6) as PdfDict).get('AS')), 'Off');
  assert.equal((doc.objects.get(5) as PdfDict).has('AP'), false);
});

test('flattening removes the form and draws the values on the page', async () => {
  const { doc, form } = await open(formPdf());
  const edit = new RowEdit(doc);
  setValue(edit, field(form, 'name'), 'Katherine');
  setValue(edit, field(form, 'agree'), 'yes');
  flatten(edit, form);
  const o = await open(writeSingle(doc, edit));
  assert.equal(o.form.hasForm, false);
  assert.deepEqual(o.form.fields, []);
  const page = o.doc.dict(new PdfRef(o.form.pages[0].num));
  assert.equal(page?.has('Annots'), false);
  const contents = o.doc.array(page?.get('Contents'));
  assert.ok(contents.length >= 2);
  const text = contents.map((c) => latin1((o.doc.get(c) as PdfStream).data)).join('');
  const xo = o.doc.dict(o.doc.dict(page?.get('Resources'))?.get('XObject'));
  const drawn = [...(xo?.map.keys() ?? [])];
  assert.ok(drawn.length >= 4, `drawn ${drawn.length}`);
  for (const key of drawn) assert.ok(text.includes(`/${key} Do`), key);
  assert.ok(text.includes('1 0 0 1 50 700 cm'));
  const streams = drawn.map((key) => latin1((o.doc.get(xo?.get(key)) as PdfStream).data));
  assert.ok(streams.some((s) => s.includes(hexOf('Katherine'))));
  assert.ok(streams.includes('0 0 12 12 re f'));
});
