import base64
import json
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

ENV = "FORMEXT_TEST_THROWAWAY_SIGNING_KEY"
REPO_URL = "https://github.com/nodemode-dev/form.ext-registry"
GOOD = {
    "format": "formext-blocklist",
    "format_version": 1,
    "blocked": [
        {"id": "evil-ext", "versions": ["*"], "reason": "steals tokens", "date": "2026-01-02"},
        {"id": "shot-list", "versions": ["1.2.0"], "reason": "crashes on load", "date": "2026-03-04"},
    ],
}


@pytest.fixture
def registry(load_module):
    return load_module("tools/registry.py")


def throwaway():
    key = Ed25519PrivateKey.generate()
    seed = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return key, base64.b64encode(seed).decode("ascii"), base64.b64encode(raw).decode("ascii")


def write_blocklist(tmp_path, doc):
    path = tmp_path / "blocklist.json"
    path.write_text(doc if isinstance(doc, str) else json.dumps(doc), encoding="utf-8")
    return path


def pair_from_text(out):
    lines = out.splitlines()
    i = next(n for n, line in enumerate(lines) if line.startswith("Private key:"))
    j = next(n for n, line in enumerate(lines) if line.startswith("Public key:"))
    return lines[i + 1].strip(), lines[j + 1].strip()


def test_package_url_points_at_the_release_asset(registry):
    url = registry.package_url("focus-timer", "1.10.0")
    assert url == f"{REPO_URL}/releases/download/ext-focus-timer-v1.10.0/focus-timer-1.10.0.formpkg"


def test_source_url_points_at_the_extension_folder_on_main(registry):
    assert registry.source_url("shot-list") == f"{REPO_URL}/tree/main/extensions/shot-list"


def test_version_key_puts_1_10_0_above_1_9_0(registry):
    assert registry.version_key("1.10.0") > registry.version_key("1.9.0")
    assert registry.version_key("2.0.0") > registry.version_key("1.99.99")
    assert registry.version_key("0.0.10") > registry.version_key("0.0.9")


def test_version_key_is_equal_for_equal_versions(registry):
    assert registry.version_key("1.2.3") == registry.version_key("1.2.3")
    assert registry.version_key("1.2.3") == (1, 2, 3)
    assert not registry.version_key("1.2.3") < registry.version_key("1.2.3")


def test_version_key_sorts_versions_numerically(registry):
    versions = ["1.9.0", "0.10.0", "1.10.0", "1.9.10", "0.9.0", "1.9.2"]
    assert sorted(versions, key=registry.version_key) == ["0.9.0", "0.10.0", "1.9.0", "1.9.2", "1.9.10", "1.10.0"]
    assert max(versions, key=registry.version_key) == "1.10.0"


def test_version_key_raises_on_malformed_versions(registry):
    for bad in ("1.x.0", "", "1..0", "v1.2.3", "1.2.3-beta", "1.2.3+build"):
        with pytest.raises(ValueError):
            registry.version_key(bad)


def test_load_blocklist_accepts_a_good_file(registry, tmp_path):
    blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, GOOD))
    assert errs == []
    assert [b["id"] for b in blocked] == ["evil-ext", "shot-list"]
    assert blocked[1]["versions"] == ["1.2.0"]


def test_load_blocklist_reads_the_committed_file_cleanly(registry, repo_root):
    assert registry.BLOCKLIST == repo_root / "registry" / "blocklist.json"
    blocked, errs = registry.load_blocklist()
    assert errs == []
    assert isinstance(blocked, list)


def test_load_blocklist_reports_a_missing_file(registry, tmp_path):
    blocked, errs = registry.load_blocklist(tmp_path / "absent.json")
    assert blocked == []
    assert len(errs) == 1
    assert errs[0].startswith("registry/blocklist.json: ")


def test_load_blocklist_reports_invalid_json(registry, tmp_path):
    blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, '{"format": "formext-blocklist",'))
    assert blocked == []
    assert len(errs) == 1
    assert errs[0].startswith("registry/blocklist.json: ")


def test_load_blocklist_reports_a_wrong_format_or_version(registry, tmp_path):
    for fmt, version in (("formext-index", 1), ("formext-blocklist", 2), ("formext-blocklist", "1"), (None, None)):
        blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, dict(GOOD, format=fmt, format_version=version)))
        assert errs == ['registry/blocklist.json: format must be "formext-blocklist" with format_version 1'], (fmt, version)
        assert len(blocked) == 2


