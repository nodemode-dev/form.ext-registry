# Form Extension Contract, API 1

One contract for every Form app that loads extensions. FormPortal installs a package, the app loads it, form.ext makes it, formai.studio lists it. Nothing here is app-specific except the `document` and `app` methods, which each app documents in its own `docs/EXTENSIONS.md`.

This contract extends the existing formai package and index formats (`format: formai-package`, `format_version: 1`; `format: formai-extensions`, `format_version: 1`). Every addition is optional and additive, so packages and indexes written before it stay valid.

## 1. Products

The product ids are the ids in formai.studio's `catalog/products.json`:

| Product id | App | Repository |
|---|---|---|
| `formvis` | FormVis | formvis |
| `formcut` | FormCut | formcut |
| `formwav` | FormWav | formwav |
| `formpdf` | FormPDF | formpdf |
| `formdeck` | FormDeck | formdeck |
| `formlit` | FormLit | formlit |
| `formmd` | Form.md | form.md |
| `formencoder` | FormEncoder | formencoder |
| `formvfx` | FormVFX | formvfx |
| `formmcp` | FormMCP | formMCP |
| `formtray` | FormTray | formtray |
| `formskills` | FormSkills | formskills |
| `formportal` | FormPortal | formportal |

The `product` enum in both schemas lists these thirteen.

## 2. The package (`.formpkg`)

A zip with `manifest.json` at its root (no enclosing folder). Rules:

- At most 20 MB packed, at most 512 files, no symlinks, no absolute paths, no `..`, no path over 200 characters.
- File types: `.html .js .mjs .css .json .svg .png .webp .jpg .jpeg .gif .wasm .txt .md .wav .ogg .mp3 .webm .mp4 .cube .woff2`. Anything else is refused.
- Deterministic: entries sorted by path, timestamps 1980-01-01 00:00:00, mode 0644, deflate. `tools/formpkg.py build` makes exactly this, so the same folder always gives the same SHA-256.

### manifest.json

The required fields are those of `schema/package.schema.json` (format, format_version, id, name, product, kind, version, author, licence, native, permissions). API 1 adds:

```json
{
  "format": "formai-package",
  "format_version": 1,
  "id": "beat-markers",
  "name": "Beat Markers",
  "product": "formcut",
  "kind": "script-plugin",
  "version": "0.1.0",
  "author": "nodemode",
  "licence": "Apache-2.0",
  "native": false,
  "permissions": ["document", "files-read"],
  "minimum_app": "2.14.0",
  "api": "1",
  "description": "Finds the beats in a music clip and drops a marker on each one.",
  "entry": { "ui": "ui/index.html" },
  "contributes": {
    "panels": [{ "id": "main", "title": "Beat Markers", "location": "dock" }],
    "commands": [{ "id": "mark-beats", "title": "Mark Beats in Selected Clip" }]
  },
  "homepage": "https://formai.studio/extensions/#beat-markers"
}
```

- `api`: `"1"`. A host refuses any other value, or a missing one, with the resolver's words: "it needs extension API {value}; this {App} offers API 1" (`formext_host.check`; ports keep the same text, `None` included).
- `entry.ui`: the page the host loads in the sandbox. Required when `contributes` has panels or commands.
- `contributes.panels[]`: `id` (`^[a-z0-9][a-z0-9-]{0,31}$`), `title`, `location` (`dock` or `dialog`). A `dock` panel opens where the app keeps its panels; a `dialog` panel opens as a modal of the app's own dialog style.
- `contributes.commands[]`: `id`, `title`, optional `panel` (the panel to open and activate with the command). A command without `panel` runs headless: the host loads `entry.ui` in a hidden sandbox, sends `ext.activate` with the command, and closes the frame when the extension calls `ext.done` or after 120 s without a pending request from the extension. The clock stops while a `files.open`, `files.save`, `app.run`, `document.apply` or `net.fetch` request is pending, and restarts when it is answered.
- `minimum_app` is compared with the version the host reports. A source build reports its last release until the release commit, so leave `minimum_app` out of a test copy when testing against an unreleased build.
- `native: true` is not supported by API 1 hosts. They list such a package and say "native extensions are not supported by this app".

## 3. Where apps find extensions

FormPortal's root folder (same rules as `Portal::default_root` in FormPortal's core):

1. `FORMPORTAL_ROOT` when set.
2. macOS: `~/Library/Application Support/studio.formai.portal`, or `dev.formai.portal` when only that one exists.
3. Windows: `%LOCALAPPDATA%\FormPortal`.
4. Linux and others: `$XDG_DATA_HOME/formportal`, else `~/.local/share/formportal`.

Under it, for product `P`:

