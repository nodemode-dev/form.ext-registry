# Submitting an extension

Every registered extension is a folder in this repository, reviewed through a pull request, the way the Raycast
extensions repository works. There are two ways to open one.

## With form.ext

form.ext's Publish step has **Submit to Registry**. It writes `extensions/<id>/` in the layout below into a folder you
choose, runs the same checks as `tools/check.py` locally, and shows the `git` and `gh` commands that open the pull
request. Run those commands, then follow the pull request as below.

## By hand

1. Fork `nodemode-dev/form.ext-registry` and clone your fork.
2. Add your extension as `extensions/<id>/`, where `<id>` is the `id` in its manifest:

   ```
   extensions/<id>/
     package/manifest.json   the Form Extension Contract manifest (api "1", native false)
     package/...             exactly what goes into the .formpkg: the built ui/ files, nothing else
     src/                    the source the package is built from
     package.json            with a "build" script that writes package/ui from src/
     package-lock.json       so npm ci installs exactly what you built with
     README.md               what it does, a screenshot, and a Permissions section
     CHANGELOG.md            an entry for the version you submit
     LICENSE                 the extension's licence
     docs/screenshot.png     the screenshot the README shows (any name, kept in the folder)
   ```

   Commit the built `package/ui` files. Do not commit `node_modules/` or `dist/`.
3. Run the checks:

   ```sh
   pip install -r tools/requirements.txt
   python3 tools/check.py extensions/<id>
   ```

   They need Python 3 and Node. Fix every error they print; [POLICY.md](POLICY.md) says what each check wants.
4. Commit on a branch, push it to your fork and open a pull request against `main`. Say in the description what
   the extension does and why it asks for each permission.

## What happens next

- The `verify` workflow runs `tools/check.py --changed` and puts the report in the job summary. A red check must be
  fixed in your branch.
- `@nodemode-ai` or `@gbarnai` reviews the code, tries the extension in its app, and approves or asks for changes.
- On merge, the `publish` workflow builds the package, releases it as `ext-<id>-v<version>` and adds it to the signed
  index with `"verified": true`. FormPortal shows it within its next index refresh.

## Updating an extension

Change the folder and raise `version` in `package/manifest.json` (and in `package.json`), with a CHANGELOG entry.
A version that is published never changes, so any change to the folder needs a new version. The index lists the
newest version; earlier ones stay downloadable by their tags.

## Removing an extension

Open an issue or a pull request that says why. A published version cannot be withdrawn from its release, but it
can be added to `registry/blocklist.json`, which removes it from the index and turns it off in every app
([SECURITY.md](SECURITY.md)).
