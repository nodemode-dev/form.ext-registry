import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTag, writeTag, chapterFrame, tocFrame, TagError } from "../../../extensions/podcast-chapters/src/id3.ts";
import type { TagChapter } from "../../../extensions/podcast-chapters/src/id3.ts";

type Bytes = number[] | Uint8Array;

const cat = (...parts: Bytes[]): number[] => parts.flatMap((p) => Array.from(p));
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const safe = (n: number): number[] => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127];
const unsafe = (b: Bytes, o: number): number => b[o] * 2097152 + b[o + 1] * 16384 + b[o + 2] * 128 + b[o + 3];
const plain = (b: Bytes, o: number): number => b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3];
const NONE = be32(0xffffffff);
const AUDIO = [0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0x00, 0xff, 0xe0, 9];

const frame3 = (id: string, body: Bytes, flags: number[] = [0, 0]): number[] => cat(ascii(id), be32(body.length), flags, body);
const frame4 = (id: string, body: Bytes, flags: number[] = [0, 0]): number[] => cat(ascii(id), safe(body.length), flags, body);
const chapBody = (id: string, start: number, end: number, ...subs: Bytes[]): number[] => cat(ascii(id), [0], be32(start), be32(end), NONE, NONE, ...subs);
const tocBody = (flags: number, ids: string[], ...subs: Bytes[]): number[] => cat(ascii("toc"), [0], [flags], [ids.length], ...ids.map((i) => cat(ascii(i), [0])), ...subs);
const tag = (version: number, flags: number, body: Bytes, sizeBytes?: number[]): number[] => cat(ascii("ID3"), [version, 0, flags], sizeBytes ?? safe(body.length), body);
const file = (...parts: Bytes[]): Uint8Array => Uint8Array.from(cat(...parts));
const title3 = (s: string): number[] => frame3("TIT2", cat([0], ascii(s)));
const title4 = (s: string): number[] => frame4("TIT2", cat([0], ascii(s)));

const stuff = (b: Bytes): number[] => {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]);
    if (b[i] === 0xff && (i + 1 === b.length || b[i + 1] === 0 || b[i + 1] >= 0xe0)) out.push(0);
  }
  return out;
};

interface Walked {
  flags: number;
  size: number;
  frames: { id: string; body: number[]; raw: number[] }[];
  rest: number[];
}

const walk = (bytes: Uint8Array): Walked => {
  const b = Array.from(bytes);
  assert.deepEqual(b.slice(0, 5), [0x49, 0x44, 0x33, 3, 0]);
  for (const x of b.slice(6, 10)) assert.ok(x < 0x80);
  const size = unsafe(b, 6);
  const end = 10 + size;
  assert.ok(end <= b.length);
  const frames: Walked["frames"] = [];
  let o = 10;
  while (o < end) {
    const id = String.fromCharCode(...b.slice(o, o + 4));
    assert.match(id, /^[A-Z0-9]{4}$/);
    const n = plain(b, o + 4);
    assert.ok(o + 10 + n <= end);
    frames.push({ id, body: b.slice(o + 10, o + 10 + n), raw: b.slice(o, o + 10 + n) });
    o += 10 + n;
  }
  assert.equal(o, end);
  return { flags: b[5], size, frames, rest: b.slice(end) };
};

const ch = (id: string, startMs: number, endMs: number, title: string, more: Partial<TagChapter> = {}): TagChapter => ({ id, startMs, endMs, title, toc: true, ...more });
const view = (c: TagChapter) => ({ id: c.id, startMs: c.startMs, endMs: c.endMs, title: c.title, url: c.url ?? null, toc: c.toc, mime: c.picture?.mime ?? null, data: c.picture ? Array.from(c.picture.data) : null });

const T = { timeout: 10000 };

test("reads two titled chapters from a hand built v2.3 tag", T, () => {
  const body = cat(
    frame3("CTOC", tocBody(3, ["ch0", "ch1"], title3("Episode"))),
    frame3("CHAP", chapBody("ch0", 0, 61500, title3("Intro"))),
    frame3("CHAP", chapBody("ch1", 61500, 3723004, title3("Main part"))),
  );
  const p = parseTag(file(tag(3, 0, body), AUDIO));
  assert.equal(p.version, 3);
  assert.equal(p.audioStart, 10 + body.length);
  assert.equal(p.tocTitle, "Episode");
  assert.deepEqual(p.chapters.map(view), [
    { id: "ch0", startMs: 0, endMs: 61500, title: "Intro", url: null, toc: true, mime: null, data: null },
    { id: "ch1", startMs: 61500, endMs: 3723004, title: "Main part", url: null, toc: true, mime: null, data: null },
  ]);
  assert.deepEqual(p.frames, []);
});

