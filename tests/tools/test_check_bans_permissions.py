import hashlib
import os

import pytest


@pytest.fixture
def check(load_module):
    return load_module("tools/check.py")


@pytest.fixture
def ext(tmp_path):
    folder = tmp_path / "sample-ext"
    (folder / "src").mkdir(parents=True)
    (folder / "package" / "ui").mkdir(parents=True)
    return folder


def put(folder, rel, text):
    path = folder / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def ban_errors(check, folder):
    result = check.Result("x")
    check.check_bans(folder, result)
    return result.errors


def permission_result(check, folder, declared):
    result = check.Result("x")
    check.check_permissions(folder, {"permissions": declared}, result)
    return result


def test_walk_lists_files_sorted_and_skips_build_and_vcs_folders(check, tmp_path):
    put(tmp_path, "b.txt", "b")
    put(tmp_path, "a/z.txt", "z")
    put(tmp_path, "node_modules/pkg/index.js", "x")
    put(tmp_path, "a/dist/out.js", "x")
    put(tmp_path, ".git/config", "x")
    found = [p.relative_to(tmp_path).as_posix() for p in check.walk(tmp_path)]
    assert found == ["a/z.txt", "b.txt"]


def test_walk_skips_symlinks_and_handles_a_missing_folder(check, tmp_path):
    real = put(tmp_path, "real.js", "x")
    os.symlink(real, tmp_path / "link.js")
    assert [p.name for p in check.walk(tmp_path)] == ["real.js"]
    assert list(check.walk(tmp_path / "absent")) == []


def test_read_text_returns_text_and_refuses_binary_and_missing(check, tmp_path):
    text = put(tmp_path, "a.js", "let a = 1;\n")
    binary = tmp_path / "b.bin"
    binary.write_bytes(b"\x89PNG\0\0data")
    assert check.read_text(text) == "let a = 1;\n"
    assert check.read_text(binary) is None
    assert check.read_text(tmp_path / "absent.js") is None


def test_line_of_counts_from_one(check):
    text = "one\ntwo\nthree"
    assert check.line_of(text, 0) == 1
    assert check.line_of(text, text.index("two")) == 2
    assert check.line_of(text, text.index("three")) == 3


def test_kit_sdk_is_recognised_only_by_name_and_exact_bytes(check, repo_root, tmp_path):
    kit = (repo_root / "contract" / "sdk" / "formext.ts").read_bytes()
    exact = tmp_path / "formext.ts"
    exact.write_bytes(kit)
    renamed = tmp_path / "other.ts"
    renamed.write_bytes(kit)
    changed = tmp_path / "sub" / "formext.ts"
    changed.parent.mkdir()
    changed.write_bytes(kit + b"\nexport const extra = 1;\n")
    assert check.is_kit_sdk(exact) is True
    assert check.is_kit_sdk(renamed) is False
    assert check.is_kit_sdk(changed) is False


def test_sdk_build_hashes_are_sha256_hex_without_comment_lines(check):
    hashes = check.sdk_build_hashes()
    assert hashes
    for h in hashes:
        assert len(h) == 64
        assert set(h) <= set("0123456789abcdef")


def test_bundled_sdk_is_recognised_only_by_name_and_listed_hash(check, repo_root, tmp_path):
    shipped = (repo_root / "extensions" / "grid-overlay" / "package" / "ui" / "formext.js").read_bytes()
    assert hashlib.sha256(shipped).hexdigest() in check.sdk_build_hashes()
    exact = tmp_path / "formext.js"
    exact.write_bytes(shipped)
    renamed = tmp_path / "sdk.js"
    renamed.write_bytes(shipped)
    changed = tmp_path / "sub" / "formext.js"
    changed.parent.mkdir()
    changed.write_bytes(shipped + b"\nfetch('x');\n")
    assert check.is_bundled_sdk(exact) is True
    assert check.is_bundled_sdk(renamed) is False
    assert check.is_bundled_sdk(changed) is False


