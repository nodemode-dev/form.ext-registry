let ctx: AudioContext | null = null;

export function primeAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
}

function bell(at: number, freq: number, gain: number) {
  if (!ctx) return;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
  out.connect(ctx.destination);
  for (const [ratio, level] of [[1, 1], [2.76, 0.32], [5.4, 0.12]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + 1.9);
  }
}

export function chime(kind: 'focus' | 'break'): boolean {
  primeAudio();
  if (!ctx) return false;
  const t = ctx.currentTime + 0.02;
  if (kind === 'focus') {
    bell(t, 784, 0.22);
    bell(t + 0.28, 1047, 0.18);
  } else {
    bell(t, 1047, 0.18);
    bell(t + 0.28, 784, 0.22);
  }
  return true;
}
