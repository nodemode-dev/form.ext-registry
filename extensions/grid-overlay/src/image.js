import { toBase64, fromBase64, textToBase64 } from './formext.js';

// WebKit refuses canvases over about 16.7 million pixels; above that the SVG goes to formvis as is.
const MAX_CANVAS = 16_000_000;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode the picture'));
    img.src = src;
  });
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('could not encode PNG'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png'),
  );
}

// The grid as base64 for tool:place_image: a PNG drawn here when the canvas allows,
// otherwise the SVG itself.
export async function gridImage(svg, W, H) {
  const svgData = textToBase64(svg);
  if (W * H > MAX_CANVAS) return { data: svgData, kind: 'svg' };
  try {
    const img = await loadImage(`data:image/svg+xml;base64,${svgData}`);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(img, 0, 0, W, H);
    return { data: toBase64(await canvasPng(canvas)), kind: 'png' };
  } catch {
    return { data: svgData, kind: 'svg' };
  }
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Writes the print resolution into a PNG (pHYs chunk), so printing at 100% gives the right size.
export function withDpi(png, dpi) {
  if (!(dpi > 0) || png.length < 33) return png;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1; // metres
  v.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Drop an existing pHYs, then insert after IHDR (8 byte signature + 25 byte IHDR).
  const parts = [png.subarray(0, 33), chunk];
  let i = 33;
  while (i + 8 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + i).getUint32(0);
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    if (type !== 'pHYs') parts.push(png.subarray(i, i + 12 + len));
    i += 12 + len;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
}

export async function grayscale(pngBase64) {
  const img = await loadImage(`data:image/png;base64,${pngBase64}`);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const y = Math.round(0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]);
    p[i] = p[i + 1] = p[i + 2] = y;
  }
  ctx.putImageData(data, 0, 0);
  return canvasPng(canvas);
}

export { fromBase64, toBase64 };
