import { formext } from './formext.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function errorText(err) {
  if (!err) return 'Something went wrong.';
  if (err.code === -32001) return 'Allow this extension in the Extensions panel first.';
  if (err.code === -32002) return 'Cancelled.';
  return err.message || String(err);
}

export function status(text, level = 'info') {
  const el = $('#status');
  if (!el) return;
  if (el.textContent !== text) el.textContent = text;
  el.dataset.level = level;
}

export function fill(el, html) {
  if (el && el.innerHTML !== html) el.innerHTML = html;
}

export function debounce(fn, ms = 120) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function fitHeight() {
  let last = 0;
  const send = () => {
    const height = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(height - last) < 2) return;
    last = height;
    formext.resize(height).catch(() => undefined);
  };
  new ResizeObserver(() => requestAnimationFrame(send)).observe(document.body);
}

export function headless(run, onPanel) {
  formext.onActivate((activation) => {
    if (activation.reason !== 'command' || activation.panel) {
      if (onPanel) setTimeout(() => onPanel(activation), 0);
      return null;
    }
    setTimeout(async () => {
      try {
        const result = await run(activation);
        await formext.done(result ?? {});
      } catch (err) {
        await formext.notify(errorText(err), 'error').catch(() => undefined);
        await formext.done({ error: errorText(err) });
      }
    }, 0);
    return null;
  });
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
