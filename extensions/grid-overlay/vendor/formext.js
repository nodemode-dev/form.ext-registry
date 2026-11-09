export const ERR = { NOT_FOUND: -32601, INVALID: -32602, PERMISSION: -32001, CANCELLED: -32002, UNAVAILABLE: -32003, REFUSED: -32004 };

export class FormExtError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const LONG = new Set(['files.open', 'files.save', 'app.run', 'document.apply', 'net.fetch']);

export class FormExt {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.helloCache = null;
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
    this.on('ext.theme', (theme) => applyTheme(theme));
  }

  post(body) {
    window.parent.postMessage({ formext: 1, jsonrpc: '2.0', ...body }, '*');
  }

  call(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const ms = LONG.has(method) ? 300000 : 30000;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new FormExtError(ERR.UNAVAILABLE, `${method} timed out`));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ id, method, params });
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  onActivate(handler) {
    this.on('ext.activate', handler);
  }

  onEvent(handler) {
    this.on('ext.event', handler);
  }

  hello() {
    if (!this.helloCache) {
      this.helloCache = this.call('host.hello').then((h) => {
        applyTheme(h.theme);
        return h;
      });
    }
    return this.helloCache;
  }

  notify(message, level = 'info') {
    return this.call('ui.notify', { message, level });
  }
  resize(height) {
    return this.call('ui.resize', { height: Math.ceil(height) });
  }
  setTitle(title) {
    return this.call('ui.setTitle', { title });
  }
  storageGet(key) {
    return this.call('storage.get', { key });
  }
  storageSet(key, value) {
    return this.call('storage.set', { key, value });
  }
  readDocument(what) {
    return this.call('document.read', what === undefined ? {} : { what });
  }
  apply(label, ops) {
    return this.call('document.apply', { label, ops });
  }
  commands() {
    return this.call('app.commands');
  }
  run(command, args = {}) {
    return this.call('app.run', { command, args });
  }
  openFiles(accept, multiple = false) {
    return this.call('files.open', { accept, multiple });
  }
  saveFile(name, type, data) {
    return this.call('files.save', { name, type, data });
  }
  fetch(url, init = {}) {
    return this.call('net.fetch', { url, ...init });
  }
  done(result) {
    return this.call('ext.done', result === undefined ? {} : { result });
  }
}

export function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  root.dataset.theme = theme.mode;
  for (const [name, value] of Object.entries(theme.tokens ?? {})) {
    if (name.startsWith('--')) root.style.setProperty(name, value);
  }
}

export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export function fromBase64(data) {
  const text = atob(data);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

export function textToBase64(text) {
  return toBase64(new TextEncoder().encode(text));
}

export const formext = new FormExt();
