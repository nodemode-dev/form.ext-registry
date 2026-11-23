import json
import shutil

import pytest

MISSING = object()
DEFECT_TYPES = "defect: problems() does not check the string types and lengths package.schema.json requires"
DEFECT_ENTRY = "defect: problems() accepts an entry.ui that the relpath pattern of package.schema.json forbids"
DEFECT_CONTRIBUTES = "defect: problems() does not apply the contributes limits of package.schema.json"


def defect(value, reason):
    return pytest.param(value, marks=pytest.mark.xfail(strict=True, reason=reason))


@pytest.fixture
def formpkg(load_module):
    return load_module("contract/tools/formpkg.py")


@pytest.fixture
def package(tmp_path, repo_root):
    folder = tmp_path / "pkg"
    shutil.copytree(repo_root / "contract" / "examples" / "hello", folder)
    return folder


def read_manifest(folder):
    return json.loads((folder / "manifest.json").read_text(encoding="utf-8"))


def write_manifest(folder, manifest):
    (folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def change(folder, key, value):
    manifest = read_manifest(folder)
    if value is MISSING:
        manifest.pop(key, None)
    else:
        manifest[key] = value
    write_manifest(folder, manifest)


def reported(formpkg, folder, word):
    found, _ = formpkg.problems(folder)
    assert found, "the broken rule was not reported"
    assert all(isinstance(p, str) for p in found)
    assert all(word in p for p in found), found
    return found


def test_hello_example_has_no_problems(formpkg, package):
    found, manifest = formpkg.problems(package)
    assert found == []
    assert manifest == read_manifest(package)


def test_hello_example_in_the_repo_has_no_problems(formpkg, repo_root):
    found, manifest = formpkg.problems(repo_root / "contract" / "examples" / "hello")
    assert found == []
    assert manifest["id"] == "hello-formext"


def test_missing_manifest_is_reported(formpkg, package):
    (package / "manifest.json").unlink()
    found, manifest = formpkg.problems(package)
    assert len(found) == 1
    assert "manifest.json" in found[0]
    assert manifest == {}


def test_invalid_json_is_reported(formpkg, package):
    (package / "manifest.json").write_text("{ not json", encoding="utf-8")
    found, manifest = formpkg.problems(package)
    assert len(found) == 1
    assert "manifest.json" in found[0]
    assert manifest == {}


def test_manifest_that_is_not_utf8_is_reported(formpkg, package):
    (package / "manifest.json").write_bytes(b'{"id": "\xff\xfe"}')
    found, manifest = formpkg.problems(package)
    assert len(found) == 1
    assert manifest == {}


@pytest.mark.xfail(strict=True, reason="defect: problems() raises on a manifest that is valid JSON but not an object, instead of reporting it")
@pytest.mark.parametrize("text", ["[]", '"formai-package"', "1", "null"])
def test_manifest_that_is_not_an_object_is_reported(formpkg, package, text):
    (package / "manifest.json").write_text(text, encoding="utf-8")
    found, _ = formpkg.problems(package)
    assert found


@pytest.mark.parametrize(
    "key",
    ["format", "format_version", "id", "name", "product", "kind", "version", "author", "licence", "native", "permissions"],
)
def test_each_required_field_missing_is_reported(formpkg, package, key):
    change(package, key, MISSING)
    reported(formpkg, package, key)


@pytest.mark.parametrize("value", ["formai-extensions", "", None, 1])
def test_wrong_format_is_reported(formpkg, package, value):
    change(package, "format", value)
    reported(formpkg, package, "format")


@pytest.mark.parametrize("value", [2, 0, "1", True, None])
def test_wrong_format_version_is_reported(formpkg, package, value):
    change(package, "format_version", value)
    reported(formpkg, package, "format_version")


@pytest.mark.parametrize("value", [MISSING, "2", "1.0", "", 1, None, True, ["1"]])
def test_wrong_api_is_reported(formpkg, package, value):
    change(package, "api", value)
    reported(formpkg, package, "api")


@pytest.mark.parametrize(
    "value",
    [
        "Hello-Formext",
        "hello formext",
        "hello-formext\n",
        "hello\\formext",
        "../hello",
        "hello/formext",
        "..",
        "-hello",
        "hello_formext",
        "hello.formext",
        "h",
        "",
        "a" * 65,
        None,
        ["hello-formext"],
    ],
)
def test_bad_id_is_reported(formpkg, package, value):
    change(package, "id", value)
    reported(formpkg, package, "id")


@pytest.mark.parametrize("value", ["ab", "a" * 64, "0-9", "a--"])
def test_id_at_the_edges_of_the_pattern_is_accepted(formpkg, package, value):
    change(package, "id", value)
    assert formpkg.problems(package)[0] == []


@pytest.mark.xfail(strict=True, reason="defect: problems() accepts a numeric id; package.schema.json requires a string")
def test_id_that_is_a_number_is_reported(formpkg, package):
    change(package, "id", 123)
    reported(formpkg, package, "id")


@pytest.mark.parametrize(
    "value",
    ["1.0", "1", "1.0.0.0", "1.0.0\n", "v1.0.0", "1.0.0-beta", "1.0.x", " 1.0.0", "1..0", "", "../1.0.0", "1.0.0/x", "1.0.0\\x", 1, 1.5, None],
)
def test_bad_version_is_reported(formpkg, package, value):
    change(package, "version", value)
    reported(formpkg, package, "version")


@pytest.mark.parametrize("value", ["0.0.0", "10.20.30", "2026.11.23"])
def test_three_number_version_is_accepted(formpkg, package, value):
    change(package, "version", value)
    assert formpkg.problems(package)[0] == []


@pytest.mark.parametrize("value", ["2.14", "2.14.0\n", "latest", "2.14.0-rc1", ""])
def test_bad_minimum_app_is_reported(formpkg, package, value):
    change(package, "minimum_app", value)
    reported(formpkg, package, "minimum_app")


def test_good_minimum_app_is_accepted(formpkg, package):
    change(package, "minimum_app", "2.14.0")
    assert formpkg.problems(package)[0] == []


@pytest.mark.parametrize("value", ["formhub", "FormVis", "", None, ["formvis"]])
def test_unknown_product_is_reported(formpkg, package, value):
    change(package, "product", value)
    reported(formpkg, package, "product")


@pytest.mark.parametrize("value", ["plugin", "Script-Plugin", "", None])
def test_unknown_kind_is_reported(formpkg, package, value):
    change(package, "kind", value)
    reported(formpkg, package, "kind")


def test_native_true_is_reported(formpkg, package):
    change(package, "native", True)
    reported(formpkg, package, "native")


@pytest.mark.parametrize("value", ["false", 0, None, []])
def test_native_that_is_not_a_boolean_is_reported(formpkg, package, value):
    change(package, "native", value)
    reported(formpkg, package, "native")


@pytest.mark.parametrize(
    "value",
    [["camera"], ["document", "everything"], ["Document"], ["document "], [1], [None], [["document"]], [{"name": "document"}]],
)
def test_unknown_permission_is_reported(formpkg, package, value):
    change(package, "permissions", value)
    reported(formpkg, package, "permissions")


def test_repeated_permission_is_reported(formpkg, package):
    change(package, "permissions", ["document", "network", "document"])
    reported(formpkg, package, "permissions")


@pytest.mark.parametrize("value", ["document", {"document": True}, None, 1, True])
def test_permissions_that_are_not_a_list_are_reported(formpkg, package, value):
    change(package, "permissions", value)
    reported(formpkg, package, "permissions")


def test_every_known_permission_and_none_are_accepted(formpkg, package):
    change(package, "permissions", ["document", "files-read", "files-write", "network", "models", "native-code"])
    assert formpkg.problems(package)[0] == []
    change(package, "permissions", [])
    assert formpkg.problems(package)[0] == []


@pytest.mark.parametrize("key", ["name", "author", "licence"])
@pytest.mark.parametrize("value", ["", 7, None, ["x"]])
@pytest.mark.xfail(strict=True, reason=DEFECT_TYPES)
def test_name_author_and_licence_must_be_non_empty_strings(formpkg, package, key, value):
    change(package, key, value)
    reported(formpkg, package, key)


@pytest.mark.parametrize(
    "key, value",
    [("description", "x" * 401), ("description", 5), ("homepage", "http://example.com"), ("support", "mailto:a@example.com"), ("payload", "")],
)
@pytest.mark.xfail(strict=True, reason=DEFECT_TYPES)
def test_optional_text_fields_must_meet_the_schema(formpkg, package, key, value):
    change(package, key, value)
    reported(formpkg, package, key)


def test_entry_ui_missing_with_contributions_is_reported(formpkg, package):
    change(package, "entry", {})
    reported(formpkg, package, "entry.ui")


def test_entry_missing_with_contributions_is_reported(formpkg, package):
    change(package, "entry", MISSING)
    reported(formpkg, package, "entry.ui")


def test_entry_ui_missing_with_only_a_command_is_reported(formpkg, package):
    change(package, "entry", MISSING)
    change(package, "contributes", {"commands": [{"id": "say-hello", "title": "Say Hello"}]})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_empty_with_contributions_is_reported(formpkg, package):
    change(package, "entry", {"ui": ""})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_absolute_is_reported(formpkg, package):
    change(package, "entry", {"ui": "/ui/index.html"})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_absolute_path_of_the_real_file_is_reported(formpkg, package):
    change(package, "entry", {"ui": (package / "ui" / "index.html").as_posix()})
    reported(formpkg, package, "entry.ui")


@pytest.mark.parametrize("value", ["ui\\index.html", "\\ui\\index.html", "C:\\ui\\index.html"])
def test_entry_ui_with_a_backslash_is_reported(formpkg, package, value):
    change(package, "entry", {"ui": value})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_with_a_backslash_is_reported_even_when_such_a_file_exists(formpkg, package):
    (package / "ui\\index.html").write_text("<!doctype html>", encoding="utf-8")
    change(package, "entry", {"ui": "ui\\index.html"})
    reported(formpkg, package, "entry.ui")


@pytest.mark.parametrize("value", ["../pkg/ui/index.html", "ui/../ui/index.html", "..", "ui/..", "../../etc/passwd"])
def test_entry_ui_with_dot_dot_is_reported(formpkg, package, value):
    change(package, "entry", {"ui": value})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_that_reaches_a_file_outside_the_package_is_reported(formpkg, package):
    (package.parent / "outside.html").write_text("<!doctype html>", encoding="utf-8")
    change(package, "entry", {"ui": "../outside.html"})
    reported(formpkg, package, "entry.ui")


@pytest.mark.parametrize("value", ["ui/missing.html", "index.html", "ui", "ui/", ".", "ui/index.html\n", "ui/index.html/"])
def test_entry_ui_that_is_not_a_file_of_the_package_is_reported(formpkg, package, value):
    change(package, "entry", {"ui": value})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_of_a_file_type_the_package_may_not_hold_is_reported(formpkg, package):
    (package / "ui" / "index.php").write_text("<!doctype html>", encoding="utf-8")
    change(package, "entry", {"ui": "ui/index.php"})
    reported(formpkg, package, "entry.ui")


def test_entry_ui_that_is_a_symlink_is_reported(formpkg, package):
    (package / "ui" / "link.html").symlink_to(package / "ui" / "index.html")
    change(package, "entry", {"ui": "ui/link.html"})
    reported(formpkg, package, "entry.ui")


@pytest.mark.parametrize("value", [1, True, ["ui/index.html"], {"path": "ui/index.html"}])
def test_entry_ui_that_is_not_a_string_is_reported(formpkg, package, value):
    change(package, "entry", {"ui": value})
    reported(formpkg, package, "entry")


@pytest.mark.parametrize("value", ["ui/index.html", ["ui/index.html"], 1])
def test_entry_that_is_not_an_object_is_reported(formpkg, package, value):
    change(package, "entry", value)
    reported(formpkg, package, "entry")


def test_entry_ui_pointing_at_another_real_file_is_accepted(formpkg, package):
    (package / "panel.html").write_text("<!doctype html>", encoding="utf-8")
    change(package, "entry", {"ui": "panel.html"})
    assert formpkg.problems(package)[0] == []


@pytest.mark.xfail(strict=True, reason=DEFECT_ENTRY)
def test_entry_ui_with_a_character_outside_the_pattern_is_reported(formpkg, package):
    (package / "ui" / "my page.html").write_text("<!doctype html>", encoding="utf-8")
    change(package, "entry", {"ui": "ui/my page.html"})
    reported(formpkg, package, "entry.ui")


@pytest.mark.xfail(strict=True, reason=DEFECT_ENTRY)
def test_entry_ui_empty_without_contributions_is_reported(formpkg, package):
    change(package, "contributes", MISSING)
    change(package, "entry", {"ui": ""})
    reported(formpkg, package, "entry.ui")


@pytest.mark.xfail(strict=True, reason="defect: problems() accepts unknown keys in entry; package.schema.json sets additionalProperties false")
def test_entry_with_an_unknown_key_is_reported(formpkg, package):
    change(package, "entry", {"ui": "ui/index.html", "worker": "ui/hello.js"})
    reported(formpkg, package, "entry")


@pytest.mark.parametrize("value", ["Main", "main panel", "-main", "", "a" * 33, "main\n", None])
def test_bad_panel_id_is_reported(formpkg, package, value):
    change(package, "contributes", {"panels": [{"id": value, "title": "Hello"}]})
    reported(formpkg, package, "contributes.panels")


@pytest.mark.parametrize("value", ["Say-Hello", "say hello", "say/hello", "say-hello\n", "a" * 33])
def test_bad_command_id_is_reported(formpkg, package, value):
    change(package, "contributes", {"commands": [{"id": value, "title": "Say Hello"}]})
    reported(formpkg, package, "contributes.commands")


@pytest.mark.parametrize("group", ["panels", "commands"])
@pytest.mark.parametrize("item", [{"id": "main"}, {"id": "main", "title": ""}])
def test_contribution_without_a_title_is_reported(formpkg, package, group, item):
    change(package, "contributes", {group: [item]})
    reported(formpkg, package, "title")


def test_command_naming_a_panel_that_is_not_contributed_is_reported(formpkg, package):
    change(
        package,
        "contributes",
        {"panels": [{"id": "main", "title": "Hello"}], "commands": [{"id": "say-hello", "title": "Say Hello", "panel": "other"}]},
    )
    reported(formpkg, package, "panel")


def test_command_naming_a_contributed_panel_is_accepted(formpkg, package):
    change(
        package,
        "contributes",
        {"panels": [{"id": "main", "title": "Hello"}], "commands": [{"id": "say-hello", "title": "Say Hello", "panel": "main"}]},
    )
    assert formpkg.problems(package)[0] == []


@pytest.mark.parametrize("value", ["panels", ["main"], 1])
def test_contributes_that_is_not_an_object_is_reported(formpkg, package, value):
    change(package, "contributes", value)
    reported(formpkg, package, "contributes")


@pytest.mark.parametrize("group", ["panels", "commands"])
@pytest.mark.parametrize("value", [{"id": "main", "title": "Hello"}, ["main"], "main", [None]])
def test_contribution_group_that_is_not_a_list_of_objects_is_reported(formpkg, package, group, value):
    change(package, "contributes", {group: value})
    reported(formpkg, package, f"contributes.{group}")


@pytest.mark.parametrize(
    "value",
    [
        defect({"panels": [{"id": "main", "title": "Hello", "location": "floating"}]}, DEFECT_CONTRIBUTES),
        defect({"panels": [{"id": "main", "title": "x" * 61}]}, DEFECT_CONTRIBUTES),
        defect({"panels": [{"id": f"p{i}", "title": "Hello"} for i in range(9)]}, DEFECT_CONTRIBUTES),
        defect({"commands": [{"id": f"c{i}", "title": "Hello"} for i in range(33)]}, DEFECT_CONTRIBUTES),
        defect({"commands": [{"id": "say-hello", "title": "x" * 81}]}, DEFECT_CONTRIBUTES),
        defect({"panels": [{"id": "main", "title": "Hello", "icon": "x"}]}, DEFECT_CONTRIBUTES),
        defect({"menus": []}, DEFECT_CONTRIBUTES),
    ],
)
def test_contributes_beyond_the_schema_limits_is_reported(formpkg, package, value):
    change(package, "contributes", value)
    reported(formpkg, package, "contributes")


def test_package_without_entry_or_contributes_is_accepted(formpkg, package):
    change(package, "entry", MISSING)
    change(package, "contributes", MISSING)
    assert formpkg.problems(package)[0] == []


def test_unknown_top_level_field_is_accepted(formpkg, package):
    change(package, "keywords", ["hello"])
    assert formpkg.problems(package)[0] == []


def test_several_broken_rules_are_all_reported(formpkg, package):
    manifest = read_manifest(package)
    manifest["id"] = "Bad Id"
    manifest["version"] = "1.0"
    manifest["api"] = "2"
    manifest["permissions"] = ["camera"]
    write_manifest(package, manifest)
    found, _ = formpkg.problems(package)
    assert len(found) == 4
    for word in ("id", "version", "api", "permissions"):
        assert any(word in p for p in found), (word, found)
