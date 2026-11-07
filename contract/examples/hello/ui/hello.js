const pending = new Map();
let seq = 0;

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (!msg || msg.formext !== 1) return;
  if (msg.method === 'ext.activate') {
    reply(msg.id, null);
    if (msg.params.reason === 'command') call('ui.notify', { message: 'Hello from an extension', level: 'success' }).then(() => call('ext.done', {}));
    return;
  }
  if (msg.method) {
    if (msg.id !== undefined) reply(msg.id, null);
    return;
  }
  const waiting = pending.get(msg.id);
  if (!waiting) return;
  pending.delete(msg.id);
  if (msg.error) waiting.reject(msg.error);
  else waiting.resolve(msg.result);
});

function reply(id, result) {
  if (id !== undefined) window.parent.postMessage({ formext: 1, jsonrpc: '2.0', id, result }, '*');
}

function call(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ formext: 1, jsonrpc: '2.0', id, method, params }, '*');
  });
}

const hello = await call('host.hello');
for (const [k, v] of Object.entries(hello.theme.tokens)) document.documentElement.style.setProperty(k, v);
document.getElementById('app').textContent = `${hello.app} ${hello.appVersion}`;
document.getElementById('ext').textContent = `${hello.extension.id} ${hello.extension.version} (${hello.extension.source})`;
call('document.read', {}).then(
  (doc) => (document.getElementById('doc').textContent = JSON.stringify(doc).slice(0, 160)),
  (err) => (document.getElementById('doc').textContent = err.message),
);
document.getElementById('ping').addEventListener('click', () => call('ui.notify', { message: 'Hello from an extension', level: 'info' }));