def test_load_blocklist_reports_blocked_that_is_not_a_list(registry, tmp_path):
    for doc in (dict(GOOD, blocked={"id": "evil-ext"}), {"format": "formext-blocklist", "format_version": 1}):
        blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, doc))
        assert blocked == []
        assert errs == ["registry/blocklist.json: blocked must be a list"]


def test_load_blocklist_reports_and_drops_entries_that_are_not_objects(registry, tmp_path):
    doc = dict(GOOD, blocked=["evil-ext", GOOD["blocked"][1], 7])
    blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, doc))
    assert [b["id"] for b in blocked] == ["shot-list"]
    assert errs == [
        "registry/blocklist.json: blocked[0] must be an object",
        "registry/blocklist.json: blocked[2] must be an object",
    ]


def test_load_blocklist_names_each_missing_key(registry, tmp_path):
    blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, dict(GOOD, blocked=[{"versions": ["*"]}])))
    assert blocked == [{"versions": ["*"]}]
    assert errs == [f"registry/blocklist.json: blocked[0] needs {key}" for key in ("id", "reason", "date")]


def test_load_blocklist_refuses_bad_versions(registry, tmp_path):
    for versions in ([], "1.0.0", ["1.0"], ["1.0.0", "latest"], [None], None):
        entry = dict(GOOD["blocked"][1], versions=versions)
        _, errs = registry.load_blocklist(write_blocklist(tmp_path, dict(GOOD, blocked=[entry])))
        assert errs == ['registry/blocklist.json: blocked[0]: versions must be a list of x.y.z or ["*"]'], versions


@pytest.mark.xfail(
    strict=True,
    raises=AttributeError,
    reason="defect: load_blocklist raises AttributeError on a file whose JSON is not an object instead of returning an error",
)
def test_load_blocklist_reports_a_document_that_is_not_an_object(registry, tmp_path):
    blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, "[]"))
    assert blocked == []
    assert errs and errs[0].startswith("registry/blocklist.json")


def test_blocked_reason_for_a_blocked_id_covers_every_version(registry):
    assert registry.blocked_reason(GOOD["blocked"], "evil-ext", "0.0.1") == "steals tokens"
    assert registry.blocked_reason(GOOD["blocked"], "evil-ext", "9.9.9") == "steals tokens"
    assert registry.blocked_reason(GOOD["blocked"], "focus-timer", "0.0.1") is None
    assert registry.blocked_reason([], "evil-ext", "0.0.1") is None


def test_blocked_reason_for_a_single_blocked_version_only(registry):
    assert registry.blocked_reason(GOOD["blocked"], "shot-list", "1.2.0") == "crashes on load"
    assert registry.blocked_reason(GOOD["blocked"], "shot-list", "1.2.1") is None
    assert registry.blocked_reason(GOOD["blocked"], "shot-list", "1.20.0") is None


def test_blocked_reason_says_blocked_when_no_reason_is_given(registry):
    blocked = [{"id": "x", "versions": ["*"], "reason": ""}, {"id": "y", "versions": ["1.0.0"]}]
    assert registry.blocked_reason(blocked, "x", "1.0.0") == "blocked"
    assert registry.blocked_reason(blocked, "y", "1.0.0") == "blocked"
    assert registry.blocked_reason([{"id": "z", "versions": None, "reason": "r"}], "z", "1.0.0") is None


def test_blocked_reason_works_on_entries_loaded_from_a_file(registry, tmp_path):
    blocked, errs = registry.load_blocklist(write_blocklist(tmp_path, GOOD))
    assert errs == []
    assert registry.blocked_reason(blocked, "shot-list", "1.2.0") == "crashes on load"
    assert registry.blocked_reason(blocked, "evil-ext", "3.0.0") == "steals tokens"
    assert registry.blocked_reason(blocked, "mail-merge", "1.2.0") is None


def test_load_publishers_reads_the_committed_nodemode_publisher(registry, repo_root):
    assert registry.PUBLISHERS == repo_root / "registry" / "publishers.json"
    mine = [p for p in registry.load_publishers() if p.get("id") == registry.PUBLISHER_ID]
    assert len(mine) == 1
    assert len(base64.b64decode(mine[0]["public_key"], validate=True)) == 32