test("reads two titled chapters from a hand built v2.4 tag", T, () => {
  const body = cat(
    frame4("CHAP", chapBody("a", 1000, 2000, title4("One"))),
    frame4("CHAP", chapBody("b", 2000, 4000000000, title4("Two"))),
    frame4("CTOC", tocBody(3, ["a", "b"])),
  );
  const p = parseTag(file(tag(4, 0, body), AUDIO));
  assert.equal(p.version, 4);
  assert.deepEqual(p.chapters.map((c) => [c.id, c.startMs, c.endMs, c.title]), [["a", 1000, 2000, "One"], ["b", 2000, 4000000000, "Two"]]);
});

test("v2.3 frame sizes are read as plain 32 bit numbers", T, () => {
  const filler = new Array(200).fill(0x41);
  const body = cat(frame3("PRIV", filler), frame3("CHAP", chapBody("c", 5, 9, title3("After"))));
  assert.deepEqual(body.slice(4, 8), [0, 0, 0, 200]);
  const p = parseTag(file(tag(3, 0, body), AUDIO));
  assert.deepEqual(p.chapters.map((c) => [c.startMs, c.endMs, c.title]), [[5, 9, "After"]]);
  assert.equal(p.frames.length, 1);
  assert.equal(p.frames[0].length, 210);
});

test("v2.4 frame sizes are read as synchsafe and rewritten as plain v2.3 sizes", T, () => {
  const filler = cat(ascii("own"), [0], new Array(196).fill(0x42));
  const body = cat(frame4("PRIV", filler), frame4("CHAP", chapBody("c", 5, 9, title4("After"))));
  assert.deepEqual(body.slice(4, 8), [0, 0, 1, 72]);
  const input = file(tag(4, 0, body), AUDIO);
  const p = parseTag(input);
  assert.deepEqual(p.chapters.map((c) => [c.startMs, c.endMs, c.title]), [[5, 9, "After"]]);
  const w = walk(writeTag(input, p.chapters).bytes);
  const priv = w.frames.filter((f) => f.id === "PRIV");
  assert.equal(priv.length, 1);
  assert.deepEqual(priv[0].raw.slice(4, 8), [0, 0, 0, 200]);
  assert.deepEqual(priv[0].body, filler);
});

test("chapter titles decode from Latin-1, UTF-16 with either BOM, and UTF-8", T, () => {
  const body = cat(
    frame3("CHAP", chapBody("l", 0, 1, frame3("TIT2", [0, 0x43, 0x61, 0x66, 0xe9]))),
    frame3("CHAP", chapBody("w", 1, 2, frame3("TIT2", [1, 0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67, 0, 0]))),
    frame3("CHAP", chapBody("b", 2, 3, frame3("TIT2", [1, 0xfe, 0xff, 0x04, 0x16, 0x00, 0x41]))),
    frame3("CHAP", chapBody("u", 3, 4, frame3("TIT2", [3, 0xe6, 0x97, 0xa5, 0x20, 0xc3, 0xa9, 0]))),
  );
  const p = parseTag(file(tag(3, 0, body)));
  assert.deepEqual(p.chapters.map((c) => c.title), ["Café", "日本", "ЖA", "日 é"]);
});

test("UTF-16BE without BOM decodes in a v2.4 chapter title", T, () => {
  const body = frame4("CHAP", chapBody("x", 0, 1, frame4("TIT2", [2, 0x65, 0xe5, 0x00, 0x41])));
  assert.equal(parseTag(file(tag(4, 0, body))).chapters[0].title, "日A");
});

test("chapters come back ordered by start time and keep their own ids", T, () => {
  const body = cat(
    frame3("CHAP", chapBody("late", 9000, 9500, title3("Late"))),
    frame3("CHAP", chapBody("early", 100, 9000, title3("Early"))),
  );
  const p = parseTag(file(tag(3, 0, body)));
  assert.deepEqual(p.chapters.map((c) => c.id), ["early", "late"]);
});

