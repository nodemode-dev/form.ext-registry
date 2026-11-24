import json
import os
import sys
from pathlib import Path

import pytest

UNIT = "contract/host/python/formext_host.py"
PRODUCT = "formcut"
APP = "FormCut"
APP_VERSION = "2.5.0"


@pytest.fixture
def host(load_module):
    return load_module(UNIT)


@pytest.fixture
def portal(tmp_path):
    root = tmp_path / "portal"
    (root / "extensions" / PRODUCT).mkdir(parents=True)
    return root


def manifest_for(ext_id, **changes):
    data = {
        "format": "formai-package",
        "format_version": 1,
        "id": ext_id,
        "name": "Beat Markers",
        "product": PRODUCT,
        "kind": "extension",
        "version": "1.0.0",
        "author": "Someone",
        "licence": "MIT",
        "native": False,
        "permissions": ["document"],
        "api": "1",
        "entry": {"ui": "ui/index.html"},
        "contributes": {"panels": [{"id": "main", "title": "Main", "location": "dock"}]},
    }
    for key, value in changes.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    return data


def make_package(tmp_path, ext_id="beat-markers", folder=None, **changes):
    path = tmp_path / "packages" / (folder or ext_id)
    (path / "ui").mkdir(parents=True)
    (path / "ui" / "index.html").write_text("<!doctype html><title>x</title>", encoding="utf-8")
    (path / "manifest.json").write_text(json.dumps(manifest_for(ext_id, **changes)), encoding="utf-8")
    return path


def write_enabled(root, rows, product=PRODUCT, **changes):
    folder = root / "extensions" / product
    folder.mkdir(parents=True, exist_ok=True)
    data = {"format": "formportal-enabled-extensions", "format_version": 1, "product": product, "extensions": rows}
    data.update(changes)
    (folder / "enabled.json").write_text(json.dumps(data), encoding="utf-8")


def write_dev(root, rows, product=PRODUCT):
    folder = root / "extensions" / product
    folder.mkdir(parents=True, exist_ok=True)
    data = {"format": "formext-dev-extensions", "format_version": 1, "product": product, "extensions": rows}
    (folder / "dev.json").write_text(json.dumps(data), encoding="utf-8")


def row_for(path, ext_id="beat-markers", version="1.0.0", source="catalogue"):
    return {"id": ext_id, "kind": "extension", "version": version, "path": str(path), "permissions": ["document"], "native": False, "source": source}


def resolve_one(host, portal, tmp_path, app_version=APP_VERSION, **changes):
    path = make_package(tmp_path, **changes)
    write_enabled(portal, [row_for(path, version=str(changes.get("version", "1.0.0")))])
    found = host.resolve(PRODUCT, app_version, APP, root=portal)
    assert len(found) == 1
    return found[0]


def ready_ids(found):
    return [e.id for e in found if e.state == "ready"]


def test_enabled_installed_compatible_extension_is_returned_ready(host, portal, tmp_path):
    path = make_package(tmp_path)
    write_enabled(portal, [row_for(path)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert len(found) == 1
    ext = found[0]
    assert (ext.id, ext.version, ext.source, ext.state, ext.reason) == ("beat-markers", "1.0.0", "catalogue", "ready", "")
    assert ext.path == path
    assert ext.entry_ui == "ui/index.html"
    assert ext.permissions == ["document"]
    assert ext.panels == [{"id": "main", "title": "Main", "location": "dock"}]


def test_sideload_source_is_kept(host, portal, tmp_path):
    path = make_package(tmp_path)
    write_enabled(portal, [row_for(path, source="sideload")])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [(e.source, e.state) for e in found] == [("sideload", "ready")]


def test_installed_but_not_enabled_is_not_returned(host, portal, tmp_path):
    listed = make_package(tmp_path, "listed-one")
    make_package(tmp_path, "unlisted-one")
    write_enabled(portal, [row_for(listed, "listed-one")])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.id for e in found] == ["listed-one"]


def test_no_portal_files_gives_no_extensions(host, portal, tmp_path):
    make_package(tmp_path)
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=tmp_path / "absent") == []


def test_enabled_for_another_product_is_not_loaded(host, portal, tmp_path):
    path = make_package(tmp_path, product="formwav")
    write_enabled(portal, [row_for(path)], product="formwav")
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []


def test_enabled_file_of_another_format_is_ignored(host, portal, tmp_path):
    path = make_package(tmp_path)
    write_enabled(portal, [row_for(path)], format="formext-dev-extensions")
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []


