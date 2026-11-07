from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import registry  # noqa: E402
from registry import formpkg  # noqa: E402

CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".html", ".htm", ".css"}
SHIPPED_CODE_EXT = {".js", ".mjs", ".html", ".htm", ".css"}
TEXT_EXT = CODE_EXT | {".json", ".md", ".txt", ".svg", ".yml", ".yaml", ".toml", ".py", ".sh", ".env", ".ini", ".cfg", ""}
SKIP_DIRS = {"node_modules", "dist", ".git"}
IMAGE_EXT = {".png", ".webp", ".jpg", ".jpeg", ".gif"}

SDK_METHODS = {
    "readDocument": "document",
    "apply": "document",
    "commands": "document",
    "run": "document",
    "openFiles": "files-read",
    "saveFile": "files-write",
    "fetch": "network",
}
RPC_METHODS = {
    "document.read": "document",
    "document.apply": "document",
    "app.commands": "document",
    "app.run": "document",
    "files.open": "files-read",
    "files.save": "files-write",
    "net.fetch": "network",
}
RPC_LITERAL = re.compile(r"""['"`](%s)['"`]""" % "|".join(re.escape(m) for m in RPC_METHODS))

BANS = [
    (re.compile(r"(?<![\w$.])eval\s*\("), "eval"),
    (re.compile(r"\bnew\s+Function\s*\("), "new Function"),
    (re.compile(r"(?<![\w$.])Function\s*\(\s*['\"`]"), "Function(string)"),
    (re.compile(r"\bset(?:Timeout|Interval)\s*\(\s*['\"`]"), "setTimeout or setInterval with a string"),
    (re.compile(r"\bXMLHttpRequest\b"), "XMLHttpRequest"),
    (re.compile(r"\bWebSocket\b"), "WebSocket"),
    (re.compile(r"\bEventSource\b"), "EventSource"),
    (re.compile(r"\bsendBeacon\b"), "sendBeacon"),
    (re.compile(r"\b(?:window|globalThis|self|top|parent)\s*\.\s*fetch\b"), "fetch outside the SDK's net.fetch"),
    (re.compile(r"\bimportScripts\s*\("), "importScripts"),
    (re.compile(r"""<script\b[^>]*\bsrc\s*=\s*['"]?\s*(?:https?:)?//""", re.I), "a remote <script src>"),
    (re.compile(r"""\bimport\s*\(\s*['"`]\s*(?:https?:)?//""", re.I), "a remote import"),
    (re.compile(r"""\b(?:import|from)\s*['"`]\s*(?:https?:)?//""", re.I), "a remote import"),
    (re.compile(r"""@import\s+(?:url\(\s*)?['"]?\s*(?:https?:)?//""", re.I), "a remote stylesheet import"),
]
BARE_FETCH = re.compile(r"(?<![\w$.])fetch\s*\(")
SECRETS = [
    (re.compile(r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----"), "a private key"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"), "a GitHub token"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{60,}\b"), "a GitHub token"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}"), "an Anthropic API key"),
    (re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b"), "an OpenAI API key"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "a Google API key"),
    (re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}"), "a Slack token"),
    (re.compile(r"\b[rs]k_live_[A-Za-z0-9]{20,}\b"), "a Stripe key"),
    (re.compile(r"\bhf_[A-Za-z0-9]{34,}\b"), "a Hugging Face token"),
    (re.compile(r"""(?i)\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*['"][A-Za-z0-9+/_=-]{24,}['"]"""), "a hard-coded credential"),
]
LONG_LINE = 1000
BLOB = re.compile(r"[A-Za-z0-9+/]{256,}={0,2}")
ESCAPES = re.compile(r"(?:\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}){32,}")


@dataclass
class Result:
    name: str
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    passed: list[str] = field(default_factory=list)

    def check(self, title: str, problems: list[str]) -> None:
        if problems:
            self.errors.extend(f"{title}: {p}" for p in problems)
        else:
            self.passed.append(title)


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(registry.ROOT), *args], capture_output=True, text=True)


