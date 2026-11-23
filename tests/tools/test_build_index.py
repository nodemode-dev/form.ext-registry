import base64
import hashlib
import json
import shutil
import subprocess
import zipfile

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

EXTENSIONS = ("focus-timer", "grid-overlay")


class Keys:
    def __init__(self):
        self.key = Ed25519PrivateKey.generate()
        seed = self.key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        raw = self.key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.private = base64.b64encode(seed).decode("ascii")
        self.public = base64.b64encode(raw).decode("ascii")

    def verifies(self, body: bytes, signature: str) -> bool:
        try:
            Ed25519PublicKey.from_public_bytes(base64.b64decode(self.public)).verify(base64.b64decode(signature), body)
            return True
        except InvalidSignature:
            return False


def git(root, *args):
    done = subprocess.run(
        ["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", *args],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


class Sandbox:
    def __init__(self, root, run_tool, registry_keys, publisher_keys):
        self.root = root
        self.run_tool = run_tool
        self.registry_keys = registry_keys
        self.publisher_keys = publisher_keys
        self.dist = root / "dist"

    def env(self, **over):
        env = {
            "REGISTRY_SIGNING_KEY": self.registry_keys.private,
            "PUBLISHER_SIGNING_KEY": self.publisher_keys.private,
            "GITHUB_SHA": "",
            "GIT_CEILING_DIRECTORIES": str(self.root.parent),
        }
        env.update(over)
        return env

    def build(self, *args, **over):
        return self.run_tool(self.root / "tools" / "build_index.py", *args, cwd=self.root, env=self.env(**over))

    def index(self):
        return json.loads((self.dist / "extensions.json").read_text(encoding="utf-8"))

    def set_blocked(self, blocked):
        doc = {"format": "formext-blocklist", "format_version": 1, "blocked": blocked}
        (self.root / "registry" / "blocklist.json").write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")

    def set_publisher_key(self, value):
        path = self.root / "registry" / "publishers.json"
        doc = json.loads(path.read_text(encoding="utf-8"))
        for p in doc["publishers"]:
            if p["id"] == "nodemode":
                if value is None:
                    p.pop("public_key", None)
                else:
                    p["public_key"] = value
        path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")

    def manifest(self, ext_id):
        return json.loads((self.root / "extensions" / ext_id / "package" / "manifest.json").read_text(encoding="utf-8"))

    def signature_files(self):
        if not self.dist.exists():
            return []
        return sorted(p.name for p in self.dist.rglob("*.sig"))


@pytest.fixture
def sandbox(tmp_path, repo_root, run_tool):
    root = tmp_path / "repo"
    root.mkdir()
    for name in ("tools", "contract", "registry"):
        shutil.copytree(repo_root / name, root / name, ignore=shutil.ignore_patterns("__pycache__"))
    for ext_id in EXTENSIONS:
        shutil.copytree(repo_root / "extensions" / ext_id / "package", root / "extensions" / ext_id / "package")
    box = Sandbox(root, run_tool, Keys(), Keys())
    box.set_publisher_key(box.publisher_keys.public)
    git(root, "init", "-q")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "sandbox")
    return box


def blocked_entry(ext_id, versions):
    return {"id": ext_id, "versions": versions, "reason": "test block", "date": "2026-01-01"}


def test_keyed_build_succeeds_and_writes_the_four_index_files(sandbox):
    done = sandbox.build("--require-keys")
    assert done.returncode == 0, done.stderr
    names = sorted(p.name for p in sandbox.dist.iterdir())
    assert names == ["blocklist.json", "blocklist.json.sig", "extensions.json", "extensions.json.sig", "packages"]
    assert "index signed" in done.stdout
    assert "packages signed by the publisher key" in done.stdout