- `extensions/P/enabled.json`: written by FormPortal. `{ "format": "formportal-enabled-extensions", "format_version": 1, "product": "P", "extensions": [ { "id", "kind", "version", "path", "permissions", "native", "source" } ] }`. `source` is `catalogue` or `sideload`. `path` is the unpacked folder.
- `extensions/P/dev.json`: written by form.ext's Run in App. `{ "format": "formext-dev-extensions", "format_version": 1, "product": "P", "extensions": [ { "id", "path", "added" } ] }`. `path` is an unpacked folder on this computer. Hosts load these with the source `development`.

The host resolves both files at start and again whenever either file's modification time changes. It checks at least every 2 s while the window has focus, and also on Reload Extensions. A change updates only the rows and panels that changed.

For each entry the host reads `path/manifest.json` and refuses the extension, with the reason shown in its Extensions panel, when any of these holds:

- the manifest is not valid JSON or not `formai-package`
- `id` differs from the entry or `product` differs from the app
- `api` is not `"1"`
- `native` is true
- `entry.ui` is missing, absolute, contains `..`, or is not a file inside `path`
- `minimum_app` is newer than the app

## 4. Serving the files

The host serves an extension's files from its own engine or protocol under one prefix:

`GET /api/extensions/files/{id}/{version}/{path}`

