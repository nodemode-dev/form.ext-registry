import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT,
  angleBetween,
  compass,
  dayEvents,
  isRising,
  lightKind,
  moonPosition,
  phaseName,
  sunPosition,
} from '../../../extensions/golden-hour/src/astro.ts';
import type { DayEvents } from '../../../extensions/golden-hour/src/astro.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

function localMidnight(y: number, m: number, d: number, lon: number) {
  return Date.UTC(y, m - 1, d) - Math.round((lon / 15) * HOUR);
}

function events(y: number, m: number, d: number, lat: number, lon: number) {
  return dayEvents(localMidnight(y, m, d, lon), lat, lon);
}

function near(actual: number | null, expected: number, tol: number, label: string) {
  assert.notEqual(actual, null, `${label} is null`);
  const diff = Math.abs((actual as number) - expected);
  assert.ok(diff <= tol, `${label}: off by ${(diff / MIN).toFixed(2)} min, allowed ${(tol / MIN).toFixed(2)}`);
}

function close(actual: number, expected: number, tol: number, label: string) {
  assert.ok(Number.isFinite(actual), `${label} is not finite`);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: got ${actual}, expected ${expected} within ${tol}`);
}

function dayLength(e: DayEvents) {
  assert.notEqual(e.sunrise, null);
  assert.notEqual(e.sunset, null);
  return (e.sunset as number) - (e.sunrise as number);
}

function allTimes(e: DayEvents): (number | null)[] {
  return [
    e.noon,
    e.sunrise,
    e.sunset,
    e.goldenMorning.start,
    e.goldenMorning.end,
    e.goldenEvening.start,
    e.goldenEvening.end,
    e.blueMorning.start,
    e.blueMorning.end,
    e.blueEvening.start,
    e.blueEvening.end,
    e.civilDawn,
    e.civilDusk,
    e.nauticalDawn,
    e.nauticalDusk,
    e.astroDawn,
    e.astroDusk,
    e.moonrise,
    e.moonset,
  ];
}

function assertNoNaN(e: DayEvents) {
  for (const t of allTimes(e)) {
    if (t !== null) assert.ok(Number.isFinite(t), `time ${t} is not finite`);
  }
  assert.ok(Number.isFinite(e.noonAltitude));
  for (const s of e.samples) {
    assert.ok(Number.isFinite(s.sun.altitude) && Number.isFinite(s.sun.azimuth));
    assert.ok(Number.isFinite(s.moon.altitude) && Number.isFinite(s.moon.azimuth));
  }
}

const LONDON = { lat: 51.5074, lon: -0.1278 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };
const TROMSO = { lat: 69.6492, lon: 18.9553 };
const NEW_YORK = { lat: 40.7128, lon: -74.006 };

test('equator at the March equinox has about 12 h 07 min of daylight', () => {
  const e = events(2024, 3, 20, 0, 0);
  close(dayLength(e) / MIN, 727, 3, 'day length in minutes');
});

test('equator at the March equinox has solar noon about seven and a half minutes after 12:00 UTC', () => {
  const e = events(2024, 3, 20, 0, 0);
  near(e.noon, Date.UTC(2024, 2, 20, 12, 7, 30), 2 * MIN, 'solar noon');
});

test('equator at the March equinox has the sun nearly overhead at noon', () => {
  const e = events(2024, 3, 20, 0, 0);
  close(e.noonAltitude, 90, 0.5, 'noon altitude');
});

test('equinox sun rises due east and sets due west at the equator', () => {
  const e = events(2024, 3, 20, 0, 0);
  close(sunPosition(e.sunrise as number, 0, 0).azimuth, 90, 1.5, 'sunrise azimuth');
  close(sunPosition(e.sunset as number, 0, 0).azimuth, 270, 1.5, 'sunset azimuth');
});

test('London June solstice sunrise and sunset match the almanac', () => {
  const e = events(2024, 6, 20, LONDON.lat, LONDON.lon);
  near(e.sunrise, Date.UTC(2024, 5, 20, 3, 43), 4 * MIN, 'sunrise');
  near(e.sunset, Date.UTC(2024, 5, 20, 20, 21), 4 * MIN, 'sunset');
  close(dayLength(e) / MIN, 16 * 60 + 38, 5, 'day length in minutes');
});

test('London December solstice sunrise and sunset match the almanac', () => {
  const e = events(2024, 12, 21, LONDON.lat, LONDON.lon);
  near(e.sunrise, Date.UTC(2024, 11, 21, 8, 4), 4 * MIN, 'sunrise');
  near(e.sunset, Date.UTC(2024, 11, 21, 15, 53), 4 * MIN, 'sunset');
  close(dayLength(e) / MIN, 7 * 60 + 50, 5, 'day length in minutes');
});

test('New York June solstice sunrise and sunset match the almanac', () => {
  const e = events(2024, 6, 20, NEW_YORK.lat, NEW_YORK.lon);
  near(e.sunrise, Date.UTC(2024, 5, 20, 9, 25), 4 * MIN, 'sunrise');
  near(e.sunset, Date.UTC(2024, 5, 21, 0, 30), 4 * MIN, 'sunset');
});

test('noon altitude equals 90 minus latitude plus declination at both solstices in London', () => {
  const june = events(2024, 6, 20, LONDON.lat, LONDON.lon);
  const dec = events(2024, 12, 21, LONDON.lat, LONDON.lon);
  close(june.noonAltitude, 90 - LONDON.lat + 23.44, 0.15, 'June noon altitude');
  close(dec.noonAltitude, 90 - LONDON.lat - 23.44, 0.15, 'December noon altitude');
});

test('noon altitude equals 90 minus latitude at both equinoxes in London', () => {
  const march = events(2024, 3, 20, LONDON.lat, LONDON.lon);
  const sept = events(2024, 9, 22, LONDON.lat, LONDON.lon);
  close(march.noonAltitude, 90 - LONDON.lat, 0.3, 'March noon altitude');
  close(sept.noonAltitude, 90 - LONDON.lat, 0.3, 'September noon altitude');
});

test('noon sun is due south in London and due north in Sydney', () => {
  const lon = events(2024, 6, 20, LONDON.lat, LONDON.lon);
  const syd = events(2024, 6, 20, SYDNEY.lat, SYDNEY.lon);
  close(sunPosition(lon.noon, LONDON.lat, LONDON.lon).azimuth, 180, 1.5, 'London noon azimuth');
  assert.ok(angleBetween(sunPosition(syd.noon, SYDNEY.lat, SYDNEY.lon).azimuth, 0) < 1.5);
});

test('equation of time moves solar noon early in November and late in February', () => {
  const nov = events(2024, 11, 3, 0, 0);
  const feb = events(2024, 2, 11, 0, 0);
  near(nov.noon, Date.UTC(2024, 10, 3, 11, 43, 35), 2 * MIN, 'November noon');
  near(feb.noon, Date.UTC(2024, 1, 11, 12, 14, 12), 2 * MIN, 'February noon');
});

test('solar noon lies midway between sunrise and sunset', () => {
  const e = events(2024, 6, 20, LONDON.lat, LONDON.lon);
  const mid = ((e.sunrise as number) + (e.sunset as number)) / 2;
  near(e.noon, mid, 2 * MIN, 'noon against midpoint');
});

test('southern hemisphere seasons are reversed in Sydney', () => {
  const dec = events(2024, 12, 21, SYDNEY.lat, SYDNEY.lon);
  const june = events(2024, 6, 21, SYDNEY.lat, SYDNEY.lon);
  close(dayLength(dec) / MIN, 14 * 60 + 25, 6, 'December day length');
  close(dayLength(june) / MIN, 9 * 60 + 54, 6, 'June day length');
  close(dec.noonAltitude, 90 - 33.8688 + 23.44, 0.15, 'December noon altitude');
  close(june.noonAltitude, 90 - 33.8688 - 23.44, 0.15, 'June noon altitude');
});

test('Sydney December solstice sunrise and sunset match the almanac', () => {
  const e = events(2024, 12, 21, SYDNEY.lat, SYDNEY.lon);
  near(e.sunrise, Date.UTC(2024, 11, 20, 18, 41), 4 * MIN, 'sunrise');
  near(e.sunset, Date.UTC(2024, 11, 21, 9, 5), 4 * MIN, 'sunset');
});

test('polar day in Tromso at the June solstice has no sunrise or sunset', () => {
  const e = events(2024, 6, 21, TROMSO.lat, TROMSO.lon);
  assert.equal(e.polar, 'day');
  assert.equal(e.sunrise, null);
  assert.equal(e.sunset, null);
  assert.equal(e.civilDawn, null);
  assert.equal(e.civilDusk, null);
  assert.equal(e.astroDawn, null);
  assert.ok(Math.min(...e.samples.map((s) => s.sun.altitude)) > 0);
  close(e.noonAltitude, 90 - TROMSO.lat + 23.44, 0.15, 'noon altitude');
  assertNoNaN(e);
});

test('polar night in Tromso at the December solstice has no sunrise or sunset', () => {
  const e = events(2024, 12, 21, TROMSO.lat, TROMSO.lon);
  assert.equal(e.polar, 'night');
  assert.equal(e.sunrise, null);
  assert.equal(e.sunset, null);
  close(e.noonAltitude, 90 - TROMSO.lat - 23.44, 0.15, 'noon altitude');
  assert.notEqual(e.civilDawn, null);
  assert.notEqual(e.civilDusk, null);
  assert.ok((e.civilDawn as number) < e.noon && e.noon < (e.civilDusk as number));
  assertNoNaN(e);
});

test('the poles return finite results with no rise or set at the solstices', () => {
  const north = events(2024, 6, 21, 90, 0);
  const south = events(2024, 6, 21, -90, 0);
  assert.equal(north.polar, 'day');
  assert.equal(south.polar, 'night');
  assert.equal(north.sunrise, null);
  assert.equal(south.sunset, null);
  close(north.samples[100].sun.altitude, 23.44, 0.1, 'north pole sun altitude');
  close(south.samples[100].sun.altitude, -23.44, 0.1, 'south pole sun altitude');
  assertNoNaN(north);
  assertNoNaN(south);
});

test('an ordinary mid latitude day is not polar', () => {
  assert.equal(events(2024, 6, 20, LONDON.lat, LONDON.lon).polar, null);
  assert.equal(events(2024, 12, 21, LONDON.lat, LONDON.lon).polar, null);
});

test('morning events run in order from astronomical dawn to the end of golden hour', () => {
  const e = events(2024, 3, 20, 40, 0);
  const seq = [e.astroDawn, e.nauticalDawn, e.civilDawn, e.blueMorning.end, e.sunrise, e.goldenMorning.end, e.noon];
  for (let i = 1; i < seq.length; i++) {
    assert.notEqual(seq[i - 1], null);
    assert.notEqual(seq[i], null);
    assert.ok((seq[i - 1] as number) < (seq[i] as number), `morning step ${i} out of order`);
  }
  assert.equal(e.blueMorning.start, e.civilDawn);
  assert.equal(e.goldenMorning.start, e.blueMorning.end);
});

test('evening events run in order from the start of golden hour to astronomical dusk', () => {
  const e = events(2024, 3, 20, 40, 0);
  const seq = [e.noon, e.goldenEvening.start, e.sunset, e.goldenEvening.end, e.civilDusk, e.nauticalDusk, e.astroDusk];
  for (let i = 1; i < seq.length; i++) {
    assert.notEqual(seq[i - 1], null);
    assert.notEqual(seq[i], null);
    assert.ok((seq[i - 1] as number) < (seq[i] as number), `evening step ${i} out of order`);
  }
  assert.equal(e.blueEvening.end, e.civilDusk);
  assert.equal(e.blueEvening.start, e.goldenEvening.end);
});

test('golden and blue hour boundaries sit at the documented sun altitudes', () => {
  const e = events(2024, 3, 20, 40, 0);
  const alt = (t: number | null) => sunPosition(t as number, 40, 0).altitude;
  close(alt(e.goldenMorning.start), -4, 0.02, 'golden morning start');
  close(alt(e.goldenMorning.end), 6, 0.02, 'golden morning end');
  close(alt(e.goldenEvening.start), 6, 0.02, 'golden evening start');
  close(alt(e.goldenEvening.end), -4, 0.02, 'golden evening end');
  close(alt(e.blueMorning.start), -6, 0.02, 'blue morning start');
  close(alt(e.blueEvening.end), -6, 0.02, 'blue evening end');
  close(alt(e.sunrise), -0.833, 0.02, 'sunrise');
  close(alt(e.sunset), -0.833, 0.02, 'sunset');
  close(alt(e.nauticalDawn), -12, 0.02, 'nautical dawn');
  close(alt(e.astroDusk), -18, 0.02, 'astronomical dusk');
});

test('equator equinox twilight lasts as long as the sun needs at 15 degrees per hour', () => {
  const e = events(2024, 3, 20, 0, 0);
  close(((e.goldenMorning.end as number) - (e.goldenMorning.start as number)) / MIN, 40, 1.5, 'golden morning minutes');
  close(((e.goldenEvening.end as number) - (e.goldenEvening.start as number)) / MIN, 40, 1.5, 'golden evening minutes');
  close(((e.blueMorning.end as number) - (e.blueMorning.start as number)) / MIN, 8, 0.75, 'blue morning minutes');
  close(((e.sunrise as number) - (e.civilDawn as number)) / MIN, 20.7, 1, 'civil dawn to sunrise minutes');
  close(((e.astroDusk as number) - (e.sunset as number)) / MIN, 68.7, 1.5, 'sunset to astronomical dusk minutes');
});

test('golden hour is longer at high latitude than at the equator', () => {
  const eq = events(2024, 3, 20, 0, 0);
  const hi = events(2024, 3, 20, 60, 0);
  const span = (e: DayEvents) => (e.goldenEvening.end as number) - (e.goldenEvening.start as number);
  assert.ok(span(hi) > span(eq) * 1.8);
});

test('longitude shifts every event by four minutes per degree', () => {
  const a = events(2024, 3, 20, 40, 0);
  const b = events(2024, 3, 20, 40, 15);
  const c = events(2024, 3, 20, 40, -30);
  near(b.sunrise, (a.sunrise as number) - 60 * MIN, MIN, 'sunrise 15 east');
  near(b.sunset, (a.sunset as number) - 60 * MIN, MIN, 'sunset 15 east');
  near(b.noon, a.noon - 60 * MIN, MIN, 'noon 15 east');
  near(c.sunrise, (a.sunrise as number) + 120 * MIN, MIN, 'sunrise 30 west');
  near(c.goldenEvening.start, (a.goldenEvening.start as number) + 120 * MIN, MIN, 'golden evening 30 west');
});

test('results are continuous across the date line', () => {
  const start = Date.UTC(2024, 3, 9, 12);
  const east = dayEvents(start, 35, 179.9);
  const west = dayEvents(start, 35, -179.9);
  near(west.sunrise, (east.sunrise as number) - 0.8 * MIN, 10_000, 'sunrise');
  near(west.sunset, (east.sunset as number) - 0.8 * MIN, 10_000, 'sunset');
  near(west.noon, east.noon - 0.8 * MIN, 10_000, 'noon');
  const exact = dayEvents(start, 35, 180);
  const minus = dayEvents(start, 35, -180);
  assert.equal(exact.sunrise, minus.sunrise);
  assert.equal(exact.sunset, minus.sunset);
  assert.ok((west.sunrise as number) < (exact.sunrise as number) && (exact.sunrise as number) < (east.sunrise as number));
  assertNoNaN(exact);
});

test('sun position is continuous across the date line and the prime meridian', () => {
  const t = Date.UTC(2024, 7, 1, 3, 30);
  const e = sunPosition(t, 20, 179.999);
  const w = sunPosition(t, 20, -179.999);
  close(e.altitude, w.altitude, 0.01, 'altitude at date line');
  assert.ok(angleBetween(e.azimuth, w.azimuth) < 0.05);
  const p = sunPosition(t, 20, 0.001);
  const q = sunPosition(t, 20, -0.001);
  close(p.altitude, q.altitude, 0.01, 'altitude at prime meridian');
  assert.ok(angleBetween(p.azimuth, q.azimuth) < 0.05);
});

test('latitude 0 longitude 0 gives finite and continuous results', () => {
  const zero = events(2024, 8, 1, 0, 0);
  const north = events(2024, 8, 1, 0.01, 0.01);
  const south = events(2024, 8, 1, -0.01, -0.01);
  assertNoNaN(zero);
  assert.equal(zero.polar, null);
  near(north.sunrise, zero.sunrise as number, 15_000, 'sunrise just north east');
  near(south.sunrise, zero.sunrise as number, 15_000, 'sunrise just south west');
  near(north.sunset, zero.sunset as number, 15_000, 'sunset just north east');
  close(dayLength(zero) / MIN, 727, 3, 'equator day length in minutes');
});

test('sun position at Greenwich at the J2000 epoch matches the almanac', () => {
  const p = sunPosition(Date.UTC(2000, 0, 1, 12), 51.4779, 0);
  close(p.altitude, 90 - 51.4779 - 23.03, 0.2, 'altitude');
  close(p.azimuth, 179.2, 1, 'azimuth');
});

test('the sun is overhead at the subsolar point of the June solstice', () => {
  const t = Date.UTC(2024, 5, 20, 20, 51);
  const lon = -(20 + 51 / 60 - 12 - 1.75 / 60) * 15;
  close(sunPosition(t, 23.44, lon).altitude, 90, 0.5, 'subsolar altitude');
  close(sunPosition(t, -23.44, lon + 180).altitude, -90, 0.5, 'antipode altitude');
});

test('azimuth stays within 0 to 360 and altitude within plus or minus 90', () => {
  for (const lat of [-90, -60, -23.44, 0, 23.44, 60, 90]) {
    for (const lon of [-180, -90, 0, 90, 180]) {
      for (let h = 0; h < 24; h += 3) {
        const p = sunPosition(Date.UTC(2024, 5, 20, h), lat, lon);
        assert.ok(p.azimuth >= 0 && p.azimuth < 360, `azimuth ${p.azimuth}`);
        assert.ok(p.altitude >= -90 && p.altitude <= 90, `altitude ${p.altitude}`);
      }
    }
  }
});

test('the sun is rising in the morning and falling in the afternoon', () => {
  const e = events(2024, 6, 20, LONDON.lat, LONDON.lon);
  assert.equal(isRising(e.sunrise as number, LONDON.lat, LONDON.lon), true);
  assert.equal(isRising(e.sunset as number, LONDON.lat, LONDON.lon), false);
  assert.equal(isRising(e.noon - 2 * HOUR, LONDON.lat, LONDON.lon), true);
  assert.equal(isRising(e.noon + 2 * HOUR, LONDON.lat, LONDON.lon), false);
});

test('samples cover the day every five minutes from the day start', () => {
  const start = localMidnight(2024, 6, 20, LONDON.lon);
  const e = dayEvents(start, LONDON.lat, LONDON.lon);
  assert.equal(e.dayStart, start);
  assert.equal(e.samples.length, 289);
  assert.equal(e.samples[0].t, start);
  assert.equal(e.samples[288].t, start + 24 * HOUR);
  assert.equal(e.samples[1].t - e.samples[0].t, 5 * MIN);
  assert.ok(Math.max(...e.samples.map((s) => s.sun.altitude)) <= e.noonAltitude + 1e-6);
});

test('light kind follows the documented altitude bands', () => {
  assert.equal(lightKind(-30), 'night');
  assert.equal(lightKind(-15), 'astronomical-twilight');
  assert.equal(lightKind(-9), 'nautical-twilight');
  assert.equal(lightKind(-5), 'blue-hour');
  assert.equal(lightKind(0), 'golden-hour');
  assert.equal(lightKind(5.9), 'golden-hour');
  assert.equal(lightKind(20), 'daylight');
  assert.equal(lightKind(70), 'high-sun');
  assert.equal(lightKind(ALT.civil), 'blue-hour');
  assert.equal(lightKind(ALT.goldenLow), 'golden-hour');
  assert.equal(lightKind(ALT.goldenTop), 'daylight');
});

test('compass names the sixteen points and wraps around north', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(90), 'E');
  assert.equal(compass(180), 'S');
  assert.equal(compass(270), 'W');
  assert.equal(compass(45), 'NE');
  assert.equal(compass(202.5), 'SSW');
  assert.equal(compass(359), 'N');
  assert.equal(compass(-90), 'W');
  assert.equal(compass(450), 'E');
});

test('angle between bearings takes the short way round', () => {
  assert.equal(angleBetween(350, 10), 20);
  assert.equal(angleBetween(10, 350), 20);
  assert.equal(angleBetween(0, 180), 180);
  assert.equal(angleBetween(90, 90), 0);
  assert.equal(angleBetween(-10, 10), 20);
  assert.equal(angleBetween(725, 5), 0);
});

test('moon is nearly dark at the April 2024 solar eclipse and nearly full two weeks later', () => {
  const dark = moonPosition(Date.UTC(2024, 3, 8, 18, 21), 0, 0);
  const full = moonPosition(Date.UTC(2024, 3, 23, 23, 49), 0, 0);
  assert.ok(dark.fraction < 0.01, `new moon fraction ${dark.fraction}`);
  assert.ok(full.fraction > 0.99, `full moon fraction ${full.fraction}`);
  assert.equal(dark.phaseName, 'New moon');
  assert.equal(full.phaseName, 'Full moon');
  close(full.phase, 0.5, 0.03, 'full moon phase');
  assert.ok(dark.distanceKm > 356_000 && dark.distanceKm < 407_000);
});

test('moon at first and last quarter is half lit with the right name', () => {
  const firstQ = moonPosition(Date.UTC(2024, 3, 15, 19, 13), 0, 0);
  const lastQ = moonPosition(Date.UTC(2024, 4, 1, 11, 27), 0, 0);
  close(firstQ.fraction, 0.5, 0.05, 'first quarter fraction');
  close(lastQ.fraction, 0.5, 0.05, 'last quarter fraction');
  assert.equal(firstQ.phaseName, 'First quarter');
  assert.equal(lastQ.phaseName, 'Last quarter');
});

test('phase name maps the cycle to eight names and wraps at one', () => {
  assert.equal(phaseName(0), 'New moon');
  assert.equal(phaseName(0.125), 'Waxing crescent');
  assert.equal(phaseName(0.25), 'First quarter');
  assert.equal(phaseName(0.375), 'Waxing gibbous');
  assert.equal(phaseName(0.5), 'Full moon');
  assert.equal(phaseName(0.625), 'Waning gibbous');
  assert.equal(phaseName(0.75), 'Last quarter');
  assert.equal(phaseName(0.875), 'Waning crescent');
  assert.equal(phaseName(0.99), 'New moon');
  assert.equal(phaseName(1), 'New moon');
});

test('full moon rises near sunset and sets near sunrise', () => {
  const e = events(2024, 4, 23, 40, 0);
  near(e.moonrise, e.sunset as number, 75 * MIN, 'moonrise against sunset');
  near(e.moonset, e.sunrise as number, 75 * MIN, 'moonset against sunrise');
});
