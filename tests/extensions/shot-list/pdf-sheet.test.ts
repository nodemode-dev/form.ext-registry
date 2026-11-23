import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf } from '../../../extensions/shot-list/src/pdf.ts';
import { winAnsi, glyphWidth, textWidth, fit, wrap } from '../../../extensions/shot-list/src/helvetica.ts';
import { layout, paperSize, cellMetrics } from '../../../extensions/shot-list/src/sheet.ts';
import { drawPage, canvasToBytes } from '../../../extensions/shot-list/src/render-canvas.ts';

const MARGIN = 30;
const EPS = 0.01;

function board(over: Record<string, unknown> = {}): any {
  return { projectId: 'p', title: 'Film', timeline: 'Main', timelineId: 't', fps: 24, width: 1920, height: 1080, duration: 100, tracks: [], shots: [], selected: [], ...over };
}

function shot(i: number, over: Record<string, unknown> = {}): any {
  return { key: `k${i}`, clipId: `c${i}`, number: i, name: `Shot ${i}`, kind: 'video', track: 'V1', trackIndex: 0, start: i * 2, duration: 2, sourceIn: 0, speed: 1, markerNotes: [], ...over };
}

function shots(count: number, over: Record<string, unknown> = {}): any[] {
  return Array.from({ length: count }, (_, i) => shot(i + 1, over));
}

function options(over: Record<string, unknown> = {}): any {
  return { paper: 'a4', orientation: 'landscape', columns: 4, noteLines: 2, continuous: false, date: '2026-11-23', ...over };
}

function cellRects(page: any): any[] {
  return page.ops.filter((op: any) => op.t === 'rect').slice(1);
}

function texts(page: any): string[] {
  return page.ops.filter((op: any) => op.t === 'text').map((op: any) => op.s);
}

function latin(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function simplePage(ops: any[], w = 200, h = 100): any {
  return { w, h, ops };
}

function textOp(s: string, over: Record<string, unknown> = {}): any {
  return { t: 'text', x: 10, y: 20, s, size: 10, bold: false, color: '#000000', ...over };
}

function parseXref(doc: string) {
  const tail = /startxref\n(\d+)\n%%EOF\n?$/.exec(doc);
  assert.ok(tail, 'startxref and %%EOF close the file');
  const at = Number(tail[1]);
  const head = /^xref\n0 (\d+)\n/.exec(doc.slice(at));
  assert.ok(head, 'startxref points at the xref keyword');
  const size = Number(head[1]);
  const entries: { offset: number; gen: string; kind: string; raw: string }[] = [];
  let pos = at + head[0].length;
  for (let i = 0; i < size; i++) {
    const raw = doc.slice(pos, pos + 20);
    entries.push({ offset: Number(raw.slice(0, 10)), gen: raw.slice(11, 16), kind: raw.slice(17, 18), raw });
    pos += 20;
  }
  return { at, size, entries, after: doc.slice(pos) };
}

function objectBody(doc: string, id: number): string {
  const { entries } = parseXref(doc);
  const start = entries[id].offset;
  return doc.slice(start, doc.indexOf('endobj', start));
}

function contentStreams(doc: string): string[] {
  const out: string[] = [];
  const re = /<< \/Length (\d+) >>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) out.push(doc.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1])));
  return out;
}

function sampleDoc() {
  const list = shots(9, { name: 'A (very) long \\ name', mediaName: 'clip.mov' });
  const frames = new Map([['k1', { w: 640, h: 360 }]]);
  const pages = layout(board(), list, { c2: 'Check focus' }, frames, options());
  const jpeg = new Uint8Array(300).map((_, i) => (i * 7) % 256);
  const bytes = buildPdf(pages, (key) => (key === 'k1' ? { jpeg, w: 640, h: 360 } : undefined), 'Film');
  return { pages, bytes, doc: latin(bytes), jpeg };
}