(A Tauri-only app uses a custom protocol with the same shape: `formext://{id}/{version}/{path}`, which Windows webviews reach as `http://formext.localhost/{id}/{version}/{path}`; the host gives the window the absolute prefix its platform uses in each record's `base`.)

A host whose window is cross-origin isolated (COOP same-origin with COEP) also sends `Cross-Origin-Embedder-Policy` with the same value on every extension file, so the framed page may load inside it.

A host whose local API refuses unknown origins lets GET and HEAD under the files prefix through with any `Origin` (including `null`) and any `Sec-Fetch-Site`, still on loopback only. The prefix serves only the package's own files and has no side effects; every other route keeps its guard.

- Resolve `path` inside the extension's folder after normalising, and refuse anything outside it, any symlink, and any type not in the list in section 2. Answer 404 for all of these, with no detail.
- Headers on every answer: `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin: *` (the sandboxed frame has an opaque origin, so its module scripts, fetches of its own files and WebAssembly need it; the files are the package's own and hold nothing private), and for HTML `Content-Security-Policy: default-src 'none'; script-src BASE 'wasm-unsafe-eval'; style-src BASE 'unsafe-inline'; img-src BASE data: blob:; media-src BASE data: blob:; font-src BASE; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`, where BASE is `'self'` when the files are served from the app's own origin (the usual case, and the only one that works through a development proxy), or, for a custom protocol, the extension's own absolute prefix (`formext://{id}/{version}/`, on Windows `http://formext.localhost/{id}/{version}/`), never the bare scheme. `formext_host.csp_for` writes it.
- The host gives the frame a relative `src` (`/api/extensions/files/{id}/{version}/{entry.ui}`) when it serves from its own origin, so the same page works in development and in the built app.

## 5. The sandbox

Every extension page runs in an iframe with `sandbox="allow-scripts"` and nothing else: no same-origin, no forms, no popups, no top navigation, no downloads. `allow=""`, `referrerpolicy="no-referrer"`. The host never injects script into the frame and never reads its DOM. The only channel is `postMessage`.

## 6. The protocol

JSON-RPC 2.0 over `postMessage`, each message an object with `"formext": 1` beside the JSON-RPC fields. The host accepts messages only when `event.source` is that extension's frame. The extension accepts messages only from `window.parent`. Requests time out after 30 s, or 300 s for `files.*` and `app.run`.

### Extension to host

| Method | Params | Result | Permission |
|---|---|---|---|
| `host.hello` | `{}` | `{ product, app, appVersion, api: "1", extension: { id, version, source }, permissions, theme: { mode, tokens }, locale }` | none |
| `ui.notify` | `{ message, level: "info" \| "success" \| "warning" \| "error" }` | `null` | none |
| `ui.resize` | `{ height }` | `null` | none |
| `ui.setTitle` | `{ title }` | `null` | none |
| `storage.get` | `{ key }` | the stored JSON value or `null` | none |
| `storage.set` | `{ key, value }` | `null`, at most 256 KB per extension in total | none |
| `document.read` | `{ what? }` | the app's document snapshot (the app's `docs/EXTENSIONS.md`). Optional `what: "file"`: a host that can hand over the open document returns `{ name, type, size, data }` (base64, at most 200 MB, as it would be saved now, unsaved changes included); one that cannot answers -32602 or -32004 and the extension falls back to `files.open` | `document` |
| `document.apply` | `{ label, ops: [{ command, args }] }` | `{ applied, results }`, run as one step labelled `label`: undoable as one step where the app has undo, and otherwise applied all at once or not at all | `document` |
| `app.commands` | `{}` | `[{ id, title, args? }]`, the app's own command catalogue | `document` |
| `app.run` | `{ command, args }` | the command's result | `document` |
| `files.open` | `{ accept: [".wav"], multiple?: false }` | `[{ name, type, size, data }]` with `data` base64, at most 200 MB in total; the person picks through the host's own dialog | `files-read` |
| `files.save` | `{ name, type, data }` with `data` base64 | `{ saved: true, name }`; the person picks the place through the host's own dialog. A host with no save dialog asks the person to confirm the name in its own dialog and saves into the downloads folder (`name (2).ext` when taken) | `files-write` |
| `net.fetch` | `{ url, method?, headers?, body? }` with an `https://` url | `{ status, headers, body }` with `body` base64, at most 50 MB | `network` |
| `ext.done` | `{ result? }` | `null`, ends a headless command | none |

`document.apply` ops use the app's own command surface, the same one its palette, command line or MCP tools use, so an extension can never do what the app itself cannot.

### Host to extension

| Method | Params |
|---|---|
| `ext.activate` | `{ reason: "panel" \| "command", panel?, command?, args? }` |
| `ext.theme` | `{ mode: "dark" \| "light", tokens }` |
| `ext.event` | `{ name, data }`: app events such as `document.changed` and `selection.changed`, listed in the app's `docs/EXTENSIONS.md` |
| `ext.deactivate` | `{}` |

`tokens` is a flat object of the app's design tokens (`--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--border`, `--radius` at least), so an extension can look like the app it runs in.

### Errors

| Code | Meaning |
|---|---|
| -32601 | the method is not in API 1 |
| -32602 | invalid params |
| -32001 | permission not granted |
| -32002 | the person cancelled |
| -32003 | not available in this app (for example `net.fetch` in an app that has no network) |
| -32004 | the app refused the operation (the message says why, in the app's words) |

## 7. Permissions and consent

Permissions are those of `package.schema.json`: `document`, `files-read`, `files-write`, `network`, `models`, `native-code`. The first time an extension version is activated, the host shows its own consent dialog listing what the extension asks for, in plain words:

- `document`: read and change the open document
- `files-read`: open files you choose
- `files-write`: save files where you choose
- `network`: reach the internet
- `models`: use local models

The host asks before it creates the extension's frame (panel or headless), so the extension's first `host.hello` already carries the granted permissions; while the dialog is open no frame exists. The person chooses Allow or Not Now. Allow is stored per id, version and permission set, and a new version or a larger permission set asks again. Not Now is not stored: the next activation asks again. Every call needing a permission that is not granted fails with -32001, and the host never prompts mid-call.

## 8. In the app

Every host shows the same four things, in its own design language:

1. **An Extensions menu**, top level in the menu bar. An app without a menu bar puts the same items where its other commands live. It lists:
   - one item per contributed command, `Name: Title`
   - a separator
   - Extensions Panel
   - Reload Extensions
   - Manage in FormPortal, which opens `formai://extensions?product=P`
2. **The Extensions panel.** One row per extension with its name, version, source (Catalogue, File, Development), permission chips, and state (Ready, Needs Permission, Refused with the reason). Each row has Open (for its panels) and, for development extensions, its folder path. When nothing is installed it says "No extensions yet. Find them in FormPortal or make one with form.ext." with the Manage in FormPortal button.
3. **Contributed panels**, docked or as dialogs, each with the extension's name in its title. An app without a dock puts dock panels where its own panels or tiles live (FormTray: tiles on its Widgets board).
4. **Agent access** when the app has an MCP server or command line: `extensions_list` (id, name, version, source, state, commands) and `extension_command` (id, command, args), which runs a contributed command with the same consent rules. An MCP server whose tools all carry the app's prefix names them `<prefix>_extensions_list` and `<prefix>_extension_command`, with the same arguments and answers. An app whose command line cannot reach its window hands the request to the open window (for example through a request folder in its data folder) and fails at once, in plain words, when no window takes it. The command palette lists the contributed commands where the app has a palette.

Zero flash: the menu, the panel and the rows exist in their final layout before the first paint, with their content filled in place. A reload changes only what changed.

## 9. Code to reuse

This kit carries the shared parts, under the Apache License 2.0, so every app behaves the same:

- `sdk/formext.ts`: the extension side (a typed client, about 150 lines, no dependencies). Extensions copy it or import it.
- `host/host-bridge.ts`: the host side for apps with a TypeScript interface. It creates the sandboxed frame, routes messages, checks the origin, checks permissions and times out requests; the app passes handlers and a consent function.
- `host/python/formext_host.py`: resolves the FormPortal root, reads `enabled.json` and `dev.json`, validates manifests, serves files safely. It is pure standard library, for apps with a Python engine.
- `tools/formpkg.py`: validates a folder and builds the deterministic `.formpkg`, prints its SHA-256 and size, and prints an index entry.
- `schema/`: the widened package and index schemas, plus `enabled.schema.json` and `dev.schema.json`.
- `examples/hello`: the smallest working extension.

A Rust or Go host ports `formext_host.py` line for line and keeps its messages.

## 10. Versions

API 1 is this document. A host reports `api: "1"` in `host.hello`. Anything new is added to API 1 only when it is optional and an older host can answer -32601.
