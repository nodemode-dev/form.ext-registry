import { test } from "node:test";
import assert from "node:assert/strict";
import { stamp, parseStamp, isWebUrl, check, toJson, fromJson, endsMs, JsonError } from "../../../extensions/podcast-chapters/src/chapters.ts";
import type { Chapter, Extra } from "../../../extensions/podcast-chapters/src/chapters.ts";
import { frameAt, durationMs, NotMp3Error } from "../../../extensions/podcast-chapters/src/mp3.ts";
import { ops } from "../../../extensions/podcast-chapters/src/ops.ts";
import { adapt, samples } from "../../../extensions/podcast-chapters/src/session.ts";

const ch = (start: number, title = "T", extra: Extra = {}, end?: number): Chapter => ({
  key: `k${start}`,
  kind: "marker",
  refId: `m${start}`,
  start,
  title,
  extra,
  ...(end !== undefined ? { end } : {}),
});

const close = (actual: number, expected: number, eps = 1e-6): void => {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected} but got ${actual}`);
};

const frames = (n: number, header: number[] = [0xff, 0xfb, 0x90, 0x00], size = 417): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(...header);
    for (let j = 4; j < size; j++) out.push(0);
  }
  return out;
};

const noStep = async (): Promise<void> => {};

test("stamp writes hours, minutes, seconds and milliseconds", () => {
  assert.equal(stamp(3723), "1:02:03.000");
  assert.equal(stamp(36000), "10:00:00.000");
});

test("stamp leaves out the hour and keeps one digit of minutes under an hour", () => {
  assert.equal(stamp(62.5), "1:02.500");
  assert.equal(stamp(0), "0:00.000");
  assert.equal(stamp(5.007), "0:05.007");
});

test("stamp clamps negative times to zero and rounds up to the next minute", () => {
  assert.equal(stamp(-4), "0:00.000");
  assert.equal(stamp(59.9996), "1:00.000");
});

test("parseStamp reads hours, minutes and seconds", () => {
  assert.equal(parseStamp("1:02:03"), 3723);
  assert.equal(parseStamp("62:03"), 3723);
  assert.equal(parseStamp("90"), 90);
  assert.equal(parseStamp("  5:00 "), 300);
});

test("parseStamp reads milliseconds with a dot or a comma", () => {
  assert.equal(parseStamp("1:02:03.250"), 3723.25);
  assert.equal(parseStamp("1:02.5"), 62.5);
  assert.equal(parseStamp("0:01,5"), 1.5);
});

test("parseStamp refuses text that is not a time", () => {
  for (const bad of ["", "abc", "-1", "1:2:3:4", "1:234", "1:", ":30", "1.2.3", "1:02:03s", "1 : 02"]) {
    assert.equal(parseStamp(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("parseStamp reads back what stamp wrote", () => {
  assert.equal(parseStamp(stamp(3723.25)), 3723.25);
  assert.equal(parseStamp(stamp(45.5)), 45.5);
});

test("isWebUrl accepts http and https only", () => {
  assert.equal(isWebUrl("https://example.com/a?b=1"), true);
  assert.equal(isWebUrl("http://example.com"), true);
  for (const bad of ["ftp://example.com", "example.com", "javascript:alert(1)", "", "mailto:a@b.c"]) {
    assert.equal(isWebUrl(bad), false, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("check finds nothing wrong with an empty list or a clean list", () => {
  assert.deepEqual(check([], 100), []);
  assert.deepEqual(check([ch(0, "Intro"), ch(30, "Main", { url: "https://a.example" })], 100), []);
});

test("check names a chapter with a blank title", () => {
  assert.deepEqual(check([ch(0, "A"), ch(30, "   ")], 100), [{ key: "k30", field: "title", text: "Chapter 2 has no title." }]);
});

test("check flags a link and an image link that are not web addresses", () => {
  const out = check([ch(0, "A", { url: "example.com", img: "ftp://x/y.png" })], null);
  assert.deepEqual(out, [
    { key: "k0", field: "url", text: "Chapter 1's link is not a web address (it should start with https://)." },
    { key: "k0", field: "img", text: "Chapter 1's image link is not a web address." },
  ]);
});

test("check flags a chapter that starts at or after the session end", () => {
  const out = check([ch(0, "A"), ch(100, "B"), ch(120, "C")], 100);
  assert.deepEqual(out, [
    { key: "k100", field: "start", text: "Chapter 2 starts after the session ends (1:40.000)." },
    { key: "k120", field: "start", text: "Chapter 3 starts after the session ends (1:40.000)." },
  ]);
});

test("check skips the end test when the length is unknown or zero", () => {
  assert.deepEqual(check([ch(0), ch(500)], null), []);
  assert.deepEqual(check([ch(0), ch(500)], 0), []);
});

test("check flags two chapters less than a second apart but not exactly one second", () => {
  assert.deepEqual(check([ch(0), ch(0.5)], 100), [{ key: "k0.5", field: "start", text: "Chapter 2 starts less than a second after the one before it." }]);
  assert.deepEqual(check([ch(0), ch(1)], 100), []);
});

test("check warns when the first chapter starts after half a second", () => {
  assert.deepEqual(check([ch(5)], 100), [{ text: "The first chapter starts at 0:05.000; most apps show nothing before it. Add a chapter at 0:00 for the opening." }]);
  assert.deepEqual(check([ch(0.5)], 100), []);
});

test("toJson writes the Podcasting 2.0 shape with trimmed values", () => {
  const text = toJson(
    [ch(0, " Intro ", { url: " https://a.example/x " }, 10), ch(10.12345, "Main", { hidden: true, img: "https://i.example/p.png" })],
    { title: " Show 12 ", podcastName: "Pod" },
  );
  assert.ok(text.startsWith('{\n  "version": "1.2.0"'));
  assert.ok(text.endsWith("}\n"));
  assert.deepEqual(JSON.parse(text), {
    version: "1.2.0",
    title: "Show 12",
    podcastName: "Pod",
    chapters: [
      { startTime: 0, endTime: 10, title: "Intro", url: "https://a.example/x" },
      { startTime: 10.123, title: "Main", img: "https://i.example/p.png", toc: false },
    ],
  });
});

test("toJson leaves out blank episode names, blank links and an empty chapter list", () => {
  const parsed = JSON.parse(toJson([ch(0, "A", { url: "   ", img: "" })], { title: "  ", podcastName: undefined }));
  assert.deepEqual(parsed, { version: "1.2.0", chapters: [{ startTime: 0, title: "A" }] });
  assert.deepEqual(JSON.parse(toJson([], {})), { version: "1.2.0", chapters: [] });
});

test("fromJson reads chapters, sorts them by start and reads the episode", () => {
  const text = JSON.stringify({
    title: "Show",
    podcastName: "Pod",
    chapters: [
      { startTime: 60, title: "Late", url: "https://a.example", toc: false },
      { startTime: 0, endTime: 30, title: "Early", img: "https://i.example/p.png" },
      { startTime: 30, title: "Mid" },
    ],
  });
  const out = fromJson(text);
  assert.deepEqual(out.episode, { title: "Show", podcastName: "Pod" });
  assert.deepEqual(out.chapters, [
    { startTime: 0, endTime: 30, title: "Early", img: "https://i.example/p.png" },
    { startTime: 30, title: "Mid" },
    { startTime: 60, title: "Late", url: "https://a.example", toc: false },
  ]);
});

test("fromJson skips entries without a good start and drops an end that is not after the start", () => {
  const out = fromJson(JSON.stringify({ chapters: [{ title: "none" }, { startTime: -3, title: "neg" }, { startTime: "x" }, null, { startTime: 10, endTime: 10, title: 5 }, { startTime: 20, endTime: 15, toc: true }] }));
  assert.deepEqual(out.chapters, [
    { startTime: 10, title: "" },
    { startTime: 20, title: "" },
  ]);
  assert.deepEqual(out.episode, {});
});

test("fromJson keeps chapters that share a start time", () => {
  const out = fromJson(JSON.stringify({ chapters: [{ startTime: 5, title: "one" }, { startTime: 5, title: "two" }] }));
  assert.deepEqual(out.chapters.map((c) => c.title), ["one", "two"]);
});

test("fromJson refuses text that is not a chapters file", () => {
  assert.throws(() => fromJson("not json"), JsonError);
  assert.throws(() => fromJson("null"), JsonError);
  assert.throws(() => fromJson("5"), JsonError);
  assert.throws(() => fromJson('{"title":"x"}'), JsonError);
  assert.throws(() => fromJson('{"chapters":[]}'), JsonError);
  assert.throws(() => fromJson('{"chapters":[{"title":"no start"}]}'), JsonError);
});

test("toJson then fromJson gives back the same starts, ends and titles", () => {
  const out = fromJson(toJson([ch(0, "A", {}, 12.5), ch(12.5, "B")], { title: "E" }));
  assert.deepEqual(out.chapters, [
    { startTime: 0, endTime: 12.5, title: "A" },
    { startTime: 12.5, title: "B" },
  ]);
  assert.deepEqual(out.episode, { title: "E" });
});

test("endsMs ends each chapter where the next starts and the last at the length", () => {
  assert.deepEqual(endsMs([ch(0), ch(10), ch(20)], 30000), [10000, 20000, 30000]);
  assert.deepEqual(endsMs([], 30000), []);
});

test("endsMs keeps a region's own end and clamps it to the length", () => {
  assert.deepEqual(endsMs([ch(0, "R", {}, 5), ch(10, "S", {}, 50)], 30000), [5000, 30000]);
});

test("endsMs gives a chapter at least one millisecond", () => {
  assert.deepEqual(endsMs([ch(10), ch(10)], 30000), [10001, 30000]);
  assert.deepEqual(endsMs([ch(40)], 30000), [40001]);
});

test("ops build the marker and region commands", () => {
  assert.deepEqual(ops.addMarker(5, "Intro"), { command: "add-marker", args: { at: 5, label: "Intro" } });
  assert.deepEqual(ops.addRegion(1, 9, "Talk"), { command: "add-region", args: { start: 1, end: 9, label: "Talk" } });
});

test("ops pick the marker or region command from the chapter kind", () => {
  const marker = ch(3);
  const region: Chapter = { ...ch(4), kind: "region", refId: "r4" };
  assert.deepEqual(ops.rename(marker, "X"), { command: "set-marker", args: { markerId: "m3", label: "X" } });
  assert.deepEqual(ops.rename(region, "X"), { command: "set-region", args: { regionId: "r4", label: "X" } });
  assert.deepEqual(ops.move(marker, 7), { command: "set-marker", args: { markerId: "m3", at: 7 } });
  assert.deepEqual(ops.move(region, 7), { command: "set-region", args: { regionId: "r4", start: 7 } });
  assert.deepEqual(ops.remove(marker), { command: "remove-marker", args: { markerId: "m3" } });
  assert.deepEqual(ops.remove(region), { command: "remove-region", args: { regionId: "r4" } });
});

test("adapt gives safe defaults for an empty or missing session", () => {
  const empty = { rate: 48000, lengthS: null, playheadS: null, name: null, markers: [], regions: [] };
  assert.deepEqual(adapt(null), empty);
  assert.deepEqual(adapt({}), empty);
});

test("adapt reads seconds fields and converts sample fields with the rate", () => {
  const snap = adapt({
    sample_rate: 44100,
    length_s: 12,
    playhead_s: 3.5,
    saved_as: "ep.wav",
    name: "ignored",
    markers: [{ id: "a", at_s: 2, label: "One" }, { id: "b", at: 88200, name: "Two" }, { label: "no id", at_s: 1 }],
    regions: [{ id: "r", start_s: 1, end_s: 2, label: "R" }, { regionId: "q", start: 44100, end: 132300, name: "Q" }, { start_s: 3, end_s: 4 }],
  });
  assert.equal(snap.rate, 44100);
  assert.equal(snap.lengthS, 12);
  assert.equal(snap.playheadS, 3.5);
  assert.equal(snap.name, "ep.wav");
  assert.deepEqual(snap.markers, [{ id: "a", atS: 2, label: "One" }, { id: "b", atS: 2, label: "Two" }]);
  assert.deepEqual(snap.regions, [
    { id: "r", startS: 1, endS: 2, label: "R" },
    { id: "q", startS: 1, endS: 3, label: "Q" },
    { id: null, startS: 3, endS: 4, label: "" },
  ]);
});

test("adapt looks inside a document wrapper and lets the inner values win", () => {
  const snap = adapt({ sample_rate: 8000, document: { markers: [{ id: "m", at: 16000 }], sample_rate: 16000 } });
  assert.equal(snap.rate, 16000);
  assert.deepEqual(snap.markers, [{ id: "m", atS: 1, label: "" }]);
});

test("adapt works out the length from the furthest clip end", () => {
  const snap = adapt({ sample_rate: 1000, tracks: [{ clips: [{ start_s: 1, length_s: 4 }, { end_s: 3 }] }, { clips: [{ start: 500, length: 1500 }] }] });
  assert.equal(snap.lengthS, 5);
  assert.equal(adapt({ tracks: [] }).lengthS, 0);
});

test("adapt reads the playhead from the transport sample position", () => {
  assert.equal(adapt({ sample_rate: 1000, transport: { positionSamples: 2500 } }).playheadS, 2.5);
  assert.equal(adapt({ sample_rate: 1000, playhead: 500 }).playheadS, 0.5);
});

test("samples rounds to whole samples and never goes below zero", () => {
  assert.equal(samples(1.5, 48000), 72000);
  assert.equal(samples(0.00001, 44100), 0);
  assert.equal(samples(-2, 44100), 0);
  assert.equal(samples(1 / 3, 44100), 14700);
});

test("frameAt reads MPEG-1 Layer III 128 kbit/s 44100 Hz as 417 bytes and 1152 samples", () => {
  const info = frameAt(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]), 0);
  assert.deepEqual(info, { size: 417, samples: 1152, rate: 44100, mpeg1: true, mono: false });
});

test("frameAt adds one byte for the padding bit", () => {
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x92, 0x00]), 0)?.size, 418);
});

test("frameAt reads the other MPEG-1 sample rates", () => {
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x94, 0x00]), 0)?.rate, 48000);
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x94, 0x00]), 0)?.size, 384);
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x98, 0x00]), 0)?.rate, 32000);
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x98, 0x00]), 0)?.size, 576);
});

test("frameAt reads MPEG-2 Layer III as 576 samples per frame", () => {
  const info = frameAt(Uint8Array.from([0xff, 0xf3, 0x80, 0x00]), 0);
  assert.deepEqual(info, { size: 208, samples: 576, rate: 22050, mpeg1: false, mono: false });
});

test("frameAt reads MPEG-2.5 as 11025 Hz", () => {
  const info = frameAt(Uint8Array.from([0xff, 0xe3, 0x80, 0x00]), 0);
  assert.deepEqual(info, { size: 417, samples: 576, rate: 11025, mpeg1: false, mono: false });
});

test("frameAt reads Layer I and Layer II sizes", () => {
  assert.deepEqual(frameAt(Uint8Array.from([0xff, 0xff, 0x10, 0x00]), 0), { size: 32, samples: 384, rate: 44100, mpeg1: true, mono: false });
  assert.deepEqual(frameAt(Uint8Array.from([0xff, 0xfd, 0x50, 0x00]), 0), { size: 261, samples: 1152, rate: 44100, mpeg1: true, mono: false });
});

test("frameAt reports single channel mode as mono", () => {
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x90, 0xc0]), 0)?.mono, true);
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x90, 0x40]), 0)?.mono, false);
});

test("frameAt refuses reserved and free fields", () => {
  const bad: number[][] = [
    [0xff, 0xeb, 0x90, 0x00],
    [0xff, 0xf9, 0x90, 0x00],
    [0xff, 0xfb, 0x00, 0x00],
    [0xff, 0xfb, 0xf0, 0x00],
    [0xff, 0xfb, 0x9c, 0x00],
    [0xfe, 0xfb, 0x90, 0x00],
    [0xff, 0xdb, 0x90, 0x00],
  ];
  for (const h of bad) assert.equal(frameAt(Uint8Array.from(h), 0), null, `should refuse ${h.map((x) => x.toString(16)).join(" ")}`);
});

test("frameAt refuses a header cut short by the end of the buffer", () => {
  assert.equal(frameAt(Uint8Array.from([0xff, 0xfb, 0x90]), 0), null);
  assert.equal(frameAt(new Uint8Array(0), 0), null);
  assert.equal(frameAt(Uint8Array.from([0, 0xff, 0xfb, 0x90, 0x00]), 2), null);
  assert.equal(frameAt(Uint8Array.from([0, 0xff, 0xfb, 0x90, 0x00]), 1)?.size, 417);
});

test("durationMs of 100 MPEG-1 frames is 100 times 1152 samples at 44100 Hz", async () => {
  const ms = await durationMs(Uint8Array.from(frames(100)), 0, noStep);
  close(ms, 100 * 1152 * 1000 / 44100);
});

test("durationMs follows padded frames of 418 bytes", async () => {
  const body: number[] = [];
  for (let i = 0; i < 10; i++) body.push(...frames(1, [0xff, 0xfb, i % 2 ? 0x92 : 0x90, 0x00], i % 2 ? 418 : 417));
  close(await durationMs(Uint8Array.from(body), 0, noStep), 10 * 1152 * 1000 / 44100);
});

test("durationMs uses 576 samples per frame for MPEG-2 at 22050 Hz", async () => {
  const ms = await durationMs(Uint8Array.from(frames(50, [0xff, 0xf3, 0x80, 0x00], 208)), 0, noStep);
  close(ms, 50 * 576 * 1000 / 22050);
});

test("durationMs honours the audio start and does not count a tag in front", async () => {
  const decoy = frames(3);
  const tag = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, ...decoy];
  const buf = Uint8Array.from([...tag, ...frames(100)]);
  close(await durationMs(buf, tag.length, noStep), 100 * 1152 * 1000 / 44100);
  close(await durationMs(buf, 0, noStep), 103 * 1152 * 1000 / 44100);
});

test("durationMs skips junk before the first real frame", async () => {
  const junk = [0x00, 0x13, 0xff, 0x00, 0xff, 0xfb, 0x90, 0x00, ...new Array(20).fill(0)];
  close(await durationMs(Uint8Array.from([...junk, ...frames(100)]), 0, noStep), 100 * 1152 * 1000 / 44100);
});

test("durationMs stops counting at trailing junk", async () => {
  const buf = Uint8Array.from([...frames(10), ...new Array(50).fill(0x41)]);
  close(await durationMs(buf, 0, noStep), 10 * 1152 * 1000 / 44100);
});

test("durationMs trusts the frame count of a Xing header", async () => {
  const first = frames(1);
  first.splice(36, 12, 0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, 0, 0, 0x03, 0xe8);
  const buf = Uint8Array.from([...first, ...frames(1)]);
  close(await durationMs(buf, 0, noStep), 1000 * 1152 * 1000 / 44100);
});

test("durationMs trusts the frame count of an Info header on a mono file", async () => {
  const header = [0xff, 0xfb, 0x90, 0xc0];
  const first = frames(1, header);
  first.splice(21, 12, 0x49, 0x6e, 0x66, 0x6f, 0, 0, 0, 1, 0, 0, 0x01, 0xf4);
  const buf = Uint8Array.from([...first, ...frames(1, header)]);
  close(await durationMs(buf, 0, noStep), 500 * 1152 * 1000 / 44100);
});

test("durationMs counts frames when a Xing header has no frame count", async () => {
  const first = frames(1);
  first.splice(36, 12, 0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 0, 0, 0, 0x03, 0xe8);
  const buf = Uint8Array.from([...first, ...frames(1)]);
  close(await durationMs(buf, 0, noStep), 2 * 1152 * 1000 / 44100);
});

test("durationMs trusts the frame count of a VBRI header", async () => {
  const first = frames(1);
  first.splice(36, 18, 0x56, 0x42, 0x52, 0x49, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x07, 0xd0);
  const buf = Uint8Array.from([...first, ...frames(1)]);
  close(await durationMs(buf, 0, noStep), 2000 * 1152 * 1000 / 44100);
});

test("durationMs reports progress once for each megabyte it passes", async () => {
  const seen: number[] = [];
  const buf = Uint8Array.from(frames(3000));
  const ms = await durationMs(buf, 0, async (f) => {
    seen.push(f);
  });
  close(ms, 3000 * 1152 * 1000 / 44100);
  assert.equal(seen.length, 1);
  assert.ok(seen[0] > 0.8 && seen[0] < 0.9, `fraction ${seen[0]}`);
});

test("durationMs refuses an empty buffer, a zeroed buffer and a reserved header", async () => {
  await assert.rejects(durationMs(new Uint8Array(0), 0, noStep), NotMp3Error);
  await assert.rejects(durationMs(new Uint8Array(2000), 0, noStep), NotMp3Error);
  await assert.rejects(durationMs(Uint8Array.from(frames(5, [0xff, 0xfb, 0x9c, 0x00])), 0, noStep), NotMp3Error);
});

test("durationMs refuses a start past the end of the data", async () => {
  await assert.rejects(durationMs(Uint8Array.from(frames(5)), 99999, noStep), NotMp3Error);
});
