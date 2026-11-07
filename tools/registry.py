from __future__ import annotations

import base64
import binascii
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSIONS = ROOT / "extensions"
BLOCKLIST = ROOT / "registry" / "blocklist.json"
PUBLISHERS = ROOT / "registry" / "publishers.json"
KIT_SDK = ROOT / "contract" / "sdk" / "formext.ts"

sys.path.insert(0, str(ROOT / "contract" / "tools"))
import formpkg  # noqa: E402

REPO = "nodemode-dev/form.ext-registry"
RELEASES = f"https://github.com/{REPO}/releases/download"
INDEX_URL = f"{RELEASES}/index/extensions.json"
BLOCKLIST_URL = f"{RELEASES}/index/blocklist.json"
PUBLISHER_ID = "nodemode"
HOST_PRODUCTS = list(formpkg.PRODUCTS)


def package_url(ext_id: str, version: str) -> str:
    return f"{RELEASES}/ext-{ext_id}-v{version}/{ext_id}-{version}.formpkg"


def source_url(ext_id: str) -> str:
    return f"https://github.com/{REPO}/tree/main/extensions/{ext_id}"


def version_key(version: str) -> tuple[int, ...]:
    return tuple(int(p) for p in version.split("."))


def load_blocklist(path: Path = BLOCKLIST) -> tuple[list[dict], list[str]]:
    errs: list[str] = []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return [], [f"registry/blocklist.json: {e}"]
    if doc.get("format") != "formext-blocklist" or doc.get("format_version") != 1:
        errs.append('registry/blocklist.json: format must be "formext-blocklist" with format_version 1')
    blocked = doc.get("blocked")
    if not isinstance(blocked, list):
        return [], errs + ["registry/blocklist.json: blocked must be a list"]
    for i, b in enumerate(blocked):
        where = f"registry/blocklist.json: blocked[{i}]"
        if not isinstance(b, dict):
            errs.append(f"{where} must be an object")
            continue
        for key in ("id", "versions", "reason", "date"):
            if key not in b:
                errs.append(f"{where} needs {key}")
        versions = b.get("versions")
        if not isinstance(versions, list) or not versions or any(v != "*" and not formpkg.VERSION_RE.match(str(v)) for v in versions):
            errs.append(f'{where}: versions must be a list of x.y.z or ["*"]')
    return [b for b in blocked if isinstance(b, dict)], errs


def blocked_reason(blocked: list[dict], ext_id: str, version: str) -> str | None:
    for b in blocked:
        if b.get("id") == ext_id and ("*" in (b.get("versions") or []) or version in (b.get("versions") or [])):
            return str(b.get("reason") or "blocked")
    return None


def load_publishers(path: Path = PUBLISHERS) -> list[dict]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    return list(doc.get("publishers") or [])


def signing_key(env: str):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    text = os.environ.get(env, "").strip()
    if not text:
        return None
    try:
        seed = base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError):
        raise SystemExit(f"{env} is not valid base64")
    if len(seed) != 32:
        raise SystemExit(f"{env} must be a base64 raw 32-byte Ed25519 seed, not {len(seed)} bytes")
    return Ed25519PrivateKey.from_private_bytes(seed)


def public_b64(key) -> str:
    from cryptography.hazmat.primitives import serialization

    raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii")


def sign_b64(key, body: bytes) -> str:
    return base64.b64encode(key.sign(body)).decode("ascii")


def verify_b64(public_key: str, body: bytes, signature: str) -> bool:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    try:
        raw = base64.b64decode(public_key.strip(), validate=True)
        sig = base64.b64decode(signature.strip(), validate=True)
        Ed25519PublicKey.from_public_bytes(raw).verify(sig, body)
        return True
    except (InvalidSignature, ValueError, binascii.Error):
        return False


def extension_dirs() -> list[Path]:
    if not EXTENSIONS.is_dir():
        return []
    return sorted(p for p in EXTENSIONS.iterdir() if p.is_dir() and not p.name.startswith("."))
