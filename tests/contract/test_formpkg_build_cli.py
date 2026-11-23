import hashlib
import json
import os
import shutil
import zipfile
from pathlib import Path

import pytest

TOOL = "contract/tools/formpkg.py"


@pytest.fixture
def formpkg(load_module):
    return load_module(TOOL)


@pytest.fixture
def hello(repo_root, tmp_path):
    target = tmp_path / "src" / "hello"
    shutil.copytree(repo_root / "contract" / "examples" / "hello", target)
    return target


def tree_bytes(folder: Path) -> dict:
    return {p.relative_to(folder).as_posix(): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def test_files_of_lists_every_file_of_the_example_in_path_order(formpkg, hello):
    files, errs = formpkg.files_of(hello)
    assert errs == []
    rels = [p.relative_to(hello).as_posix() for p in files]
    assert rels == ["manifest.json", "ui/hello.css", "ui/hello.js", "ui/index.html"]


def test_files_of_leaves_out_hidden_files_and_hidden_folders(formpkg, hello):
    (hello / ".secret.json").write_text("{}")
    (hello / ".git").mkdir()
    (hello / ".git" / "config.txt").write_text("x")
    (hello / "ui" / ".DS_Store").write_bytes(b"\x00")
    (hello / "Thumbs.db").write_bytes(b"\x00")
    files, errs = formpkg.files_of(hello)
    assert errs == []
    rels = [p.relative_to(hello).as_posix() for p in files]
    assert rels == ["manifest.json", "ui/hello.css", "ui/hello.js", "ui/index.html"]


def test_files_of_refuses_a_symlink_to_a_file(formpkg, hello):
    os.symlink(hello / "ui" / "hello.js", hello / "ui" / "link.js")
    files, errs = formpkg.files_of(hello)
    assert "ui/link.js" not in [p.relative_to(hello).as_posix() for p in files]
    assert len(errs) == 1
    assert "ui/link.js" in errs[0] and "symlink" in errs[0]


def test_files_of_refuses_a_symlink_to_a_folder_and_does_not_follow_it(formpkg, hello, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "stolen.txt").write_text("private")
    os.symlink(outside, hello / "linked")
    files, errs = formpkg.files_of(hello)
    rels = [p.relative_to(hello).as_posix() for p in files]
    assert not any(r.startswith("linked") for r in rels)
    assert any("linked" in e and "symlink" in e for e in errs)


def test_files_of_refuses_a_file_type_outside_the_list(formpkg, hello):
    (hello / "run.exe").write_bytes(b"MZ")
    (hello / "LICENSE").write_text("x")
    files, errs = formpkg.files_of(hello)
    rels = [p.relative_to(hello).as_posix() for p in files]
    assert "run.exe" not in rels and "LICENSE" not in rels
    assert any(e.startswith("run.exe:") and ".exe" in e for e in errs)
    assert any(e.startswith("LICENSE:") for e in errs)
    assert len(errs) == 2


def test_files_of_accepts_every_file_type_the_contract_lists(formpkg, hello):
    listed = ".html .js .mjs .css .json .svg .png .webp .jpg .jpeg .gif .wasm .txt .md .wav .ogg .mp3 .webm .mp4 .cube .woff2".split()
    for ext in listed:
        (hello / ("asset" + ext)).write_bytes(b"x")
    files, errs = formpkg.files_of(hello)
    assert errs == []
    rels = {p.relative_to(hello).as_posix() for p in files}
    assert {"asset" + ext for ext in listed} <= rels
    assert set(listed) == set(formpkg.TYPES)


def test_files_of_accepts_a_path_of_200_characters_and_refuses_201(formpkg, hello):
    folder = hello / ("a" * 100)
    folder.mkdir()
    ok = folder / ("b" * 95 + ".txt")
    long = folder / ("c" * 96 + ".txt")
    ok.write_text("x")
    long.write_text("x")
    assert len(ok.relative_to(hello).as_posix()) == 200
    assert len(long.relative_to(hello).as_posix()) == 201
    files, errs = formpkg.files_of(hello)
    assert ok in files
    assert long not in files
    assert len(errs) == 1 and "200" in errs[0]


def test_files_of_accepts_512_files_and_refuses_513(formpkg, hello):
    data = hello / "data"
    data.mkdir()
    for i in range(512 - 4):
        (data / f"f{i:04d}.txt").write_text("x")
    files, errs = formpkg.files_of(hello)
    assert len(files) == 512
    assert errs == []
    (data / "extra.txt").write_text("x")
    files, errs = formpkg.files_of(hello)
    assert len(errs) == 1 and "512" in errs[0]


def test_build_archive_holds_exactly_the_package_files_with_the_same_bytes(formpkg, hello, tmp_path):
    (hello / "ui" / "logo.png").write_bytes(bytes(range(256)) * 8)
    expected = tree_bytes(hello)
    target, _, _, _ = formpkg.build(hello, tmp_path / "out")
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        got = {n: z.read(n) for n in z.namelist()}
        assert len(z.namelist()) == len(set(z.namelist()))
    assert got == expected
    assert "manifest.json" in got


def test_build_reports_the_sha256_and_size_of_the_file(formpkg, hello, tmp_path):
    target, digest, size, manifest = formpkg.build(hello, tmp_path / "out")
    raw = target.read_bytes()
    assert digest == hashlib.sha256(raw).hexdigest()
    assert size == len(raw) == target.stat().st_size
    assert manifest == {**json.loads((hello / "manifest.json").read_text()), **manifest}
    assert manifest["id"] == "hello-formext"


def test_build_names_the_file_after_id_and_version_inside_the_output_folder(formpkg, hello, tmp_path):
    m = json.loads((hello / "manifest.json").read_text())
    m["id"] = "my-ext"
    m["version"] = "3.20.1"
    (hello / "manifest.json").write_text(json.dumps(m))
    out = tmp_path / "deep" / "er" / "out"
    target, _, _, _ = formpkg.build(hello, out)
    assert target == out / "my-ext-3.20.1.formpkg"
    assert [p.name for p in out.iterdir()] == ["my-ext-3.20.1.formpkg"]


def test_build_entries_are_sorted_dated_1980_mode_0644_and_deflated(formpkg, hello, tmp_path):
    (hello / "Zed.txt").write_text("z" * 500)
    (hello / "a.txt").write_text("a" * 500)
    (hello / "ui" / "sub").mkdir()
    (hello / "ui" / "sub" / "x.json").write_text("{}" * 100)
    target, _, _, _ = formpkg.build(hello, tmp_path / "out")
    with zipfile.ZipFile(target) as z:
        infos = z.infolist()
    names = [i.filename for i in infos]
    assert names == sorted(names)
    assert len(names) == 7
    for i in infos:
        assert i.date_time == (1980, 1, 1, 0, 0, 0)
        assert (i.external_attr >> 16) & 0o7777 == 0o644
        assert i.compress_type == zipfile.ZIP_DEFLATED
        assert not i.filename.startswith("/") and ".." not in i.filename.split("/")
        assert not i.is_dir()


def test_two_builds_with_other_times_modes_and_creation_order_are_byte_identical(formpkg, repo_root, tmp_path):
    source = repo_root / "contract" / "examples" / "hello"
    first = tmp_path / "one" / "hello"
    shutil.copytree(source, first)
    (first / "ui" / "zz.txt").write_text("zz")
    (first / "aa.txt").write_text("aa")
    content = tree_bytes(first)
    second = tmp_path / "two" / "renamed"
    second.mkdir(parents=True)
    for i, rel in enumerate(sorted(content, reverse=True)):
        p = second / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content[rel])
        os.utime(p, (1_000_000_000 + i * 86400, 1_000_000_000 + i * 86400))
        os.chmod(p, 0o755 if i % 2 else 0o600)
    a, da, sa, _ = formpkg.build(first, tmp_path / "out1")
    b, db, sb, _ = formpkg.build(second, tmp_path / "out2")
    assert a.read_bytes() == b.read_bytes()
    assert (da, sa) == (db, sb)
    assert a.name == b.name