def test_manifest_for_wrong_product_is_refused(host, portal, tmp_path):
    ext = resolve_one(host, portal, tmp_path, product="formwav")
    assert ext.state == "refused"
    assert "formwav" in ext.reason


def test_manifest_id_differing_from_entry_is_refused(host, portal, tmp_path):
    path = make_package(tmp_path, "other-name", folder="beat-markers")
    write_enabled(portal, [row_for(path, "beat-markers")])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [(e.id, e.state) for e in found] == [("beat-markers", "refused")]
    assert found[0].reason


def test_app_older_than_minimum_app_is_refused(host, portal, tmp_path):
    ext = resolve_one(host, portal, tmp_path, app_version="2.4.9", minimum_app="2.5.0")
    assert ext.state == "refused"
    assert "2.5.0" in ext.reason


def test_app_equal_to_or_newer_than_minimum_app_is_ready(host, portal, tmp_path):
    path = make_package(tmp_path, minimum_app="2.5.0")
    write_enabled(portal, [row_for(path)])
    assert ready_ids(host.resolve(PRODUCT, "2.5.0", APP, root=portal)) == ["beat-markers"]
    assert ready_ids(host.resolve(PRODUCT, "3.0.0", APP, root=portal)) == ["beat-markers"]


def test_minimum_app_compares_by_number_not_text(host, portal, tmp_path):
    path = make_package(tmp_path, minimum_app="2.9.0")
    write_enabled(portal, [row_for(path)])
    assert ready_ids(host.resolve(PRODUCT, "2.10.0", APP, root=portal)) == ["beat-markers"]
    (path / "manifest.json").write_text(json.dumps(manifest_for("beat-markers", minimum_app="2.10.0")), encoding="utf-8")
    found = host.resolve(PRODUCT, "2.9.0", APP, root=portal)
    assert [e.state for e in found] == ["refused"]


def test_version_tuple_orders_by_number(host):
    assert host.version_tuple("1.10.0") > host.version_tuple("1.9.0")
    assert host.version_tuple("10.0.0") > host.version_tuple("9.99.99")
    assert host.version_tuple("1.2.3") == (1, 2, 3)
    assert host.version_tuple("01.02.03") == host.version_tuple("1.2.3")


def test_version_tuple_never_raises_on_bad_text(host):
    for text in ("", "abc", "1.x.3", "1..2", "v1.2.3"):
        assert isinstance(host.version_tuple(text), tuple)


@pytest.mark.parametrize("api", ["2", "0", 1, "1.0", ""])
def test_wrong_api_is_refused_with_contract_words(host, portal, tmp_path, api):
    ext = resolve_one(host, portal, tmp_path, api=api)
    assert ext.state == "refused"
    assert ext.reason == f"it needs extension API {api}; this {APP} offers API 1"


def test_missing_api_is_refused_with_none_in_the_words(host, portal, tmp_path):
    ext = resolve_one(host, portal, tmp_path, api=None)
    assert ext.state == "refused"
    assert ext.reason == f"it needs extension API None; this {APP} offers API 1"


def test_native_package_is_listed_and_refused(host, portal, tmp_path):
    ext = resolve_one(host, portal, tmp_path, native=True)
    assert ext.state == "refused"
    assert "native extensions are not supported" in ext.reason


