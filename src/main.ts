import { formext, FormExtError, ERR, toBase64 } from "./formext";
import { Chapter, Episode, Extra, Embedded, check, endsMs, fromJson, JsonChapter, parseStamp, stamp, toJson } from "./chapters";
import { parseTag, writeTag, TagChapter, TagError } from "./id3";
import { durationMs } from "./mp3";
import { adapt, samples, Snap } from "./session";
import { ops } from "./ops";

interface Saved {
  episode: Episode;
  extras: Record<string, Extra>;
}

const STORE = "chapters.v1";
const IMAGE_SIDE = 480;
const $ = <T extends Element>(sel: string, from: ParentNode = document) => from.querySelector(sel) as T;

const ui = {
  main: $<HTMLElement>(".pc"),
  summary: $<HTMLElement>("[data-summary]"),
  list: $<HTMLOListElement>("[data-list]"),
  empty: $<HTMLElement>("[data-empty]"),
  problems: $<HTMLUListElement>("[data-problems]"),
  progressLabel: $<HTMLElement>("[data-progress-label]"),
  progressFill: $<HTMLElement>("[data-progress-fill]"),
  progress: $<HTMLElement>("[data-progress]"),
  status: $<HTMLElement>("[data-status]"),
  row: $<HTMLTemplateElement>("template[data-row]"),
  episode: [...document.querySelectorAll<HTMLInputElement>("[data-episode]")],
};

let snap: Snap | null = null;
let chapters: Chapter[] = [];
let saved: Saved = { episode: {}, extras: {} };
let canDocument = true;

class Cancelled extends Error {}

class Job {
  cancelled = false;
  constructor(public label: string) {}
  async step(fraction: number, label?: string) {
    if (label) this.label = label;
    ui.progressLabel.textContent = this.label;
    ui.progressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
    await new Promise((r) => setTimeout(r, 0));
    if (this.cancelled) throw new Cancelled();
  }
}

let job: Job | null = null;

function setStatus(text: string, level: "info" | "success" | "error" = "info") {
  ui.status.textContent = text;
  ui.status.dataset.level = level;
}

function words(err: unknown): string {
  if (err instanceof FormExtError) {
    if (err.code === ERR.PERMISSION) return "FormWav has not allowed this extension to do that. Open the Extensions panel and allow its permissions.";
    if (err.code === ERR.UNAVAILABLE) return `FormWav cannot do that here: ${err.message}`;
    if (err.code === ERR.REFUSED) return `FormWav refused: ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

async function run(label: string, work: (job: Job) => Promise<string | null>) {
  if (job) return;
  const current = (job = new Job(label));
  ui.main.dataset.busy = "true";
  ui.progress.setAttribute("aria-hidden", "false");
  setBusy(true);
  try {
    await current.step(0);
    const done = await work(current);
    if (done) setStatus(done, "success");
  } catch (err) {
    if (err instanceof Cancelled || (err instanceof FormExtError && err.code === ERR.CANCELLED)) setStatus("Cancelled. Nothing was changed or saved.");
    else setStatus(words(err), "error");
  } finally {
    job = null;
    ui.main.dataset.busy = "false";
    ui.progress.setAttribute("aria-hidden", "true");
    ui.progressFill.style.transform = "scaleX(0)";
    setBusy(false);
  }
}

function setBusy(busy: boolean) {
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-act]")) if (b.dataset.act !== "cancel") b.disabled = busy || (!canDocument && b.dataset.act !== "save-json");
}

async function loadSaved() {
  try {
    const value = await formext.storageGet<Saved>(STORE);
    if (value && typeof value === "object") saved = { episode: value.episode ?? {}, extras: value.extras ?? {} };
  } catch {
    saved = { episode: {}, extras: {} };
  }
  for (const input of ui.episode) input.value = saved.episode[input.dataset.episode as keyof Episode] ?? "";
}

let saveTimer = 0;
function persist(now = false): Promise<void> {
  clearTimeout(saveTimer);
  const write = () =>
    formext.storageSet(STORE, saved).then(
      () => undefined,
      (err) => {
        setStatus(err instanceof FormExtError && /storage|256/i.test(err.message) ?"The extension's storage is full (256 KB). Remove some embedded images, or use image links instead." : words(err), "error");
        throw err;
      },
    );
  if (now) return write();
  return new Promise((resolve) => {
    saveTimer = window.setTimeout(() => write().then(resolve, () => resolve()), 350);
  });
}

function build(s: Snap): Chapter[] {
  const out: Chapter[] = [
    ...s.markers.map((m) => ({ key: `m:${m.id}`, kind: "marker" as const, refId: m.id, start: m.atS, title: m.label, extra: saved.extras[m.id] ?? {} })),
    ...s.regions.map((r, i) => ({ key: r.id ? `r:${r.id}` : `r#${i}`, kind: "region" as const, refId: r.id ?? "", start: r.startS, end: r.endS, title: r.label, extra: (r.id && saved.extras[r.id]) || {} })),
  ];
  return out.sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
}