def test_build_changes_the_sha256_when_one_byte_changes(formpkg, hello, tmp_path):
    _, before, _, _ = formpkg.build(hello, tmp_path / "out1")
    with open(hello / "ui" / "hello.js", "ab") as f:
        f.write(b" ")
    _, after, _, _ = formpkg.build(hello, tmp_path / "out2")
    assert before != after


def test_build_leaves_hidden_files_out_of_the_archive(formpkg, hello, tmp_path):
    _, clean, _, _ = formpkg.build(hello, tmp_path / "out1")
    (hello / ".env").write_text("TOKEN=1")
    (hello / ".cache").mkdir()
    (hello / ".cache" / "blob.json").write_text("{}")
    (hello / "ui" / ".DS_Store").write_bytes(b"\x01")
    target, digest, _, _ = formpkg.build(hello, tmp_path / "out2")
    with zipfile.ZipFile(target) as z:
        names = z.namelist()
    assert names == ["manifest.json", "ui/hello.css", "ui/hello.js", "ui/index.html"]
    assert digest == clean


def test_build_refuses_a_symlink_and_writes_no_package(formpkg, hello, tmp_path):
    os.symlink(hello / "ui" / "hello.css", hello / "ui" / "copy.css")
    out = tmp_path / "out"
    with pytest.raises(SystemExit) as exc:
        formpkg.build(hello, out)
    assert "refused" in str(exc.value.code) and "symlinks are not allowed" in str(exc.value.code)
    assert not out.exists() or list(out.iterdir()) == []


