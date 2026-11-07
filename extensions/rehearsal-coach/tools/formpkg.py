from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

PRODUCTS = ["formvis", "formcut", "formwav", "formpdf", "formdeck", "formlit", "formmd", "formencoder", "formvfx", "formmcp", "formtray", "formskills", "formportal"]
KINDS = ["effect-stack", "wgsl-kernel", "audio-chain", "caption-look", "lut", "timeline-template", "script-plugin", "action-set", "preset", "theme", "native-plugin"]
PERMISSIONS = ["document", "files-read", "files-write", "network", "models", "native-code"]
TYPES = {".html", ".js", ".mjs", ".css", ".json", ".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif", ".wasm", ".txt", ".md", ".wav", ".ogg", ".mp3", ".webm", ".mp4", ".cube", ".woff2"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
LOCAL_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
MAX_BYTES = 20 * 1024 * 1024
MAX_FILES = 512
SKIP = {".DS_Store", "Thumbs.db"}


def problems(folder: Path) -> tuple[list[str], dict]:
    out: list[str] = []
    try:
        m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [f"manifest.json: {e}"], {}
    req = ["format", "format_version", "id", "name", "product", "kind", "version", "author", "licence", "native", "permissions"]
    for key in req:
        if key not in m:
            out.append(f"manifest.json: {key} is required")
    if m.get("format") != "formai-package":
        out.append("manifest.json: format must be formai-package")
    if m.get("format_version") != 1 or isinstance(m.get("format_version"), bool):
        out.append("manifest.json: format_version must be 1")
    if m.get("native") is True:
        out.append("manifest.json: native extensions are not supported by API 1 hosts")
    if not isinstance(m.get("entry", {}), dict):
        out.append("manifest.json: entry must be an object")
        m["entry"] = {}
    if not isinstance(m.get("contributes", {}), dict):
        out.append("manifest.json: contributes must be an object")
        m["contributes"] = {}
    for group in ("panels", "commands"):
        items = (m.get("contributes") or {}).get(group)
        if items is not None and (not isinstance(items, list) or any(not isinstance(i, dict) for i in items)):
            out.append(f"manifest.json: contributes.{group} must be a list of objects")
            m["contributes"][group] = []
    if not isinstance((m.get("entry") or {}).get("ui", ""), str):
        out.append("manifest.json: entry.ui must be a path inside the package")
        m["entry"] = {}
    if not ID_RE.match(str(m.get("id", ""))):
        out.append("manifest.json: id must match ^[a-z0-9][a-z0-9-]{1,63}$")
    if m.get("product") not in PRODUCTS:
        out.append(f"manifest.json: product must be one of {', '.join(PRODUCTS)}")
    if m.get("kind") not in KINDS:
        out.append(f"manifest.json: kind must be one of {', '.join(KINDS)}")
    if not VERSION_RE.match(str(m.get("version", ""))):
        out.append("manifest.json: version must be x.y.z")
    if m.get("minimum_app") is not None and not VERSION_RE.match(str(m["minimum_app"])):
        out.append("manifest.json: minimum_app must be x.y.z")
    if not isinstance(m.get("native"), bool):
        out.append("manifest.json: native must be true or false")
    perms = m.get("permissions")
    if not isinstance(perms, list) or any(p not in PERMISSIONS for p in perms) or len(set(perms or [])) != len(perms or []):
        out.append(f"manifest.json: permissions must be unique values from {', '.join(PERMISSIONS)}")
    if m.get("api") != "1":
        out.append('manifest.json: api must be "1" (every API 1 host refuses a package without it)')
    contributes = m.get("contributes") or {}
    entry = (m.get("entry") or {}).get("ui")
    for group in ("panels", "commands"):
        for item in contributes.get(group) or []:
            if not LOCAL_RE.match(str(item.get("id", ""))):
                out.append(f"manifest.json: contributes.{group} id {item.get('id')!r} must match ^[a-z0-9][a-z0-9-]{{0,31}}$")
            if not item.get("title"):
                out.append(f"manifest.json: contributes.{group} {item.get('id')!r} needs a title")
    panel_ids = {p.get("id") for p in contributes.get("panels") or []}
    for c in contributes.get("commands") or []:
        if c.get("panel") and c["panel"] not in panel_ids:
            out.append(f"manifest.json: command {c.get('id')!r} names panel {c['panel']!r}, which is not contributed")
    if (contributes.get("panels") or contributes.get("commands")) and not entry:
        out.append("manifest.json: entry.ui is required when panels or commands are contributed")
    if entry and not (folder / entry).is_file():
        out.append(f"manifest.json: entry.ui {entry} is not a file in the folder")
    return out, m


def files_of(folder: Path) -> tuple[list[Path], list[str]]:
    out: list[Path] = []
    errs: list[str] = []
    for p in sorted(folder.rglob("*")):
        rel = p.relative_to(folder).as_posix()
        if any(part.startswith(".") for part in p.relative_to(folder).parts) or p.name in SKIP:
            continue
        if p.is_symlink():
            errs.append(f"{rel}: symlinks are not allowed")
            continue
        if p.is_dir():
            continue
        if p.suffix.lower() not in TYPES:
            errs.append(f"{rel}: the file type {p.suffix or '(none)'} is not allowed")
            continue
        if len(rel) > 200:
            errs.append(f"{rel}: the path is longer than 200 characters")
            continue
        out.append(p)
    if len(out) > MAX_FILES:
        errs.append(f"{len(out)} files; at most {MAX_FILES}")
    return out, errs


def build(folder: Path, out_dir: Path) -> tuple[Path, str, int, dict]:
    errs, m = problems(folder)
    files, ferrs = files_of(folder)
    errs += ferrs
    if errs:
        raise SystemExit("refused:\n  " + "\n  ".join(errs))
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{m['id']}-{m['version']}.formpkg"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in sorted(files, key=lambda f: f.relative_to(folder).as_posix()):
            info = zipfile.ZipInfo(p.relative_to(folder).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            z.writestr(info, p.read_bytes())
    size = target.stat().st_size
    if size > MAX_BYTES:
        target.unlink()
        raise SystemExit(f"refused: {size} bytes; at most {MAX_BYTES}")
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    return target, digest, size, m


def entry(m: dict, url: str, digest: str, size: int) -> dict:
    e = {k: m[k] for k in ("id", "name", "product", "kind", "author", "version", "licence", "native", "permissions")}
    e["description"] = m.get("description") or m["name"]
    e["url"] = url
    e["sha256"] = digest
    e["bytes"] = size
    for k in ("minimum_app", "api", "homepage", "support"):
        if m.get(k):
            e[k] = m[k]
    return e


def main() -> int:
    ap = argparse.ArgumentParser(prog="formpkg", description="Validate and build Form extension packages (.formpkg).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("folder", type=Path)
    b = sub.add_parser("build")
    b.add_argument("folder", type=Path)
    b.add_argument("-o", "--out", type=Path, default=Path("dist"))
    b.add_argument("--url", default="", help="print an extensions.json entry with this https:// url")
    args = ap.parse_args()
    if args.cmd == "validate":
        errs, _ = problems(args.folder)
        errs += files_of(args.folder)[1]
        if errs:
            print("refused:\n  " + "\n  ".join(errs))
            return 1
        print("valid")
        return 0
    target, digest, size, m = build(args.folder, args.out)
    print(json.dumps({"file": str(target), "sha256": digest, "bytes": size}))
    if args.url:
        print(json.dumps(entry(m, args.url, digest, size), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
