import json
import os
import shutil
from pathlib import Path

import pytest

UNIT = "contract/host/python/formext_host.py"
PRODUCT = "formvis"
APP = "FormVis"
APP_VERSION = "1.0.0"
HELLO = "hello-formext"
VERSION = "0.1.0"
LISTED = [".html", ".js", ".mjs", ".css", ".json", ".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".wasm", ".txt", ".md", ".wav", ".ogg", ".mp3", ".webm", ".mp4", ".cube", ".woff2"]
POLICY = (
    "default-src 'none'; script-src BASE 'wasm-unsafe-eval'; style-src BASE 'unsafe-inline'; "
    "img-src BASE data: blob:; media-src BASE data: blob:; font-src BASE; connect-src 'none'; "
    "frame-src 'none'; form-action 'none'; base-uri 'none'"
)
PROTOCOL_BASE = f"formext://{HELLO}/{VERSION}/"
WINDOWS_BASE = f"http://formext.localhost/{HELLO}/{VERSION}/"


@pytest.fixture
def host(load_module):
    return load_module(UNIT)


def install(repo_root, tmp_path, ext_id=HELLO):
    path = tmp_path / "installed" / ext_id
    shutil.copytree(repo_root / "contract" / "examples" / "hello", path)
    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    manifest["id"] = ext_id
    (path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return path


def ready(host, path, ext_id=HELLO, version=VERSION):
    ext = host.Extension(id=ext_id, version=version, source="catalogue", path=Path(str(path)))
    ext = host.check(ext, PRODUCT, APP_VERSION, APP)
    assert ext.state == "ready", ext.reason
    return ext


@pytest.fixture
def package(repo_root, tmp_path):
    return install(repo_root, tmp_path)


@pytest.fixture
def exts(host, package):
    return [ready(host, package)]


def media(content_type):
    return content_type.split(";")[0].strip().lower()


def directives(policy):
    out = {}
    for part in policy.split(";"):
        words = part.split()
        if words:
            out[words[0]] = words[1:]
    return out


def test_entry_page_is_served_with_html_type(host, package, exts):
    found = host.file_for(exts, HELLO, VERSION, "ui/index.html")
    assert found is not None
    path, content_type = found
    assert path.read_bytes() == (package / "ui" / "index.html").read_bytes()
    assert media(content_type) == "text/html"


def test_example_script_and_style_are_served_with_their_types(host, package, exts):
    script = host.file_for(exts, HELLO, VERSION, "ui/hello.js")
    style = host.file_for(exts, HELLO, VERSION, "ui/hello.css")
    assert script is not None and style is not None
    assert script[0].read_bytes() == (package / "ui" / "hello.js").read_bytes()
    assert style[0].read_bytes() == (package / "ui" / "hello.css").read_bytes()
    assert media(script[1]) in ("text/javascript", "application/javascript")
    assert media(style[1]) == "text/css"


@pytest.mark.parametrize(
    "suffix, expected",
    [(".json", "application/json"), (".wasm", "application/wasm"), (".svg", "image/svg+xml"), (".woff2", "font/woff2")],
)
def test_file_kind_gets_its_standard_type(host, package, exts, suffix, expected):
    (package / "assets").mkdir()
    (package / "assets" / f"file{suffix}").write_bytes(b"payload")
    found = host.file_for(exts, HELLO, VERSION, f"assets/file{suffix}")
    assert found is not None
    assert media(found[1]) == expected


def test_every_listed_type_is_served(host, package, exts):
    (package / "assets").mkdir()
    for suffix in LISTED:
        (package / "assets" / f"file{suffix}").write_bytes(suffix.encode())
    for suffix in LISTED:
        found = host.file_for(exts, HELLO, VERSION, f"assets/file{suffix}")
        assert found is not None, suffix
        assert found[0].read_bytes() == suffix.encode()
        assert found[1]


def test_types_outside_the_list_are_refused(host, package, exts):
    for name in ("tool.py", "run.sh", "page.htm", "README", "data.xml", "app.exe"):
        (package / "ui" / name).write_bytes(b"x")
        assert host.file_for(exts, HELLO, VERSION, f"ui/{name}") is None, name


def test_parent_segments_that_leave_the_package_are_refused(host, package, exts):
    (package.parent / "outside.html").write_text("secret", encoding="utf-8")
    for rel in ("../outside.html", "ui/../../outside.html", "../hello-formext/ui/index.html"):
        assert host.file_for(exts, HELLO, VERSION, rel) is None, rel


def test_absolute_paths_are_refused_even_to_a_package_file(host, package, exts):
    assert host.file_for(exts, HELLO, VERSION, str(package / "ui" / "index.html")) is None
    assert host.file_for(exts, HELLO, VERSION, "/etc/hostname.txt") is None


def test_backslash_paths_are_refused(host, package, exts):
    (package.parent / "outside.html").write_text("secret", encoding="utf-8")
    assert host.file_for(exts, HELLO, VERSION, "ui\\index.html") is None
    assert host.file_for(exts, HELLO, VERSION, "..\\outside.html") is None


def test_empty_path_is_refused(host, exts):
    assert host.file_for(exts, HELLO, VERSION, "") is None


def test_folders_are_refused(host, package, exts):
    (package / "ui" / "data.json").mkdir()
    for rel in ("ui", "ui/", "ui/data.json"):
        assert host.file_for(exts, HELLO, VERSION, rel) is None, rel


def test_missing_file_is_refused(host, exts):
    assert host.file_for(exts, HELLO, VERSION, "ui/missing.js") is None


def test_symlink_to_a_file_outside_is_refused(host, package, exts):
    secret = package.parent / "secret.html"
    secret.write_text("secret", encoding="utf-8")
    os.symlink(secret, package / "ui" / "escape.html")
    assert host.file_for(exts, HELLO, VERSION, "ui/escape.html") is None


def test_symlinked_folder_pointing_outside_is_refused(host, package, exts):
    outside = package.parent / "elsewhere"
    outside.mkdir()
    (outside / "page.html").write_text("secret", encoding="utf-8")
    os.symlink(outside, package / "ui" / "linked", target_is_directory=True)
    assert host.file_for(exts, HELLO, VERSION, "ui/linked/page.html") is None


def test_symlink_inside_the_package_is_refused(host, package, exts):
    os.symlink(package / "ui" / "index.html", package / "ui" / "alias.html")
    assert host.file_for(exts, HELLO, VERSION, "ui/alias.html") is None


def test_symlinked_folder_inside_the_package_is_refused(host, package, exts):
    os.symlink(package / "ui", package / "ui-link", target_is_directory=True)
    assert host.file_for(exts, HELLO, VERSION, "ui-link/index.html") is None


def test_other_extension_id_does_not_reach_its_files(host, repo_root, tmp_path, package):
    other = install(repo_root, tmp_path, "beat-markers")
    (other / "ui" / "only-other.js").write_text("other", encoding="utf-8")
    (other / "ui" / "index.html").write_text("<!doctype html><title>other</title>", encoding="utf-8")
    both = [ready(host, package), ready(host, other, "beat-markers")]
    assert host.file_for(both, HELLO, VERSION, "ui/only-other.js") is None
    found = host.file_for(both, "beat-markers", VERSION, "ui/only-other.js")
    assert found is not None and found[0].read_text(encoding="utf-8") == "other"
    mine = host.file_for(both, HELLO, VERSION, "ui/index.html")
    assert mine is not None
    assert mine[0].read_bytes() == (package / "ui" / "index.html").read_bytes()


def test_wrong_version_is_refused(host, exts):
    for version in ("0.1.1", "0.2.0", "1.0.0", "0.1", ""):
        assert host.file_for(exts, HELLO, version, "ui/index.html") is None, version


def test_unknown_id_is_refused(host, exts):
    assert host.file_for(exts, "nope-ext", VERSION, "ui/index.html") is None
    assert host.file_for([], HELLO, VERSION, "ui/index.html") is None


def test_path_of_two_hundred_characters_is_served(host, package, exts):
    rel = "d/" + "x" * 195 + ".js"
    assert len(rel) == 200
    (package / "d").mkdir()
    (package / rel).write_text("long", encoding="utf-8")
    found = host.file_for(exts, HELLO, VERSION, rel)
    assert found is not None
    assert found[0].read_text(encoding="utf-8") == "long"


def test_policy_without_base_matches_the_contract(host):
    expected = POLICY.replace("BASE", "'self'")
    assert host.csp_for() == expected
    assert host.csp_for("") == expected


def test_policy_for_relative_base_uses_self(host):
    assert host.csp_for(f"/api/extensions/files/{HELLO}/{VERSION}/") == POLICY.replace("BASE", "'self'")


def test_policy_for_custom_protocol_uses_the_extension_prefix(host):
    assert host.csp_for(PROTOCOL_BASE) == POLICY.replace("BASE", PROTOCOL_BASE)


def test_policy_for_windows_prefix_uses_that_prefix(host):
    assert host.csp_for(WINDOWS_BASE) == POLICY.replace("BASE", WINDOWS_BASE)


def test_policy_forbids_network_frames_forms_and_base(host):
    for base in ("", PROTOCOL_BASE, WINDOWS_BASE):
        rules = directives(host.csp_for(base))
        for name in ("default-src", "connect-src", "frame-src", "form-action", "base-uri"):
            assert rules.get(name) == ["'none'"], (base, name)


def test_policy_never_allows_wildcards_eval_inline_script_or_bare_schemes(host):
    for base in ("", PROTOCOL_BASE, WINDOWS_BASE):
        rules = directives(host.csp_for(base))
        sources = [s for values in rules.values() for s in values]
        assert "*" not in sources
        assert "'unsafe-eval'" not in sources
        assert "'unsafe-inline'" not in rules["script-src"]
        for bare in ("formext:", "formext://", "http:", "https:", "http://formext.localhost", "http://formext.localhost/"):
            assert bare not in sources, (base, bare)


def test_policy_allows_own_files_in_each_fetch_directive(host):
    for base, own in (("", "'self'"), (PROTOCOL_BASE, PROTOCOL_BASE), (WINDOWS_BASE, WINDOWS_BASE)):
        rules = directives(host.csp_for(base))
        for name in ("script-src", "style-src", "img-src", "media-src", "font-src"):
            assert own in rules[name], (base, name)


def test_html_answer_carries_policy_and_guard_headers(host):
    headers = host.headers_for("text/html; charset=utf-8", "")
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Cache-Control"] == "no-store"
    assert headers["Cross-Origin-Resource-Policy"] == "cross-origin"
    assert headers["Access-Control-Allow-Origin"] == "*"
    assert headers["Content-Security-Policy"] == POLICY.replace("BASE", "'self'")


def test_html_answer_with_custom_protocol_base_carries_its_policy(host):
    headers = host.headers_for("text/html; charset=utf-8", PROTOCOL_BASE)
    assert headers["Content-Security-Policy"] == POLICY.replace("BASE", PROTOCOL_BASE)
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_every_served_kind_stops_sniffing_and_is_not_cached(host, package, exts):
    (package / "assets").mkdir()
    for suffix in LISTED:
        (package / "assets" / f"file{suffix}").write_bytes(b"x")
        found = host.file_for(exts, HELLO, VERSION, f"assets/file{suffix}")
        assert found is not None, suffix
        headers = host.headers_for(found[1], PROTOCOL_BASE)
        assert headers.get("X-Content-Type-Options") == "nosniff", suffix
        assert headers.get("Cache-Control") == "no-store", suffix
        assert headers.get("Cross-Origin-Resource-Policy") == "cross-origin", suffix
        assert headers.get("Access-Control-Allow-Origin") == "*", suffix


def test_entry_page_type_from_file_for_brings_the_policy(host, exts):
    found = host.file_for(exts, HELLO, VERSION, "ui/index.html")
    assert found is not None
    for base in ("", WINDOWS_BASE):
        headers = host.headers_for(found[1], base)
        assert headers.get("Content-Security-Policy") == host.csp_for(base)
        assert "frame-src 'none'" in headers["Content-Security-Policy"]
