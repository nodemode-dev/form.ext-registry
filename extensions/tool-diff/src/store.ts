import { formext } from "./formext";
import { sameTools, type Snapshot } from "./model";

const KEY = "snapshots";
const BUDGET = 240 * 1024;
const PER_APP = 8;

let all: Snapshot[] = [];
const sessionOnly = new Set<string>();

function size(list: Snapshot[]): number {
  return new TextEncoder().encode(JSON.stringify(list)).length;
}

export async function load(): Promise<Snapshot[]> {
  const saved = await formext.storageGet<Snapshot[]>(KEY).catch(() => null);
  all = Array.isArray(saved) ? saved.filter((s) => s && typeof s.app === "string" && Array.isArray(s.tools)) : [];
  return all;
}

export function list(app?: string): Snapshot[] {
  return all.filter((s) => !app || s.app === app).sort((a, b) => b.taken - a.taken);
}

export function latest(app: string): Snapshot | null {
  return list(app)[0] ?? null;
}

export function get(id: string): Snapshot | null {
  return all.find((s) => s.id === id) ?? null;
}

export function isSessionOnly(id: string): boolean {
  return sessionOnly.has(id);
}

async function persist(): Promise<string[]> {
  const dropped: string[] = [];
  let kept = all.filter((s) => !sessionOnly.has(s.id));
  while (kept.length && size(kept) > BUDGET) {
    const oldest = kept.reduce((a, b) => (a.taken <= b.taken ? a : b));
    if (kept.length === 1) {
      sessionOnly.add(oldest.id);
      kept = [];
      break;
    }
    kept = kept.filter((s) => s !== oldest);
    all = all.filter((s) => s !== oldest);
    dropped.push(oldest.label);
  }
  await formext.storageSet(KEY, kept);
  return dropped;
}

export type Added = { snapshot: Snapshot; unchanged: boolean; dropped: string[]; sessionOnly: boolean };

export async function add(s: Snapshot, skipSame = true): Promise<Added> {
  const prev = latest(s.app);
  if (skipSame && prev && prev.source === s.source && sameTools(prev.tools, s.tools)) return { snapshot: prev, unchanged: true, dropped: [], sessionOnly: false };
  all.push(s);
  const mine = list(s.app);
  const dropped: string[] = [];
  for (const old of mine.slice(PER_APP)) {
    all = all.filter((x) => x !== old);
    dropped.push(old.label);
  }
  if (size([s]) > BUDGET) sessionOnly.add(s.id);
  dropped.push(...(await persist()));
  return { snapshot: s, unchanged: false, dropped, sessionOnly: sessionOnly.has(s.id) };
}

export async function forget(id: string): Promise<void> {
  all = all.filter((s) => s.id !== id);
  sessionOnly.delete(id);
  await persist();
}
