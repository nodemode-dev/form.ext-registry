import argparse
import json
import os
import re
import shutil
import subprocess

import pytest

FOCUS = "focus-timer"
GRID = "grid-overlay"
FOCUS_VERSION = "0.1.0"
FOCUS_SHA = "d1e72e664e6bde8b2fe4e7b5c92278d4a6ec7517fc1c532d8fb462c58fbd3804"
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_AUTHOR_NAME": "Test Identity",
    "GIT_AUTHOR_EMAIL": "test@example.invalid",
    "GIT_COMMITTER_NAME": "Test Identity",
    "GIT_COMMITTER_EMAIL": "test@example.invalid",
}


def git(repo, *args):
    out = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        env={**os.environ, **GIT_ENV},
    )
    assert out.returncode == 0, out.stderr
    return out.stdout


def commit_all(repo, message):
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message)


def write_index(repo, packages):
    path = repo / "published.json"
    path.write_text(json.dumps({"packages": packages}), encoding="utf-8")
    return path


def raise_focus_version(repo, version):
    manifest_path = repo / "extensions" / FOCUS / "package" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = version
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    changelog = repo / "extensions" / FOCUS / "CHANGELOG.md"
    changelog.write_text(changelog.read_text(encoding="utf-8") + f"\n## {version}\n\n- A test change.\n", encoding="utf-8")


def touch_focus_package(repo):
    page = repo / "extensions" / FOCUS / "package" / "ui" / "focus.css"
    page.write_text(page.read_text(encoding="utf-8") + "\n.test-extra { color: red; }\n", encoding="utf-8")


def section(report, name):
    blocks = report.split("\n\n")
    for block in blocks:
        if block.startswith(name + ":"):
            return block
    raise AssertionError(f"no section for {name} in:\n{report}")


@pytest.fixture(scope="module")
def template(tmp_path_factory, repo_root):
    repo = tmp_path_factory.mktemp("template") / "repo"
    repo.mkdir()
    skip = shutil.ignore_patterns("node_modules", "dist", "__pycache__", ".git")
    for name in ("tools", "contract", "registry"):
        shutil.copytree(repo_root / name, repo / name, ignore=skip)
    shutil.copy2(repo_root / "contract.sha256", repo / "contract.sha256")
    for ext in (FOCUS, GRID):
        shutil.copytree(repo_root / "extensions" / ext, repo / "extensions" / ext, ignore=skip)
    (repo / ".gitignore").write_text("__pycache__/\npublished.json\n", encoding="utf-8")
    git(repo, "init", "-q", "-b", "main")
    commit_all(repo, "base")
    git(repo, "update-ref", "refs/remotes/origin/main", "HEAD")
    return repo