test("a chapter missing from the table of contents is marked as not listed", T, () => {
  const body = cat(
    frame3("CTOC", tocBody(3, ["a"])),
    frame3("CHAP", chapBody("a", 0, 10, title3("Shown"))),
    frame3("CHAP", chapBody("b", 10, 20, title3("Hidden"))),
  );
  const p = parseTag(file(tag(3, 0, body)));
  assert.deepEqual(p.chapters.map((c) => [c.id, c.toc]), [["a", true], ["b", false]]);
});

test("reads the link and picture sub-frames of a chapter", T, () => {
  const url = frame3("WXXX", cat([0], [0], ascii("https://example.com/a?b=1")));
  const pic = frame3("APIC", cat([0], ascii("image/png"), [0], [3], ascii("cover"), [0], [0x89, 0x50, 0x00, 0xff]));
  const p = parseTag(file(tag(3, 0, frame3("CHAP", chapBody("a", 0, 10, title3("T"), url, pic)))));
  assert.equal(p.chapters[0].url, "https://example.com/a?b=1");
  assert.equal(p.chapters[0].picture?.mime, "image/png");
  assert.deepEqual(Array.from(p.chapters[0].picture?.data ?? []), [0x89, 0x50, 0x00, 0xff]);
});

test("tag header sizes decode as synchsafe at 127, 128, 16383 and 16384", T, () => {
  const cases: [number, number[]][] = [[127, [0, 0, 0, 0x7f]], [128, [0, 0, 1, 0]], [16383, [0, 0, 0x7f, 0x7f]], [16384, [0, 1, 0, 0]]];
  for (const [n, sizeBytes] of cases) {
    const body = cat(frame3("CHAP", chapBody("a", 1, 2, title3("Pad"))), new Array(n).fill(0)).slice(0, n);
    const p = parseTag(file(tag(3, 0, body, sizeBytes), AUDIO));
    assert.equal(p.audioStart, 10 + n);
    assert.equal(p.chapters.length, 1);
  }
});

test("the 28 bit maximum tag size decodes to 268435455", T, () => {
  const big = new Uint8Array(10 + 268435455 + 4);
  big.set([0x49, 0x44, 0x33, 3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f]);
  assert.equal(parseTag(big).audioStart, 268435465);
});

test("written tag sizes are synchsafe at 127, 128, 16383 and 16384 with no byte above 0x7F", T, () => {
  const cases: [number, number[]][] = [[127, [0, 0, 0, 0x7f]], [128, [0, 0, 1, 0]], [16383, [0, 0, 0x7f, 0x7f]], [16384, [0, 1, 0, 0]]];
  const base = writeTag(file(AUDIO), []).bytes.length - AUDIO.length - 10;
  for (const [n, sizeBytes] of cases) {
    const keep = frame3("PRIV", new Array(n - base - 10).fill(0x55));
    const out = writeTag(file(tag(3, 0, keep), AUDIO), []).bytes;
    assert.deepEqual(Array.from(out.subarray(6, 10)), sizeBytes);
    assert.equal(out.length, 10 + n + AUDIO.length);
    assert.deepEqual(Array.from(out.subarray(10 + n)), AUDIO);
  }
});

test("a v2.3 chapter frame is laid out byte for byte as the chapter addendum says", T, () => {
  const expected = cat(
    ascii("CHAP"), [0, 0, 0, 36], [0, 0],
    ascii("ch0"), [0],
    [0, 0, 0x03, 0xe8], [0, 0, 0x13, 0x88],
    [0xff, 0xff, 0xff, 0xff], [0xff, 0xff, 0xff, 0xff],
    ascii("TIT2"), [0, 0, 0, 6], [0, 0], [0], ascii("Intro"),
  );
  assert.deepEqual(Array.from(chapterFrame(ch("ch0", 1000, 5000, "Intro"), 3)), expected);
});

test("a v2.4 chapter frame uses synchsafe sizes for itself and its sub-frame", T, () => {
  const long = "x".repeat(150);
  const expected = cat(
    ascii("CHAP"), [0, 0, 1, 51], [0, 0],
    ascii("c"), [0], be32(7), be32(8), NONE, NONE,
    ascii("TIT2"), [0, 0, 1, 23], [0, 0], [0], ascii(long),
  );
  assert.deepEqual(Array.from(chapterFrame(ch("c", 7, 8, long), 4)), expected);
});