async function refresh() {
  try {
    snap = adapt(await formext.readDocument("session"));
    canDocument = true;
  } catch (err) {
    if (err instanceof FormExtError && err.code === ERR.PERMISSION) canDocument = false;
    ui.summary.textContent = words(err);
    setBusy(!!job);
    return;
  }
  chapters = build(snap);
  render();
  setBusy(!!job);
}

function rowFor(c: Chapter): HTMLLIElement {
  const existing = ui.list.querySelector<HTMLLIElement>(`li[data-key="${CSS.escape(c.key)}"]`);
  if (existing) return existing;
  const li = (ui.row.content.firstElementChild as HTMLLIElement).cloneNode(true) as HTMLLIElement;
  li.dataset.key = c.key;
  return li;
}

const field = <T extends Element>(li: Element, f: string) => li.querySelector(`[data-f="${f}"]`) as T;

function setValue(input: HTMLInputElement, value: string) {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

function render() {
  const keys = new Set(chapters.map((c) => c.key));
  for (const li of [...ui.list.children] as HTMLLIElement[]) if (!keys.has(li.dataset.key ?? "")) li.remove();
  chapters.forEach((c, i) => {
    const li = rowFor(c);
    li.dataset.kind = c.kind;
    li.dataset.hidden = String(!!c.extra.hidden);
    field<HTMLElement>(li, "num").textContent = String(i + 1);
    setValue(field<HTMLInputElement>(li, "start"), stamp(c.start));
    field<HTMLElement>(li, "end").textContent = c.end !== undefined ? `to ${stamp(c.end)}` : "";
    setValue(field<HTMLInputElement>(li, "title"), c.title);
    setValue(field<HTMLInputElement>(li, "url"), c.extra.url ?? "");
    setValue(field<HTMLInputElement>(li, "img"), c.extra.img ?? "");
    const toc = field<HTMLButtonElement>(li, "toc");
    toc.setAttribute("aria-pressed", String(!c.extra.hidden));
    const tocWords = c.extra.hidden ? "Hidden from the table of contents" : "Shown in the table of contents";
    toc.title = tocWords;
    toc.setAttribute("aria-label", tocWords);
    const thumb = field<HTMLButtonElement>(li, "image");
    const img = field<HTMLImageElement>(li, "thumb");
    thumb.dataset.has = String(!!c.extra.image);
    const src = c.extra.image ? `data:${c.extra.image.mime};base64,${c.extra.image.data}` : "";
    if (img.getAttribute("src") !== src) src ? img.setAttribute("src", src) : img.removeAttribute("src");
    thumb.title = c.extra.image ? `Embedded image ${c.extra.image.width} x ${c.extra.image.height}; click to remove it` : "Embed an image in the MP3 for this chapter";
    const editable = !!c.refId && canDocument;
    for (const f of ["start", "title", "toc", "remove", "image", "url", "img"]) (field<HTMLInputElement>(li, f).disabled = !editable);
    if (ui.list.children[i] !== li) ui.list.insertBefore(li, ui.list.children[i] ?? null);
  });
  ui.empty.hidden = chapters.length > 0;
  const linked = chapters.filter((c) => c.extra.url).length;
  const pictured = chapters.filter((c) => c.extra.image || c.extra.img).length;
  const length = snap?.lengthS ? `, session ${stamp(snap.lengthS)}` : "";
  ui.summary.textContent = chapters.length ? `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}, ${linked} with links, ${pictured} with images${length}` : `No markers or regions yet${length}`;
  showProblems();
}

function showProblems() {
  const found = check(chapters, snap?.lengthS ?? null);
  const bad = new Set(found.filter((p) => p.key && p.field).map((p) => `${p.key}|${p.field}`));
  for (const li of ui.list.children as HTMLCollectionOf<HTMLLIElement>) {
    for (const f of ["title", "url", "img", "start"]) {
      const input = field<HTMLInputElement>(li, f);
      const invalid = bad.has(`${li.dataset.key}|${f}`);
      if (invalid) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
  const items = found.map((p) => {
    const li = document.createElement("li");
    li.textContent = p.text;
    li.dataset.level = p.key ? "problem" : "note";
    return li;
  });
  ui.problems.replaceChildren(...items);
}

function chapterOf(el: Element): Chapter | undefined {
  const key = el.closest<HTMLLIElement>("li[data-key]")?.dataset.key;
  return chapters.find((c) => c.key === key);
}

function setExtra(c: Chapter, patch: Partial<Extra>) {
  const next: Extra = { ...c.extra, ...patch };
  for (const k of Object.keys(next) as (keyof Extra)[]) if (next[k] === undefined || next[k] === "" || next[k] === false) delete next[k];
  c.extra = next;
  if (Object.keys(next).length) saved.extras[c.refId] = next;
  else delete saved.extras[c.refId];
}

async function apply(label: string, list: { command: string; args: unknown }[]) {
  if (!list.length) return;
  await formext.apply(label, list);
}

ui.list.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const c = chapterOf(input);
  if (!c || !snap) return;
  const f = input.dataset.f;
  if (f === "title") {
    const title = input.value.trim();
    if (title === c.title) return;
    apply("Rename chapter", [ops.rename(c, title)]).catch((err) => {
      setStatus(words(err), "error");
      input.value = c.title;
    });
  } else if (f === "start") {
    const seconds = parseStamp(input.value);
    if (seconds === null || (c.end !== undefined && seconds >= c.end)) {
      setStatus(seconds === null ? "Type a time such as 1:23.5 or 0:04:10." : "A region's start must be before its end.", "error");
      input.value = stamp(c.start);
      return;
    }
    apply("Move chapter", [ops.move(c, samples(seconds, snap.rate))]).catch((err) => {
      setStatus(words(err), "error");
      input.value = stamp(c.start);
    });
  }
});

ui.list.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  const c = chapterOf(input);
  if (!c || (input.dataset.f !== "url" && input.dataset.f !== "img")) return;
  setExtra(c, { [input.dataset.f]: input.value.trim() });
  persist();
  showProblems();
  render();
});

