from __future__ import annotations

import argparse
import base64
import json
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

USES = {
    "registry": ("REGISTRY_SIGNING_KEY", "FormPortal core/registry_keys.txt, form.ext and formai.studio (see KEYS.md)"),
    "publisher": ("PUBLISHER_SIGNING_KEY", "registry/publishers.json, as the nodemode publisher's public_key"),
}


def main() -> int:
    ap = argparse.ArgumentParser(prog="new_signing_key", description="Make an Ed25519 key pair for the Form Extension Registry.")
    ap.add_argument("kind", choices=sorted(USES), help="registry: signs extensions.json and blocklist.json; publisher: signs packages")
    ap.add_argument("--json", action="store_true", help="print {kind, secret, private_key, public_key} as JSON")
    args = ap.parse_args()
    key = Ed25519PrivateKey.generate()
    seed = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    private_b64 = base64.b64encode(seed).decode("ascii")
    public_b64 = base64.b64encode(public).decode("ascii")
    secret, where = USES[args.kind]
    if args.json:
        print(json.dumps({"kind": args.kind, "secret": secret, "private_key": private_b64, "public_key": public_b64}))
        return 0
    print(f"{args.kind} key pair (Ed25519)")
    print()
    print(f"Private key: put it in the GitHub repository secret {secret} and nowhere else. Never commit it.")
    print(private_b64)
    print()
    print(f"Public key: goes into {where}.")
    print(public_b64)
    return 0


if __name__ == "__main__":
    sys.exit(main())