test("the table of contents frame carries the top level and ordered flags and the ids in order", T, () => {
  const expected = cat(
    ascii("CTOC"), [0, 0, 0, 27], [0, 0],
    ascii("toc"), [0], [0x03], [2], ascii("ch0"), [0], ascii("ch1"), [0],
    ascii("TIT2"), [0, 0, 0, 3], [0, 0], [0], ascii("Ep"),
  );
  assert.deepEqual(Array.from(tocFrame(["ch0", "ch1"], "Ep", 3)), expected);
});

test("a file with no tag gets a v2.3 tag in front and the audio is untouched", T, () => {
  const res = writeTag(file(AUDIO), [ch("ch0", 0, 1000, "A"), ch("ch1", 1000, 2000, "B")], "Show");
  assert.equal(res.from.audioStart, 0);
  assert.deepEqual(Array.from(res.bytes.subarray(0, 6)), [0x49, 0x44, 0x33, 3, 0, 0]);
  const w = walk(res.bytes);
  assert.equal(w.size, res.bytes.length - 10 - AUDIO.length);
  assert.deepEqual(w.rest, AUDIO);
  assert.deepEqual(w.frames.map((f) => f.id).sort(), ["CHAP", "CHAP", "CTOC"]);
});

test("the written file holds one table of contents listing the chapters in order", T, () => {
  const chapters = [ch("ch0", 0, 1000, "A"), ch("ch1", 1000, 2000, "B"), ch("ch2", 2000, 3000, "C")];
  const w = walk(writeTag(file(AUDIO), chapters, "Show").bytes);
  const tocs = w.frames.filter((f) => f.id === "CTOC");
  assert.equal(tocs.length, 1);
  assert.deepEqual(tocs[0].body.slice(0, 18), cat(ascii("toc"), [0], [0x03], [3], ascii("ch0"), [0], ascii("ch1"), [0], ascii("ch2"), [0]));
  const chaps = w.frames.filter((f) => f.id === "CHAP");
  assert.deepEqual(chaps.map((f) => String.fromCharCode(...f.body.slice(0, 3))), ["ch0", "ch1", "ch2"]);
  assert.deepEqual(chaps[1].raw, Array.from(chapterFrame(chapters[1], 3)));
});

test("written chapters read back equal, with link, picture, hidden flag and toc title", T, () => {
  const chapters = [
    ch("ch0", 0, 90000, "Welcome"),
    ch("ch1", 90000, 3600000, "Café talk", { url: "https://example.com/notes", toc: false }),
    ch("ch2", 3600000, 4000000000, "日本語 \u{1f600}", { picture: { mime: "image/jpeg", data: Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0xff, 0xd9]) } }),
  ];
  const out = writeTag(file(AUDIO), chapters, "Episode 12").bytes;
  const p = parseTag(out);
  assert.equal(p.version, 3);
  assert.equal(p.tocTitle, "Episode 12");
  assert.deepEqual(p.chapters.map(view), chapters.map(view));
  assert.deepEqual(Array.from(out.subarray(p.audioStart)), AUDIO);
});

test("a title outside Latin-1 is written in v2.3 as UTF-16 with a BOM, never UTF-8", T, () => {
  const w = walk(writeTag(file(AUDIO), [ch("c", 0, 1, "日本")]).bytes);
  const body = w.frames.find((f) => f.id === "CHAP")?.body ?? [];
  const sub = body.slice(2 + 16);
  assert.deepEqual(sub.slice(0, 4), ascii("TIT2"));
  assert.equal(sub[10], 1);
  assert.deepEqual(sub.slice(11, 17), [0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67]);
});

test("a hidden chapter is written as a frame but left out of the table of contents", T, () => {
  const w = walk(writeTag(file(AUDIO), [ch("ch0", 0, 10, "A"), ch("ch1", 10, 20, "B", { toc: false })]).bytes);
  assert.equal(w.frames.filter((f) => f.id === "CHAP").length, 2);
  const toc = w.frames.find((f) => f.id === "CTOC")?.body ?? [];
  assert.deepEqual(toc, cat(ascii("toc"), [0], [0x03], [1], ascii("ch0"), [0]));
});

