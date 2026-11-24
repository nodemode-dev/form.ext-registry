import json
import os
import re
import subprocess

import pytest

PNG = b"\x89PNG\r\n\x1a\n" + b"\x01" * 32
DIGEST_A = "a" * 64
DIGEST_B = "b" * 64
ABOUT = (
    "Demo shows a small panel in the dock of the host app. It counts the words in the open "
    "document and shows the total beside the title. The count updates when the document changes "
    "and it can be reset from the panel. Nothing leaves the machine and nothing is stored."
)


@pytest.fixture
def check(load_module):
    return load_module("tools/check.py")


def manifest_for(ext_id="demo", version="1.0.0", **extra):
    doc = {
        "format": "formai-package",
        "format_version": 1,
        "id": ext_id,
        "name": "Demo",
        "product": "formtray",
        "kind": "script-plugin",
        "version": version,
        "author": "someone",
        "licence": "Apache-2.0",
        "native": False,
        "permissions": [],
        "api": "1",
        "entry": {"ui": "ui/index.html"},
    }
    doc.update(extra)
    return doc


def write_manifest(folder, doc):
    (folder / "package").mkdir(parents=True, exist_ok=True)
    (folder / "package" / "manifest.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")


def make_extension(parent, ext_id="demo", version="1.0.0", html="<p>demo</p>", **extra):
    folder = parent / ext_id
    (folder / "package" / "ui").mkdir(parents=True)
    (folder / "package" / "ui" / "index.html").write_text(html, encoding="utf-8")
    doc = manifest_for(ext_id, version, **extra)
    write_manifest(folder, doc)
    return folder, doc


def readme_text(permissions="None. It asks for nothing.", shot="docs/screenshot.png"):
    return f"# Demo\n\n{ABOUT}\n\n![The panel]({shot})\n\n## Permissions\n\n{permissions}\n\n## Build\n\nRun the build.\n"


def add_metadata(folder, version="1.0.0", permissions="None. It asks for nothing."):
    (folder / "docs").mkdir(exist_ok=True)
    (folder / "docs" / "screenshot.png").write_bytes(PNG)
    (folder / "README.md").write_text(readme_text(permissions), encoding="utf-8")
    (folder / "LICENSE").write_text("Apache License 2.0\n", encoding="utf-8")
    (folder / "CHANGELOG.md").write_text(f"# Changelog\n\n## {version}\n\n- First release.\n", encoding="utf-8")


def index_of(*entries):
    return {"packages": [{"id": i, "version": v, "sha256": s} for i, v, s in entries]}


def run_git(repo, *args):
    env = dict(os.environ)
    env.update(
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@example.invalid",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@example.invalid",
        GIT_CONFIG_GLOBAL=os.devnull,
        GIT_CONFIG_SYSTEM=os.devnull,
    )
    out = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, env=env)
    assert out.returncode == 0, out.stderr
    return out