@pytest.fixture
def scratch(template, tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(template, repo)
    return repo


@pytest.fixture
def check(scratch, run_tool):
    def run(*args, published=None, env=None):
        index = published if published is not None else write_index(scratch, [])
        merged = {**GIT_ENV, **(env or {})}
        return run_tool(scratch / "tools" / "check.py", "--skip-npm", "--published", index, *args, cwd=scratch, env=merged)

    return run


def test_clean_repository_passes_every_extension(check):
    out = check("--all")
    assert out.returncode == 0, out.stdout + out.stderr
    assert out.stdout.splitlines()[0] == "Form Extension Registry checks"
    assert "registry/: passed" in out.stdout
    assert f"extensions/{FOCUS}: passed" in out.stdout
    assert f"extensions/{GRID}: passed" in out.stdout
    assert "FAILED" not in out.stdout
    assert "  error " not in out.stdout
    assert out.stdout.rstrip().splitlines()[-1] == "2 extensions checked; all passed"


def test_clean_repository_reports_all_seven_checks_per_extension(check):
    out = check("--all")
    block = section(out.stdout, f"extensions/{FOCUS}")
    numbers = re.findall(r"^  ok    (\d) ", block, flags=re.M)
    assert sorted(numbers) == ["1", "2", "3", "4", "5", "6", "7"]
    assert f"note  {FOCUS}: the npm rebuild was skipped (--skip-npm)" in block
    assert "reproduced package/ byte for byte" not in out.stdout


def test_no_arguments_checks_every_extension(check):
    out = check()
    assert out.returncode == 0
    assert f"extensions/{FOCUS}: passed" in out.stdout
    assert f"extensions/{GRID}: passed" in out.stdout
    assert "2 extensions checked; all passed" in out.stdout


def test_one_folder_checks_only_that_extension(check):
    out = check(f"extensions/{FOCUS}")
    assert out.returncode == 0
    assert f"extensions/{FOCUS}: passed" in out.stdout
    assert GRID not in out.stdout
    assert out.stdout.rstrip().splitlines()[-1] == "1 extension checked; all passed"


def test_changed_with_nothing_changed_checks_no_extension(check):
    out = check("--changed")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "note: 0 changed files against origin/main; extensions changed: none" in out.stdout
    assert "registry/: passed" in out.stdout
    assert "extensions/" not in out.stdout
    assert out.stdout.rstrip().splitlines()[-1] == "0 extensions checked; all passed"


def test_changed_package_without_version_rise_fails(scratch, check):
    touch_focus_package(scratch)
    commit_all(scratch, "change shipped file")
    out = check("--changed")
    assert out.returncode == 1
    assert "note: 1 changed files against origin/main; extensions changed: focus-timer" in out.stdout
    block = section(out.stdout, f"extensions/{FOCUS}")
    assert block.startswith(f"extensions/{FOCUS}: FAILED")
    assert "error 2 version and immutability:" in block
    assert f"under the same version {FOCUS_VERSION}: raise the version" in block
    assert GRID not in out.stdout
    assert out.stdout.rstrip().splitlines()[-1] == "1 extension checked; 1 with errors"


def test_changed_readme_without_version_rise_fails(scratch, check):
    readme = scratch / "extensions" / FOCUS / "README.md"
    readme.write_text(readme.read_text(encoding="utf-8") + "\nOne more line.\n", encoding="utf-8")
    commit_all(scratch, "change readme")
    out = check("--changed")
    assert out.returncode == 1
    block = section(out.stdout, f"extensions/{FOCUS}")
    assert f"the extension changed, so its version must rise above {FOCUS_VERSION} on origin/main" in block


def test_changed_extension_with_version_rise_passes(scratch, check):
    touch_focus_package(scratch)
    raise_focus_version(scratch, "0.1.1")
    commit_all(scratch, "raise version")
    out = check("--changed")
    assert out.returncode == 0, out.stdout + out.stderr
    assert "extensions changed: focus-timer" in out.stdout
    block = section(out.stdout, f"extensions/{FOCUS}")
    assert block.startswith(f"extensions/{FOCUS}: passed")
    assert "ok    2 version and immutability" in block
    assert out.stdout.rstrip().splitlines()[-1] == "1 extension checked; all passed"


def test_version_below_the_base_commit_fails(scratch, check):
    raise_focus_version(scratch, "0.0.9")
    commit_all(scratch, "lower version")
    out = check("--changed")
    assert out.returncode == 1
    assert f"0.0.9 is below {FOCUS_VERSION} on origin/main" in section(out.stdout, f"extensions/{FOCUS}")


def test_published_version_with_same_bytes_passes(scratch, check):
    index = write_index(scratch, [{"id": FOCUS, "version": FOCUS_VERSION, "sha256": FOCUS_SHA}])
    out = check(f"extensions/{FOCUS}", published=index)
    assert out.returncode == 0, out.stdout
    assert "ok    2 version and immutability" in out.stdout


def test_published_version_with_other_bytes_fails(scratch, check):
    other = "0" * 64
    index = write_index(scratch, [{"id": FOCUS, "version": FOCUS_VERSION, "sha256": other}])
    out = check(f"extensions/{FOCUS}", published=index)
    assert out.returncode == 1
    block = section(out.stdout, f"extensions/{FOCUS}")
    assert f"{FOCUS_VERSION} is published with SHA-256 {other}, but this folder builds {FOCUS_SHA}" in block
    assert "raise the version" in block


def test_version_below_the_published_one_fails(scratch, check):
    index = write_index(scratch, [{"id": FOCUS, "version": "0.0.5", "sha256": "1" * 64}, {"id": FOCUS, "version": "0.10.0", "sha256": "2" * 64}])
    out = check("--all", published=index)
    assert out.returncode == 1
    assert f"{FOCUS_VERSION} is below the published 0.10.0" in section(out.stdout, f"extensions/{FOCUS}")
    assert section(out.stdout, f"extensions/{GRID}").startswith(f"extensions/{GRID}: passed")
    assert out.stdout.rstrip().splitlines()[-1] == "2 extensions checked; 1 with errors"


def test_published_index_from_environment_is_used(scratch, run_tool):
    index = write_index(scratch, [{"id": FOCUS, "version": "9.0.0", "sha256": "3" * 64}])
    env = {**GIT_ENV, "FORMEXT_PUBLISHED_INDEX": str(index)}
    out = run_tool(scratch / "tools" / "check.py", "--skip-npm", f"extensions/{FOCUS}", cwd=scratch, env=env)
    assert out.returncode == 1
    assert f"{FOCUS_VERSION} is below the published 9.0.0" in out.stdout


def test_unreadable_published_index_is_a_note_not_an_error(scratch, check):
    missing = scratch / "no-such-index.json"
    out = check("--all", published=missing)
    assert out.returncode == 0, out.stdout
    assert "note: the published index is not reachable:" in out.stdout
    assert "immutability is checked against the base commit only" in out.stdout
    assert "2 extensions checked; all passed" in out.stdout


def test_broken_block_list_file_fails_the_registry_section(scratch, check):
    (scratch / "registry" / "blocklist.json").write_text("{ not json", encoding="utf-8")
    out = check("--all")
    assert out.returncode == 1
    block = section(out.stdout, "registry/")
    assert block.startswith("registry/: FAILED")
    assert "error block list format: registry/blocklist.json:" in block
    assert "ok    publishers" in block
    assert section(out.stdout, f"extensions/{FOCUS}").startswith(f"extensions/{FOCUS}: passed")


def test_publishers_file_without_the_registry_publisher_fails(scratch, check):
    doc = {"publishers": [{"id": "someone", "name": "Someone", "public_key": "AAAA"}]}
    (scratch / "registry" / "publishers.json").write_text(json.dumps(doc), encoding="utf-8")
    out = check("--changed")
    assert out.returncode == 1
    block = section(out.stdout, "registry/")
    assert "error publishers: registry/publishers.json must list nodemode" in block
    assert "error publishers: publisher someone: public_key must be base64 of 32 bytes" in block
    assert "ok    block list format" in block


def test_publisher_without_a_key_is_noted_and_passes(scratch, check):
    doc = {"publishers": [{"id": "nodemode", "name": "nodemode", "public_key": ""}]}
    (scratch / "registry" / "publishers.json").write_text(json.dumps(doc), encoding="utf-8")
    out = check("--changed")
    assert out.returncode == 0
    block = section(out.stdout, "registry/")
    assert block.startswith("registry/: passed")
    assert "note  publisher nodemode has no public key yet" in block


def test_blocked_extension_fails_the_block_list_check(scratch, check):
    entry = {"id": FOCUS, "versions": ["*"], "reason": "test reason", "date": "2026-11-01"}
    doc = {"format": "formext-blocklist", "format_version": 1, "blocked": [entry]}
    (scratch / "registry" / "blocklist.json").write_text(json.dumps(doc), encoding="utf-8")
    out = check("--all")
    assert out.returncode == 1
    assert section(out.stdout, "registry/").startswith("registry/: passed")
    assert f"error 7 block list: {FOCUS} {FOCUS_VERSION} is blocked: test reason" in section(out.stdout, f"extensions/{FOCUS}")
    assert section(out.stdout, f"extensions/{GRID}").startswith(f"extensions/{GRID}: passed")


def test_unknown_id_fails_with_missing_manifest(check):
    out = check("extensions/no-such-extension")
    assert out.returncode == 1
    block = section(out.stdout, "extensions/no-such-extension")
    assert block.startswith("extensions/no-such-extension: FAILED")
    assert "error 1 contract: package/manifest.json is missing" in block
    assert out.stdout.rstrip().splitlines()[-1] == "1 extension checked; 1 with errors"


def test_folder_outside_extensions_is_refused(check):
    out = check("tools")
    assert out.returncode == 1
    assert "is not a folder under extensions/" in out.stderr
    assert "checked" not in out.stdout


def test_all_and_changed_together_are_refused(check):
    out = check("--all", "--changed")
    assert out.returncode == 2
    assert "not allowed with argument" in out.stderr


def test_changed_without_the_base_branch_stops_with_a_hint(scratch, check):
    git(scratch, "update-ref", "-d", "refs/remotes/origin/main")
    out = check("--changed")
    assert out.returncode == 1
    assert "--changed needs origin/main; fetch it first (git fetch origin main)" in out.stderr
    assert "checked" not in out.stdout


def test_all_without_the_base_branch_notes_it_and_passes(scratch, check):
    git(scratch, "update-ref", "-d", "refs/remotes/origin/main")
    out = check("--all")
    assert out.returncode == 0, out.stdout
    assert "note: origin/main is not available here, so nothing is compared with a base commit" in out.stdout
    assert "2 extensions checked; all passed" in out.stdout


def test_other_base_branch_is_named_in_the_report(scratch, check):
    git(scratch, "branch", "release")
    touch_focus_package(scratch)
    commit_all(scratch, "change shipped file")
    git(scratch, "update-ref", "refs/remotes/origin/main", "HEAD")
    assert check("--changed").stdout.rstrip().endswith("0 extensions checked; all passed")
    out = check("--changed", "--base", "release")
    assert out.returncode == 1
    assert "1 changed files against release; extensions changed: focus-timer" in out.stdout
    assert f"from release under the same version {FOCUS_VERSION}" in out.stdout


def test_tooling_change_checks_every_extension(scratch, check):
    extra = scratch / "tools" / "notes.txt"
    extra.write_text("a tooling change\n", encoding="utf-8")
    commit_all(scratch, "tooling")
    out = check("--changed")
    assert out.returncode == 0, out.stdout
    assert "note: 1 changed files against origin/main; extensions changed: none" in out.stdout
    assert "note: tools/ or contract/ changed, so every extension is checked against the new rules" in out.stdout
    assert "2 extensions checked; all passed" in out.stdout


def test_removed_extension_is_noted_and_not_checked(scratch, check):
    shutil.rmtree(scratch / "extensions" / GRID)
    commit_all(scratch, "remove")
    out = check("--changed")
    assert out.returncode == 0, out.stdout
    assert f"note: extensions/{GRID} was removed; a removed extension stays downloadable by its tag" in out.stdout
    assert f"extensions/{GRID}:" not in out.stdout
    assert out.stdout.rstrip().splitlines()[-1] == "0 extensions checked; all passed"


def test_new_extension_may_start_at_any_version(scratch, check):
    git(scratch, "rm", "-r", "-q", "--cached", f"extensions/{FOCUS}")
    git(scratch, "commit", "-q", "-m", "base without focus timer")
    git(scratch, "update-ref", "refs/remotes/origin/main", "HEAD")
    commit_all(scratch, "add focus timer")
    out = check("--changed")
    assert out.returncode == 0, out.stdout
    block = section(out.stdout, f"extensions/{FOCUS}")
    assert block.startswith(f"extensions/{FOCUS}: passed")
    assert f"note  {FOCUS} is new against origin/main; any x.y.z may start it" in block
    assert GRID not in out.stdout


def test_changed_ids_lists_ids_files_and_tooling(scratch, load_module, monkeypatch):
    mod = load_module("tools/check.py")
    monkeypatch.setattr(mod.registry, "ROOT", scratch)
    assert mod.changed_ids("origin/main") == ([], [], False)
    touch_focus_package(scratch)
    (scratch / "extensions" / "loose.txt").write_text("x\n", encoding="utf-8")
    (scratch / "contract" / "extra.txt").write_text("x\n", encoding="utf-8")
    commit_all(scratch, "three changes")
    ids, names, tooling = mod.changed_ids("origin/main")
    assert ids == [FOCUS]
    assert sorted(names) == ["contract/extra.txt", "extensions/focus-timer/package/ui/focus.css", "extensions/loose.txt"]
    assert tooling is True
    with pytest.raises(SystemExit) as stop:
        mod.changed_ids("no-such-branch")
    assert "git diff --name-only no-such-branch...HEAD failed" in str(stop.value)


def test_check_reproducible_returns_the_documented_digest(scratch, load_module):
    mod = load_module("tools/check.py")
    result = mod.Result("x")
    digest = mod.check_reproducible(scratch / "extensions" / FOCUS, True, result)
    assert digest == FOCUS_SHA
    assert result.errors == []
    assert result.passed == ["3 reproducible"]
    assert result.notes == [f"{FOCUS}: the npm rebuild was skipped (--skip-npm)"]


def test_check_extension_stops_after_a_missing_manifest(scratch, load_module):
    mod = load_module("tools/check.py")
    folder = scratch / "extensions" / FOCUS
    (folder / "package" / "manifest.json").unlink()
    result = mod.check_extension(folder, argparse.Namespace(skip_npm=True), None, None, False, [])
    assert result.name == f"extensions/{FOCUS}"
    assert result.errors == ["1 contract: package/manifest.json is missing"]
    assert result.passed == []
    assert result.notes == []
