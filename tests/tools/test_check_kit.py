import hashlib
import os
import shutil
from pathlib import Path

import pytest

HINT = "the contract kit copy does not match {}: copy the whole kit from form.ext again, then run `python3 tools/check_kit.py --print` and update the list"
BAD_LINE = "not a `<sha256>  <path>` line"


def own_hashes(kit: Path) -> dict[str, str]:
    found = {}
    for folder, dirs, files in os.walk(kit):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for name in files:
            if name.endswith(".pyc"):
                continue
            full = Path(folder) / name
            found[full.relative_to(kit.parent).as_posix()] = hashlib.sha256(full.read_bytes()).hexdigest()
    return found


def list_lines(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def errors(result) -> list[str]:
    return [line for line in result.stdout.splitlines() if line.startswith("error ")]


@pytest.fixture
def copy_root(tmp_path, repo_root):
    root = tmp_path / "root"
    (root / "tools").mkdir(parents=True)
    shutil.copy2(repo_root / "tools" / "check_kit.py", root / "tools" / "check_kit.py")
    shutil.copytree(repo_root / "contract", root / "contract", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(repo_root / "contract.sha256", root / "contract.sha256")
    return root


@pytest.fixture
def check(run_tool, copy_root):
    def run(*args):
        return run_tool(copy_root / "tools" / "check_kit.py", *args, cwd=copy_root)

    return run


@pytest.fixture
def mod(load_module):
    return load_module("tools/check_kit.py")


def test_real_kit_matches_its_list(run_tool, repo_root):
    result = run_tool("tools/check_kit.py")
    count = len(own_hashes(repo_root / "contract"))
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout == f"contract kit copy: {count} files match contract.sha256\n"


def test_real_list_agrees_with_hashlib(repo_root):
    listed = {}
    for line in list_lines(repo_root / "contract.sha256"):
        digest, name = line.split("  ", 1)
        listed[name] = digest
    assert listed
    assert listed == own_hashes(repo_root / "contract")


def test_kit_files_gives_sorted_posix_paths_without_compiled_files(mod, tmp_path):
    kit = tmp_path / "kit"
    (kit / "b" / "__pycache__").mkdir(parents=True)
    (kit / "empty").mkdir()
    (kit / "a.txt").write_text("a")
    (kit / "b" / "c.py").write_text("c")
    (kit / "b" / "__pycache__" / "c.cpython-313.pyc").write_bytes(b"\0")
    (kit / "b" / "stray.pyc").write_bytes(b"\0")
    assert mod.kit_files(kit) == ["kit/a.txt", "kit/b/c.py"]


def test_sha256_of_matches_hashlib_on_raw_bytes(mod, tmp_path):
    data = bytes(range(256)) + b"\r\n\r\n"
    full = tmp_path / "data.bin"
    full.write_bytes(data)
    empty = tmp_path / "empty"
    empty.write_bytes(b"")
    assert mod.sha256_of(full) == hashlib.sha256(data).hexdigest()
    assert mod.sha256_of(empty) == hashlib.sha256(b"").hexdigest()


def test_read_list_accepts_good_lines_and_skips_blank_ones(mod, tmp_path):
    one = hashlib.sha256(b"one").hexdigest()
    two = hashlib.sha256(b"two").hexdigest()
    path = tmp_path / "list.sha256"
    path.write_text(f"{one}  kit/one\n\n   \n{two}  kit/two words.txt\n", encoding="utf-8")
    assert mod.read_list(path) == ({"kit/one": one, "kit/two words.txt": two}, [])


@pytest.mark.parametrize(
    "bad",
    [
        hashlib.sha256(b"x").hexdigest()[:-1] + "  kit/x",
        hashlib.sha256(b"x").hexdigest() + " kit/x",
        hashlib.sha256(b"x").hexdigest() + "  ",
        "g" * 64 + "  kit/x",
    ],
    ids=["short digest", "single space", "missing path", "not hex"],
)
def test_read_list_rejects_malformed_line(mod, tmp_path, bad):
    good = hashlib.sha256(b"good").hexdigest()
    path = tmp_path / "list.sha256"
    path.write_text(f"{good}  kit/good\n{bad}\n", encoding="utf-8")
    assert mod.read_list(path) == ({"kit/good": good}, [f"list.sha256:2: {BAD_LINE}"])


def test_read_list_reports_name_listed_twice_and_keeps_first(mod, tmp_path):
    first = hashlib.sha256(b"first").hexdigest()
    other = hashlib.sha256(b"other").hexdigest()
    second = hashlib.sha256(b"second").hexdigest()
    path = tmp_path / "list.sha256"
    path.write_text(f"{first}  kit/x\n{other}  kit/y\n{second}  kit/x\n", encoding="utf-8")
    assert mod.read_list(path) == ({"kit/x": first, "kit/y": other}, ["list.sha256:3: kit/x is listed twice"])


def test_read_list_reports_unreadable_list(mod, tmp_path):
    listed, errs = mod.read_list(tmp_path / "missing.sha256")
    assert listed == {}
    assert len(errs) == 1
    assert errs[0].startswith("missing.sha256: cannot read the hash list (")


def test_problems_is_empty_for_unchanged_copy(mod, copy_root):
    assert mod.problems(copy_root / "contract", copy_root / "contract.sha256") == []


def test_unchanged_copy_passes(check, copy_root):
    result = check()
    count = len(own_hashes(copy_root / "contract"))
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout == f"contract kit copy: {count} files match contract.sha256\n"


def test_changed_byte_fails(check, copy_root):
    target = copy_root / "contract" / "schema" / "dev.schema.json"
    data = bytearray(target.read_bytes())
    before = hashlib.sha256(data).hexdigest()
    data[len(data) // 2] ^= 1
    target.write_bytes(bytes(data))
    assert hashlib.sha256(data).hexdigest() != before
    result = check()
    assert result.returncode == 1
    assert errors(result) == [
        "error contract/schema/dev.schema.json: differs from contract.sha256 (the kit copy was edited, or the list was not updated with it)"
    ]
    assert result.stdout.splitlines()[-1] == HINT.format("contract.sha256")


def test_missing_file_fails(check, copy_root):
    (copy_root / "contract" / "sdk" / "formext.ts").unlink()
    result = check()
    assert result.returncode == 1
    assert errors(result) == ["error contract/sdk/formext.ts: listed in contract.sha256 but missing from the kit copy"]


def test_extra_file_fails(check, copy_root):
    (copy_root / "contract" / "examples" / "hello" / "extra.txt").write_text("extra\n")
    result = check()
    assert result.returncode == 1
    assert errors(result) == ["error contract/examples/hello/extra.txt: in the kit copy but not in contract.sha256"]


def test_malformed_list_line_fails(check, copy_root):
    hashes = copy_root / "contract.sha256"
    count = len(hashes.read_text(encoding="utf-8").splitlines())
    with hashes.open("a", encoding="utf-8") as handle:
        handle.write("nothash  contract/CONTRACT.md\n")
    result = check()
    assert result.returncode == 1
    assert errors(result) == [f"error contract.sha256:{count + 1}: {BAD_LINE}"]


def test_duplicate_list_line_fails(check, copy_root):
    hashes = copy_root / "contract.sha256"
    lines = hashes.read_text(encoding="utf-8").splitlines()
    name = lines[0].split("  ", 1)[1]
    with hashes.open("a", encoding="utf-8") as handle:
        handle.write(lines[0] + "\n")
    result = check()
    assert result.returncode == 1
    assert errors(result) == [f"error contract.sha256:{len(lines) + 1}: {name} is listed twice"]


@pytest.mark.parametrize("change", [lambda d: d[:-1], lambda d: d + "a"], ids=["63 chars", "65 chars"])
def test_wrong_length_hash_fails(check, copy_root, change):
    hashes = copy_root / "contract.sha256"
    lines = hashes.read_text(encoding="utf-8").splitlines()
    number = next(i for i, line in enumerate(lines, 1) if line.endswith("  contract/sdk/formext.ts"))
    digest = lines[number - 1].split("  ", 1)[0]
    lines[number - 1] = change(digest) + "  contract/sdk/formext.ts"
    hashes.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result = check()
    assert result.returncode == 1
    assert errors(result) == [
        f"error contract.sha256:{number}: {BAD_LINE}",
        "error contract/sdk/formext.ts: in the kit copy but not in contract.sha256",
    ]


def test_missing_hash_list_fails(check, copy_root):
    (copy_root / "contract.sha256").unlink()
    result = check()
    errs = errors(result)
    assert result.returncode == 1
    assert errs[0].startswith("error contract.sha256: cannot read the hash list (")
    assert errs[1:] == [f"error {name}: in the kit copy but not in contract.sha256" for name in sorted(own_hashes(copy_root / "contract"))]


def test_missing_kit_folder_fails(check, copy_root):
    names = [line.split("  ", 1)[1] for line in list_lines(copy_root / "contract.sha256")]
    shutil.rmtree(copy_root / "contract")
    result = check()
    assert result.returncode == 1
    assert errors(result) == [f"error {name}: listed in contract.sha256 but missing from the kit copy" for name in names]


def test_print_reproduces_the_list_without_reading_it(check, copy_root):
    hashes = copy_root / "contract.sha256"
    original = set(list_lines(hashes))
    hashes.unlink()
    result = check("--print")
    assert result.returncode == 0, result.stderr
    assert set(result.stdout.splitlines()) == original
    assert not hashes.exists()


def test_print_lines_are_accepted_after_the_kit_changes(check, copy_root):
    kit = copy_root / "contract"
    target = kit / "CONTRACT.md"
    target.write_bytes(target.read_bytes() + b"\nmore\n")
    (kit / "host" / "host-bridge.ts").unlink()
    (kit / "new").mkdir()
    (kit / "new" / "file with spaces.txt").write_bytes(b"\x00\x01")
    (kit / "tools" / "__pycache__").mkdir()
    (kit / "tools" / "__pycache__" / "formpkg.cpython-313.pyc").write_bytes(b"junk")
    assert check().returncode == 1
    printed = check("--print")
    assert printed.returncode == 0, printed.stderr
    lines = printed.stdout.splitlines()
    assert len(lines) == len(set(lines))
    assert set(lines) == {f"{digest}  {name}" for name, digest in own_hashes(kit).items()}
    (copy_root / "contract.sha256").write_text(printed.stdout, encoding="utf-8")
    result = check()
    assert result.returncode == 0, result.stdout
    assert result.stdout == f"contract kit copy: {len(lines)} files match contract.sha256\n"


def test_compiled_python_files_are_ignored(check, copy_root):
    kit = copy_root / "contract"
    (kit / "tools" / "__pycache__").mkdir()
    (kit / "tools" / "__pycache__" / "formpkg.cpython-313.pyc").write_bytes(b"junk")
    (kit / "host" / "stray.pyc").write_bytes(b"junk")
    result = check()
    assert result.returncode == 0, result.stdout


def test_list_with_crlf_and_blank_lines_passes(check, copy_root):
    hashes = copy_root / "contract.sha256"
    lines = list_lines(hashes)
    hashes.write_bytes(("\r\n\r\n".join(lines) + "\r\n").encode("utf-8"))
    result = check()
    assert result.returncode == 0, result.stdout


def test_kit_and_hashes_options_are_used(run_tool, copy_root, tmp_path):
    other = tmp_path / "elsewhere"
    other.mkdir()
    shutil.move(str(copy_root / "contract"), str(other / "contract"))
    shutil.move(str(copy_root / "contract.sha256"), str(other / "kit.list"))
    script = copy_root / "tools" / "check_kit.py"
    assert run_tool(script, cwd=copy_root).returncode == 1
    result = run_tool(script, "--kit", other / "contract", "--hashes", other / "kit.list", cwd=copy_root)
    assert result.returncode == 0, result.stdout
    assert result.stdout == f"contract kit copy: {len(own_hashes(other / 'contract'))} files match kit.list\n"
    (other / "contract" / "CONTRACT.md").write_text("changed\n")
    failed = run_tool(script, "--kit", other / "contract", "--hashes", other / "kit.list", cwd=copy_root)
    assert failed.returncode == 1
    assert errors(failed)[0].startswith("error contract/CONTRACT.md: differs from kit.list")
    assert failed.stdout.splitlines()[-1] == HINT.format("kit.list")


def test_relative_kit_and_hashes_paths_resolve_from_cwd(check):
    result = check("--kit", "contract", "--hashes", "contract.sha256")
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.xfail(strict=True, reason="defect: read_list catches only OSError, so a hash list that is not valid UTF-8 crashes with a UnicodeDecodeError traceback instead of an error line")
def test_list_that_is_not_utf8_is_reported_as_an_error(check, copy_root):
    hashes = copy_root / "contract.sha256"
    hashes.write_bytes(hashes.read_bytes() + b"\xff\xfe\n")
    result = check()
    assert result.returncode == 1
    assert "Traceback" not in result.stderr
    assert any(line.startswith("error contract.sha256") for line in errors(result))