def walk(folder: Path):
    if not folder.is_dir():
        return
    for p in sorted(folder.rglob("*")):
        rel = p.relative_to(folder).parts
        if any(part in SKIP_DIRS for part in rel) or p.is_symlink() or not p.is_file():
            continue
        yield p


def read_text(path: Path) -> str | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if b"\0" in data[:8192]:
        return None
    return data.decode("utf-8", errors="replace")


def is_kit_sdk(path: Path) -> bool:
    return path.name == "formext.ts" and registry.KIT_SDK.is_file() and path.read_bytes() == registry.KIT_SDK.read_bytes()


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def is_method_definition(text: str, start: int) -> bool:
    depth = 0
    i = text.index("(", start)
    while i < len(text):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                rest = text[i + 1 : i + 200].lstrip()
                return rest.startswith("{") or re.match(r"^:\s*[\w<>\[\]{}|&,.\s'\"]+\{", rest) is not None
        i += 1
    return False


def published_index(source: str | None, result: Result) -> dict | None:
    source = source or os.environ.get("FORMEXT_PUBLISHED_INDEX") or registry.INDEX_URL
    try:
        if source.startswith(("https://", "http://")):
            with urllib.request.urlopen(source, timeout=15) as r:
                return json.loads(r.read())
        return json.loads(Path(source).read_text(encoding="utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        first = f"{source} ({e})"
    if source == registry.INDEX_URL and shutil.which("gh"):
        out = subprocess.run(["gh", "release", "download", "index", "-R", registry.REPO, "-p", "extensions.json", "-O", "-"], capture_output=True)
        if out.returncode == 0:
            try:
                return json.loads(out.stdout)
            except ValueError:
                pass
    result.notes.append(f"the published index is not reachable: {first}; immutability is checked against the base commit only")
    return None


def build_sha(package: Path) -> tuple[str | None, list[str]]:
    with tempfile.TemporaryDirectory(prefix="formext-check-") as tmp:
        try:
            _, digest, _, _ = formpkg.build(package, Path(tmp))
        except SystemExit as e:
            return None, [str(e)]
    return digest, []


def base_build(base: str | None, ext_id: str) -> tuple[str | None, str | None]:
    if not base:
        return None, None
    listed = git("ls-tree", "-r", "--name-only", base, f"extensions/{ext_id}/package")
    if listed.returncode != 0 or not listed.stdout.strip():
        return None, None
    with tempfile.TemporaryDirectory(prefix="formext-base-") as tmp:
        root = Path(tmp) / "package"
        for rel in listed.stdout.split("\n"):
            if not rel:
                continue
            blob = subprocess.run(["git", "-C", str(registry.ROOT), "show", f"{base}:{rel}"], capture_output=True)
            if blob.returncode != 0:
                return None, None
            target = root / Path(rel).relative_to(f"extensions/{ext_id}/package")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(blob.stdout)
        try:
            version = json.loads((root / "manifest.json").read_text(encoding="utf-8")).get("version")
        except (OSError, ValueError):
            return None, None
        digest, errs = build_sha(root)
        return (version if not errs else None), digest


def check_contract(folder: Path, result: Result) -> dict:
    package = folder / "package"
    if not (package / "manifest.json").is_file():
        result.check("1 contract", ["package/manifest.json is missing"])
        return {}
    errs, manifest = formpkg.problems(package)
    errs += formpkg.files_of(package)[1]
    if manifest:
        if manifest.get("id") != folder.name:
            errs.append(f"the folder is extensions/{folder.name} but the manifest id is {manifest.get('id')!r}")
        if manifest.get("product") not in registry.HOST_PRODUCTS:
            errs.append(f"product {manifest.get('product')!r} is not a host app")
        if manifest.get("api") != "1":
            errs.append('api must be "1"')
        if manifest.get("native") is not False:
            errs.append("native must be false")
    result.check("1 contract (formpkg validate, id, product, api, native)", errs)
    return manifest


def check_version(folder: Path, manifest: dict, published: dict | None, base: str | None, changed: bool, digest: str | None, result: Result) -> None:
    errs: list[str] = []
    ext_id, version = manifest.get("id", folder.name), str(manifest.get("version", ""))
    if not formpkg.VERSION_RE.match(version):
        result.check("2 version", ["version must be x.y.z"])
        return
    newest = None
    if published is not None:
        for e in published.get("packages") or []:
            if e.get("id") == ext_id and formpkg.VERSION_RE.match(str(e.get("version", ""))):
                if newest is None or registry.version_key(e["version"]) > registry.version_key(newest["version"]):
                    newest = e
    if newest is not None:
        pv = newest["version"]
        if registry.version_key(version) < registry.version_key(pv):
            errs.append(f"{version} is below the published {pv}")
        elif version == pv:
            if digest and newest.get("sha256") != digest:
                errs.append(f"{version} is published with SHA-256 {newest.get('sha256')}, but this folder builds {digest}: a published version's bytes never change, so raise the version")
            elif changed:
                errs.append(f"the extension changed, so its version must rise above the published {pv}")
    base_version, base_digest = base_build(base, ext_id)
    if base_version is not None:
        if registry.version_key(version) < registry.version_key(base_version):
            errs.append(f"{version} is below {base_version} on {base}")
        elif version == base_version:
            if digest and base_digest and digest != base_digest:
                errs.append(f"package/ builds different bytes from {base} under the same version {version}: raise the version")
            elif changed and newest is None:
                errs.append(f"the extension changed, so its version must rise above {base_version} on {base}")
    elif base:
        result.notes.append(f"{ext_id} is new against {base}; any x.y.z may start it")
    result.check("2 version and immutability", errs)


def npm_reproduces(folder: Path, result: Result) -> list[str]:
    if not (folder / "package.json").is_file():
        return []
    if not (folder / "package-lock.json").is_file():
        return ["package.json has no package-lock.json beside it, so npm ci cannot reproduce the build"]
    npm = shutil.which("npm")
    if not npm:
        return ["npm is not installed, so the build from src/ cannot be reproduced"]
    errs: list[str] = []
    with tempfile.TemporaryDirectory(prefix="formext-npm-") as tmp:
        work = Path(tmp) / folder.name
        shutil.copytree(folder, work, ignore=shutil.ignore_patterns(*SKIP_DIRS))
        env = {**os.environ, "npm_config_fund": "false", "npm_config_audit": "false", "npm_config_update_notifier": "false"}
        for cmd in (["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], ["npm", "run", "build"]):
            out = subprocess.run(cmd, cwd=work, capture_output=True, text=True, env=env)
            if out.returncode != 0:
                tail = (out.stderr or out.stdout).strip().splitlines()[-6:]
                return [f"`{' '.join(cmd[:3])}` failed: " + " | ".join(tail)]
        before = {p.relative_to(folder / "package").as_posix(): p for p in walk(folder / "package")}
        after = {p.relative_to(work / "package").as_posix(): p for p in walk(work / "package")}
        for rel in sorted(set(before) | set(after)):
            if rel not in after:
                errs.append(f"package/{rel} is committed but the build does not make it")
            elif rel not in before:
                errs.append(f"the build makes package/{rel}, which is not committed")
            elif before[rel].read_bytes() != after[rel].read_bytes():
                errs.append(f"package/{rel} differs from what `npm ci && npm run build` makes")
    if not errs:
        result.notes.append(f"{folder.name}: npm ci && npm run build reproduced package/ byte for byte")
    return errs


def check_reproducible(folder: Path, skip_npm: bool, result: Result) -> str | None:
    package = folder / "package"
    first, errs = build_sha(package)
    second, errs2 = build_sha(package)
    errs += errs2
    if first and second and first != second:
        errs.append(f"two builds of package/ gave {first} and {second}")
    if skip_npm:
        result.notes.append(f"{folder.name}: the npm rebuild was skipped (--skip-npm)")
    else:
        errs += npm_reproduces(folder, result)
    result.check("3 reproducible", errs)
    return first if first == second else None


def code_files(folder: Path) -> list[tuple[Path, bool]]:
    out: list[tuple[Path, bool]] = []
    for p in walk(folder / "src"):
        if p.suffix.lower() in CODE_EXT and not is_kit_sdk(p):
            out.append((p, True))
    for p in walk(folder / "package"):
        if p.suffix.lower() in SHIPPED_CODE_EXT:
            out.append((p, False))
    return out


def check_bans(folder: Path, result: Result) -> None:
    errs: list[str] = []
    for path, is_src in code_files(folder):
        text = read_text(path)
        if text is None:
            continue
        rel = path.relative_to(folder).as_posix()
        for pattern, what in BANS:
            for m in pattern.finditer(text):
                errs.append(f"{rel}:{line_of(text, m.start())}: {what}")
        for m in BARE_FETCH.finditer(text):
            if not is_method_definition(text, m.start()):
                errs.append(f"{rel}:{line_of(text, m.start())}: fetch outside the SDK's net.fetch")
        if is_src:
            for n, line in enumerate(text.splitlines(), 1):
                if len(line) > LONG_LINE:
                    errs.append(f"{rel}:{n}: a {len(line)}-character line in src/ (minified or obfuscated source is refused)")
            for m in BLOB.finditer(text):
                errs.append(f"{rel}:{line_of(text, m.start())}: an encoded blob of {len(m.group(0))} characters in src/")
            for m in ESCAPES.finditer(text):
                errs.append(f"{rel}:{line_of(text, m.start())}: a run of escaped characters in src/")
    for path in walk(folder):
        if path.suffix.lower() not in TEXT_EXT:
            continue
        text = read_text(path)
        if text is None:
            continue
        for pattern, what in SECRETS:
            for m in pattern.finditer(text):
                errs.append(f"{path.relative_to(folder).as_posix()}:{line_of(text, m.start())}: looks like {what}")
    result.check("4 code bans (eval, network, remote code, obfuscation, secrets)", errs)


def used_permissions(folder: Path) -> tuple[set[str], list[str]]:
    used: set[str] = set()
    where: list[str] = []
    sources = [p for p in walk(folder / "src") if p.suffix.lower() in CODE_EXT and not is_kit_sdk(p)]
    if not sources:
        sources = [p for p in walk(folder / "package") if p.suffix.lower() in SHIPPED_CODE_EXT]
        where.append("no src/, so the shipped files were read")
    for path in sources:
        text = read_text(path) or ""
        names = {"formext"}
        names |= set(re.findall(r"\bformext\s+as\s+([A-Za-z_$][\w$]*)", text))
        names |= set(re.findall(r"([A-Za-z_$][\w$]*)\s*\??\s*:\s*FormExt\b", text))
        names |= set(re.findall(r"([A-Za-z_$][\w$]*)\s*=\s*new\s+FormExt\s*\(", text))
        receiver = "|".join(re.escape(n) for n in sorted(names))
        for m in re.finditer(r"(?<![\w$])(?:%s)\s*\??\.\s*(%s)\s*(?:<[^>()]*>)?\s*\(" % (receiver, "|".join(SDK_METHODS)), text):
            used.add(SDK_METHODS[m.group(1)])
        for m in RPC_LITERAL.finditer(text):
            used.add(RPC_METHODS[m.group(1)])
    return used, where


def check_permissions(folder: Path, manifest: dict, result: Result) -> None:
    declared = set(manifest.get("permissions") or [])
    used, notes = used_permissions(folder)
    result.notes.extend(f"{folder.name}: {n}" for n in notes)
    errs = [f"uses {p} ({', '.join(k for k, v in SDK_METHODS.items() if v == p)}) but does not declare it" for p in sorted(used - declared)]
    errs += [f"declares {p} but never uses it; ask only for what it needs" for p in sorted(declared - used)]
    result.check(f"5 permissions (declared {sorted(declared) or 'none'}, used {sorted(used) or 'none'})", errs)


def check_metadata(folder: Path, manifest: dict, result: Result) -> None:
    errs: list[str] = []
    readme = folder / "README.md"
    text = read_text(readme) if readme.is_file() else None
    if text is None:
        errs.append("README.md is missing")
    else:
        body = re.sub(r"^#.*$", "", text, flags=re.M).strip()
        if len(body) < 200:
            errs.append("README.md must say what the extension does")
        section = re.search(r"^#{1,3}\s+Permissions?\b.*?$(.*?)(?=^#{1,3}\s|\Z)", text, flags=re.M | re.S | re.I)
        if not section:
            errs.append("README.md needs a Permissions section saying what it asks for and why")
        else:
            for p in manifest.get("permissions") or []:
                if p not in section.group(1):
                    errs.append(f"README.md's Permissions section does not name {p} and why")
            if not manifest.get("permissions") and not re.search(r"\b(none|no permissions?)\b", section.group(1), re.I):
                errs.append("README.md's Permissions section must say that it asks for none")
        shots = re.findall(r"!\[[^\]]*\]\(([^)\s]+)", text) + re.findall(r"<img[^>]+src=\"([^\"]+)\"", text, flags=re.I)
        local = [s for s in shots if not re.match(r"^[a-z]+:", s) and (folder / s).resolve().is_file() and Path(s).suffix.lower() in IMAGE_EXT]
        if not local:
            errs.append("README.md must show a screenshot kept in the folder (for example ![...](docs/screenshot.png))")
    if not any((folder / n).is_file() for n in ("LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md")):
        errs.append("LICENSE is missing")
    changelog = folder / "CHANGELOG.md"
    if not changelog.is_file():
        errs.append("CHANGELOG.md is missing")
    elif str(manifest.get("version", "")) not in (read_text(changelog) or ""):
        errs.append(f"CHANGELOG.md has no entry for {manifest.get('version')}")
    result.check("6 metadata (README, permissions, LICENSE, CHANGELOG, screenshot)", errs)


def check_blocklist(manifest: dict, blocked: list[dict], result: Result) -> None:
    reason = registry.blocked_reason(blocked, str(manifest.get("id")), str(manifest.get("version")))
    result.check("7 block list", [f"{manifest.get('id')} {manifest.get('version')} is blocked: {reason}"] if reason else [])


def check_extension(folder: Path, args, published: dict | None, base: str | None, changed: bool, blocked: list[dict]) -> Result:
    result = Result(f"extensions/{folder.name}")
    manifest = check_contract(folder, result)
    if not manifest:
        return result
    digest = check_reproducible(folder, args.skip_npm, result)
    check_version(folder, manifest, published, base, changed, digest, result)
    check_bans(folder, result)
    check_permissions(folder, manifest, result)
    check_metadata(folder, manifest, result)
    check_blocklist(manifest, blocked, result)
    return result


def check_registry_files() -> Result:
    result = Result("registry/")
    _, errs = registry.load_blocklist()
    result.check("block list format", errs)
    perrs: list[str] = []
    try:
        pubs = registry.load_publishers()
        if not any(p.get("id") == registry.PUBLISHER_ID for p in pubs):
            perrs.append(f"registry/publishers.json must list {registry.PUBLISHER_ID}")
        for p in pubs:
            if not p.get("public_key"):
                result.notes.append(f"publisher {p.get('id')} has no public key yet (the owners add it, see KEYS.md)")
            else:
                try:
                    raw = base64.b64decode(p["public_key"], validate=True)
                except (binascii.Error, ValueError):
                    raw = b""
                if len(raw) != 32:
                    perrs.append(f"publisher {p.get('id')}: public_key must be base64 of 32 bytes")
    except (OSError, ValueError) as e:
        perrs.append(f"registry/publishers.json: {e}")
    result.check("publishers", perrs)
    return result


def changed_ids(base_ref: str) -> tuple[list[str], list[str], bool]:
    out = git("diff", "--name-only", f"{base_ref}...HEAD")
    if out.returncode != 0:
        raise SystemExit(f"git diff --name-only {base_ref}...HEAD failed: {out.stderr.strip()}")
    names = [n for n in out.stdout.splitlines() if n]
    ids = sorted({n.split("/")[1] for n in names if n.startswith("extensions/") and n.count("/") >= 2})
    tooling = any(n.startswith(("tools/", "contract/")) for n in names)
    return ids, names, tooling


def main() -> int:
    ap = argparse.ArgumentParser(prog="check", description="The Form Extension Registry's checks for extensions/<id>/ folders.")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="check every extension")
    mode.add_argument("--changed", action="store_true", help="check what `git diff --name-only origin/main...HEAD` changes")
    ap.add_argument("folders", nargs="*", type=Path, help="extension folders to check")
    ap.add_argument("--base", default="origin/main", help="the branch a change is compared with (default origin/main)")
    ap.add_argument("--published", help="the published extensions.json (path or URL); default the registry's index URL, or FORMEXT_PUBLISHED_INDEX")
    ap.add_argument("--skip-npm", action="store_true", help="leave out the npm ci && npm run build reproduction")
    args = ap.parse_args()

    results: list[Result] = [check_registry_files()]
    blocked, _ = registry.load_blocklist()
    base = args.base if git("rev-parse", "--verify", "--quiet", args.base).returncode == 0 else None
    changed: set[str] = set()
    header: list[str] = []

    if args.changed:
        if base is None:
            raise SystemExit(f"--changed needs {args.base}; fetch it first (git fetch origin main)")
        ids, names, tooling = changed_ids(args.base)
        changed = set(ids)
        header.append(f"{len(names)} changed files against {args.base}; extensions changed: {', '.join(ids) or 'none'}")
        if tooling:
            header.append("tools/ or contract/ changed, so every extension is checked against the new rules")
            folders = registry.extension_dirs()
        else:
            folders = [registry.EXTENSIONS / i for i in ids]
        removed = [f for f in folders if not f.is_dir()]
        for f in removed:
            header.append(f"extensions/{f.name} was removed; a removed extension stays downloadable by its tag, and is turned off only by the block list")
        folders = [f for f in folders if f.is_dir()]
    elif args.all or not args.folders:
        folders = registry.extension_dirs()
    else:
        folders = [f.resolve() for f in args.folders]
        for f in folders:
            if f.parent != registry.EXTENSIONS.resolve():
                raise SystemExit(f"{f} is not a folder under extensions/")
    if base is None:
        header.append(f"{args.base} is not available here, so nothing is compared with a base commit")

    probe = Result("published index")
    published = published_index(args.published, probe)
    if probe.notes:
        header.extend(probe.notes)

    for folder in folders:
        results.append(check_extension(folder, args, published, base, folder.name in changed, blocked))

    print("Form Extension Registry checks")
    for line in header:
        print(f"note: {line}")
    failed = 0
    for r in results:
        print()
        print(f"{r.name}: {'FAILED' if r.errors else 'passed'}")
        for p in r.passed:
            print(f"  ok    {p}")
        for e in r.errors:
            print(f"  error {e}")
        for n in r.notes:
            print(f"  note  {n}")
        failed += bool(r.errors)
    print()
    checked = len(results) - 1
    print(f"{checked} extension{'s' if checked != 1 else ''} checked; {failed} with errors" if failed else f"{checked} extension{'s' if checked != 1 else ''} checked; all passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