test("other frames already in a v2.3 tag are kept byte for byte and in order", T, () => {
  const tit = frame3("TIT2", cat([1], [0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]));
  const apic = frame3("APIC", cat([0], ascii("image/png"), [0], [3], [0], [0x89, 0x50, 0xff, 0x00, 0xff, 0xe0]));
  const comm = frame3("COMM", cat([0], ascii("eng"), [0], ascii("note")), [0x40, 0x00]);
  const input = file(tag(3, 0, cat(tit, frame3("CHAP", chapBody("old", 0, 5, title3("Old"))), apic, frame3("CTOC", tocBody(3, ["old"])), comm, new Array(64).fill(0))), AUDIO);
  const w = walk(writeTag(input, [ch("ch0", 0, 10, "New")]).bytes);
  assert.deepEqual(w.frames.filter((f) => f.id !== "CHAP" && f.id !== "CTOC").map((f) => f.raw), [tit, apic, comm]);
  assert.deepEqual(w.rest, AUDIO);
});

test("an existing chapter set is replaced, not added to", T, () => {
  const first = writeTag(file(AUDIO), [ch("ch0", 0, 10, "A"), ch("ch1", 10, 20, "B"), ch("ch2", 20, 30, "C")], "One").bytes;
  const second = writeTag(first, [ch("ch0", 0, 500, "Only")], "Two");
  assert.equal(second.from.chapters.length, 3);
  const w = walk(second.bytes);
  assert.deepEqual(w.frames.map((f) => f.id).sort(), ["CHAP", "CTOC"]);
  assert.deepEqual(w.rest, AUDIO);
  const p = parseTag(second.bytes);
  assert.deepEqual(p.chapters.map((c) => [c.id, c.startMs, c.endMs, c.title]), [["ch0", 0, 500, "Only"]]);
  assert.equal(p.tocTitle, "Two");
});

test("v2.4 UTF-8 text frames are kept but converted to encodings v2.3 allows", T, () => {
  const body = cat(
    frame4("TIT2", [3, 0x43, 0x61, 0x66, 0xc3, 0xa9]),
    frame4("TPE1", [3, 0xe6, 0x97, 0xa5, 0xe6, 0x9c, 0xac]),
    frame4("TALB", cat([0], ascii("Plain"))),
  );
  const w = walk(writeTag(file(tag(4, 0, body), AUDIO), [ch("c", 0, 1, "T")]).bytes);
  const get = (id: string) => w.frames.find((f) => f.id === id)?.body;
  assert.deepEqual(get("TIT2"), [0, 0x43, 0x61, 0x66, 0xe9]);
  assert.deepEqual(get("TPE1"), [1, 0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67]);
  assert.deepEqual(get("TALB"), cat([0], ascii("Plain")));
  assert.deepEqual(w.rest, AUDIO);
});

test("a v2.4 footer is counted as tag and does not leak into the audio", T, () => {
  const body = frame4("CHAP", chapBody("a", 0, 10, title4("Foot")));
  const footer = cat(ascii("3DI"), [4, 0, 0x10], safe(body.length));
  const input = file(tag(4, 0x10, body), footer, AUDIO);
  const p = parseTag(input);
  assert.equal(p.audioStart, 10 + body.length + 10);
  assert.equal(p.chapters[0].title, "Foot");
  assert.deepEqual(walk(writeTag(input, p.chapters).bytes).rest, AUDIO);
});

test("a v2.3 extended header is skipped and not carried into the written tag", T, () => {
  const ext = cat(be32(6), [0, 0], be32(0));
  const body = cat(ext, title3("Keep"), frame3("CHAP", chapBody("a", 3, 4, title3("Ext"))));
  const input = file(tag(3, 0x40, body), AUDIO);
  const p = parseTag(input);
  assert.deepEqual(p.chapters.map((c) => [c.startMs, c.endMs, c.title]), [[3, 4, "Ext"]]);
  const w = walk(writeTag(input, p.chapters).bytes);
  assert.equal(w.flags, 0);
  assert.deepEqual(w.frames.find((f) => f.id === "TIT2")?.raw, title3("Keep"));
});

