import base64
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
EXTENSIONS = sorted(p.name for p in (ROOT / "extensions").iterdir() if p.is_dir() and not p.name.startswith("."))
COPIES = [e for e in EXTENSIONS if (ROOT / "extensions" / e / "tools" / "formpkg.py").is_file()]
SDK_COPIES = [e for e in EXTENSIONS if (ROOT / "extensions" / e / "src" / "formext.ts").is_file()]
SCHEMAS = sorted(p.name for p in (ROOT / "contract" / "schema").glob("*.json"))
JSON_TYPES = {"object", "array", "string", "number", "integer", "boolean", "null"}
PEM_PRIVATE = re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----")
B64_SEED = re.compile(rb"(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{43}=(?![A-Za-z0-9+/=])")
HEX_SEED = re.compile(rb"(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])")


@pytest.fixture
def formpkg(load_module):
    return load_module("contract/tools/formpkg.py")


@pytest.fixture
def registry(load_module):
    return load_module("tools/registry.py")


def package_dir(ext: str) -> Path:
    return ROOT / "extensions" / ext / "package"


def manifest(ext: str) -> dict:
    return json.loads((package_dir(ext) / "manifest.json").read_text(encoding="utf-8"))


def tracked_files(repo_root: Path) -> list[str]:
    result = subprocess.run(["git", "ls-files", "-z"], cwd=str(repo_root), capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    return [p for p in result.stdout.decode("utf-8").split("\0") if p]


def is_on_curve(raw: bytes) -> bool:
    p = 2**255 - 19
    d = (-121665 * pow(121666, p - 2, p)) % p
    y = int.from_bytes(raw, "little") & ((1 << 255) - 1)
    sign = raw[31] >> 7
    if y >= p:
        return False
    u = (y * y - 1) % p
    v = (d * y * y + 1) % p
    x2 = u * pow(v, p - 2, p) % p
    if x2 == 0:
        return sign == 0
    return pow(x2, (p - 1) // 2, p) == 1


def test_extension_folders_are_found_and_match_registry_listing(registry):
    assert EXTENSIONS
    assert [p.name for p in registry.extension_dirs()] == EXTENSIONS
    for ext in EXTENSIONS:
        assert (package_dir(ext) / "manifest.json").is_file(), ext


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_manifest_api_is_one_and_id_is_folder_name(ext):
    m = manifest(ext)
    assert m.get("api") == "1"
    assert m.get("id") == ext


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_manifest_version_has_three_numbers(ext):
    version = manifest(ext).get("version")
    assert isinstance(version, str)
    assert re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version), version


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_manifest_product_is_host_app_and_not_native(ext, registry):
    m = manifest(ext)
    assert m.get("product") in registry.HOST_PRODUCTS
    assert m.get("native") is False


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_entry_ui_is_a_file_of_the_package(ext, formpkg):
    ui = (manifest(ext).get("entry") or {}).get("ui")
    assert isinstance(ui, str) and ui
    folder = package_dir(ext)
    shipped = {p.relative_to(folder).as_posix() for p in formpkg.files_of(folder)[0]}
    assert ui in shipped
    assert (folder / ui).resolve().is_relative_to(folder.resolve())


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_contract_packager_reports_no_problems(ext, formpkg):
    errs, m = formpkg.problems(package_dir(ext))
    assert errs == []
    assert formpkg.files_of(package_dir(ext))[1] == []
    assert m["id"] == ext


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_package_builds_into_tmp_path(ext, formpkg, tmp_path):
    target, digest, size, m = formpkg.build(package_dir(ext), tmp_path / "out")
    assert target == tmp_path / "out" / f"{ext}-{m['version']}.formpkg"
    assert target.is_file()
    assert size == target.stat().st_size > 0
    assert digest == hashlib.sha256(target.read_bytes()).hexdigest()
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert json.loads(z.read("manifest.json")) == manifest(ext)


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_building_twice_gives_same_bytes(ext, formpkg, tmp_path):
    first, first_digest, _, _ = formpkg.build(package_dir(ext), tmp_path / "one")
    second, second_digest, _, _ = formpkg.build(package_dir(ext), tmp_path / "two")
    assert first.read_bytes() == second.read_bytes()
    assert first_digest == second_digest


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_built_package_holds_exactly_the_package_files(ext, formpkg, tmp_path):
    folder = package_dir(ext)
    target, _, _, _ = formpkg.build(folder, tmp_path)
    expected = sorted(p.relative_to(folder).as_posix() for p in formpkg.files_of(folder)[0])
    with zipfile.ZipFile(target) as z:
        assert z.namelist() == expected
        for name in expected:
            assert z.read(name) == (folder / name).read_bytes(), name


@pytest.mark.parametrize("ext", COPIES)
def test_packager_copy_builds_same_sha256_as_contract(ext, formpkg, load_module, tmp_path):
    copy = load_module(f"extensions/{ext}/tools/formpkg.py", "_copy_formpkg_" + ext.replace("-", "_"))
    assert copy is not formpkg
    _, copy_digest, _, _ = copy.build(package_dir(ext), tmp_path / "copy")
    _, kit_digest, _, _ = formpkg.build(package_dir(ext), tmp_path / "kit")
    assert copy_digest == kit_digest


@pytest.mark.parametrize("ext", SDK_COPIES)
def test_sdk_source_copy_is_identical_to_contract_sdk(ext, repo_root):
    copy = repo_root / "extensions" / ext / "src" / "formext.ts"
    assert copy.read_bytes() == (repo_root / "contract" / "sdk" / "formext.ts").read_bytes()


def sdk_build_hashes(repo_root: Path) -> list[str]:
    lines = (repo_root / "tools" / "sdk_builds.txt").read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#")]


def test_sdk_builds_file_lists_only_sha256_lines(repo_root):
    hashes = sdk_build_hashes(repo_root)
    assert hashes
    for value in hashes:
        assert re.fullmatch(r"[0-9a-f]{64}", value), value
    assert len(set(hashes)) == len(hashes)


def test_shipped_sdk_builds_are_listed_in_sdk_builds(repo_root):
    known = set(sdk_build_hashes(repo_root))
    unlisted = []
    for ext in EXTENSIONS:
        for path in sorted(package_dir(ext).rglob("formext.js")):
            if hashlib.sha256(path.read_bytes()).hexdigest() not in known:
                unlisted.append(path.relative_to(repo_root).as_posix())
    assert unlisted == []


@pytest.mark.parametrize("ext", EXTENSIONS)
def test_extension_is_not_on_blocklist(ext, registry, repo_root):
    blocked, errs = registry.load_blocklist(repo_root / "registry" / "blocklist.json")
    assert errs == []
    assert registry.blocked_reason(blocked, ext, manifest(ext)["version"]) is None


def test_blocklist_loads_with_no_problems(registry, repo_root):
    path = repo_root / "registry" / "blocklist.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    blocked, errs = registry.load_blocklist(path)
    assert errs == []
    assert doc["format"] == "formext-blocklist"
    assert doc["format_version"] == 1
    assert isinstance(doc["blocked"], list)
    assert len(blocked) == len(doc["blocked"])


def test_publishers_load_with_unique_ids_and_https_urls(registry, repo_root):
    publishers = registry.load_publishers(repo_root / "registry" / "publishers.json")
    assert publishers
    ids = [p.get("id") for p in publishers]
    assert len(set(ids)) == len(ids)
    assert registry.PUBLISHER_ID in ids
    for p in publishers:
        assert set(p) >= {"id", "name", "public_key"}, p
        assert str(p.get("url", "https://")).startswith("https://"), p


def test_publisher_keys_are_valid_ed25519_public_keys(registry, repo_root):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    publishers = registry.load_publishers(repo_root / "registry" / "publishers.json")
    assert publishers
    keys = [p["public_key"] for p in publishers]
    assert len(set(keys)) == len(keys)
    for text in keys:
        raw = base64.b64decode(text, validate=True)
        assert len(raw) == 32, text
        assert base64.b64encode(raw).decode("ascii") == text
        assert is_on_curve(raw), text
        key = Ed25519PublicKey.from_public_bytes(raw)
        assert key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw) == raw
        assert registry.verify_b64(text, b"body", base64.b64encode(bytes(64)).decode("ascii")) is False


