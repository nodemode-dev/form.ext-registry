import type { Page } from './sheet';

const FACE = 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif';

export function drawPage(canvas: HTMLCanvasElement, page: Page, scale: number, images: (key: string) => CanvasImageSource | undefined) {
  canvas.width = Math.round(page.w * scale);
  canvas.height = Math.round(page.h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This window cannot draw the sheet.');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  for (const op of page.ops) {
    if (op.t === 'rect') {
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.lw ?? 0.5;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
      }
    } else if (op.t === 'line') {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.lw;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
    } else if (op.t === 'text') {
      ctx.fillStyle = op.color;
      ctx.font = `${op.bold ? '700' : '400'} ${op.size}px ${FACE}`;
      ctx.fillText(op.s, op.x, op.y);
    } else {
      const img = images(op.key);
      if (img) ctx.drawImage(img, op.x, op.y, op.w, op.h);
    }
  }
}

export function canvasToBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('The sheet was too large to save as an image. Try fewer columns or PDF.'));
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      type,
      quality,
    );
  });
}