test('helvetica regular widths match the Adobe metrics', () => {
  const expected: Record<string, number> = { ' ': 278, A: 667, a: 556, W: 944, i: 222, M: 833, '@': 1015, '.': 278, '|': 260, '%': 889 };
  for (const [ch, width] of Object.entries(expected)) assert.equal(glyphWidth(winAnsi(ch), false), width, `width of ${JSON.stringify(ch)}`);
  for (const digit of '0123456789') assert.equal(glyphWidth(winAnsi(digit), false), 556);
});

test('helvetica bold widths match the Adobe metrics', () => {
  const expected: Record<string, number> = { ' ': 278, A: 722, a: 556, W: 944, i: 278, b: 611, '!': 333, '@': 975, '|': 280 };
  for (const [ch, width] of Object.entries(expected)) assert.equal(glyphWidth(winAnsi(ch), true), width, `bold width of ${JSON.stringify(ch)}`);
  for (const digit of '0123456789') assert.equal(glyphWidth(winAnsi(digit), true), 556);
});

test('text width of Wai at 10 pt is 17.22 pt', () => {
  assert.ok(Math.abs(textWidth('Wai', 10, false) - 17.22) < 1e-9);
  assert.ok(Math.abs(textWidth('Wai', 20, false) - 34.44) < 1e-9);
  assert.equal(textWidth('', 10, false), 0);
  assert.equal(textWidth('中', 10, false), 5.56);
  assert.equal(winAnsi('A'), 65);
  assert.equal(winAnsi('é'), 233);
  assert.equal(winAnsi('€'), 128);
  assert.equal(winAnsi('…'), 133);
  assert.equal(winAnsi('–'), 150);
  assert.equal(winAnsi('—'), 151);
  assert.equal(winAnsi('’'), 146);
  assert.equal(winAnsi('中'), 63);
  assert.equal(winAnsi('😀'), 63);
  assert.equal(winAnsi('\n'), 63);
  assert.equal(textWidth('中', 10, false), 5.56);
});

test('widths of the Windows punctuation match the Adobe metrics', () => {
  assert.equal(glyphWidth(winAnsi('…'), false), 1000);
  assert.equal(glyphWidth(winAnsi('—'), false), 1000);
  assert.equal(glyphWidth(winAnsi('–'), false), 556);
  assert.equal(glyphWidth(winAnsi('•'), false), 350);
  assert.equal(glyphWidth(winAnsi('’'), false), 222);
  assert.equal(glyphWidth(winAnsi('“'), false), 333);
});

test('widths of accented Latin-1 letters match the Adobe metrics', { todo: 'defect: every code 160 to 255 is measured as 556, Adobe gives AE 1000, iacute 278, exclamdown 333' }, () => {
  assert.equal(glyphWidth(winAnsi('Æ'), false), 1000);
  assert.equal(glyphWidth(winAnsi('í'), false), 278);
  assert.equal(glyphWidth(winAnsi('¡'), false), 333);
});

test('bold curly quotes use the bold metrics', { todo: 'defect: special codes ignore the bold flag, Helvetica-Bold quoteright is 278 and quotedblleft is 500' }, () => {
  assert.equal(glyphWidth(winAnsi('’'), true), 278);
  assert.equal(glyphWidth(winAnsi('“'), true), 500);
});

test('fit leaves text that already fits and cuts longer text with an ellipsis', () => {
  assert.equal(fit('Short', 10, false, 100), 'Short');
  const long = 'The quick brown fox jumps over the lazy dog';
  const cut = fit(long, 10, false, 80);
  assert.ok(cut.endsWith('…'));
  assert.ok(textWidth(cut, 10, false) <= 80);
  assert.ok(long.startsWith(cut.slice(0, -1)));
  assert.ok(textWidth(`${long.slice(0, cut.length)}…`, 10, false) > 80, 'one more character would not fit');
});

test('wrap breaks at word boundaries and keeps every line inside the width', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve';
  const lines = wrap(text, 8, false, 60, 50);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, 8, false) <= 60, line);
  assert.equal(lines.join(' '), text);
});