def test_no_private_key_material_is_tracked(registry, repo_root):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    public = {base64.b64decode(p["public_key"]) for p in registry.load_publishers(repo_root / "registry" / "publishers.json")}
    found = []
    for rel in tracked_files(repo_root):
        name = rel.rsplit("/", 1)[-1].lower()
        if name.endswith((".pem", ".key", ".p8", ".p12", ".pfx", ".seed")) or name.startswith(("id_ed25519", ".env")):
            found.append(rel)
        path = repo_root / rel
        if not path.is_file():
            continue
        body = path.read_bytes()
        if PEM_PRIVATE.search(body):
            found.append(rel)
        candidates = [base64.b64decode(m) for m in B64_SEED.findall(body)]
        candidates += [bytes.fromhex(m.decode("ascii")) for m in HEX_SEED.findall(body)]
        for seed in candidates:
            if len(seed) != 32:
                continue
            derived = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw
            )
            if derived in public:
                found.append(rel)
    assert found == []


def test_no_node_modules_or_dist_is_tracked(repo_root):
    files = tracked_files(repo_root)
    assert files
    bad = [rel for rel in files if {"node_modules", "dist"} & set(rel.split("/"))]
    assert bad == []


def test_hello_example_passes_packager(formpkg, repo_root, tmp_path):
    folder = repo_root / "contract" / "examples" / "hello"
    errs, m = formpkg.problems(folder)
    assert errs == []
    assert formpkg.files_of(folder)[1] == []
    assert m["api"] == "1"
    target, digest, _, _ = formpkg.build(folder, tmp_path)
    with zipfile.ZipFile(target) as z:
        assert "manifest.json" in z.namelist()
        assert m["entry"]["ui"] in z.namelist()
    _, again, _, _ = formpkg.build(folder, tmp_path / "again")
    assert again == digest


@pytest.mark.parametrize("name", SCHEMAS)
def test_each_schema_is_valid_json_with_top_level_type(name, repo_root):
    doc = json.loads((repo_root / "contract" / "schema" / name).read_text(encoding="utf-8"))
    assert isinstance(doc, dict)
    kind = doc.get("type")
    kinds = kind if isinstance(kind, list) else [kind]
    assert kinds and all(k in JSON_TYPES for k in kinds), kind


@pytest.mark.parametrize("name", SCHEMAS)
def test_schema_required_names_are_declared_properties(name, repo_root):
    doc = json.loads((repo_root / "contract" / "schema" / name).read_text(encoding="utf-8"))
    required = doc.get("required", [])
    assert isinstance(required, list)
    assert set(required) <= set(doc.get("properties", {})), sorted(set(required) - set(doc.get("properties", {})))