@pytest.mark.parametrize("bad_id", ["beat-markers\n", "beat\\markers", "Beat-Markers", "../beat", "b", ""])
def test_entry_with_bad_id_is_never_ready(host, portal, tmp_path, bad_id):
    path = make_package(tmp_path, "beat-markers")
    data = manifest_for("beat-markers")
    data["id"] = bad_id
    (path / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
    write_enabled(portal, [row_for(path, bad_id)])
    write_dev(portal, [{"id": bad_id, "path": str(path), "added": "2026-01-01T00:00:00Z"}])
    assert ready_ids(host.resolve(PRODUCT, APP_VERSION, APP, root=portal)) == []


@pytest.mark.parametrize("bad_version", ["1.0.0\n", "1.0\\.0", "1.0", "1.0.0-beta", "a.b.c", " 1.0.0"])
def test_version_that_is_not_plain_x_y_z_is_never_ready(host, portal, tmp_path, bad_version):
    path = make_package(tmp_path, version=bad_version)
    write_enabled(portal, [row_for(path, version=bad_version)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]
    assert found[0].reason


@pytest.mark.parametrize("bad_version", ["1.0.0\n", "1.0\\.0"])
def test_development_version_with_newline_or_backslash_is_never_ready(host, portal, tmp_path, bad_version):
    path = make_package(tmp_path, version=bad_version)
    write_dev(portal, [{"id": "beat-markers", "path": str(path)}])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]


@pytest.mark.parametrize("entry", ["/etc/passwd", "../outside.html", "ui/../../outside.html", "ui\\index.html", "ui/missing.html", "ui", "ui/", "."])
def test_entry_ui_outside_the_package_or_not_a_file_is_refused(host, portal, tmp_path, entry):
    (tmp_path / "packages").mkdir(exist_ok=True)
    (tmp_path / "packages" / "outside.html").write_text("x", encoding="utf-8")
    ext = resolve_one(host, portal, tmp_path, entry={"ui": entry})
    assert ext.state == "refused"
    assert "entry.ui" in ext.reason


def test_absolute_entry_ui_pointing_at_a_real_package_file_is_refused(host, portal, tmp_path):
    path = make_package(tmp_path)
    data = manifest_for("beat-markers", entry={"ui": str(path / "ui" / "index.html")})
    (path / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
    write_enabled(portal, [row_for(path)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]


def test_entry_ui_symlink_leaving_the_package_is_refused(host, portal, tmp_path):
    path = make_package(tmp_path)
    outside = tmp_path / "secret.html"
    outside.write_text("secret", encoding="utf-8")
    try:
        os.symlink(outside, path / "ui" / "link.html")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available here")
    (path / "manifest.json").write_text(json.dumps(manifest_for("beat-markers", entry={"ui": "ui/link.html"})), encoding="utf-8")
    write_enabled(portal, [row_for(path)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]


def test_missing_entry_ui_with_panels_is_refused(host, portal, tmp_path):
    ext = resolve_one(host, portal, tmp_path, entry=None)
    assert ext.state == "refused"
    assert "entry.ui" in ext.reason


@pytest.mark.parametrize("entry", [{"ui": 5}, {"ui": ["ui/index.html"]}, {"ui": {"a": 1}}])
def test_entry_ui_that_is_not_text_is_refused(host, portal, tmp_path, entry):
    ext = resolve_one(host, portal, tmp_path, entry=entry)
    assert ext.state == "refused"


def test_missing_manifest_is_refused(host, portal, tmp_path):
    path = make_package(tmp_path)
    (path / "manifest.json").unlink()
    write_enabled(portal, [row_for(path)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [(e.id, e.state) for e in found] == [("beat-markers", "refused")]
    assert "manifest" in found[0].reason


def test_missing_package_folder_is_refused(host, portal, tmp_path):
    write_enabled(portal, [row_for(tmp_path / "gone")])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [(e.id, e.state) for e in found] == [("beat-markers", "refused")]


@pytest.mark.parametrize("raw", [b"{not json", b"", b"\xff\xfe\x00\x01", b"[1, 2]", b"null", b'"text"', b"{\"id\": \"beat-markers\",}"])
def test_manifest_that_is_not_a_json_object_is_refused(host, portal, tmp_path, raw):
    path = make_package(tmp_path)
    (path / "manifest.json").write_bytes(raw)
    write_enabled(portal, [row_for(path)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]
    assert found[0].reason


@pytest.mark.parametrize("changes", [{"format": "formai-extensions"}, {"format": None}, {"format_version": 2}])
def test_manifest_that_is_not_a_formai_package_is_refused(host, portal, tmp_path, changes):
    ext = resolve_one(host, portal, tmp_path, **changes)
    assert ext.state == "refused"
    assert ext.reason


def test_one_refused_extension_does_not_hide_a_good_one(host, portal, tmp_path):
    good = make_package(tmp_path, "good-one")
    bad = make_package(tmp_path, "bad-one", api="9")
    write_enabled(portal, [row_for(bad, "bad-one"), row_for(good, "good-one")])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert {e.id: e.state for e in found} == {"good-one": "ready", "bad-one": "refused"}


def test_development_extension_from_dev_json_is_loaded(host, portal, tmp_path):
    path = make_package(tmp_path, "dev-tool", version="0.3.1")
    write_dev(portal, [{"id": "dev-tool", "path": str(path), "added": "2026-01-01T00:00:00Z"}])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert len(found) == 1
    ext = found[0]
    assert (ext.id, ext.source, ext.state, ext.version) == ("dev-tool", "development", "ready", "0.3.1")
    assert ext.path == path


def test_development_and_enabled_extensions_are_both_returned(host, portal, tmp_path):
    installed = make_package(tmp_path, "installed-one")
    dev = make_package(tmp_path, "dev-one")
    write_enabled(portal, [row_for(installed, "installed-one")])
    write_dev(portal, [{"id": "dev-one", "path": str(dev)}])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert {e.id: (e.source, e.state) for e in found} == {"installed-one": ("catalogue", "ready"), "dev-one": ("development", "ready")}


def test_development_extension_is_checked_like_any_other(host, portal, tmp_path):
    path = make_package(tmp_path, "dev-tool", product="formwav")
    write_dev(portal, [{"id": "dev-tool", "path": str(path)}])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [(e.source, e.state) for e in found] == [("development", "refused")]


def test_dev_file_of_another_format_is_ignored(host, portal, tmp_path):
    path = make_package(tmp_path)
    folder = portal / "extensions" / PRODUCT
    data = {"format": "formportal-enabled-extensions", "format_version": 1, "product": PRODUCT, "extensions": [{"id": "beat-markers", "path": str(path)}]}
    (folder / "dev.json").write_text(json.dumps(data), encoding="utf-8")
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []


@pytest.mark.parametrize("raw", [b"{broken", b"", b"\xff\xfe", b"[]", b"7", b"null", b'{"format": "formportal-enabled-extensions"}', b'{"format": "formportal-enabled-extensions", "extensions": {"id": "x"}}', b'{"format": "formportal-enabled-extensions", "extensions": [1, "a", null, [], {}]}', b'{"format": "formportal-enabled-extensions", "extensions": [{"id": 5, "path": 7}]}'])
def test_broken_enabled_and_dev_files_never_raise(host, portal, raw):
    folder = portal / "extensions" / PRODUCT
    (folder / "enabled.json").write_bytes(raw)
    (folder / "dev.json").write_bytes(raw.replace(b"formportal-enabled-extensions", b"formext-dev-extensions"))
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert ready_ids(found) == []


@pytest.mark.parametrize("value", [pytest.param(5, marks=pytest.mark.xfail(strict=True, reason="defect: resolve raises TypeError when the extensions field of enabled.json is a number")), pytest.param(True, marks=pytest.mark.xfail(strict=True, reason="defect: resolve raises TypeError when the extensions field of enabled.json is a boolean")), "text"])
def test_enabled_extensions_field_of_wrong_type_never_raises(host, portal, value):
    write_enabled(portal, value)
    assert ready_ids(host.resolve(PRODUCT, APP_VERSION, APP, root=portal)) == []


def test_enabled_json_that_is_a_folder_never_raises(host, portal):
    folder = portal / "extensions" / PRODUCT
    (folder / "enabled.json").mkdir()
    (folder / "dev.json").mkdir()
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []


@pytest.mark.parametrize(
    "changes",
    [
        {"permissions": "document"},
        {"permissions": {"document": True}},
        pytest.param({"permissions": [{"name": "document"}]}, marks=pytest.mark.xfail(strict=True, reason="defect: check raises TypeError on an unhashable permission entry")),
        pytest.param({"permissions": [["document"]]}, marks=pytest.mark.xfail(strict=True, reason="defect: check raises TypeError on an unhashable permission entry")),
        {"contributes": []},
        pytest.param({"contributes": {"panels": 5}}, marks=pytest.mark.xfail(strict=True, reason="defect: check raises TypeError when contributes.panels is a number")),
        pytest.param({"contributes": {"commands": True}}, marks=pytest.mark.xfail(strict=True, reason="defect: check raises TypeError when contributes.commands is a boolean")),
        {"contributes": {"panels": "main"}},
        {"contributes": {"panels": [{"id": ["a"], "title": {"x": 1}}], "commands": [{"id": {"a": 1}, "title": 3}]}},
        {"entry": []},
        {"entry": "ui/index.html"},
        pytest.param({"entry": {"ui": "ui/in\u0000dex.html"}}, marks=pytest.mark.xfail(strict=True, reason="defect: check raises ValueError when entry.ui holds a null character")),
        {"minimum_app": [1, 2]},
        {"minimum_app": {"a": 1}},
        {"minimum_app": "soon"},
        {"name": {"a": 1}, "description": [1], "kind": 4},
        {"version": 1},
        {"id": ["beat-markers"]},
        {"product": {"a": 1}},
    ],
)
def test_manifest_fields_of_wrong_type_never_raise(host, portal, tmp_path, changes):
    path = make_package(tmp_path, **changes)
    write_enabled(portal, [row_for(path)])
    write_dev(portal, [{"id": "beat-markers", "path": str(path)}])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert len(found) == 1
    assert found[0].state in ("ready", "refused")


@pytest.mark.xfail(strict=True, reason="defect: _read_json lets RecursionError from deeply nested JSON escape resolve")
def test_deeply_nested_manifest_never_raises(host, portal, tmp_path):
    path = make_package(tmp_path)
    (path / "manifest.json").write_text("[" * 200000, encoding="utf-8")
    write_enabled(portal, [row_for(path)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]


@pytest.mark.xfail(strict=True, reason="defect: _read_json lets RecursionError from deeply nested JSON escape resolve")
def test_deeply_nested_enabled_file_never_raises(host, portal):
    (portal / "extensions" / PRODUCT / "enabled.json").write_text("[" * 200000, encoding="utf-8")
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []


@pytest.mark.parametrize("bad_path", ["", "bad\u0000path", 5, None, ["a"]])
def test_entry_with_bad_path_never_raises_and_is_refused(host, portal, bad_path):
    row = row_for("x")
    row["path"] = bad_path
    write_enabled(portal, [row])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]


def test_read_json_returns_none_for_missing_and_broken_files(host, tmp_path):
    good = tmp_path / "good.json"
    good.write_text('{"a": 1}', encoding="utf-8")
    bad = tmp_path / "bad.json"
    bad.write_text("{", encoding="utf-8")
    assert host._read_json(good) == {"a": 1}
    assert host._read_json(bad) is None
    assert host._read_json(tmp_path / "absent.json") is None
    assert host._read_json(tmp_path) is None


def test_safe_rel_accepts_only_paths_inside_the_package(host):
    assert host._safe_rel("ui/index.html") is True
    assert host._safe_rel("a..b/index.html") is True
    for rel in ("", "/ui/index.html", "../x.html", "ui/../x.html", "ui/..", "ui\\index.html", "..\\x.html"):
        assert host._safe_rel(rel) is False


def test_stamp_is_zero_when_files_are_absent(host, tmp_path):
    assert host.stamp(PRODUCT, root=tmp_path / "absent") == (0.0, 0.0)


def test_stamp_changes_when_enabled_json_changes(host, portal):
    write_enabled(portal, [])
    target = portal / "extensions" / PRODUCT / "enabled.json"
    os.utime(target, (1000000000, 1000000000))
    before = host.stamp(PRODUCT, root=portal)
    os.utime(target, (1000000100, 1000000100))
    after = host.stamp(PRODUCT, root=portal)
    assert before != after
    assert before[0] == 1000000000.0 and after[0] == 1000000100.0
    assert before[1] == after[1] == 0.0


def test_stamp_changes_when_dev_json_changes(host, portal):
    write_enabled(portal, [])
    write_dev(portal, [])
    folder = portal / "extensions" / PRODUCT
    os.utime(folder / "enabled.json", (1000000000, 1000000000))
    os.utime(folder / "dev.json", (1000000000, 1000000000))
    before = host.stamp(PRODUCT, root=portal)
    os.utime(folder / "dev.json", (1000000200, 1000000200))
    after = host.stamp(PRODUCT, root=portal)
    assert before[0] == after[0]
    assert before[1] != after[1]


def test_stamp_changes_when_a_file_appears_or_goes(host, portal):
    empty = host.stamp(PRODUCT, root=portal)
    write_dev(portal, [])
    present = host.stamp(PRODUCT, root=portal)
    assert empty != present
    (portal / "extensions" / PRODUCT / "dev.json").unlink()
    assert host.stamp(PRODUCT, root=portal) == empty


def test_stamp_is_per_product(host, portal):
    write_enabled(portal, [], product="formwav")
    assert host.stamp(PRODUCT, root=portal) == (0.0, 0.0)
    assert host.stamp("formwav", root=portal)[0] > 0.0


def isolate_home(monkeypatch, tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.delenv("FORMPORTAL_ROOT", raising=False)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    return home


def test_portal_root_uses_formportal_root_when_set(host, monkeypatch, tmp_path):
    isolate_home(monkeypatch, tmp_path)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    monkeypatch.setenv("FORMPORTAL_ROOT", str(tmp_path / "chosen"))
    for platform in ("linux", "darwin"):
        monkeypatch.setattr(sys, "platform", platform)
        assert host.portal_root() == tmp_path / "chosen"


def test_resolve_without_root_reads_formportal_root(host, monkeypatch, tmp_path, portal):
    isolate_home(monkeypatch, tmp_path)
    monkeypatch.setenv("FORMPORTAL_ROOT", str(portal))
    path = make_package(tmp_path)
    write_enabled(portal, [row_for(path)])
    assert ready_ids(host.resolve(PRODUCT, APP_VERSION, APP)) == ["beat-markers"]
    assert host.stamp(PRODUCT)[0] > 0.0


def test_portal_root_on_linux_uses_xdg_data_home(host, monkeypatch, tmp_path):
    isolate_home(monkeypatch, tmp_path)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    assert host.portal_root() == tmp_path / "xdg" / "formportal"


def test_portal_root_on_linux_falls_back_to_local_share(host, monkeypatch, tmp_path):
    home = isolate_home(monkeypatch, tmp_path)
    monkeypatch.setattr(sys, "platform", "linux")
    assert host.portal_root() == home / ".local" / "share" / "formportal"


def test_portal_root_on_macos_prefers_studio_folder(host, monkeypatch, tmp_path):
    home = isolate_home(monkeypatch, tmp_path)
    monkeypatch.setattr(sys, "platform", "darwin")
    support = home / "Library" / "Application Support"
    assert host.portal_root() == support / "studio.formai.portal"
    (support / "studio.formai.portal").mkdir(parents=True)
    (support / "dev.formai.portal").mkdir()
    assert host.portal_root() == support / "studio.formai.portal"


def test_portal_root_on_macos_uses_dev_folder_when_only_it_exists(host, monkeypatch, tmp_path):
    home = isolate_home(monkeypatch, tmp_path)
    monkeypatch.setattr(sys, "platform", "darwin")
    support = home / "Library" / "Application Support"
    (support / "dev.formai.portal").mkdir(parents=True)
    assert host.portal_root() == support / "dev.formai.portal"


def test_portal_root_does_not_create_anything(host, monkeypatch, tmp_path):
    home = isolate_home(monkeypatch, tmp_path)
    monkeypatch.setattr(sys, "platform", "linux")
    host.portal_root()
    assert list(home.iterdir()) == []


def load_with_id(host, portal, tmp_path, ext_id):
    path = make_package(tmp_path, ext_id)
    write_enabled(portal, [row_for(path, ext_id)])
    return host.resolve(PRODUCT, APP_VERSION, APP, root=portal)


@pytest.mark.parametrize("ext_id", ["ab", "a" * 64, "a-", "0a", "a" * 63 + "-", "a-b-c"])
def test_ids_of_2_to_64_valid_characters_are_loaded(host, portal, tmp_path, ext_id):
    found = load_with_id(host, portal, tmp_path, ext_id)
    assert [(e.id, e.state) for e in found] == [(ext_id, "ready")]


@pytest.mark.parametrize("ext_id", ["a", "a" * 65, "-ab", "-", "Ab", "aB", "ab_cd", "ab.cd", "a b"])
def test_ids_of_wrong_length_or_characters_are_not_loaded(host, portal, tmp_path, ext_id):
    found = load_with_id(host, portal, tmp_path, ext_id)
    assert found == []


def test_id_of_65_characters_is_not_loaded_from_dev_json_either(host, portal, tmp_path):
    ext_id = "a" * 65
    path = make_package(tmp_path, ext_id)
    write_dev(portal, [{"id": ext_id, "path": str(path)}])
    assert host.resolve(PRODUCT, APP_VERSION, APP, root=portal) == []


@pytest.mark.parametrize("bad_version", ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "1..3", "1.2.", "1,2,3"])
def test_versions_that_are_not_three_numbers_are_refused(host, portal, tmp_path, bad_version):
    path = make_package(tmp_path, version=bad_version)
    write_enabled(portal, [row_for(path, version=bad_version)])
    found = host.resolve(PRODUCT, APP_VERSION, APP, root=portal)
    assert [e.state for e in found] == ["refused"]
    assert "x.y.z" in found[0].reason


@pytest.mark.parametrize("version", ["10.20.30", "0.0.0", "1.2.3", "100.200.300"])
def test_versions_of_three_numbers_are_loaded(host, portal, tmp_path, version):
    ext = resolve_one(host, portal, tmp_path, version=version)
    assert (ext.state, ext.version, ext.reason) == ("ready", version, "")