ui.list.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-f]");
  if (!button) return;
  const c = chapterOf(button);
  if (!c) return;
  if (button.dataset.f === "toc") {
    setExtra(c, { hidden: !c.extra.hidden });
    persist();
    render();
  } else if (button.dataset.f === "remove") {
    apply("Remove chapter", [ops.remove(c)]).catch((err) => setStatus(words(err), "error"));
  } else if (button.dataset.f === "image") {
    if (c.extra.image) {
      setExtra(c, { image: undefined });
      persist();
      render();
      setStatus(`Removed the embedded image from chapter ${chapters.indexOf(c) + 1}.`);
      return;
    }
    run("Embedding image", async (j) => {
      const [file] = await formext.openFiles([".jpg", ".jpeg", ".png", ".webp"]);
      if (!file) return null;
      await j.step(0.5, "Scaling image");
      const image = await thumbnail(decode(file.data), file.type || "image/jpeg");
      setExtra(c, { image });
      await persist(true).catch((err) => {
        setExtra(c, { image: undefined });
        throw err;
      });
      render();
      return `Embedded ${file.name} (${image.width} x ${image.height}) in chapter ${chapters.indexOf(c) + 1}. It goes into the MP3's chapter; the JSON file needs an image link.`;
    });
  }
});

for (const input of ui.episode) {
  input.addEventListener("input", () => {
    saved.episode = { ...saved.episode, [input.dataset.episode as string]: input.value };
    persist();
  });
}