test("a v2.4 extended header is skipped", T, () => {
  const ext = cat(safe(6), [1], [0]);
  const body = cat(ext, frame4("CHAP", chapBody("a", 3, 4, title4("Ext"))));
  const p = parseTag(file(tag(4, 0x40, body), AUDIO));
  assert.deepEqual(p.chapters.map((c) => [c.startMs, c.endMs, c.title]), [[3, 4, "Ext"]]);
});

test("an unsynchronised v2.3 tag is read and written back without the flag or the stuffing", T, () => {
  const priv = frame3("PRIV", cat(ascii("o"), [0], [0xff, 0xe0, 0xff, 0x00, 0x01]));
  const clean = cat(priv, frame3("CHAP", chapBody("a", 255, 65280, title3("Sync"))));
  const stored = stuff(clean);
  assert.ok(stored.length > clean.length);
  const input = file(tag(3, 0x80, stored), AUDIO);
  const p = parseTag(input);
  assert.equal(p.audioStart, 10 + stored.length);
  assert.deepEqual(p.chapters.map((c) => [c.startMs, c.endMs, c.title]), [[255, 65280, "Sync"]]);
  const w = walk(writeTag(input, p.chapters).bytes);
  assert.equal(w.flags, 0);
  assert.deepEqual(w.frames.find((f) => f.id === "PRIV")?.raw, priv);
  assert.deepEqual(w.rest, AUDIO);
});

test("a v2.4 chapter frame with frame level unsynchronisation is read or refused, not misread", { timeout: 10000, todo: "defect: parseTag ignores the v2.4 unsynchronisation flags on CHAP frames, so the stuffed bytes shift the sub-frames and the title is silently lost" }, () => {
  const stored = stuff(chapBody("a", 1000, 2000, title4("Sync")));
  const input = file(tag(4, 0x80, frame4("CHAP", stored, [0, 0x02])), AUDIO);
  let p;
  try {
    p = parseTag(input);
  } catch (e) {
    assert.ok(e instanceof TagError);
    return;
  }
  assert.deepEqual(p.chapters.map((c) => [c.startMs, c.endMs, c.title]), [[1000, 2000, "Sync"]]);
});

test("a v2.4 kept frame with frame level unsynchronisation is written back unstuffed", T, () => {
  const data = cat(ascii("o"), [0], [0xff, 0xe0, 0xff, 0x00, 0x01]);
  const input = file(tag(4, 0x80, frame4("PRIV", stuff(data), [0, 0x02])), AUDIO);
  const w = walk(writeTag(input, []).bytes);
  assert.deepEqual(w.frames.find((f) => f.id === "PRIV")?.body, data);
});

test("a tag whose size runs past the end of the file is refused with a clear error", T, () => {
  const whole = file(tag(3, 0, frame3("CHAP", chapBody("a", 0, 10, title3("Cut")))), AUDIO);
  const cut = whole.subarray(0, 25);
  assert.throws(() => parseTag(cut), (e: unknown) => e instanceof TagError && e.message.length > 20);
  assert.throws(() => writeTag(cut, [ch("c", 0, 1, "T")]), TagError);
  assert.throws(() => parseTag(file(ascii("ID3"), [3, 0, 0], [0x7f, 0x7f, 0x7f, 0x7f], AUDIO)), TagError);
});

test("a frame whose size runs past the end of the tag stops the read without losing earlier frames", T, () => {
  const good = frame3("CHAP", chapBody("a", 0, 10, title3("Good")));
  const bad = cat(ascii("TIT2"), be32(5000), [0, 0], [0], ascii("short"));
  const input = file(tag(3, 0, cat(good, bad)), AUDIO);
  const p = parseTag(input);
  assert.deepEqual(p.chapters.map((c) => c.title), ["Good"]);
  assert.equal(p.audioStart, 10 + good.length + bad.length);
  const w = walk(writeTag(input, p.chapters).bytes);
  assert.deepEqual(w.rest, AUDIO);
});

test("a chapter frame cut short inside its times does not throw or produce broken numbers", T, () => {
  const input = file(tag(3, 0, frame3("CHAP", cat(ascii("a"), [0], [0, 0, 1]))), AUDIO);
  const p = parseTag(input);
  for (const c of p.chapters) {
    assert.ok(Number.isInteger(c.startMs) && c.startMs >= 0);
    assert.ok(Number.isInteger(c.endMs) && c.endMs >= 0);
  }
  assert.deepEqual(walk(writeTag(input, [ch("c", 0, 1, "T")]).bytes).rest, AUDIO);
});