def test_load_publishers_gives_an_empty_list_when_none_are_listed(registry, tmp_path):
    path = tmp_path / "publishers.json"
    for text in ("{}", '{"publishers": null}', '{"publishers": []}'):
        path.write_text(text, encoding="utf-8")
        assert registry.load_publishers(path) == []
    path.write_text('{"publishers": [{"id": "a"}, {"id": "b"}]}', encoding="utf-8")
    assert registry.load_publishers(path) == [{"id": "a"}, {"id": "b"}]


def test_signing_key_is_none_when_the_variable_is_missing_or_blank(registry, monkeypatch):
    monkeypatch.delenv(ENV, raising=False)
    assert registry.signing_key(ENV) is None
    monkeypatch.setenv(ENV, "  \n\t")
    assert registry.signing_key(ENV) is None


def test_signing_key_refuses_text_that_is_not_base64_without_echoing_it(registry, monkeypatch):
    value = "this is not base64!"
    monkeypatch.setenv(ENV, value)
    with pytest.raises(SystemExit) as caught:
        registry.signing_key(ENV)
    assert str(caught.value) == f"{ENV} is not valid base64"
    assert value not in str(caught.value)


def test_signing_key_refuses_a_seed_of_the_wrong_length(registry, monkeypatch):
    for size in (16, 64):
        value = base64.b64encode(bytes(range(size))).decode("ascii")
        monkeypatch.setenv(ENV, value)
        with pytest.raises(SystemExit) as caught:
            registry.signing_key(ENV)
        assert str(caught.value) == f"{ENV} must be a base64 raw 32-byte Ed25519 seed, not {size} bytes"
        assert value not in str(caught.value)


def test_signing_key_loads_a_seed_with_surrounding_whitespace(registry, monkeypatch):
    _, private, public = throwaway()
    monkeypatch.setenv(ENV, f"  {private}\n")
    loaded = registry.signing_key(ENV)
    assert registry.public_b64(loaded) == public
    assert len(base64.b64decode(registry.public_b64(loaded), validate=True)) == 32


def test_sign_then_verify_round_trip(registry):
    key, _, public = throwaway()
    body = b'{"format": "formext-index", "extensions": []}\n'
    signature = registry.sign_b64(key, body)
    assert len(base64.b64decode(signature, validate=True)) == 64
    assert registry.verify_b64(public, body, signature) is True
    assert registry.verify_b64(f" {public}\n", body, f"{signature}\n") is True
    Ed25519PublicKey.from_public_bytes(base64.b64decode(public)).verify(base64.b64decode(signature), body)


def test_verify_refuses_a_changed_body(registry):
    key, _, public = throwaway()
    body = b"exact bytes of the file"
    signature = registry.sign_b64(key, body)
    assert registry.verify_b64(public, body + b"\n", signature) is False
    assert registry.verify_b64(public, b"exact bytes of the filE", signature) is False
    assert registry.verify_b64(public, b"", signature) is False


def test_verify_refuses_a_changed_signature(registry):
    key, _, public = throwaway()
    body = b"exact bytes of the file"
    raw = bytearray(base64.b64decode(registry.sign_b64(key, body)))
    flipped = bytearray(raw)
    flipped[10] ^= 0x01
    assert registry.verify_b64(public, body, base64.b64encode(bytes(flipped)).decode("ascii")) is False
    assert registry.verify_b64(public, body, base64.b64encode(bytes(raw[:63])).decode("ascii")) is False
    assert registry.verify_b64(public, body, base64.b64encode(bytes(raw) + b"\x00").decode("ascii")) is False


def test_verify_refuses_a_wrong_key(registry):
    key, private, _ = throwaway()
    _, _, other_public = throwaway()
    body = b"exact bytes of the file"
    signature = registry.sign_b64(key, body)
    assert registry.verify_b64(other_public, body, signature) is False
    assert registry.verify_b64(private, body, signature) is False