function decode(data: string): Uint8Array {
  const text = atob(data);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

async function decodeChunked(data: string, j: Job, from: number, to: number): Promise<Uint8Array> {
  if (/\s/.test(data.slice(0, 4096))) data = data.replace(/\s+/g, "");
  const out = new Uint8Array(Math.ceil(data.length / 4) * 3);
  const chunk = 4 * 262144;
  let at = 0;
  for (let i = 0; i < data.length; i += chunk) {
    const text = atob(data.slice(i, i + chunk));
    for (let k = 0; k < text.length; k++) out[at + k] = text.charCodeAt(k);
    at += text.length;
    await j.step(from + ((to - from) * i) / data.length);
  }
  return out.subarray(0, at);
}

async function encodeChunked(bytes: Uint8Array, j: Job, from: number, to: number): Promise<string> {
  const parts: string[] = [];
  const chunk = 3 * 262144;
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(toBase64(bytes.subarray(i, i + chunk)));
    await j.step(from + ((to - from) * i) / bytes.length);
  }
  return parts.join("");
}

async function thumbnail(bytes: Uint8Array, type: string): Promise<Embedded> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  } catch {
    throw new Error("That image could not be read. Choose a JPEG, PNG or WebP file.");
  }
  const scale = Math.min(1, IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("That image could not be converted.");
  return { mime: "image/jpeg", data: toBase64(new Uint8Array(await blob.arrayBuffer())), width, height };
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "") || "episode";
}

function jsonName() {
  const base = saved.episode.title?.trim() || snap?.name || "episode";
  return `${base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "episode"}.chapters.json`;
}

function requireChapters() {
  if (!chapters.length) throw new Error("There are no chapters to save. Add markers or regions to the session first.");
  const blocking = check(chapters, null).filter((p) => p.field === "title");
  if (blocking.length) throw new Error(`${blocking[0].text} Give every chapter a title first.`);
}

async function saveJson(j: Job): Promise<string> {
  await refresh();
  requireChapters();
  await j.step(0.3, "Saving chapters file");
  const text = toJson(chapters, saved.episode);
  const result = await formext.saveFile(jsonName(), "application/json+chapters", toBase64(new TextEncoder().encode(text)));
  const embeddedOnly = chapters.filter((c) => c.extra.image && !c.extra.img).length;
  const note = embeddedOnly ? ` ${embeddedOnly} chapter image${embeddedOnly === 1 ? " is" : "s are"} embedded only, so ${embeddedOnly === 1 ? "it is" : "they are"} not in the JSON (add an image link).` : "";
  return `Saved ${chapters.length} chapters to ${result.name}.${note}`;
}