def test_method_definition_is_told_apart_from_a_call(check):
    definition = "class A {\n  fetch(url: string, init = {}) {\n    return 1;\n  }\n}"
    typed = "class A {\n  fetch(url: string): Promise<string> {\n    return x;\n  }\n}"
    call = "const r = fetch(url);\n"
    chained = "fetch(make(url)).then((r) => {\n});\n"
    assert check.is_method_definition(definition, definition.index("fetch")) is True
    assert check.is_method_definition(typed, typed.index("fetch")) is True
    assert check.is_method_definition(call, call.index("fetch")) is False
    assert check.is_method_definition(chained, chained.index("fetch")) is False


def test_code_files_take_source_and_shipped_code_but_not_the_kit_sdk(check, repo_root, ext):
    put(ext, "src/main.ts", "export {};\n")
    put(ext, "src/notes.md", "eval(")
    (ext / "src" / "formext.ts").write_bytes((repo_root / "contract" / "sdk" / "formext.ts").read_bytes())
    put(ext, "package/ui/app.js", "1;\n")
    put(ext, "package/ui/index.html", "<p></p>\n")
    put(ext, "package/manifest.json", "{}\n")
    put(ext, "package/ui/raw.ts", "1;\n")
    found = {(p.relative_to(ext).as_posix(), is_src) for p, is_src in check.code_files(ext)}
    assert found == {("src/main.ts", True), ("package/ui/app.js", False), ("package/ui/index.html", False)}


def test_clean_extension_passes_the_bans(check, ext):
    put(ext, "src/main.ts", "import { formext } from './formext';\nformext.readDocument();\n")
    put(ext, "package/ui/app.js", "const a = 1;\n")
    result = check.Result("x")
    check.check_bans(ext, result)
    assert result.errors == []
    assert len(result.passed) == 1


BANNED = [
    ("eval('1 + 1');", "eval"),
    ("const f = new Function('return 1');", "new Function"),
    ("const f = Function('return 1');", "Function"),
    ("setTimeout('go()', 10);", "setTimeout"),
    ("setInterval(\"go()\", 10);", "setInterval"),
    ("const x = new XMLHttpRequest();", "XMLHttpRequest"),
    ("const s = new WebSocket(addr);", "WebSocket"),
    ("const s = new EventSource(addr);", "EventSource"),
    ("navigator.sendBeacon(addr, body);", "sendBeacon"),
    ("fetch(addr);", "fetch"),
    ("window.fetch(addr);", "fetch"),
    ("const f = globalThis.fetch;", "fetch"),
    ("importScripts('worker.js');", "importScripts"),
    ("const m = await import('https://cdn.example.com/m.js');", "remote import"),
    ("import x from 'https://cdn.example.com/m.js';", "remote import"),
    ("import '//cdn.example.com/m.js';", "remote import"),
]


@pytest.mark.parametrize("line,word", BANNED)
def test_banned_construct_in_source_is_reported_with_its_line(check, ext, line, word):
    put(ext, "src/main.ts", "const a = 1;\nconst b = 2;\n" + line + "\n")
    errors = ban_errors(check, ext)
    assert errors
    assert all("src/main.ts:3:" in e for e in errors)
    assert any(word in e for e in errors)


def test_banned_construct_in_shipped_file_is_reported(check, ext):
    put(ext, "package/ui/app.js", "\n\n\n\neval(code);\n")
    errors = ban_errors(check, ext)
    assert len(errors) == 1
    assert "package/ui/app.js:5:" in errors[0]
    assert "eval" in errors[0]


def test_remote_script_and_remote_stylesheet_are_reported(check, ext):
    put(ext, "package/ui/index.html", "<html>\n<script src=\"https://cdn.example.com/a.js\"></script>\n</html>\n")
    put(ext, "package/ui/style.css", "body { margin: 0 }\n@import url('https://fonts.example.com/f.css');\n")
    errors = ban_errors(check, ext)
    assert len(errors) == 2
    assert any("package/ui/index.html:2:" in e and "script" in e for e in errors)
    assert any("package/ui/style.css:2:" in e and "stylesheet" in e for e in errors)


