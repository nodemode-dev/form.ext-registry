from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KIT = ROOT / "contract"
HASHES = ROOT / "contract.sha256"
SKIPPED_DIRS = {"__pycache__"}


def kit_files(kit: Path) -> list[str]:
    found = []
    for path in sorted(kit.rglob("*")):
        rel = path.relative_to(kit.parent)
        if path.is_file() and not SKIPPED_DIRS.intersection(rel.parts) and path.suffix != ".pyc":
            found.append(rel.as_posix())
    return found


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_list(path: Path) -> tuple[dict[str, str], list[str]]:
    listed: dict[str, str] = {}
    errs: list[str] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as e:
        return listed, [f"{path.name}: cannot read the hash list ({e})"]
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        digest, _, name = line.partition("  ")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest) or not name:
            errs.append(f"{path.name}:{number}: not a `<sha256>  <path>` line")
        elif name in listed:
            errs.append(f"{path.name}:{number}: {name} is listed twice")
        else:
            listed[name] = digest
    return listed, errs


def problems(kit: Path, hashes: Path) -> list[str]:
    listed, errs = read_list(hashes)
    present = kit_files(kit)
    for name in present:
        if name not in listed:
            errs.append(f"{name}: in the kit copy but not in {hashes.name}")
        elif sha256_of(kit.parent / name) != listed[name]:
            errs.append(f"{name}: differs from {hashes.name} (the kit copy was edited, or the list was not updated with it)")
    for name in listed:
        if name not in present:
            errs.append(f"{name}: listed in {hashes.name} but missing from the kit copy")
    return errs


def main() -> int:
    ap = argparse.ArgumentParser(prog="check_kit", description="Check the contract kit copy against the hash list kept beside it.")
    ap.add_argument("--print", action="store_true", dest="show", help="print the hash list for the files now in contract/ (after copying the whole kit again from form.ext)")
    ap.add_argument("--kit", type=Path, default=KIT, help="the kit folder (default contract/)")
    ap.add_argument("--hashes", type=Path, default=HASHES, help="the hash list (default contract.sha256)")
    args = ap.parse_args()
    if args.show:
        for name in kit_files(args.kit):
            print(f"{sha256_of(args.kit.parent / name)}  {name}")
        return 0
    errs = problems(args.kit, args.hashes)
    for e in errs:
        print(f"error {e}")
    if errs:
        print(f"the contract kit copy does not match {args.hashes.name}: copy the whole kit from form.ext again, then run `python3 tools/check_kit.py --print` and update the list")
        return 1
    print(f"contract kit copy: {len(kit_files(args.kit))} files match {args.hashes.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