def test_build_refuses_a_file_type_outside_the_list_and_writes_no_package(formpkg, hello, tmp_path):
    (hello / "tool.sh").write_text("#!/bin/sh")
    out = tmp_path / "out"
    with pytest.raises(SystemExit) as exc:
        formpkg.build(hello, out)
    assert "tool.sh" in str(exc.value.code)
    assert not out.exists() or list(out.iterdir()) == []


def test_build_refuses_an_invalid_manifest_and_a_missing_one(formpkg, hello, tmp_path):
    m = json.loads((hello / "manifest.json").read_text())
    m["version"] = "1.0"
    (hello / "manifest.json").write_text(json.dumps(m))
    with pytest.raises(SystemExit) as exc:
        formpkg.build(hello, tmp_path / "out")
    assert "version" in str(exc.value.code)
    (hello / "manifest.json").unlink()
    with pytest.raises(SystemExit) as exc:
        formpkg.build(hello, tmp_path / "out")
    assert "manifest.json" in str(exc.value.code)
    assert not (tmp_path / "out").exists()


def test_build_refuses_a_package_over_the_size_limit_and_removes_it(formpkg, hello, tmp_path, monkeypatch):
    assert formpkg.MAX_BYTES == 20 * 1024 * 1024
    assert formpkg.MAX_FILES == 512
    monkeypatch.setattr(formpkg, "MAX_BYTES", 100)
    out = tmp_path / "out"
    with pytest.raises(SystemExit) as exc:
        formpkg.build(hello, out)
    assert "refused" in str(exc.value.code) and "100" in str(exc.value.code)
    assert list(out.iterdir()) == []


def test_build_accepts_a_package_exactly_at_the_size_limit(formpkg, hello, tmp_path, monkeypatch):
    _, _, size, _ = formpkg.build(hello, tmp_path / "probe")
    monkeypatch.setattr(formpkg, "MAX_BYTES", size)
    target, _, again, _ = formpkg.build(hello, tmp_path / "out")
    assert target.is_file() and again == size