HARMLESS = [
    "const r = parser.eval(tree);",
    "const r = retrieval(tree);",
    "setTimeout(() => go(), 10);",
    "setInterval(tick, 1000);",
    "const r = await formext.fetch(addr);",
    "const prefetch = 1; prefetched(addr);",
    "class Net {\n  fetch(addr: string) {\n    return this.call(addr);\n  }\n}",
    "const m = await import('./local.js');",
    "import x from './local';",
    "const WebSockets = 2; const MyEventSourceLike = 3;",
    "const makeFunction = (a) => a; makeFunction('x');",
]


@pytest.mark.parametrize("line", HARMLESS)
def test_harmless_lookalike_in_source_is_not_flagged(check, ext, line):
    put(ext, "src/main.ts", line + "\n")
    assert ban_errors(check, ext) == []


def test_local_script_and_local_stylesheet_are_not_flagged(check, ext):
    put(ext, "package/ui/index.html", "<script src=\"./app.js\"></script>\n<script src=\"formext.js\"></script>\n")
    put(ext, "package/ui/style.css", "@import url('./base.css');\n@import 'theme.css';\n")
    assert ban_errors(check, ext) == []


def test_banned_text_outside_code_files_and_in_skipped_folders_is_ignored(check, ext):
    put(ext, "README.md", "Never call eval(x) or new WebSocket(u).\n")
    put(ext, "node_modules/lib/index.js", "eval(x);\n")
    put(ext, "src/node_modules/lib/index.js", "eval(x);\n")
    put(ext, "notes.js", "eval(x);\n")
    assert ban_errors(check, ext) == []


def test_bundled_sdk_is_still_read_by_the_bans_and_passes(check, repo_root, ext):
    shipped = (repo_root / "extensions" / "grid-overlay" / "package" / "ui" / "formext.js").read_bytes()
    (ext / "package" / "ui" / "formext.js").write_bytes(shipped)
    assert ban_errors(check, ext) == []
    (ext / "package" / "ui" / "formext.js").write_bytes(shipped + b"\neval(x);\n")
    errors = ban_errors(check, ext)
    assert len(errors) == 1
    assert "eval" in errors[0]


def test_kit_sdk_copy_in_source_is_exempt_from_the_bans(check, repo_root, ext):
    kit = (repo_root / "contract" / "sdk" / "formext.ts").read_bytes()
    (ext / "src" / "formext.ts").write_bytes(kit)
    assert ban_errors(check, ext) == []


def test_long_line_is_refused_in_source_but_not_in_shipped_files(check, ext):
    long_line = "const a = [" + ", ".join(["1"] * 400) + "];"
    assert len(long_line) > 1000
    put(ext, "package/ui/app.js", long_line + "\n")
    assert ban_errors(check, ext) == []
    put(ext, "src/main.ts", "const b = 1;\n" + long_line + "\n")
    errors = ban_errors(check, ext)
    assert len(errors) == 1
    assert "src/main.ts:2:" in errors[0]


def test_line_of_exactly_one_thousand_characters_is_allowed(check, ext):
    line = "const a = '" + "x y " * 300
    line = line[:998] + "';"
    assert len(line) == 1000
    put(ext, "src/main.ts", line + "\n")
    assert ban_errors(check, ext) == []


def test_encoded_blob_and_escape_run_in_source_are_refused(check, ext):
    blob = "QUJD" * 70
    escapes = "\\x41" * 40
    put(ext, "src/main.ts", "const a = 1;\nconst b = '" + blob + "';\nconst c = 2;\nconst d = '" + escapes + "';\n")
    errors = ban_errors(check, ext)
    assert len(errors) == 2
    assert any("src/main.ts:2:" in e and "blob" in e for e in errors)
    assert any("src/main.ts:4:" in e and "escape" in e for e in errors)