async function tagMp3(j: Job): Promise<string | null> {
  await refresh();
  requireChapters();
  await j.step(0.02, "Choose the episode's MP3");
  const [file] = await formext.openFiles([".mp3"]);
  if (!file) return null;
  await j.step(0.05, "Reading MP3");
  const bytes = await decodeChunked(file.data, j, 0.05, 0.35);
  let tag;
  try {
    tag = parseTag(bytes);
  } catch (err) {
    if (err instanceof TagError) throw err;
    throw new Error("This MP3's tag could not be read. The file may be damaged.");
  }
  await j.step(0.35, "Measuring length");
  const length = await durationMs(bytes, tag.audioStart, (f) => j.step(0.35 + 0.25 * f));
  const ends = endsMs(chapters, length);
  const outside = chapters.filter((c) => c.start * 1000 >= length);
  if (outside.length) throw new Error(`The MP3 is ${stamp(length / 1000)} long, but ${outside.length} chapter${outside.length === 1 ? " starts" : "s start"} after it ends. Is this the right file?`);
  const list: TagChapter[] = chapters.map((c, i) => ({
    id: `chp${i}`,
    startMs: Math.round(c.start * 1000),
    endMs: ends[i],
    title: c.title.trim(),
    url: c.extra.url?.trim() || undefined,
    picture: c.extra.image ? { mime: c.extra.image.mime, data: decode(c.extra.image.data) } : undefined,
    toc: !c.extra.hidden,
  }));
  await j.step(0.62, "Writing chapters");
  const out = writeTag(bytes, list, saved.episode.title?.trim() || undefined);
  const data = await encodeChunked(out.bytes, j, 0.65, 0.95);
  await j.step(0.96, "Saving MP3");
  const result = await formext.saveFile(`${baseName(file.name)} (chapters).mp3`, "audio/mpeg", data);
  const replaced = out.from.chapters.length;
  const lost = out.from.dropped ? ` ${out.from.dropped} compressed or encrypted tag frame${out.from.dropped === 1 ? " was" : "s were"} left out.` : "";
  return `Saved ${result.name} with ${list.length} chapters (ID3 2.3, which podcast apps read most widely)${replaced ? `, replacing the ${replaced} it had` : ""}. Its other tags were kept.${lost}`;
}

async function addImported(label: string, incoming: (JsonChapter & { picture?: { mime: string; data: Uint8Array } })[], j: Job): Promise<number> {
  if (!snap) await refresh();
  const s = snap!;
  const before = new Set([...s.markers.map((m) => m.id), ...s.regions.map((r) => r.id ?? "")]);
  await j.step(0.5, "Adding markers");
  await apply(
    label,
    incoming.map((c) => (c.endTime !== undefined ? ops.addRegion(samples(c.startTime, s.rate), samples(c.endTime, s.rate), c.title || "Chapter") : ops.addMarker(samples(c.startTime, s.rate), c.title || "Chapter"))),
  );
  await refresh();
  const fresh = [...snap!.markers.map((m) => ({ id: m.id, at: m.atS, label: m.label })), ...snap!.regions.filter((r) => r.id).map((r) => ({ id: r.id!, at: r.startS, label: r.label }))].filter((x) => !before.has(x.id));
  let n = 0;
  for (const c of incoming) {
    const hit = fresh.find((x) => Math.abs(x.at - c.startTime) < 0.002 && x.label === (c.title || "Chapter"));
    if (!hit) continue;
    fresh.splice(fresh.indexOf(hit), 1);
    const extra: Extra = {};
    if (c.url) extra.url = c.url;
    if (c.img) extra.img = c.img;
    if (c.toc === false) extra.hidden = true;
    if (c.picture) {
      await j.step(0.7 + (0.25 * n) / incoming.length, "Scaling images");
      try {
        extra.image = await thumbnail(c.picture.data, c.picture.mime);
      } catch {
        delete extra.image;
      }
    }
    if (Object.keys(extra).length) saved.extras[hit.id] = extra;
    n++;
  }
  await persist(true).catch(() => undefined);
  chapters = build(snap!);
  render();
  return incoming.length;
}

async function importJson(j: Job): Promise<string | null> {
  const [file] = await formext.openFiles([".json"]);
  if (!file) return null;
  await j.step(0.2, "Reading chapters file");
  const parsed = fromJson(new TextDecoder().decode(decode(file.data)));
  if (parsed.episode.title && !saved.episode.title) saved.episode.title = parsed.episode.title;
  if (parsed.episode.podcastName && !saved.episode.podcastName) saved.episode.podcastName = parsed.episode.podcastName;
  for (const input of ui.episode) setValue(input, saved.episode[input.dataset.episode as keyof Episode] ?? "");
  const n = await addImported("Import chapters", parsed.chapters, j);
  return `Added ${n} chapters from ${file.name} as one undo step.`;
}