def test_index_lists_each_extension_once_sorted_by_id(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    index = sandbox.index()
    assert index["format"] == "formai-extensions"
    assert index["format_version"] == 1
    ids = [e["id"] for e in index["packages"]]
    assert ids == sorted(EXTENSIONS)
    assert len(set(ids)) == len(ids)


def test_entries_carry_the_manifest_version_and_recomputed_size_and_digest(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    for entry in sandbox.index()["packages"]:
        manifest = sandbox.manifest(entry["id"])
        package = sandbox.dist / "packages" / f"{entry['id']}-{manifest['version']}.formpkg"
        body = package.read_bytes()
        assert entry["version"] == manifest["version"]
        assert entry["name"] == manifest["name"]
        assert entry["bytes"] == len(body)
        assert entry["sha256"] == hashlib.sha256(body).hexdigest()
        assert entry["verified"] is True
        assert entry["url"].endswith(f"/releases/download/ext-{entry['id']}-v{entry['version']}/{package.name}")
        assert entry["source"].endswith(f"/tree/main/extensions/{entry['id']}")
    listed = sorted(f"{e['id']}-{e['version']}.formpkg" for e in sandbox.index()["packages"])
    assert sorted(p.name for p in (sandbox.dist / "packages").iterdir()) == listed


def test_built_package_holds_the_same_files_as_the_source_folder(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    source = sandbox.root / "extensions" / "focus-timer" / "package"
    version = sandbox.manifest("focus-timer")["version"]
    with zipfile.ZipFile(sandbox.dist / "packages" / f"focus-timer-{version}.formpkg") as z:
        assert z.testzip() is None
        names = z.namelist()
        assert "manifest.json" in names
        assert len(names) == len(set(names))
        for name in names:
            assert z.read(name) == (source / name).read_bytes()


def test_index_signature_verifies_with_the_registry_public_key(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    body = (sandbox.dist / "extensions.json").read_bytes()
    signature = (sandbox.dist / "extensions.json.sig").read_text(encoding="ascii")
    assert len(base64.b64decode(signature, validate=True)) == 64
    assert sandbox.registry_keys.verifies(body, signature)
    assert not sandbox.publisher_keys.verifies(body, signature)


def test_index_signature_fails_after_one_changed_byte(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    body = bytearray((sandbox.dist / "extensions.json").read_bytes())
    signature = (sandbox.dist / "extensions.json.sig").read_text(encoding="ascii")
    for position in (0, len(body) // 2, len(body) - 1):
        changed = bytearray(body)
        changed[position] ^= 1
        assert not sandbox.registry_keys.verifies(bytes(changed), signature)


def test_blocklist_copy_matches_the_source_and_its_signature_verifies(sandbox):
    sandbox.set_blocked([blocked_entry("not-here", ["*"])])
    assert sandbox.build("--require-keys").returncode == 0
    body = (sandbox.dist / "blocklist.json").read_bytes()
    assert body == (sandbox.root / "registry" / "blocklist.json").read_bytes()
    signature = (sandbox.dist / "blocklist.json.sig").read_text(encoding="ascii")
    assert sandbox.registry_keys.verifies(body, signature)
    assert not sandbox.registry_keys.verifies(body + b" ", signature)


def test_each_package_signature_verifies_with_the_publisher_key_only(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    for entry in sandbox.index()["packages"]:
        body = (sandbox.dist / "packages" / f"{entry['id']}-{entry['version']}.formpkg").read_bytes()
        signature = entry["signature"]
        assert signature["publisher"] == "nodemode"
        assert signature["algorithm"] == "ed25519"
        assert sandbox.publisher_keys.verifies(body, signature["value"])
        assert not sandbox.registry_keys.verifies(body, signature["value"])
        changed = bytearray(body)
        changed[len(changed) // 2] ^= 1
        assert not sandbox.publisher_keys.verifies(bytes(changed), signature["value"])


def test_index_publishers_carry_the_publisher_public_key(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    publishers = sandbox.index()["publishers"]
    assert [p["id"] for p in publishers] == ["nodemode"]
    assert publishers[0]["public_key"] == sandbox.publisher_keys.public


def test_two_runs_give_the_same_package_and_index_bytes(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    first = {p.name: p.read_bytes() for p in sandbox.dist.rglob("*") if p.is_file()}
    for path in (sandbox.root / "extensions").rglob("*"):
        if path.is_file():
            path.touch()
    assert sandbox.build("--require-keys").returncode == 0
    second = {p.name: p.read_bytes() for p in sandbox.dist.rglob("*") if p.is_file()}
    assert sorted(first) == sorted(second)
    assert len([n for n in first if n.endswith(".formpkg")]) == len(EXTENSIONS)
    for name in first:
        assert first[name] == second[name], name


def test_entries_record_the_git_head_of_the_checkout(sandbox):
    head = git(sandbox.root, "rev-parse", "HEAD")
    assert sandbox.build("--require-keys").returncode == 0
    assert len(head) == 40
    assert {e["registry_commit"] for e in sandbox.index()["packages"]} == {head}


def test_github_sha_wins_over_the_git_head(sandbox):
    sha = "ab" * 20
    assert sandbox.build("--require-keys", GITHUB_SHA=f" {sha}\n").returncode == 0
    assert {e["registry_commit"] for e in sandbox.index()["packages"]} == {sha}


def test_build_fails_outside_a_git_checkout_without_github_sha(sandbox):
    shutil.rmtree(sandbox.root / ".git")
    done = sandbox.build("--require-keys")
    assert done.returncode != 0
    assert "cannot read the registry commit" in done.stderr
    assert sandbox.signature_files() == []
    assert not (sandbox.dist / "extensions.json").exists()


def test_extension_blocked_for_every_version_is_left_out(sandbox):
    sandbox.set_blocked([blocked_entry("grid-overlay", ["*"])])
    done = sandbox.build("--require-keys")
    assert done.returncode == 0, done.stderr
    assert [e["id"] for e in sandbox.index()["packages"]] == ["focus-timer"]
    assert [p.name for p in (sandbox.dist / "packages").iterdir() if p.name.startswith("grid-overlay")] == []
    assert "left out grid-overlay" in done.stdout


def test_extension_blocked_at_its_current_version_is_left_out(sandbox):
    version = sandbox.manifest("focus-timer")["version"]
    sandbox.set_blocked([blocked_entry("focus-timer", [version])])
    assert sandbox.build("--require-keys").returncode == 0
    assert [e["id"] for e in sandbox.index()["packages"]] == ["grid-overlay"]
    assert not (sandbox.dist / "packages" / f"focus-timer-{version}.formpkg").exists()


def test_block_on_another_version_keeps_the_extension(sandbox):
    sandbox.set_blocked([blocked_entry("focus-timer", ["999.0.0"])])
    assert sandbox.build("--require-keys").returncode == 0
    assert [e["id"] for e in sandbox.index()["packages"]] == sorted(EXTENSIONS)


def test_malformed_blocklist_stops_the_build(sandbox):
    sandbox.set_blocked([{"id": "focus-timer", "versions": ["latest"], "reason": "x", "date": "2026-01-01"}])
    done = sandbox.build("--require-keys")
    assert done.returncode != 0
    assert "blocklist.json" in done.stderr
    assert not sandbox.dist.exists()


@pytest.mark.parametrize("missing", ["REGISTRY_SIGNING_KEY", "PUBLISHER_SIGNING_KEY"])
@pytest.mark.parametrize("value", ["", "   \n"])
def test_require_keys_fails_when_a_key_is_missing_or_blank(sandbox, missing, value):
    done = sandbox.build("--require-keys", **{missing: value})
    assert done.returncode != 0
    assert "must both be set" in done.stderr
    assert not sandbox.dist.exists()


@pytest.mark.parametrize("name", ["REGISTRY_SIGNING_KEY", "PUBLISHER_SIGNING_KEY"])
@pytest.mark.parametrize(
    "value",
    [
        "not base64 at all!",
        base64.b64encode(b"k" * 16).decode("ascii"),
        base64.b64encode(b"k" * 33).decode("ascii"),
        (b"k" * 32).hex(),
    ],
)
def test_malformed_key_stops_the_build_before_anything_is_written(sandbox, name, value):
    for flags in ((), ("--require-keys",)):
        done = sandbox.build(*flags, **{name: value})
        assert done.returncode != 0
        assert name in done.stderr
        assert value not in done.stdout + done.stderr
        assert "Traceback" not in done.stderr
        assert not sandbox.dist.exists()


def test_build_without_keys_is_unsigned_and_says_so(sandbox):
    done = sandbox.build(REGISTRY_SIGNING_KEY="", PUBLISHER_SIGNING_KEY="")
    assert done.returncode == 0, done.stderr
    assert sandbox.signature_files() == []
    assert all("signature" not in e for e in sandbox.index()["packages"])
    assert "index unsigned" in done.stdout
    assert "packages unsigned" in done.stdout


def test_unsigned_rebuild_leaves_no_signature_from_an_earlier_signed_build(sandbox):
    assert sandbox.build("--require-keys").returncode == 0
    assert sandbox.signature_files() == ["blocklist.json.sig", "extensions.json.sig"]
    assert sandbox.build(REGISTRY_SIGNING_KEY="", PUBLISHER_SIGNING_KEY="").returncode == 0
    assert sandbox.signature_files() == []


def test_publisher_key_that_differs_from_publishers_json_stops_the_build_unsigned(sandbox):
    done = sandbox.build("--require-keys", PUBLISHER_SIGNING_KEY=Keys().private)
    assert done.returncode != 0
    assert "does not match" in done.stderr
    assert sandbox.signature_files() == []
    assert not (sandbox.dist / "extensions.json").exists()


def test_publisher_without_a_recorded_key_gets_the_derived_one_with_a_note(sandbox):
    sandbox.set_publisher_key(None)
    done = sandbox.build("--require-keys")
    assert done.returncode == 0, done.stderr
    assert "note:" in done.stdout
    assert sandbox.index()["publishers"][0]["public_key"] == sandbox.publisher_keys.public


def test_manifest_id_that_differs_from_its_folder_stops_the_build(sandbox):
    shutil.move(str(sandbox.root / "extensions" / "focus-timer"), str(sandbox.root / "extensions" / "focus-clock"))
    done = sandbox.build("--require-keys")
    assert done.returncode != 0
    assert "extensions/focus-clock" in done.stderr
    assert sandbox.signature_files() == []
    assert not (sandbox.dist / "extensions.json").exists()


def test_folder_without_a_manifest_stops_the_build(sandbox):
    (sandbox.root / "extensions" / "empty-one").mkdir()
    done = sandbox.build("--require-keys")
    assert done.returncode != 0
    assert "extensions/empty-one: no package/manifest.json" in done.stderr
    assert sandbox.signature_files() == []


def test_out_option_writes_there_and_clears_what_was_there(sandbox):
    out = sandbox.root / "elsewhere"
    (out / "packages").mkdir(parents=True)
    (out / "packages" / "stale-9.9.9.formpkg").write_bytes(b"stale")
    (out / "stale.sig").write_text("stale", encoding="ascii")
    done = sandbox.build("--require-keys", "-o", out)
    assert done.returncode == 0, done.stderr
    assert not sandbox.dist.exists()
    assert sorted(p.name for p in out.rglob("*.sig")) == ["blocklist.json.sig", "extensions.json.sig"]
    assert not (out / "packages" / "stale-9.9.9.formpkg").exists()
    body = (out / "extensions.json").read_bytes()
    assert body.endswith(b"}\n")
    assert sandbox.registry_keys.verifies(body, (out / "extensions.json.sig").read_text(encoding="ascii"))


def test_write_signed_writes_body_and_a_verifying_signature(load_module, tmp_path):
    module = load_module("tools/build_index.py")
    keys = Keys()
    path = tmp_path / "doc.json"
    module.write_signed(path, b'{"a": 1}\n', keys.key)
    assert path.read_bytes() == b'{"a": 1}\n'
    signature = (tmp_path / "doc.json.sig").read_text(encoding="ascii")
    assert keys.verifies(b'{"a": 1}\n', signature)
    assert not keys.verifies(b'{"a": 2}\n', signature)


def test_write_signed_without_a_key_removes_a_stale_signature(load_module, tmp_path):
    module = load_module("tools/build_index.py")
    path = tmp_path / "doc.json"
    stale = tmp_path / "doc.json.sig"
    stale.write_text("old", encoding="ascii")
    module.write_signed(path, b"new body", None)
    assert path.read_bytes() == b"new body"
    assert not stale.exists()


def test_publishers_refuses_a_key_that_differs_from_the_recorded_one(load_module):
    module = load_module("tools/build_index.py")
    with pytest.raises(SystemExit) as stop:
        module.publishers(Keys().key)
    assert "does not match" in str(stop.value)


def test_publishers_without_a_key_returns_the_recorded_public_keys(load_module, repo_root):
    module = load_module("tools/build_index.py")
    recorded = json.loads((repo_root / "registry" / "publishers.json").read_text(encoding="utf-8"))["publishers"]
    expected = [(p["id"], p["public_key"]) for p in recorded if p.get("public_key")]
    assert [(p["id"], p["public_key"]) for p in module.publishers(None)] == expected
