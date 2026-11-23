# Tests

The registry's tests. They live here, outside `extensions/` and `contract/`, so an extension's bytes and the kit copy
never change because a test was added: `tools/check.py --changed` sees no changed extension and `tools/check_kit.py`
still matches `contract.sha256`.

## Run them

```bash
pip install -r tools/requirements.txt -r tests/requirements.txt
python3 -m pytest
node --experimental-transform-types --import ./tests/ts/register.mjs --test "tests/**/*.test.ts" "tests/**/*.test.mjs"
```

One file: `python3 -m pytest tests/tools/test_check_kit.py`, or the `node` line with one path in place of the two
patterns. The `tests` workflow runs both lines on every pull request and on `main`. Node 22 is enough; nothing is
installed with npm.

## Layout

| Folder | What it tests | Runner |
| --- | --- | --- |
| `tests/tools/` | `tools/check.py`, `check_kit.py`, `build_index.py`, `registry.py`, `new_signing_key.py` | pytest |
| `tests/contract/` | the kit: `formpkg.py`, `formext_host.py`, `host-bridge.ts`, the SDK `formext.ts` | pytest and node |
| `tests/extensions/<id>/` | the modules of one extension, read from `extensions/<id>/src` | node |
| `tests/test_registry_data.py` | the manifests, the registry files and the packager copies as they stand | pytest |
| `tests/ts/` | the loader that lets Node import the extensions' TypeScript as it is written | |
| `tests/conftest.py` | `repo_root`, `load_module` and `run_tool` for the Python tests | |

## What a test must do

- Test what the code is for, from outside: real input, the result a person would expect, the edges, bad input.
  The expected value is worked out from the format or the contract (`contract/CONTRACT.md`), never copied from what
  the code returned.
- Write only under a temporary folder. A tool that works on the repository it lives in is copied into the temporary
  folder and run there. Nothing is written into `extensions/`, `contract/` or `registry/`.
- Use no network and no real key. Signing tests make a throwaway Ed25519 key.
- A test that finds a real fault stays as it is. In pytest it is marked
  `@pytest.mark.xfail(strict=True, reason="defect: ...")`, in Node `{ todo: "defect: ..." }`, so the suite stays green,
  the fault stays visible, and the mark fails the run on the day the fault is fixed and the mark was not removed.
- No check is ever weakened to make a test pass, and no test is weakened to make the code pass.