def test_entry_carries_the_manifest_fields_url_sha256_and_size(formpkg, hello, tmp_path):
    target, digest, size, m = formpkg.build(hello, tmp_path / "out")
    e = formpkg.entry(m, "https://example.org/p/hello-formext-0.1.0.formpkg", digest, size)
    source = json.loads((hello / "manifest.json").read_text())
    for key in ("id", "name", "product", "kind", "author", "version", "licence", "native", "permissions", "description", "api"):
        assert e[key] == source[key], key
    assert e["url"] == "https://example.org/p/hello-formext-0.1.0.formpkg"
    assert e["sha256"] == hashlib.sha256(target.read_bytes()).hexdigest()
    assert e["bytes"] == target.stat().st_size


def test_entry_holds_only_fields_the_index_schema_allows(formpkg, hello, repo_root, tmp_path):
    schema = json.loads((repo_root / "contract" / "schema" / "extensions.schema.json").read_text())
    spec = schema["$defs"]["entry"]
    _, digest, size, m = formpkg.build(hello, tmp_path / "out")
    m.update({"minimum_app": "2.0.0", "homepage": "https://example.org/h", "support": "https://example.org/s"})
    e = formpkg.entry(m, "https://example.org/x.formpkg", digest, size)
    assert set(e) <= set(spec["properties"])
    assert set(spec["required"]) <= set(e)
    assert e["minimum_app"] == "2.0.0"
    assert e["homepage"] == "https://example.org/h"
    assert e["support"] == "https://example.org/s"
    assert "entry" not in e and "contributes" not in e and "format" not in e


def test_entry_uses_the_name_when_there_is_no_description_and_omits_absent_fields(formpkg):
    m = {
        "id": "plain",
        "name": "Plain",
        "product": "formcut",
        "kind": "preset",
        "author": "me",
        "version": "1.2.3",
        "licence": "MIT",
        "native": False,
        "permissions": [],
    }
    e = formpkg.entry(m, "https://example.org/plain.formpkg", "ab" * 32, 7)
    assert e["description"] == "Plain"
    assert e["permissions"] == [] and e["native"] is False
    for key in ("minimum_app", "api", "homepage", "support"):
        assert key not in e
    assert e["bytes"] == 7 and e["sha256"] == "ab" * 32


def test_command_validate_exits_zero_and_says_valid_for_a_good_folder(run_tool, hello):
    r = run_tool(TOOL, "validate", hello)
    assert r.returncode == 0
    assert r.stdout.strip() == "valid"
    assert tree_bytes(hello).keys() == {"manifest.json", "ui/hello.css", "ui/hello.js", "ui/index.html"}


def test_command_validate_exits_non_zero_with_a_message_for_a_bad_manifest(run_tool, hello):
    m = json.loads((hello / "manifest.json").read_text())
    m["product"] = "notaproduct"
    (hello / "manifest.json").write_text(json.dumps(m))
    r = run_tool(TOOL, "validate", hello)
    assert r.returncode != 0
    assert "refused" in r.stdout + r.stderr and "product" in r.stdout + r.stderr
    assert "valid\n" != r.stdout


def test_command_validate_exits_non_zero_for_a_refused_file_and_a_missing_folder(run_tool, hello, tmp_path):
    (hello / "bin.dll").write_bytes(b"x")
    r = run_tool(TOOL, "validate", hello)
    assert r.returncode != 0
    assert "bin.dll" in r.stdout + r.stderr
    r = run_tool(TOOL, "validate", tmp_path / "nowhere")
    assert r.returncode != 0
    assert "manifest.json" in r.stdout + r.stderr


def test_command_validate_exits_non_zero_for_a_symlink(run_tool, hello):
    os.symlink(hello / "ui" / "hello.js", hello / "ui" / "alias.js")
    r = run_tool(TOOL, "validate", hello)
    assert r.returncode != 0
    assert "symlink" in r.stdout + r.stderr


def test_command_build_exits_zero_and_prints_file_sha256_and_size(run_tool, hello, tmp_path):
    out = tmp_path / "out"
    r = run_tool(TOOL, "build", hello, "-o", out)
    assert r.returncode == 0, r.stderr
    lines = r.stdout.strip().splitlines()
    assert len(lines) == 1
    report = json.loads(lines[0])
    target = Path(report["file"])
    assert target == out / "hello-formext-0.1.0.formpkg"
    assert report["sha256"] == hashlib.sha256(target.read_bytes()).hexdigest()
    assert report["bytes"] == target.stat().st_size
    with zipfile.ZipFile(target) as z:
        assert {n: z.read(n) for n in z.namelist()} == tree_bytes(hello)