def test_verify_returns_false_for_garbage_without_raising(registry):
    key, _, public = throwaway()
    body = b"payload"
    signature = registry.sign_b64(key, body)
    cases = [
        ("not base64!!", signature),
        (public, "not base64!!"),
        (public[:-4], signature),
        (base64.b64encode(b"short").decode("ascii"), signature),
        ("", signature),
        (public, ""),
        ("été", signature),
        (public, "%%%%"),
    ]
    for pub, sig in cases:
        assert registry.verify_b64(pub, body, sig) is False, (pub, sig)


def test_extension_dirs_lists_visible_folders_sorted(registry, repo_root, tmp_path, monkeypatch):
    committed = registry.extension_dirs()
    assert repo_root / "extensions" / "focus-timer" in committed
    assert committed == sorted(committed)
    root = tmp_path / "extensions"
    for name in ("zeta", "alpha", "mid-one", ".hidden"):
        (root / name).mkdir(parents=True)
    (root / "README.md").write_text("x", encoding="utf-8")
    (root / "beta.formpkg").write_text("x", encoding="utf-8")
    monkeypatch.setattr(registry, "EXTENSIONS", root)
    assert registry.extension_dirs() == [root / "alpha", root / "mid-one", root / "zeta"]


def test_extension_dirs_is_empty_when_the_folder_is_missing(registry, tmp_path, monkeypatch):
    monkeypatch.setattr(registry, "EXTENSIONS", tmp_path / "nothing")
    assert registry.extension_dirs() == []
    plain = tmp_path / "a-file"
    plain.write_text("x", encoding="utf-8")
    monkeypatch.setattr(registry, "EXTENSIONS", plain)
    assert registry.extension_dirs() == []


@pytest.mark.parametrize("kind, secret", [("registry", "REGISTRY_SIGNING_KEY"), ("publisher", "PUBLISHER_SIGNING_KEY")])
def test_generator_json_pair_signs_and_verifies(kind, secret, registry, run_tool, tmp_path, monkeypatch):
    done = run_tool("tools/new_signing_key.py", kind, "--json", cwd=tmp_path)
    assert done.returncode == 0, done.stderr
    doc = json.loads(done.stdout)
    assert doc["kind"] == kind
    assert doc["secret"] == secret
    assert len(base64.b64decode(doc["private_key"], validate=True)) == 32
    assert len(base64.b64decode(doc["public_key"], validate=True)) == 32
    monkeypatch.setenv(ENV, doc["private_key"])
    key = registry.signing_key(ENV)
    assert registry.public_b64(key) == doc["public_key"]
    body = b"index body"
    assert registry.verify_b64(doc["public_key"], body, registry.sign_b64(key, body)) is True


def test_generator_text_output_names_the_secret_and_gives_a_matching_pair(registry, run_tool, tmp_path, monkeypatch):
    done = run_tool("tools/new_signing_key.py", "publisher", cwd=tmp_path)
    assert done.returncode == 0, done.stderr
    assert "PUBLISHER_SIGNING_KEY" in done.stdout
    assert "registry/publishers.json" in done.stdout
    private, public = pair_from_text(done.stdout)
    monkeypatch.setenv(ENV, private)
    assert registry.public_b64(registry.signing_key(ENV)) == public


def test_generator_refuses_an_unknown_kind(run_tool, tmp_path):
    done = run_tool("tools/new_signing_key.py", "admin", cwd=tmp_path)
    assert done.returncode == 2
    assert done.stdout == ""
    assert "invalid choice" in done.stderr
    assert list(tmp_path.iterdir()) == []


def test_generator_writes_no_file_and_keeps_private_keys_out_of_the_repo(run_tool, repo_root, tmp_path):
    work = tmp_path / "work"
    home = tmp_path / "home"
    work.mkdir()
    home.mkdir()
    start = time.time() - 2
    env = {"HOME": str(home)}
    text = run_tool("tools/new_signing_key.py", "registry", cwd=work, env=env)
    js = run_tool("tools/new_signing_key.py", "publisher", "--json", cwd=work, env=env)
    assert text.returncode == 0, text.stderr
    assert js.returncode == 0, js.stderr
    privates = [pair_from_text(text.stdout)[0], json.loads(js.stdout)["private_key"]]
    assert privates[0] != privates[1]
    assert list(work.iterdir()) == []
    assert list(home.iterdir()) == []
    for path in repo_root.rglob("*"):
        try:
            if not path.is_file() or path.stat().st_mtime < start:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        for private in privates:
            assert private.encode("ascii") not in data, path