def test_short_encoded_text_and_few_escapes_are_allowed(check, ext):
    put(ext, "src/main.ts", "const a = '" + "QUJD" * 20 + "';\nconst b = '\\x41\\x42\\u0043';\n")
    assert ban_errors(check, ext) == []


def test_secrets_are_refused_anywhere_in_the_folder(check, ext):
    aws = "AKIA" + "ABCDEFGHIJKLMNOP"
    pem = "-----BEGIN " + "RSA PRIVATE KEY-----"
    credential = "api_key = '" + "a1B2" * 8 + "'"
    put(ext, "README.md", "intro\n\nkey " + aws + " here\n")
    put(ext, "docs/key.txt", pem + "\nabc\n")
    put(ext, "src/config.ts", "const a = 1;\nconst " + credential + ";\n")
    errors = ban_errors(check, ext)
    assert len(errors) == 3
    assert any(e.startswith("4 code bans") and "README.md:3:" in e and "AWS" in e for e in errors)
    assert any("docs/key.txt:1:" in e and "private key" in e for e in errors)
    assert any("src/config.ts:2:" in e and "credential" in e for e in errors)


def test_words_that_only_resemble_secrets_are_allowed(check, ext):
    put(ext, "README.md", "Set your password in the app. AKIA is a prefix. apiKey: 'short'\n")
    put(ext, "src/main.ts", "const password = prompt.value;\nconst secret: string = read();\n")
    assert ban_errors(check, ext) == []


def test_used_permissions_come_from_sdk_calls_in_source(check, ext):
    put(
        ext,
        "src/main.ts",
        "import { formext } from './formext';\n"
        "const doc = await formext.readDocument();\n"
        "const files = await formext.openFiles({ multiple: true });\n",
    )
    used, notes = check.used_permissions(ext)
    assert used == {"document", "files-read"}
    assert notes == []


@pytest.mark.parametrize(
    "call,permission",
    [
        ("formext.readDocument()", "document"),
        ("formext.apply(ops)", "document"),
        ("formext.commands()", "document"),
        ("formext.run('zoom')", "document"),
        ("formext.openFiles()", "files-read"),
        ("formext.saveFile(name, data)", "files-write"),
        ("formext.fetch(addr)", "network"),
        ("formext.fetch<Reply>(addr)", "network"),
        ("formext?.saveFile(name, data)", "files-write"),
        ("host.call('net.fetch', { url })", "network"),
        ("host.call(\"files.save\", body)", "files-write"),
    ],
)
def test_each_sdk_call_maps_to_its_permission(check, ext, call, permission):
    put(ext, "src/main.ts", "await " + call + ";\n")
    used, _ = check.used_permissions(ext)
    assert used == {permission}


def test_renamed_sdk_receivers_are_followed(check, ext):
    put(ext, "src/a.ts", "import { formext as fx } from './formext';\nfx.saveFile('a', b);\n")
    put(ext, "src/b.ts", "function go(api: FormExt) {\n  return api.openFiles();\n}\n")
    put(ext, "src/c.ts", "const sdk = new FormExt();\nsdk.readDocument();\n")
    used, _ = check.used_permissions(ext)
    assert used == {"files-write", "files-read", "document"}


def test_same_method_names_on_other_objects_are_not_permissions(check, ext):
    put(
        ext,
        "src/main.ts",
        "queue.run();\nstore.apply(patch);\ncache.fetch(key);\nmyformext.saveFile(a);\n"
        "const label = formext.version;\nfunction openFiles() {}\nopenFiles();\n",
    )
    used, _ = check.used_permissions(ext)
    assert used == set()


def test_kit_sdk_copy_in_source_does_not_count_as_use(check, repo_root, ext):
    (ext / "src" / "formext.ts").write_bytes((repo_root / "contract" / "sdk" / "formext.ts").read_bytes())
    put(ext, "src/main.ts", "import { formext } from './formext';\nformext.readDocument();\n")
    used, _ = check.used_permissions(ext)
    assert used == {"document"}


