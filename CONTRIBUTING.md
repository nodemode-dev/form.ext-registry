# Contributing to form.ext-registry

Thank you for helping. This repository is the single source of officially registered Form extensions: every
extension FormPortal, form.ext and formai.studio offer as verified was reviewed here, built from the source in its
folder and signed by the registry. It is not an app's codebase, so contributing here works differently from the
Form apps: almost every contribution is an extension, and the registry's own code changes rarely and carefully.

## Which contribution you are making

| You want to | How |
| --- | --- |
| Add your extension | Open a pull request that adds `extensions/<id>/`. Follow [SUBMITTING.md](SUBMITTING.md); form.ext's Publish step (**Submit to Registry**) writes the folder for you. |
| Update your extension | A pull request that changes only your folder and raises its version, with a `CHANGELOG.md` entry. A published version never changes. |
| Fix or improve someone else's extension | Open an issue here that names the extension and what is wrong, so its publisher sees it. A pull request here that changes another publisher's folder is accepted only with that publisher's approval on it, or from a maintainer for a security fix. |
| Report a harmful or broken extension | Privately, as [SECURITY.md](SECURITY.md) says. Not a public issue. |
| Ask for an extension to be removed | An issue or a pull request that says why; a removal is a block list entry ([SECURITY.md](SECURITY.md)). |
| Improve the registry itself: the checks (`tools/check.py`), the index build and signing (`tools/build_index.py`), the workflows, the docs | A pull request as described under [Changing the registry itself](#changing-the-registry-itself). |
| Change the contract: the manifest, permissions, `formpkg` (`contract/`) | **Not here.** `contract/` is the Form Extension Contract kit, vendored unchanged. Open an issue on [form.ext](https://github.com/nodemode-dev/form.ext); once the kit changes, the maintainers copy the whole kit into every repository. A pull request that edits `contract/` alone is closed. |
| Change how form.ext makes, checks or submits extensions | In [form.ext](https://github.com/nodemode-dev/form.ext), which keeps its checks equal to this registry's. |

## Submitting an extension

[SUBMITTING.md](SUBMITTING.md) has the steps and the folder layout, and [POLICY.md](POLICY.md) says what an extension
must be to get in and stay in. In short:

1. Make it with [form.ext](https://github.com/nodemode-dev/form.ext) (or by hand against `contract/CONTRACT.md`).
2. Fork this repository, add `extensions/<id>/` with the built `package/`, its `src/`, `package.json` and
   `package-lock.json`, a `README.md` with a screenshot and a Permissions section, a `CHANGELOG.md` and a `LICENSE`.
3. Run the checks until they pass:

   ```sh
   pip install -r tools/requirements.txt
   python3 tools/check.py extensions/<id>
   ```

4. Open one pull request per extension against `main`, saying what it does and why it asks for each permission.

The `verify` workflow runs the same checks on the folders you changed; its job, `check`, must pass. Then
`@nodemode-ai` or `@gbarnai` reads the code, tries the extension in its app and approves it or asks for changes.
On merge, the `publish` workflow builds, signs and releases it, and adds it to the signed index with
`"verified": true`.

Some things the maintainers ask of every submission, beyond the checks:

- One extension per pull request, and only that extension's folder in it.
- The source in `src/` is the source: readable, not minified or generated past recognition, and building it gives
  the committed `package/` byte for byte.
- The permissions are the ones the extension uses, each explained in the README and the pull request.
- No secrets anywhere in the folder, and nothing fetched or run from outside the package.
- Your own words, pictures and code, or ones you have the right to share under the `LICENSE` you chose, credited.
- Other products' names appear only to say what an extension works with, never as its name or its commands' names.

A submission that fails a check stays open while you fix it in your branch. A submission that breaks the policy is
closed with the rule it breaks; a declined extension is not resubmitted under another id.

## Changing the registry itself

The registry's tools decide what every Form app trusts, so a change to them needs more care than a change to an
extension.

Set up with Python 3 and Node:

```sh
pip install -r tools/requirements.txt
python3 tools/check.py --all          # every extension must still pass, unchanged
python3 tools/build_index.py          # dist/: the packages and the unsigned index, built twice to the same bytes
```

The repository holds:

| Path | What is there |
| --- | --- |
| `extensions/<id>/` | one extension each, with its whole source project |
| `registry/blocklist.json`, `registry/publishers.json` | the block list, and the publishers' public keys |
| `tools/` | `check.py` (the seven checks), `build_index.py` (build, sign, index), `new_signing_key.py`, `registry.py` |
| `contract/` | the Form Extension Contract kit, vendored unchanged |
| `.github/workflows` | `verify` (the checks on a pull request) and `publish` (on merge to `main`) |

- Never weaken a check to let an extension in. An extension that fails is fixed in its own folder, with a new
  version. A change to a check comes with a reason, and `check.py --all` still passes on every existing extension or
  the pull request says which ones change and why.
- A change to the index, the packages or signing keeps the bytes of every published version unchanged, and keeps
  the index readable by FormPortal, form.ext and formai.studio as they are released.
- Never commit a private key, a seed or anything signed with one. Keys reach the tools only through the repository's
  secrets ([KEYS.md](KEYS.md)).
- Edits are surgical and made by hand, no em dash in Markdown, no emoji, no commented-out code; `node_modules/` and
  `dist/` are never committed.
- Write commit subjects in Conventional Commits: `fix(check): ...`, `feat(index): ...`, `docs: ...`. Leave
  `CHANGELOG.md` to the maintainers, who write its entry when the change is released.

## Maintainers

The registry is owned by:

- the [nodemode-dev](https://github.com/nodemode-dev) organisation on GitHub
- [@nodemode-ai](https://github.com/nodemode-ai)
- [@gbarnai](https://github.com/gbarnai)

They own every file (`.github/CODEOWNERS`) and are the only ones who approve a submission, change the block list or
hold the signing keys.

## How changes land

Only a maintainer pushes to `main`, and only through a pull request. Everyone else forks the repository and opens a
pull request into `main`. A pull request merges when the `check` job passes on an up-to-date branch and a maintainer
has approved it after its last push. Pull requests are merged with a merge commit, so the history of every
extension, and every signed commit, is kept.

## Licensing

The registry's own files are licensed under the Apache License 2.0 ([LICENSE](LICENSE), SPDX `Apache-2.0`); a
contribution to them is licensed under the same terms.

Each extension keeps its own licence, in the `LICENSE` in its folder. Submitting one does not change its licence,
but it does let the registry build, sign, publish and redistribute the version you submitted, unchanged, for as long
as it is listed, and keep it downloadable by its tag after that. Choose a licence that allows redistribution.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Security problems and harmful extensions go
through [SECURITY.md](SECURITY.md), never a public issue.
