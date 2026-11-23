import { test } from 'node:test';
import assert from 'node:assert/strict';

const g = globalThis as any;
g.window ??= { addEventListener() {}, parent: {}, setTimeout, clearTimeout };
const chart = await import('../../../extensions/golden-hour/src/chart.ts');
const photos = await import('../../../extensions/golden-hour/src/photos.ts');

const KEYS = ['night', 'astro', 'nautical', 'blue', 'golden', 'day', 'high', 'sun', 'moon', 'ink', 'muted', 'line', 'accent', 'field'];
const P: any = Object.fromEntries(KEYS.map((k) => [k, `c-${k}`]));
const OPT = { ...photos.DEFAULT_OPTIONS };
const QUIET = { ...photos.DEFAULT_OPTIONS, moonlit: false };

function rec(captureTime: string | null, lat: number | null, lon: number | null, heading: number | null = null, keywords: string[] = []) {
  return { id: 1, file: 'a.jpg', captureTime, lat, lon, heading, keywords };
}

function placed(time: string, lat: number, lon: number, heading: number | null = null, options: any = OPT) {
  const a = photos.analyse(rec(time, lat, lon, heading), options);
  assert.equal(a.ok, true, a.reason);
  return a;
}

function curves(svg: string, stroke: string) {
  const re = new RegExp(`<polyline points="([^"]*)" fill="none" stroke="${stroke}"`, 'g');
  return [...svg.matchAll(re)].map((m) => m[1].split(' ').map((p) => p.split(',').map(Number)));
}

function curve(svg: string, stroke: string) {
  const all = curves(svg, stroke);
  assert.equal(all.length, 1, `expected one ${stroke} curve`);
  return all[0];
}