async function importMp3(j: Job): Promise<string | null> {
  const [file] = await formext.openFiles([".mp3"]);
  if (!file) return null;
  await j.step(0.05, "Reading MP3");
  const bytes = await decodeChunked(file.data, j, 0.05, 0.4);
  const tag = parseTag(bytes);
  if (!tag.chapters.length) throw new Error(`${file.name} has no ID3 chapters.`);
  const list = tag.chapters.map((c, i) => {
    const next = tag.chapters[i + 1];
    const gap = next ? Math.abs(next.startMs - c.endMs) > 1 : false;
    return { startTime: c.startMs / 1000, ...(gap ? { endTime: c.endMs / 1000 } : {}), title: c.title, url: c.url, toc: c.toc ? undefined : (false as const), picture: c.picture };
  });
  if (tag.tocTitle && !saved.episode.title) {
    saved.episode.title = tag.tocTitle;
    for (const input of ui.episode) setValue(input, saved.episode[input.dataset.episode as keyof Episode] ?? "");
  }
  const n = await addImported("Import chapters", list, j);
  return `Added ${n} chapters from ${file.name} as one undo step.`;
}

async function addAtPlayhead(): Promise<string> {
  await refresh();
  if (!snap) throw new Error("The session could not be read.");
  const at = snap.playheadS ?? 0;
  if (chapters.some((c) => Math.abs(c.start - at) < 0.01)) throw new Error(`There is already a chapter at ${stamp(at)}. Move the playhead first.`);
  await apply("Add chapter", [ops.addMarker(samples(at, snap.rate), `Chapter ${chapters.length + 1}`)]);
  await refresh();
  return `Added a chapter at ${stamp(at)}.`;
}

const actions: Record<string, () => void> = {
  "save-json": () => run("Saving chapters file", saveJson),
  "tag-mp3": () => run("Writing chapters into an MP3", tagMp3),
  "import-json": () => run("Importing chapters", importJson),
  "import-mp3": () => run("Reading MP3 chapters", importMp3),
  add: () => run("Adding chapter", addAtPlayhead),
  cancel: () => {
    if (job) job.cancelled = true;
  },
};

document.addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("button[data-act]");
  if (button && !button.disabled) actions[button.dataset.act ?? ""]?.();
});

let eventTimer = 0;
formext.onEvent((e) => {
  if (e.name !== "document.changed" && e.name !== "selection.changed") return;
  clearTimeout(eventTimer);
  eventTimer = window.setTimeout(() => {
    if (!job) refresh();
  }, 120);
});

const headless: Record<string, (j: Job) => Promise<string | null>> = { "save-json": saveJson, "tag-mp3": tagMp3 };

formext.onActivate(async (a) => {
  if (a.reason !== "command" || !a.command || !headless[a.command]) {
    refresh();
    return;
  }
  const command = a.command;
  setTimeout(async () => {
    await ready;
    const j = new Job(command);
    let message: string | null = null;
    let level: "success" | "error" | "info" = "success";
    try {
      message = await headless[command](j);
    } catch (err) {
      level = err instanceof FormExtError && err.code === ERR.CANCELLED ? "info" : "error";
      message = level === "info" ? "Cancelled." : words(err);
    }
    if (message) await formext.notify(`Podcast Chapters: ${message}`, level).catch(() => undefined);
    await formext.done(message ? { message, level } : undefined).catch(() => undefined);
  }, 0);
});

async function start() {
  setBusy(true);
  try {
    await formext.hello();
  } catch {
    ui.summary.textContent = "This page runs inside FormWav. Open it from the Extensions menu.";
    return;
  }
  await loadSaved();
  await refresh();
}

const ready = start();
