from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import registry  # noqa: E402
from registry import formpkg  # noqa: E402

INDEX_NAME = "Form Extension Registry"
INDEX_DESCRIPTION = "Verified Form extensions, built and signed from nodemode-dev/form.ext-registry."


def registry_commit() -> str:
    sha = os.environ.get("GITHUB_SHA", "").strip()
    if sha:
        return sha
    out = subprocess.run(["git", "-C", str(registry.ROOT), "rev-parse", "HEAD"], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit("cannot read the registry commit: " + out.stderr.strip())
    return out.stdout.strip()


def publishers(publisher_key) -> list[dict]:
    out: list[dict] = []
    for p in registry.load_publishers():
        p = {k: p[k] for k in ("id", "name", "public_key", "url") if p.get(k)}
        if p.get("id") == registry.PUBLISHER_ID and publisher_key is not None:
            derived = registry.public_b64(publisher_key)
            if not p.get("public_key"):
                print(f"note: registry/publishers.json has no public key for {registry.PUBLISHER_ID} yet; the index carries the one PUBLISHER_SIGNING_KEY gives")
                p["public_key"] = derived
            elif p["public_key"] != derived:
                raise SystemExit(f"PUBLISHER_SIGNING_KEY does not match {registry.PUBLISHER_ID}'s public_key in registry/publishers.json")
        if p.get("public_key"):
            out.append({"id": p["id"], "name": p["name"], "public_key": p["public_key"], **({"url": p["url"]} if p.get("url") else {})})
    return out


def write_signed(path: Path, body: bytes, key) -> None:
    path.write_bytes(body)
    sig = path.with_name(path.name + ".sig")
    if key is None:
        if sig.exists():
            sig.unlink()
        return
    value = registry.sign_b64(key, body)
    if not registry.verify_b64(registry.public_b64(key), body, value):
        raise SystemExit(f"the signature just made for {path.name} does not verify")
    sig.write_text(value, encoding="ascii")


def main() -> int:
    ap = argparse.ArgumentParser(prog="build_index", description="Build every extension package and write the signed registry index.")
    ap.add_argument("-o", "--out", type=Path, default=registry.ROOT / "dist")
    ap.add_argument("--require-keys", action="store_true", help="fail unless REGISTRY_SIGNING_KEY and PUBLISHER_SIGNING_KEY are set (the publish workflow)")
    args = ap.parse_args()

    registry_key = registry.signing_key("REGISTRY_SIGNING_KEY")
    publisher_key = registry.signing_key("PUBLISHER_SIGNING_KEY")
    if args.require_keys and (registry_key is None or publisher_key is None):
        raise SystemExit("REGISTRY_SIGNING_KEY and PUBLISHER_SIGNING_KEY must both be set")

    blocked, errs = registry.load_blocklist()
    if errs:
        raise SystemExit("\n".join(errs))

    out: Path = args.out
    if out.exists():
        shutil.rmtree(out)
    packages_dir = out / "packages"
    packages_dir.mkdir(parents=True)

    commit = registry_commit()
    entries: list[dict] = []
    for folder in registry.extension_dirs():
        package = folder / "package"
        if not (package / "manifest.json").is_file():
            raise SystemExit(f"extensions/{folder.name}: no package/manifest.json")
        errs, manifest = formpkg.problems(package)
        if errs:
            raise SystemExit(f"extensions/{folder.name}: " + "; ".join(errs))
        if manifest["id"] != folder.name:
            raise SystemExit(f"extensions/{folder.name}: the manifest id is {manifest['id']}")
        reason = registry.blocked_reason(blocked, manifest["id"], manifest["version"])
        if reason:
            print(f"left out {manifest['id']} {manifest['version']}: blocked ({reason})")
            continue
        target, digest, size, manifest = formpkg.build(package, packages_dir)
        entry = formpkg.entry(manifest, registry.package_url(manifest["id"], manifest["version"]), digest, size)
        if publisher_key is not None:
            body = target.read_bytes()
            entry["signature"] = {"publisher": registry.PUBLISHER_ID, "algorithm": "ed25519", "value": registry.sign_b64(publisher_key, body)}
        entry["verified"] = True
        entry["registry_commit"] = commit
        entry["source"] = registry.source_url(manifest["id"])
        entries.append(entry)
        print(f"built {target.name}  sha256 {digest}  {size} bytes")

    index = {
        "format": "formai-extensions",
        "format_version": 1,
        "name": INDEX_NAME,
        "description": INDEX_DESCRIPTION,
        "publishers": publishers(publisher_key),
        "packages": sorted(entries, key=lambda e: e["id"]),
    }
    body = (json.dumps(index, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    write_signed(out / "extensions.json", body, registry_key)
    write_signed(out / "blocklist.json", registry.BLOCKLIST.read_bytes(), registry_key)

    signed = "signed" if registry_key is not None else "unsigned (no REGISTRY_SIGNING_KEY)"
    packages = "signed by the publisher key" if publisher_key is not None else "unsigned (no PUBLISHER_SIGNING_KEY)"
    print(f"wrote {out / 'extensions.json'}: {len(entries)} extensions, index {signed}, packages {packages}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