@pytest.fixture
def git_repo(check, tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    (repo / "extensions").mkdir(parents=True)
    folder, doc = make_extension(repo / "extensions", "demo", "1.0.0")
    (folder / "package" / "ui" / "pixel.png").write_bytes(PNG + bytes(range(256)))
    run_git(repo, "init", "-q", "-b", "main")
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-q", "-m", "first")
    monkeypatch.setattr(check.registry, "ROOT", repo)
    return repo, folder, doc


def test_result_starts_empty_and_does_not_share_lists(check):
    first = check.Result("one")
    second = check.Result("two")
    first.errors.append("x")
    first.notes.append("y")
    first.passed.append("z")
    assert second.name == "two"
    assert second.errors == [] and second.notes == [] and second.passed == []


def test_result_check_without_problems_records_a_pass(check):
    result = check.Result("r")
    result.check("1 contract", [])
    assert result.passed == ["1 contract"]
    assert result.errors == []


def test_result_check_with_problems_records_each_under_its_title(check):
    result = check.Result("r")
    result.check("ok rule", [])
    result.check("2 version", ["too low", "changed bytes"])
    assert result.errors == ["2 version: too low", "2 version: changed bytes"]
    assert result.passed == ["ok rule"]


def test_published_index_reads_a_local_file(check, tmp_path, monkeypatch):
    monkeypatch.delenv("FORMEXT_PUBLISHED_INDEX", raising=False)
    path = tmp_path / "extensions.json"
    doc = index_of(("demo", "1.0.0", DIGEST_A))
    path.write_text(json.dumps(doc), encoding="utf-8")
    result = check.Result("p")
    assert check.published_index(str(path), result) == doc
    assert result.notes == [] and result.errors == []


def test_published_index_falls_back_to_the_environment_variable(check, tmp_path, monkeypatch):
    path = tmp_path / "from-env.json"
    doc = index_of(("env-one", "2.0.0", DIGEST_B))
    path.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setenv("FORMEXT_PUBLISHED_INDEX", str(path))
    assert check.published_index(None, check.Result("p")) == doc


def test_published_index_prefers_the_given_source_over_the_environment(check, tmp_path, monkeypatch):
    env_path = tmp_path / "env.json"
    env_path.write_text(json.dumps(index_of(("env-one", "2.0.0", DIGEST_B))), encoding="utf-8")
    arg_path = tmp_path / "arg.json"
    doc = index_of(("arg-one", "3.0.0", DIGEST_A))
    arg_path.write_text(json.dumps(doc), encoding="utf-8")
    monkeypatch.setenv("FORMEXT_PUBLISHED_INDEX", str(env_path))
    assert check.published_index(str(arg_path), check.Result("p")) == doc


def test_published_index_missing_file_gives_none_and_a_note_not_an_error(check, tmp_path):
    result = check.Result("p")
    missing = tmp_path / "nowhere.json"
    assert check.published_index(str(missing), result) is None
    assert result.errors == []
    assert len(result.notes) == 1
    assert "not reachable" in result.notes[0]
    assert str(missing) in result.notes[0]
    assert "base commit" in result.notes[0]


def test_published_index_malformed_json_gives_none_and_a_note(check, tmp_path):
    path = tmp_path / "broken.json"
    path.write_text('{"packages": [', encoding="utf-8")
    result = check.Result("p")
    assert check.published_index(str(path), result) is None
    assert len(result.notes) == 1 and result.errors == []


def test_build_sha_is_a_sha256_and_the_same_for_the_same_bytes_elsewhere(check, tmp_path):
    one, _ = make_extension(tmp_path / "a")
    two, _ = make_extension(tmp_path / "b")
    os.utime(two / "package" / "ui" / "index.html", (1, 1))
    first, errs = check.build_sha(one / "package")
    second, errs2 = check.build_sha(two / "package")
    assert errs == [] and errs2 == []
    assert re.fullmatch(r"[0-9a-f]{64}", first)
    assert first == second
    assert check.build_sha(one / "package")[0] == first


def test_build_sha_changes_when_one_shipped_byte_changes(check, tmp_path):
    one, _ = make_extension(tmp_path / "a", html="<p>demo</p>")
    two, _ = make_extension(tmp_path / "b", html="<p>demO</p>")
    assert check.build_sha(one / "package")[0] != check.build_sha(two / "package")[0]


def test_build_sha_ignores_hidden_files_that_are_not_shipped(check, tmp_path):
    folder, _ = make_extension(tmp_path)
    before, _ = check.build_sha(folder / "package")
    (folder / "package" / ".DS_Store").write_bytes(b"junk")
    assert check.build_sha(folder / "package")[0] == before


def test_build_sha_refuses_an_invalid_package_with_the_reason(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    doc["version"] = "1.0"
    write_manifest(folder, doc)
    digest, errs = check.build_sha(folder / "package")
    assert digest is None
    assert len(errs) == 1
    assert "version must be x.y.z" in errs[0]


def test_base_build_without_a_base_gives_nothing(check):
    assert check.base_build(None, "demo") == (None, None)
    assert check.base_build("", "demo") == (None, None)


def test_base_build_rebuilds_the_committed_package(check, git_repo):
    repo, folder, doc = git_repo
    expected, _ = check.build_sha(folder / "package")
    assert check.base_build("main", "demo") == ("1.0.0", expected)


def test_base_build_reads_the_commit_not_the_working_folder(check, git_repo):
    repo, folder, doc = git_repo
    committed, _ = check.build_sha(folder / "package")
    (folder / "package" / "ui" / "index.html").write_text("<p>edited</p>", encoding="utf-8")
    doc["version"] = "9.9.9"
    write_manifest(folder, doc)
    assert check.base_build("main", "demo") == ("1.0.0", committed)


def test_base_build_for_an_extension_or_ref_that_is_absent_gives_nothing(check, git_repo):
    assert check.base_build("main", "not-there") == (None, None)
    assert check.base_build("no-such-branch", "demo") == (None, None)


def test_base_build_with_an_unreadable_base_manifest_gives_nothing(check, git_repo):
    repo, folder, doc = git_repo
    (folder / "package" / "manifest.json").write_text("{not json", encoding="utf-8")
    run_git(repo, "add", "-A")
    run_git(repo, "commit", "-q", "-m", "broken")
    assert check.base_build("main", "demo") == (None, None)


def test_contract_accepts_a_valid_extension_and_returns_its_manifest(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    result = check.Result("r")
    assert check.check_contract(folder, result) == doc
    assert result.errors == []
    assert len(result.passed) == 1 and result.passed[0].startswith("1 contract")


def test_contract_accepts_the_shipped_focus_timer(check, repo_root):
    result = check.Result("r")
    manifest = check.check_contract(repo_root / "extensions" / "focus-timer", result)
    assert manifest["id"] == "focus-timer"
    assert result.errors == []


def test_contract_missing_manifest_fails_and_returns_nothing(check, tmp_path):
    folder = tmp_path / "demo"
    (folder / "package").mkdir(parents=True)
    result = check.Result("r")
    assert check.check_contract(folder, result) == {}
    assert result.passed == []
    assert len(result.errors) == 1 and "manifest.json is missing" in result.errors[0]


def test_contract_malformed_manifest_json_fails(check, tmp_path):
    folder, _ = make_extension(tmp_path)
    (folder / "package" / "manifest.json").write_text('{"id": "demo",', encoding="utf-8")
    result = check.Result("r")
    assert check.check_contract(folder, result) == {}
    assert result.errors and result.passed == []


def test_contract_refuses_a_folder_name_that_is_not_the_manifest_id(check, tmp_path):
    folder, _ = make_extension(tmp_path, "demo")
    renamed = tmp_path / "other-name"
    folder.rename(renamed)
    result = check.Result("r")
    check.check_contract(renamed, result)
    assert result.passed == []
    assert any("other-name" in e and "demo" in e for e in result.errors)


@pytest.mark.parametrize(
    "change, word",
    [
        ({"product": "photoshop"}, "product"),
        ({"api": "2"}, "api"),
        ({"api": 1}, "api"),
        ({"native": True}, "native"),
        ({"native": "false"}, "native"),
        ({"version": "1.0"}, "version"),
        ({"permissions": ["camera"]}, "permissions"),
        ({"id": "Demo"}, "id"),
        ({"entry": {"ui": "ui/missing.html"}}, "entry.ui"),
    ],
)
def test_contract_refuses_a_manifest_field_that_breaks_the_rule(check, tmp_path, change, word):
    folder, doc = make_extension(tmp_path)
    doc.update(change)
    write_manifest(folder, doc)
    result = check.Result("r")
    check.check_contract(folder, result)
    assert result.passed == []
    assert any(word in e for e in result.errors)


@pytest.mark.parametrize("key", ["api", "native", "product", "version", "permissions"])
def test_contract_refuses_a_manifest_without_a_required_field(check, tmp_path, key):
    folder, doc = make_extension(tmp_path)
    del doc[key]
    write_manifest(folder, doc)
    result = check.Result("r")
    check.check_contract(folder, result)
    assert result.passed == []
    assert any(key in e for e in result.errors)


def test_contract_refuses_a_file_type_that_may_not_ship(check, tmp_path):
    folder, _ = make_extension(tmp_path)
    (folder / "package" / "ui" / "helper.exe").write_bytes(b"MZ")
    result = check.Result("r")
    check.check_contract(folder, result)
    assert result.passed == []
    assert any("helper.exe" in e for e in result.errors)


def test_contract_refuses_a_symlink_in_the_package(check, tmp_path):
    folder, _ = make_extension(tmp_path)
    (folder / "package" / "ui" / "link.html").symlink_to(folder / "package" / "ui" / "index.html")
    result = check.Result("r")
    check.check_contract(folder, result)
    assert any("link.html" in e and "symlink" in e for e in result.errors)


def run_version(check, tmp_path, version, published, changed=False, digest=DIGEST_A, base=None, ext_id="demo"):
    folder = tmp_path / ext_id
    folder.mkdir(exist_ok=True)
    result = check.Result("r")
    check.check_version(folder, manifest_for(ext_id, version), published, base, changed, digest, result)
    return result


def test_version_new_extension_may_start_at_any_version(check, tmp_path):
    for version in ("0.0.1", "7.3.12"):
        result = run_version(check, tmp_path, version, index_of(("someone-else", "9.0.0", DIGEST_B)), changed=True)
        assert result.errors == []
        assert result.passed == ["2 version and immutability"]


def test_version_passes_when_the_index_is_unreachable_and_there_is_no_base(check, tmp_path):
    result = run_version(check, tmp_path, "1.0.0", None, changed=True)
    assert result.errors == []


@pytest.mark.parametrize("version", ["1.0", "1.0.0.0", "v1.0.0", "1.0.0-beta", "", "1.a.0"])
def test_version_refuses_anything_that_is_not_x_y_z(check, tmp_path, version):
    result = run_version(check, tmp_path, version, None)
    assert result.passed == []
    assert result.errors == ["2 version: version must be x.y.z"]


def test_version_above_the_published_one_passes_with_changed_bytes(check, tmp_path):
    result = run_version(check, tmp_path, "1.0.1", index_of(("demo", "1.0.0", DIGEST_B)), changed=True)
    assert result.errors == []


def test_version_below_the_published_one_is_refused(check, tmp_path):
    result = run_version(check, tmp_path, "0.9.9", index_of(("demo", "1.0.0", DIGEST_A)))
    assert len(result.errors) == 1
    assert "0.9.9" in result.errors[0] and "1.0.0" in result.errors[0]


def test_version_is_compared_by_number_not_by_text(check, tmp_path):
    lower = run_version(check, tmp_path, "1.9.0", index_of(("demo", "1.10.0", DIGEST_B)), changed=True)
    assert len(lower.errors) == 1 and "below" in lower.errors[0]
    higher = run_version(check, tmp_path, "1.10.0", index_of(("demo", "1.9.0", DIGEST_B)), changed=True)
    assert higher.errors == []


def test_version_is_compared_with_the_newest_of_several_published(check, tmp_path):
    published = index_of(("demo", "1.2.0", DIGEST_B), ("demo", "1.10.0", DIGEST_B), ("demo", "1.9.0", DIGEST_B))
    result = run_version(check, tmp_path, "1.9.5", published, changed=True)
    assert len(result.errors) == 1 and "1.10.0" in result.errors[0]
    assert run_version(check, tmp_path, "1.10.1", published, changed=True).errors == []


def test_version_republished_with_the_same_bytes_and_no_change_passes(check, tmp_path):
    result = run_version(check, tmp_path, "1.0.0", index_of(("demo", "1.0.0", DIGEST_A)), changed=False, digest=DIGEST_A)
    assert result.errors == []
    assert result.passed == ["2 version and immutability"]


@pytest.mark.parametrize("changed", [False, True])
def test_version_republished_with_changed_bytes_is_refused(check, tmp_path, changed):
    result = run_version(check, tmp_path, "1.0.0", index_of(("demo", "1.0.0", DIGEST_B)), changed=changed, digest=DIGEST_A)
    assert result.passed == []
    assert len(result.errors) == 1
    assert DIGEST_A in result.errors[0] and DIGEST_B in result.errors[0]
    assert "raise the version" in result.errors[0]


def test_version_changed_folder_must_rise_even_when_the_package_bytes_match(check, tmp_path):
    result = run_version(check, tmp_path, "1.0.0", index_of(("demo", "1.0.0", DIGEST_A)), changed=True, digest=DIGEST_A)
    assert len(result.errors) == 1
    assert "must rise" in result.errors[0] and "1.0.0" in result.errors[0]


def test_version_ignores_other_ids_and_unusable_published_versions(check, tmp_path):
    published = index_of(("other", "5.0.0", DIGEST_B), ("demo", "latest", DIGEST_B), ("demo", "3.0", DIGEST_B))
    assert run_version(check, tmp_path, "1.0.0", published, changed=True).errors == []


def test_version_handles_an_index_without_packages(check, tmp_path):
    assert run_version(check, tmp_path, "1.0.0", {}, changed=True).errors == []
    assert run_version(check, tmp_path, "1.0.0", {"packages": None}, changed=True).errors == []


def test_version_same_as_base_with_different_bytes_is_refused(check, git_repo):
    repo, folder, doc = git_repo
    (folder / "package" / "ui" / "index.html").write_text("<p>edited</p>", encoding="utf-8")
    digest, _ = check.build_sha(folder / "package")
    result = check.Result("r")
    check.check_version(folder, doc, None, "main", True, digest, result)
    assert result.passed == []
    assert len(result.errors) == 1
    assert "main" in result.errors[0] and "raise the version" in result.errors[0]


def test_version_unchanged_against_base_passes(check, git_repo):
    repo, folder, doc = git_repo
    digest, _ = check.build_sha(folder / "package")
    result = check.Result("r")
    check.check_version(folder, doc, None, "main", False, digest, result)
    assert result.errors == []
    assert result.notes == []


def test_version_raised_above_base_with_new_bytes_passes(check, git_repo):
    repo, folder, doc = git_repo
    (folder / "package" / "ui" / "index.html").write_text("<p>edited</p>", encoding="utf-8")
    doc["version"] = "1.0.1"
    write_manifest(folder, doc)
    digest, _ = check.build_sha(folder / "package")
    result = check.Result("r")
    check.check_version(folder, doc, None, "main", True, digest, result)
    assert result.errors == []


def test_version_lowered_below_base_is_refused(check, git_repo):
    repo, folder, doc = git_repo
    doc["version"] = "0.9.0"
    write_manifest(folder, doc)
    digest, _ = check.build_sha(folder / "package")
    result = check.Result("r")
    check.check_version(folder, doc, None, "main", True, digest, result)
    assert len(result.errors) == 1
    assert "0.9.0" in result.errors[0] and "1.0.0" in result.errors[0]


def test_version_changed_folder_with_the_base_version_must_rise_when_nothing_is_published(check, git_repo):
    repo, folder, doc = git_repo
    digest, _ = check.build_sha(folder / "package")
    result = check.Result("r")
    check.check_version(folder, doc, None, "main", True, digest, result)
    assert len(result.errors) == 1 and "must rise" in result.errors[0]


def test_version_extension_new_against_base_passes_with_a_note(check, git_repo):
    repo, folder, doc = git_repo
    fresh, fresh_doc = make_extension(repo / "extensions", "brand-new", "0.0.1")
    digest, _ = check.build_sha(fresh / "package")
    result = check.Result("r")
    check.check_version(fresh, fresh_doc, None, "main", True, digest, result)
    assert result.errors == []
    assert len(result.notes) == 1 and "brand-new" in result.notes[0] and "new" in result.notes[0]


def test_version_reports_both_the_published_and_the_base_conflict(check, git_repo):
    repo, folder, doc = git_repo
    (folder / "package" / "ui" / "index.html").write_text("<p>edited</p>", encoding="utf-8")
    digest, _ = check.build_sha(folder / "package")
    result = check.Result("r")
    check.check_version(folder, doc, index_of(("demo", "1.0.0", DIGEST_B)), "main", True, digest, result)
    assert len(result.errors) == 2


def run_metadata(check, folder, doc):
    result = check.Result("r")
    check.check_metadata(folder, doc, result)
    return result


def test_metadata_complete_folder_passes(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    result = run_metadata(check, folder, doc)
    assert result.errors == []
    assert len(result.passed) == 1 and result.passed[0].startswith("6 metadata")


def test_metadata_of_the_shipped_focus_timer_passes(check, repo_root):
    folder = repo_root / "extensions" / "focus-timer"
    doc = json.loads((folder / "package" / "manifest.json").read_text(encoding="utf-8"))
    assert run_metadata(check, folder, doc).errors == []


def test_metadata_empty_folder_reports_readme_licence_and_changelog(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    result = run_metadata(check, folder, doc)
    assert result.passed == []
    assert len(result.errors) == 3
    joined = " ".join(result.errors)
    assert "README.md is missing" in joined and "LICENSE is missing" in joined and "CHANGELOG.md is missing" in joined


@pytest.mark.parametrize("name", ["README.md", "LICENSE", "CHANGELOG.md"])
def test_metadata_each_missing_file_is_reported_alone(check, tmp_path, name):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    (folder / name).unlink()
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and name in result.errors[0] and "missing" in result.errors[0]


@pytest.mark.parametrize("name", ["LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md"])
def test_metadata_accepts_the_other_licence_file_names(check, tmp_path, name):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    (folder / "LICENSE").rename(folder / name)
    assert run_metadata(check, folder, doc).errors == []


def test_metadata_refuses_a_readme_that_is_only_headings(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    (folder / "README.md").write_text(
        "# Demo\n\n![x](docs/screenshot.png)\n\n## Permissions\n\nNone.\n", encoding="utf-8"
    )
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "what the extension does" in result.errors[0]


def test_metadata_refuses_a_readme_without_a_permissions_section(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    (folder / "README.md").write_text(f"# Demo\n\n{ABOUT}\n\nNone needed.\n\n![x](docs/screenshot.png)\n", encoding="utf-8")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "Permissions section" in result.errors[0]


def test_metadata_requires_each_declared_permission_to_be_named(check, tmp_path):
    folder, doc = make_extension(tmp_path, permissions=["document", "network"])
    add_metadata(folder, permissions="It uses document to count the words.")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "network" in result.errors[0]
    (folder / "README.md").write_text(
        readme_text("- document: to count the words.\n- network: to fetch the dictionary."), encoding="utf-8"
    )
    assert run_metadata(check, folder, doc).errors == []


def test_metadata_permission_named_only_outside_the_section_does_not_count(check, tmp_path):
    folder, doc = make_extension(tmp_path, permissions=["network"])
    add_metadata(folder, permissions="See above.")
    text = (folder / "README.md").read_text(encoding="utf-8")
    (folder / "README.md").write_text(text.replace("## Build\n\n", "## Build\n\nThe network is used here. "), encoding="utf-8")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "network" in result.errors[0]


def test_metadata_with_no_permissions_must_say_none(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder, permissions="It keeps its own storage.")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "none" in result.errors[0]
    (folder / "README.md").write_text(readme_text("This extension asks for no permissions."), encoding="utf-8")
    assert run_metadata(check, folder, doc).errors == []


@pytest.mark.parametrize(
    "shot",
    ["https://example.invalid/shot.png", "docs/not-there.png", "docs/notes.txt"],
)
def test_metadata_refuses_a_screenshot_that_is_not_an_image_in_the_folder(check, tmp_path, shot):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    (folder / "docs" / "notes.txt").write_text("not an image", encoding="utf-8")
    (folder / "README.md").write_text(readme_text(shot=shot), encoding="utf-8")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "screenshot" in result.errors[0]


def test_metadata_refuses_a_readme_without_any_image(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    text = (folder / "README.md").read_text(encoding="utf-8").replace("![The panel](docs/screenshot.png)", "")
    (folder / "README.md").write_text(text, encoding="utf-8")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1 and "screenshot" in result.errors[0]


def test_metadata_accepts_a_screenshot_in_an_html_img_tag(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    text = (folder / "README.md").read_text(encoding="utf-8")
    text = text.replace("![The panel](docs/screenshot.png)", '<img alt="The panel" src="docs/screenshot.png">')
    (folder / "README.md").write_text(text, encoding="utf-8")
    assert run_metadata(check, folder, doc).errors == []


@pytest.mark.xfail(strict=True, reason="defect: check_metadata accepts a screenshot path that leaves the extension folder (../shared.png), though POLICY rule 6 asks for a screenshot kept in the folder")
def test_metadata_refuses_a_screenshot_kept_outside_the_folder(check, tmp_path):
    folder, doc = make_extension(tmp_path)
    add_metadata(folder)
    (tmp_path / "shared.png").write_bytes(PNG)
    (folder / "README.md").write_text(readme_text(shot="../shared.png"), encoding="utf-8")
    result = run_metadata(check, folder, doc)
    assert any("screenshot" in e for e in result.errors)


def test_metadata_refuses_a_changelog_without_the_version(check, tmp_path):
    folder, doc = make_extension(tmp_path, version="1.1.0")
    add_metadata(folder, version="1.0.0")
    result = run_metadata(check, folder, doc)
    assert len(result.errors) == 1
    assert "CHANGELOG.md" in result.errors[0] and "1.1.0" in result.errors[0]


@pytest.mark.xfail(strict=True, reason="defect: check_metadata looks for the version as a substring of CHANGELOG.md, so an entry for 11.0.0 counts as an entry for 1.0.0")
def test_metadata_changelog_entry_for_a_longer_version_does_not_count(check, tmp_path):
    folder, doc = make_extension(tmp_path, version="1.0.0")
    add_metadata(folder, version="11.0.0")
    result = run_metadata(check, folder, doc)
    assert any("CHANGELOG.md" in e for e in result.errors)


def run_blocklist(check, ext_id, version, blocked):
    result = check.Result("r")
    check.check_blocklist(manifest_for(ext_id, version), blocked, result)
    return result


def test_blocklist_empty_list_passes(check):
    result = run_blocklist(check, "demo", "1.0.0", [])
    assert result.errors == [] and result.passed == ["7 block list"]


def test_blocklist_blocked_version_is_refused_with_the_reason(check):
    blocked = [{"id": "demo", "versions": ["1.0.0"], "reason": "sends data away", "date": "2026-11-01"}]
    result = run_blocklist(check, "demo", "1.0.0", blocked)
    assert result.passed == []
    assert len(result.errors) == 1
    assert "demo" in result.errors[0] and "1.0.0" in result.errors[0] and "sends data away" in result.errors[0]


def test_blocklist_other_versions_of_a_blocked_id_pass(check):
    blocked = [{"id": "demo", "versions": ["1.0.0", "1.0.1"], "reason": "bad", "date": "2026-11-01"}]
    assert run_blocklist(check, "demo", "1.0.2", blocked).errors == []
    assert run_blocklist(check, "demo", "1.0.1", blocked).errors != []
    assert run_blocklist(check, "demo", "11.0.0", blocked).errors == []


def test_blocklist_star_blocks_every_version(check):
    blocked = [{"id": "demo", "versions": ["*"], "reason": "malicious", "date": "2026-11-01"}]
    for version in ("0.0.1", "1.0.0", "99.0.0"):
        result = run_blocklist(check, "demo", version, blocked)
        assert len(result.errors) == 1 and "malicious" in result.errors[0]


def test_blocklist_entry_for_another_id_does_not_block(check):
    blocked = [
        {"id": "demo-two", "versions": ["*"], "reason": "bad", "date": "2026-11-01"},
        {"id": "dem", "versions": ["1.0.0"], "reason": "bad", "date": "2026-11-01"},
    ]
    assert run_blocklist(check, "demo", "1.0.0", blocked).errors == []


def test_blocklist_entry_without_a_reason_still_blocks(check):
    result = run_blocklist(check, "demo", "1.0.0", [{"id": "demo", "versions": ["1.0.0"]}])
    assert len(result.errors) == 1 and "blocked" in result.errors[0]


def test_blocklist_finds_the_entry_among_several(check):
    blocked = [
        {"id": "other", "versions": ["*"], "reason": "first", "date": "2026-11-01"},
        {"id": "demo", "versions": ["2.0.0"], "reason": "second", "date": "2026-11-01"},
        {"id": "demo", "versions": ["1.0.0"], "reason": "third", "date": "2026-11-01"},
    ]
    result = run_blocklist(check, "demo", "1.0.0", blocked)
    assert len(result.errors) == 1 and "third" in result.errors[0]