def test_changed_sdk_copy_in_source_is_read_like_any_source(check, repo_root, ext):
    kit = (repo_root / "contract" / "sdk" / "formext.ts").read_bytes()
    (ext / "src" / "formext.ts").write_bytes(kit + b"\nexport const extra = 1;\n")
    used, _ = check.used_permissions(ext)
    assert "network" in used


def test_shipped_files_are_read_when_there_is_no_source_and_bundled_sdk_is_exempt(check, repo_root, ext):
    (ext / "src").rmdir()
    shipped = (repo_root / "extensions" / "grid-overlay" / "package" / "ui" / "formext.js").read_bytes()
    (ext / "package" / "ui" / "formext.js").write_bytes(shipped)
    put(ext, "package/ui/app.js", "formext.saveFile('a.txt', 'x');\n")
    used, notes = check.used_permissions(ext)
    assert used == {"files-write"}
    assert len(notes) == 1
    assert "src" in notes[0]


def test_shipped_files_are_not_read_for_permissions_when_source_exists(check, ext):
    put(ext, "src/main.ts", "formext.readDocument();\n")
    put(ext, "package/ui/app.js", "formext.fetch(addr);\n")
    used, notes = check.used_permissions(ext)
    assert used == {"document"}
    assert notes == []


def test_matching_permissions_pass(check, ext):
    put(ext, "src/main.ts", "formext.readDocument();\nformext.fetch(addr);\n")
    result = permission_result(check, ext, ["network", "document"])
    assert result.errors == []
    assert len(result.passed) == 1


def test_no_permissions_declared_and_none_used_pass(check, ext):
    put(ext, "src/main.ts", "const a = 1;\n")
    assert permission_result(check, ext, []).errors == []
    result = check.Result("x")
    check.check_permissions(ext, {}, result)
    assert result.errors == []


def test_permission_used_but_not_declared_is_an_error(check, ext):
    put(ext, "src/main.ts", "formext.readDocument();\nformext.saveFile('a', b);\n")
    result = permission_result(check, ext, ["document"])
    assert len(result.errors) == 1
    assert "files-write" in result.errors[0]
    assert "does not declare" in result.errors[0]
    assert result.passed == []


def test_permission_declared_but_not_used_is_an_error(check, ext):
    put(ext, "src/main.ts", "formext.readDocument();\n")
    result = permission_result(check, ext, ["document", "network"])
    assert len(result.errors) == 1
    assert "network" in result.errors[0]
    assert "never uses" in result.errors[0]


def test_both_kinds_of_permission_mismatch_are_reported_together(check, ext):
    put(ext, "src/main.ts", "formext.openFiles();\n")
    result = permission_result(check, ext, ["files-write"])
    assert len(result.errors) == 2
    assert any("files-read" in e and "does not declare" in e for e in result.errors)
    assert any("files-write" in e and "never uses" in e for e in result.errors)


def test_permission_check_notes_when_only_shipped_files_were_read(check, ext):
    (ext / "src").rmdir()
    put(ext, "package/ui/app.js", "formext.openFiles();\n")
    result = permission_result(check, ext, ["files-read"])
    assert result.errors == []
    assert len(result.notes) == 1
    assert result.notes[0].startswith("sample-ext:")


@pytest.mark.xfail(strict=True, reason="defect: an SDK method destructured from formext and then called is not counted as a used permission")
def test_destructured_sdk_method_still_counts_as_use(check, ext):
    put(ext, "src/main.ts", "import { formext } from './formext';\nconst { saveFile } = formext;\nsaveFile('a.txt', 'x');\n")
    used, _ = check.used_permissions(ext)
    assert used == {"files-write"}


@pytest.mark.xfail(strict=True, reason="defect: a banned word that only appears in a comment is reported as a code ban")
def test_banned_word_inside_a_comment_is_not_flagged(check, ext):
    put(ext, "src/main.ts", "// we never use WebSocket here\nconst a = 1;\n")
    assert ban_errors(check, ext) == []