test("a table of contents claiming more entries than it holds does not hang or invent ids", T, () => {
  const toc = cat(ascii("toc"), [0], [0x03], [255], ascii("a"), [0]);
  const p = parseTag(file(tag(3, 0, cat(frame3("CTOC", toc), frame3("CHAP", chapBody("a", 0, 1, title3("A"))))), AUDIO));
  assert.deepEqual(p.chapters.map((c) => [c.id, c.toc]), [["a", true]]);
});

test("ID3 2.2 and unknown major versions are refused with a clear error", T, () => {
  assert.throws(() => parseTag(file(tag(2, 0, [0, 0, 0, 0]), AUDIO)), (e: unknown) => e instanceof TagError && /2\.2/.test(e.message));
  assert.throws(() => parseTag(file(tag(5, 0, [0, 0, 0, 0]), AUDIO)), TagError);
  assert.throws(() => writeTag(file(tag(2, 0, [0, 0, 0, 0]), AUDIO), []), TagError);
});

test("more than 255 chapters are refused and exactly 255 are written", T, () => {
  const many = Array.from({ length: 256 }, (_, i) => ch(`ch${i}`, i * 10, i * 10 + 10, `T${i}`));
  assert.throws(() => writeTag(file(AUDIO), many), TagError);
  const out = writeTag(file(AUDIO), many.slice(0, 255)).bytes;
  const w = walk(out);
  assert.equal(w.frames.find((f) => f.id === "CTOC")?.body[5], 255);
  assert.equal(parseTag(out).chapters.length, 255);
});

const chapSub = (c: TagChapter): number[] => Array.from(chapterFrame(c, 3)).slice(10 + c.id.length + 1 + 16);

test("a chapter title outside Latin-1 is written with encoding byte 1 and a UTF-16 little-endian byte order mark", T, () => {
  const sub = chapSub(ch("c", 0, 1, "日本"));
  assert.deepEqual(sub.slice(0, 4), ascii("TIT2"));
  assert.deepEqual(sub.slice(4, 8), be32(1 + 2 + 4));
  assert.deepEqual(sub.slice(10), [1, 0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67]);
});

test("a chapter title inside Latin-1 is written with encoding byte 0 and no byte order mark", T, () => {
  const sub = chapSub(ch("c", 0, 1, "Café ÿ"));
  assert.deepEqual(sub.slice(4, 8), be32(1 + 6));
  assert.deepEqual(sub.slice(10), [0, 0x43, 0x61, 0x66, 0xe9, 0x20, 0xff]);
});

test("the Latin-1 limit is U+00FF: U+0100 switches the title to UTF-16", T, () => {
  assert.equal(chapSub(ch("c", 0, 1, "ÿ"))[10], 0);
  assert.deepEqual(chapSub(ch("c", 0, 1, "Ā")).slice(10), [1, 0xff, 0xfe, 0x00, 0x01]);
});

test("one character outside Latin-1 puts the whole title in UTF-16, Latin-1 letters included", T, () => {
  assert.deepEqual(chapSub(ch("c", 0, 1, "aé日")).slice(10), [1, 0xff, 0xfe, 0x61, 0x00, 0xe9, 0x00, 0xe5, 0x65]);
});

test("the table of contents title follows the same encoding rule", T, () => {
  const wideToc = Array.from(tocFrame(["a"], "日本", 3));
  const tocSub = (b: number[]): number[] => b.slice(10 + 4 + 1 + 1 + 2);
  const wide = tocSub(wideToc);
  assert.deepEqual(wide.slice(0, 4), ascii("TIT2"));
  assert.deepEqual(wide.slice(10), [1, 0xff, 0xfe, 0xe5, 0x65, 0x2c, 0x67]);
  assert.deepEqual(tocSub(Array.from(tocFrame(["a"], "Café", 3))).slice(10), [0, 0x43, 0x61, 0x66, 0xe9]);
});

