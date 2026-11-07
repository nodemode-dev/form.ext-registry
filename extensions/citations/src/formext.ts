export type Permission = 'document' | 'files-read' | 'files-write' | 'network' | 'models' | 'native-code';

export interface Hello {
  product: string;
  app: string;
  appVersion: string;
  api: '1';
  extension: { id: string; version: string; source: 'catalogue' | 'sideload' | 'development' };
  permissions: Permission[];
  theme: { mode: 'dark' | 'light'; tokens: Record<string, string> };
  locale: string;
}

export interface Activation {
  reason: 'panel' | 'command';
  panel?: string;
  command?: string;
  args?: unknown;
}

export interface PickedFile {
  name: string;
  type: string;
  size: number;
  data: string;
}

export class FormExtError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

export const ERR = { NOT_FOUND: -32601, INVALID: -32602, PERMISSION: -32001, CANCELLED: -32002, UNAVAILABLE: -32003, REFUSED: -32004 } as const;

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: number };
type Handler = (params: any) => unknown;

const LONG = new Set(['files.open', 'files.save', 'app.run', 'document.apply', 'net.fetch']);

export class FormExt {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, Handler>();
  private helloCache: Promise<Hello> | null = null;

  constructor() {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const msg = event.data;
      if (!msg || msg.formext !== 1 || msg.jsonrpc !== '2.0') return;
      if (msg.method) {
        const handler = this.handlers.get(msg.method);
        if (handler) {
          Promise.resolve()
            .then(() => handler(msg.params ?? {}))
            .then(
              (result) => msg.id !== undefined && this.post({ id: msg.id, result: result ?? null }),
              (err) => msg.id !== undefined && this.post({ id: msg.id, error: { code: err?.code ?? ERR.REFUSED, message: String(err?.message ?? err) } }),
            );
        } else if (msg.id !== undefined) {
          this.post({ id: msg.id, error: { code: ERR.NOT_FOUND, message: `no handler for ${msg.method}` } });
        }
        return;
      }
      const waiting = this.pending.get(msg.id);
      if (!waiting) return;
      this.pending.delete(msg.id);
      clearTimeout(waiting.timer);
      if (msg.error) waiting.reject(new FormExtError(msg.error.code, msg.error.message, msg.error.data));
      else waiting.resolve(msg.result);
    });
    this.on('ext.theme', (p: Hello['theme']) => applyTheme(p));
  }

  private post(body: Record<string, unknown>) {
    window.parent.postMessage({ formext: 1, jsonrpc: '2.0', ...body }, '*');
  }

  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const ms = LONG.has(method) ? 300_000 : 30_000;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new FormExtError(ERR.UNAVAILABLE, `${method} timed out`));
      }, ms);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.post({ id, method, params });
    });
  }

  on(method: string, handler: Handler) {
    this.handlers.set(method, handler);
  }

  onActivate(handler: (a: Activation) => unknown) {
    this.on('ext.activate', handler);
  }

  onEvent(handler: (e: { name: string; data: unknown }) => unknown) {
    this.on('ext.event', handler);
  }

  hello(): Promise<Hello> {
    if (!this.helloCache) {
      this.helloCache = this.call<Hello>('host.hello').then((h) => {
        applyTheme(h.theme);
        return h;
      });
    }
    return this.helloCache;
  }

  notify(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') {
    return this.call<null>('ui.notify', { message, level });
  }
  resize(height: number) {
    return this.call<null>('ui.resize', { height: Math.ceil(height) });
  }
  setTitle(title: string) {
    return this.call<null>('ui.setTitle', { title });
  }
  storageGet<T = unknown>(key: string) {
    return this.call<T | null>('storage.get', { key });
  }
  storageSet(key: string, value: unknown) {
    return this.call<null>('storage.set', { key, value });
  }
  readDocument<T = unknown>(what?: string) {
    return this.call<T>('document.read', what === undefined ? {} : { what });
  }
  apply(label: string, ops: { command: string; args?: unknown }[]) {
    return this.call<{ applied: number; results: unknown[] }>('document.apply', { label, ops });
  }
  commands() {
    return this.call<{ id: string; title: string; args?: unknown }[]>('app.commands');
  }
  run<T = unknown>(command: string, args: unknown = {}) {
    return this.call<T>('app.run', { command, args });
  }
  openFiles(accept: string[], multiple = false) {
    return this.call<PickedFile[]>('files.open', { accept, multiple });
  }
  saveFile(name: string, type: string, data: string) {
    return this.call<{ saved: boolean; name: string }>('files.save', { name, type, data });
  }
  fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    return this.call<{ status: number; headers: Record<string, string>; body: string }>('net.fetch', { url, ...init });
  }
  done(result?: unknown) {
    return this.call<null>('ext.done', result === undefined ? {} : { result });
  }
}

export function applyTheme(theme: Hello['theme'] | undefined) {
  if (!theme) return;
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  for (const [name, value] of Object.entries(theme.tokens ?? {})) {
    if (name.startsWith('--')) root.style.setProperty(name, value);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function fromBase64(data: string): Uint8Array {
  const text = atob(data);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

export const formext = new FormExt();