test('wrap keeps paragraph breaks and limits the line count with an ellipsis', () => {
  assert.deepEqual(wrap('first\nsecond', 8, false, 200, 5), ['first', 'second']);
  const lines = wrap('one two three four five six seven eight nine ten', 8, false, 40, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  for (const line of lines) assert.ok(textWidth(line, 8, false) <= 40, line);
});

test('wrap cuts a single word that is wider than the column', () => {
  const lines = wrap('Supercalifragilisticexpialidocious end', 8, false, 50, 4);
  assert.ok(lines[0].endsWith('…'));
  for (const line of lines) assert.ok(textWidth(line, 8, false) <= 50, line);
  assert.equal(lines[lines.length - 1], 'end');
});

test('paper sizes are A4 and Letter in points and turn with the orientation', () => {
  assert.deepEqual(paperSize(options({ paper: 'a4', orientation: 'landscape' })), [841.89, 595.28]);
  assert.deepEqual(paperSize(options({ paper: 'a4', orientation: 'portrait' })), [595.28, 841.89]);
  assert.deepEqual(paperSize(options({ paper: 'letter', orientation: 'landscape' })), [792, 612]);
  assert.deepEqual(paperSize(options({ paper: 'letter', orientation: 'portrait' })), [612, 792]);
});

test('column count is held between one and six and the cells fill the printable width', () => {
  assert.equal(cellMetrics(board(), options({ columns: 0 }), 800).cols, 1);
  assert.equal(cellMetrics(board(), options({ columns: 40 }), 800).cols, 6);
  const m = cellMetrics(board(), options({ columns: 4 }), 841.89);
  assert.ok(Math.abs(m.cols * m.cellW + (m.cols - 1) * 14 - (841.89 - 2 * MARGIN)) < EPS);
  assert.ok(Math.abs(m.frameH - (m.cellW * 9) / 16) < EPS);
});

test('an empty list gives one page that says there are no clips', () => {
  const pages = layout(board(), [], {}, new Map(), options());
  assert.equal(pages.length, 1);
  assert.equal(cellRects(pages[0]).length, 0);
  assert.ok(texts(pages[0]).includes('This timeline has no picture clips yet.'));
  assert.ok(texts(pages[0]).some((s) => s.includes('0 shots')));
});

test('a full page holds R rows and one more row of shots starts a second page', () => {
  const opts = options();
  const [pageW, pageH] = paperSize(opts);
  const m = cellMetrics(board(), opts, pageW);
  let full = 0;
  for (let count = 1; count <= 200; count++) {
    if (layout(board(), shots(count), {}, new Map(), opts).length > 1) break;
    full = count;
  }
  assert.ok(full > 0 && full < 200);
  assert.equal(full % m.cols, 0);
  const rows = full / m.cols;
  const one = layout(board(), shots(full), {}, new Map(), opts);
  assert.equal(one.length, 1);
  assert.equal(cellRects(one[0]).length, full);
  assert.equal(new Set(cellRects(one[0]).map((r) => r.y)).size, rows);
  const firstY = Math.min(...cellRects(one[0]).map((r) => r.y));
  assert.ok(firstY + (rows + 1) * m.cellH + rows * 14 > pageH - MARGIN, 'another row would not fit');
  const two = layout(board(), shots(full + 1), {}, new Map(), opts);
  assert.equal(two.length, 2);
  assert.equal(cellRects(two[0]).length, full);
  assert.equal(cellRects(two[1]).length, 1);
});

test('every shot appears once and in order across the pages', () => {
  const list = shots(23).map((s, i) => ({ ...s, name: `Name-${i + 1}-end` }));
  const pages = layout(board(), list, {}, new Map(), options({ columns: 3 }));
  const seen = pages.flatMap((page) => texts(page).filter((s) => /^Name-\d+-end$/.test(s)));
  assert.deepEqual(seen, list.map((s) => s.name));
  assert.equal(pages.reduce((sum, page) => sum + cellRects(page).length, 0), 23);
});

test('page numbers are printed only when there is more than one page', () => {
  const single = layout(board(), shots(2), {}, new Map(), options());
  assert.ok(!texts(single[0]).some((s) => /Page \d+ of \d+/.test(s)));
  assert.ok(texts(single[0]).some((s) => s.includes('2 shots')));
  const many = layout(board(), shots(40), {}, new Map(), options());
  assert.ok(many.length > 1);
  many.forEach((page, i) => assert.ok(texts(page).some((s) => s.includes(`Page ${i + 1} of ${many.length}`))));
  const lone = layout(board(), shots(1), {}, new Map(), options());
  assert.ok(texts(lone[0]).some((s) => s.includes('1 shot ')));
});

test('every cell stays inside the margins on each paper, orientation and column count', () => {
  for (const variant of [
    { paper: 'a4', orientation: 'landscape', columns: 4, noteLines: 2 },
    { paper: 'letter', orientation: 'portrait', columns: 6, noteLines: 3 },
    { paper: 'a4', orientation: 'portrait', columns: 1, noteLines: 0 },
    { paper: 'letter', orientation: 'landscape', columns: 3, noteLines: 4, continuous: true },
  ]) {
    const opts = options(variant);
    const long = 'An extremely long description of the shot that goes on and on without stopping anywhere soon';
    const list = shots(17, { name: long, mediaName: `${long}.mov`, track: 'Video track with a long name', markerNotes: [long, 'Unbreakablewordthatiswiderthananycolumncouldeverbeonthissheetofpaperforsure'] });
    const notes = Object.fromEntries(list.map((s) => [s.clipId, `${long}\n${long}\n${long}`]));
    const frames = new Map([['k1', { w: 300, h: 900 }], ['k2', { w: 4000, h: 500 }]]);
    const pages = layout(board({ title: long + long, timeline: long + long }), list, notes, frames, opts);
    for (const page of pages) {
      const right = page.w - MARGIN + EPS;
      const bottom = page.h - MARGIN + EPS;
      for (const op of page.ops.slice(1) as any[]) {
        if (op.t === 'text' && op.s === 'FormCut Shot List') continue;
        if (op.t === 'rect' || op.t === 'image') {
          assert.ok(op.x >= MARGIN - EPS && op.x + op.w <= right, `${op.t} is inside left and right`);
          assert.ok(op.y >= MARGIN - EPS && op.y + op.h <= bottom, `${op.t} is inside top and bottom`);
        } else if (op.t === 'line') {
          assert.ok(Math.min(op.x1, op.x2) >= MARGIN - EPS && Math.max(op.x1, op.x2) <= right);
          assert.ok(Math.min(op.y1, op.y2) >= MARGIN - EPS && Math.max(op.y1, op.y2) <= bottom);
        } else {
          assert.ok(op.x >= MARGIN - EPS, `text starts inside: ${op.s}`);
          assert.ok(op.x + textWidth(op.s, op.size, op.bold) <= right, `text ends inside: ${op.s}`);
          assert.ok(op.y >= MARGIN && op.y <= bottom, `text baseline inside: ${op.s}`);
        }
      }
    }
  }
});

test('text in a cell never runs past the right edge of its own cell', () => {
  const opts = options({ columns: 5, noteLines: 3 });
  const long = 'Wide words WWWWWWWW MMMMMMMM and more words to push the edge of the column';
  const list = shots(5, { name: long, mediaName: long, markerNotes: [long] });
  const [page] = layout(board(), list, { c1: long }, new Map(), opts);
  const rects = cellRects(page);
  assert.equal(rects.length, 5);
  for (const op of page.ops as any[]) {
    if (op.t !== 'text' || op.y < rects[0].y) continue;
    if (op.s === 'FormCut Shot List') continue;
    const home = rects.find((r) => op.x >= r.x - EPS && op.x < r.x + r.w);
    assert.ok(home, `text sits in a column: ${op.s}`);
    assert.ok(op.x + textWidth(op.s, op.size, op.bold) <= home.x + home.w + EPS, `text fits its column: ${op.s}`);
  }
});

test('note lines are limited to the chosen count and each has a ruled line', () => {
  const long = 'word '.repeat(200);
  const [page] = layout(board(), shots(1), { c1: long }, new Map(), options({ noteLines: 3 }));
  const rect = cellRects(page)[0];
  const noteTexts = (page.ops as any[]).filter((op) => op.t === 'text' && op.size === 8 && !op.bold && op.s.startsWith('word'));
  assert.equal(noteTexts.length, 3);
  assert.ok(noteTexts[2].s.endsWith('…'));
  const rules = (page.ops as any[]).filter((op) => op.t === 'line' && op.y1 > rect.y + rect.h);
  assert.equal(rules.length, 3);
  const none = layout(board(), shots(1), { c1: long }, new Map(), options({ noteLines: 0 }))[0];
  assert.equal((none.ops as any[]).filter((op) => op.t === 'text' && op.s.startsWith('word')).length, 0);
});

test('a frame is drawn inside its cell with its own proportions', () => {
  const frames = new Map([['k1', { w: 300, h: 900 }], ['k2', { w: 4000, h: 500 }], ['k3', { w: 0, h: 0 }]]);
  const [page] = layout(board(), shots(3), {}, frames, options());
  const rects = cellRects(page);
  const images = (page.ops as any[]).filter((op) => op.t === 'image');
  assert.deepEqual(images.map((op) => op.key), ['k1', 'k2']);
  images.forEach((img, i) => {
    const size = frames.get(img.key)!;
    assert.ok(Math.abs(img.w / img.h - size.w / size.h) < 1e-6);
    assert.ok(img.x >= rects[i].x - EPS && img.x + img.w <= rects[i].x + rects[i].w + EPS);
    assert.ok(img.y >= rects[i].y - EPS && img.y + img.h <= rects[i].y + rects[i].h + EPS);
    assert.ok(Math.abs(img.x + img.w / 2 - (rects[i].x + rects[i].w / 2)) < EPS);
  });
  assert.ok(texts(page).includes('No frame yet'));
});

test('a continuous sheet is one page that grows to hold every row', () => {
  const opts = options({ continuous: true });
  const pages = layout(board(), shots(41), {}, new Map(), opts);
  assert.equal(pages.length, 1);
  assert.equal(cellRects(pages[0]).length, 41);
  assert.equal(pages[0].w, 841.89);
  assert.ok(pages[0].h > 595.28);
  const lowest = Math.max(...(pages[0].ops as any[]).slice(1).filter((op) => op.t === 'line').map((op) => op.y1));
  assert.ok(lowest <= pages[0].h - MARGIN);
  assert.ok(pages[0].h - lowest < 60, 'the page ends soon after the last row');
});

test('the file starts with a PDF header and ends with the end of file marker', () => {
  const { bytes, doc } = sampleDoc();
  assert.ok(/^%PDF-1\.\d\n/.test(doc));
  assert.ok(doc.trimEnd().endsWith('%%EOF'));
  assert.equal(doc.length, bytes.length);
  assert.ok(bytes[10] > 127, 'the second line marks the file as binary');
});

test('startxref points at the xref table and every entry points at its object', () => {
  const { doc } = sampleDoc();
  const { at, size, entries } = parseXref(doc);
  assert.equal(doc.slice(at, at + 5), 'xref\n');
  assert.equal(entries[0].raw, '0000000000 65535 f \n');
  for (let id = 1; id < size; id++) {
    assert.ok(/^\d{10} 00000 n \n$/.test(entries[id].raw), `entry ${id} is 20 bytes in the fixed form`);
    assert.equal(doc.slice(entries[id].offset, entries[id].offset + `${id} 0 obj\n`.length), `${id} 0 obj\n`);
  }
  assert.equal((doc.match(/\d+ 0 obj\n/g) ?? []).length, size - 1);
  assert.equal((doc.match(/endobj\n/g) ?? []).length, size - 1);
});

test('the trailer names the root catalog, the info object and the right size', () => {
  const { doc } = sampleDoc();
  const { size, after } = parseXref(doc);
  const trailer = /^trailer\n<< (.*) >>\nstartxref\n/.exec(after);
  assert.ok(trailer);
  assert.equal(Number(/\/Size (\d+)/.exec(trailer[1])![1]), size);
  const root = Number(/\/Root (\d+) 0 R/.exec(trailer[1])![1]);
  assert.ok(objectBody(doc, root).includes('/Type /Catalog'));
  const info = Number(/\/Info (\d+) 0 R/.exec(trailer[1])![1]);
  assert.ok(objectBody(doc, info).includes('/Title (Film)'));
  const highest = Math.max(...[...doc.matchAll(/(\d+) 0 obj\n/g)].map((m) => Number(m[1])));
  assert.equal(size, highest + 1);
});

test('the page tree counts and lists every page with its size', () => {
  const { doc, pages } = sampleDoc();
  assert.equal(pages.length, 2);
  const catalog = objectBody(doc, 1);
  const treeId = Number(/\/Pages (\d+) 0 R/.exec(catalog)![1]);
  const tree = objectBody(doc, treeId);
  assert.ok(tree.includes('/Type /Pages'));
  assert.equal(Number(/\/Count (\d+)/.exec(tree)![1]), pages.length);
  const kids = [.../\/Kids \[(.*?)\]/.exec(tree)![1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  assert.equal(kids.length, pages.length);
  assert.equal(new Set(kids).size, pages.length);
  kids.forEach((id, i) => {
    const body = objectBody(doc, id);
    assert.ok(body.includes('/Type /Page '));
    assert.ok(body.includes(`/Parent ${treeId} 0 R`));
    assert.ok(body.includes(`/MediaBox [0 0 ${pages[i].w} ${pages[i].h}]`));
    const contents = Number(/\/Contents (\d+) 0 R/.exec(body)![1]);
    assert.ok(/\/Length \d+ >>\nstream\n/.test(objectBody(doc, contents)));
    const fonts = [.../\/F\d (\d+) 0 R/g[Symbol.matchAll](body)].map((m) => Number(m[1]));
    assert.equal(fonts.length, 2);
    assert.ok(objectBody(doc, fonts[0]).includes('/BaseFont /Helvetica '));
    assert.ok(objectBody(doc, fonts[1]).includes('/BaseFont /Helvetica-Bold '));
  });
  assert.equal((doc.match(/\/Type \/Page /g) ?? []).length, pages.length);
});

test('every stream length equals the bytes between stream and endstream', () => {
  const { doc } = sampleDoc();
  const re = /\/Length (\d+) >>\nstream\n/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) {
    const start = m.index + m[0].length;
    const end = doc.indexOf('\nendstream\nendobj\n', start);
    const declared = Number(m[1]);
    assert.equal(doc.slice(start + declared, start + declared + 10), '\nendstream');
    if (!m.input.slice(m.index - 200, m.index).includes('/DCTDecode')) assert.equal(end - start, declared);
    count++;
  }
  assert.equal(count, 3);
});

test('a stream length counts bytes and not characters for accented text', () => {
  const bytes = buildPdf([simplePage([textOp('é'.repeat(40))])], () => undefined, 'T');
  const doc = latin(bytes);
  const [stream] = contentStreams(doc);
  assert.ok(stream.startsWith('BT ') && stream.endsWith(' Tj ET'));
  assert.ok(!/[^\x20-\x7e\n]/.test(stream), 'content is plain ASCII');
  assert.ok(stream.includes(`(${'\\351'.repeat(40)})`));
});

test('an embedded JPEG is declared with DCTDecode, its size and its exact bytes', () => {
  const { doc, bytes, jpeg, pages } = sampleDoc();
  const m = /<< \/Type \/XObject \/Subtype \/Image ([^>]*) >>\nstream\n/.exec(doc);
  assert.ok(m);
  assert.ok(m[1].includes('/Filter /DCTDecode'));
  assert.ok(m[1].includes('/Width 640 '));
  assert.ok(m[1].includes('/Height 360 '));
  assert.ok(m[1].includes('/ColorSpace /DeviceRGB'));
  assert.ok(m[1].includes('/BitsPerComponent 8'));
  assert.equal(Number(/\/Length (\d+)/.exec(m[1])![1]), jpeg.length);
  const start = m.index + m[0].length;
  assert.deepEqual(Array.from(bytes.subarray(start, start + jpeg.length)), Array.from(jpeg));
  const id = Number(/(\d+) 0 obj\n$/.exec(doc.slice(0, m.index))![1]);
  const [first, second] = contentStreams(doc);
  const img = (pages[0].ops as any[]).find((op) => op.t === 'image');
  const draw = new RegExp(`q ([\\d.]+) 0 0 ([\\d.]+) ([\\d.]+) ([\\d.]+) cm /Im${id} Do Q`).exec(first);
  assert.ok(draw);
  assert.ok(Math.abs(Number(draw[1]) - img.w) < 0.01 && Math.abs(Number(draw[2]) - img.h) < 0.01);
  assert.ok(Math.abs(Number(draw[4]) - (pages[0].h - img.y - img.h)) < 0.01);
  assert.ok(!second.includes(' Do Q'));
  assert.ok(new RegExp(`/XObject << /Im${id} ${id} 0 R >>`).test(doc));
});

test('an image without data is left out and a repeated image is stored once', () => {
  const image = (key: string, x: number) => ({ t: 'image', x, y: 0, w: 10, h: 10, key });
  const jpeg = new Uint8Array([255, 216, 255, 217]);
  const pages = [simplePage([image('a', 0), image('gone', 20)]), simplePage([image('a', 40)])];
  const doc = latin(buildPdf(pages, (key) => (key === 'a' ? { jpeg, w: 2, h: 3 } : undefined), 'T'));
  assert.equal((doc.match(/\/Subtype \/Image/g) ?? []).length, 1);
  const streams = contentStreams(doc);
  assert.equal((streams[0].match(/ Do Q/g) ?? []).length, 1);
  assert.equal((streams[1].match(/ Do Q/g) ?? []).length, 1);
  const { size, entries } = parseXref(doc);
  for (let id = 1; id < size; id++) assert.equal(doc.slice(entries[id].offset).indexOf(`${id} 0 obj\n`), 0);
});

test('parentheses and backslashes in text are escaped', () => {
  const doc = latin(buildPdf([simplePage([textOp('a(b)c\\d')])], () => undefined, 'Cut (v2) \\ final'));
  const [stream] = contentStreams(doc);
  assert.ok(stream.includes('(a\\(b\\)c\\\\d) Tj'));
  assert.ok(doc.includes('/Title (Cut \\(v2\\) \\\\ final)'));
});

test('text outside the encoding prints as question marks and specials as octal codes', () => {
  const doc = latin(buildPdf([simplePage([textOp('日本 ok 😀 € – é\n')])], () => undefined, 'Tïtle 日'));
  const [stream] = contentStreams(doc);
  assert.ok(stream.includes('(?? ok ? \\200 \\226 \\351?) Tj'));
  assert.ok(doc.includes('/Title (T\\357tle ?)'));
});

test('text and shapes are placed from the bottom of the page with font and colour', () => {
  const ops = [
    { t: 'rect', x: 10, y: 20, w: 30, h: 40, fill: '#ff0000', stroke: '#0000ff' },
    { t: 'line', x1: 5, y1: 10, x2: 50, y2: 10, color: '#00ff00', lw: 0.75 },
    textOp('Plain', { x: 12, y: 30, size: 9.5 }),
    textOp('Bold', { x: 12, y: 60, size: 15, bold: true, color: '#ffffff' }),
  ];
  const [stream] = contentStreams(latin(buildPdf([simplePage(ops, 200, 100)], () => undefined, 'T')));
  const lines = stream.split('\n');
  assert.deepEqual(lines, [
    '1.000 0.000 0.000 rg 10 40 30 40 re f',
    '0.000 0.000 1.000 RG 0.5 w 10 40 30 40 re S',
    '0.000 1.000 0.000 RG 0.75 w 5 90 m 50 90 l S',
    'BT /F1 9.5 Tf 0.000 0.000 0.000 rg 12 70 Td (Plain) Tj ET',
    'BT /F2 15 Tf 1.000 1.000 1.000 rg 12 40 Td (Bold) Tj ET',
  ]);
});

test('a document with no pages is still a well formed file', () => {
  const doc = latin(buildPdf([], () => undefined, ''));
  const { size, entries } = parseXref(doc);
  assert.ok(objectBody(doc, 2).includes('/Count 0 /Kids []'));
  for (let id = 1; id < size; id++) assert.equal(doc.slice(entries[id].offset, entries[id].offset + `${id} 0 obj\n`.length), `${id} 0 obj\n`);
  assert.ok(doc.includes('/Title ()'));
});

test('the canvas renderer scales the page and replays each drawing step', () => {
  const calls: any[][] = [];
  const ctx: any = {};
  for (const name of ['setTransform', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText', 'drawImage']) ctx[name] = (...args: any[]) => calls.push([name, ...args, ctx.fillStyle, ctx.font]);
  const canvas: any = { getContext: () => ctx };
  const picture = { tag: 'img' };
  const page = simplePage([
    { t: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#ffffff' },
    { t: 'line', x1: 5, y1: 6, x2: 7, y2: 8, color: '#000000', lw: 1 },
    textOp('Hi', { bold: true }),
    { t: 'image', x: 9, y: 10, w: 11, h: 12, key: 'a' },
    { t: 'image', x: 0, y: 0, w: 1, h: 1, key: 'missing' },
  ], 100.4, 50.2);
  drawPage(canvas, page, 2, (key) => (key === 'a' ? (picture as any) : undefined));
  assert.equal(canvas.width, 201);
  assert.equal(canvas.height, 100);
  assert.deepEqual(calls[0].slice(0, 7), ['setTransform', 2, 0, 0, 2, 0, 0]);
  assert.deepEqual(calls[1].slice(0, 6), ['fillRect', 1, 2, 3, 4, '#ffffff']);
  assert.deepEqual(calls.slice(2, 6).map((c) => c.slice(0, 3)), [['beginPath', '#ffffff', undefined], ['moveTo', 5, 6], ['lineTo', 7, 8], ['stroke', '#ffffff', undefined]]);
  const text = calls.find((c) => c[0] === 'fillText')!;
  assert.deepEqual(text.slice(0, 5), ['fillText', 'Hi', 10, 20, '#000000']);
  assert.ok(/^700 10px Helvetica/.test(text[5]));
  const drawn = calls.filter((c) => c[0] === 'drawImage');
  assert.equal(drawn.length, 1);
  assert.deepEqual(drawn[0].slice(0, 6), ['drawImage', picture, 9, 10, 11, 12]);
  const blind: any = { getContext: () => null };
  assert.throws(() => drawPage(blind, simplePage([]), 1, () => undefined), /cannot draw/);
});

test('canvas bytes come from the saved blob and a missing blob is an error', async () => {
  const good: any = { toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob([new Uint8Array([1, 2, 3])], { type })) };
  assert.deepEqual(Array.from(await canvasToBytes(good, 'image/png')), [1, 2, 3]);
  const bad: any = { toBlob: (cb: (b: Blob | null) => void) => cb(null) };
  await assert.rejects(canvasToBytes(bad, 'image/jpeg', 0.9), /too large/);
});