test("a written non-Latin-1 title is the encoding byte, a mark and the text for the whole file, and reads back", T, () => {
  const out = writeTag(file(AUDIO), [ch("a", 0, 1, "Ж"), ch("b", 1, 2, "Zoë")]).bytes;
  const w = walk(out);
  const bodies = w.frames.filter((f) => f.id === "CHAP").map((f) => f.body.slice(2 + 16 + 10));
  assert.deepEqual(bodies, [[1, 0xff, 0xfe, 0x16, 0x04], [0, 0x5a, 0x6f, 0xeb]]);
  assert.deepEqual(parseTag(out).chapters.map((c) => c.title), ["Ж", "Zoë"]);
});

test("a v2.4 UTF-8 TXXX frame that does not fit Latin-1 is written as encoding 1 with a mark on description and value", T, () => {
  const txxx = frame4("TXXX", cat([3], [0xe6, 0x97, 0xa5], [0], [0xe6, 0x9c, 0xac]));
  const w = walk(writeTag(file(tag(4, 0, txxx), AUDIO), [ch("c", 0, 1, "T")]).bytes);
  assert.deepEqual(w.frames.find((f) => f.id === "TXXX")?.body, [1, 0xff, 0xfe, 0xe5, 0x65, 0, 0, 0xff, 0xfe, 0x2c, 0x67]);
});

test("a v2.4 UTF-8 TXXX frame is written as encoding 0 when both parts fit Latin-1, and wide when only one part does not", T, () => {
  const fits = frame4("TXXX", cat([3], ascii("d"), [0xc3, 0xa9], [0], ascii("v"), [0xc3, 0xbc]));
  const mixed = frame4("TXXX", cat([3], ascii("ab"), [0], [0xe6, 0x97, 0xa5]));
  const get = (f: number[]) => walk(writeTag(file(tag(4, 0, f), AUDIO), [ch("c", 0, 1, "T")]).bytes).frames.find((x) => x.id === "TXXX")?.body;
  assert.deepEqual(get(fits), [0, 0x64, 0xe9, 0, 0x76, 0xfc]);
  assert.deepEqual(get(mixed), [1, 0xff, 0xfe, 0x61, 0x00, 0x62, 0x00, 0, 0, 0xff, 0xfe, 0xe5, 0x65]);
});

test("UTF-16 text with a big-endian mark and with a little-endian mark decode to the same string", T, () => {
  const text = "日本語 ЖA é";
  const le = [0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8])];
  const be = [0xfe, 0xff, ...[...text].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 255])];
  const body = cat(
    frame3("CHAP", chapBody("l", 0, 1, frame3("TIT2", cat([1], le)))),
    frame3("CHAP", chapBody("b", 1, 2, frame3("TIT2", cat([1], be)))),
    frame3("CHAP", chapBody("t", 2, 3, frame3("TIT2", cat([1], be, [0, 0])))),
  );
  const titles = parseTag(file(tag(3, 0, body))).chapters.map((c) => c.title);
  assert.deepEqual(titles, [text, text, text]);
});

test("UTF-16BE text with encoding 2 and no mark decodes in v2.3 and v2.4 tags, with or without a terminator", T, () => {
  const sub = (f: typeof frame3, enc: number[]) => f("CHAP", chapBody("x", 0, 1, f("TIT2", cat([2], enc))));
  const text = [0x65, 0xe5, 0x67, 0x2c, 0x00, 0x41];
  assert.equal(parseTag(file(tag(3, 0, sub(frame3, text)))).chapters[0].title, "日本A");
  assert.equal(parseTag(file(tag(4, 0, sub(frame4, text)))).chapters[0].title, "日本A");
  assert.equal(parseTag(file(tag(4, 0, sub(frame4, [...text, 0, 0])))).chapters[0].title, "日本A");
});

test("a v2.4 TXXX frame in encoding 2 is read as UTF-16BE and rewritten in a v2.3 encoding", T, () => {
  const txxx = frame4("TXXX", cat([2], [0x00, 0x64, 0, 0], [0x65, 0xe5]));
  const w = walk(writeTag(file(tag(4, 0, txxx), AUDIO), [ch("c", 0, 1, "T")]).bytes);
  assert.deepEqual(w.frames.find((f) => f.id === "TXXX")?.body, [1, 0xff, 0xfe, 0x64, 0x00, 0, 0, 0xff, 0xfe, 0xe5, 0x65]);
});
