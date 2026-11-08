<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/registry-icon-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/registry-icon-light.png">
    <img src="assets/registry-icon-dark.png" width="128" height="128" alt="Form Extension Registry icon: four puzzle pieces as a tile, one lifted out in the extension colours">
  </picture>
</p>

# Form Extension Registry

The single source of officially registered extensions for the Form apps (FormVis, FormCut, FormWav, FormPDF,
FormDeck, FormLit, Form.md, FormEncoder, FormVFX, FormMCP, FormTray, FormSkills). Every extension lives here as a
whole source project under `extensions/<id>/`. A push to `main` builds each one into a deterministic `.formpkg`,
signs it, and publishes a signed index that FormPortal, form.ext and formai.studio read.

The repository is public. Until the owners add the signing keys (see [KEYS.md](KEYS.md)), nothing is published
yet, and the apps say so plainly when the index or a download is refused.

## How an extension gets in

1. Someone opens a pull request that adds or changes `extensions/<id>/` (see [SUBMITTING.md](SUBMITTING.md), or use
   form.ext's Submit to Registry, which writes the folder and runs the same checks).
2. The `verify` workflow runs `tools/check.py --changed` and posts its report as the job summary. Every check in
   [POLICY.md](POLICY.md) must pass.
3. The owners, `@nodemode-ai` and `@gbarnai`, review the code and the behaviour. Both are code owners, so nothing
   merges without one of them.
4. On merge, the `publish` workflow builds every package, creates an immutable release for each version not released
   before, and replaces the signed index.

## What "verified" means

An entry in the index has `"verified": true` when, and only when, it was built by this repository's `publish`
workflow from source that passed every check and was approved by an owner. It says the package is exactly what the
reviewed source builds (`sha256`, reproducible from `registry_commit`), that it is signed by the `nodemode` publisher
key, and that it keeps the registry's [policy](POLICY.md). It is not a promise that an extension has no bugs.

## Where the index lives

| What | URL |
|---|---|
| Index | `https://github.com/nodemode-dev/form.ext-registry/releases/download/index/extensions.json` |
| Index signature | the same URL plus `.sig` |
| Block list | `https://github.com/nodemode-dev/form.ext-registry/releases/download/index/blocklist.json` (plus `.sig`) |
| Packages | `https://github.com/nodemode-dev/form.ext-registry/releases/download/ext-<id>-v<version>/<id>-<version>.formpkg` |

The index follows `contract/schema/extensions.schema.json` (`format: formai-extensions`). It lists the newest
version of each extension; older versions stay downloadable by their tag. Each entry adds `verified`,
`registry_commit` (the commit of `main` it was built from) and `source` (its folder here). Signatures are base64
Ed25519: the `.sig` files are made with the registry key over the exact bytes of the file, and each package entry's
`signature` is made with the publisher key over the package bytes. [KEYS.md](KEYS.md) says how the keys are made
and where their public halves go.

Blocked extensions are never listed, and the block list turns them off in every app ([SECURITY.md](SECURITY.md)).

## Layout

```
extensions/<id>/            one extension: package/ (exactly what ships), src/, package.json, README, ...
registry/blocklist.json     blocked ids and versions
registry/publishers.json    publisher public keys, copied into the index
contract/                   the Form Extension Contract kit, vendored unchanged
tools/check.py              the pull request checks
tools/build_index.py        builds, signs and indexes every package into dist/
tools/new_signing_key.py    makes an Ed25519 key pair
```

## Tools

```sh
pip install -r tools/requirements.txt
python3 tools/check.py --all                 # every extension
python3 tools/check.py --changed             # what this branch changes against origin/main
python3 tools/check.py extensions/shot-list  # one folder
python3 tools/build_index.py                 # dist/: packages, extensions.json, blocklist.json (unsigned without keys)
```

`build_index.py` signs when `PUBLISHER_SIGNING_KEY` and `REGISTRY_SIGNING_KEY` are set (base64 raw 32-byte Ed25519
seeds). The checks build each extension with `npm ci && npm run build`, so they need Node; `--skip-npm` leaves that
step out for a quick local run.

## Contributing

Most contributions are extensions: add yours as `extensions/<id>/` in a pull request ([SUBMITTING.md](SUBMITTING.md),
[POLICY.md](POLICY.md)). Changes to the registry's own tools, workflows and docs are welcome too, with more care,
and changes to the contract go to the Form Extension Contract kit first. [CONTRIBUTING.md](CONTRIBUTING.md) says which
is which, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) how we treat each other, and [SECURITY.md](SECURITY.md) how to
report a harmful extension privately.

## Licence

The registry's own files are under the Apache License 2.0 ([LICENSE](LICENSE)). Each extension carries its own
licence in its folder.