def test_command_build_writes_to_dist_in_the_working_folder_by_default(run_tool, hello, tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    r = run_tool(TOOL, "build", hello, cwd=work)
    assert r.returncode == 0, r.stderr
    assert [p.name for p in (work / "dist").iterdir()] == ["hello-formext-0.1.0.formpkg"]
    assert json.loads(r.stdout.splitlines()[0])["file"] == "dist/hello-formext-0.1.0.formpkg"


def test_command_build_with_url_prints_an_index_entry_after_the_report(run_tool, hello, tmp_path):
    url = "https://example.org/dl/hello-formext-0.1.0.formpkg"
    r = run_tool(TOOL, "build", hello, "--out", tmp_path / "out", "--url", url)
    assert r.returncode == 0, r.stderr
    first, rest = r.stdout.split("\n", 1)
    report = json.loads(first)
    e = json.loads(rest)
    source = json.loads((hello / "manifest.json").read_text())
    raw = Path(report["file"]).read_bytes()
    assert e["url"] == url
    assert e["sha256"] == report["sha256"] == hashlib.sha256(raw).hexdigest()
    assert e["bytes"] == report["bytes"] == len(raw)
    for key in ("id", "name", "product", "kind", "author", "version", "licence", "native", "permissions", "description", "api"):
        assert e[key] == source[key], key


def test_command_build_twice_prints_the_same_sha256(run_tool, hello, tmp_path):
    a = run_tool(TOOL, "build", hello, "-o", tmp_path / "o1")
    for i, p in enumerate(sorted(hello.rglob("*"))):
        os.utime(p, (1_200_000_000 + i, 1_200_000_000 + i))
    b = run_tool(TOOL, "build", hello, "-o", tmp_path / "o2")
    assert a.returncode == 0 and b.returncode == 0
    ja, jb = json.loads(a.stdout), json.loads(b.stdout)
    assert ja["sha256"] == jb["sha256"] and ja["bytes"] == jb["bytes"]
    assert Path(ja["file"]).read_bytes() == Path(jb["file"]).read_bytes()


def test_command_build_exits_non_zero_with_a_message_and_no_package_for_a_bad_folder(run_tool, hello, tmp_path):
    m = json.loads((hello / "manifest.json").read_text())
    del m["api"]
    (hello / "manifest.json").write_text(json.dumps(m))
    out = tmp_path / "out"
    r = run_tool(TOOL, "build", hello, "-o", out)
    assert r.returncode != 0
    assert "refused" in r.stdout + r.stderr and "api" in r.stdout + r.stderr
    assert not out.exists() or list(out.iterdir()) == []
    r = run_tool(TOOL, "build", tmp_path / "nowhere", "-o", out)
    assert r.returncode != 0
    assert "manifest.json" in r.stdout + r.stderr
    assert not out.exists() or list(out.iterdir()) == []


def test_command_without_a_subcommand_or_with_an_unknown_one_exits_non_zero(run_tool, tmp_path):
    r = run_tool(TOOL, cwd=tmp_path)
    assert r.returncode != 0 and "usage" in r.stderr
    r = run_tool(TOOL, "publish", tmp_path, cwd=tmp_path)
    assert r.returncode != 0 and "usage" in r.stderr
    assert list(tmp_path.iterdir()) == []


@pytest.mark.xfail(strict=True, reason="defect: build --url accepts a url that is not https:// and prints an index entry the index schema refuses")
def test_command_build_refuses_a_url_that_is_not_https(run_tool, hello, tmp_path):
    r = run_tool(TOOL, "build", hello, "-o", tmp_path / "out", "--url", "http://example.org/x.formpkg")
    assert r.returncode != 0
    assert '"url": "http://' not in r.stdout
