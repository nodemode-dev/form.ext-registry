# Registry policy

What an extension must be to get into the registry and stay there. It borrows from the Comfy Registry's node
standards (no dynamic code, no hidden network use, no obfuscation) and from the way the VS Code Marketplace signs
packages and keeps a block list, adapted to the Form Extension Contract's sandbox. `tools/check.py` checks every
rule it can; the owners review the rest.

## The checks

Each changed `extensions/<id>/` must pass all seven. The report names the rule and the file and line.

1. **Contract.** The folder name is the manifest `id`. `product` is one of the Form host apps, `api` is `"1"`,
   `native` is `false`, and the contract kit's `formpkg.py validate` accepts `package/` (file types, sizes, paths,
   manifest fields).
2. **Version and immutability.** A new extension may start at any `x.y.z`. A changed extension raises its version
   above the newest published one. The bytes of a published version never change: the package built from the folder
   is compared with the published index when it is reachable, and with the build of the base commit otherwise.
3. **Reproducible.** Building `package/` twice gives the same SHA-256. When the folder has a `package.json`,
   `npm ci && npm run build` in a clean copy makes the committed `package/` files byte for byte, so what ships is
   what the source says.
4. **Code bans.** In `src/` and in the shipped files:
   - no `eval`, `new Function`, or `setTimeout` or `setInterval` with a string;
   - no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon`: the only way out is the SDK's
     `net.fetch`, which the host runs under the `network` permission and the person's consent;
   - no remote `<script src>`, no `import` from a URL, no remote stylesheet import: everything an extension runs is
     in its package;
   - no obfuscated source: no lines over 1000 characters and no long encoded blobs or escape runs in `src/`;
   - no secrets: API keys, tokens and private keys are refused by pattern anywhere in the folder.
5. **Permissions.** The permissions in the manifest are exactly those the source uses, found from the SDK calls in
   `src/`: `document` for reading or changing the document and running app commands, `files-read` for opening files,
   `files-write` for saving them, `network` for `net.fetch`. Asking for more than it uses is refused as firmly as
   using more than it asks.
6. **Metadata.** A `README.md` that says what the extension does, with a Permissions section naming each permission
   and why (or saying it needs none), and a screenshot kept in the folder; a `LICENSE`; a `CHANGELOG.md` with an
   entry for the version.
7. **Block list.** The id and version are not on `registry/blocklist.json`.

## Standards the owners review

- **It does what it says.** The README, the manifest description and the behaviour match. No hidden features.
- **It respects the person.** No tracking, no telemetry, no advertising, no collecting data the extension's job does
  not need. Anything sent with `network` is named in the README, with where it goes.
- **It stays in its lane.** An extension changes the document only through the app's own commands, the way the
  contract allows, and never tries to escape the sandbox or reach another extension's storage.
- **It is safe to leave installed.** No crypto mining, no background work after a headless command is done, no
  deliberately heavy loops.
- **It is lawful and kind.** No malware, no content or code the author has no right to distribute, nothing hateful
  or sexual, no impersonation of another publisher or app.
- **It looks like it belongs.** It follows the host's theme tokens, has no layout flash on load, and keeps to the
  app's words for its own commands.
- **It has a licence that allows redistribution**, and credits third-party code and media it carries.

## What the registry does in return

- Builds every package from reviewed source, signs it with the `nodemode` publisher key, and lists it in a signed
  index with `"verified": true`.
- Keeps every published version downloadable by its tag, unchanged.
- Takes an extension off the index and turns it off everywhere through the block list when it breaks these rules
  ([SECURITY.md](SECURITY.md)).

## Breaking the rules after publication

An extension found breaking a rule is blocked, by version or entirely. Malicious behaviour blocks every version
(`"versions": ["*"]`) at once, without waiting for the author. Anything else gets an issue and a reasonable time to
fix it with a new version.
