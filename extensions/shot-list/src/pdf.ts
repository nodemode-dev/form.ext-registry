import { winAnsi } from './helvetica';
import type { Page } from './sheet';

export interface PdfImage {
  jpeg: Uint8Array;
  w: number;
  h: number;
}

const enc = new TextEncoder();

function rgb(hex: string): string {
  const h = hex.replace('#', '');
  const v = (i: number) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3);
  return `${v(0)} ${v(2)} ${v(4)}`;
}

function n(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

function pdfString(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = winAnsi(ch);
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

function infoString(text: string): string {
  return pdfString(text.slice(0, 200));
}

export function buildPdf(pages: Page[], images: (key: string) => PdfImage | undefined, title: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const begin = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  const imageIds = new Map<string, number>();
  let next = 5;
  for (const page of pages) {
    for (const op of page.ops) {
      if (op.t === 'image' && !imageIds.has(op.key) && images(op.key)) imageIds.set(op.key, next++);
    }
  }
  const pageIds = pages.map(() => {
    const id = next;
    next += 2;
    return id;
  });
  const infoId = next++;

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>\nendobj\n`);
  begin(3);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  begin(4);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');

  for (const [key, id] of imageIds) {
    const img = images(key)!;
    begin(id);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
    push(img.jpeg);
    push('\nendstream\nendobj\n');
  }

  pages.forEach((page, i) => {
    const H = page.h;
    const ops: string[] = [];
    for (const op of page.ops) {
      if (op.t === 'rect') {
        if (op.fill) ops.push(`${rgb(op.fill)} rg ${n(op.x)} ${n(H - op.y - op.h)} ${n(op.w)} ${n(op.h)} re f`);
        if (op.stroke) ops.push(`${rgb(op.stroke)} RG ${n(op.lw ?? 0.5)} w ${n(op.x)} ${n(H - op.y - op.h)} ${n(op.w)} ${n(op.h)} re S`);
      } else if (op.t === 'line') {
        ops.push(`${rgb(op.color)} RG ${n(op.lw)} w ${n(op.x1)} ${n(H - op.y1)} m ${n(op.x2)} ${n(H - op.y2)} l S`);
      } else if (op.t === 'text') {
        ops.push(`BT /${op.bold ? 'F2' : 'F1'} ${n(op.size)} Tf ${rgb(op.color)} rg ${n(op.x)} ${n(H - op.y)} Td ${pdfString(op.s)} Tj ET`);
      } else {
        const id = imageIds.get(op.key);
        if (id) ops.push(`q ${n(op.w)} 0 0 ${n(op.h)} ${n(op.x)} ${n(H - op.y - op.h)} cm /Im${id} Do Q`);
      }
    }
    const content = enc.encode(ops.join('\n'));
    const pageId = pageIds[i];
    const xobjects = [...imageIds.values()].map((id) => `/Im${id} ${id} 0 R`).join(' ');
    begin(pageId);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.w)} ${n(page.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjects} >> >> /Contents ${pageId + 1} 0 R >>\nendobj\n`);
    begin(pageId + 1);
    push(`<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push('\nendstream\nendobj\n');
  });

  begin(infoId);
  push(`<< /Title ${infoString(title)} /Producer (FormCut Shot List) /Creator (FormCut) >>\nendobj\n`);

  const xref = length;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let id = 1; id < next; id++) table += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${next} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
