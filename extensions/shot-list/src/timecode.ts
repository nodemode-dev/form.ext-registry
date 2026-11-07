export function timecode(seconds: number, fps: number): string {
  const base = Math.max(1, Math.round(fps));
  const frames = Math.max(0, Math.round(seconds * fps));
  const ff = frames % base;
  const total = Math.floor(frames / base);
  const ss = total % 60;
  const mm = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function shortDuration(seconds: number, fps: number): string {
  const base = Math.max(1, Math.round(fps));
  const frames = Math.max(0, Math.round(seconds * fps));
  const total = Math.floor(frames / base);
  const ff = frames % base;
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return mm > 0 ? `${mm}:${pad(ss)}:${pad(ff)}` : `${ss}:${pad(ff)}`;
}

export function rateLabel(fps: number): string {
  const r = Math.round(fps * 1000) / 1000;
  return `${Number.isInteger(r) ? r : r.toFixed(3).replace(/0+$/, '')} fps`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