function peakX(points: number[][]) {
  const top = Math.min(...points.map((p) => p[1]));
  const xs = points.filter((p) => p[1] === top).map((p) => p[0]);
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

test('day chart sun and moon curves stay inside the plot box', () => {
  const svg = chart.dayChart(placed('2024-03-20T09:00:00Z', 0, 0), P);
  for (const stroke of ['c-sun', 'c-moon']) {
    for (const [px, py] of curve(svg, stroke)) {
      assert.ok(px >= 26 && px <= 312, `${stroke} x ${px}`);
      assert.ok(py >= 8 && py <= 150, `${stroke} y ${py}`);
    }
  }
  const sun = curve(svg, 'c-sun').map((p) => p[1]);
  assert.ok(sun.includes(150), 'sun far below the horizon is clamped to the floor');
  assert.ok(Math.min(...sun) < 10, 'equator noon sun reaches near the top');
});

test('day chart samples run in time order across the whole local day', () => {
  const pts = curve(chart.dayChart(placed('2024-03-20T09:00:00Z', 0, 0), P), 'c-sun');
  assert.equal(pts.length, 289);
  assert.equal(pts[0][0], 26);
  assert.equal(pts[pts.length - 1][0], 312);
  for (let i = 1; i < pts.length; i++) {
    const step = pts[i][0] - pts[i - 1][0];
    assert.ok(step > 0.85 && step < 1.15, `step ${step} at ${i}`);
  }
});

test('day chart puts solar noon in the middle for places far from greenwich', () => {
  for (const lon of [90, -120, 0]) {
    const a = placed('2024-03-20T10:00:00', 0, lon);
    const x = peakX(curve(chart.dayChart(a, P), 'c-sun'));
    assert.ok(Math.abs(x - 169) <= 3, `lon ${lon} noon at x ${x}`);
  }
});

test('day chart marks the capture moment at its local clock time', () => {
  for (const time of ['2024-03-20T18:00:00Z', '2024-03-20T18:00:00+02:00']) {
    const svg = chart.dayChart(placed(time, 0, 0), P);
    const line = /<line x1="([^"]+)" x2="([^"]+)" y1="8" y2="150" stroke="c-accent"/.exec(svg);
    assert.ok(line, time);
    assert.equal(line[1], '240.5');
    assert.equal(line[2], '240.5');
    const dot = /<circle cx="([^"]+)" cy="([^"]+)" r="4" fill="c-sun"/.exec(svg);
    assert.ok(dot);
    assert.equal(dot[1], '240.5');
    const onCurve = curve(svg, 'c-sun').find((p) => p[0] === 240.5);
    assert.ok(onCurve, 'a sample sits at the capture minute');
    assert.equal(Number(dot[2]), onCurve[1]);
  }
  const low = chart.dayChart(placed('2024-03-20T18:00:00Z', 0, 0), P);
  const cy = Number(/<circle cx="[^"]+" cy="([^"]+)" r="4" fill="c-sun"/.exec(low)![1]);
  assert.ok(Math.abs(cy - 112.2) < 0.6, `sun two degrees up should be near y 112.2, got ${cy}`);
});

test('day chart horizon, altitude labels and hour labels sit where the scale says', () => {
  const svg = chart.dayChart(placed('2024-03-20T09:00:00Z', 0, 0), P);
  assert.ok(svg.includes('<line x1="26" x2="312" y1="114.5" y2="114.5" stroke="c-ink"'));
  for (const [alt, yy] of [['60', '46.5'], ['30', '82.0'], ['0', '117.5'], ['-18', '138.8']]) {
    assert.ok(svg.includes(`<text x="23" y="${yy}" text-anchor="end" fill="c-muted">${alt}°</text>`), `${alt} label`);
  }
  assert.ok(svg.includes('<text x="26.0" y="162" text-anchor="start" fill="c-muted">00:00</text>'));
  assert.ok(svg.includes('<text x="169.0" y="162" text-anchor="middle" fill="c-muted">12:00</text>'));
  assert.ok(svg.includes('<text x="312.0" y="162" text-anchor="end" fill="c-muted">24:00</text>'));
});

test('day chart light bands tile the plot from high sun down to night', () => {
  const svg = chart.dayChart(placed('2024-03-20T09:00:00Z', 0, 0), P);
  const bands = [...svg.matchAll(/<rect x="26" y="([^"]+)" width="286" height="([^"]+)" fill="([^"]+)" opacity="0.55"\/>/g)].map((m) => ({ y: Number(m[1]), h: Number(m[2]), fill: m[3] }));
  bands.sort((p, q) => p.y - q.y);
  assert.deepEqual(bands.map((b) => b.fill), ['c-high', 'c-day', 'c-golden', 'c-blue', 'c-nautical', 'c-astro', 'c-night']);
  assert.equal(bands[0].y, 8);
  for (let i = 1; i < bands.length; i++) assert.ok(Math.abs(bands[i].y - (bands[i - 1].y + bands[i - 1].h)) <= 0.15, `gap above ${bands[i].fill}`);
  const last = bands[bands.length - 1];
  assert.ok(Math.abs(last.y + last.h - 150) <= 0.15);
  assert.equal(bands.find((b) => b.fill === 'c-night')!.h, 14.2);
  assert.equal(bands.find((b) => b.fill === 'c-golden')!.h, 11.8);
});

test('day chart names only the bands tall enough to read', () => {
  const svg = chart.dayChart(placed('2024-03-20T09:00:00Z', 0, 0), P);
  const labels = [...svg.matchAll(/<text class="t-band"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(labels.sort(), ['day', 'golden', 'night']);
});

test('day chart in polar day keeps the whole sun curve above the horizon', () => {
  const svg = chart.dayChart(placed('2024-06-21T12:00:00+02:00', 78, 15), P);
  assert.ok(!svg.includes('NaN'));
  for (const [, py] of curve(svg, 'c-sun')) assert.ok(py < 114.5, `y ${py}`);
});

test('day chart in polar night keeps the whole sun curve below the horizon', () => {
  const svg = chart.dayChart(placed('2024-12-21T12:00:00+01:00', 78, 15), P);
  assert.ok(!svg.includes('NaN'));
  for (const [, py] of curve(svg, 'c-sun')) assert.ok(py > 114.5, `y ${py}`);
  const cy = Number(/<circle cx="[^"]+" cy="([^"]+)" r="4" fill="c-sun"/.exec(svg)![1]);
  assert.ok(cy > 114.5);
});

test('charts at the north pole draw a flat sun at its declination with no NaN', () => {
  const a = placed('2024-06-21T12:00:00Z', 90, 0, 45);
  const day = chart.dayChart(a, P);
  const sky = chart.skyChart(a, P);
  assert.ok(!day.includes('NaN'));
  assert.ok(!sky.includes('NaN'));
  for (const [, py] of curve(day, 'c-sun')) assert.ok(Math.abs(py - 86.8) <= 0.5, `y ${py}`);
});

test('empty chart fills the box and escapes the message', () => {
  const svg = chart.emptyChart(P, 'No <location> & "time"');
  assert.ok(svg.startsWith('<rect x="0" y="0" width="320" height="168" fill="c-field"/>'));
  assert.ok(svg.includes('<text x="160" y="87" text-anchor="middle" fill="c-muted">No &lt;location&gt; &amp; &quot;time&quot;</text>'));
  assert.ok(!svg.includes('<location>'));
});

test('standalone wraps a chart in a complete svg document with an escaped title', () => {
  const doc = chart.standalone('<g id="inner"/>', 'Tom & Jerry <b>');
  assert.ok(doc.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 168" width="640" height="336"'));
  assert.ok(doc.includes('<title>Tom &amp; Jerry &lt;b&gt;</title><g id="inner"/></svg>'));
  assert.ok(doc.endsWith('</svg>\n'));
});

test('sky chart points the camera ray along its compass heading with north up', () => {
  const ray = (heading: number) => {
    const svg = chart.skyChart(placed('2024-03-20T09:00:00Z', 0, 0, heading), P);
    const m = /<line x1="160" y1="82" x2="([^"]+)" y2="([^"]+)" stroke="c-accent"/.exec(svg);
    assert.ok(m, `ray for ${heading}`);
    assert.ok(svg.includes(`>camera ${heading}°</text>`));
    return [m[1], m[2]];
  };
  assert.deepEqual(ray(0), ['160.0', '18.0']);
  assert.deepEqual(ray(90), ['224.0', '82.0']);
  assert.deepEqual(ray(135), ['205.3', '127.3']);
});

test('sky chart without heading has no camera ray and rims a sun below the horizon', () => {
  const svg = chart.skyChart(placed('2024-03-20T00:00:00Z', 0, 0), P);
  assert.ok(!svg.includes('camera'));
  assert.ok(svg.includes('>Sun below the horizon</text>'));
  const m = /<circle cx="([^"]+)" cy="([^"]+)" r="4" fill="none" stroke="c-sun" stroke-width="1.5" stroke-dasharray="2 2"\/>/.exec(svg);
  assert.ok(m);
  assert.ok(Math.abs(Math.hypot(Number(m[1]) - 160, Number(m[2]) - 82) - 64) <= 0.15);
});

test('sky chart keeps the sun track inside the sky and the golden stretches near the rim', () => {
  const svg = chart.skyChart(placed('2024-03-20T09:00:00Z', 0, 0), P);
  assert.ok(!svg.includes('Sun below the horizon'));
  const track = curves(svg, 'c-sun').flat();
  assert.ok(track.length > 100);
  for (const [px, py] of track) assert.ok(Math.hypot(px - 160, py - 82) <= 64.1);
  const golds = curves(svg, 'c-golden');
  assert.equal(golds.length, 2, 'one morning and one evening golden stretch');
  for (const [px, py] of golds.flat()) {
    const r = Math.hypot(px - 160, py - 82);
    assert.ok(r >= 59.5 && r <= 64.1, `golden point at radius ${r}`);
  }
});

test('palette for export reads each css variable and falls back to grey', () => {
  const seen: string[] = [];
  g.document = { documentElement: { tag: 'html' } };
  g.getComputedStyle = (el: unknown) => {
    assert.equal(el, g.document.documentElement);
    return { getPropertyValue: (n: string) => (seen.push(n), n === '--gh-line-strong' ? '  #123456 ' : n === '--gh-sun' ? 'rgb(1, 2, 3)' : '') };
  };
  try {
    const p = chart.resolvedPalette();
    assert.equal(Object.keys(p).length, 14);
    assert.equal(p.line, '#123456');
    assert.equal(p.sun, 'rgb(1, 2, 3)');
    assert.equal(p.night, '#888888');
    assert.ok(seen.includes('--gh-field') && seen.includes('--gh-accent'));
  } finally {
    delete g.document;
    delete g.getComputedStyle;
  }
});

test('photo record keeps the file offset when the time has no zone of its own', () => {
  const r = photos.toRecord({ id: 7, file: 'x.jpg', captureTime: '2024-06-13T18:00:00', offset: '+02:00', gps: { lat: '51.5', lon: -0.12, dir: 270 }, keywords: ['sea', 5] });
  assert.deepEqual(r, { id: 7, file: 'x.jpg', captureTime: '2024-06-13T18:00:00+02:00', lat: 51.5, lon: -0.12, heading: 270, keywords: ['sea', '5'] });
});

test('photo record leaves a zoned time alone and ignores a malformed offset', () => {
  assert.equal(photos.toRecord({ id: 1, captureTime: '2024-06-13T18:00:00Z', offset: '+02:00' }).captureTime, '2024-06-13T18:00:00Z');
  assert.equal(photos.toRecord({ id: 1, captureTime: '2024-06-13T18:00:00-0500', offset: '+02:00' }).captureTime, '2024-06-13T18:00:00-0500');
  assert.equal(photos.toRecord({ id: 1, captureTime: '2024-06-13T18:00:00', offset: '+2' }).captureTime, '2024-06-13T18:00:00');
});

test('photo record with missing or unusable fields falls back to nulls', () => {
  assert.deepEqual(photos.toRecord({ id: 3 }), { id: 3, file: 'Photo 3', captureTime: null, lat: null, lon: null, heading: null, keywords: [] });
  const r = photos.toRecord({ id: 4, captureTime: 20240613, gps: { lat: 'north', lon: Infinity, dir: null }, keywords: 'sea' });
  assert.equal(r.captureTime, null);
  assert.equal(r.lat, null);
  assert.equal(r.lon, null);
  assert.equal(r.heading, null);
  assert.deepEqual(r.keywords, []);
  assert.equal(photos.toRecord({ id: 5, gps: 'nowhere' }).lat, null);
  assert.ok(Number.isNaN(photos.toRecord(null).id));
});

test('selection keeps photos with an id and reports count and truncation', async () => {
  const asked: string[] = [];
  const ext: any = { readDocument: async (name: string) => (asked.push(name), { photos: [{ id: 1, file: 'a.jpg' }, { file: 'stray' }, { id: '2' }], truncated: 1 }) };
  const s = await photos.readSelection(ext);
  assert.deepEqual(asked, ['selection']);
  assert.deepEqual(s.photos.map((p) => p.id), [1, 2]);
  assert.equal(s.count, 2);
  assert.equal(s.truncated, true);
  const big = await photos.readSelection({ readDocument: async () => ({ photos: [{ id: 9 }], count: 500, truncated: true }) } as any);
  assert.equal(big.count, 500);
  const none = await photos.readSelection({ readDocument: async () => null } as any);
  assert.deepEqual(none, { photos: [], count: 0, truncated: false });
});

test('capture stamp reads date, clock time and zone offset in the accepted forms', () => {
  assert.deepEqual(photos.parseStamp('2024-06-13T18:30:15+05:30'), { wall: Date.UTC(2024, 5, 13, 18, 30, 15), day: Date.UTC(2024, 5, 13), offset: 330 });
  assert.deepEqual(photos.parseStamp('2024-06-13 07:05'), { wall: Date.UTC(2024, 5, 13, 7, 5, 0), day: Date.UTC(2024, 5, 13), offset: null });
  assert.deepEqual(photos.parseStamp('  2024-01-02T03:04:05.678Z '), { wall: Date.UTC(2024, 0, 2, 3, 4, 5), day: Date.UTC(2024, 0, 2), offset: 0 });
  assert.equal(photos.parseStamp('2024-12-31T23:59:59-0330')!.offset, -210);
  assert.equal(photos.parseStamp('2024-12-31T23:59:59-00:30')!.offset, -30);
});

test('capture stamp refuses text that is not an iso date and time', () => {
  for (const bad of ['2024:06:13 07:05:09', '', '13/06/2024 07:05', '2024-06-13', '2024-06-13T7:05', 'yesterday']) {
    assert.equal(photos.parseStamp(bad), null, bad);
  }
});

test('zone estimate follows the nearest fifteen degree meridian', () => {
  assert.equal(photos.estimateOffset(0), 0);
  assert.equal(photos.estimateOffset(7.6), 60);
  assert.equal(photos.estimateOffset(-122.4), -480);
  assert.equal(photos.estimateOffset(139.7), 540);
  assert.equal(photos.estimateOffset(172.5), 720);
});

test('analysis says why a photo cannot be placed', () => {
  const cases: [any, string][] = [
    [rec('2024-06-13T18:00:00Z', null, 10), 'No location'],
    [rec('2024-06-13T18:00:00Z', 10, null), 'No location'],
    [rec(null, null, null), 'No location'],
    [rec(null, 10, 10), 'No capture time'],
    [rec('2024:06:13 18:00:00', 10, 10), 'Capture time not readable'],
  ];
  for (const [photo, reason] of cases) {
    const a = photos.analyse(photo, OPT);
    assert.equal(a.ok, false);
    assert.equal(a.reason, reason);
    assert.deepEqual(a.keywords, []);
    assert.equal(a.photo, photo);
  }
});

test('analysis prefers a chosen zone, then the photo offset, then an estimate', () => {
  const fromPhoto = placed('2024-03-20T20:00:00+02:00', 0, 30);
  assert.equal(fromPhoto.zoneSource, 'photo');
  assert.equal(fromPhoto.offsetMin, 120);
  assert.equal(fromPhoto.utc, Date.UTC(2024, 2, 20, 18));
  assert.equal(fromPhoto.events!.dayStart, Date.UTC(2024, 2, 19, 22));
  const guessed = placed('2024-03-20T20:00:00', 0, 30);
  assert.equal(guessed.zoneSource, 'estimated');
  assert.equal(guessed.offsetMin, 120);
  assert.equal(guessed.utc, Date.UTC(2024, 2, 20, 18));
  const chosen = placed('2024-03-20T20:00:00+02:00', 0, 30, null, { ...OPT, zone: -300 });
  assert.equal(chosen.zoneSource, 'chosen');
  assert.equal(chosen.utc, Date.UTC(2024, 2, 21, 1));
  assert.equal(chosen.events!.dayStart, Date.UTC(2024, 2, 20, 5));
  const utcChosen = placed('2024-03-20T20:00:00+02:00', 0, 30, null, { ...OPT, zone: 0 });
  assert.equal(utcChosen.zoneSource, 'chosen');
  assert.equal(utcChosen.utc, Date.UTC(2024, 2, 20, 20));
});

test('photos through an equinox day at the equator land in the right part of the day', () => {
  const cases: [string, string[]][] = [
    ['00:00', ['night']],
    ['05:07', ['astronomical-twilight', 'morning']],
    ['05:31', ['nautical-twilight', 'morning']],
    ['05:47', ['blue-hour', 'morning']],
    ['06:11', ['golden-hour', 'morning']],
    ['09:00', ['daylight']],
    ['12:00', ['high-sun']],
    ['18:00', ['golden-hour', 'evening']],
    ['18:28', ['blue-hour', 'evening']],
    ['18:44', ['nautical-twilight', 'evening']],
    ['19:08', ['astronomical-twilight', 'evening']],
  ];
  for (const [hm, leaves] of cases) {
    const a = placed(`2024-03-20T${hm}:00Z`, 0, 0, null, QUIET);
    assert.equal(a.kind, leaves[0], hm);
    assert.deepEqual(a.keywords, leaves.map((l) => `Light|${l}`), hm);
  }
});

test('camera heading against the sun gives backlit, side-lit or front-lit', () => {
  const at = (heading: number) => placed('2024-03-20T06:11:00Z', 0, 0, heading, QUIET);
  assert.deepEqual(at(135).keywords, ['Light|golden-hour', 'Light|morning', 'Light|backlit']);
  assert.deepEqual(at(180).keywords, ['Light|golden-hour', 'Light|morning', 'Light|side-lit']);
  assert.deepEqual(at(225).keywords, ['Light|golden-hour', 'Light|morning', 'Light|front-lit']);
  assert.equal(at(90).lighting, 'backlit');
  assert.equal(at(0).lighting, 'side-lit');
  assert.equal(at(270).lighting, 'front-lit');
});

test('no lighting label below the golden hour floor or with direction switched off', () => {
  const blue = placed('2024-03-20T05:47:00Z', 0, 0, 90, QUIET);
  assert.equal(blue.lighting, undefined);
  assert.deepEqual(blue.keywords, ['Light|blue-hour', 'Light|morning']);
  const off = placed('2024-03-20T06:11:00Z', 0, 0, 90, { ...QUIET, direction: false, timeOfDay: false });
  assert.equal(off.lighting, 'backlit');
  assert.deepEqual(off.keywords, ['Light|golden-hour']);
});

test('a full moon over a dark sky adds moonlit and a new moon does not', () => {
  assert.deepEqual(placed('2024-03-25T00:00:00Z', 0, 0).keywords, ['Light|night', 'Light|moonlit']);
  assert.deepEqual(placed('2024-04-08T00:00:00Z', 0, 0).keywords, ['Light|night']);
  assert.deepEqual(placed('2024-03-25T00:00:00Z', 0, 0, null, QUIET).keywords, ['Light|night']);
});

test('keywords hang under the chosen parent and a blank parent gives bare leaves', () => {
  assert.equal(photos.leafPath('  Sky  ', 'night'), 'Sky|night');
  assert.equal(photos.leafPath('   ', 'night'), 'night');
  assert.deepEqual(placed('2024-03-20T09:00:00Z', 0, 0, null, { ...QUIET, parent: '' }).keywords, ['daylight']);
  assert.deepEqual(placed('2024-03-20T09:00:00Z', 0, 0, null, { ...QUIET, parent: 'Mood|Light' }).keywords, ['Mood|Light|daylight']);
});

test('keyword operations replace only stale light keywords and group photos per keyword', () => {
  const photo = (id: number, keywords: string[]) => ({ id, file: `${id}.jpg`, captureTime: null, lat: null, lon: null, heading: null, keywords });
  const want = ['Light|golden-hour', 'Light|evening'];
  const list: any[] = [
    { photo: photo(1, ['Light|night', 'family', 'light|GOLDEN-HOUR', 'Mood|night']), ok: true, keywords: want },
    { photo: photo(2, ['Light|night']), ok: true, keywords: want },
    { photo: photo(3, ['Light|night']), ok: false, keywords: [] },
  ];
  const ops = photos.keywordOps(list, OPT);
  const kinds = ops.map((o) => o.command);
  assert.ok(kinds.lastIndexOf('photo.removeKeywords') < kinds.indexOf('photo.addKeywords'), 'removals come first');
  const key = (o: any) => `${o.command} ${o.args.keywords.join()}`;
  assert.deepEqual(
    [...ops].sort((p, q) => key(p).localeCompare(key(q))),
    [
      { command: 'photo.addKeywords', args: { ids: [1, 2], keywords: ['Light|evening'] } },
      { command: 'photo.addKeywords', args: { ids: [2], keywords: ['Light|golden-hour'] } },
      { command: 'photo.removeKeywords', args: { ids: [1, 2], keywords: ['Light|night'] } },
    ],
  );
  assert.deepEqual(photos.keywordOps([{ photo: photo(4, ['Light|daylight']), ok: true, keywords: ['Light|daylight'] }] as any, OPT), []);
});
